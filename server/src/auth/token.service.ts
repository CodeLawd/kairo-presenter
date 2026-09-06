import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Session, SessionDocument } from './schemas/session.schema'
import { AppConfig } from '../config/env'
import { APP_CONFIG } from '../config/config.module'
import { Inject } from '@nestjs/common'
import type { OrgRole } from '../orgs/schemas/membership.schema'

export interface AccessTokenClaims {
  sub: string
  orgId: string
  role: OrgRole
  deviceId: string
  /** Confirmed email. Never revoked, so a `true` claim can always be trusted. */
  emailVerified: boolean
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: string
}

export interface IssueInput {
  userId: Types.ObjectId
  orgId: Types.ObjectId
  role: OrgRole
  deviceId: string
  clientKind: 'web' | 'desktop'
  emailVerified: boolean
  userAgent?: string
  ip?: string
  /** Continues an existing rotation chain; omitted starts a new one. */
  familyId?: string
}

/** Opaque refresh tokens are 32 bytes of randomness — never a JWT. */
const REFRESH_TOKEN_BYTES = 32

export class RefreshTokenReuseError extends Error {
  constructor() {
    super('Refresh token has already been used')
  }
}

export class RefreshTokenInvalidError extends Error {
  constructor(message = 'Refresh token is not valid') {
    super(message)
  }
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Issues an access/refresh pair and records the refresh half.
   *
   * The access token is stateless so the hot path never reads the database; the
   * refresh token is stateful precisely so it CAN be revoked.
   */
  async issue(input: IssueInput): Promise<TokenPair> {
    const claims: AccessTokenClaims = {
      sub: input.userId.toString(),
      orgId: input.orgId.toString(),
      role: input.role,
      deviceId: input.deviceId,
      emailVerified: input.emailVerified,
    }
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: this.config.accessTokenTtl,
    })

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
    await this.sessions.create({
      userId: input.userId,
      orgId: input.orgId,
      deviceId: input.deviceId,
      tokenHash: hashToken(refreshToken),
      familyId: input.familyId ?? randomBytes(16).toString('hex'),
      clientKind: input.clientKind,
      userAgent: input.userAgent ?? '',
      ip: input.ip ?? '',
      expiresAt: this.refreshExpiry(),
    })

    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTtl }
  }

  /**
   * Exchanges a refresh token for a fresh pair, consuming the old one.
   *
   * A token presented twice means someone kept a copy — the legitimate holder
   * and the thief now both have one, and there is no way to tell which is which.
   * So the entire family is revoked: both parties are logged out and the real
   * user signs in again. Silently issuing a new pair would hand the thief
   * permanent access.
   */
  async rotate(
    refreshToken: string,
    context: { role: OrgRole; emailVerified: boolean; userAgent?: string; ip?: string },
  ): Promise<TokenPair & { userId: Types.ObjectId; orgId: Types.ObjectId }> {
    const tokenHash = hashToken(refreshToken)
    const session = await this.sessions.findOne({ tokenHash })
    if (!session) throw new RefreshTokenInvalidError()

    if (session.consumedAt) {
      await this.revokeFamily(session.familyId)
      throw new RefreshTokenReuseError()
    }
    if (session.revokedAt) throw new RefreshTokenInvalidError('Refresh token was revoked')
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new RefreshTokenInvalidError('Refresh token has expired')
    }

    session.consumedAt = new Date()
    await session.save()

    const pair = await this.issue({
      userId: session.userId,
      orgId: session.orgId,
      role: context.role,
      deviceId: session.deviceId,
      clientKind: session.clientKind,
      emailVerified: context.emailVerified,
      userAgent: context.userAgent,
      ip: context.ip,
      familyId: session.familyId,
    })

    return { ...pair, userId: session.userId, orgId: session.orgId }
  }

  /**
   * Who a refresh token belongs to, without consuming it.
   *
   * Rotation needs the caller's CURRENT role, which lives in the membership,
   * not in the stored session — so the role has to be looked up before the
   * token is spent. Returns null rather than throwing: the caller decides
   * whether an unknown token is a 401 or something quieter.
   */
  async peek(
    refreshToken: string,
  ): Promise<{ userId: Types.ObjectId; orgId: Types.ObjectId; deviceId: string } | null> {
    const session = await this.sessions.findOne({ tokenHash: hashToken(refreshToken) }).exec()
    if (!session) return null
    return { userId: session.userId, orgId: session.orgId, deviceId: session.deviceId }
  }

  /** Sign-out for one device. */
  async revokeDevice(userId: Types.ObjectId, deviceId: string): Promise<void> {
    await this.sessions.updateMany(
      { userId, deviceId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    )
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.sessions.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    )
  }

  /** Every device — used when a password changes. */
  async revokeAllForUser(userId: Types.ObjectId): Promise<void> {
    await this.sessions.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } })
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000)
  }
}

/** SHA-256 is right here: the input is 32 random bytes, so it is unguessable. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compares two hex digests without leaking how far they matched.
 *
 * A plain `===` bails at the first differing character, so response time is a
 * (very faint) signal about the prefix. Irrelevant for a 32-byte random token,
 * but a six-digit code is guessable enough that it costs nothing to close.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

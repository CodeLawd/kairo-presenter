import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Session, SessionDocument, SessionDeviceInfo } from './schemas/session.schema'
import { mergeDeviceInfo, type DeviceSnapshot } from './device-info'
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
  deviceName?: string
  device?: DeviceSnapshot
  lastLoginAt?: Date
  userAgent?: string
  ip?: string
  /** Continues an existing rotation chain; omitted starts a new one. */
  familyId?: string
}

export interface LiveDesktopDevice {
  deviceId: string
  deviceName: string
  device: SessionDeviceInfo
  userId: Types.ObjectId
  familyId: string
  ip: string
  userAgent: string
  lastSeenAt: Date
  lastLoginAt: Date
}

/** Opaque refresh tokens are 32 bytes of randomness — never a JWT. */
const REFRESH_TOKEN_BYTES = 32

/**
 * How long a just-spent token still chains to its successor.
 *
 * Two tabs share one refresh cookie and expire together; a double-invoked
 * effect fires twice in the same tick. Both present the same token
 * milliseconds apart — the second is concurrency, not theft. Past this
 * window a replay is a stale copy (or a thief) and revokes the family.
 */
const REFRESH_REUSE_GRACE_MS = 30_000

/** Follows one replacement hop per racer; a chain longer than this is theft. */
const MAX_REUSE_HOPS = 5

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
  private signAccessToken(input: {
    userId: Types.ObjectId
    orgId: Types.ObjectId
    role: OrgRole
    deviceId: string
    emailVerified: boolean
  }): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: input.userId.toString(),
        orgId: input.orgId.toString(),
        role: input.role,
        deviceId: input.deviceId,
        emailVerified: input.emailVerified,
      } satisfies AccessTokenClaims,
      { expiresIn: this.config.accessTokenTtl },
    )
  }

  async issue(input: IssueInput): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(input)

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
    await this.sessions.create({
      userId: input.userId,
      orgId: input.orgId,
      deviceId: input.deviceId,
      deviceName: input.deviceName?.trim() || input.device?.name?.trim() || '',
      device: mergeDeviceInfo(undefined, input.device),
      tokenHash: hashToken(refreshToken),
      familyId: input.familyId ?? randomBytes(16).toString('hex'),
      clientKind: input.clientKind,
      userAgent: input.userAgent ?? '',
      ip: input.ip ?? '',
      lastLoginAt: input.lastLoginAt ?? new Date(),
      expiresAt: this.refreshExpiry(),
    })

    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTtl }
  }

  /**
   * Exchanges a refresh token for a fresh pair, consuming the old one.
   *
   * A token presented twice after the grace window means someone kept a copy —
   * the legitimate holder and the thief now both have one, and there is no way
   * to tell which is which. So the entire family is revoked: both parties are
   * logged out and the real user signs in again. Silently issuing a new pair
   * would hand the thief permanent access.
   *
   * Within the grace window a replay is concurrency, not theft — two tabs
   * sharing a cookie expire together, and a double-invoked effect fires twice
   * in one tick. The replay follows the replacement chain to the live
   * successor and rotates that instead, so opening a second tab stops logging
   * the church out. The browser cookie converges on the newest token on the
   * next response, which is why the chain never grows: every racer lands one
   * hop ahead of where it started.
   */
  async rotate(
    refreshToken: string,
    context: {
      role: OrgRole
      emailVerified: boolean
      userAgent?: string
      ip?: string
      deviceName?: string
      device?: DeviceSnapshot
    },
  ): Promise<TokenPair & { userId: Types.ObjectId; orgId: Types.ObjectId }> {
    const tokenHash = hashToken(refreshToken)
    const presented = await this.sessions.findOne({ tokenHash })
    if (!presented) throw new RefreshTokenInvalidError()

    const live = await this.followReplacementChain(presented)
    if (!live) {
      await this.revokeFamily(presented.familyId)
      throw new RefreshTokenReuseError()
    }
    if (live.revokedAt) throw new RefreshTokenInvalidError('Refresh token was revoked')
    if (live.expiresAt.getTime() <= Date.now()) {
      throw new RefreshTokenInvalidError('Refresh token has expired')
    }

    live.consumedAt = new Date()
    await live.save()

    const pair = await this.issue({
      userId: live.userId,
      orgId: live.orgId,
      role: context.role,
      deviceId: live.deviceId,
      deviceName: context.deviceName?.trim() || context.device?.name?.trim() || live.deviceName,
      device: mergeDeviceInfo(live.device, context.device),
      lastLoginAt: live.lastLoginAt ?? live.createdAt ?? new Date(),
      clientKind: live.clientKind,
      emailVerified: context.emailVerified,
      userAgent: context.userAgent,
      ip: context.ip,
      familyId: live.familyId,
    })

    live.replacedByTokenHash = hashToken(pair.refreshToken)
    await live.save()

    return { ...pair, userId: live.userId, orgId: live.orgId }
  }

  /**
   * Walks spent tokens forward to the live successor.
   *
   * Returns the presented session itself when it was never spent. Returns null
   * when the chain is broken (successor missing, revoked, or expired), spent
   * outside the grace window, or longer than the hop cap — every one of those
   * is theft or corruption, and the caller revokes the family.
   */
  private async followReplacementChain(
    presented: SessionDocument,
  ): Promise<SessionDocument | null> {
    let current = presented
    for (let hops = 0; hops <= MAX_REUSE_HOPS; hops++) {
      if (!current.consumedAt) return current
      const fresh =
        Date.now() - current.consumedAt.getTime() < REFRESH_REUSE_GRACE_MS &&
        current.replacedByTokenHash
      if (!fresh) return null
      const successor = await this.sessions
        .findOne({ tokenHash: current.replacedByTokenHash })
        .exec()
      if (!successor) return null
      current = successor
    }
    return null
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

  /**
   * Live booth machines for an org: desktop sessions that can still refresh.
   *
   * Refresh rotation writes a new row and consumes the old one, so this keeps
   * only the current token per `deviceId`. Web browser sessions stay off this
   * list — the Devices page is the booth, not every laptop that opened the
   * dashboard.
   */
  async listLiveDesktop(orgId: string): Promise<LiveDesktopDevice[]> {
    if (!Types.ObjectId.isValid(orgId)) return []
    const rows = await this.sessions
      .find({
        orgId: new Types.ObjectId(orgId),
        clientKind: 'desktop',
        revokedAt: null,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .select('deviceId deviceName device userId familyId ip userAgent lastLoginAt updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean()
      .exec()

    const seen = new Set<string>()
    const devices: LiveDesktopDevice[] = []
    for (const row of rows) {
      if (seen.has(row.deviceId)) continue
      seen.add(row.deviceId)
      const lastSeenAt = row.updatedAt ?? row.createdAt ?? new Date()
      devices.push({
        deviceId: row.deviceId,
        deviceName: row.deviceName ?? '',
        device: row.device ?? mergeDeviceInfo(undefined, undefined),
        userId: row.userId,
        familyId: row.familyId,
        ip: row.ip ?? '',
        userAgent: row.userAgent ?? '',
        lastSeenAt,
        lastLoginAt: row.lastLoginAt ?? row.createdAt ?? lastSeenAt,
      })
    }

    const familyIds = [...new Set(devices.map((item) => item.familyId).filter(Boolean))]
    if (familyIds.length === 0) return devices

    const started = await this.sessions
      .aggregate<{ _id: string; startedAt: Date }>([
        { $match: { familyId: { $in: familyIds } } },
        { $group: { _id: '$familyId', startedAt: { $min: '$createdAt' } } },
      ])
      .exec()
    const startedAt = new Map(started.map((row) => [row._id, row.startedAt]))
    return devices.map((item) => ({
      ...item,
      lastLoginAt: startedAt.get(item.familyId) ?? item.lastLoginAt,
    }))
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

import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { UsersService, normalizeEmail } from '../users/users.service'
import { OrgsService } from '../orgs/orgs.service'
import { MailService } from '../mail/mail.service'
import { PasswordService } from './password.service'
import {
  RefreshTokenInvalidError,
  RefreshTokenReuseError,
  TokenPair,
  TokenService,
  hashToken,
  hashesEqual,
} from './token.service'
import { EmailToken, EmailTokenDocument, EmailTokenPurpose } from './schemas/email-token.schema'
import { OTP_MAX_ATTEMPTS, generateOtp, normalizeOtp } from './otp'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import type { UserDocument } from '../users/schemas/user.schema'
import type { OrgRole } from '../orgs/schemas/membership.schema'
import type { DeviceSnapshot } from './device-info'

export interface AuthContext {
  clientKind: 'web' | 'desktop'
  deviceId: string
  deviceName?: string
  device?: DeviceSnapshot
  userAgent?: string
  ip?: string
}

export interface AuthResult extends TokenPair {
  user: { id: string; email: string; name: string; emailVerified: boolean }
  org: { id: string; name: string; role: OrgRole }
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 30 * 60 * 1000

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly orgs: OrgsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    @InjectModel(EmailToken.name) private readonly emailTokens: Model<EmailTokenDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates the account, its first org, and the owner membership in one step.
   *
   * A user with no org cannot do anything — every resource is org-scoped — so
   * signup always lands somewhere. The org is the church they named, never a
   * guess from their own name.
   */
  async signUp(
    input: { email: string; password: string; name: string; orgName: string },
    context: AuthContext,
  ): Promise<AuthResult> {
    const email = normalizeEmail(input.email)
    if (await this.users.findByEmail(email)) {
      throw new ConflictException('An account with that email already exists')
    }

    const orgName = input.orgName.trim()
    if (!orgName) throw new BadRequestException('Enter your church name')

    const passwordHash = await this.passwords.hash(input.password)
    const user = await this.users.create({ email, name: input.name, passwordHash })
    const org = await this.orgs.createWithOwner({
      name: orgName,
      ownerUserId: user._id,
    })
    await this.users.setDefaultOrg(user._id, org._id)

    await this.sendVerificationEmail(user)

    const pair = await this.tokens.issue({
      userId: user._id,
      orgId: org._id,
      role: 'owner',
      deviceId: context.deviceId,
      deviceName: context.deviceName ?? context.device?.name,
      device: context.device,
      clientKind: context.clientKind,
      emailVerified: false,
      userAgent: context.userAgent,
      ip: context.ip,
    })
    return this.result(pair, user, { id: org._id.toString(), name: org.name, role: 'owner' })
  }

  /**
   * Every failure path returns the same message on purpose. Distinguishing
   * "no such account" from "wrong password" turns the login form into a way to
   * enumerate who has an account here.
   */
  async signIn(
    input: { email: string; password: string },
    context: AuthContext,
  ): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email, true)
    const ok = await this.passwords.verify(user?.passwordHash, input.password)
    if (!user || !ok || user.status !== 'active') {
      throw new UnauthorizedException('Email or password is incorrect')
    }
    return this.startSession(user, context)
  }

  /** Google identities are trusted for the address, so they arrive verified. */
  async signInWithGoogle(
    profile: { googleId: string; email: string; name: string; avatarUrl?: string },
    context: AuthContext,
  ): Promise<AuthResult> {
    const byGoogle = await this.users.findByGoogleId(profile.googleId)
    if (byGoogle) return this.startSession(byGoogle, context)

    // Same person, signing in a different way: link rather than create a second
    // account that would silently own none of their org's data.
    const byEmail = await this.users.findByEmail(profile.email)
    if (byEmail) {
      await this.users.attachGoogleId(byEmail._id, profile.googleId)
      if (!byEmail.emailVerifiedAt) await this.users.markEmailVerified(byEmail._id)
      const refreshed = await this.users.findById(byEmail._id)
      return this.startSession(refreshed ?? byEmail, context)
    }

    const user = await this.users.create({
      email: profile.email,
      name: profile.name,
      googleId: profile.googleId,
      avatarUrl: profile.avatarUrl,
      emailVerifiedAt: new Date(),
    })
    const org = await this.orgs.createWithOwner({
      // Google does not ask for a church name. The onboarding church step
      // renames this the first time they save a profile.
      name: 'My church',
      ownerUserId: user._id,
    })
    await this.users.setDefaultOrg(user._id, org._id)

    const pair = await this.tokens.issue({
      userId: user._id,
      orgId: org._id,
      role: 'owner',
      deviceId: context.deviceId,
      deviceName: context.deviceName ?? context.device?.name,
      device: context.device,
      clientKind: context.clientKind,
      // Google has already proven the address — there is nothing left to confirm.
      emailVerified: true,
      userAgent: context.userAgent,
      ip: context.ip,
    })
    return this.result(pair, user, { id: org._id.toString(), name: org.name, role: 'owner' })
  }

  /** The role is re-read on every rotation, so a demotion takes effect in 15 minutes. */
  async refresh(
    refreshToken: string,
    context: { userAgent?: string; ip?: string; deviceName?: string; device?: DeviceSnapshot },
  ): Promise<TokenPair> {
    const preview = await this.tokens.peek(refreshToken)
    if (!preview) throw new UnauthorizedException('Refresh token is not valid')
    const membership = await this.orgs.membershipOf(preview.userId, preview.orgId)
    if (!membership) throw new UnauthorizedException('No longer a member of that organization')

    const user = await this.users.findById(preview.userId)

    try {
      return await this.tokens.rotate(refreshToken, {
        role: membership.role,
        // Re-read, so confirming an address takes effect on the next rotation
        // rather than whenever the operator happens to sign in again.
        emailVerified: user?.emailVerifiedAt != null,
        ...context,
      })
    } catch (error) {
      // A replayed, revoked or expired token is a failed authentication, not a
      // server fault — every one of them means "sign in again", and a 500 would
      // send the desktop client into its error-retry path instead.
      if (error instanceof RefreshTokenReuseError) {
        throw new UnauthorizedException('Session expired. Please sign in again.')
      }
      if (error instanceof RefreshTokenInvalidError) {
        throw new UnauthorizedException(error.message)
      }
      throw error
    }
  }

  /**
   * Turns an approved pairing into a real session for the booth machine.
   *
   * The role is read now rather than at approval time: minutes can pass between
   * someone tapping Approve on their phone and the desktop's next poll, and the
   * membership is what decides access.
   */
  async completeDevicePairing(grant: {
    userId: Types.ObjectId
    orgId: Types.ObjectId
    deviceId: string
    deviceName?: string
    device?: DeviceSnapshot
  }): Promise<AuthResult> {
    const membership = await this.orgs.membershipOf(grant.userId, grant.orgId)
    if (!membership) throw new UnauthorizedException('No longer a member of that organization')

    const user = await this.users.findById(grant.userId)
    if (!user) throw new UnauthorizedException('Account no longer exists')
    const org = await this.orgs.requireById(grant.orgId)

    const pair = await this.tokens.issue({
      userId: user._id,
      orgId: org._id,
      role: membership.role,
      deviceId: grant.deviceId,
      deviceName: grant.deviceName ?? grant.device?.name,
      device: grant.device,
      clientKind: 'desktop',
      emailVerified: user.emailVerifiedAt !== null,
    })
    return this.result(pair, user, {
      id: org._id.toString(),
      name: org.name,
      role: membership.role,
    })
  }

  async signOut(userId: Types.ObjectId, deviceId: string): Promise<void> {
    await this.tokens.revokeDevice(userId, deviceId)
  }

  // ─── Email verification ─────────────────────────────────────────────────────

  async sendVerificationEmail(user: UserDocument): Promise<void> {
    const { token, code } = await this.mintEmailToken(user._id, 'verify-email', VERIFY_TTL_MS)
    const url = `${this.config.publicWebUrl}/verify-email?token=${token}`
    // Both go in the same email: the code for someone sitting in front of the
    // app (no browser round trip, no mail client on the booth machine), the
    // link for someone reading on a phone.
    await this.mail.sendWelcome(user.email, firstNameOf(user.name), { code, url })
  }

  /**
   * Confirms an address with the six-digit code.
   *
   * Wrong guesses are counted on the record itself and the code is burned at
   * the cap — six digits is only safe because a million guesses are not
   * available.
   */
  async verifyEmailCode(email: string, code: string): Promise<void> {
    const user = await this.users.findByEmail(email)
    if (!user) throw new BadRequestException('That code is not valid. Ask for a new one.')
    if (user.emailVerifiedAt) return

    const record = await this.emailTokens
      .findOne({ userId: user._id, purpose: 'verify-email', consumedAt: null })
      .sort({ createdAt: -1 })
    // `codeHash` is absent on a record minted before codes existed — such a
    // token can only be redeemed by its link, so say "ask for a new one"
    // rather than let every correct-looking code read as wrong.
    if (!record || !record.codeHash || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That code has expired. Ask for a new one.')
    }

    if (!hashesEqual(record.codeHash, hashToken(normalizeOtp(code)))) {
      record.attempts += 1
      // At the cap the record is consumed, not merely refused — otherwise the
      // cap would only slow an attacker down rather than stop them.
      if (record.attempts >= OTP_MAX_ATTEMPTS) record.consumedAt = new Date()
      await record.save()
      throw new BadRequestException(
        record.attempts >= OTP_MAX_ATTEMPTS
          ? 'Too many attempts. Ask for a new code.'
          : 'That code is not right. Check the email and try again.',
      )
    }

    record.consumedAt = new Date()
    await record.save()
    await this.users.markEmailVerified(user._id)
  }

  /**
   * Sends the confirmation link again.
   *
   * Silent for an unknown address and for an already-confirmed one: this
   * endpoint must not become a way to ask the server who has an account here.
   */
  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email)
    if (!user || user.emailVerifiedAt) return
    await this.sendVerificationEmail(user)
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeEmailToken(token, 'verify-email')
    await this.users.markEmailVerified(record.userId)
  }

  // ─── Password reset ─────────────────────────────────────────────────────────

  /**
   * Always resolves, even for an address with no account. The response must not
   * reveal who is registered here.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email)
    if (!user) return
    const { token } = await this.mintEmailToken(user._id, 'reset-password', RESET_TTL_MS)
    await this.mail.sendPasswordReset(
      user.email,
      `${this.config.publicWebUrl}/reset-password?token=${token}`,
    )
  }

  /** A reset ends every existing session — the point is to lock someone out. */
  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.consumeEmailToken(token, 'reset-password')
    await this.users.setPasswordHash(record.userId, await this.passwords.hash(password))
    await this.tokens.revokeAllForUser(record.userId)
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async startSession(user: UserDocument, context: AuthContext): Promise<AuthResult> {
    const memberships = await this.orgs.membershipsOf(user._id)
    const membership =
      memberships.find((m) => m.orgId.equals(user.defaultOrgId ?? m.orgId)) ?? memberships[0]
    if (!membership) throw new UnauthorizedException('Account has no organization')

    const org = await this.orgs.requireById(membership.orgId)
    await this.users.markSignedIn(user._id)

    const pair = await this.tokens.issue({
      userId: user._id,
      orgId: org._id,
      role: membership.role,
      deviceId: context.deviceId,
      deviceName: context.deviceName ?? context.device?.name,
      device: context.device,
      clientKind: context.clientKind,
      emailVerified: user.emailVerifiedAt !== null,
      userAgent: context.userAgent,
      ip: context.ip,
    })
    return this.result(pair, user, {
      id: org._id.toString(),
      name: org.name,
      role: membership.role,
    })
  }

  private result(pair: TokenPair, user: UserDocument, org: AuthResult['org']): AuthResult {
    return {
      ...pair,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerifiedAt !== null,
      },
      org,
    }
  }

  private async mintEmailToken(
    userId: Types.ObjectId,
    purpose: EmailTokenPurpose,
    ttlMs: number,
  ): Promise<{ token: string; code: string }> {
    const token = randomBytes(32).toString('base64url')
    const code = generateOtp()
    // A previous unused code must stop working the moment a new one is sent,
    // or "send it again" would leave two valid codes in two different emails.
    await this.emailTokens.updateMany(
      { userId, purpose, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    )
    await this.emailTokens.create({
      userId,
      tokenHash: hashToken(token),
      codeHash: hashToken(code),
      purpose,
      expiresAt: new Date(Date.now() + ttlMs),
    })
    return { token, code }
  }

  private async consumeEmailToken(
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenDocument> {
    const record = await this.emailTokens.findOne({ tokenHash: hashToken(token), purpose })
    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This link is no longer valid. Request a new one.')
    }
    record.consumedAt = new Date()
    await record.save()
    return record
  }
}

/** Emails greet a person, not a full legal name. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

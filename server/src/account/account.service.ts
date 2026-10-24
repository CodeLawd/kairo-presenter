import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { AuthService } from '../auth/auth.service'
import { PasswordService } from '../auth/password.service'
import { Session, SessionDocument } from '../auth/schemas/session.schema'
import { EmailToken, EmailTokenDocument } from '../auth/schemas/email-token.schema'
import {
  DeviceAuthRequest,
  DeviceAuthRequestDocument,
} from '../auth/schemas/device-auth-request.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { Organization, OrganizationDocument } from '../orgs/schemas/organization.schema'
import { Membership, MembershipDocument } from '../orgs/schemas/membership.schema'
import { OrgSecrets, OrgSecretsDocument } from '../orgs/schemas/org-secrets.schema'
import { OrgSecretsService } from '../orgs/org-secrets.service'
import { Sermon, SermonDocument } from '../sermons/schemas/sermon.schema'
import { decryptTranscript, transcriptKeyFromSecret } from '../sermons/transcript-crypto'
import { CrashReport, CrashReportDocument } from '../crashes/schemas/crash-report.schema'
import { UsageDay, UsageDayDocument } from '../usage/schemas/usage-day.schema'
import { confirmsDeletion, planAccountDeletion, type DeletionPlan } from './deletion-plan'

export const EXPORT_FORMAT = 'kairo-account-export/v1'

/** Roles whose church data comes with the export — the people who run the church. */
const EXPORTED_ORG_ROLES = ['owner', 'admin']

export interface DeletionPreview extends DeletionPlan {
  /** How the request must be confirmed: the password, or a code sent by email. */
  confirmWith: 'password' | 'email-code'
  /** Sermon counts for the churches that will be deleted, keyed by org id. */
  sermonCounts: Record<string, number>
}

/**
 * The person's own side of their data: a copy of everything held about them,
 * and erasure of it — the rights the privacy policy promises, without an email.
 */
@Injectable()
export class AccountService {
  private readonly log = new Logger(AccountService.name)
  private readonly transcriptKey: Buffer

  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly secrets: OrgSecretsService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    @InjectModel(EmailToken.name) private readonly emailTokens: Model<EmailTokenDocument>,
    @InjectModel(DeviceAuthRequest.name)
    private readonly deviceRequests: Model<DeviceAuthRequestDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(OrgSecrets.name) private readonly orgSecrets: Model<OrgSecretsDocument>,
    @InjectModel(Sermon.name) private readonly sermons: Model<SermonDocument>,
    @InjectModel(CrashReport.name) private readonly crashes: Model<CrashReportDocument>,
    @InjectModel(UsageDay.name) private readonly usage: Model<UsageDayDocument>,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.transcriptKey = transcriptKeyFromSecret(config.vaultEncryptionKey)
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  /**
   * Everything held about the caller, as one JSON document.
   *
   * Bearer secrets are left out on purpose: refresh-token hashes and the
   * API-key vault would turn a leaked export file into working credentials, so
   * the vault is reported only as which keys are set.
   */
  async export(userId: string): Promise<Record<string, unknown>> {
    const id = new Types.ObjectId(userId)
    // Read only to say whether one is set — the hash itself never leaves here.
    const found = await this.users.findById(id).select('+passwordHash').lean().exec()
    if (!found) throw new NotFoundException('Account no longer exists')
    const { passwordHash, ...user } = found

    const [memberships, sessions, crashReports, usageDays] = await Promise.all([
      this.memberships.find({ userId: id }).lean().exec(),
      this.sessions
        .find({ userId: id })
        .select('-tokenHash -replacedByTokenHash -familyId')
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.crashes.find({ userId: id }).sort({ firstAt: -1 }).lean().exec(),
      this.usage.find({ userId: id }).sort({ day: -1 }).lean().exec(),
    ])

    const orgs = await this.orgs
      .find({ _id: { $in: memberships.map((membership) => membership.orgId) } })
      .lean()
      .exec()
    const orgById = new Map(orgs.map((org) => [org._id.toString(), org]))

    const managed = memberships.filter(
      (membership) =>
        membership.status === 'active' && EXPORTED_ORG_ROLES.includes(membership.role),
    )
    const organizations = await Promise.all(
      managed.flatMap((membership) => {
        const org = orgById.get(membership.orgId.toString())
        return org ? [this.exportOrg(org, membership.role, id)] : []
      }),
    )

    return {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      account: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
        hasPassword: Boolean(passwordHash),
        googleLinked: Boolean(user.googleId),
        emailVerifiedAt: user.emailVerifiedAt,
        defaultOrgId: user.defaultOrgId?.toString() ?? null,
        status: user.status,
        platformRole: user.platformRole,
        lastLoginAt: user.lastLoginAt,
        createdAt: (user as { createdAt?: Date }).createdAt ?? null,
        updatedAt: (user as { updatedAt?: Date }).updatedAt ?? null,
      },
      memberships: memberships.map((membership) => ({
        orgId: membership.orgId.toString(),
        orgName: orgById.get(membership.orgId.toString())?.name ?? null,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      })),
      sessions: sessions.map(({ _id, __v, userId: _user, ...session }) => ({
        ...session,
        id: _id.toString(),
        orgId: session.orgId.toString(),
      })),
      organizations,
      crashReports: crashReports.map(({ _id, __v, userId: _user, ...report }) => ({
        ...report,
        id: _id.toString(),
        orgId: report.orgId?.toString() ?? null,
      })),
      usageDays: usageDays.map(({ _id, __v, userId: _user, ...day }) => ({
        ...day,
        id: _id.toString(),
        orgId: day.orgId?.toString() ?? null,
      })),
    }
  }

  private async exportOrg(
    org: Organization & { _id: Types.ObjectId; createdAt?: Date },
    role: string,
    userId: Types.ObjectId,
  ): Promise<Record<string, unknown>> {
    const orgId = org._id.toString()
    const [sermons, vault] = await Promise.all([
      this.sermons.find({ orgId: org._id }).sort({ preachedAt: -1 }).lean().exec(),
      this.vaultSummary(orgId),
    ])
    return {
      id: orgId,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      serviceTimes: org.serviceTimes,
      seatsUsed: org.seatsUsed,
      yourRole: role,
      ownedByYou: org.ownerUserId.equals(userId),
      createdAt: org.createdAt ?? null,
      apiKeys: vault,
      sermons: sermons.map((sermon) => {
        const {
          _id,
          __v,
          transcriptCiphertext,
          transcriptIv,
          transcriptAuthTag,
          claimedAt: _claimed,
          ...rest
        } = sermon as typeof sermon & { __v?: number }
        let transcript: unknown = null
        try {
          transcript = decryptTranscript(this.transcriptKey, {
            ciphertext: transcriptCiphertext,
            iv: transcriptIv,
            authTag: transcriptAuthTag,
          })
        } catch {
          // One unreadable envelope must not cost the person the rest of the export.
          this.log.error(`Could not decrypt transcript for sermon ${_id.toString()}`)
        }
        return {
          ...rest,
          id: _id.toString(),
          orgId,
          createdByUserId: rest.createdByUserId.toString(),
          transcript,
        }
      }),
    }
  }

  /** Which API keys the church has stored — never the values. */
  private async vaultSummary(
    orgId: string,
  ): Promise<{ configured: string[]; updatedAt: string | null }> {
    try {
      const { updatedAt, ...keys } = await this.secrets.get(orgId)
      return {
        configured: Object.entries(keys)
          .filter(([, value]) => value !== '')
          .map(([name]) => name),
        updatedAt,
      }
    } catch {
      return { configured: [], updatedAt: null }
    }
  }

  // ─── Deletion ───────────────────────────────────────────────────────────────

  /** What deleting the account would do, for the confirmation screen to show. */
  async previewDeletion(userId: string): Promise<DeletionPreview> {
    const user = await this.requireUser(userId)
    const plan = await this.plan(user._id)
    const counts = await Promise.all(
      plan.deleteOrgs.map(
        async (org) =>
          [org.id, await this.sermons.countDocuments({ orgId: new Types.ObjectId(org.id) })] as const,
      ),
    )
    return {
      ...plan,
      confirmWith: user.passwordHash ? 'password' : 'email-code',
      sermonCounts: Object.fromEntries(counts),
    }
  }

  async sendDeletionCode(userId: string): Promise<void> {
    const user = await this.requireUser(userId)
    if (user.passwordHash) {
      throw new BadRequestException('Confirm with your password instead.')
    }
    await this.auth.sendAccountDeletionCode(user)
  }

  /**
   * Erases the account and everything that only exists because of it.
   *
   * Checks run before anything is touched, and the user record goes last: a
   * failure halfway leaves an account that can still sign in and try again,
   * rather than orphaned data nobody can reach.
   */
  async deleteAccount(
    userId: string,
    input: { password?: string; code?: string; deleteOrgIds: string[] },
  ): Promise<{ deletedOrgIds: string[] }> {
    const user = await this.requireUser(userId)
    const plan = await this.plan(user._id)

    if (plan.blockers.length > 0) {
      const names = plan.blockers.map((org) => org.name).join(', ')
      throw new ConflictException(
        `You are the only owner of ${names}, which other people still use. Make someone else an owner first.`,
      )
    }
    if (!confirmsDeletion(plan, input.deleteOrgIds)) {
      throw new BadRequestException(
        'The churches to delete have changed. Reload the page and confirm again.',
      )
    }

    if (user.passwordHash) {
      // 403, not 401: the web client treats 401 as "signed out" and redirects.
      const ok = await this.passwords.verify(user.passwordHash, input.password ?? '')
      if (!ok) throw new ForbiddenException('That password is not right.')
    } else {
      if (!input.code) throw new BadRequestException('Enter the code we emailed you.')
      await this.auth.redeemAccountDeletionCode(user._id, input.code)
    }

    const deleteIds = plan.deleteOrgs.map((org) => new Types.ObjectId(org.id))
    if (deleteIds.length > 0) {
      const byOrg = { orgId: { $in: deleteIds } }
      await Promise.all([
        this.sermons.deleteMany(byOrg).exec(),
        this.orgSecrets.deleteMany(byOrg).exec(),
        this.memberships.deleteMany(byOrg).exec(),
        this.sessions.deleteMany(byOrg).exec(),
        this.deviceRequests.deleteMany(byOrg).exec(),
        this.crashes.deleteMany(byOrg).exec(),
        this.usage.deleteMany(byOrg).exec(),
      ])
      await this.orgs.deleteMany({ _id: { $in: deleteIds } }).exec()
    }

    for (const org of plan.leaveOrgs) await this.leave(user._id, new Types.ObjectId(org.id))

    const byUser = { userId: user._id }
    await Promise.all([
      this.sessions.deleteMany(byUser).exec(),
      this.emailTokens.deleteMany(byUser).exec(),
      this.deviceRequests.deleteMany(byUser).exec(),
      this.crashes.deleteMany(byUser).exec(),
      this.usage.deleteMany(byUser).exec(),
      // Invited and removed rows the plan does not cover.
      this.memberships.deleteMany(byUser).exec(),
    ])
    await this.users.deleteOne({ _id: user._id }).exec()

    this.log.log(`Account ${userId} deleted with ${deleteIds.length} church(es)`)
    return { deletedOrgIds: plan.deleteOrgs.map((org) => org.id) }
  }

  /** Leaves a church that carries on: the seat frees up and ownership never points at nobody. */
  private async leave(userId: Types.ObjectId, orgId: Types.ObjectId): Promise<void> {
    const removed = await this.memberships.findOneAndDelete({ orgId, userId }).exec()
    if (removed?.status === 'active') {
      await this.orgs.updateOne({ _id: orgId }, { $inc: { seatsUsed: -1 } }).exec()
    }
    const org = await this.orgs.findById(orgId).exec()
    if (org?.ownerUserId.equals(userId)) {
      const heir = await this.memberships
        .findOne({ orgId, role: 'owner', status: 'active' })
        .sort({ joinedAt: 1 })
        .exec()
      if (heir) await this.orgs.updateOne({ _id: orgId }, { $set: { ownerUserId: heir.userId } })
    }
  }

  private async plan(userId: Types.ObjectId): Promise<DeletionPlan> {
    const mine = await this.memberships.find({ userId, status: 'active' }).lean().exec()
    const orgIds = mine.map((membership) => membership.orgId)
    const [orgs, members] = await Promise.all([
      this.orgs.find({ _id: { $in: orgIds } }).select('name').lean().exec(),
      this.memberships.find({ orgId: { $in: orgIds } }).lean().exec(),
    ])
    return planAccountDeletion(
      userId.toString(),
      orgs.map((org) => ({
        id: org._id.toString(),
        name: org.name,
        members: members
          .filter((member) => member.orgId.equals(org._id))
          .map((member) => ({
            userId: member.userId.toString(),
            role: member.role,
            status: member.status,
          })),
      })),
    )
  }

  private async requireUser(userId: string): Promise<UserDocument> {
    const user = await this.users.findById(userId).select('+passwordHash').exec()
    if (!user) throw new NotFoundException('Account no longer exists')
    return user
  }
}

import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { User, type UserDocument } from '../users/schemas/user.schema'
import { Organization, type OrganizationDocument } from '../orgs/schemas/organization.schema'
import { Membership, type MembershipDocument } from '../orgs/schemas/membership.schema'
import { Sermon, type SermonDocument } from '../sermons/schemas/sermon.schema'
import { Session, type SessionDocument } from '../auth/schemas/session.schema'
import { DownloadEvent, type DownloadEventDocument } from '../downloads/schemas/download-event.schema'
import { TokenService } from '../auth/token.service'
import { platformRoleOf, type PlatformRole } from '../common/platform-admin'
import { normalizeEmail } from '../users/users.service'

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 25
const GITHUB_RELEASES = 'https://api.github.com/repos/CodeLawd/kairo-presenter/releases?per_page=20'
const GITHUB_CACHE_MS = 10 * 60 * 1000
/** Installer files only — update metadata and blockmaps are not downloads people chose. */
const INSTALLER = /\.(dmg|exe|AppImage|deb|zip)$/i

export interface DayCount { date: string; count: number }
export interface KeyCount { key: string; count: number }

@Injectable()
export class AdminService {
  private readonly log = new Logger(AdminService.name)
  private githubCache: { at: number; assets: GithubAsset[] } | null = null

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Sermon.name) private readonly sermons: Model<SermonDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
    @InjectModel(DownloadEvent.name) private readonly downloads: Model<DownloadEventDocument>,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async overview(now = new Date()): Promise<unknown> {
    const since7 = new Date(now.getTime() - 7 * DAY_MS)
    const since30 = new Date(now.getTime() - 30 * DAY_MS)
    const [
      usersTotal, usersVerified, usersDisabled, users7, users30,
      churchesTotal, churches30, sermonsTotal, sermons30,
      installs, downloadsTotal, downloads30, signups,
    ] = await Promise.all([
      this.users.countDocuments(),
      this.users.countDocuments({ emailVerifiedAt: { $ne: null } }),
      this.users.countDocuments({ status: 'disabled' }),
      this.users.countDocuments({ createdAt: { $gte: since7 } }),
      this.users.countDocuments({ createdAt: { $gte: since30 } }),
      this.orgs.countDocuments(),
      this.orgs.countDocuments({ createdAt: { $gte: since30 } }),
      this.sermons.countDocuments(),
      this.sermons.countDocuments({ createdAt: { $gte: since30 } }),
      // A desktop install that refreshed its session recently is one in use.
      this.sessions.distinct('deviceId', { clientKind: 'desktop', updatedAt: { $gte: since30 } }),
      this.downloads.countDocuments({ served: true }),
      this.downloads.countDocuments({ served: true, createdAt: { $gte: since30 } }),
      this.perDay(this.users, {}, 30, now),
    ])
    return {
      users: { total: usersTotal, verified: usersVerified, disabled: usersDisabled, new7d: users7, new30d: users30 },
      churches: { total: churchesTotal, new30d: churches30 },
      sermons: { total: sermonsTotal, last30d: sermons30 },
      activeInstalls30d: installs.length,
      downloads: { total: downloadsTotal, last30d: downloads30 },
      signups,
    }
  }

  async listUsers(query: { q?: string; page?: number }): Promise<unknown> {
    const page = Math.max(1, query.page ?? 1)
    const filter = query.q?.trim()
      ? { $or: [{ email: contains(query.q) }, { name: contains(query.q) }] }
      : {}
    const [total, rows] = await Promise.all([
      this.users.countDocuments(filter),
      this.users.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean().exec(),
    ])
    const churches = await this.churchesOf(rows.map((row) => row._id))
    return {
      items: rows.map((row) => ({
        id: row._id.toString(),
        email: row.email,
        name: row.name,
        verified: row.emailVerifiedAt !== null,
        status: row.status,
        signIn: row.googleId ? 'google' : 'email',
        platformRole: this.roleOf(row),
        createdAt: (row as { createdAt?: Date }).createdAt ?? null,
        lastLoginAt: row.lastLoginAt,
        churches: churches.get(row._id.toString()) ?? [],
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    }
  }

  /**
   * Disable blocks sign-in and ends every session now; enable lets them back in.
   * Staff accounts are protected: only a superadmin can disable an admin, and a
   * superadmin (set in config) cannot be disabled from here at all.
   */
  async setUserStatus(actor: Actor, userId: string, status: 'active' | 'disabled'): Promise<void> {
    if (!isValidObjectId(userId)) throw new NotFoundException('No such user')
    if (actor.id === userId) throw new BadRequestException('You can’t disable your own account')
    const user = await this.users.findById(userId).exec()
    if (!user) throw new NotFoundException('No such user')
    const target = this.roleOf(user)
    if (target === 'superadmin') throw new BadRequestException('A superadmin can’t be disabled')
    if (target === 'admin' && actor.role !== 'superadmin') {
      throw new ForbiddenException('Only a superadmin can disable an admin')
    }
    await this.users.updateOne({ _id: user._id }, { $set: { status } })
    if (status === 'disabled') await this.tokens.revokeAllForUser(user._id)
    this.log.log(`[admin] ${actor.id} set ${user.email} to ${status}`)
  }

  /** Everyone with console access: superadmins from config, then admins. */
  async listAdmins(): Promise<AdminEntry[]> {
    const emails = this.config.superadminEmails
    const rows = await this.users
      .find({ $or: [{ email: { $in: emails } }, { platformRole: 'admin' }] })
      .sort({ createdAt: 1 })
      .lean()
      .exec()
    const byEmail = new Map(rows.map((row) => [row.email, row]))
    const superadmins: AdminEntry[] = emails.map((email) => {
      const row = byEmail.get(email)
      // A superadmin email with no account yet still shows, so the list
      // matches the config even before they sign up.
      return row ? this.adminEntry(row, 'superadmin') : { id: null, email, name: '', role: 'superadmin', status: 'no account' }
    })
    const admins = rows.filter((row) => !emails.includes(row.email)).map((row) => this.adminEntry(row, 'admin'))
    return [...superadmins, ...admins]
  }

  /** Superadmin only. The person must already have a Kairo account. */
  async grantAdmin(actor: Actor, email: string): Promise<AdminEntry> {
    const user = await this.users.findOne({ email: normalizeEmail(email) }).lean().exec()
    if (!user) {
      throw new NotFoundException('No Kairo account uses that email. Ask them to sign up first, then add them here.')
    }
    if (this.roleOf(user) === 'superadmin') throw new BadRequestException('That account is already a superadmin')
    if (user.status !== 'active') throw new BadRequestException('Enable that account before making it an admin')
    await this.users.updateOne({ _id: user._id }, { $set: { platformRole: 'admin' } })
    this.log.log(`[admin] ${actor.id} granted admin to ${user.email}`)
    return this.adminEntry(user, 'admin')
  }

  /** Superadmin only. Takes effect on their next request — the guard re-reads it. */
  async revokeAdmin(actor: Actor, userId: string): Promise<void> {
    if (!isValidObjectId(userId)) throw new NotFoundException('No such user')
    const user = await this.users.findById(userId).exec()
    if (!user) throw new NotFoundException('No such user')
    if (this.roleOf(user) === 'superadmin') {
      throw new BadRequestException('Superadmins are set in SUPERADMIN_EMAILS on the server, not here')
    }
    await this.users.updateOne({ _id: user._id }, { $set: { platformRole: null } })
    this.log.log(`[admin] ${actor.id} revoked admin from ${user.email}`)
  }

  /** The staff role an account holds, whatever its current status. */
  private roleOf(user: { email: string; platformRole?: 'admin' | null }): PlatformRole | null {
    return platformRoleOf({ email: user.email, platformRole: user.platformRole }, this.config)
  }

  private adminEntry(
    row: { _id: Types.ObjectId; email: string; name: string; status: string },
    role: PlatformRole,
  ): AdminEntry {
    return { id: row._id.toString(), email: row.email, name: row.name, role, status: row.status }
  }

  async listChurches(query: { q?: string; page?: number }): Promise<unknown> {
    const page = Math.max(1, query.page ?? 1)
    const filter = query.q?.trim() ? { name: contains(query.q) } : {}
    const [total, rows] = await Promise.all([
      this.orgs.countDocuments(filter),
      this.orgs.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean().exec(),
    ])
    const ids = rows.map((row) => row._id)
    const [owners, sermonCounts] = await Promise.all([
      this.users.find({ _id: { $in: rows.map((row) => row.ownerUserId) } }, { email: 1, name: 1 }).lean().exec(),
      this.sermons.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { orgId: { $in: ids } } },
        { $group: { _id: '$orgId', count: { $sum: 1 } } },
      ]),
    ])
    const ownerById = new Map(owners.map((owner) => [owner._id.toString(), owner]))
    const sermonsById = new Map(sermonCounts.map((row) => [row._id.toString(), row.count]))
    return {
      items: rows.map((row) => {
        const owner = ownerById.get(row.ownerUserId.toString())
        return {
          id: row._id.toString(),
          name: row.name,
          owner: owner ? { id: owner._id.toString(), email: owner.email, name: owner.name } : null,
          members: row.seatsUsed,
          sermons: sermonsById.get(row._id.toString()) ?? 0,
          timezone: row.timezone,
          createdAt: (row as { createdAt?: Date }).createdAt ?? null,
        }
      }),
      total,
      page,
      pageSize: PAGE_SIZE,
    }
  }

  async downloadStats(days: number, now = new Date()): Promise<unknown> {
    const since = new Date(now.getTime() - days * DAY_MS)
    const window = { createdAt: { $gte: since } }
    const served = { ...window, served: true }
    const [total, unavailable, byDay, byPlatform, bySource, byVersion, byCountry, github] = await Promise.all([
      this.downloads.countDocuments(served),
      this.downloads.countDocuments({ ...window, served: false }),
      this.perDay(this.downloads, { served: true }, days, now),
      this.countBy('platform', served),
      this.countBy('source', served),
      this.countBy('version', served),
      this.countBy('country', served),
      this.githubCounts(),
    ])
    return { days, total, unavailable, byDay, byPlatform, bySource, byVersion, byCountry, github }
  }

  private async churchesOf(userIds: Types.ObjectId[]): Promise<Map<string, { id: string; name: string; role: string }[]>> {
    const memberships = await this.memberships
      .find({ userId: { $in: userIds }, status: 'active' }, { userId: 1, orgId: 1, role: 1 })
      .lean()
      .exec()
    const orgs = await this.orgs.find({ _id: { $in: memberships.map((m) => m.orgId) } }, { name: 1 }).lean().exec()
    const nameById = new Map(orgs.map((org) => [org._id.toString(), org.name]))
    const result = new Map<string, { id: string; name: string; role: string }[]>()
    for (const membership of memberships) {
      const key = membership.userId.toString()
      const name = nameById.get(membership.orgId.toString())
      if (!name) continue
      result.set(key, [...(result.get(key) ?? []), { id: membership.orgId.toString(), name, role: membership.role }])
    }
    return result
  }

  /** Documents per UTC day for the last `days` days, zero-filled and oldest first. */
  private async perDay(model: Model<UserDocument> | Model<DownloadEventDocument>, match: object, days: number, now: Date): Promise<DayCount[]> {
    const start = startOfUtcDay(new Date(now.getTime() - (days - 1) * DAY_MS))
    const rows = await (model as Model<unknown>).aggregate<{ _id: string; count: number }>([
      { $match: { ...match, createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    ])
    const counts = new Map(rows.map((row) => [row._id, row.count]))
    return Array.from({ length: days }, (_, i) => {
      const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10)
      return { date, count: counts.get(date) ?? 0 }
    })
  }

  private async countBy(field: keyof DownloadEvent, match: object): Promise<KeyCount[]> {
    const rows = await this.downloads.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ])
    return rows.map((row) => ({ key: row._id || 'unknown', count: row.count }))
  }

  /**
   * GitHub's own per-file counters. These include the in-app updater (it
   * downloads the same Windows installer and Mac zips), so they read as
   * "installs + updates" next to the website's own count of new downloads.
   */
  private async githubCounts(): Promise<{ version: string; file: string; count: number }[] | null> {
    // The suite must never depend on the network.
    if (this.config.nodeEnv === 'test') return null
    if (this.githubCache && Date.now() - this.githubCache.at < GITHUB_CACHE_MS) return this.githubCache.assets
    try {
      const response = await fetch(GITHUB_RELEASES, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Kairo-admin' },
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return this.githubCache?.assets ?? null
      const releases = (await response.json()) as { tag_name: string; assets?: { name: string; download_count: number }[] }[]
      const assets = releases.flatMap((release) =>
        (release.assets ?? [])
          .filter((asset) => INSTALLER.test(asset.name))
          .map((asset) => ({ version: release.tag_name.replace(/^v/, ''), file: asset.name, count: asset.download_count })),
      )
      this.githubCache = { at: Date.now(), assets }
      return assets
    } catch (error) {
      this.log.warn(`[admin] GitHub release counts unavailable: ${(error as Error).message}`)
      return this.githubCache?.assets ?? null
    }
  }
}

type GithubAsset = { version: string; file: string; count: number }

export interface Actor { id: string; role: PlatformRole }

export interface AdminEntry {
  id: string | null
  email: string
  name: string
  role: PlatformRole
  status: string
}

function contains(text: string): RegExp {
  return new RegExp(text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

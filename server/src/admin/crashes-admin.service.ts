import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import { CrashReport, type CrashReportDocument } from '../crashes/schemas/crash-report.schema'
import { Organization, type OrganizationDocument } from '../orgs/schemas/organization.schema'
import { User, type UserDocument } from '../users/schemas/user.schema'
import type { DayCount } from './admin.service'
import { compareVersions } from './usage-admin.service'

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 25
const AFFECTED_LIMIT = 100

/**
 * A report without its heavy parts — the log, the errors and the GPU table —
 * for lists. Exclusions only: MongoDB refuses `system: 0` beside `system.x: 1`.
 */
const SUMMARY_FIELDS = { log: 0, windowErrors: 0, 'system.gpu': 0 }

interface Named { id: string; name: string }
interface Person extends Named { email: string }

type ReportRow = Pick<CrashReport, 'installId' | 'kind' | 'process' | 'reason' | 'exitCode' | 'count' | 'appVersion' | 'os' | 'firstAt' | 'lastAt'> & {
  _id: Types.ObjectId
  orgId: Types.ObjectId | null
  userId: Types.ObjectId
  system?: Record<string, unknown> | null
}

/**
 * The staff view of crash summaries: the commonest crashes first (grouped by
 * how they died, so one bug across many churches reads as one row) with the
 * users and systems they hit, then every report, newest first, and any one
 * report in full with its log and everyone else who hit the same crash.
 */
@Injectable()
export class CrashesAdminService {
  constructor(
    @InjectModel(CrashReport.name) private readonly reports: Model<CrashReportDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  /** The top of the Crashes page: the last 30 days at a glance. */
  async summary(now = new Date()): Promise<unknown> {
    const windowDays = 30
    const match = { lastAt: { $gte: new Date(now.getTime() - windowDays * DAY_MS) } }
    const [totals, byDay, top] = await Promise.all([
      this.reports.aggregate<{ crashes: number; reports: number; users: unknown[]; installs: unknown[]; churches: unknown[] }>([
        { $match: match },
        {
          $group: {
            _id: null,
            crashes: { $sum: '$count' },
            reports: { $sum: 1 },
            users: { $addToSet: '$userId' },
            installs: { $addToSet: '$installId' },
            churches: { $addToSet: '$orgId' },
          },
        },
      ]),
      this.reports.aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastAt' } }, count: { $sum: '$count' } } },
      ]),
      this.groups(match, 1),
    ])
    const counts = new Map(byDay.map((row) => [row._id, row.count]))
    const days: DayCount[] = []
    for (let i = windowDays - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10)
      days.push({ date, count: counts.get(date) ?? 0 })
    }
    const total = totals[0]
    return {
      days: windowDays,
      crashes: total?.crashes ?? 0,
      reports: total?.reports ?? 0,
      users: total?.users.length ?? 0,
      installs: total?.installs.length ?? 0,
      churches: total?.churches.filter(Boolean).length ?? 0,
      byDay: days,
      top: top[0] ?? null,
    }
  }

  async list(query: { page?: number; days?: number; version?: string }, now = new Date()): Promise<unknown> {
    const page = Math.max(1, query.page ?? 1)
    const days = query.days ?? 30
    const match: Record<string, unknown> = { lastAt: { $gte: new Date(now.getTime() - days * DAY_MS) } }
    if (query.version) match.appVersion = query.version

    const [groups, total, rows, versions] = await Promise.all([
      this.groups(match, 20),
      this.reports.countDocuments(match),
      this.reports
        .find(match, SUMMARY_FIELDS)
        .sort({ lastAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<ReportRow[]>(),
      this.reports.distinct('appVersion', { lastAt: match.lastAt }),
    ])

    const look = await this.lookups(rows)
    return {
      days,
      versions: (versions as string[]).filter(Boolean).sort(compareVersions),
      groups,
      items: rows.map((row) => this.item(row, look)),
      total,
      page,
      pageSize: PAGE_SIZE,
    }
  }

  async detail(id: string): Promise<unknown> {
    if (!isValidObjectId(id)) throw new NotFoundException('No such crash report')
    const row = await this.reports.findById(id).lean<ReportRow & Pick<CrashReport, 'windowErrors' | 'log'>>()
    if (!row) throw new NotFoundException('No such crash report')
    // Everyone who hit this same crash (same signature as the groups), newest first.
    const same = await this.reports
      .find(
        { kind: row.kind, reason: row.reason, exitCode: row.exitCode, os: row.os },
        SUMMARY_FIELDS,
      )
      .sort({ lastAt: -1 })
      .limit(AFFECTED_LIMIT)
      .lean<ReportRow[]>()
    const look = await this.lookups([row, ...same])
    return {
      ...this.item(row, look),
      installId: row.installId,
      system: row.system ?? {},
      errors: row.windowErrors ?? [],
      log: row.log ?? '',
      affected: same.map((other) => this.item(other, look)),
    }
  }

  /** Crashes grouped by how they died, with the users, churches and systems each one hit. */
  private async groups(match: object, limit: number): Promise<unknown[]> {
    const groups = await this.reports.aggregate<{
      _id: { kind: string; reason: string; exitCode: number; os: string }
      crashes: number
      users: Types.ObjectId[]
      installs: string[]
      churches: (Types.ObjectId | null)[]
      versions: string[]
      systems: string[]
      lastAt: Date
      latest: Types.ObjectId
    }>([
      { $match: match },
      { $sort: { lastAt: -1 } },
      {
        $group: {
          _id: { kind: '$kind', reason: '$reason', exitCode: '$exitCode', os: '$os' },
          crashes: { $sum: '$count' },
          users: { $addToSet: '$userId' },
          installs: { $addToSet: '$installId' },
          churches: { $addToSet: '$orgId' },
          versions: { $addToSet: '$appVersion' },
          systems: { $addToSet: { $concat: [{ $ifNull: ['$system.osVersion', ''] }, ' · ', { $ifNull: ['$system.arch', ''] }] } },
          lastAt: { $max: '$lastAt' },
          latest: { $first: '$_id' },
        },
      },
      { $sort: { crashes: -1 } },
      { $limit: limit },
    ])
    return groups.map((group) => ({
      kind: group._id.kind,
      reason: group._id.reason,
      exitCode: group._id.exitCode,
      os: group._id.os,
      crashes: group.crashes,
      users: group.users.length,
      installs: group.installs.length,
      churches: group.churches.filter(Boolean).length,
      versions: group.versions.filter(Boolean).sort(compareVersions),
      systems: group.systems.filter((s) => s !== ' · ').sort(),
      lastAt: group.lastAt,
      latestId: String(group.latest),
    }))
  }

  private item(row: ReportRow, look: { churches: Map<string, Named>; users: Map<string, Person> }): Record<string, unknown> {
    const system = row.system ?? {}
    return {
      id: String(row._id),
      church: row.orgId ? look.churches.get(String(row.orgId)) ?? { id: String(row.orgId), name: 'Unknown church' } : null,
      user: look.users.get(String(row.userId)) ?? { id: String(row.userId), name: 'Unknown user', email: '' },
      kind: row.kind,
      process: row.process,
      reason: row.reason,
      exitCode: row.exitCode,
      count: row.count,
      appVersion: row.appVersion,
      os: row.os,
      osVersion: String(system.osVersion ?? ''),
      arch: String(system.arch ?? ''),
      memoryGb: Number(system.memoryGb) || 0,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
    }
  }

  private async lookups(rows: ReportRow[]): Promise<{ churches: Map<string, Named>; users: Map<string, Person> }> {
    const ids = (values: (Types.ObjectId | null)[]): Types.ObjectId[] =>
      [...new Set(values.filter(Boolean).map(String))].map((id) => new Types.ObjectId(id))
    const orgIds = ids(rows.map((row) => row.orgId))
    const userIds = ids(rows.map((row) => row.userId))
    const [orgs, users] = await Promise.all([
      orgIds.length ? this.orgs.find({ _id: { $in: orgIds } }, { name: 1 }).lean() : [],
      userIds.length ? this.users.find({ _id: { $in: userIds } }, { name: 1, email: 1 }).lean() : [],
    ])
    return {
      churches: new Map(orgs.map((org) => [String(org._id), { id: String(org._id), name: org.name }])),
      users: new Map(users.map((user) => [String(user._id), { id: String(user._id), name: user.name, email: user.email }])),
    }
  }
}

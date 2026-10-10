import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import { Organization, type OrganizationDocument } from '../orgs/schemas/organization.schema'
import { UsageDay, type UsageDayDocument } from '../usage/schemas/usage-day.schema'
import { isoDay } from '../usage/usage.service'
import type { DayCount, KeyCount } from './admin.service'

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 25

interface LatestSystem {
  _id: string
  day: string
  orgId: Types.ObjectId | null
  system: Record<string, unknown> | null
}

/**
 * The staff view of usage statistics. Every figure comes from `usage_days`
 * (one row per install per day), so it is all aggregation — nothing here
 * writes. Windows are whole days; "active" means the install sent any row.
 */
@Injectable()
export class UsageAdminService {
  constructor(
    @InjectModel(UsageDay.name) private readonly days: Model<UsageDayDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
  ) {}

  async overview(windowDays: number, now = new Date()): Promise<unknown> {
    const since = dayAgo(now, windowDays - 1)
    const desktop = { source: 'desktop', day: { $gte: since } }
    const [activeByDay, dau, wau, mau, churches, latest, features, featureByDay, errors, errorsByVersion, pages, pageByDay] =
      await Promise.all([
        this.countPerDay(desktop, windowDays, now),
        this.distinct('installId', { source: 'desktop', day: { $gte: dayAgo(now, 0) } }),
        this.distinct('installId', { source: 'desktop', day: { $gte: dayAgo(now, 6) } }),
        this.distinct('installId', { source: 'desktop', day: { $gte: dayAgo(now, 29) } }),
        this.distinct('orgId', desktop),
        this.latestSystems(desktop),
        this.sumMap('counts', desktop),
        this.sumMapPerDay('counts', desktop),
        this.sumMap('errors', desktop),
        this.days.aggregate<{ _id: string; count: number }>([
          { $match: desktop },
          { $project: { appVersion: 1, e: { $objectToArray: '$errors' } } },
          { $unwind: '$e' },
          { $group: { _id: '$appVersion', count: { $sum: '$e.v' } } },
          { $sort: { count: -1 } },
        ]),
        this.sumMap('counts', { source: 'web', day: { $gte: since } }),
        this.countPerDay({ source: 'web', day: { $gte: since } }, windowDays, now, true),
      ])

    const systems = latest.map((row) => row.system ?? {})
    const by = (key: string): KeyCount[] => tally(systems.map((s) => String(s[key] ?? '') || 'unknown'))
    const share = (test: (s: Record<string, unknown>) => boolean): number => systems.filter(test).length

    return {
      days: windowDays,
      active: { today: dau.length, week: wau.length, month: mau.length, churches: churches.filter(Boolean).length },
      activeByDay,
      systems: {
        installs: systems.length,
        os: by('os'),
        osVersion: tally(systems.map((s) => `${s.os ?? '?'} ${s.osVersion ?? ''}`.trim())),
        arch: by('arch'),
        appVersion: by('appVersion'),
        theme: by('theme'),
        bible: by('defaultTranslation'),
        memoryGb: tally(systems.map((s) => (s.memoryGb ? `${s.memoryGb} GB` : 'unknown'))),
        adoption: [
          { key: 'screens', count: share((s) => Number(s.screens) > 0) },
          { key: 'ndi', count: share((s) => Number(s.ndiOutputs) > 0) },
          { key: 'propresenter', count: share((s) => s.propresenter === true) },
          { key: 'transcription', count: share((s) => s.transcription === true) },
          { key: 'automation', count: share((s) => s.automation === true) },
        ],
      },
      features,
      featureByDay,
      errors,
      errorsByVersion: errorsByVersion.map((row) => ({ key: row._id || 'unknown', count: row.count })),
      web: {
        pages: pages.map((row) => ({ key: row.key.replace(/^page:/, ''), count: row.count })),
        viewsByDay: pageByDay,
      },
    }
  }

  /** Per church, most recently active first. */
  async churches(query: { q?: string; page?: number; days?: number }, now = new Date()): Promise<unknown> {
    const page = Math.max(1, query.page ?? 1)
    const since = dayAgo(now, (query.days ?? 30) - 1)
    const rows = await this.days.aggregate<{
      _id: Types.ObjectId
      installs: string[]
      lastActive: string
      versions: string[]
      services: number
      minutes: number
      errors: number
      features: { k: string; v: number }[]
    }>([
      { $match: { source: 'desktop', orgId: { $ne: null }, day: { $gte: since } } },
      {
        $project: {
          orgId: 1,
          installId: 1,
          day: 1,
          appVersion: 1,
          c: { $objectToArray: '$counts' },
          errorTotal: { $sum: { $map: { input: { $objectToArray: '$errors' }, in: '$$this.v' } } },
        },
      },
      {
        $group: {
          _id: '$orgId',
          installs: { $addToSet: '$installId' },
          lastActive: { $max: '$day' },
          versions: { $addToSet: '$appVersion' },
          errors: { $sum: '$errorTotal' },
          c: { $push: '$c' },
        },
      },
      {
        $project: {
          installs: 1,
          lastActive: 1,
          versions: 1,
          errors: 1,
          features: { $reduce: { input: '$c', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } } },
        },
      },
      { $sort: { lastActive: -1 } },
    ])

    const names = await this.orgs.find({ _id: { $in: rows.map((r) => r._id) } }, { name: 1 }).lean().exec()
    const nameById = new Map(names.map((o) => [o._id.toString(), o.name]))
    const needle = query.q?.trim().toLowerCase()
    const items = rows
      .map((row) => {
        const totals = sumPairs(row.features)
        return {
          id: row._id.toString(),
          name: nameById.get(row._id.toString()) ?? 'Unknown church',
          installs: row.installs.length,
          lastActive: row.lastActive,
          versions: row.versions.filter(Boolean).sort(compareVersions).reverse(),
          services: totals.get('service_ended') ?? 0,
          minutes: totals.get('listening_minutes') ?? 0,
          errors: row.errors,
          topFeatures: [...totals.entries()]
            .filter(([key]) => !['service_started', 'service_ended', 'listening_minutes'].includes(key))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([key, count]) => ({ key, count })),
        }
      })
      .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: items.length, page, pageSize: PAGE_SIZE }
  }

  /** One church: its installs, daily activity and what it uses. */
  async church(orgId: string, windowDays: number, now = new Date()): Promise<unknown> {
    if (!isValidObjectId(orgId)) throw new NotFoundException('No such church')
    const org = await this.orgs.findById(orgId, { name: 1 }).lean().exec()
    if (!org) throw new NotFoundException('No such church')
    const id = new Types.ObjectId(orgId)
    const window = { source: 'desktop', orgId: id, day: { $gte: dayAgo(now, windowDays - 1) } }
    const [installs, activity, features, errors] = await Promise.all([
      this.latestSystems({ source: 'desktop', orgId: id }),
      this.sumAllPerDay(window, windowDays, now),
      this.sumMap('counts', window),
      this.sumMap('errors', window),
    ])
    return {
      id: orgId,
      name: org.name,
      days: windowDays,
      installs: installs.map((row) => ({ installId: row._id, lastActive: row.day, system: row.system ?? {} })),
      activity,
      features,
      errors,
    }
  }

  /** For the churches table: last active day and newest app version per church. */
  async lastSeen(orgIds: Types.ObjectId[]): Promise<Map<string, { lastActive: string; appVersion: string }>> {
    const rows = await this.days.aggregate<{ _id: Types.ObjectId; lastActive: string; versions: string[] }>([
      { $match: { source: 'desktop', orgId: { $in: orgIds } } },
      { $group: { _id: '$orgId', lastActive: { $max: '$day' }, versions: { $addToSet: '$appVersion' } } },
    ])
    return new Map(
      rows.map((row) => [
        row._id.toString(),
        { lastActive: row.lastActive, appVersion: row.versions.filter(Boolean).sort(compareVersions).at(-1) ?? '' },
      ]),
    )
  }

  /** Installs active this week, for the admin overview. */
  async activeThisWeek(now = new Date()): Promise<number> {
    return (await this.distinct('installId', { source: 'desktop', day: { $gte: dayAgo(now, 6) } })).length
  }

  private async distinct(field: string, match: object): Promise<unknown[]> {
    return this.days.distinct(field, match)
  }

  /** The newest row per install — its current system. */
  private latestSystems(match: object): Promise<LatestSystem[]> {
    return this.days.aggregate<LatestSystem>([
      { $match: match },
      { $sort: { day: -1 } },
      { $group: { _id: '$installId', day: { $first: '$day' }, orgId: { $first: '$orgId' }, system: { $first: '$system' } } },
      { $sort: { day: -1 } },
    ])
  }

  private async sumMap(field: 'counts' | 'errors', match: object): Promise<KeyCount[]> {
    const rows = await this.days.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $project: { e: { $objectToArray: `$${field}` } } },
      { $unwind: '$e' },
      { $group: { _id: '$e.k', count: { $sum: '$e.v' } } },
      { $sort: { count: -1 } },
    ])
    return rows.map((row) => ({ key: row._id, count: row.count }))
  }

  /** Per feature, per day — for trend lines. */
  private async sumMapPerDay(field: 'counts', match: object): Promise<{ day: string; key: string; count: number }[]> {
    const rows = await this.days.aggregate<{ _id: { day: string; key: string }; count: number }>([
      { $match: match },
      { $project: { day: 1, e: { $objectToArray: `$${field}` } } },
      { $unwind: '$e' },
      { $group: { _id: { day: '$day', key: '$e.k' }, count: { $sum: '$e.v' } } },
      { $sort: { '_id.day': 1 } },
    ])
    return rows.map((row) => ({ day: row._id.day, key: row._id.key, count: row.count }))
  }

  /** Rows (installs) per day, or summed page views when `sumCounts`. Zero-filled. */
  private async countPerDay(match: object, windowDays: number, now: Date, sumCounts = false): Promise<DayCount[]> {
    const rows = await this.days.aggregate<{ _id: string; count: number }>([
      { $match: match },
      sumCounts
        ? { $project: { day: 1, n: { $sum: { $map: { input: { $objectToArray: '$counts' }, in: '$$this.v' } } } } }
        : { $project: { day: 1, n: { $literal: 1 } } },
      { $group: { _id: '$day', count: { $sum: '$n' } } },
    ])
    return fill(rows, windowDays, now)
  }

  /** All counters summed per day (a church's activity line). */
  private async sumAllPerDay(match: object, windowDays: number, now: Date): Promise<DayCount[]> {
    const rows = await this.days.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $project: { day: 1, n: { $sum: { $map: { input: { $objectToArray: '$counts' }, in: '$$this.v' } } } } },
      { $group: { _id: '$day', count: { $sum: '$n' } } },
    ])
    return fill(rows, windowDays, now)
  }
}

function dayAgo(now: Date, days: number): string {
  return isoDay(new Date(now.getTime() - days * DAY_MS))
}

function fill(rows: { _id: string; count: number }[], windowDays: number, now: Date): DayCount[] {
  const counts = new Map(rows.map((row) => [row._id, row.count]))
  return Array.from({ length: windowDays }, (_, i) => {
    const date = dayAgo(now, windowDays - 1 - i)
    return { date, count: counts.get(date) ?? 0 }
  })
}

function tally(values: string[]): KeyCount[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

function sumPairs(pairs: { k: string; v: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const { k, v } of pairs) out.set(k, (out.get(k) ?? 0) + v)
  return out
}

/** Semantic-ish version order: 1.0.10 after 1.0.9. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

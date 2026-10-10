import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import {
  USAGE_DAY,
  USAGE_ERRORS,
  USAGE_FEATURES,
  USAGE_MAX_COUNT,
  USAGE_MAX_DAYS,
  usagePageSection,
  type UsageReport,
  type UsageReportResult,
} from '@contracts/usage'
import { Session, type SessionDocument } from '../auth/schemas/session.schema'
import { UsageDay, type UsageDayDocument } from './schemas/usage-day.schema'

const DAY_MS = 24 * 60 * 60 * 1000
const FEATURES = new Set<string>(USAGE_FEATURES)
const ERRORS = new Set<string>(USAGE_ERRORS)
/** System fields kept; anything else in a report is dropped. */
const SYSTEM_STRINGS = ['os', 'osVersion', 'arch', 'appVersion', 'electronVersion', 'locale', 'defaultTranslation', 'theme'] as const
const SYSTEM_NUMBERS = ['cpuCount', 'memoryGb', 'screens', 'ndiOutputs'] as const
const SYSTEM_FLAGS = ['propresenter', 'transcription', 'automation'] as const

export interface Reporter {
  userId: string
  orgId: string | null
  /** From the access token — never trusted from the report body. */
  deviceId: string
}

@Injectable()
export class UsageService {
  constructor(
    @InjectModel(UsageDay.name) private readonly days: Model<UsageDayDocument>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDocument>,
  ) {}

  /** Stores each reported day (replacing it) and refreshes the install's device record. */
  async report(who: Reporter, body: UsageReport, now = new Date()): Promise<UsageReportResult> {
    if (!who.deviceId) throw new BadRequestException('Usage is reported from a signed-in device')
    if (!Array.isArray(body?.days) || body.days.length > USAGE_MAX_DAYS) {
      throw new BadRequestException(`Send 0–${USAGE_MAX_DAYS} days`)
    }
    const system = cleanSystem(body.system)
    const oldest = isoDay(new Date(now.getTime() - USAGE_MAX_DAYS * DAY_MS))
    // A machine's local date can be a day ahead of UTC.
    const newest = isoDay(new Date(now.getTime() + DAY_MS))
    const userId = new Types.ObjectId(who.userId)
    const orgId = who.orgId && isValidObjectId(who.orgId) ? new Types.ObjectId(who.orgId) : null

    const accepted: string[] = []
    for (const entry of body.days) {
      const day = String(entry?.day ?? '')
      if (!USAGE_DAY.test(day) || day < oldest || day > newest) continue
      await this.days.updateOne(
        { installId: who.deviceId, day },
        {
          $set: {
            source: 'desktop',
            userId,
            orgId,
            counts: cleanCounts(entry.counts, FEATURES),
            errors: cleanCounts(entry.errors, ERRORS),
            system,
            appVersion: system.appVersion,
            os: system.os,
          },
        },
        { upsert: true },
      )
      accepted.push(day)
    }

    // Sign-in stored the device once; keep its version current after updates.
    await this.sessions.updateMany(
      { userId, deviceId: who.deviceId, revokedAt: null },
      {
        $set: {
          'device.os': system.os,
          'device.osVersion': system.osVersion,
          'device.arch': system.arch,
          'device.appVersion': system.appVersion,
          'device.electronVersion': system.electronVersion,
        },
      },
    )
    return { accepted }
  }

  /** One website dashboard page view, counted by section. */
  async page(who: Reporter, path: string, now = new Date()): Promise<void> {
    const section = usagePageSection(String(path ?? ''))
    if (!section) return
    const userId = new Types.ObjectId(who.userId)
    await this.days.updateOne(
      { installId: `web:${who.userId}`, day: isoDay(now) },
      {
        $inc: { [`counts.page:${section}`]: 1 },
        $set: { source: 'web', userId, orgId: who.orgId && isValidObjectId(who.orgId) ? new Types.ObjectId(who.orgId) : null },
      },
      { upsert: true },
    )
  }
}

function cleanCounts(raw: unknown, allowed: Set<string>): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue
    const n = Math.round(Number(value))
    if (Number.isFinite(n) && n > 0) out[key] = Math.min(n, USAGE_MAX_COUNT)
  }
  return out
}

function cleanSystem(raw: unknown): Record<string, string | number | boolean> & { os: string; osVersion: string; arch: string; appVersion: string; electronVersion: string } {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, string | number | boolean> = {}
  for (const key of SYSTEM_STRINGS) out[key] = String(source[key] ?? '').slice(0, 64)
  for (const key of SYSTEM_NUMBERS) {
    const n = Number(source[key])
    out[key] = Number.isFinite(n) ? Math.max(0, Math.min(Math.round(n), 1024)) : 0
  }
  for (const key of SYSTEM_FLAGS) out[key] = source[key] === true
  return out as ReturnType<typeof cleanSystem>
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

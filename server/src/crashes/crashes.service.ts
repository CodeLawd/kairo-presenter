import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import {
  CRASH_KINDS,
  CRASH_MAX_ERROR_CHARS,
  CRASH_MAX_ERRORS,
  CRASH_MAX_LOG_CHARS,
  CRASH_MAX_REPORTS,
  type CrashUpload,
  type CrashUploadResult,
} from '@contracts/crashes'
import type { Reporter } from '../usage/usage.service'
import { CrashReport, type CrashReportDocument } from './schemas/crash-report.schema'

const KINDS = new Set<string>(CRASH_KINDS)
const DAY_MS = 24 * 60 * 60 * 1000
/** Desktop clocks drift; anything further out than this is not a real time. */
const MAX_AGE_MS = 90 * DAY_MS
const MAX_AHEAD_MS = DAY_MS
const SYSTEM_STRINGS = ['os', 'osVersion', 'arch', 'appVersion', 'electronVersion'] as const

@Injectable()
export class CrashesService {
  constructor(@InjectModel(CrashReport.name) private readonly reports: Model<CrashReportDocument>) {}

  /** Stores each report (replacing an earlier copy of it). Malformed reports are skipped, not fatal. */
  async report(who: Reporter, body: CrashUpload, now = new Date()): Promise<CrashUploadResult> {
    if (!who.deviceId) throw new BadRequestException('Crashes are reported from a signed-in device')
    if (!Array.isArray(body?.reports) || body.reports.length > CRASH_MAX_REPORTS) {
      throw new BadRequestException(`Send 0–${CRASH_MAX_REPORTS} reports`)
    }
    const userId = new Types.ObjectId(who.userId)
    const orgId = who.orgId && isValidObjectId(who.orgId) ? new Types.ObjectId(who.orgId) : null

    const accepted: string[] = []
    for (const raw of body.reports) {
      const reportId = clip(raw?.id, 64)
      const kind = String(raw?.kind ?? '')
      const firstAt = time(raw?.firstAt, now)
      const lastAt = time(raw?.lastAt, now)
      if (!reportId || !KINDS.has(kind) || !firstAt || !lastAt) continue
      const system = cleanSystem(raw.system)
      await this.reports.updateOne(
        { installId: who.deviceId, reportId },
        {
          $set: {
            userId,
            orgId,
            kind,
            process: clip(raw.process, 64),
            reason: clip(raw.reason, 32),
            exitCode: Number.isFinite(Number(raw.exitCode)) ? Math.trunc(Number(raw.exitCode)) : 0,
            firstAt,
            lastAt,
            count: Math.max(1, Math.min(Math.round(Number(raw.count) || 1), 1_000)),
            appVersion: system.appVersion,
            os: system.os,
            system,
            windowErrors: (Array.isArray(raw.errors) ? raw.errors : []).slice(-CRASH_MAX_ERRORS).map((e) => clip(e, CRASH_MAX_ERROR_CHARS)),
            log: clip(raw.log, CRASH_MAX_LOG_CHARS),
          },
        },
        { upsert: true },
      )
      accepted.push(reportId)
    }
    return { accepted }
  }
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function time(value: unknown, now: Date): Date | null {
  const at = new Date(String(value ?? ''))
  const ms = at.getTime()
  if (!Number.isFinite(ms) || ms < now.getTime() - MAX_AGE_MS || ms > now.getTime() + MAX_AHEAD_MS) return null
  return at
}

function cleanSystem(raw: unknown): Record<string, unknown> & { os: string; appVersion: string } {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const key of SYSTEM_STRINGS) out[key] = clip(source[key], 64)
  const memory = Number(source.memoryGb)
  out.memoryGb = Number.isFinite(memory) ? Math.max(0, Math.min(Math.round(memory), 4096)) : 0
  const gpu: Record<string, string> = {}
  if (source.gpu && typeof source.gpu === 'object') {
    for (const [key, value] of Object.entries(source.gpu as Record<string, unknown>).slice(0, 40)) {
      gpu[clip(key, 64)] = clip(value, 64)
    }
  }
  out.gpu = gpu
  return out as ReturnType<typeof cleanSystem>
}

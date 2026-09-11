import type {
  SermonBookStat,
  SermonPeriodStats,
  SermonSpeakerStat,
  SermonStats,
  SermonStatsGranularity,
  SermonStatsRange,
  SermonWeekBucket,
} from '@contracts/contracts'
import { tallyBooks } from './scripture-book'

export const WEEK_WINDOW = 12
export const TOP_SPEAKERS = 5
export const TOP_BOOKS = 8
export const STATS_RANGES = ['today', '7d', '4w', '12w', '6m', 'ytd', 'all', 'custom'] as const
export const DAY_MS = 86_400_000
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAILY_LIMIT = 14
const WEEKLY_CAP = 53

export type ResolvedWindow = {
  from: Date | null
  toExclusive: Date | null
  granularity: SermonStatsGranularity
  bucketCount: number
  chartFrom: Date
}

export function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function utcIsoWeekStart(date: Date): Date {
  const day = date.getUTCDay() || 7
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)))
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Monday of an ISO week, as `YYYY-MM-DD`. */
export function mondayOfIsoWeek(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(Date.UTC(year, 0, 4 - (jan4Day - 1)))
  return new Date(week1Monday.getTime() + (week - 1) * 7 * DAY_MS).toISOString().slice(0, 10)
}

export function emptyPeriod(): SermonPeriodStats {
  return { services: 0, durationMs: 0 }
}

export function parseDay(value?: string): Date | null {
  const match = value?.trim().match(DAY)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}

function boundsFromDays(start: Date, endInclusive: Date): ResolvedWindow {
  const from = start <= endInclusive ? start : endInclusive
  const last = start <= endInclusive ? endInclusive : start
  return windowForBounds(from, addUtcDays(last, 1))
}

function windowForBounds(from: Date, toExclusive: Date): ResolvedWindow {
  const days = Math.max(1, Math.round((toExclusive.getTime() - from.getTime()) / DAY_MS))
  if (days <= DAILY_LIMIT) {
    return { from, toExclusive, granularity: 'day', bucketCount: days, chartFrom: from }
  }
  const chartFrom = utcIsoWeekStart(from)
  const lastMonday = utcIsoWeekStart(addUtcDays(toExclusive, -1))
  const weekCount = Math.round((lastMonday.getTime() - chartFrom.getTime()) / (7 * DAY_MS)) + 1
  return {
    from,
    toExclusive,
    granularity: 'week',
    bucketCount: Math.min(Math.max(weekCount, 1), WEEKLY_CAP),
    chartFrom,
  }
}

export function resolveWindow(input: {
  range?: SermonStatsRange
  from?: string
  to?: string
  now: Date
}): ResolvedWindow {
  const now = input.now
  const today = utcDayStart(now)
  const thisMonday = utcIsoWeekStart(now)
  const customFrom = parseDay(input.from)
  const customTo = parseDay(input.to)
  if (customFrom && customTo) return boundsFromDays(customFrom, customTo)

  const range = input.range ?? '7d'
  if (range === 'today') return windowForBounds(today, addUtcDays(today, 1))
  if (range === '7d') return windowForBounds(addUtcDays(today, -6), addUtcDays(today, 1))
  if (range === '4w') return windowForBounds(addUtcDays(thisMonday, -21), addUtcDays(today, 1))
  if (range === '12w') return windowForBounds(addUtcDays(thisMonday, -77), addUtcDays(today, 1))
  if (range === '6m') {
    const from = utcMonthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)))
    return windowForBounds(from, addUtcDays(today, 1))
  }
  if (range === 'ytd') {
    return windowForBounds(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), addUtcDays(today, 1))
  }
  if (range === 'all') {
    return {
      from: null,
      toExclusive: null,
      granularity: 'week',
      bucketCount: WEEK_WINDOW,
      chartFrom: addUtcDays(thisMonday, -11 * 7),
    }
  }
  return windowForBounds(addUtcDays(today, -6), addUtcDays(today, 1))
}

/** Kept for callers that only need the old `{ from, weekCount, chartFrom }` shape. */
export function resolveRange(
  range: SermonStatsRange,
  now: Date,
): { from: Date | null; weekCount: number; chartFrom: Date } {
  const resolved = resolveWindow({ range, now })
  return { from: resolved.from, weekCount: resolved.bucketCount, chartFrom: resolved.chartFrom }
}

/** The equal-length window immediately before `[from, toExclusive)`. */
export function previousWindow(from: Date, toExclusive: Date): { from: Date; to: Date } {
  return { from: new Date(from.getTime() - (toExclusive.getTime() - from.getTime())), to: from }
}

export function speakerNameFilter(speaker?: string): string | null {
  const name = speaker?.trim()
  if (!name) return null
  return name === 'Unnamed' ? '' : name
}

export function fillSeries(
  chartFrom: Date,
  rows: { start: string; services: number; durationMs: number }[],
  bucketCount: number,
  stepDays: number,
): SermonWeekBucket[] {
  const byStart = new Map(rows.map((row) => [row.start, row]))
  const buckets: SermonWeekBucket[] = []
  for (let index = 0; index < bucketCount; index += 1) {
    const start = addUtcDays(chartFrom, index * stepDays).toISOString().slice(0, 10)
    const bucket = byStart.get(start)
    buckets.push({
      weekStart: start,
      services: bucket?.services ?? 0,
      durationMs: bucket?.durationMs ?? 0,
    })
  }
  return buckets
}

export function fillWeekly(
  now: Date,
  rows: { year: number; week: number; services: number; durationMs: number }[],
  weekCount = WEEK_WINDOW,
): SermonWeekBucket[] {
  const thisMonday = utcIsoWeekStart(now)
  const chartFrom = addUtcDays(thisMonday, -(weekCount - 1) * 7)
  return fillSeries(
    chartFrom,
    rows.map((row) => ({
      start: mondayOfIsoWeek(row.year, row.week),
      services: row.services,
      durationMs: row.durationMs,
    })),
    weekCount,
    7,
  )
}

function displaySpeaker(name: string): string {
  return name.trim() || 'Unnamed'
}

export function assembleStats(input: {
  totals?: {
    services: number
    recapsReady: number
    recapsFailed: number
    recapsPending: number
    totalDurationMs: number
    totalWords: number
    scripturePassages: number
    sharedLinks: number
  }
  previous?: SermonPeriodStats
  weekly: { start: string; services: number; durationMs: number }[]
  weekCount?: number
  chartFrom?: Date
  granularity?: SermonStatsGranularity
  speakers: { name: string; services: number; durationMs: number }[]
  speakerNames?: string[]
  references: string[]
  now: Date
}): SermonStats {
  const totals = input.totals ?? {
    services: 0,
    recapsReady: 0,
    recapsFailed: 0,
    recapsPending: 0,
    totalDurationMs: 0,
    totalWords: 0,
    scripturePassages: 0,
    sharedLinks: 0,
  }
  const speakers: SermonSpeakerStat[] = input.speakers
    .map((row) => ({
      name: displaySpeaker(row.name),
      services: row.services,
      durationMs: row.durationMs,
    }))
    .slice(0, TOP_SPEAKERS)
  const scriptureBooks: SermonBookStat[] = tallyBooks(input.references).slice(0, TOP_BOOKS)
  const speakerNames = [...new Set((input.speakerNames ?? []).map(displaySpeaker))].sort((a, b) => {
    if (a === 'Unnamed') return 1
    if (b === 'Unnamed') return -1
    return a.localeCompare(b)
  })
  const granularity = input.granularity ?? 'week'
  const weekCount = input.weekCount ?? WEEK_WINDOW
  const chartFrom =
    input.chartFrom ??
    addUtcDays(utcIsoWeekStart(input.now), -(weekCount - 1) * (granularity === 'day' ? 1 : 7))

  return {
    ...totals,
    averageDurationMs: totals.services > 0 ? Math.round(totals.totalDurationMs / totals.services) : 0,
    previous: input.previous ?? emptyPeriod(),
    granularity,
    weekly: fillSeries(chartFrom, input.weekly, weekCount, granularity === 'day' ? 1 : 7),
    speakers,
    scriptureBooks,
    speakerNames,
  }
}

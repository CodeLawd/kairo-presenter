/**
 * Sermon shapes come from the shared wire contract, not a local copy.
 *
 * `@contracts/*` points at `src/lib/cloud/` in the repo root — the same alias
 * the Nest server uses. That file is types-only by design, so these are
 * `import type` and erase at compile time; Turbopack never has to resolve a
 * path outside this project's pinned root.
 */
import type {
  PublicSermonPayload,
  SermonBookStat,
  SermonDetail,
  SermonListItem,
  SermonListPage,
  SermonSpeakerStat,
  SermonStats,
  SermonStatsGranularity,
  SermonStatsRange,
  SermonStatus,
  SermonSummary,
  SermonTranscriptPayload,
  SummaryErrorCode,
  SermonWeekBucket,
} from '@contracts/contracts'

export type {
  PublicSermonPayload as PublicSermon,
  SermonBookStat,
  SermonDetail,
  SermonListItem,
  SermonListPage,
  SermonSpeakerStat,
  SermonStats,
  SermonStatsGranularity,
  SermonStatsRange,
  SermonStatus,
  SermonSummary,
  SermonTranscriptPayload,
  SummaryErrorCode,
  SermonWeekBucket,
}

export const STATS_RANGE_OPTIONS: { key: Exclude<SermonStatsRange, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '4w', label: 'Last 4 weeks' },
  { key: '12w', label: 'Last 12 weeks' },
  { key: '6m', label: 'Last 6 months' },
  { key: 'ytd', label: 'This year' },
  { key: 'all', label: 'All time' },
]

export function localIsoDay(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addLocalDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return localIsoDay(new Date(year, month - 1, day + days))
}

function localMonday(date: Date): Date {
  const weekday = date.getDay() || 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (weekday - 1))
}

export function boundsForRange(
  range: SermonStatsRange,
  now = new Date(),
): { from?: string; to?: string } {
  const to = localIsoDay(now)
  if (range === 'today') return { from: to, to }
  if (range === '7d') return { from: addLocalDays(to, -6), to }
  if (range === '4w') {
    const monday = localMonday(now)
    return { from: localIsoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 21)), to }
  }
  if (range === '12w') {
    const monday = localMonday(now)
    return { from: localIsoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 77)), to }
  }
  if (range === '6m') {
    return { from: localIsoDay(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to }
  }
  if (range === 'ytd') return { from: `${now.getFullYear()}-01-01`, to }
  return {}
}

export function statsQuery(input: {
  range: SermonStatsRange
  from?: string
  to?: string
  speaker?: string
}): string {
  const params = new URLSearchParams()
  params.set('range', input.range)
  if (input.range !== 'all') {
    const bounds =
      input.from && input.to ? { from: input.from, to: input.to } : boundsForRange(input.range)
    if (bounds.from && bounds.to) {
      params.set('from', bounds.from)
      params.set('to', bounds.to)
    }
  }
  if (input.speaker) params.set('speaker', input.speaker)
  return params.toString()
}

export function statsRangeLabel(range: SermonStatsRange, from?: string, to?: string): string {
  if (range === 'custom' && from && to) {
    if (from === to) return formatShortDay(from)
    return `${formatShortDay(from)} – ${formatShortDay(to)}`
  }
  return STATS_RANGE_OPTIONS.find((item) => item.key === range)?.label ?? 'Last 7 days'
}

function formatShortDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** 1_240_000 → "1.2M". For dashboard totals that would otherwise run to seven figures. */
export function formatCompactCount(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** Milliseconds of audio → "45m", "8.5h", "120h". One glance, no mental math. */
export function formatHours(ms: number): string {
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.round(ms / 60_000)}m`
  return `${Number(hours.toFixed(hours < 10 ? 1 : 0))}h`
}

export function formatServiceDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatWeekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

export function formatBucketLabel(start: string, granularity: SermonStatsGranularity): string {
  if (granularity === 'day') {
    return new Date(`${start}T12:00:00.000Z`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
    })
  }
  return formatWeekLabel(start)
}

/** Whole hours to one decimal, for chart axes. */
export function hoursNumber(ms: number): number {
  return Number((ms / 3_600_000).toFixed(1))
}

export function formatCountDelta(current: number, previous: number): string {
  if (current === 0 && previous === 0) return 'None in this period'
  if (previous === 0) return `${current} this period`
  const delta = current - previous
  if (delta === 0) return 'Same as previous'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta} vs previous`
}

export function shareUrl(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/s/${token}`
}

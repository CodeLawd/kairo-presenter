/**
 * Usage statistics, shared by the desktop app (which counts) and the API
 * (which validates and stores). Counts and system facts only — never content:
 * no transcripts, lyrics, verse text, song titles or file names.
 */

/** Every counter the desktop app keeps. The API refuses any other key. */
export const USAGE_FEATURES = [
  'service_started',
  'service_ended',
  'listening_minutes',
  'scripture_manual',
  'scripture_auto',
  'scripture_search',
  'lyrics_slide',
  'song_import',
  'song_online_search',
  'media_live',
  'document_page',
  'timer_start',
  'message_shown',
  'output_clear',
  'bible_download',
  'recap_uploaded',
] as const
export type UsageFeature = (typeof USAGE_FEATURES)[number]

/** What went wrong, by kind only — no message or stack ever leaves the machine. */
export const USAGE_ERRORS = ['uncaught', 'unhandled_rejection', 'renderer_gone', 'child_process_gone'] as const
export type UsageErrorKind = (typeof USAGE_ERRORS)[number]

/** The machine and setup, as of the report. */
export interface UsageSystem {
  os: string
  osVersion: string
  arch: string
  appVersion: string
  electronVersion: string
  locale: string
  cpuCount: number
  memoryGb: number
  /** Enabled screen outputs. */
  screens: number
  /** Enabled NDI outputs. */
  ndiOutputs: number
  propresenter: boolean
  /** A Deepgram key is set, so live transcription can run. */
  transcription: boolean
  /** Scripture automation (auto-present) is on. */
  automation: boolean
  defaultTranslation: string
  theme: string
}

export interface UsageDayReport {
  /** Local calendar day on the machine, YYYY-MM-DD. */
  day: string
  counts: Partial<Record<UsageFeature, number>>
  errors: Partial<Record<UsageErrorKind, number>>
}

/** POST /v1/usage/report. Full per-day totals, so re-sending a day is harmless. */
export interface UsageReport {
  /** Stable per install (the same device id the session uses). */
  installId: string
  days: UsageDayReport[]
  system: UsageSystem
}

/** Days the API stored; the desktop drops them from its local queue. */
export interface UsageReportResult {
  accepted: string[]
}

export const USAGE_DAY = /^\d{4}-\d{2}-\d{2}$/
export const USAGE_MAX_DAYS = 31
export const USAGE_MAX_COUNT = 100_000

/**
 * The dashboard section a page belongs to — ids and slugs dropped, so
 * `/dashboard/sermons/6612…` and `/dashboard/sermons/abc` count as one page.
 * Null for anything outside the dashboard and admin console.
 */
export function usagePageSection(path: string): string | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  const match = /^\/(dashboard|admin)(\/[a-z-]+)?/.exec(clean)
  return match ? `/${match[1]}${match[2] ?? ''}` : null
}

/** Shapes returned by the API's /v1/admin routes (Kairo staff only). */

export type PlatformRole = 'superadmin' | 'admin'

export interface AdminTeamMember {
  /** Null for a superadmin email that has no account yet. */
  id: string | null
  email: string
  name: string
  role: PlatformRole
  status: string
}

export const ROLE_NAMES: Record<PlatformRole, string> = { superadmin: 'Superadmin', admin: 'Admin' }

export interface DayCount { date: string; count: number }
export interface KeyCount { key: string; count: number }

export interface AdminOverview {
  users: { total: number; verified: number; disabled: number; new7d: number; new30d: number }
  churches: { total: number; new30d: number }
  sermons: { total: number; last30d: number }
  activeInstalls30d: number
  /** Installs that sent usage statistics in the last 7 days. */
  activeThisWeek: number
  downloads: { total: number; last30d: number }
  signups: DayCount[]
}

export interface AdminUser {
  id: string
  email: string
  name: string
  verified: boolean
  status: 'active' | 'disabled'
  signIn: 'google' | 'email'
  platformRole: PlatformRole | null
  createdAt: string | null
  lastLoginAt: string | null
  churches: { id: string; name: string; role: string }[]
}

export interface AdminChurch {
  id: string
  name: string
  owner: { id: string; email: string; name: string } | null
  members: number
  sermons: number
  timezone: string
  createdAt: string | null
  /** From usage statistics: last day a desktop reported, and its newest app version. */
  lastActive: string | null
  appVersion: string | null
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export interface AdminDownloads {
  days: number
  total: number
  unavailable: number
  byDay: DayCount[]
  byPlatform: KeyCount[]
  bySource: KeyCount[]
  byVersion: KeyCount[]
  byCountry: KeyCount[]
  /** GitHub's per-file counters — include in-app updates. Null when GitHub is unreachable. */
  github: { version: string; file: string; count: number }[] | null
}

export const PLATFORM_NAMES: Record<string, string> = {
  'mac-arm64': 'Mac · Apple silicon',
  'mac-x64': 'Mac · Intel',
  'windows-x64': 'Windows',
  'linux-x64': 'Linux',
}

export const SOURCE_NAMES: Record<string, string> = {
  home: 'Home page',
  dashboard: 'Dashboard',
  onboarding: 'Account setup',
  direct: 'Direct link',
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDate(value: string | null): string {
  return value ? dateFormat.format(new Date(value)) : '—'
}

export function formatRelative(value: string | null): string {
  if (!value) return 'Never'
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return formatDate(value)
}

// ─── Usage statistics ────────────────────────────────────────────────────────

export interface AdminUsage {
  days: number
  active: { today: number; week: number; month: number; churches: number }
  activeByDay: DayCount[]
  systems: {
    installs: number
    os: KeyCount[]
    osVersion: KeyCount[]
    arch: KeyCount[]
    appVersion: KeyCount[]
    theme: KeyCount[]
    bible: KeyCount[]
    memoryGb: KeyCount[]
    adoption: KeyCount[]
  }
  features: KeyCount[]
  featureByDay: { day: string; key: string; count: number }[]
  errors: KeyCount[]
  errorsByVersion: KeyCount[]
  web: { pages: KeyCount[]; viewsByDay: DayCount[] }
}

export interface AdminUsageChurch {
  id: string
  name: string
  installs: number
  lastActive: string
  versions: string[]
  services: number
  minutes: number
  errors: number
  topFeatures: KeyCount[]
}

export interface AdminUsageChurchDetail {
  id: string
  name: string
  days: number
  installs: { installId: string; lastActive: string; system: Record<string, string | number | boolean> }[]
  activity: DayCount[]
  features: KeyCount[]
  errors: KeyCount[]
}

export const FEATURE_NAMES: Record<string, string> = {
  service_started: 'Services started',
  service_ended: 'Services ended',
  listening_minutes: 'Minutes transcribed',
  scripture_manual: 'Verses sent by hand',
  scripture_auto: 'Verses sent automatically',
  scripture_search: 'Scripture searches',
  lyrics_slide: 'Lyric slides shown',
  song_import: 'Songs imported',
  song_online_search: 'Online song searches',
  media_live: 'Media put live',
  document_page: 'Document pages shown',
  timer_start: 'Timers started',
  message_shown: 'Messages shown',
  output_clear: 'Screens cleared',
  bible_download: 'Bibles downloaded',
  recap_uploaded: 'Recaps published',
}

export const ERROR_NAMES: Record<string, string> = {
  uncaught: 'App error',
  unhandled_rejection: 'Unhandled async error',
  renderer_gone: 'Window crashed',
  child_process_gone: 'Helper process crashed',
}

export const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export const ADOPTION_NAMES: Record<string, string> = {
  screens: 'Audience screens',
  ndi: 'NDI output',
  propresenter: 'ProPresenter',
  transcription: 'Live transcription',
  automation: 'Scripture automation',
}

/** "2026-10-09" → "9 Oct 2026"; also accepts full ISO dates. */
export function formatDay(value: string | null): string {
  if (!value) return '—'
  return formatDate(value.length === 10 ? `${value}T12:00:00` : value)
}

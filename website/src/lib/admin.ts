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

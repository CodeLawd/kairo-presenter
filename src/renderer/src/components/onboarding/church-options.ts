/** Roles that actually sit at a church tech desk. `Other` opens a free-text field. */
export const CHURCH_ROLES = [
  'Media operator',
  'Lyrics operator',
  'Tech director',
  'Worship leader',
  'Pastor',
  'Volunteer',
  'Other',
] as const

export type ChurchRole = (typeof CHURCH_ROLES)[number]

/** Detected zone — used as the default and always present in the list. */
export const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'

/**
 * Every IANA zone the runtime knows, detected one first.
 *
 * `Intl.supportedValuesOf` is the only list that cannot drift from the zones
 * this Chromium can actually resolve; the fallback covers the handful of
 * runtimes without it rather than shipping a hand-maintained table.
 */
export function timezoneOptions(): string[] {
  const all =
    typeof Intl.supportedValuesOf === 'function'
      ? (Intl.supportedValuesOf('timeZone') as string[])
      : FALLBACK_ZONES
  const rest = all.filter((zone) => zone !== LOCAL_ZONE)
  return [LOCAL_ZONE, ...rest]
}

const FALLBACK_ZONES = [
  'UTC',
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Manila',
  'Asia/Singapore',
  'Australia/Sydney',
]

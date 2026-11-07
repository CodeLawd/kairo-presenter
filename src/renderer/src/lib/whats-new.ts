import { changelog, type ChangelogEntry } from '../../../../website/src/lib/changelog'

/** Fires on the window to open the sheet (menu item, dev tools). */
export const WHATS_NEW_EVENT = 'kairo:whats-new'

export const CHANGELOG_URL = 'https://kairopresenter.com/changelog'

/** -1, 0 or 1, comparing dotted numeric versions ("1.0.9" < "1.0.10"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * The entry to show after updating from `lastSeen` to `current`: the newest
 * one in (lastSeen, current]. Null on a fresh install ('' — setup comes first)
 * or when no release in between has a changelog entry.
 */
export function entryAfterUpdate(
  lastSeen: string,
  current: string,
  entries: ChangelogEntry[] = changelog,
): ChangelogEntry | null {
  if (!lastSeen || compareVersions(current, lastSeen) <= 0) return null
  return (
    entries.find(
      (e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0,
    ) ?? null
  )
}

/**
 * What the menu item shows. In dev it is the top of the changelog even when
 * that version isn't released yet — that is how a draft entry is previewed.
 */
export function entryOnRequest(current: string, dev: boolean, entries: ChangelogEntry[] = changelog): ChangelogEntry | null {
  if (dev) return entries[0] ?? null
  return entries.find((e) => compareVersions(e.version, current) <= 0) ?? null
}

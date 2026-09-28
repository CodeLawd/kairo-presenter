// ─── Song usage — what was sung, for CCLI reporting (standalone phase 3, E13) ──
// Pure — no Node/DOM APIs. The main process records one entry per song per
// service; this module owns the de-duplication rule, the date filter and the
// CSV, so all three can be tested without Electron.

export interface SongUsageEntry {
  songId: string
  title: string
  artist: string
  ccliNumber: string
  copyright: string
  /** Epoch ms of the first slide pushed in this service. */
  at: number
}

/**
 * A song pushed again within this window belongs to the same service — the
 * chorus coming back, a reprise — and is not a second use.
 */
export const SONG_USAGE_DEDUPE_MS = 4 * 60 * 60 * 1000

/** Whether pushing `songId` at `now` is a new use. */
export function isNewSongUse(entries: readonly SongUsageEntry[], songId: string, now: number): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.songId !== songId) continue
    return now - entry.at >= SONG_USAGE_DEDUPE_MS
  }
  return true
}

/** Entries in [from, to), oldest first. */
export function songUsageBetween(entries: readonly SongUsageEntry[], from: number, to: number): SongUsageEntry[] {
  return entries.filter((e) => e.at >= from && e.at < to).sort((a, b) => a.at - b.at)
}

export interface SongUsageSummaryRow {
  songId: string
  title: string
  artist: string
  ccliNumber: string
  copyright: string
  uses: number
  lastUsed: number
}

/** One row per song, most used first — what a CCLI report asks for. */
export function summarizeSongUsage(entries: readonly SongUsageEntry[]): SongUsageSummaryRow[] {
  const rows = new Map<string, SongUsageSummaryRow>()
  for (const e of entries) {
    const row = rows.get(e.songId)
    if (row) {
      row.uses++
      if (e.at > row.lastUsed) {
        row.lastUsed = e.at
        // The latest metadata wins — a CCLI number added later is the right one.
        row.title = e.title
        row.artist = e.artist
        row.ccliNumber = e.ccliNumber || row.ccliNumber
        row.copyright = e.copyright || row.copyright
      }
    } else {
      rows.set(e.songId, {
        songId: e.songId,
        title: e.title,
        artist: e.artist,
        ccliNumber: e.ccliNumber,
        copyright: e.copyright,
        uses: 1,
        lastUsed: e.at,
      })
    }
  }
  return [...rows.values()].sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title))
}

function csvCell(value: string | number): string {
  const text = String(value)
  // Guard against spreadsheet formula injection from song titles.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Local `yyyy-mm-dd` — also the value format of `<input type="date">`. */
export function isoDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Per-use CSV (one line per song per service), local dates. */
export function songUsageCsv(entries: readonly SongUsageEntry[]): string {
  const header = ['Date', 'Title', 'Artist', 'CCLI Song #', 'Copyright']
  const lines = [header.join(',')]
  for (const e of entries) {
    lines.push([isoDate(e.at), e.title, e.artist, e.ccliNumber, e.copyright].map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

export function normalizeSongUsageEntries(raw: unknown): SongUsageEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: SongUsageEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.songId !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) continue
    entries.push({
      songId: r.songId,
      title: typeof r.title === 'string' ? r.title : '',
      artist: typeof r.artist === 'string' ? r.artist : '',
      ccliNumber: typeof r.ccliNumber === 'string' ? r.ccliNumber : '',
      copyright: typeof r.copyright === 'string' ? r.copyright : '',
      at: r.at,
    })
  }
  return entries
}

export const SONG_USAGE = {
  LIST: 'songUsage:list',
  EXPORT: 'songUsage:export',
  CLEAR: 'songUsage:clear',
} as const

export interface SongUsageAPI {
  /** Entries in [from, to). */
  list: (from: number, to: number) => Promise<SongUsageEntry[]>
  /** Save dialog + CSV. Resolves to the saved path, or null when cancelled. */
  exportCsv: (from: number, to: number) => Promise<string | null>
  /** Forget everything before `before`. */
  clear: (before: number) => Promise<void>
}

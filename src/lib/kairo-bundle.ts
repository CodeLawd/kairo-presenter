/**
 * `.kairo` — the one file type Kairo exports and imports, like ProPresenter's
 * `.pro`.
 *
 * A bundle is self-contained: songs carry their full lyrics, a setlist carries
 * the songs it orders, and a scripture playlist carries its verse text. The
 * receiving Kairo needs no shared library, Bible, or API key to use it.
 *
 * Plain JSON on purpose — a bundle can be read, diffed, or rescued in any text
 * editor, and nothing here is large enough to need compression.
 */

import type { DuplicateMatch } from './lyrics-duplicate'
import type { LyricsSong, ScriptureVerse, SermonPlan, SermonScriptureItem } from './ipc'
import { parseSongFile, slugifyTitle } from './workspace'

export const KAIRO_BUNDLE_EXT = '.kairo'
export const KAIRO_BUNDLE_VERSION = 1
/** Far above any real library; stops a wrong file being read into memory. */
export const KAIRO_BUNDLE_MAX_BYTES = 50 * 1024 * 1024

export type KairoBundleKind = 'songs' | 'setlist' | 'scripture-playlist'

export interface KairoBundle {
  kairoBundle: number
  kind: KairoBundleKind
  /** What the operator sees: the setlist or playlist name, or "12 songs". */
  name: string
  exportedAt: number
  appVersion?: string
  songs: LyricsSong[]
  /** Only for `setlist`. Ids refer to songs in this bundle, in service order. */
  setlist?: { name: string; songIds: string[] }
  /** Only for `scripture-playlist`. */
  playlist?: SermonPlan
}

// ─── Building ─────────────────────────────────────────────────────────────────

function base(kind: KairoBundleKind, name: string, appVersion?: string): KairoBundle {
  return {
    kairoBundle: KAIRO_BUNDLE_VERSION,
    kind,
    name,
    exportedAt: Date.now(),
    ...(appVersion ? { appVersion } : {}),
    songs: [],
  }
}

export function songsBundle(name: string, songs: LyricsSong[], appVersion?: string): KairoBundle {
  return { ...base('songs', name, appVersion), songs }
}

export function setlistBundle(
  name: string,
  orderedSongs: LyricsSong[],
  appVersion?: string,
): KairoBundle {
  return {
    ...base('setlist', name, appVersion),
    songs: orderedSongs,
    setlist: { name, songIds: orderedSongs.map((song) => song.id) },
  }
}

export function playlistBundle(plan: SermonPlan, appVersion?: string): KairoBundle {
  return { ...base('scripture-playlist', plan.title, appVersion), playlist: plan }
}

export function serializeBundle(bundle: KairoBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}

/** A safe default file name, e.g. "Sunday service" → "Sunday-service.kairo". */
export function bundleFileName(name: string): string {
  return `${slugifyTitle(name) || 'kairo-export'}${KAIRO_BUNDLE_EXT}`
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function coerceSongs(raw: unknown): LyricsSong[] {
  if (!Array.isArray(raw)) return []
  const songs: LyricsSong[] = []
  const seen = new Set<string>()
  raw.forEach((entry, index) => {
    // Reuse the song-file reader: same coercion rules as a hand-edited file.
    const song = parseSongFile(JSON.stringify(entry ?? null), `imported-${index + 1}`)
    if (!song || seen.has(song.id)) return
    seen.add(song.id)
    songs.push(song)
  })
  return songs
}

function coerceVerse(raw: unknown): ScriptureVerse | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const chapter = Number(obj.chapter)
  const verse = Number(obj.verse)
  const text = asString(obj.text)
  if (!asString(obj.book) || !Number.isFinite(chapter) || !Number.isFinite(verse) || !text) return null
  return { book: asString(obj.book), chapter, verse, text }
}

function coerceItem(raw: unknown, index: number): SermonScriptureItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const reference = asString(obj.reference)
  if (!reference) return null
  const verses = Array.isArray(obj.verses)
    ? obj.verses.map(coerceVerse).filter((v): v is ScriptureVerse => v !== null)
    : []
  return {
    id: asString(obj.id) || `item-${index + 1}`,
    reference,
    translation: asString(obj.translation, 'KJV') || 'KJV',
    verses,
    // Verse text travels with the item, so it is usable wherever it lands.
    available: verses.length > 0,
    ...(verses.length === 0 ? { error: 'No verse text in the imported file' } : {}),
  }
}

function coercePlan(raw: unknown): SermonPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const items = Array.isArray(obj.items)
    ? obj.items.map(coerceItem).filter((item): item is SermonScriptureItem => item !== null)
    : []
  const now = Date.now()
  return {
    id: asString(obj.id) || `plan-${now}`,
    title: asString(obj.title) || 'Imported playlist',
    sourceFileName: asString(obj.sourceFileName),
    items,
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now,
  }
}

/**
 * Reads a `.kairo` file — or a lone `.song.json` from a Songs folder — into a
 * validated bundle. Throws with a message fit to show the operator.
 */
export function parseKairoBundle(raw: string): KairoBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('This file is not a Kairo export — it could not be read.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This file is not a Kairo export.')
  }
  const obj = parsed as Record<string, unknown>

  // A single song file from another machine's Songs folder.
  if (typeof obj.kairoSong === 'number') {
    const songs = coerceSongs([obj])
    if (songs.length === 0) throw new Error('This song file has no usable song in it.')
    return { ...songsBundle(songs[0].title, songs), exportedAt: 0 }
  }

  if (typeof obj.kairoBundle !== 'number') throw new Error('This file is not a Kairo export.')
  if (obj.kairoBundle > KAIRO_BUNDLE_VERSION) {
    throw new Error('This file was made by a newer version of Kairo. Update Kairo to open it.')
  }

  const kind = obj.kind
  if (kind !== 'songs' && kind !== 'setlist' && kind !== 'scripture-playlist') {
    throw new Error('This Kairo file contains something this version cannot import.')
  }

  const songs = coerceSongs(obj.songs)
  const bundle: KairoBundle = {
    kairoBundle: KAIRO_BUNDLE_VERSION,
    kind,
    name: asString(obj.name) || 'Kairo export',
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    ...(asString(obj.appVersion) ? { appVersion: asString(obj.appVersion) } : {}),
    songs,
  }

  if (kind === 'setlist') {
    const rawList = (obj.setlist ?? {}) as Record<string, unknown>
    const known = new Set(songs.map((song) => song.id))
    const songIds = Array.isArray(rawList.songIds)
      ? rawList.songIds.map((id) => String(id)).filter((id) => known.has(id))
      : songs.map((song) => song.id)
    bundle.setlist = { name: asString(rawList.name) || bundle.name, songIds }
  }

  if (kind === 'scripture-playlist') {
    const plan = coercePlan(obj.playlist)
    if (!plan) throw new Error('This playlist file has no playlist in it.')
    bundle.playlist = plan
    return bundle
  }

  if (songs.length === 0) throw new Error('This Kairo file has no songs in it.')
  return bundle
}

/**
 * Combines several opened files into one import — how a folder of
 * `.song.json` files, or a handful of exports, comes in at once. Setlists and
 * playlists carry a name and an order of their own, so those import singly.
 */
export function mergeKairoBundles(bundles: KairoBundle[]): KairoBundle {
  if (bundles.length === 0) throw new Error('No files to import.')
  if (bundles.length === 1) return bundles[0]
  if (bundles.some((bundle) => bundle.kind !== 'songs')) {
    throw new Error('Song and scripture playlists import one file at a time. Select just that file.')
  }
  const seen = new Set<string>()
  const songs: LyricsSong[] = []
  for (const bundle of bundles) {
    for (const song of bundle.songs) {
      if (seen.has(song.id)) continue
      seen.add(song.id)
      songs.push(song)
    }
  }
  return { ...songsBundle(`${songs.length} song${songs.length === 1 ? '' : 's'}`, songs), exportedAt: 0 }
}

// ─── IPC contract ─────────────────────────────────────────────────────────────

export const TRANSFER = {
  EXPORT: 'transfer:export',
  PICK_AND_PREVIEW: 'transfer:pickAndPreview',
  COMMIT: 'transfer:commit',
  DISCARD: 'transfer:discard',
  /** Renderer → main: ready to receive files opened from Finder/Explorer. */
  READY: 'transfer:ready',
  /** Main → renderer: a `.kairo` file was opened from outside the app. */
  OPENED: 'transfer:opened',
} as const

export type TransferExportRequest =
  | { kind: 'songs'; songIds: string[]; name?: string }
  | { kind: 'library' }
  | { kind: 'setlist'; listId: string }
  | { kind: 'playlist'; planId: string }

export interface TransferExportResult {
  saved: boolean
  fileName?: string
}

export interface TransferSongPreview {
  id: string
  title: string
  artist: string
  sectionCount: number
  /** The library song this one is a copy of, or null when it is new. */
  duplicate: DuplicateMatch | null
}

export interface TransferPreview {
  /** Main keeps the parsed bundle under this token until commit or discard. */
  token: string
  fileName: string
  kind: KairoBundleKind
  name: string
  exportedAt: number
  songs: TransferSongPreview[]
  setlist?: { name: string; songCount: number }
  playlist?: { title: string; itemCount: number; exists: boolean }
  /** Files among a multi-file pick that could not be read. */
  skippedFiles?: { fileName: string; error: string }[]
}

/** What to do with a song. `add` for new songs; the rest for duplicates. */
export type SongImportChoice = 'add' | 'skip' | 'replace' | 'keep-both'
export type PlaylistImportChoice = 'replace' | 'keep-both' | 'skip'

export interface TransferCommitRequest {
  token: string
  songs: Record<string, SongImportChoice>
  createSetlist: boolean
  playlist?: PlaylistImportChoice
}

export interface TransferCommitResult {
  added: number
  replaced: number
  skipped: number
  setlistName?: string
  playlistTitle?: string
}

export interface TransferAPI {
  /** Shows a save dialog and writes the file. `saved: false` when cancelled. */
  export: (request: TransferExportRequest) => Promise<TransferExportResult>
  /** Shows an open dialog (several files allowed); null when cancelled. */
  pickAndPreview: () => Promise<TransferPreview | null>
  commit: (request: TransferCommitRequest) => Promise<TransferCommitResult>
  discard: (token: string) => Promise<void>
  ready: () => void
  onOpened: (callback: (result: TransferPreview | { error: string; fileName: string }) => void) => () => void
}

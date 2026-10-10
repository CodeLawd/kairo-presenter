/**
 * The Kairo workspace: one folder on disk that owns everything an operator
 * would want to back up, copy to the second machine, or open in Finder.
 *
 *   Kairo Presenter/
 *     Songs/    one .song.json per song — the library's source of truth
 *     Media/    backgrounds the media dock indexes
 *
 * Songs live as files rather than only in SQLite so the library survives a
 * lost database, travels with a copied folder, and can be edited or
 * version-controlled outside the app. The database is rebuilt from these
 * files on launch, which makes the folder authoritative: delete a file and
 * the song is gone; drop one in and it appears.
 */

import { normalizeHotkey } from './lyrics-hotkeys'
import type { LyricsSong, LyricsSongSection, LyricsSectionType, LyricsSource } from './ipc'

/** Folder created under the user's Documents directory by default. */
export const WORKSPACE_FOLDER_NAME = 'Kairo Presenter'
export const SONGS_DIR_NAME = 'Songs'
export const MEDIA_DIR_NAME = 'Media'

/** Extension for one song on disk. Double extension keeps `.json` tooling working. */
export const SONG_FILE_EXT = '.song.json'

/** Schema version stored in every song file, so a future format can migrate. */
export const SONG_FILE_VERSION = 1

export interface WorkspaceInfo {
  /** Absolute path to the workspace root. */
  root: string
  songsDir: string
  mediaDir: string
  /** True when `root` is the built-in Documents location, not an operator choice. */
  isDefault: boolean
  /** False when the folders could not be created — `error` says why. */
  ready: boolean
  error: string | null
}

/** What a pending media-folder adoption would do, for the prompt in Settings. */
export interface MediaFolderMigration {
  /** The media folder currently indexed, '' when none was ever chosen. */
  currentFolder: string
  /** Where the workspace would like it: `<root>/Media`. */
  targetFolder: string
  /** True when the current folder is set and sits outside the workspace. */
  needed: boolean
  /** Files that would be moved. -1 when the folder could not be read. */
  fileCount: number
}

const SECTION_TYPES: LyricsSectionType[] = [
  'verse', 'chorus', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro', 'ending',
]

const SOURCES: LyricsSource[] = ['usr', 'text', 'ccli', 'propresenter', 'genius', 'lrclib', 'web']

/**
 * Filesystem-safe stem for a song title.
 *
 * Titles carry slashes ("Oh Come / All Ye Faithful"), colons and non-Latin
 * script; the id suffix keeps the name unique regardless of what survives.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'song'
}

/** `Way-Maker__song-1712-ab12.song.json` — readable, unique, sorts by title. */
export function songFileName(song: Pick<LyricsSong, 'id' | 'title'>): string {
  return `${slugifyTitle(song.title)}__${song.id}${SONG_FILE_EXT}`
}

/** The song id encoded in a file name, or null when the name is not ours. */
export function songIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(SONG_FILE_EXT)) return null
  const stem = fileName.slice(0, -SONG_FILE_EXT.length)
  // The slug never contains '_', so the FIRST '__' is the separator even when
  // the id itself carries one.
  const idx = stem.indexOf('__')
  const id = idx >= 0 ? stem.slice(idx + 2) : stem
  return id.trim() || null
}

export function isSongFileName(fileName: string): boolean {
  return fileName.endsWith(SONG_FILE_EXT) && !fileName.startsWith('.')
}

/** Pretty-printed so a song file diffs and edits cleanly by hand. */
export function serializeSongFile(song: LyricsSong): string {
  const payload = {
    kairoSong: SONG_FILE_VERSION,
    id: song.id,
    title: song.title,
    artist: song.artist ?? '',
    copyright: song.copyright ?? '',
    ccliNumber: song.ccliNumber ?? '',
    isFavorite: Boolean(song.isFavorite),
    source: song.source ?? 'text',
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
    sections: song.sections.map((section) => ({
      type: section.type,
      label: section.label,
      lines: section.lines,
      ...(section.lineColors?.some((c) => Boolean(c)) ? { lineColors: section.lineColors } : {}),
      ...(normalizeHotkey(section.hotkey) ? { hotkey: normalizeHotkey(section.hotkey) } : {}),
    })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

function coerceSection(raw: unknown): LyricsSongSection | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const lines = Array.isArray(obj.lines) ? obj.lines.map((l) => String(l ?? '')) : null
  if (!lines) return null
  const type = SECTION_TYPES.includes(obj.type as LyricsSectionType)
    ? (obj.type as LyricsSectionType)
    : 'verse'
  const label = typeof obj.label === 'string' && obj.label.trim() ? obj.label : 'Verse 1'
  const rawColors = obj.lineColors
  const lineColors = Array.isArray(rawColors)
    ? lines.map((_, i) => {
        const c = rawColors[i]
        return typeof c === 'string' && c.trim() ? c.trim() : null
      })
    : undefined
  const hotkey = normalizeHotkey(obj.hotkey)
  return {
    type,
    label,
    lines,
    ...(lineColors?.some((c) => Boolean(c)) ? { lineColors } : {}),
    ...(hotkey ? { hotkey } : {}),
  }
}

/**
 * Reads one song file back into library shape.
 *
 * Hand-edited files are expected, so every field is coerced rather than
 * trusted, and `fallbackId` (derived from the file name) covers a file whose
 * `id` was dropped in an edit. Returns null only when there is no usable song
 * at all — a bad file is skipped, never fatal to the scan.
 */
export function parseSongFile(raw: string, fallbackId: string): LyricsSong | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  // Songs/ is a folder operators open, so unrelated JSON will land in it.
  // Only a file that declares itself ours, or carries the minimum shape of a
  // song, is read — anything else is left alone rather than shown as a
  // phantom "Untitled".
  const declared = typeof obj.kairoSong === 'number'
  const shaped = typeof obj.title === 'string' && Array.isArray(obj.sections)
  if (!declared && !shaped) return null

  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : fallbackId
  if (!id) return null

  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : 'Untitled'
  const sections = Array.isArray(obj.sections)
    ? obj.sections.map(coerceSection).filter((s): s is LyricsSongSection => s !== null)
    : []

  const now = Date.now()
  const createdAt = typeof obj.createdAt === 'number' && obj.createdAt > 0 ? obj.createdAt : now
  const updatedAt = typeof obj.updatedAt === 'number' && obj.updatedAt > 0 ? obj.updatedAt : createdAt
  const ccli = typeof obj.ccliNumber === 'string' ? obj.ccliNumber.trim() : ''
  const copyright = typeof obj.copyright === 'string' ? obj.copyright.trim() : ''
  const source = SOURCES.includes(obj.source as LyricsSource) ? (obj.source as LyricsSource) : 'text'

  return {
    id,
    title,
    artist: typeof obj.artist === 'string' ? obj.artist.trim() : '',
    ...(copyright ? { copyright } : {}),
    ...(ccli ? { ccliNumber: ccli } : {}),
    isFavorite: obj.isFavorite === true,
    source,
    sections,
    createdAt,
    updatedAt,
  }
}

/**
 * True when `child` is the same as, or nested inside, `parent`.
 * Both paths must already be absolute and normalized by the caller.
 */
export function isInsideFolder(child: string, parent: string): boolean {
  const normalize = (p: string): string => p.replace(/[\\/]+$/, '')
  const a = normalize(child)
  const b = normalize(parent)
  if (!b) return false
  if (a === b) return true
  const sep = b.includes('\\') ? '\\' : '/'
  return a.startsWith(b + sep)
}

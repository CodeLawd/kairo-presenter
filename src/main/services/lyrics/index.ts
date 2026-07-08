import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import log from 'electron-log/main'
import type {
  LyricsSong,
  LyricsSongSection,
  LyricsSectionType,
  LyricsSource,
  LyricsImportSource,
  SongPresentOptions,
} from '@shared/ipc'
import { proPresenterService } from '../propresenter'
import type { PPSlideGroupSpec } from '../propresenter/types'

// ─── Internal types ───────────────────────────────────────────────────────────

interface InternalSection {
  type: LyricsSectionType
  label: string
  /** 1-based ordinal within this type (Verse 1, Verse 2…) */
  index: number
  lines: string[]
}

interface Song {
  id: string
  title: string
  artist: string
  copyright: string
  ccliNumber?: string
  isFavorite: boolean
  source: LyricsSource
  sections: InternalSection[]
  createdAt: number
  updatedAt: number
}

interface SectionLabelResult {
  type: LyricsSectionType
  index: number
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const SQL_CREATE_SONGS = `
  CREATE TABLE IF NOT EXISTS songs (
    id          TEXT    PRIMARY KEY,
    title       TEXT    NOT NULL COLLATE NOCASE,
    artist      TEXT    NOT NULL DEFAULT '' COLLATE NOCASE,
    copyright   TEXT    NOT NULL DEFAULT '',
    ccli_number TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    source      TEXT    NOT NULL DEFAULT 'text',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`

const SQL_CREATE_SONGS_IDX_TITLE  = `CREATE INDEX IF NOT EXISTS idx_songs_title  ON songs(title   COLLATE NOCASE)`
const SQL_CREATE_SONGS_IDX_ARTIST = `CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist  COLLATE NOCASE)`
const SQL_CREATE_SONGS_IDX_FAV    = `CREATE INDEX IF NOT EXISTS idx_songs_fav    ON songs(is_favorite)`
const SQL_CREATE_SONGS_IDX_CCLI   = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_ccli
    ON songs(ccli_number) WHERE ccli_number IS NOT NULL AND ccli_number != ''`

const SQL_CREATE_SECTIONS = `
  CREATE TABLE IF NOT EXISTS song_sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id     TEXT    NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL,
    label       TEXT    NOT NULL,
    section_idx INTEGER NOT NULL DEFAULT 1,
    lines       TEXT    NOT NULL DEFAULT '[]',
    sort_order  INTEGER NOT NULL DEFAULT 0
  )`

const SQL_CREATE_SECTIONS_IDX = `CREATE INDEX IF NOT EXISTS idx_sections_song ON song_sections(song_id)`

const SQL_CREATE_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    title,
    artist,
    lyrics,
    song_id UNINDEXED
  )`

// ─── Row interfaces (internal, matches DB columns) ────────────────────────────

interface SongRow {
  id: string
  title: string
  artist: string
  copyright: string
  ccli_number: string | null
  is_favorite: number
  source: string
  created_at: number
  updated_at: number
}

interface SectionRow {
  id: number
  song_id: string
  type: string
  label: string
  section_idx: number
  lines: string
  sort_order: number
}

interface FtsRow {
  song_id: string
  title: string
  artist: string
  lyrics: string
}

// ─── Section label parser ─────────────────────────────────────────────────────

/**
 * Detects whether a line is a section header in any of these forms:
 *   [V1]  {V1}  (V1)   — bracketed short codes
 *   V1  C  B  PC  T  I  O  E  — raw short codes
 *   Verse 1  Chorus  Bridge  Pre-Chorus  Tag  Intro  Outro  Ending — English words
 *
 * Returns null if the line is not a section header.
 */
function parseSectionLabel(rawLine: string): SectionLabelResult | null {
  // Strip surrounding brackets / braces / parens and whitespace
  const stripped = rawLine.replace(/^[\[\({]\s*|\s*[\]\)}]$/g, '').trim()
  // Strip trailing colon
  const line = stripped.replace(/:+\s*$/, '').trim()
  if (!line) return null

  const lower = line.toLowerCase().replace(/\s+/g, ' ')

  // ── Verse ──────────────────────────────────────────────────────────────────
  const verseMatch = lower.match(/^v(?:erse)?\.?\s*(\d*)$/)
  if (verseMatch) {
    const n = parseInt(verseMatch[1] || '1') || 1
    return { type: 'verse', index: n }
  }

  // ── Chorus ─────────────────────────────────────────────────────────────────
  const chorusMatch = lower.match(/^c(?:horus)?\.?\s*(\d*)$/)
  if (chorusMatch) {
    const n = parseInt(chorusMatch[1] || '1') || 1
    return { type: 'chorus', index: n }
  }

  // ── Bridge ─────────────────────────────────────────────────────────────────
  const bridgeMatch = lower.match(/^b(?:ridge)?\.?\s*(\d*)$/)
  if (bridgeMatch) {
    const n = parseInt(bridgeMatch[1] || '1') || 1
    return { type: 'bridge', index: n }
  }

  // ── Pre-Chorus ─────────────────────────────────────────────────────────────
  if (/^(?:pc|p\.?c\.?|pre[-\s]?c(?:ho(?:rus)?)?|prechorus)\.?\s*\d*$/.test(lower)) {
    return { type: 'pre-chorus', index: 1 }
  }

  // ── Tag ────────────────────────────────────────────────────────────────────
  if (/^t(?:ag)?\.?\s*\d*$/.test(lower)) {
    return { type: 'tag', index: 1 }
  }

  // ── Intro ──────────────────────────────────────────────────────────────────
  if (/^i(?:ntro(?:duction)?)?\.?\s*\d*$/.test(lower)) {
    return { type: 'intro', index: 1 }
  }

  // ── Outro ──────────────────────────────────────────────────────────────────
  if (/^o(?:utro)?\.?\s*\d*$/.test(lower)) {
    return { type: 'outro', index: 1 }
  }

  // ── Ending ─────────────────────────────────────────────────────────────────
  if (/^(?:e(?:nd(?:ing)?)?|ending)\.?\s*\d*$/.test(lower)) {
    return { type: 'ending', index: 1 }
  }

  return null
}

/**
 * Returns true if the line looks like a section label in any supported form.
 */
function isSectionLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  // Must be short — section labels are never full sentences
  if (trimmed.length > 30) return false
  // Check for explicit bracket forms first
  if (/^[\[\({]/.test(trimmed)) return parseSectionLabel(trimmed) !== null
  // Check for plain text labels (standalone lines like "Verse 1" or "Chorus")
  return parseSectionLabel(trimmed) !== null
}

// ─── Text utilities ───────────────────────────────────────────────────────────

/**
 * Soft-wraps a single line at word boundaries when it exceeds maxChars.
 * Never splits in the middle of a word.
 */
function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line]
  const words = line.split(/\s+/)
  const wrapped: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word
    } else {
      wrapped.push(current)
      current = word
    }
  }
  if (current) wrapped.push(current)
  return wrapped.length > 0 ? wrapped : [line]
}

/**
 * Splits a list of (possibly long) lines into chunks of at most maxLines each,
 * respecting the soft character limit per line via word-wrapping.
 */
function splitIntoSlideChunks(lines: string[], maxLines: number, maxChars: number): string[][] {
  // Expand lines via word-wrap first
  const expanded: string[] = []
  for (const line of lines) {
    expanded.push(...wrapLine(line, maxChars))
  }
  // Chunk into maxLines pages
  const chunks: string[][] = []
  for (let i = 0; i < expanded.length; i += maxLines) {
    chunks.push(expanded.slice(i, i + maxLines))
  }
  return chunks.length > 0 ? chunks : [[]]
}

/** Canonical form of a block for duplicate detection (lowercase, no punctuation). */
function canonicalize(lines: string[]): string {
  return lines
    .map((l) => l.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Build a human label for a section type + index. */
function sectionLabel(type: LyricsSectionType, index: number): string {
  switch (type) {
    case 'verse':      return index === 1 ? 'Verse 1' : `Verse ${index}`
    case 'chorus':     return index === 1 ? 'Chorus' : `Chorus ${index}`
    case 'bridge':     return index === 1 ? 'Bridge' : `Bridge ${index}`
    case 'pre-chorus': return index === 1 ? 'Pre-Chorus' : `Pre-Chorus ${index}`
    case 'tag':        return index === 1 ? 'Tag' : `Tag ${index}`
    case 'intro':      return 'Intro'
    case 'outro':      return 'Outro'
    case 'ending':     return 'Ending'
  }
}

// ─── LyricsService ────────────────────────────────────────────────────────────

class LyricsService {
  private db: BetterSqlite3.Database | null = null

  // Prepared statements — non-null after open()
  private stmts!: {
    insertSong:      BetterSqlite3.Statement
    updateSong:      BetterSqlite3.Statement
    deleteSong:      BetterSqlite3.Statement
    getSong:         BetterSqlite3.Statement
    listSongs:       BetterSqlite3.Statement
    toggleFavorite:  BetterSqlite3.Statement
    getFavorite:     BetterSqlite3.Statement
    findByCCLI:      BetterSqlite3.Statement
    insertSection:   BetterSqlite3.Statement
    deleteSections:  BetterSqlite3.Statement
    listSections:    BetterSqlite3.Statement
    insertFts:       BetterSqlite3.Statement
    deleteFts:       BetterSqlite3.Statement
    searchFts:       BetterSqlite3.Statement
    searchLike:      BetterSqlite3.Statement
  }

  // Event callbacks
  private importedCbs: Array<(song: LyricsSong) => void> = []
  private errorCbs:    Array<(err: Error) => void> = []
  private searchCbs:   Array<(query: string, results: LyricsSong[]) => void> = []

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  open(dbPath?: string): void {
    if (this.db) return
    const p = dbPath ?? path.join(app.getPath('userData'), 'lyrics.db')
    this.db = new Database(p)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')
    this.initSchema()
    this.prepareStatements()
    log.info('[LyricsDB] Opened', { path: p })
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private requireDb(): BetterSqlite3.Database {
    if (!this.db) this.open()
    return this.db!
  }

  // ─── Schema ─────────────────────────────────────────────────────────────────

  private initSchema(): void {
    const db = this.db!
    db.exec(SQL_CREATE_SONGS)
    db.exec(SQL_CREATE_SONGS_IDX_TITLE)
    db.exec(SQL_CREATE_SONGS_IDX_ARTIST)
    db.exec(SQL_CREATE_SONGS_IDX_FAV)
    db.exec(SQL_CREATE_SONGS_IDX_CCLI)
    db.exec(SQL_CREATE_SECTIONS)
    db.exec(SQL_CREATE_SECTIONS_IDX)
    db.exec(SQL_CREATE_FTS)
  }

  private prepareStatements(): void {
    const db = this.db!
    this.stmts = {
      insertSong: db.prepare(
        `INSERT OR REPLACE INTO songs
           (id, title, artist, copyright, ccli_number, is_favorite, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      updateSong: db.prepare(
        `UPDATE songs SET title=?, artist=?, copyright=?, ccli_number=?,
           is_favorite=?, source=?, updated_at=? WHERE id=?`
      ),
      deleteSong: db.prepare(`DELETE FROM songs WHERE id = ?`),
      getSong:    db.prepare(`SELECT * FROM songs WHERE id = ?`),
      listSongs:  db.prepare(`SELECT * FROM songs ORDER BY title COLLATE NOCASE`),
      toggleFavorite: db.prepare(
        `UPDATE songs SET is_favorite = 1 - is_favorite, updated_at = ? WHERE id = ?`
      ),
      getFavorite:  db.prepare(`SELECT is_favorite FROM songs WHERE id = ?`),
      findByCCLI:   db.prepare(
        `SELECT * FROM songs WHERE ccli_number = ? AND ccli_number != '' LIMIT 1`
      ),
      insertSection: db.prepare(
        `INSERT INTO song_sections (song_id, type, label, section_idx, lines, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      deleteSections: db.prepare(`DELETE FROM song_sections WHERE song_id = ?`),
      listSections:   db.prepare(
        `SELECT * FROM song_sections WHERE song_id = ? ORDER BY sort_order`
      ),
      insertFts: db.prepare(
        `INSERT INTO songs_fts (song_id, title, artist, lyrics) VALUES (?, ?, ?, ?)`
      ),
      deleteFts: db.prepare(`DELETE FROM songs_fts WHERE song_id = ?`),
      searchFts: db.prepare(
        `SELECT song_id FROM songs_fts WHERE songs_fts MATCH ? ORDER BY rank LIMIT 50`
      ),
      searchLike: db.prepare(
        `SELECT DISTINCT s.id
           FROM songs s
           LEFT JOIN song_sections sec ON sec.song_id = s.id
          WHERE s.title  LIKE ? COLLATE NOCASE
             OR s.artist LIKE ? COLLATE NOCASE
             OR sec.lines LIKE ?
          LIMIT 50`
      ),
    }
  }

  // ─── SongSelect .usr file parser ────────────────────────────────────────────

  /**
   * Parses the content of a SongSelect .usr export file.
   *
   * Supported metadata keys: Title, Author/Artist/Writer, Copyright,
   *   CCLI#, CCLINumber, CCLISongNumber.
   *
   * Supported section tags (bracketed or plain):
   *   V/V1–V9, C/C1–C9, B/B1–B9, PC/PreC, T/Tag, I/Intro, O/Outro, E/End/Ending
   */
  parseUSR(content: string): Song {
    // Strip UTF-8 BOM and normalize line endings
    const text = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = text.split('\n')

    const meta: Record<string, string> = {}
    let bodyStart = 0

    // Parse leading key=value metadata block
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const eqIdx = line.indexOf('=')
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim().toLowerCase().replace(/\s+/g, '')
        const val = line.slice(eqIdx + 1).trim()
        meta[key] = val
        bodyStart = i + 1
      } else {
        // First non-key=value line ends the metadata block
        // (allow blank lines within metadata to be skipped)
        if (line.trim() !== '') break
        bodyStart = i + 1
      }
    }

    const title     = meta['title']     ?? meta['songtitle']                               ?? 'Untitled'
    const artist    = meta['author']    ?? meta['artist']    ?? meta['writer']
                    ?? meta['songwriter'] ?? meta['authors']                                ?? ''
    const copyright = meta['copyright']                                                     ?? ''
    const ccliRaw   = meta['ccli#']     ?? meta['cclinumber'] ?? meta['cclisongnumber']
                    ?? meta['ccli number'] ?? meta['cclinumber']                            ?? ''
    const ccliNumber = ccliRaw.replace(/\D/g, '') || undefined

    // Parse lyric body into sections
    const bodyLines = lines.slice(bodyStart)
    const sections  = this.parseBodyIntoSections(bodyLines)

    return {
      id:          this.newId(),
      title:       title.trim(),
      artist:      artist.trim(),
      copyright:   copyright.trim(),
      ccliNumber,
      isFavorite:  false,
      source:      'usr',
      sections,
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
  }

  // ─── Manual text parser ─────────────────────────────────────────────────────

  /**
   * Parses raw pasted lyric text into sections.
   *
   * Detection order:
   *   1. If the text contains explicit section markers → split on them.
   *   2. Otherwise split on blank lines; detect repeated blocks → label as Chorus.
   *      Remaining blocks are numbered Verse 1, Verse 2, etc.
   */
  parseText(text: string, title: string, artist: string, copyright = ''): Song {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines      = normalized.split('\n')
    const sections   = this.detectSections(lines)

    return {
      id:          this.newId(),
      title:       title.trim() || 'Untitled',
      artist:      artist.trim(),
      copyright:   copyright.trim(),
      ccliNumber:  undefined,
      isFavorite:  false,
      source:      'text',
      sections,
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    }
  }

  // ─── Section detection (shared by parseUSR body + parseText) ────────────────

  private parseBodyIntoSections(lines: string[]): InternalSection[] {
    // Determine whether the body contains explicit section markers
    const hasMarkers = lines.some((l) => isSectionLine(l))
    if (hasMarkers) {
      return this.splitOnMarkers(lines)
    }
    return this.detectSections(lines)
  }

  private splitOnMarkers(lines: string[]): InternalSection[] {
    const sections: InternalSection[] = []
    let currentLabel: SectionLabelResult | null = null
    let currentLines: string[] = []
    // Track how many times each type has been seen to assign indices
    const typeCount = new Map<LyricsSectionType, number>()

    const flush = (): void => {
      if (!currentLabel) return
      const clean = currentLines.map((l) => l.trimEnd()).filter((_, i, a) => {
        // Remove leading/trailing blank lines within section
        if (i === 0 && !a[i]) return false
        if (i === a.length - 1 && !a[i]) return false
        return true
      })
      if (clean.length === 0) return
      sections.push({
        type:  currentLabel.type,
        label: sectionLabel(currentLabel.type, currentLabel.index),
        index: currentLabel.index,
        lines: clean,
      })
    }

    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      const label   = isSectionLine(trimmed) ? parseSectionLabel(trimmed) : null

      if (label) {
        flush()
        currentLines = []
        // Re-assign index based on occurrence count when original index is 1
        // (handles files that reuse {C} multiple times — each gets distinct index)
        const seen = (typeCount.get(label.type) ?? 0) + 1
        typeCount.set(label.type, seen)
        // Use the explicit index from the tag if > 1, otherwise use occurrence count
        const resolvedIndex = label.index > 1 ? label.index : seen
        currentLabel = { type: label.type, index: resolvedIndex }
      } else {
        currentLines.push(rawLine)
      }
    }
    flush()
    return sections
  }

  private detectSections(lines: string[]): InternalSection[] {
    // First check if there are section markers embedded in the text
    const hasMarkers = lines.some((l) => isSectionLine(l))
    if (hasMarkers) return this.splitOnMarkers(lines)

    // Split on runs of blank lines into raw blocks
    const blocks = this.splitIntoBlocks(lines)
    if (blocks.length === 0) return []

    // Detect duplicates (chorus candidates)
    const canonicals = blocks.map(canonicalize)
    const chorusCanonical = this.findMostRepeated(canonicals)

    const verseCount   = { n: 0 }
    const chorusCount  = { n: 0 }
    const sections: InternalSection[] = []

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const canon = canonicals[i]

      if (chorusCanonical && canon === chorusCanonical) {
        chorusCount.n++
        const idx = chorusCount.n
        sections.push({
          type:  'chorus',
          label: sectionLabel('chorus', idx),
          index: idx,
          lines: block,
        })
      } else {
        verseCount.n++
        const idx = verseCount.n
        sections.push({
          type:  'verse',
          label: sectionLabel('verse', idx),
          index: idx,
          lines: block,
        })
      }
    }
    return sections
  }

  private splitIntoBlocks(lines: string[]): string[][] {
    const blocks: string[][] = []
    let current: string[] = []
    let blankRun = 0

    for (const line of lines) {
      const isBlank = !line.trim()
      if (isBlank) {
        blankRun++
        if (blankRun >= 2 && current.length > 0) {
          blocks.push(current)
          current = []
          blankRun = 0
        }
      } else {
        blankRun = 0
        current.push(line.trimEnd())
      }
    }
    if (current.length > 0) blocks.push(current)
    return blocks
  }

  /** Returns the canonical form of the block that appears most often (≥2 times), or null. */
  private findMostRepeated(canonicals: string[]): string | null {
    const counts = new Map<string, number>()
    for (const c of canonicals) {
      if (!c) continue
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    let best: string | null = null
    let bestCount = 1
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best      = key
        bestCount = count
      }
    }
    return best
  }

  // ─── Slide formatter ─────────────────────────────────────────────────────────

  /**
   * Converts a Song into ProPresenter slide groups ready for `createGroupedPresentation`.
   *
   * Each section becomes one slide group. Long sections are split across
   * multiple slides (max `linesPerSlide` lines each, word-wrapped at `maxCharsPerLine`).
   * Copyright placement is controlled by `copyrightPosition`.
   */
  formatSlides(song: Song, options: SongPresentOptions = {}): PPSlideGroupSpec[] {
    const linesPerSlide  = options.linesPerSlide  ?? 4
    const maxCharsPerLine = options.maxCharsPerLine ?? 40
    const copyrightPos   = options.copyrightPosition ?? 'none'
    const copyrightText  = song.copyright.trim()

    // Build all slide groups for content sections
    const groups: PPSlideGroupSpec[] = []
    let totalSlideCount = 0

    for (const section of song.sections) {
      const chunks = splitIntoSlideChunks(section.lines, linesPerSlide, maxCharsPerLine)
      const slides = chunks.map((chunk, chunkIdx) => {
        const label =
          chunks.length === 1
            ? section.label
            : `${section.label} (${chunkIdx + 1})`
        return { label, notes: section.type, lines: chunk }
      })
      groups.push({ name: section.label, slides })
      totalSlideCount += slides.length
    }

    // Copyright handling
    if (copyrightText && copyrightPos !== 'none') {
      if (copyrightPos === 'each') {
        for (const group of groups) {
          for (const slide of group.slides) {
            slide.lines = [...slide.lines, '', copyrightText]
          }
        }
      } else if (copyrightPos === 'last' && totalSlideCount > 0) {
        const lastGroup = groups[groups.length - 1]
        const lastSlide = lastGroup.slides[lastGroup.slides.length - 1]
        lastSlide.lines = [...lastSlide.lines, '', copyrightText]
      } else if (copyrightPos === 'separate') {
        groups.push({
          name:   'Copyright',
          slides: [{ label: 'Copyright', notes: 'copyright', lines: [copyrightText] }],
        })
      }
    }

    return groups
  }

  // ─── Library CRUD ───────────────────────────────────────────────────────────

  getLibrary(): LyricsSong[] {
    const db = this.requireDb()
    const rows = this.stmts.listSongs.all() as SongRow[]
    return rows.map((row) => this.rowToIPC(row, db))
  }

  getSong(id: string): LyricsSong | null {
    const db  = this.requireDb()
    const row = this.stmts.getSong.get(id) as SongRow | undefined
    if (!row) return null
    return this.rowToIPC(row, db)
  }

  addSong(song: Song): void {
    const db = this.requireDb()
    const lyricsText = song.sections.flatMap((s) => s.lines).join(' ')

    const tx = db.transaction(() => {
      this.stmts.insertSong.run(
        song.id,
        song.title,
        song.artist,
        song.copyright,
        song.ccliNumber ?? null,
        song.isFavorite ? 1 : 0,
        song.source,
        song.createdAt,
        song.updatedAt
      )
      // Sections
      this.stmts.deleteSections.run(song.id)
      for (let i = 0; i < song.sections.length; i++) {
        const sec = song.sections[i]
        this.stmts.insertSection.run(
          song.id,
          sec.type,
          sec.label,
          sec.index,
          JSON.stringify(sec.lines),
          i
        )
      }
      // FTS
      this.stmts.deleteFts.run(song.id)
      this.stmts.insertFts.run(song.id, song.title, song.artist, lyricsText)
    })
    tx()
    log.info('[LyricsDB] Song saved', { id: song.id, title: song.title })
  }

  updateSong(id: string, updates: LyricsSong): LyricsSong | null {
    const db = this.requireDb()
    const existing = this.stmts.getSong.get(id) as SongRow | undefined
    if (!existing) return null

    const now = Date.now()
    const lyricsText = updates.sections.flatMap((s) => s.lines).join(' ')

    const tx = db.transaction(() => {
      this.stmts.updateSong.run(
        updates.title,
        updates.artist,
        updates.copyright ?? '',
        updates.ccliNumber ?? null,
        existing.is_favorite,
        existing.source,
        now,
        id
      )
      this.stmts.deleteSections.run(id)
      for (let i = 0; i < updates.sections.length; i++) {
        const sec = updates.sections[i]
        this.stmts.insertSection.run(id, sec.type, sec.label, i + 1, JSON.stringify(sec.lines), i)
      }
      this.stmts.deleteFts.run(id)
      this.stmts.insertFts.run(id, updates.title, updates.artist, lyricsText)
    })
    tx()

    log.info('[LyricsDB] Song updated', { id, title: updates.title })
    return this.getSong(id)
  }

  deleteSong(id: string): boolean {
    const db     = this.requireDb()
    const result = this.stmts.deleteSong.run(id)
    this.stmts.deleteFts.run(id)
    if (result.changes > 0) {
      log.info('[LyricsDB] Song deleted', { id })
      return true
    }
    return false
  }

  toggleFavorite(id: string): boolean {
    this.requireDb()
    const before = this.stmts.getFavorite.get(id) as { is_favorite: number } | undefined
    if (!before) return false
    this.stmts.toggleFavorite.run(Date.now(), id)
    const after = (this.stmts.getFavorite.get(id) as { is_favorite: number }).is_favorite === 1
    log.info('[LyricsDB] Favorite toggled', { id, isFavorite: after })
    return after
  }

  findByCCLI(ccliNumber: string): LyricsSong | null {
    const db  = this.requireDb()
    const row = this.stmts.findByCCLI.get(ccliNumber) as SongRow | undefined
    if (!row) return null
    return this.rowToIPC(row, db)
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  search(query: string): LyricsSong[] {
    const db      = this.requireDb()
    const q       = query.trim()
    if (!q) return this.getLibrary()

    const ids = new Set<string>()
    const results: LyricsSong[] = []

    // FTS first (ranked)
    try {
      const ftsQuery = q.replace(/["*^()\-]/g, ' ').trim()
      const ftsRows  = this.stmts.searchFts.all(ftsQuery) as { song_id: string }[]
      for (const { song_id } of ftsRows) {
        if (ids.has(song_id)) continue
        ids.add(song_id)
        const row = this.stmts.getSong.get(song_id) as SongRow | undefined
        if (row) results.push(this.rowToIPC(row, db))
      }
    } catch {
      // FTS query syntax error — fall through to LIKE
    }

    // LIKE fallback for anything not already matched
    const like    = `%${q}%`
    const likeRows = this.stmts.searchLike.all(like, like, like) as { id: string }[]
    for (const { id } of likeRows) {
      if (ids.has(id)) continue
      ids.add(id)
      const row = this.stmts.getSong.get(id) as SongRow | undefined
      if (row) results.push(this.rowToIPC(row, db))
    }

    const sorted = results.sort((a, b) => a.title.localeCompare(b.title))
    this.emitSearchResults(q, sorted)
    return sorted
  }

  // ─── Import dispatcher ───────────────────────────────────────────────────────

  async importSong(source: LyricsImportSource): Promise<LyricsSong> {
    log.info('[LyricsService] Importing song', { type: source.type })

    try {
      let song: Song

      if (source.type === 'usr') {
        song = this.parseUSR(source.content)
        // CCLI dedup: if we already have this song, return the existing entry
        if (song.ccliNumber) {
          const existing = this.findByCCLI(song.ccliNumber)
          if (existing) {
            log.info('[LyricsService] Duplicate CCLI — returning existing', { ccli: song.ccliNumber })
            return existing
          }
        }
        this.addSong(song)
        const result = this.songToIPC(song)
        this.emitImported(result)
        return result
      }

      if (source.type === 'text') {
        song = this.parseText(source.text, source.title, source.artist, source.copyright)
        this.addSong(song)
        const result = this.songToIPC(song)
        this.emitImported(result)
        return result
      }

      if (source.type === 'ccli') {
        // SongSelect API requires a licensed integration — structured stub.
        // When implemented, fetch from api.ccli.com/SongSelect/v1/songs/{ccliNumber}
        // with Authorization: Bearer {apiKey} and parse the JSON response.
        log.warn('[LyricsService] CCLI API import not yet implemented', {
          ccli: source.ccliNumber,
        })
        throw new Error(
          'SongSelect CCLI API import requires a licensed SongSelect account. ' +
          'Export the song as a .usr file from SongSelect and use the "usr" import type instead.'
        )
      }

      if (source.type === 'url') {
        // OpenLyrics XML or plain text URL fetch
        log.warn('[LyricsService] URL import not yet implemented', { url: source.url })
        throw new Error('URL import is not yet implemented.')
      }

      throw new Error(`Unknown import source type: ${(source as { type: string }).type}`)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      this.emitError(e)
      throw e
    }
  }

  // ─── Playlist ────────────────────────────────────────────────────────────────

  addToPlaylist(songId: string, playlistId: string): void {
    const song = this.getSong(songId)
    if (!song) {
      log.warn('[LyricsService] addToPlaylist: song not found', { songId })
      return
    }
    log.info('[LyricsService] Song added to playlist', { songId, playlistId, title: song.title })
    // ProPresenter playlist management via PP API would go here.
    // The PP API supports adding items to playlists via POST /v1/playlist/{id}/items.
  }

  // ─── ProPresenter integration ─────────────────────────────────────────────────

  /**
   * Formats a song from the library as ProPresenter slides and pushes it to PP.
   * Creates a multi-group presentation (one group per section).
   * Optionally triggers the first slide immediately.
   */
  async sendToProPresenter(songId: string, options: SongPresentOptions = {}): Promise<void> {
    const ipcSong = this.getSong(songId)
    if (!ipcSong) throw new Error(`Song not found: ${songId}`)

    const ppStatus = proPresenterService.getStatus()
    if (ppStatus.state !== 'connected') {
      throw new Error('ProPresenter is not connected. Connect in Settings → ProPresenter first.')
    }

    // Reconstruct internal Song from IPC shape for formatting
    const song: Song = {
      id:          ipcSong.id,
      title:       ipcSong.title,
      artist:      ipcSong.artist,
      copyright:   ipcSong.copyright ?? '',
      ccliNumber:  ipcSong.ccliNumber,
      isFavorite:  ipcSong.isFavorite ?? false,
      source:      (ipcSong.source as LyricsSource) ?? 'text',
      sections:    ipcSong.sections.map((s, i) => ({
        type:  s.type,
        label: s.label,
        index: i + 1,
        lines: s.lines,
      })),
      createdAt:   ipcSong.createdAt,
      updatedAt:   ipcSong.updatedAt,
    }

    const groups = this.formatSlides(song, options)
    if (groups.length === 0) throw new Error('Song has no sections to present.')

    const presentationName = `${song.title}${song.artist ? ` — ${song.artist}` : ''}`
    const presentation = await proPresenterService.rawClient.createGroupedPresentation(
      presentationName,
      groups
    )

    if (!presentation) {
      throw new Error('ProPresenter did not confirm presentation creation.')
    }

    if (options.triggerFirst) {
      // Trigger the very first slide (index 0 in the first group)
      await proPresenterService.rawClient.triggerSlide(presentation.id.uuid, 0)
      log.info('[LyricsService] First slide triggered', { title: song.title })
    }

    log.info('[LyricsService] Song sent to ProPresenter', {
      title:  song.title,
      groups: groups.length,
      slides: groups.reduce((n, g) => n + g.slides.length, 0),
    })
  }

  /**
   * Fetches the current ProPresenter library and upserts all items as
   * stub songs with source='propresenter' (no lyrics content).
   * Returns the count of new or updated entries.
   */
  async syncFromProPresenter(): Promise<number> {
    const ppStatus = proPresenterService.getStatus()
    if (ppStatus.state !== 'connected') {
      log.warn('[LyricsService] syncFromProPresenter: PP not connected')
      return 0
    }

    const library = await proPresenterService.rawClient.getLibrary()
    let upserted = 0

    for (const item of library) {
      const existingIPC = this.getSong(item.id.uuid)
      if (existingIPC?.source !== 'propresenter') {
        // Don't overwrite songs already imported from other sources
        if (existingIPC) continue
      }

      const stub: Song = {
        id:          item.id.uuid,
        title:       item.id.name,
        artist:      '',
        copyright:   '',
        ccliNumber:  undefined,
        isFavorite:  false,
        source:      'propresenter',
        sections:    [],
        createdAt:   Date.now(),
        updatedAt:   Date.now(),
      }
      this.addSong(stub)
      upserted++
    }

    log.info('[LyricsService] PP library synced', { total: library.length, upserted })
    return upserted
  }

  // ─── Event subscriptions ─────────────────────────────────────────────────────

  onImported(cb: (song: LyricsSong) => void): void {
    this.importedCbs.push(cb)
  }

  onError(cb: (err: Error) => void): void {
    this.errorCbs.push(cb)
  }

  onSearchResults(cb: (query: string, results: LyricsSong[]) => void): void {
    this.searchCbs.push(cb)
  }

  private emitImported(song: LyricsSong): void {
    this.importedCbs.forEach((cb) => cb(song))
  }

  private emitError(err: Error): void {
    this.errorCbs.forEach((cb) => cb(err))
  }

  private emitSearchResults(query: string, results: LyricsSong[]): void {
    this.searchCbs.forEach((cb) => cb(query, results))
  }

  // ─── Adapters ────────────────────────────────────────────────────────────────

  /** Convert the DB row + sections into the IPC-safe LyricsSong shape. */
  private rowToIPC(row: SongRow, db: BetterSqlite3.Database): LyricsSong {
    const sectionRows = this.stmts.listSections.all(row.id) as SectionRow[]
    const sections: LyricsSongSection[] = sectionRows.map((s) => ({
      type:  s.type as LyricsSectionType,
      label: s.label,
      lines: JSON.parse(s.lines) as string[],
    }))

    return {
      id:          row.id,
      title:       row.title,
      artist:      row.artist,
      copyright:   row.copyright || undefined,
      ccliNumber:  row.ccli_number ?? undefined,
      isFavorite:  row.is_favorite === 1,
      source:      row.source as LyricsSource,
      sections,
      createdAt:   row.created_at,
      updatedAt:   row.updated_at,
    }
  }

  /** Convert an in-memory Song (not yet in DB) to IPC shape. */
  private songToIPC(song: Song): LyricsSong {
    return {
      id:          song.id,
      title:       song.title,
      artist:      song.artist,
      copyright:   song.copyright || undefined,
      ccliNumber:  song.ccliNumber,
      isFavorite:  song.isFavorite,
      source:      song.source,
      sections:    song.sections.map((s) => ({
        type:  s.type,
        label: s.label,
        lines: s.lines,
      })),
      createdAt:   song.createdAt,
      updatedAt:   song.updatedAt,
    }
  }

  private newId(): string {
    return `song-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

export const lyricsService = new LyricsService()

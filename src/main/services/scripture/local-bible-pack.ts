import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { gunzipSync } from 'zlib'
import os from 'os'
import { BIBLE_VERSE_COUNTS } from './bible-verse-counts'
import {
  DEFAULT_PACK_TRANSLATION_ID,
  getDownloadablePack,
  getTranslationDefinition,
} from '@shared/bible-translations'

// ─── Expected pack shape ────────────────────────────────────────────────────
// The converter (scripts/build-bible-pack.ts) enforces the same expectations on
// the source JSON. Both sides must agree before a single row is imported: the
// canonical Protestant versification (BIBLE_VERSE_COUNTS) for every pack.

function canonicalTotals(): { books: number; chapters: number; verses: number } {
  let chapters = 0
  let verses = 0
  for (const book of BIBLE_VERSE_COUNTS) {
    chapters += book.length
    for (const count of book) verses += count
  }
  return { books: BIBLE_VERSE_COUNTS.length, chapters, verses }
}

const CANONICAL_TOTALS = canonicalTotals()

const MAX_COMPRESSED_PACK_BYTES = 10 * 1024 * 1024
const MAX_UNCOMPRESSED_PACK_BYTES = 24 * 1024 * 1024

// ─── Public shapes ────────────────────────────────────────────────────────────

export interface PackVerseRow {
  bookId: number
  chapter: number
  verse: number
  text: string
}

export interface ValidatedPack {
  translationId: string
  translationName: string
  language: string
  verses: PackVerseRow[]
  bookCount: number
  chapterCount: number
  verseCount: number
}

export interface LocalBiblePackStatusShape {
  translation: string
  verseCount: number
  chapterCount: number
  installed: boolean
}

// ─── Writable bible.db resolution ─────────────────────────────────────────────
// The app must install packs into the userData copy of bible.db — never into
// resources/bible.db (shipped, read-only when packaged) — and never by
// replacing an existing user's database during upgrades.

export function resolveWritableBibleDbPath(): string {
  // Required lazily: `app` does not exist when this module loads outside a
  // running Electron app (tests). Mirrors ScriptureService.open().
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { is } = require('@electron-toolkit/utils') as typeof import('@electron-toolkit/utils')

  const userData = app.getPath('userData')
  const dest = path.join(userData, 'bible.db')

  // Copy-on-first-run only. An existing userData bible.db is never replaced,
  // so upgrades cannot wipe a previously installed local NKJV.
  if (!fs.existsSync(dest)) {
    const src = is.dev
      ? path.join(app.getAppPath(), 'resources', 'bible.db')
      : path.join(process.resourcesPath, 'bible.db')
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
    }
  }

  return dest
}

// ─── Pack validation ──────────────────────────────────────────────────────────
// Reads a candidate *.db pack read-only through fixed, allowlisted SELECTs.
// Table names and SQL are never taken from the pack itself.

const KNOWN_TABLES = new Set(['translations', 'verses', 'books', 'verses_fts'])

function assertKnownTable(name: string): void {
  if (!KNOWN_TABLES.has(name)) {
    throw new Error(`Refusing to read unexpected table "${name}" from Bible pack.`)
  }
}

function tableExists(db: BetterSqlite3.Database, name: string): boolean {
  assertKnownTable(name)
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { n: number }
  return row.n > 0
}

/**
 * Validate a SQLite Bible pack file without modifying it.
 *
 * Accepts any single-translation pack. When `expectedTranslationId` is given
 * (file-picker installs of a specific translation) the pack must contain only
 * that id; downloads always pass the registry id they requested.
 *
 * Throws a plain Error describing the first problem found. Returns the pack
 * contents ready for transactional import.
 */
export function validatePackFile(packPath: string, expectedTranslationId?: string): ValidatedPack {
  if (typeof packPath !== 'string' || packPath.trim() === '') {
    throw new Error('Select a Bible pack file to install.')
  }

  let resolved: string
  try {
    resolved = fs.realpathSync(packPath)
  } catch {
    throw new Error('That Bible pack file could not be found.')
  }

  const stat = fs.statSync(resolved)
  if (!stat.isFile()) {
    throw new Error('That Bible pack path is not a file.')
  }

  let db: BetterSqlite3.Database
  try {
    db = new Database(resolved, { readonly: true })
  } catch {
    throw new Error('That file is not a readable SQLite Bible pack.')
  }

  try {
    if (!tableExists(db, 'translations') || !tableExists(db, 'verses')) {
      throw new Error('That file is missing the translations or verses table.')
    }

    const translationRows = db
      .prepare('SELECT id, name, language FROM translations')
      .all() as Array<{ id: string; name: string; language: string }>

    const expected = expectedTranslationId?.toUpperCase()
    const matching = expected
      ? translationRows.filter((row) => row.id.toUpperCase() === expected)
      : translationRows
    if (translationRows.length !== 1 || matching.length !== 1) {
      const found =
        translationRows.length === 0
          ? 'no translations'
          : translationRows.map((row) => row.id).join(', ')
      throw new Error(
        expected
          ? `Expected a pack containing only ${expected}, found: ${found}.`
          : `Expected a pack containing a single translation, found: ${found}.`,
      )
    }
    const packRow = matching[0] as { id: string; name: string; language: string }
    const translationId = packRow.id.toUpperCase()
    const fallbackName = getTranslationDefinition(translationId)?.name ?? translationId

    // Fixed-column reads only — no trusted identifiers from the pack.
    const verses = db
      .prepare(
        'SELECT book_id as bookId, chapter, verse, text FROM verses WHERE translation_id = ? ORDER BY book_id, chapter, verse',
      )
      .all(packRow.id) as Array<{
      bookId: number
      chapter: number
      verse: number
      text: string | null
    }>

    return validatePackRowsFor(
      translationId,
      packRow.name || fallbackName,
      packRow.language || 'en',
      verses,
    )
  } catch (error) {
    if (error instanceof Error && /not a database|file is not a database/i.test(error.message)) {
      throw new Error('That file is not a readable SQLite Bible pack.')
    }
    throw error
  } finally {
    db.close()
  }
}

/** Download the allowlisted registry asset for `translationId` and return its SQLite bytes. */
export async function downloadBiblePack(
  translationId: string,
  fetcher: typeof fetch = fetch,
  expectedHash?: string,
): Promise<Buffer> {
  const normalized = translationId.toUpperCase()
  const pack = getDownloadablePack(normalized)
  if (!pack) {
    throw new Error(`No downloadable local pack is available for ${normalized}.`)
  }
  const response = await fetcher(pack.url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`${normalized} download failed (HTTP ${response.status}).`)
  }
  const compressed = Buffer.from(await response.arrayBuffer())
  if (compressed.length === 0 || compressed.length > MAX_COMPRESSED_PACK_BYTES) {
    throw new Error(`The downloaded ${normalized} pack has an invalid size.`)
  }
  const digest = createHash('sha256').update(compressed).digest('hex')
  if (digest !== (expectedHash ?? pack.sha256)) {
    throw new Error(`The downloaded ${normalized} pack failed its security check.`)
  }
  try {
    return gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_PACK_BYTES })
  } catch {
    throw new Error(`The downloaded ${normalized} pack could not be decompressed.`)
  }
}

export function temporaryPackPath(translationId = DEFAULT_PACK_TRANSLATION_ID): string {
  const slug = translationId.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bible'
  return path.join(os.tmpdir(), `kairo-${slug}-${randomUUID()}.db`)
}

/**
 * Structural validation shared by the file validator above and the converter
 * (which validates parsed JSON before writing a pack). Throws on the first
 * problem; returns canonical counts otherwise.
 */
export function validatePackRowsFor(
  translationId: string,
  translationName: string,
  language: string,
  verses: Array<{ bookId: number; chapter: number; verse: number; text: string | null }>,
): ValidatedPack {
  const normalized = translationId.toUpperCase()
  const { books, chapters, verses: expectedVerses } = CANONICAL_TOTALS

  if (verses.length !== expectedVerses) {
    throw new Error(
      `Expected ${expectedVerses.toLocaleString()} ${normalized} verses, found ${verses.length.toLocaleString()}.`,
    )
  }

  const seen = new Set<string>()
  const booksSeen = new Set<number>()
  const chaptersSeen = new Set<string>()
  // Highest verse observed per (book, chapter), to prove contiguity from 1.
  const chapterMaxVerse = new Map<string, number>()
  // Highest chapter observed per book, to prove contiguity from 1.
  const bookMaxChapter = new Map<number, number>()
  const rows: PackVerseRow[] = []

  for (const row of verses) {
    const { bookId, chapter, verse } = row
    const text = typeof row.text === 'string' ? row.text : ''

    if (!Number.isInteger(bookId) || bookId < 1 || bookId > books) {
      throw new Error(`Verse has out-of-range book id ${String(bookId)}.`)
    }
    if (!Number.isInteger(chapter) || chapter < 1) {
      throw new Error(`Verse has invalid chapter ${String(chapter)} (book ${bookId}).`)
    }
    if (!Number.isInteger(verse) || verse < 1) {
      throw new Error(`Verse has invalid verse number ${String(verse)} (book ${bookId} chapter ${chapter}).`)
    }
    if (text.trim() === '') {
      throw new Error(`Empty verse text at book ${bookId} chapter ${chapter} verse ${verse}.`)
    }

    const key = `${bookId}:${chapter}:${verse}`
    if (seen.has(key)) {
      throw new Error(`Duplicate verse reference ${key}.`)
    }
    seen.add(key)

    const chapterKey = `${bookId}:${chapter}`
    chaptersSeen.add(chapterKey)
    booksSeen.add(bookId)
    bookMaxChapter.set(bookId, Math.max(bookMaxChapter.get(bookId) ?? 0, chapter))
    chapterMaxVerse.set(chapterKey, Math.max(chapterMaxVerse.get(chapterKey) ?? 0, verse))
    rows.push({ bookId, chapter, verse, text })
  }

  if (booksSeen.size !== books) {
    throw new Error(`Expected ${books} books, found ${booksSeen.size}.`)
  }
  for (let bookId = 1; bookId <= books; bookId++) {
    if (!booksSeen.has(bookId)) {
      throw new Error(`Missing book id ${bookId}.`)
    }
  }

  if (chaptersSeen.size !== chapters) {
    throw new Error(
      `Expected ${chapters.toLocaleString()} chapters, found ${chaptersSeen.size.toLocaleString()}.`,
    )
  }

  for (let bookId = 1; bookId <= books; bookId++) {
    const expectedChapterVerses = BIBLE_VERSE_COUNTS[bookId - 1]
    if (!expectedChapterVerses) {
      throw new Error(`Missing canonical verse bounds for book ${bookId}.`)
    }
    const actualChapterCount = bookMaxChapter.get(bookId) ?? 0
    if (actualChapterCount !== expectedChapterVerses.length) {
      throw new Error(
        `${bookLabel(bookId)} expected ${expectedChapterVerses.length} chapters, found ${actualChapterCount}.`,
      )
    }
    for (let chapter = 1; chapter <= expectedChapterVerses.length; chapter++) {
      const actualVerseCount = chapterMaxVerse.get(`${bookId}:${chapter}`) ?? 0
      const expectedVerseCount = expectedChapterVerses[chapter - 1]
      if (actualVerseCount !== expectedVerseCount) {
        throw new Error(
          `${bookLabel(bookId)} ${chapter} expected ${expectedVerseCount} verses, found ${actualVerseCount}.`,
        )
      }
    }
  }

  // Contiguity: chapters per book must be exactly 1..max, verses per chapter
  // exactly 1..max. (Order in the pack is normalized above, so gaps are the
  // only remaining failure mode.)
  for (const [bookId, maxChapter] of bookMaxChapter) {
    for (let chapter = 1; chapter <= maxChapter; chapter++) {
      if (!chaptersSeen.has(`${bookId}:${chapter}`)) {
        throw new Error(`Missing chapter ${chapter} in book ${bookId}.`)
      }
    }
  }
  for (const [chapterKey, maxVerse] of chapterMaxVerse) {
    for (let verse = 1; verse <= maxVerse; verse++) {
      if (!seen.has(`${chapterKey}:${verse}`)) {
        throw new Error(`Missing verse ${verse} in ${chapterKey.replace(':', ' chapter ')}.`)
      }
    }
  }

  return {
    translationId: normalized,
    translationName,
    language,
    verses: rows,
    bookCount: booksSeen.size,
    chapterCount: chaptersSeen.size,
    verseCount: rows.length,
  }
}

/** Local-install state for one translation id in an open BibleDatabase. */
export function packStatusFor(
  translation: string,
  verseCount: number,
  chapterCount: number,
  hasTranslation: boolean,
): LocalBiblePackStatusShape {
  const normalized = translation.toUpperCase()
  const installed =
    hasTranslation &&
    (getDownloadablePack(normalized)
      ? verseCount === CANONICAL_TOTALS.verses && chapterCount === CANONICAL_TOTALS.chapters
      : verseCount > 0)
  return { translation, verseCount, chapterCount, installed }
}

function bookLabel(bookId: number): string {
  // Kept local to validation so an invalid pack cannot supply its own labels.
  const labels = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
    '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
    'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
    'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
    'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
    'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
    '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
    '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
    '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
  ]
  return labels[bookId - 1] ?? `Book ${bookId}`
}

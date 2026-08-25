import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import type {
  ApiBibleCacheStatus,
  ApiBibleOfflineTranslation,
  ScriptureTranslation,
  ScriptureVerse,
} from '@shared/ipc'
import { ApiCacheCrypto, type EncryptedValue } from './api-cache-crypto'
import { API_CACHE_MAX_AGE_MS, getApiCacheFreshness } from './api-cache-policy'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApiBibleCacheState = Omit<ApiBibleOfflineTranslation, 'offlineDownloadEnabled'>

export interface ApiBibleTranslationMeta {
  bibleId: string
  translation: ScriptureTranslation
  name: string
  copyright: string
  totalChapters?: number
}

export interface ApiBibleCachePassage {
  bookId: number
  bookName: string
  verses: ScriptureVerse[]
  fetchedAt: number
  /**
   * What the API was actually asked for. Recorded so a range whose translation
   * omits a verse number still counts as a complete cache hit. Omitting
   * `verseStart`/`verseEnd` records the whole chapter as covered.
   */
  coverage?: { chapter: number; verseStart?: number; verseEnd?: number }
}

interface TranslationRow {
  bible_id: string
  translation_id: string
  name: string
  copyright: string
  status: string
  total_chapters: number
  last_access_check: number | null
  last_error: string | null
}

interface VerseRow {
  verse: number
  book_name: string
  ciphertext: string
  iv: string
  auth_tag: string
  fetched_at: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_translations (
  bible_id TEXT PRIMARY KEY,
  translation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  copyright TEXT NOT NULL,
  status TEXT NOT NULL,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  last_access_check INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS api_verses (
  bible_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  book_name TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (bible_id, book_id, chapter, verse),
  FOREIGN KEY (bible_id) REFERENCES api_translations(bible_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_ranges (
  bible_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (bible_id, book_id, chapter, verse_start, verse_end),
  FOREIGN KEY (bible_id) REFERENCES api_translations(bible_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_chapters (
  bible_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched_at INTEGER,
  PRIMARY KEY (bible_id, chapter_id),
  FOREIGN KEY (bible_id) REFERENCES api_translations(bible_id) ON DELETE CASCADE
);
`

/**
 * Encrypted, expiry-enforcing store for API.Bible-derived scripture. Kept in a
 * database separate from the bundled public-domain `bible.db` so licensed text
 * can be purged wholesale without touching shipped content.
 */
export class ApiBibleCache {
  private constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly crypto: ApiCacheCrypto,
  ) {}

  static open(dbPath: string, crypto: ApiCacheCrypto): ApiBibleCache {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
    return new ApiBibleCache(db, crypto)
  }

  close(): void {
    this.db.close()
  }

  // ─── Translation metadata ───────────────────────────────────────────────────

  upsertTranslation(meta: ApiBibleTranslationMeta): void {
    this.db
      .prepare(
        `INSERT INTO api_translations (bible_id, translation_id, name, copyright, status, total_chapters)
         VALUES (@bibleId, @translation, @name, @copyright, 'partial', @totalChapters)
         ON CONFLICT(bible_id) DO UPDATE SET
           translation_id = excluded.translation_id,
           name = excluded.name,
           copyright = excluded.copyright,
           total_chapters = MAX(api_translations.total_chapters, excluded.total_chapters),
           status = CASE WHEN api_translations.status IN ('unavailable', 'failed')
                         THEN 'partial' ELSE api_translations.status END,
           last_error = NULL`,
      )
      .run({ ...meta, totalChapters: meta.totalChapters ?? 0 })
  }

  setTotalChapters(bibleId: string, totalChapters: number): void {
    this.db
      .prepare('UPDATE api_translations SET total_chapters = ? WHERE bible_id = ?')
      .run(totalChapters, bibleId)
  }

  setStatus(bibleId: string, status: ApiBibleCacheStatus, error: string | null = null): void {
    this.db
      .prepare('UPDATE api_translations SET status = ?, last_error = ? WHERE bible_id = ?')
      .run(status, error, bibleId)
  }

  /**
   * Access was revoked: purge the licensed text immediately and keep only the
   * metadata row, so the operator can see why the translation disappeared.
   */
  markUnavailable(bibleId: string, error: string): void {
    this.db.transaction(() => {
      this.purgeContent(bibleId)
      this.setStatus(bibleId, 'unavailable', error)
      this.db.prepare('UPDATE api_translations SET total_chapters = 0 WHERE bible_id = ?').run(bibleId)
    })()
  }

  /** Deletes cached text and progress, leaving the translation row in place. */
  private purgeContent(bibleId: string): void {
    this.db.prepare('DELETE FROM api_verses WHERE bible_id = ?').run(bibleId)
    this.db.prepare('DELETE FROM api_ranges WHERE bible_id = ?').run(bibleId)
    this.db.prepare('DELETE FROM api_chapters WHERE bible_id = ?').run(bibleId)
  }

  markAccessChecked(bibleId: string, at: number): void {
    this.db
      .prepare('UPDATE api_translations SET last_access_check = ? WHERE bible_id = ?')
      .run(at, bibleId)
  }

  getLastAccessCheck(bibleId: string): number | null {
    const row = this.db
      .prepare('SELECT last_access_check AS at FROM api_translations WHERE bible_id = ?')
      .get(bibleId) as { at: number | null } | undefined
    return row?.at ?? null
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  /**
   * Returns every verse of the requested range, or null when the cache cannot
   * fully and freshly satisfy it. Decryption happens only after the whole range
   * passes the 30-day freshness check.
   */
  getRange(
    bibleId: string,
    bookId: number,
    chapter: number,
    verseStart: number,
    verseEnd?: number,
    now = Date.now(),
  ): ScriptureVerse[] | null {
    const translation = this.getTranslationRow(bibleId)
    if (!translation) return null
    if (translation.status === 'unavailable') return null

    const end = verseEnd ?? verseStart
    if (end < verseStart) return null

    const rows = this.db
      .prepare(
        `SELECT verse, book_name, ciphertext, iv, auth_tag, fetched_at
           FROM api_verses
          WHERE bible_id = ? AND book_id = ? AND chapter = ? AND verse BETWEEN ? AND ?
          ORDER BY verse ASC`,
      )
      .all(bibleId, bookId, chapter, verseStart, end) as VerseRow[]

    if (rows.length === 0) return null
    if (rows.some((row) => getApiCacheFreshness(row.fetched_at, now) === 'stale')) return null

    // A range is complete either because every integer verse is present, or
    // because a recorded fetch covered it — translations legitimately omit
    // verse numbers, and those gaps must not force an endless refetch.
    const contiguous =
      rows.length === end - verseStart + 1 && rows.every((row, index) => row.verse === verseStart + index)
    if (!contiguous && !this.isRangeCovered(bibleId, bookId, chapter, verseStart, end, now)) return null

    return rows.map((row) => ({
      book: row.book_name,
      chapter,
      verse: row.verse,
      text: this.crypto.decrypt(toEncryptedValue(row)),
    }))
  }

  /** True when the range is present, fresh or not — used to explain expiry. */
  hasRange(bibleId: string, bookId: number, chapter: number, verseStart: number, verseEnd?: number): boolean {
    const end = verseEnd ?? verseStart
    if (end < verseStart) return false
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM api_verses
          WHERE bible_id = ? AND book_id = ? AND chapter = ? AND verse BETWEEN ? AND ?`,
      )
      .get(bibleId, bookId, chapter, verseStart, end) as { n: number }
    if (row.n === end - verseStart + 1) return true
    return row.n > 0 && this.isRangeCovered(bibleId, bookId, chapter, verseStart, end)
  }

  /** Was this exact span (or its whole chapter) fetched from API.Bible? */
  private isRangeCovered(
    bibleId: string,
    bookId: number,
    chapter: number,
    verseStart: number,
    verseEnd: number,
    now?: number,
  ): boolean {
    const rows = this.db
      .prepare(
        `SELECT fetched_at FROM api_ranges
          WHERE bible_id = ? AND book_id = ? AND chapter = ?
            AND verse_start <= ? AND verse_end >= ?`,
      )
      .all(bibleId, bookId, chapter, verseStart, verseEnd) as Array<{ fetched_at: number }>
    return rows.some(
      (row) => now === undefined || getApiCacheFreshness(row.fetched_at, now) === 'fresh',
    )
  }

  getTranslationState(bibleId: string, now = Date.now()): ApiBibleCacheState | null {
    const row = this.getTranslationRow(bibleId)
    return row ? this.toState(row, now) : null
  }

  listTranslationStates(now = Date.now()): ApiBibleCacheState[] {
    const rows = this.db
      .prepare('SELECT * FROM api_translations ORDER BY name ASC')
      .all() as TranslationRow[]
    return rows.map((row) => this.toState(row, now))
  }

  /** Chapter ids that still need downloading, in the order they were supplied. */
  getIncompleteChapters(bibleId: string, chapterIds: string[], now = Date.now()): string[] {
    const complete = new Set(
      (
        this.db
          .prepare(
            `SELECT chapter_id, fetched_at FROM api_chapters
              WHERE bible_id = ? AND status = 'complete'`,
          )
          .all(bibleId) as Array<{ chapter_id: string; fetched_at: number | null }>
      )
        .filter((row) => row.fetched_at !== null && getApiCacheFreshness(row.fetched_at, now) === 'fresh')
        .map((row) => row.chapter_id),
    )
    return chapterIds.filter((id) => !complete.has(id))
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  /** Stores every verse of a passage in one transaction, replacing older rows. */
  putPassage(bibleId: string, passage: ApiBibleCachePassage): void {
    const insert = this.db.prepare(
      `INSERT INTO api_verses
         (bible_id, book_id, book_name, chapter, verse, ciphertext, iv, auth_tag, fetched_at)
       VALUES (@bibleId, @bookId, @bookName, @chapter, @verse, @ciphertext, @iv, @authTag, @fetchedAt)
       ON CONFLICT(bible_id, book_id, chapter, verse) DO UPDATE SET
         book_name = excluded.book_name,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         fetched_at = excluded.fetched_at`,
    )
    const encrypted = passage.verses.map((verse) => ({
      verse,
      value: this.crypto.encrypt(verse.text),
    }))

    const coverage = passage.coverage
    this.db.transaction(() => {
      if (coverage) {
        this.db
          .prepare(
            `INSERT INTO api_ranges (bible_id, book_id, chapter, verse_start, verse_end, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(bible_id, book_id, chapter, verse_start, verse_end)
               DO UPDATE SET fetched_at = excluded.fetched_at`,
          )
          .run(
            bibleId,
            passage.bookId,
            coverage.chapter,
            coverage.verseStart ?? 0,
            coverage.verseEnd ?? Number.MAX_SAFE_INTEGER,
            passage.fetchedAt,
          )
      }
      for (const { verse, value } of encrypted) {
        insert.run({
          bibleId,
          bookId: passage.bookId,
          bookName: passage.bookName,
          chapter: verse.chapter,
          verse: verse.verse,
          ciphertext: value.ciphertext,
          iv: value.iv,
          authTag: value.authTag,
          fetchedAt: passage.fetchedAt,
        })
      }
    })()
  }

  /**
   * Replaces a whole chapter and its completion marker atomically. Existing
   * verses are dropped first so a verse the publisher removed upstream cannot
   * survive a refresh with its old timestamp.
   */
  putChapter(bibleId: string, chapterId: string, passage: ApiBibleCachePassage): void {
    const chapter = passage.coverage?.chapter ?? passage.verses[0]?.chapter
    this.db.transaction(() => {
      if (chapter !== undefined) {
        this.db
          .prepare('DELETE FROM api_verses WHERE bible_id = ? AND book_id = ? AND chapter = ?')
          .run(bibleId, passage.bookId, chapter)
        this.db
          .prepare('DELETE FROM api_ranges WHERE bible_id = ? AND book_id = ? AND chapter = ?')
          .run(bibleId, passage.bookId, chapter)
      }
      this.putPassage(bibleId, { ...passage, coverage: { chapter: chapter ?? 0 } })
      this.markChapterComplete(bibleId, chapterId, passage.fetchedAt)
    })()
  }

  markChapterComplete(bibleId: string, chapterId: string, fetchedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO api_chapters (bible_id, chapter_id, status, fetched_at)
         VALUES (?, ?, 'complete', ?)
         ON CONFLICT(bible_id, chapter_id) DO UPDATE SET status = 'complete', fetched_at = excluded.fetched_at`,
      )
      .run(bibleId, chapterId, fetchedAt)
  }

  removeTranslation(bibleId: string): void {
    this.db.transaction(() => {
      this.purgeContent(bibleId)
      this.db.prepare('DELETE FROM api_translations WHERE bible_id = ?').run(bibleId)
    })()
  }

  /** Test-only row census used to prove removal leaves nothing behind. */
  countRowsForTesting(bibleId: string): { translations: number; verses: number; chapters: number } {
    const count = (table: string): number =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE bible_id = ?`).get(bibleId) as {
        n: number
      }).n
    return {
      translations: count('api_translations'),
      verses: count('api_verses'),
      chapters: count('api_chapters'),
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private getTranslationRow(bibleId: string): TranslationRow | null {
    return (
      (this.db.prepare('SELECT * FROM api_translations WHERE bible_id = ?').get(bibleId) as
        | TranslationRow
        | undefined) ?? null
    )
  }

  private toState(row: TranslationRow, now: number): ApiBibleCacheState {
    const counts = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM api_verses WHERE bible_id = @id) AS verses,
           (SELECT MIN(fetched_at) FROM api_verses WHERE bible_id = @id) AS oldest,
           (SELECT COUNT(*) FROM api_chapters WHERE bible_id = @id AND status = 'complete') AS chapters`,
      )
      .get({ id: row.bible_id }) as { verses: number; oldest: number | null; chapters: number }

    const fetchedAt = counts.oldest
    const expiresAt = fetchedAt === null ? null : fetchedAt + API_CACHE_MAX_AGE_MS

    return {
      bibleId: row.bible_id,
      translation: row.translation_id as ScriptureTranslation,
      name: row.name,
      copyright: row.copyright,
      status: resolveStatus(row.status as ApiBibleCacheStatus, counts, fetchedAt, row.total_chapters, now),
      cachedChapters: counts.chapters,
      totalChapters: row.total_chapters,
      cachedVerses: counts.verses,
      fetchedAt,
      expiresAt,
      ...(row.last_error ? { error: row.last_error } : {}),
    }
  }
}

function resolveStatus(
  stored: ApiBibleCacheStatus,
  counts: { verses: number; chapters: number },
  fetchedAt: number | null,
  totalChapters: number,
  now: number,
): ApiBibleCacheStatus {
  if (stored === 'unavailable' || stored === 'failed') return stored
  if (fetchedAt !== null && getApiCacheFreshness(fetchedAt, now) === 'stale') return 'stale'
  if (stored === 'downloading' || stored === 'paused') return stored
  if (counts.verses === 0) return 'not-downloaded'
  if (totalChapters > 0 && counts.chapters >= totalChapters) return 'downloaded'
  return 'partial'
}

function toEncryptedValue(row: VerseRow): EncryptedValue {
  return { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }
}

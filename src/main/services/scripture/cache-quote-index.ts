import Sqlite from 'better-sqlite3'
import { retrieveGlobalQuote, type GlobalQuoteCandidate } from './global-quote'
import type { CachedQuoteVerse } from './api-bible-cache'

interface SourceRow {
  bible_id: string
  book_id: number
  chapter: number
  verse: number
  translation: string
  fetched_at: number
  expires_at: number
}

interface Statements {
  book: Sqlite.Statement
  verse: Sqlite.Statement
  metadata: Sqlite.Statement
  expireVerses: Sqlite.Statement
  expireSources: Sqlite.Statement
  source: Sqlite.Statement
}

/** Worker-owned transient index. Licensed plaintext never enters a filesystem-backed database. */
export class CacheQuoteIndex {
  private db: Sqlite.Database | null = null
  private stmts: Statements | null = null
  private version = -1
  private ready = false
  /** Earliest expiry held; until then a search has nothing to purge. */
  private nextExpiry = Infinity

  begin(version: number): void {
    this.db?.close()
    this.version = version
    this.ready = false
    this.nextExpiry = Infinity
    const db = new Sqlite(':memory:')
    db.pragma('temp_store = MEMORY')
    db.exec(`CREATE TABLE books (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE VIRTUAL TABLE verses_fts USING fts5(text, translation_id UNINDEXED,
        book_id UNINDEXED, chapter UNINDEXED, verse UNINDEXED);
      CREATE TABLE quote_sources (row_id INTEGER PRIMARY KEY, bible_id TEXT NOT NULL,
        book_id INTEGER NOT NULL, book_name TEXT NOT NULL, chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL, translation TEXT, fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX quote_expiry ON quote_sources(expires_at);
      CREATE INDEX quote_identity ON quote_sources(bible_id,book_name,chapter,verse);`)
    this.db = db
    this.stmts = {
      book: db.prepare('INSERT OR IGNORE INTO books (id,name) VALUES (?,?)'),
      verse: db.prepare('INSERT INTO verses_fts (text,translation_id,book_id,chapter,verse) VALUES (?,?,?,?,?)'),
      metadata: db.prepare(`INSERT INTO quote_sources
        (row_id,bible_id,book_id,book_name,chapter,verse,translation,fetched_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)`),
      expireVerses: db.prepare('DELETE FROM verses_fts WHERE rowid IN (SELECT row_id FROM quote_sources WHERE expires_at <= ?)'),
      expireSources: db.prepare('DELETE FROM quote_sources WHERE expires_at <= ?'),
      source: db.prepare(`SELECT * FROM quote_sources
        WHERE bible_id=? AND book_name=? AND chapter=? AND verse=? AND expires_at > ?`),
    }
  }

  append(version: number, rows: readonly CachedQuoteVerse[]): void {
    if (version !== this.version || !this.db || !this.stmts || this.ready) return
    const { book, verse, metadata } = this.stmts
    this.db.transaction(() => {
      for (const row of rows) {
        const source = row.cacheSource
        book.run(source.bookId, row.book)
        const id = verse.run(row.text, source.bibleId, source.bookId, row.chapter, row.verse).lastInsertRowid
        metadata.run(id, source.bibleId, source.bookId, row.book, row.chapter, row.verse,
          row.translation ?? null, source.fetchedAt, source.expiresAt)
        this.nextExpiry = Math.min(this.nextExpiry, source.expiresAt)
      }
    })()
  }

  commit(version: number): void {
    if (this.version === version) this.ready = true
  }

  search(text: string, now = Date.now()): GlobalQuoteCandidate[] {
    if (!this.db || !this.stmts || !this.ready) return []
    const { expireVerses, expireSources, source } = this.stmts
    // Expiry is enforced here even when main has not processed its expiry timer yet.
    if (now >= this.nextExpiry) {
      expireVerses.run(now)
      expireSources.run(now)
      const next = this.db.prepare('SELECT MIN(expires_at) AS at FROM quote_sources').get() as { at: number | null }
      this.nextExpiry = next.at ?? Infinity
    }
    const candidates: GlobalQuoteCandidate[] = []
    for (const candidate of retrieveGlobalQuote(this.db, text)) {
      const row = source.get(candidate.translation, candidate.book, candidate.chapter, candidate.verse, now) as SourceRow | undefined
      if (row) candidates.push({ ...candidate, translation: row.translation,
        cacheSource: { bibleId: row.bible_id, bookId: row.book_id, chapter: row.chapter,
          verse: row.verse, fetchedAt: row.fetched_at, expiresAt: row.expires_at } })
    }
    return candidates
  }

  close(): void { this.ready = false; this.db?.close(); this.db = null; this.stmts = null }
}

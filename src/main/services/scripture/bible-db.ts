import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import log from 'electron-log/main'

/** Tiny words that drown phrase FTS (e.g. “love is patient”). */
const FTS_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'as', 'it', 'he', 'she', 'we', 'they',
  'my', 'me', 'his', 'her', 'our', 'your', 'their',
])

function significantSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/["*^(){}]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !FTS_STOPWORDS.has(token))
}

/** Prefer near-exact remembered phrases (Psalm 23) over loose token hits. */
function scorePhraseMatch(text: string, query: string, tokens: string[]): number {
  const hay = text
    .toLowerCase()
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const needle = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!hay || !needle) return 0
  if (hay.includes(needle)) return 1000
  if (tokens.length >= 2) {
    const compact = tokens.join(' ')
    if (hay.includes(compact)) return 900
    // Tokens in order with gaps: "lord … shepherd"
    let from = 0
    let inOrder = 0
    for (const token of tokens) {
      const at = hay.indexOf(token, from)
      if (at < 0) break
      inOrder += 1
      from = at + token.length
    }
    if (inOrder === tokens.length) return 500 + inOrder * 20
    return inOrder * 15
  }
  return tokens.some((token) => hay.includes(token)) ? 10 : 0
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BibleVerse {
  translationId: string
  bookId: number
  bookName: string
  bookAbbr: string
  chapter: number
  verse: number
  text: string
}

export interface BibleBook {
  id: number
  name: string
  abbreviation: string
  testament: 'OT' | 'NT'
  aliases: string[]
}

export interface BibleTranslation {
  id: string
  name: string
  language: string
  isDefault: boolean
}

// ─── Book canonical data ──────────────────────────────────────────────────────

interface BookSeed {
  id: number
  name: string
  abbr: string
  testament: 'OT' | 'NT'
  aliases: string[]
}

// prettier-ignore
export const BOOKS: BookSeed[] = [
  // ── Old Testament ──────────────────────────────────────────────────────────
  { id:  1, name: 'Genesis',          abbr: 'Gen',   testament: 'OT', aliases: ['Ge', 'Gn'] },
  { id:  2, name: 'Exodus',           abbr: 'Exod',  testament: 'OT', aliases: ['Ex', 'Exo', 'Exd'] },
  { id:  3, name: 'Leviticus',        abbr: 'Lev',   testament: 'OT', aliases: ['Le', 'Lv'] },
  { id:  4, name: 'Numbers',          abbr: 'Num',   testament: 'OT', aliases: ['Nu', 'Nm', 'Nb'] },
  { id:  5, name: 'Deuteronomy',      abbr: 'Deut',  testament: 'OT', aliases: ['De', 'Dt', 'Deu'] },
  { id:  6, name: 'Joshua',           abbr: 'Josh',  testament: 'OT', aliases: ['Jos', 'Jsh', 'Jo'] },
  { id:  7, name: 'Judges',           abbr: 'Judg',  testament: 'OT', aliases: ['Jdg', 'Jg', 'Jgs', 'Jud'] },
  { id:  8, name: 'Ruth',             abbr: 'Ruth',  testament: 'OT', aliases: ['Ru', 'Rth'] },
  { id:  9, name: '1 Samuel',         abbr: '1Sam',  testament: 'OT', aliases: ['1Sa', '1S', '1 Sa', 'I Sam', 'I Samuel', 'I Sa', '1st Samuel', 'First Samuel', '1 Sm'] },
  { id: 10, name: '2 Samuel',         abbr: '2Sam',  testament: 'OT', aliases: ['2Sa', '2S', '2 Sa', 'II Sam', 'II Samuel', 'II Sa', '2nd Samuel', 'Second Samuel', '2 Sm'] },
  { id: 11, name: '1 Kings',          abbr: '1Kgs',  testament: 'OT', aliases: ['1Ki', '1K', '1 Ki', 'I Kgs', 'I Kings', 'I Ki', '1st Kings', 'First Kings'] },
  { id: 12, name: '2 Kings',          abbr: '2Kgs',  testament: 'OT', aliases: ['2Ki', '2K', '2 Ki', 'II Kgs', 'II Kings', 'II Ki', '2nd Kings', 'Second Kings'] },
  { id: 13, name: '1 Chronicles',     abbr: '1Chr',  testament: 'OT', aliases: ['1Ch', '1 Ch', 'I Chr', 'I Chron', 'I Chronicles', '1st Chronicles', 'First Chronicles', '1 Chron'] },
  { id: 14, name: '2 Chronicles',     abbr: '2Chr',  testament: 'OT', aliases: ['2Ch', '2 Ch', 'II Chr', 'II Chron', 'II Chronicles', '2nd Chronicles', 'Second Chronicles', '2 Chron'] },
  { id: 15, name: 'Ezra',             abbr: 'Ezra',  testament: 'OT', aliases: ['Ezr', 'Ez'] },
  { id: 16, name: 'Nehemiah',         abbr: 'Neh',   testament: 'OT', aliases: ['Ne', 'Neh'] },
  { id: 17, name: 'Esther',           abbr: 'Esth',  testament: 'OT', aliases: ['Est', 'Es'] },
  { id: 18, name: 'Job',              abbr: 'Job',   testament: 'OT', aliases: ['Jb'] },
  { id: 19, name: 'Psalms',           abbr: 'Ps',    testament: 'OT', aliases: ['Psa', 'Pss', 'Psalm', 'Pslm'] },
  { id: 20, name: 'Proverbs',         abbr: 'Prov',  testament: 'OT', aliases: ['Pro', 'Pr', 'Prv'] },
  { id: 21, name: 'Ecclesiastes',     abbr: 'Eccl',  testament: 'OT', aliases: ['Ec', 'Ecc', 'Qoh', 'Qoheleth'] },
  { id: 22, name: 'Song of Solomon',  abbr: 'Song',  testament: 'OT', aliases: ['SOS', 'SS', 'Song of Songs', 'Cant', 'Canticles', 'Sol', 'Sg'] },
  { id: 23, name: 'Isaiah',           abbr: 'Isa',   testament: 'OT', aliases: ['Is', 'Isa'] },
  { id: 24, name: 'Jeremiah',         abbr: 'Jer',   testament: 'OT', aliases: ['Je', 'Jr'] },
  { id: 25, name: 'Lamentations',     abbr: 'Lam',   testament: 'OT', aliases: ['La', 'Lm'] },
  { id: 26, name: 'Ezekiel',          abbr: 'Ezek',  testament: 'OT', aliases: ['Eze', 'Ezk'] },
  { id: 27, name: 'Daniel',           abbr: 'Dan',   testament: 'OT', aliases: ['Da', 'Dn'] },
  { id: 28, name: 'Hosea',            abbr: 'Hos',   testament: 'OT', aliases: ['Ho'] },
  { id: 29, name: 'Joel',             abbr: 'Joel',  testament: 'OT', aliases: ['Jl', 'Joe'] },
  { id: 30, name: 'Amos',             abbr: 'Amos',  testament: 'OT', aliases: ['Am'] },
  { id: 31, name: 'Obadiah',          abbr: 'Obad',  testament: 'OT', aliases: ['Ob', 'Oba'] },
  { id: 32, name: 'Jonah',            abbr: 'Jonah', testament: 'OT', aliases: ['Jon', 'Jnh'] },
  { id: 33, name: 'Micah',            abbr: 'Mic',   testament: 'OT', aliases: ['Mi', 'Mc'] },
  { id: 34, name: 'Nahum',            abbr: 'Nah',   testament: 'OT', aliases: ['Na', 'Nah'] },
  { id: 35, name: 'Habakkuk',         abbr: 'Hab',   testament: 'OT', aliases: ['Hb', 'Hbk'] },
  { id: 36, name: 'Zephaniah',        abbr: 'Zeph',  testament: 'OT', aliases: ['Zep', 'Zp', 'Zph'] },
  { id: 37, name: 'Haggai',           abbr: 'Hag',   testament: 'OT', aliases: ['Hg', 'Hgg'] },
  { id: 38, name: 'Zechariah',        abbr: 'Zech',  testament: 'OT', aliases: ['Zec', 'Zc', 'Zch'] },
  { id: 39, name: 'Malachi',          abbr: 'Mal',   testament: 'OT', aliases: ['Ml', 'Mlc'] },
  // ── New Testament ──────────────────────────────────────────────────────────
  { id: 40, name: 'Matthew',          abbr: 'Matt',  testament: 'NT', aliases: ['Mt', 'Mat'] },
  { id: 41, name: 'Mark',             abbr: 'Mark',  testament: 'NT', aliases: ['Mk', 'Mrk', 'Mr'] },
  { id: 42, name: 'Luke',             abbr: 'Luke',  testament: 'NT', aliases: ['Lk', 'Luk', 'Lu'] },
  { id: 43, name: 'John',             abbr: 'John',  testament: 'NT', aliases: ['Jn', 'Jhn', 'Jo'] },
  { id: 44, name: 'Acts',             abbr: 'Acts',  testament: 'NT', aliases: ['Ac', 'Act'] },
  { id: 45, name: 'Romans',           abbr: 'Rom',   testament: 'NT', aliases: ['Ro', 'Rm'] },
  { id: 46, name: '1 Corinthians',    abbr: '1Cor',  testament: 'NT', aliases: ['1Co', '1 Co', 'I Cor', 'I Corinthians', '1st Corinthians', 'First Corinthians'] },
  { id: 47, name: '2 Corinthians',    abbr: '2Cor',  testament: 'NT', aliases: ['2Co', '2 Co', 'II Cor', 'II Corinthians', '2nd Corinthians', 'Second Corinthians'] },
  { id: 48, name: 'Galatians',        abbr: 'Gal',   testament: 'NT', aliases: ['Ga', 'Gltns'] },
  { id: 49, name: 'Ephesians',        abbr: 'Eph',   testament: 'NT', aliases: ['Ep', 'Ephes'] },
  { id: 50, name: 'Philippians',      abbr: 'Phil',  testament: 'NT', aliases: ['Php', 'Pp', 'Phi'] },
  { id: 51, name: 'Colossians',       abbr: 'Col',   testament: 'NT', aliases: ['Co', 'Colo'] },
  { id: 52, name: '1 Thessalonians',  abbr: '1Thess',testament: 'NT', aliases: ['1Th', '1 Th', 'I Thess', 'I Thessalonians', '1st Thessalonians', 'First Thessalonians', '1Ths'] },
  { id: 53, name: '2 Thessalonians',  abbr: '2Thess',testament: 'NT', aliases: ['2Th', '2 Th', 'II Thess', 'II Thessalonians', '2nd Thessalonians', 'Second Thessalonians', '2Ths'] },
  { id: 54, name: '1 Timothy',        abbr: '1Tim',  testament: 'NT', aliases: ['1Ti', '1 Ti', 'I Tim', 'I Timothy', '1st Timothy', 'First Timothy'] },
  { id: 55, name: '2 Timothy',        abbr: '2Tim',  testament: 'NT', aliases: ['2Ti', '2 Ti', 'II Tim', 'II Timothy', '2nd Timothy', 'Second Timothy'] },
  { id: 56, name: 'Titus',            abbr: 'Titus', testament: 'NT', aliases: ['Tit', 'Ti'] },
  { id: 57, name: 'Philemon',         abbr: 'Phlm',  testament: 'NT', aliases: ['Phm', 'Pm', 'Phile'] },
  { id: 58, name: 'Hebrews',          abbr: 'Heb',   testament: 'NT', aliases: ['He', 'Hebr'] },
  { id: 59, name: 'James',            abbr: 'Jas',   testament: 'NT', aliases: ['Jm', 'Jms', 'Jam'] },
  { id: 60, name: '1 Peter',          abbr: '1Pet',  testament: 'NT', aliases: ['1Pe', '1P', '1 Pe', 'I Pet', 'I Peter', '1st Peter', 'First Peter'] },
  { id: 61, name: '2 Peter',          abbr: '2Pet',  testament: 'NT', aliases: ['2Pe', '2P', '2 Pe', 'II Pet', 'II Peter', '2nd Peter', 'Second Peter'] },
  { id: 62, name: '1 John',           abbr: '1John', testament: 'NT', aliases: ['1Jn', '1J', '1 Jn', 'I Jn', 'I John', '1st John', 'First John'] },
  { id: 63, name: '2 John',           abbr: '2John', testament: 'NT', aliases: ['2Jn', '2J', '2 Jn', 'II Jn', 'II John', '2nd John', 'Second John'] },
  { id: 64, name: '3 John',           abbr: '3John', testament: 'NT', aliases: ['3Jn', '3J', '3 Jn', 'III Jn', 'III John', '3rd John', 'Third John'] },
  { id: 65, name: 'Jude',             abbr: 'Jude',  testament: 'NT', aliases: ['Jud', 'Jd'] },
  { id: 66, name: 'Revelation',       abbr: 'Rev',   testament: 'NT', aliases: ['Re', 'Rv', 'Apoc', 'Apocalypse'] },
]

// ─── SQL ──────────────────────────────────────────────────────────────────────

const SQL_CREATE_TRANSLATIONS = `
  CREATE TABLE IF NOT EXISTS translations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    language   TEXT NOT NULL DEFAULT 'en',
    is_default INTEGER NOT NULL DEFAULT 0
  )`

const SQL_CREATE_BOOKS = `
  CREATE TABLE IF NOT EXISTS books (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    abbreviation TEXT NOT NULL,
    testament    TEXT NOT NULL CHECK(testament IN ('OT', 'NT')),
    aliases      TEXT NOT NULL DEFAULT '[]'
  )`

const SQL_CREATE_VERSES = `
  CREATE TABLE IF NOT EXISTS verses (
    translation_id TEXT    NOT NULL REFERENCES translations(id),
    book_id        INTEGER NOT NULL REFERENCES books(id),
    chapter        INTEGER NOT NULL,
    verse          INTEGER NOT NULL,
    text           TEXT    NOT NULL,
    PRIMARY KEY (translation_id, book_id, chapter, verse)
  )`

const SQL_CREATE_VERSES_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_verses_lookup
    ON verses (translation_id, book_id, chapter, verse)`

const SQL_CREATE_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(
    text,
    translation_id UNINDEXED,
    book_id        UNINDEXED,
    chapter        UNINDEXED,
    verse          UNINDEXED
  )`

// ─── Row shapes (internal) ────────────────────────────────────────────────────

interface VerseRow {
  translation_id: string
  book_id: number
  chapter: number
  verse: number
  text: string
  book_name: string
  book_abbr: string
}

interface TranslationRow {
  id: string
  name: string
  language: string
  is_default: number
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class BibleDatabase {
  private db: BetterSqlite3.Database
  // Normalized alias → book id (built on open)
  private bookLookup = new Map<string, number>()

  // Prepared statements (lazy-initialized once schema exists)
  private stmts!: {
    getVerse:      BetterSqlite3.Statement
    getRange:      BetterSqlite3.Statement
    getChapter:    BetterSqlite3.Statement
    searchFts:     BetterSqlite3.Statement
    searchLike:    BetterSqlite3.Statement
    getTranslations: BetterSqlite3.Statement
    getRandom:     BetterSqlite3.Statement
    getRandomInTx: BetterSqlite3.Statement
    insertTranslation: BetterSqlite3.Statement
    insertVerse:   BetterSqlite3.Statement
    insertFts:     BetterSqlite3.Statement
    verseCount:    BetterSqlite3.Statement
    hasTranslation: BetterSqlite3.Statement
    setDefault:    BetterSqlite3.Statement
  }

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')
    this.initSchema()
    this.buildBookLookup()
    this.prepareStatements()
    log.info('[BibleDB] Opened', { path: dbPath })
  }

  // ─── Schema & setup ────────────────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(SQL_CREATE_TRANSLATIONS)
    this.db.exec(SQL_CREATE_BOOKS)
    this.db.exec(SQL_CREATE_VERSES)
    this.db.exec(SQL_CREATE_VERSES_INDEX)
    this.db.exec(SQL_CREATE_FTS)
    this.seedBooks()
  }

  private seedBooks(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as n FROM books').get() as { n: number }).n
    if (count === 66) return

    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO books (id, name, abbreviation, testament, aliases) VALUES (?, ?, ?, ?, ?)'
    )
    const tx = this.db.transaction(() => {
      for (const b of BOOKS) {
        insert.run(b.id, b.name, b.abbr, b.testament, JSON.stringify(b.aliases))
      }
    })
    tx()
    log.info('[BibleDB] Book table seeded (66 books)')
  }

  private buildBookLookup(): void {
    this.bookLookup.clear()

    const rows = this.db.prepare('SELECT id, name, abbreviation, aliases FROM books').all() as Array<{
      id: number
      name: string
      abbreviation: string
      aliases: string
    }>

    for (const row of rows) {
      const add = (s: string): void => {
        if (!s) return
        // Store with-space and without-space variants
        const key = s.toLowerCase().replace(/\s+/g, ' ').trim()
        const compact = s.toLowerCase().replace(/\s+/g, '')
        if (!this.bookLookup.has(key)) this.bookLookup.set(key, row.id)
        if (!this.bookLookup.has(compact)) this.bookLookup.set(compact, row.id)
        // Strip trailing periods ("Gen." → "gen")
        const stripped = key.replace(/\.+$/, '')
        if (!this.bookLookup.has(stripped)) this.bookLookup.set(stripped, row.id)
      }

      add(row.name)
      add(row.abbreviation)

      let aliases: string[] = []
      try { aliases = JSON.parse(row.aliases) } catch { /* ignore */ }
      for (const a of aliases) add(a)
    }
  }

  private prepareStatements(): void {
    this.stmts = {
      getVerse: this.db.prepare(`
        SELECT v.*, b.name as book_name, b.abbreviation as book_abbr
          FROM verses v JOIN books b ON b.id = v.book_id
         WHERE v.translation_id = ? AND v.book_id = ? AND v.chapter = ? AND v.verse = ?
      `),
      getRange: this.db.prepare(`
        SELECT v.*, b.name as book_name, b.abbreviation as book_abbr
          FROM verses v JOIN books b ON b.id = v.book_id
         WHERE v.translation_id = ? AND v.book_id = ? AND v.chapter = ?
           AND v.verse >= ? AND v.verse <= ?
         ORDER BY v.verse
      `),
      getChapter: this.db.prepare(`
        SELECT v.*, b.name as book_name, b.abbreviation as book_abbr
          FROM verses v JOIN books b ON b.id = v.book_id
         WHERE v.translation_id = ? AND v.book_id = ? AND v.chapter = ?
         ORDER BY v.verse
      `),
      searchFts: this.db.prepare(`
        SELECT b.name as book_name, b.abbreviation as book_abbr,
               f.translation_id, CAST(f.book_id AS INTEGER) as book_id,
               CAST(f.chapter AS INTEGER) as chapter,
               CAST(f.verse AS INTEGER) as verse, f.text
          FROM verses_fts f JOIN books b ON b.id = CAST(f.book_id AS INTEGER)
         WHERE verses_fts MATCH ?
           AND (? IS NULL OR f.translation_id = ?)
         ORDER BY rank
         LIMIT 50
      `),
      searchLike: this.db.prepare(`
        SELECT v.*, b.name as book_name, b.abbreviation as book_abbr
          FROM verses v JOIN books b ON b.id = v.book_id
         WHERE v.text LIKE ?
           AND (? IS NULL OR v.translation_id = ?)
         LIMIT 50
      `),
      getTranslations: this.db.prepare('SELECT * FROM translations ORDER BY is_default DESC, name'),
      getRandom: this.db.prepare(`
        SELECT v.*, b.name as book_name, b.abbreviation as book_abbr
          FROM verses v JOIN books b ON b.id = v.book_id
         WHERE v.translation_id = (
           SELECT id FROM translations WHERE is_default = 1 LIMIT 1
         )
         ORDER BY RANDOM() LIMIT 1
      `),
      getRandomInTx: this.db.prepare(`
        SELECT v.*, b.name as book_name, b.abbreviation as book_abbr
          FROM verses v JOIN books b ON b.id = v.book_id
         WHERE v.translation_id = ?
         ORDER BY RANDOM() LIMIT 1
      `),
      insertTranslation: this.db.prepare(
        'INSERT OR REPLACE INTO translations (id, name, language, is_default) VALUES (?, ?, ?, ?)'
      ),
      insertVerse: this.db.prepare(
        'INSERT OR REPLACE INTO verses (translation_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)'
      ),
      insertFts: this.db.prepare(
        'INSERT INTO verses_fts (text, translation_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)'
      ),
      verseCount: this.db.prepare(
        'SELECT COUNT(*) as n FROM verses WHERE translation_id = ?'
      ),
      hasTranslation: this.db.prepare(
        'SELECT COUNT(*) as n FROM translations WHERE id = ?'
      ),
      setDefault: this.db.prepare(
        'UPDATE translations SET is_default = (CASE WHEN id = ? THEN 1 ELSE 0 END)'
      ),
    }
  }

  // ─── Query methods ─────────────────────────────────────────────────────────

  getVerse(translation: string, book: number | string, chapter: number, verse: number): BibleVerse | null {
    const bookId = this.resolveBookId(book)
    if (!bookId) return null
    const row = this.stmts.getVerse.get(translation, bookId, chapter, verse) as VerseRow | undefined
    return row ? rowToVerse(row) : null
  }

  getVerseRange(
    translation: string,
    book: number | string,
    chapter: number,
    startVerse: number,
    endVerse: number
  ): BibleVerse[] {
    const bookId = this.resolveBookId(book)
    if (!bookId) return []
    const rows = this.stmts.getRange.all(translation, bookId, chapter, startVerse, endVerse) as VerseRow[]
    return rows.map(rowToVerse)
  }

  getChapter(translation: string, book: number | string, chapter: number): BibleVerse[] {
    const bookId = this.resolveBookId(book)
    if (!bookId) return []
    const rows = this.stmts.getChapter.all(translation, bookId, chapter) as VerseRow[]
    return rows.map(rowToVerse)
  }

  searchText(query: string, translation?: string, limit = 50): BibleVerse[] {
    const tx = translation ?? null
    const cleaned = query.replace(/["*^()]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!cleaned) return []

    const tokens = significantSearchTokens(cleaned)
    const ftsQuery = tokens.length > 0 ? tokens.join(' ') : cleaned
    const seen = new Set<string>()
    const scored: Array<{ verse: BibleVerse; score: number }> = []

    const pushRows = (rows: VerseRow[]): void => {
      for (const row of rows) {
        const key = `${row.translation_id}:${row.book_id}:${row.chapter}:${row.verse}`
        if (seen.has(key)) continue
        seen.add(key)
        const verse = rowToVerse(row)
        const score = scorePhraseMatch(verse.text, cleaned, tokens)
        if (score <= 0 && tokens.length >= 2) continue
        scored.push({ verse, score })
      }
    }

    try {
      pushRows(this.stmts.searchFts.all(ftsQuery, tx, tx) as VerseRow[])
    } catch {
      // Fall through to LIKE
    }

    // Exact-ish phrase pass (helps when FTS token order is noisy).
    if (tokens.length >= 2) {
      const likeNeedle = `%${tokens.join('%')}%`
      try {
        pushRows(this.stmts.searchLike.all(likeNeedle, tx, tx) as VerseRow[])
      } catch {
        // ignore
      }
    }

    if (scored.length === 0) {
      try {
        pushRows(this.stmts.searchLike.all(`%${cleaned}%`, tx, tx) as VerseRow[])
      } catch {
        // ignore
      }
    }

    return scored
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.verse)
  }

  resolveBookName(input: string): BibleBook | null {
    const bookId = this.resolveBookId(input)
    if (!bookId) return null
    const row = this.db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as {
      id: number; name: string; abbreviation: string; testament: string; aliases: string
    } | undefined
    if (!row) return null
    return {
      id:           row.id,
      name:         row.name,
      abbreviation: row.abbreviation,
      testament:    row.testament as 'OT' | 'NT',
      aliases:      JSON.parse(row.aliases) as string[],
    }
  }

  getAllTranslations(): BibleTranslation[] {
    const rows = this.stmts.getTranslations.all() as TranslationRow[]
    return rows.map((r) => ({
      id:        r.id,
      name:      r.name,
      language:  r.language,
      isDefault: r.is_default === 1,
    }))
  }

  getRandomVerse(translation?: string): BibleVerse | null {
    const row = translation
      ? (this.stmts.getRandomInTx.get(translation) as VerseRow | undefined)
      : (this.stmts.getRandom.get() as VerseRow | undefined)
    return row ? rowToVerse(row) : null
  }

  // ─── Import helpers (called by seed script / startup seeder) ──────────────

  hasTranslation(id: string): boolean {
    const row = this.stmts.hasTranslation.get(id) as { n: number }
    return row.n > 0
  }

  getVerseCount(translationId: string): number {
    const row = this.stmts.verseCount.get(translationId) as { n: number }
    return row.n
  }

  setDefaultTranslation(id: string): void {
    this.stmts.setDefault.run(id)
  }

  /** Bulk-insert all verses for a translation in a single WAL transaction. */
  importTranslation(
    id: string,
    name: string,
    language: string,
    verses: Array<{ bookId: number; chapter: number; verse: number; text: string }>,
    isDefault = false,
    onProgress?: (inserted: number, total: number) => void
  ): void {
    // Clear existing FTS entries for this translation first
    this.db.prepare('DELETE FROM verses_fts WHERE translation_id = ?').run(id)
    this.stmts.insertTranslation.run(id, name, language, isDefault ? 1 : 0)

    const BATCH = 2_000
    const total = verses.length

    for (let offset = 0; offset < total; offset += BATCH) {
      const batch = verses.slice(offset, offset + BATCH)
      const tx = this.db.transaction(() => {
        for (const v of batch) {
          this.stmts.insertVerse.run(id, v.bookId, v.chapter, v.verse, v.text)
          this.stmts.insertFts.run(v.text, id, v.bookId, v.chapter, v.verse)
        }
      })
      tx()
      onProgress?.(Math.min(offset + BATCH, total), total)
    }

    log.info('[BibleDB] Translation imported', { id, verses: total })
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private resolveBookId(book: number | string): number | null {
    if (typeof book === 'number') return book >= 1 && book <= 66 ? book : null

    const normalized = book.toLowerCase().replace(/\s+/g, ' ').trim()
    const compact    = book.toLowerCase().replace(/\s+/g, '')
    const stripped   = normalized.replace(/\.+$/, '')

    return (
      this.bookLookup.get(normalized) ??
      this.bookLookup.get(compact) ??
      this.bookLookup.get(stripped) ??
      this.fuzzyBookMatch(normalized) ??
      null
    )
  }

  /**
   * Last-resort: find the book whose name/abbr starts with the input,
   * or where the input starts with the book's key. Handles partial input
   * like "Phi" matching "Philippians".
   */
  private fuzzyBookMatch(input: string): number | undefined {
    if (input.length < 2) return undefined

    // Find first key that starts with the input (prefix match)
    for (const [key, id] of this.bookLookup) {
      if (key.startsWith(input) && !key.includes(' ')) return id
    }
    // Or where a multi-word book name starts with the input
    for (const [key, id] of this.bookLookup) {
      if (key.startsWith(input)) return id
    }
    return undefined
  }

  close(): void {
    this.db.close()
  }
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToVerse(row: VerseRow): BibleVerse {
  return {
    translationId: row.translation_id,
    bookId:        row.book_id,
    bookName:      row.book_name,
    bookAbbr:      row.book_abbr,
    chapter:       row.chapter,
    verse:         row.verse,
    text:          row.text,
  }
}

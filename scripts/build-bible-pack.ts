/**
 * NKJV Bible pack converter.
 *
 * Builds an installable SQLite pack containing ONLY the NKJV translation from
 * a user-supplied JSON file, so NKJV can work fully offline after an optional
 * in-app install — without bundling its text in the application installer.
 *
 * The source JSON and the generated pack are never committed: output defaults
 * under bible-packs/ (gitignored). Licensing/distribution of the NKJV text is
 * unresolved — this script builds a pack locally from a file the operator
 * already holds; it adds no download URL and publishes nothing.
 *
 * Run (better-sqlite3 is built for Electron, so run under Electron-as-Node):
 *   npm run build:bible-pack -- --input /path/to/nkjv.json --output bible-packs/nkjv-pack.db
 *   npm run build:bible-pack -- --input /path/to/nkjv.json --output bible-packs/nkjv-pack.db --force
 *
 * Expected source shape:
 *   { translation: { abbrev: 'NKJV', ... },
 *     books: [{ index: 1, name: 'Genesis', chapters: [{ chapter: 1, verses: [{ verse: 1, text: '…' }] }] }] }
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { gzipSync } from 'zlib'
import { dirname, resolve } from 'path'
import { BOOKS } from '../src/main/services/scripture/bible-db'
import {
  NKJV_PACK_EXPECTED,
  validatePackRows,
  type PackVerseRow,
} from '../src/main/services/scripture/local-bible-pack'

// ─── Source JSON shapes ───────────────────────────────────────────────────────

interface SourceVerse {
  verse: number
  text: string
}

interface SourceChapter {
  chapter: number
  verses: SourceVerse[]
}

interface SourceBook {
  index: number
  name: string
  chapters: SourceChapter[]
}

interface SourceFile {
  translation: {
    abbrev: string
    name?: string
    language?: string
  }
  books: SourceBook[]
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

export interface ConverterOptions {
  input: string
  output: string
  force: boolean
}

export function parseConverterArgs(argv: string[]): ConverterOptions {
  let input: string | null = null
  let output: string | null = null
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input' && argv[i + 1]) {
      input = argv[++i] as string
    } else if (arg === '--output' && argv[i + 1]) {
      output = argv[++i] as string
    } else if (arg === '--force') {
      force = true
    } else {
      throw new Error(
        `Unknown argument "${arg}". Usage: --input <nkjv.json> --output <pack.db> [--force]`,
      )
    }
  }

  if (!input) {
    throw new Error('Missing required --input <nkjv.json>.')
  }

  return {
    input: resolve(input),
    output: resolve(output ?? 'bible-packs/nkjv-pack.db'),
    force,
  }
}

// ─── Validation + flatten ─────────────────────────────────────────────────────

function fail(message: string): never {
  throw new Error(`[nkjv-pack] ${message}`)
}

/** Parse the nested source JSON and flatten it to canonical verse rows. */
export function parseNkjvSource(raw: unknown): { rows: PackVerseRow[]; name: string; language: string } {
  if (!raw || typeof raw !== 'object') fail('source is not a JSON object')
  const source = raw as Partial<SourceFile>

  const abbrev = source.translation?.abbrev
  if (abbrev !== NKJV_PACK_EXPECTED.translationId) {
    fail(`expected translation abbrev "NKJV", found ${JSON.stringify(abbrev)}`)
  }
  const name = source.translation?.name ?? NKJV_PACK_EXPECTED.translationName
  const language = source.translation?.language ?? 'en'

  if (!Array.isArray(source.books)) fail('source has no "books" array')
  const books = source.books as SourceBook[]

  if (books.length !== NKJV_PACK_EXPECTED.books) {
    fail(`expected ${NKJV_PACK_EXPECTED.books} books, found ${books.length}`)
  }

  const rows: PackVerseRow[] = []
  const seen = new Set<string>()

  for (let i = 0; i < books.length; i++) {
    const book = books[i] as SourceBook
    const expected = BOOKS[i] as (typeof BOOKS)[number]
    const bookId = i + 1

    if (book.index !== bookId) {
      fail(`book at position ${bookId} has index ${JSON.stringify(book.index)}`)
    }
    if (book.name !== expected.name) {
      fail(
        `book ${bookId} out of canonical order: expected "${expected.name}", found ${JSON.stringify(book.name)}`,
      )
    }
    if (!Array.isArray(book.chapters) || book.chapters.length === 0) {
      fail(`book "${book.name}" has no chapters`)
    }

    for (let c = 0; c < book.chapters.length; c++) {
      const chapter = book.chapters[c] as SourceChapter
      const chapterNum = c + 1
      if (chapter.chapter !== chapterNum) {
        fail(`book "${book.name}": expected chapter ${chapterNum}, found ${JSON.stringify(chapter.chapter)}`)
      }
      if (!Array.isArray(chapter.verses) || chapter.verses.length === 0) {
        fail(`book "${book.name}" chapter ${chapterNum} has no verses`)
      }

      for (let v = 0; v < chapter.verses.length; v++) {
        const verse = chapter.verses[v] as SourceVerse
        const verseNum = v + 1
        if (verse.verse !== verseNum) {
          fail(
            `book "${book.name}" chapter ${chapterNum}: expected verse ${verseNum}, found ${JSON.stringify(verse.verse)}`,
          )
        }
        if (typeof verse.text !== 'string' || verse.text.trim() === '') {
          fail(`empty verse text at ${book.name} ${chapterNum}:${verseNum}`)
        }
        const key = `${bookId}:${chapterNum}:${verseNum}`
        if (seen.has(key)) fail(`duplicate reference ${key}`)
        seen.add(key)
        rows.push({ bookId, chapter: chapterNum, verse: verseNum, text: verse.text })
      }
    }
  }

  return { rows, name, language }
}

// ─── Pack writing ─────────────────────────────────────────────────────────────

const PACK_SCHEMA = `
  CREATE TABLE translations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    language   TEXT NOT NULL DEFAULT 'en',
    is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE books (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    abbreviation TEXT NOT NULL,
    testament    TEXT NOT NULL CHECK(testament IN ('OT', 'NT')),
    aliases      TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE verses (
    translation_id TEXT    NOT NULL REFERENCES translations(id),
    book_id        INTEGER NOT NULL REFERENCES books(id),
    chapter        INTEGER NOT NULL,
    verse          INTEGER NOT NULL,
    text           TEXT    NOT NULL,
    PRIMARY KEY (translation_id, book_id, chapter, verse)
  );
  CREATE INDEX idx_verses_lookup
    ON verses (translation_id, book_id, chapter, verse);
  CREATE VIRTUAL TABLE verses_fts USING fts5(
    text,
    translation_id UNINDEXED,
    book_id        UNINDEXED,
    chapter        UNINDEXED,
    verse          UNINDEXED
  );
`

export interface BuiltPack {
  path: string
  verseCount: number
  byteSize: number
  gzipSize: number
}

/**
 * Write a validated NKJV pack to disk. Refuses to overwrite an existing file
 * unless `force` is set. Deterministic: rows are inserted in canonical order
 * and the database is VACUUMed, so the same input yields the same bytes
 * apart from SQLite file-level metadata.
 */
export function writePackFile(
  validated: { rows: PackVerseRow[]; name: string; language: string },
  outputPath: string,
  force: boolean,
): BuiltPack {
  if (existsSync(outputPath) && !force) {
    fail(`output already exists: ${outputPath} (pass --force to overwrite)`)
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  if (existsSync(outputPath)) unlinkSync(outputPath)

  const db = new Database(outputPath)
  try {
    db.pragma('journal_mode = DELETE')
    db.exec(PACK_SCHEMA)

    const insertBook = db.prepare(
      'INSERT INTO books (id, name, abbreviation, testament, aliases) VALUES (?, ?, ?, ?, ?)',
    )
    const seedBooks = db.transaction(() => {
      for (const b of BOOKS) {
        insertBook.run(b.id, b.name, b.abbr, b.testament, JSON.stringify(b.aliases))
      }
    })
    seedBooks()

    db.prepare('INSERT INTO translations (id, name, language, is_default) VALUES (?, ?, ?, 0)').run(
      NKJV_PACK_EXPECTED.translationId,
      validated.name,
      validated.language,
    )

    const insertVerse = db.prepare(
      'INSERT INTO verses (translation_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)',
    )
    const insertFts = db.prepare(
      'INSERT INTO verses_fts (text, translation_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)',
    )
    const insertAll = db.transaction(() => {
      for (const row of validated.rows) {
        insertVerse.run(NKJV_PACK_EXPECTED.translationId, row.bookId, row.chapter, row.verse, row.text)
        insertFts.run(row.text, NKJV_PACK_EXPECTED.translationId, row.bookId, row.chapter, row.verse)
      }
    })
    insertAll()

    db.exec('VACUUM')
  } finally {
    db.close()
  }

  const { size } = statSync(outputPath)
  return { path: outputPath, verseCount: validated.rows.length, byteSize: size, gzipSize: -1 }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function buildBiblePack(argv: string[]): Promise<BuiltPack> {
  const options = parseConverterArgs(argv)

  if (!existsSync(options.input)) {
    fail(`input not found: ${options.input}`)
  }

  const { readFileSync } = await import('fs')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(options.input, 'utf8'))
  } catch (error) {
    fail(`could not parse ${options.input}: ${(error as Error).message}`)
  }

  const { rows, name, language } = parseNkjvSource(raw)

  // Structural totals / contiguity / duplicates, shared with the installer.
  const validated = validatePackRows(
    name,
    language,
    rows.map((row) => ({ ...row })),
  )

  const built = writePackFile({ rows, name, language }, options.output, options.force)

  // Compressed size for the completion report (measured, not stored).
  const gzipSize = gzipSync(readFileSync(options.output)).length

  const result = { ...built, verseCount: validated.verseCount, gzipSize }
  process.stdout.write(
    [
      `Bible pack written: ${result.path}`,
      `Verses: ${result.verseCount.toLocaleString()}`,
      `Size: ${(result.byteSize / 1048576).toFixed(2)} MB (${result.byteSize.toLocaleString()} bytes)`,
      `Gzip: ${(result.gzipSize / 1048576).toFixed(2)} MB (${result.gzipSize.toLocaleString()} bytes)`,
    ].join('\n') + '\n',
  )
  return result
}

const invokedAsScript =
  typeof process.argv[1] === 'string' && process.argv[1].endsWith('build-bible-pack.ts')

if (invokedAsScript) {
  buildBiblePack(process.argv.slice(2)).catch((error: Error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}

/**
 * Bible pack converter (generic — NKJV was the first pack, not the only one).
 *
 * Builds an installable SQLite pack containing ONLY one translation from
 * a user-supplied JSON file, so that translation can work fully offline after
 * an optional in-app install — without bundling its text in the installer.
 *
 * The source JSON and the generated pack are never committed: output defaults
 * under bible-packs/ (gitignored). Licensing/distribution of the text is
 * unresolved — this script builds a pack locally from a file the operator
 * already holds; it adds no download URL and publishes nothing.
 *
 * Run (better-sqlite3 is built for Electron, so run under Electron-as-Node):
 *   npm run build:bible-pack -- --input /path/to/nkjv.json --output bible-packs/nkjv-pack.db
 *   npm run build:bible-pack -- --input /path/to/esv.json --output bible-packs/esv-pack.db --translation ESV --name "English Standard Version" --force
 *
 * Expected source shape:
 *   { translation: { abbrev: 'NKJV', ... },
 *     books: [{ index: 1, name: 'Genesis', chapters: [{ chapter: 1, verses: [{ verse: 1, text: '…' }] }] }] }
 *
 * To add a new translation pack: supply its JSON with --translation <ID>.
 * No code change needed — validation is structural (canonical 66-book canon).
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { gzipSync } from 'zlib'
import { dirname, resolve } from 'path'
import { BOOKS } from '../src/main/services/scripture/bible-db'
import { validatePackRowsFor, type PackVerseRow } from '../src/main/services/scripture/local-bible-pack'
import { DEFAULT_TRANSLATION_ID } from '../src/lib/bible-translations'

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
  /** Translation id the source must carry, e.g. 'NKJV'. Defaults to NKJV. */
  translation: string
  /** Override for the translation display name (defaults to the source JSON). */
  name?: string
  /** Override for the translation language (defaults to the source JSON). */
  language?: string
}

export function parseConverterArgs(argv: string[]): ConverterOptions {
  let input: string | null = null
  let output: string | null = null
  let force = false
  let translation: string = DEFAULT_TRANSLATION_ID
  let name: string | undefined
  let language: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input' && argv[i + 1]) {
      input = argv[++i] as string
    } else if (arg === '--output' && argv[i + 1]) {
      output = argv[++i] as string
    } else if (arg === '--translation' && argv[i + 1]) {
      translation = (argv[++i] as string).toUpperCase()
    } else if (arg === '--name' && argv[i + 1]) {
      name = argv[++i] as string
    } else if (arg === '--language' && argv[i + 1]) {
      language = argv[++i] as string
    } else if (arg === '--force') {
      force = true
    } else {
      throw new Error(
        `Unknown argument "${arg}". Usage: --input <bible.json> --output <pack.db> [--translation <ID>] [--name <name>] [--language <lang>] [--force]`,
      )
    }
  }

  if (!input) {
    throw new Error('Missing required --input <bible.json>.')
  }

  return {
    input: resolve(input),
    output: resolve(output ?? `bible-packs/${translation.toLowerCase()}-pack.db`),
    force,
    translation,
    name,
    language,
  }
}

// ─── Validation + flatten ─────────────────────────────────────────────────────

function fail(message: string): never {
  throw new Error(`[bible-pack] ${message}`)
}

/**
 * Parse the nested source JSON and flatten it to canonical verse rows.
 * `expectedId` defaults to NKJV so existing callers keep working; pass any
 * translation id to build a pack for a new translation with no code change.
 */
export function parsePackSource(
  raw: unknown,
  expectedId: string = DEFAULT_TRANSLATION_ID,
): { rows: PackVerseRow[]; name: string; language: string; translationId: string } {
  if (!raw || typeof raw !== 'object') fail('source is not a JSON object')
  const source = raw as Partial<SourceFile>

  const abbrev = source.translation?.abbrev
  const translationId = (abbrev ?? '').toUpperCase()
  if (translationId !== expectedId.toUpperCase()) {
    fail(`expected translation abbrev "${expectedId.toUpperCase()}", found ${JSON.stringify(abbrev)}`)
  }
  const name = source.translation?.name ?? translationId
  const language = source.translation?.language ?? 'en'

  if (!Array.isArray(source.books)) fail('source has no "books" array')
  const books = source.books as SourceBook[]

  const expectedBooks = BOOKS.length
  if (books.length !== expectedBooks) {
    fail(`expected ${expectedBooks} books, found ${books.length}`)
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

  return { rows, name, language, translationId }
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
 * Write a validated pack to disk. Refuses to overwrite an existing file
 * unless `force` is set. Deterministic: rows are inserted in canonical order
 * and the database is VACUUMed, so the same input yields the same bytes
 * apart from SQLite file-level metadata.
 *
 * `translationId` defaults to NKJV for existing callers; pass any id to build
 * a pack for a new translation.
 */
export function writePackFile(
  validated: { rows: PackVerseRow[]; name: string; language: string },
  outputPath: string,
  force: boolean,
  translationId: string = DEFAULT_TRANSLATION_ID,
): BuiltPack {
  const normalized = translationId.toUpperCase()
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
      normalized,
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
        insertVerse.run(normalized, row.bookId, row.chapter, row.verse, row.text)
        insertFts.run(row.text, normalized, row.bookId, row.chapter, row.verse)
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

  const parsed = parsePackSource(raw, options.translation)
  const name = options.name ?? parsed.name
  const language = options.language ?? parsed.language

  // Structural totals / contiguity / duplicates, shared with the installer.
  const validated = validatePackRowsFor(
    options.translation,
    name,
    language,
    parsed.rows.map((row) => ({ ...row })),
  )

  const built = writePackFile({ rows: parsed.rows, name, language }, options.output, options.force, options.translation)

  // Compressed size for the completion report (measured, not stored).
  const gzipSize = gzipSync(readFileSync(options.output)).length

  const result = { ...built, verseCount: validated.verseCount, gzipSize }
  process.stdout.write(
    [
      `Bible pack written: ${result.path}`,
      `Translation: ${options.translation}`,
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

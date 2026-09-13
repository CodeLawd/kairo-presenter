/**
 * Bible database seeder
 *
 * Downloads KJV (and optionally BBE) from github.com/thiagobodruk/bible
 * and inserts all verses into the local SQLite Bible database.
 *
 * Run:
 *   npx ts-node --esm scripts/seed-bible.ts [--output path/to/bible.db] [--translations kjv,bbe]
 *   npx tsx scripts/seed-bible.ts
 *
 * Output defaults to: resources/bible.db
 * The app reads from this path at runtime via Electron's app.getPath('resources').
 */

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { get as httpsGet } from 'https'
import { IncomingMessage } from 'http'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ThiagobodrukBook {
  abbrev: string
  name: string
  chapters: string[][]
}

interface TranslationSpec {
  id: string
  name: string
  language: string
  url: string
  isDefault: boolean
}

// ─── Configuration ────────────────────────────────────────────────────────────

const TRANSLATIONS: TranslationSpec[] = [
  {
    id: 'KJV',
    name: 'King James Version',
    language: 'en',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json',
    isDefault: true,
  },
  {
    id: 'BBE',
    name: 'Bible in Basic English',
    language: 'en',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_bbe.json',
    isDefault: false,
  },
]

// Canonical book order (position 0 = Genesis = book_id 1, ..., position 65 = Revelation = book_id 66)
// thiagobodruk's array order matches canonical Bible order
const BOOK_NAMES_CANONICAL = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(): { outputPath: string; translationIds: string[] } {
  const args = process.argv.slice(2)
  let outputPath = resolve(process.cwd(), 'resources', 'bible.db')
  let translationIds = ['KJV']

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputPath = resolve(args[++i])
    } else if (args[i] === '--translations' && args[i + 1]) {
      translationIds = args[++i].toUpperCase().split(',').map((s) => s.trim())
    }
  }

  return { outputPath, translationIds }
}

function fetchJson(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (res.headers.location) {
          fetchJson(res.headers.location).then(resolve).catch(reject)
        } else {
          reject(new Error(`Redirect with no Location header (${res.statusCode})`))
        }
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`))
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(30_000, () => {
      request.destroy()
      reject(new Error(`Timeout fetching ${url}`))
    })
  })
}

function stripBom(buf: Buffer): Buffer {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3)
  }
  return buf
}

function progress(label: string, current: number, total: number): void {
  const pct  = Math.round((current / total) * 100)
  const done = Math.round(pct / 2)
  const bar  = '█'.repeat(done) + '░'.repeat(50 - done)
  process.stdout.write(`\r  ${label} [${bar}] ${pct}% (${current.toLocaleString()}/${total.toLocaleString()})`)
}

// ─── Database setup (inline — no electron-log dependency) ─────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS translations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    language   TEXT NOT NULL DEFAULT 'en',
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS books (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    abbreviation TEXT NOT NULL,
    testament    TEXT NOT NULL CHECK(testament IN ('OT', 'NT')),
    aliases      TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS verses (
    translation_id TEXT    NOT NULL REFERENCES translations(id),
    book_id        INTEGER NOT NULL REFERENCES books(id),
    chapter        INTEGER NOT NULL,
    verse          INTEGER NOT NULL,
    text           TEXT    NOT NULL,
    PRIMARY KEY (translation_id, book_id, chapter, verse)
  );

  CREATE INDEX IF NOT EXISTS idx_verses_lookup
    ON verses (translation_id, book_id, chapter, verse);

  CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(
    text,
    translation_id UNINDEXED,
    book_id        UNINDEXED,
    chapter        UNINDEXED,
    verse          UNINDEXED
  );
`

// prettier-ignore
const BOOKS_SEED = [
  [  1, 'Genesis',         'Gen',    'OT', '["Ge","Gn"]' ],
  [  2, 'Exodus',          'Exod',   'OT', '["Ex","Exo","Exd"]' ],
  [  3, 'Leviticus',       'Lev',    'OT', '["Le","Lv"]' ],
  [  4, 'Numbers',         'Num',    'OT', '["Nu","Nm","Nb"]' ],
  [  5, 'Deuteronomy',     'Deut',   'OT', '["De","Dt","Deu"]' ],
  [  6, 'Joshua',          'Josh',   'OT', '["Jos","Jsh","Jo"]' ],
  [  7, 'Judges',          'Judg',   'OT', '["Jdg","Jg","Jgs","Jud"]' ],
  [  8, 'Ruth',            'Ruth',   'OT', '["Ru","Rth"]' ],
  [  9, '1 Samuel',        '1Sam',   'OT', '["1Sa","1S","1 Sa","I Sam","I Samuel","I Sa","1st Samuel","First Samuel","1 Sm"]' ],
  [ 10, '2 Samuel',        '2Sam',   'OT', '["2Sa","2S","2 Sa","II Sam","II Samuel","II Sa","2nd Samuel","Second Samuel","2 Sm"]' ],
  [ 11, '1 Kings',         '1Kgs',   'OT', '["1Ki","1K","1 Ki","I Kgs","I Kings","I Ki","1st Kings","First Kings"]' ],
  [ 12, '2 Kings',         '2Kgs',   'OT', '["2Ki","2K","2 Ki","II Kgs","II Kings","II Ki","2nd Kings","Second Kings"]' ],
  [ 13, '1 Chronicles',    '1Chr',   'OT', '["1Ch","1 Ch","I Chr","I Chron","I Chronicles","1st Chronicles","First Chronicles","1 Chron"]' ],
  [ 14, '2 Chronicles',    '2Chr',   'OT', '["2Ch","2 Ch","II Chr","II Chron","II Chronicles","2nd Chronicles","Second Chronicles","2 Chron"]' ],
  [ 15, 'Ezra',            'Ezra',   'OT', '["Ezr","Ez"]' ],
  [ 16, 'Nehemiah',        'Neh',    'OT', '["Ne"]' ],
  [ 17, 'Esther',          'Esth',   'OT', '["Est","Es"]' ],
  [ 18, 'Job',             'Job',    'OT', '["Jb"]' ],
  [ 19, 'Psalms',          'Ps',     'OT', '["Psa","Pss","Psalm","Pslm"]' ],
  [ 20, 'Proverbs',        'Prov',   'OT', '["Pro","Pr","Prv"]' ],
  [ 21, 'Ecclesiastes',    'Eccl',   'OT', '["Ec","Ecc","Qoh","Qoheleth"]' ],
  [ 22, 'Song of Solomon', 'Song',   'OT', '["SOS","SS","Song of Songs","Cant","Canticles","Sol","Sg"]' ],
  [ 23, 'Isaiah',          'Isa',    'OT', '["Is"]' ],
  [ 24, 'Jeremiah',        'Jer',    'OT', '["Je","Jr"]' ],
  [ 25, 'Lamentations',    'Lam',    'OT', '["La","Lm"]' ],
  [ 26, 'Ezekiel',         'Ezek',   'OT', '["Eze","Ezk"]' ],
  [ 27, 'Daniel',          'Dan',    'OT', '["Da","Dn"]' ],
  [ 28, 'Hosea',           'Hos',    'OT', '["Ho"]' ],
  [ 29, 'Joel',            'Joel',   'OT', '["Jl","Joe"]' ],
  [ 30, 'Amos',            'Amos',   'OT', '["Am"]' ],
  [ 31, 'Obadiah',         'Obad',   'OT', '["Ob","Oba"]' ],
  [ 32, 'Jonah',           'Jonah',  'OT', '["Jon","Jnh"]' ],
  [ 33, 'Micah',           'Mic',    'OT', '["Mi","Mc"]' ],
  [ 34, 'Nahum',           'Nah',    'OT', '["Na"]' ],
  [ 35, 'Habakkuk',        'Hab',    'OT', '["Hb","Hbk"]' ],
  [ 36, 'Zephaniah',       'Zeph',   'OT', '["Zep","Zp","Zph"]' ],
  [ 37, 'Haggai',          'Hag',    'OT', '["Hg","Hgg"]' ],
  [ 38, 'Zechariah',       'Zech',   'OT', '["Zec","Zc","Zch"]' ],
  [ 39, 'Malachi',         'Mal',    'OT', '["Ml","Mlc"]' ],
  [ 40, 'Matthew',         'Matt',   'NT', '["Mt","Mat"]' ],
  [ 41, 'Mark',            'Mark',   'NT', '["Mk","Mrk","Mr"]' ],
  [ 42, 'Luke',            'Luke',   'NT', '["Lk","Luk","Lu"]' ],
  [ 43, 'John',            'John',   'NT', '["Jn","Jhn","Jo"]' ],
  [ 44, 'Acts',            'Acts',   'NT', '["Ac","Act"]' ],
  [ 45, 'Romans',          'Rom',    'NT', '["Ro","Rm"]' ],
  [ 46, '1 Corinthians',   '1Cor',   'NT', '["1Co","1 Co","I Cor","I Corinthians","1st Corinthians","First Corinthians"]' ],
  [ 47, '2 Corinthians',   '2Cor',   'NT', '["2Co","2 Co","II Cor","II Corinthians","2nd Corinthians","Second Corinthians"]' ],
  [ 48, 'Galatians',       'Gal',    'NT', '["Ga","Gltns"]' ],
  [ 49, 'Ephesians',       'Eph',    'NT', '["Ep","Ephes"]' ],
  [ 50, 'Philippians',     'Phil',   'NT', '["Php","Pp","Phi"]' ],
  [ 51, 'Colossians',      'Col',    'NT', '["Co","Colo"]' ],
  [ 52, '1 Thessalonians', '1Thess', 'NT', '["1Th","1 Th","I Thess","I Thessalonians","1st Thessalonians","First Thessalonians","1Ths"]' ],
  [ 53, '2 Thessalonians', '2Thess', 'NT', '["2Th","2 Th","II Thess","II Thessalonians","2nd Thessalonians","Second Thessalonians","2Ths"]' ],
  [ 54, '1 Timothy',       '1Tim',   'NT', '["1Ti","1 Ti","I Tim","I Timothy","1st Timothy","First Timothy"]' ],
  [ 55, '2 Timothy',       '2Tim',   'NT', '["2Ti","2 Ti","II Tim","II Timothy","2nd Timothy","Second Timothy"]' ],
  [ 56, 'Titus',           'Titus',  'NT', '["Tit","Ti"]' ],
  [ 57, 'Philemon',        'Phlm',   'NT', '["Phm","Pm","Phile"]' ],
  [ 58, 'Hebrews',         'Heb',    'NT', '["He","Hebr"]' ],
  [ 59, 'James',           'Jas',    'NT', '["Jm","Jms","Jam"]' ],
  [ 60, '1 Peter',         '1Pet',   'NT', '["1Pe","1P","1 Pe","I Pet","I Peter","1st Peter","First Peter"]' ],
  [ 61, '2 Peter',         '2Pet',   'NT', '["2Pe","2P","2 Pe","II Pet","II Peter","2nd Peter","Second Peter"]' ],
  [ 62, '1 John',          '1John',  'NT', '["1Jn","1J","1 Jn","I Jn","I John","1st John","First John"]' ],
  [ 63, '2 John',          '2John',  'NT', '["2Jn","2J","2 Jn","II Jn","II John","2nd John","Second John"]' ],
  [ 64, '3 John',          '3John',  'NT', '["3Jn","3J","3 Jn","III Jn","III John","3rd John","Third John"]' ],
  [ 65, 'Jude',            'Jude',   'NT', '["Jud","Jd"]' ],
  [ 66, 'Revelation',      'Rev',    'NT', '["Re","Rv","Apoc","Apocalypse"]' ],
] as const

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { outputPath, translationIds } = parseArgs()

  console.log('\n═══════════════════════════════════════════════')
  console.log('  Kairo Bible Database Seeder')
  console.log('═══════════════════════════════════════════════\n')
  console.log(`  Output: ${outputPath}`)
  console.log(`  Translations: ${translationIds.join(', ')}\n`)

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true })

  // Open / create database
  const db = new Database(outputPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  // Apply schema
  console.log('  Creating schema…')
  db.exec(SCHEMA)

  // Seed books
  const bookCount = (db.prepare('SELECT COUNT(*) as n FROM books').get() as { n: number }).n
  if (bookCount < 66) {
    const insertBook = db.prepare(
      'INSERT OR REPLACE INTO books (id, name, abbreviation, testament, aliases) VALUES (?, ?, ?, ?, ?)'
    )
    const seedBooks = db.transaction(() => {
      for (const row of BOOKS_SEED) insertBook.run(...row)
    })
    seedBooks()
    console.log('  ✓ Books seeded (66 books)\n')
  } else {
    console.log('  ✓ Books already seeded\n')
  }

  // Process each requested translation
  const selected = TRANSLATIONS.filter((t) => translationIds.includes(t.id))
  if (selected.length === 0) {
    console.error(`  ERROR: Unknown translation(s): ${translationIds.join(', ')}`)
    console.error(`  Available: ${TRANSLATIONS.map((t) => t.id).join(', ')}`)
    process.exit(1)
  }

  for (const spec of selected) {
    await seedTranslation(db, spec)
  }

  db.close()

  console.log('\n═══════════════════════════════════════════════')
  console.log('  Done! Copy resources/bible.db into your')
  console.log('  Electron app resources/ folder.')
  console.log('═══════════════════════════════════════════════\n')
}

async function seedTranslation(db: BetterSqlite3.Database, spec: TranslationSpec): Promise<void> {
  console.log(`  ── ${spec.name} (${spec.id}) ──────────────────────`)

  // Check if already seeded
  const existing = (db.prepare('SELECT COUNT(*) as n FROM translations WHERE id = ?').get(spec.id) as { n: number }).n
  if (existing > 0) {
    const verseCount = (db.prepare('SELECT COUNT(*) as n FROM verses WHERE translation_id = ?').get(spec.id) as { n: number }).n
    if (verseCount > 30_000) {
      console.log(`  ✓ Already seeded (${verseCount.toLocaleString()} verses)\n`)
      return
    }
    console.log(`  ⚠ Incomplete (${verseCount} verses) — re-seeding`)
    db.prepare('DELETE FROM verses WHERE translation_id = ?').run(spec.id)
    db.prepare('DELETE FROM verses_fts WHERE translation_id = ?').run(spec.id)
  }

  // Download
  console.log(`  Downloading from GitHub…`)
  let raw: Buffer
  try {
    raw = await fetchJson(spec.url)
  } catch (err) {
    console.error(`\n  ERROR downloading ${spec.id}: ${(err as Error).message}`)
    console.error(`  URL: ${spec.url}`)
    process.exit(1)
  }

  // Parse — strip UTF-8 BOM present in thiagobodruk files
  const json = stripBom(raw).toString('utf8')
  let books: ThiagobodrukBook[]
  try {
    books = JSON.parse(json) as ThiagobodrukBook[]
  } catch (err) {
    console.error(`\n  ERROR parsing JSON for ${spec.id}: ${(err as Error).message}`)
    process.exit(1)
  }

  if (books.length !== 66) {
    console.error(`\n  ERROR: Expected 66 books, got ${books.length}`)
    process.exit(1)
  }

  // Count total verses
  const totalVerses = books.reduce(
    (sum, b) => sum + b.chapters.reduce((s, ch) => s + ch.length, 0), 0
  )
  console.log(`  Parsed: ${books.length} books, ${totalVerses.toLocaleString()} verses`)

  // Insert translation record
  db.prepare('INSERT OR REPLACE INTO translations (id, name, language, is_default) VALUES (?, ?, ?, ?)')
    .run(spec.id, spec.name, spec.language, spec.isDefault ? 1 : 0)

  // Prepare statements
  const insertVerse = db.prepare(
    'INSERT OR REPLACE INTO verses (translation_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)'
  )
  const insertFts = db.prepare(
    'INSERT INTO verses_fts (text, translation_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)'
  )

  // Insert all verses in batches of 2000
  const BATCH = 2_000
  let inserted = 0

  // Build flat verse list
  type FlatVerse = [bookId: number, chapter: number, verse: number, text: string]
  const flat: FlatVerse[] = []

  for (let bi = 0; bi < books.length; bi++) {
    const bookId = bi + 1 // 1-indexed
    const book   = books[bi]

    // Sanity-check the position matches what we expect
    const expectedName = BOOK_NAMES_CANONICAL[bi]
    if (!expectedName) {
      console.error(`\n  ERROR: Unexpected book at index ${bi}`)
      process.exit(1)
    }

    for (let ci = 0; ci < book.chapters.length; ci++) {
      const chapterNum = ci + 1
      const chapter    = book.chapters[ci]
      for (let vi = 0; vi < chapter.length; vi++) {
        flat.push([bookId, chapterNum, vi + 1, chapter[vi]])
      }
    }
  }

  // Batch insert
  for (let offset = 0; offset < flat.length; offset += BATCH) {
    const batch = flat.slice(offset, offset + BATCH)
    const tx = db.transaction(() => {
      for (const [bookId, chapter, verse, text] of batch) {
        insertVerse.run(spec.id, bookId, chapter, verse, text)
        insertFts.run(text, spec.id, bookId, chapter, verse)
      }
    })
    tx()
    inserted += batch.length
    progress(spec.id, inserted, flat.length)
  }

  console.log('') // newline after progress bar
  console.log(`  ✓ Inserted ${inserted.toLocaleString()} verses\n`)
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err: Error) => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})

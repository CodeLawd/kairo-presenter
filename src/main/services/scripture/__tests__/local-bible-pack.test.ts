import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BibleDatabase } from '../bible-db'
import { ScriptureService } from '../index'
import { packStatusFor, validatePackFile, validatePackRowsFor } from '../local-bible-pack'
import {
  buildBiblePack,
  parseConverterArgs,
  parsePackSource,
  writePackFile,
} from '../../../../../scripts/build-bible-pack'
import {
  FIXTURE_CHAPTERS,
  FIXTURE_MARKER,
  FIXTURE_VERSES,
  buildFixtureSource,
  buildFixtureVerses,
  markFixtureSource,
  markFixtureVerse,
} from './local-bible-pack-fixture'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** A fresh userData-style bible.db with a small KJV seed standing in for bundled text. */
function openDestWithKjv(dir: string): BibleDatabase {
  const db = new BibleDatabase(path.join(dir, 'bible.db'))
  db.importTranslation('KJV', 'King James Version', 'en', [
    { bookId: 43, chapter: 3, verse: 16, text: 'Synthetic KJV stand-in for John 3:16.' },
    { bookId: 19, chapter: 23, verse: 1, text: 'Synthetic KJV stand-in for Psalm 23:1.' },
  ], true)
  return db
}

function serviceWithDb(db: BibleDatabase): ScriptureService {
  const service = new ScriptureService()
  Object.assign(service, { db })
  return service
}

/** Build a valid synthetic NKJV pack file via the production converter path. */
function buildValidPack(dir: string, name = 'nkjv-pack.db'): string {
  const source = buildFixtureSource()
  markFixtureSource(source, 43, 3, 16, `${FIXTURE_MARKER} covenant of testing`)
  const { rows } = parsePackSource(source)
  const validated = validatePackRowsFor('NKJV', 'Synthetic Fixture Translation', 'en', rows)
  assert.equal(validated.verseCount, FIXTURE_VERSES)
  assert.equal(validated.chapterCount, FIXTURE_CHAPTERS)
  const out = path.join(dir, name)
  const built = writePackFile({ rows, name: 'Synthetic Fixture Translation', language: 'en' }, out, false)
  assert.equal(built.verseCount, FIXTURE_VERSES)
  assert.ok(built.byteSize > 0)
  return out
}

// ─── CLI argument parsing ─────────────────────────────────────────────────────

test('converter requires an input path and defaults the output under bible-packs/', () => {
  assert.throws(() => parseConverterArgs([]), /--input/)
  assert.throws(() => parseConverterArgs(['--output', 'x.db']), /--input/)
  assert.throws(() => parseConverterArgs(['--input', 'a.json', '--bogus']), /Unknown argument/)

  const parsed = parseConverterArgs(['--input', 'nkjv.json'])
  assert.ok(parsed.input.endsWith('nkjv.json'))
  assert.ok(parsed.output.endsWith(path.join('bible-packs', 'nkjv-pack.db')))
  assert.equal(parsed.force, false)

  const forced = parseConverterArgs(['--input', 'a.json', '--output', 'b.db', '--force'])
  assert.equal(forced.force, true)
  assert.ok(forced.output.endsWith('b.db'))
})

// ─── Source validation ────────────────────────────────────────────────────────

test('converter accepts a complete synthetic source with canonical order', () => {
  const { rows } = parsePackSource(buildFixtureSource())
  assert.equal(rows.length, FIXTURE_VERSES)
  assert.deepEqual([rows[0]?.bookId, rows[0]?.chapter, rows[0]?.verse], [1, 1, 1])
  const last = rows[rows.length - 1]
  assert.deepEqual([last?.bookId, last?.chapter, last?.verse], [66, 22, 21])
})

test('converter rejects a wrongly identified translation', () => {
  assert.throws(() => parsePackSource(buildFixtureSource('KJV')), /expected translation abbrev "NKJV"/)
  assert.throws(() => parsePackSource({ books: [] }), /expected translation abbrev/)
})

test('converter rejects an incomplete canon', () => {
  const source = buildFixtureSource()
  source.books.pop()
  assert.throws(() => parsePackSource(source), /expected 66 books, found 65/)
})

test('converter rejects books out of canonical order', () => {
  const renamed = buildFixtureSource()
  const firstName = renamed.books[0]?.name
  renamed.books[0] = { ...(renamed.books[0] as (typeof renamed.books)[number]), name: renamed.books[1]?.name as string }
  renamed.books[1] = { ...(renamed.books[1] as (typeof renamed.books)[number]), name: firstName as string }
  assert.throws(() => parsePackSource(renamed), /canonical order/)

  const swapped = buildFixtureSource()
  const first = swapped.books[0]
  swapped.books[0] = swapped.books[1] as (typeof swapped.books)[number]
  swapped.books[1] = first as (typeof swapped.books)[number]
  assert.throws(() => parsePackSource(swapped), /has index/)
})

test('converter rejects gaps in chapters and verses', () => {
  const chapters = buildFixtureSource()
  chapters.books[0]?.chapters.splice(1, 1)
  assert.throws(() => parsePackSource(chapters), /expected chapter 2/)

  const verses = buildFixtureSource()
  verses.books[0]?.chapters[0]?.verses.splice(0, 1)
  assert.throws(() => parsePackSource(verses), /expected verse 1/)
})

test('converter rejects empty verse text and duplicate references', () => {
  const empty = buildFixtureSource()
  const target = empty.books[0]?.chapters[0]?.verses[0]
  if (target) target.text = '   '
  assert.throws(() => parsePackSource(empty), /empty verse text/)

  const dupe = buildFixtureSource()
  const chapter = dupe.books[0]?.chapters[0]
  if (chapter) chapter.verses.push({ verse: 1, text: 'A second verse numbered 1.' })
  // A trailing duplicate shifts every later verse number, so the first error
  // surfaces as a numbering mismatch — still a rejection of bad input.
  assert.throws(() => parsePackSource(dupe), /expected verse \d+, found 1/)
})

test('row validation rejects a verse-count mismatch, a chapter gap and an empty row', () => {
  const rows = buildFixtureVerses()
  assert.throws(
    () => validatePackRowsFor('NKJV', 'Fixture', 'en', rows.slice(0, rows.length - 1)),
    /Expected 31,102 NKJV verses, found 31,101/,
  )

  // Same count, one chapter renamed past the end: the missing chapter is caught.
  const gap = buildFixtureVerses().map((row) =>
    row.bookId === 2 && row.chapter === 2 ? { ...row, chapter: 99 } : row,
  )
  assert.throws(() => validatePackRowsFor('NKJV', 'Fixture', 'en', gap), /Exodus expected 40 chapters, found 99/)

  const blank = buildFixtureVerses()
  blank[1000] = { ...blank[1000] as (typeof blank)[number], text: '' }
  assert.throws(() => validatePackRowsFor('NKJV', 'Fixture', 'en', blank), /Empty verse text/)

  const outOfRange = buildFixtureVerses()
  outOfRange[10] = { ...outOfRange[10] as (typeof outOfRange)[number], bookId: 67 }
  assert.throws(() => validatePackRowsFor('NKJV', 'Fixture', 'en', outOfRange), /out-of-range book id/)
})

test('row validation rejects globally complete rows with the wrong canonical chapter layout', () => {
  const rows = buildFixtureVerses()
  const moved = rows.find((row) => row.bookId === 1 && row.chapter === 50 && row.verse === 26)
  assert.ok(moved)
  moved.bookId = 2
  moved.chapter = 40
  moved.verse = 39
  assert.throws(
    () => validatePackRowsFor('NKJV', 'Fixture', 'en', rows),
    /Genesis 50 expected 26 verses, found 25/i,
  )
})

test('pack status requires both canonical NKJV verse and chapter counts', () => {
  assert.equal(packStatusFor('NKJV', 31_102, 1_189, true).installed, true)
  assert.equal(packStatusFor('NKJV', 31_102, 1_188, true).installed, false)
})

// ─── Pack output schema ───────────────────────────────────────────────────────

test('converter writes a pack with the production schema and FTS index', () => {
  const dir = tmpDir('kairo-pack-schema-')
  try {
    const packPath = buildValidPack(dir)
    const raw = new Database(packPath, { readonly: true })
    try {
      const translations = raw.prepare('SELECT id, name, language, is_default FROM translations').all()
      assert.deepEqual(translations, [
        { id: 'NKJV', name: 'Synthetic Fixture Translation', language: 'en', is_default: 0 },
      ])
      const verseCount = (raw.prepare('SELECT COUNT(*) as n FROM verses').get() as { n: number }).n
      assert.equal(verseCount, FIXTURE_VERSES)
      const ftsCount = (raw.prepare('SELECT COUNT(*) as n FROM verses_fts').get() as { n: number }).n
      assert.equal(ftsCount, FIXTURE_VERSES)
      const otherTranslations = (
        raw.prepare("SELECT COUNT(*) as n FROM verses WHERE translation_id != 'NKJV'").get() as { n: number }
      ).n
      assert.equal(otherTranslations, 0)
      const hit = raw
        .prepare('SELECT COUNT(*) as n FROM verses_fts WHERE verses_fts MATCH ?')
        .get(`${FIXTURE_MARKER} covenant`) as { n: number }
      assert.equal(hit.n, 1)
    } finally {
      raw.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('converter refuses to overwrite without --force', () => {
  const dir = tmpDir('kairo-pack-force-')
  try {
    const out = path.join(dir, 'pack.db')
    const source = buildFixtureSource()
    const { rows } = parsePackSource(source)
    writePackFile({ rows, name: 'Fixture', language: 'en' }, out, false)
    assert.throws(() => writePackFile({ rows, name: 'Fixture', language: 'en' }, out, false), /already exists/)
    const rebuilt = writePackFile({ rows, name: 'Fixture', language: 'en' }, out, true)
    assert.equal(rebuilt.verseCount, FIXTURE_VERSES)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('converter end-to-end reports path, verse count and byte size', async () => {
  const dir = tmpDir('kairo-pack-e2e-')
  try {
    const source = buildFixtureSource()
    markFixtureSource(source, 43, 3, 16, `${FIXTURE_MARKER} covenant of testing`)
    const input = path.join(dir, 'nkjv.json')
    fs.writeFileSync(input, JSON.stringify(source))
    const output = path.join(dir, 'out.db')

    // buildBiblePack prints path, verse count and byte size to stdout; the
    // returned value carries the same report for assertions.
    const built = await buildBiblePack(['--input', input, '--output', output])
    assert.equal(built.path, output)
    assert.equal(built.verseCount, FIXTURE_VERSES)
    assert.ok(built.byteSize > 0)
    assert.ok(built.gzipSize > 0)
    assert.ok(fs.existsSync(output))

    // A second run without --force refuses to overwrite the output.
    await assert.rejects(buildBiblePack(['--input', input, '--output', output]), /already exists/)
    const forced = await buildBiblePack(['--input', input, '--output', output, '--force'])
    assert.equal(forced.verseCount, FIXTURE_VERSES)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ─── Pack file validation (installer side) ────────────────────────────────────

test('installer validates the generated pack and reads its counts', () => {
  const dir = tmpDir('kairo-pack-validate-')
  try {
    const packPath = buildValidPack(dir)
    const validated = validatePackFile(packPath)
    assert.equal(validated.translationId, 'NKJV')
    assert.equal(validated.verseCount, FIXTURE_VERSES)
    assert.equal(validated.chapterCount, FIXTURE_CHAPTERS)
    assert.equal(validated.bookCount, 66)
    assert.equal(validated.verses.length, FIXTURE_VERSES)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** A structurally complete pack file identified as `id` (bypasses the converter). */
function buildPackWithId(dir: string, name: string, id: string): string {
  const out = path.join(dir, name)
  const raw = new Database(out)
  try {
    raw.exec(
      `CREATE TABLE translations (id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', is_default INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE verses (translation_id TEXT NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (translation_id, book_id, chapter, verse));`,
    )
    raw.prepare('INSERT INTO translations (id, name, language, is_default) VALUES (?, ?, ?, ?)').run(id, id, 'en', 0)
    const insert = raw.prepare('INSERT INTO verses (translation_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
    const tx = raw.transaction(() => {
      for (const row of buildFixtureVerses()) insert.run(id, row.bookId, row.chapter, row.verse, row.text)
    })
    tx()
  } finally {
    raw.close()
  }
  return out
}

test('installer refuses to overwrite a bundled translation', () => {
  const dir = tmpDir('kairo-pack-bundled-guard-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    const before = db.getVerseCount('KJV')

    const kjvPack = buildPackWithId(dir, 'kjv-pack.db', 'KJV')
    assert.throws(() => service.installLocalBiblePack(kjvPack), /bundled KJV/)
    assert.equal(db.getVerseCount('KJV'), before)

    // BBE ships in resources/bible.db too, with or without local rows present.
    const bbePack = buildPackWithId(dir, 'bbe-pack.db', 'BBE')
    assert.throws(() => service.installLocalBiblePack(bbePack), /bundled BBE/)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installer enforces the expected translation id for downloads', () => {
  const dir = tmpDir('kairo-pack-expected-id-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    // A mislabeled pack is rejected even at full structural size — a checksum
    // only proves the bytes are the listed ones, not the right translation.
    const kjvPack = buildPackWithId(dir, 'kjv-pack.db', 'KJV')
    assert.throws(() => service.installLocalBiblePack(kjvPack, 'NKJV'), /containing only NKJV, found: KJV/)
    assert.equal(db.getVerseCount('KJV'), 2)

    // The matching id installs for a non-bundled translation.
    const esvPack = buildPackWithId(dir, 'esv-pack.db', 'ESV')
    const installed = service.installLocalBiblePack(esvPack, 'ESV')
    assert.equal(installed.translation, 'ESV')
    assert.equal(db.getVerseCount('ESV'), FIXTURE_VERSES)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installer rejects non-database, unstructured and wrongly identified packs', () => {
  const dir = tmpDir('kairo-pack-reject-')
  try {
    const notDb = path.join(dir, 'notes.txt')
    fs.writeFileSync(notDb, 'not a database')
    assert.throws(() => validatePackFile(notDb), /not a readable SQLite Bible pack/)
    assert.throws(() => validatePackFile(path.join(dir, 'missing.db')), /could not be found/)

    const unstructured = path.join(dir, 'empty.db')
    new Database(unstructured).close()
    assert.throws(() => validatePackFile(unstructured), /missing the translations or verses table/)

    // A pack identified as another translation is refused, even at full size.
    const wrongId = path.join(dir, 'kjv.db')
    const raw = new Database(wrongId)
    try {
      raw.exec(
        `CREATE TABLE translations (id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', is_default INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE verses (translation_id TEXT NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (translation_id, book_id, chapter, verse));`,
      )
      raw.prepare('INSERT INTO translations (id, name, language, is_default) VALUES (?, ?, ?, ?)').run('KJV', 'KJV', 'en', 1)
      const insert = raw.prepare('INSERT INTO verses (translation_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
      const tx = raw.transaction(() => {
        for (const row of buildFixtureVerses()) insert.run('KJV', row.bookId, row.chapter, row.verse, row.text)
      })
      tx()
    } finally {
      raw.close()
    }
    // A pack identified as another translation installs generically — new
    // translations need no code change. Callers that need a specific id pass
    // it explicitly and get the refusal.
    const kjvPack = validatePackFile(wrongId)
    assert.equal(kjvPack.translationId, 'KJV')
    assert.throws(() => validatePackFile(wrongId, 'NKJV'), /containing only NKJV, found: KJV/)

    // A pack holding two translations is refused even when NKJV is complete.
    const mixed = path.join(dir, 'mixed.db')
    const mixedDb = new Database(mixed)
    try {
      mixedDb.exec(
        `CREATE TABLE translations (id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', is_default INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE verses (translation_id TEXT NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (translation_id, book_id, chapter, verse));`,
      )
      mixedDb.prepare('INSERT INTO translations (id, name, language, is_default) VALUES (?, ?, ?, ?)').run('NKJV', 'NKJV', 'en', 0)
      mixedDb.prepare('INSERT INTO translations (id, name, language, is_default) VALUES (?, ?, ?, ?)').run('KJV', 'KJV', 'en', 1)
      const insertMixed = mixedDb.prepare('INSERT INTO verses (translation_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
      const txMixed = mixedDb.transaction(() => {
        for (const row of buildFixtureVerses()) insertMixed.run('NKJV', row.bookId, row.chapter, row.verse, row.text)
        insertMixed.run('KJV', 43, 3, 16, 'An extra translation row.')
      })
      txMixed()
    } finally {
      mixedDb.close()
    }
    assert.throws(() => validatePackFile(mixed), /containing a single translation, found: NKJV, KJV/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installer rejects an incomplete pack without touching the installed copy', () => {
  const dir = tmpDir('kairo-pack-incomplete-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    const packPath = buildValidPack(dir)

    const installed = service.installLocalBiblePack(packPath)
    assert.equal(installed.verseCount, FIXTURE_VERSES)
    const before = db.getVerse('NKJV', 'John', 3, 16)?.text

    // Remove one chapter from a copy of the pack.
    const short = path.join(dir, 'short.db')
    fs.copyFileSync(packPath, short)
    const raw = new Database(short)
    try {
      raw.prepare("DELETE FROM verses WHERE translation_id = 'NKJV' AND book_id = 66").run()
      raw.prepare("DELETE FROM verses_fts WHERE translation_id = 'NKJV' AND book_id = 66").run()
    } finally {
      raw.close()
    }
    assert.throws(() => service.installLocalBiblePack(short), /Expected 31,102 NKJV verses/)

    // The previously installed NKJV is preserved byte-for-byte at the sample.
    assert.equal(db.getVerseCount('NKJV'), FIXTURE_VERSES)
    assert.equal(db.getVerse('NKJV', 'John', 3, 16)?.text, before)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ─── Install, lookup, search, remove ──────────────────────────────────────────

test('status reports NKJV absent before install and present after', () => {
  const dir = tmpDir('kairo-pack-status-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    const before = service.getLocalBiblePackStatus('NKJV')
    assert.equal(before.installed, false)
    assert.equal(before.verseCount, 0)

    const result = service.installLocalBiblePack(buildValidPack(dir))
    assert.deepEqual(result, {
      translation: 'NKJV',
      verseCount: FIXTURE_VERSES,
      chapterCount: FIXTURE_CHAPTERS,
      installed: true,
    })

    const after = service.getLocalBiblePackStatus('NKJV')
    assert.equal(after.installed, true)
    assert.equal(after.verseCount, FIXTURE_VERSES)
    assert.equal(after.chapterCount, FIXTURE_CHAPTERS)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installed NKJV serves reference lookup from local SQLite', async () => {
  const dir = tmpDir('kairo-pack-lookup-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    service.installLocalBiblePack(buildValidPack(dir))

    const verses = await service.lookupVerses('John', 3, 16, undefined, 'NKJV')
    assert.equal(verses.length, 1)
    assert.match(verses[0]?.text ?? '', new RegExp(FIXTURE_MARKER))

    const results = await service.search('John 3:16', 'NKJV', '')
    assert.equal(results.length, 1)
    assert.equal(results[0]?.translation, 'NKJV')
    assert.match(results[0]?.verses[0]?.text ?? '', new RegExp(FIXTURE_MARKER))
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installed NKJV serves phrase search through local FTS', async () => {
  const dir = tmpDir('kairo-pack-fts-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    service.installLocalBiblePack(buildValidPack(dir))

    const results = await service.search(`${FIXTURE_MARKER} covenant`, 'NKJV', '')
    assert.ok(results.length > 0)
    assert.equal(results[0]?.translation, 'NKJV')
    assert.match(results[0]?.verses[0]?.text ?? '', new RegExp(FIXTURE_MARKER))
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed import rolls back and preserves the previous NKJV', () => {
  const dir = tmpDir('kairo-pack-rollback-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    service.installLocalBiblePack(buildValidPack(dir))
    const before = db.getVerse('NKJV', 'John', 3, 16)?.text
    assert.match(before ?? '', new RegExp(FIXTURE_MARKER))

    // A NULL row violates the NOT NULL constraint mid-transaction.
    const rows = buildFixtureVerses().map((row) => ({ ...row }))
    rows[15000] = {
      ...(rows[15000] as (typeof rows)[number]),
      text: null as unknown as string,
    }
    assert.throws(() => db.importTranslationPack('NKJV', 'Broken', 'en', rows))

    assert.equal(db.getVerseCount('NKJV'), FIXTURE_VERSES)
    assert.equal(db.getVerse('NKJV', 'John', 3, 16)?.text, before)
    assert.equal(service.getLocalBiblePackStatus('NKJV').installed, true)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('removing NKJV leaves KJV verses, FTS rows and defaults untouched', async () => {
  const dir = tmpDir('kairo-pack-remove-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    service.installLocalBiblePack(buildValidPack(dir))
    assert.equal(db.getVerseCount('KJV'), 2)

    const status = service.removeLocalBibleTranslation('NKJV')
    assert.equal(status.installed, false)
    assert.equal(status.verseCount, 0)
    assert.equal(db.getVerseCount('NKJV'), 0)

    // Bundled translation intact: verses, FTS reachability and default flag.
    assert.equal(db.getVerseCount('KJV'), 2)
    assert.equal(db.getVerse('KJV', 'John', 3, 16)?.text, 'Synthetic KJV stand-in for John 3:16.')
    const translations = db.getAllTranslations().map((item) => item.id)
    assert.ok(translations.includes('KJV'))
    assert.ok(!translations.includes('NKJV'))
    const kjvDefault = db.getAllTranslations().find((item) => item.id === 'KJV')
    assert.equal(kjvDefault?.isDefault, true)
    const kjvHits = await service.search('stand-in', 'KJV', '')
    assert.ok(kjvHits.length > 0)

    // Bundled translations are protected; anything else local stays removable.
    // BBE ships in resources/bible.db, so it is bundled even with no local rows.
    assert.throws(() => service.removeLocalBibleTranslation('KJV'), /bundled KJV/)
    assert.throws(() => service.removeLocalBibleTranslation('BBE'), /bundled BBE/)
    assert.equal(db.getVerseCount('KJV'), 2)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('reinstalling over an existing NKJV replaces it without duplicating rows', () => {
  const dir = tmpDir('kairo-pack-reinstall-')
  const db = openDestWithKjv(dir)
  try {
    const service = serviceWithDb(db)
    service.installLocalBiblePack(buildValidPack(dir))
    service.installLocalBiblePack(buildValidPack(dir, 'nkjv-pack-2.db'))
    assert.equal(db.getVerseCount('NKJV'), FIXTURE_VERSES)
    assert.equal(service.getLocalBiblePackStatus('NKJV').installed, true)
    assert.equal(db.getVerseCount('KJV'), 2)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('unused fixture marker helper reaches the marked verse', () => {
  const rows = buildFixtureVerses()
  const marked = markFixtureVerse(rows, 1, 1, 1, 'uniquemarkerword')
  assert.match(marked.text, /uniquemarkerword/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validatePackFile } from '../local-bible-pack'
import { buildFixtureSource, type FixtureSource } from './local-bible-pack-fixture'
import {
  importTranslation,
  loadTranslationSource,
  normalizeTranslation,
  omissionNote,
  parseImportArgs,
  resolveBookId,
  type PackSource,
} from '../../../../../scripts/import-translation'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const verses = (source: FixtureSource | PackSource, bookId: number, chapter: number) =>
  (source.books[bookId - 1] as FixtureSource['books'][number]).chapters[chapter - 1]!.verses

const textAt = (source: FixtureSource | PackSource, bookId: number, chapter: number, verse: number): string =>
  verses(source, bookId, chapter)[verse - 1]!.text

function setText(source: FixtureSource, bookId: number, chapter: number, verse: number, text: string): void {
  verses(source, bookId, chapter)[verse - 1]!.text = text
}

/** Renumber a chapter's verses 1..n after splicing. */
function renumber(source: FixtureSource, bookId: number, chapter: number): void {
  verses(source, bookId, chapter).forEach((row, index) => { row.verse = index + 1 })
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// ─── Book names ───────────────────────────────────────────────────────────────

test('book names resolve from names, abbreviations, roman numerals, and numbers', () => {
  assert.equal(resolveBookId('Genesis'), 1)
  assert.equal(resolveBookId('Psalm'), 19)
  assert.equal(resolveBookId('Song of Songs'), 22)
  assert.equal(resolveBookId('I John'), 62)
  assert.equal(resolveBookId('III John'), 64)
  assert.equal(resolveBookId('Revelations'), 66)
  assert.equal(resolveBookId('rev'), 66)
  assert.equal(resolveBookId(40), 40)
  assert.equal(resolveBookId('40'), 40)
  assert.equal(resolveBookId(67), null)
  assert.equal(resolveBookId('Tobit'), null)
})

// ─── Input shapes ─────────────────────────────────────────────────────────────

test('a canonical nested source imports with no changes', () => {
  const { source, changes, errors } = normalizeTranslation(buildFixtureSource('ZZT'), { translation: 'zzt' })
  assert.deepEqual(errors, [])
  assert.deepEqual(changes, [])
  assert.equal(source.translation.abbrev, 'ZZT')
  assert.equal(source.books.length, 66)
  assert.equal(textAt(source, 43, 3, 16), textAt(buildFixtureSource(), 43, 3, 16))
})

test('flat "Book C:V" maps and flat row lists load into the same grid', () => {
  const nested = buildFixtureSource('ZZT')
  const map: Record<string, string> = {}
  const list: Array<{ book: string | number; chapter: number; verse: number; text: string }> = []
  for (const book of nested.books) {
    for (const chapter of book.chapters) {
      for (const verse of chapter.verses) {
        map[`${book.name} ${chapter.chapter}:${verse.verse}`] = verse.text
        list.push({ book: book.index, chapter: chapter.chapter, verse: verse.verse, text: verse.text })
      }
    }
  }
  const fromNested = normalizeTranslation(nested, { translation: 'ZZT' })
  const fromMap = normalizeTranslation(map, { translation: 'ZZT' })
  const fromList = normalizeTranslation(list, { translation: 'ZZT', name: 'Listed' })
  assert.deepEqual(fromMap.errors, [])
  assert.deepEqual(fromList.errors, [])
  assert.deepEqual(fromMap.source.books, fromNested.source.books)
  assert.deepEqual(fromList.source.books, fromNested.source.books)
  assert.equal(fromList.source.translation.name, 'Listed')
})

test('unknown shapes, unknown books, and duplicates are reported', () => {
  assert.match(loadTranslationSource({ hello: 'world' }).errors[0] ?? '', /Unrecognized JSON shape/)
  const { errors } = loadTranslationSource([
    { book: 'Tobit', chapter: 1, verse: 1, text: 'x' },
    { book: 'Genesis', chapter: 1, verse: 1, text: 'a' },
    { book: 'Gen', chapter: 1, verse: 1, text: 'b' },
  ])
  assert.ok(errors.some((error) => /Unknown book "Tobit"/.test(error)))
  assert.ok(errors.some((error) => /Duplicate verse Genesis 1:1/.test(error)))
})

// ─── Versification ────────────────────────────────────────────────────────────

test('modern numbering in 2 Corinthians 13, 3 John, and Revelation 12 maps to canonical', () => {
  const source = buildFixtureSource('ZZT')
  // 2 Cor 13: verse 12 holds canonical 12–13; drop the separate verse 13.
  setText(source, 47, 13, 12, 'Greet each other warmly. Everyone here sends greetings.')
  verses(source, 47, 13).splice(12, 1)
  renumber(source, 47, 13)
  const canonical14 = textAt(source, 47, 13, 13)
  // 3 John: split canonical 14 into 14 and 15.
  verses(source, 64, 1).push({ verse: 15, text: 'Peace to you.' })
  // Revelation: an 18th verse in chapter 12 that belongs to 13:1.
  verses(source, 66, 12).push({ verse: 18, text: 'Then he stood on the shore.' })
  const rev13v1 = textAt(source, 66, 13, 1)

  const { source: out, changes, errors } = normalizeTranslation(source, { translation: 'ZZT' })
  assert.deepEqual(errors, [])
  assert.equal(changes.length, 3)
  assert.equal(textAt(out, 47, 13, 12), 'Greet each other warmly.')
  assert.equal(textAt(out, 47, 13, 13), 'Everyone here sends greetings.')
  assert.equal(textAt(out, 47, 13, 14), canonical14)
  assert.equal(verses(out, 64, 1).length, 14)
  assert.match(textAt(out, 64, 1, 14), / Peace to you\.$/)
  assert.equal(verses(out, 66, 12).length, 17)
  assert.equal(textAt(out, 66, 13, 1), `Then he stood on the shore. ${rev13v1}`)
})

test('chapters that match no rule stop the import with every problem listed', () => {
  const source = buildFixtureSource('ZZT')
  verses(source, 1, 1).push({ verse: 32, text: 'An extra verse.' })
  verses(source, 19, 23).pop()
  source.books[65]!.chapters.pop()
  const { errors } = normalizeTranslation(source, { translation: 'ZZT' })
  assert.ok(errors.some((error) => /Genesis 1 has 32 verses, expected 31/.test(error)))
  assert.ok(errors.some((error) => /Psalms 23 has 5 verses, expected 6/.test(error)))
  assert.ok(errors.some((error) => /Revelation has 21 chapters, expected 22/.test(error)))
})

// ─── Empty verses ─────────────────────────────────────────────────────────────

test('omitted verses get a note and combined ranges repeat the previous verse', () => {
  const source = buildFixtureSource('ZZT')
  setText(source, 44, 8, 37, '')
  setText(source, 4, 1, 21, '   ')
  const previous = textAt(source, 4, 1, 20)
  // A flat source often leaves an omitted verse's key out entirely.
  const flat: Record<string, string> = {}
  for (const book of source.books) {
    for (const chapter of book.chapters) {
      for (const verse of chapter.verses) flat[`${book.name} ${chapter.chapter}:${verse.verse}`] = verse.text
    }
  }
  delete flat['Matthew 17:21']

  const { source: out, changes, errors } = normalizeTranslation(flat, { translation: 'ZZT' })
  assert.deepEqual(errors, [])
  assert.equal(textAt(out, 44, 8, 37), omissionNote('ZZT'))
  assert.equal(textAt(out, 40, 17, 21), omissionNote('ZZT'))
  assert.equal(textAt(out, 4, 1, 21), previous)
  assert.ok(changes.some((change) => change.includes('Acts 8:37')))
  assert.ok(changes.some((change) => change.includes('Numbers 1:21')))
})

test('an empty first verse cannot be filled and is reported', () => {
  const source = buildFixtureSource('ZZT')
  setText(source, 1, 1, 1, '')
  const { errors } = normalizeTranslation(source, { translation: 'ZZT' })
  assert.deepEqual(errors, ['Genesis 1:1 is empty and has no previous verse to share text with.'])
})

// ─── Cleanup ──────────────────────────────────────────────────────────────────

test('PDF cleanup is opt-in: brackets stay unless --pdf-cleanup is set', () => {
  const source = buildFixtureSource('ZZT')
  setText(source, 22, 1, 1, 'The song of songs. [Young Woman:]')
  setText(source, 43, 19, 17, 'The place called [Golgotha].')
  setText(source, 3, 14, 54, 'Instructions for mildew,*')
  setText(source, 4, 1, 20, '[Tribe Number] Reuben 46,500')
  setText(source, 1, 1, 2, 'Formless--and empty.')

  const plain = normalizeTranslation(structuredClone(source), { translation: 'ZZT' }).source
  assert.equal(textAt(plain, 43, 19, 17), 'The place called [Golgotha].')
  assert.equal(textAt(plain, 1, 1, 2), 'Formless—and empty.')

  const { source: out, changes } = normalizeTranslation(source, { translation: 'ZZT', pdfCleanup: true })
  assert.equal(textAt(out, 22, 1, 1), 'The song of songs.')
  assert.equal(textAt(out, 43, 19, 17), 'The place called Golgotha.')
  assert.equal(textAt(out, 3, 14, 54), 'Instructions for mildew,')
  assert.equal(textAt(out, 4, 1, 20), 'Reuben 46,500')
  assert.ok(changes.some((change) => /speaker labels removed/.test(change)))
})

// ─── CLI ──────────────────────────────────────────────────────────────────────

test('CLI arguments require an input and a valid translation id', () => {
  assert.throws(() => parseImportArgs(['--translation', 'ESV']), /--input/)
  assert.throws(() => parseImportArgs(['--input', 'x.json']), /--translation/)
  assert.throws(() => parseImportArgs(['--input', 'x.json', '--translation', 'bad id']), /--translation/)
  assert.throws(() => parseImportArgs(['--input', 'x.json', '--translation', 'ESV', '--oops']), /Unknown argument/)
  const options = parseImportArgs(['--input', 'x.json', '--translation', 'esv', '--pdf-cleanup'])
  assert.equal(options.translation, 'ESV')
  assert.equal(options.pdfCleanup, true)
  assert.match(options.output, /bible-packs[\\/]esv-pack\.db$/)
})

test('import writes a pack that installs, plus a gzip and a change report', async () => {
  const dir = tmpDir('kairo-import-translation-')
  try {
    const source = buildFixtureSource('ZZT')
    verses(source, 64, 1).push({ verse: 15, text: 'Peace to you.' })
    const input = path.join(dir, 'zzt.json')
    fs.writeFileSync(input, JSON.stringify(source))
    const output = path.join(dir, 'zzt-pack.db')

    const lines: string[] = []
    const result = await importTranslation(
      ['--input', input, '--translation', 'ZZT', '--output', output],
      (line) => lines.push(line),
    )

    assert.equal(result.verseCount, 31102)
    assert.match(result.sha256, /^[0-9a-f]{64}$/)
    assert.ok(fs.existsSync(result.gzipPath))
    assert.match(fs.readFileSync(result.reportPath, 'utf8'), /3 John 1: merged verses 14–15/)
    assert.ok(lines.some((line) => line.includes('downloadablePack')))

    const pack = validatePackFile(output, 'ZZT')
    assert.equal(pack.translationId, 'ZZT')
    assert.equal(pack.verseCount, 31102)

    await assert.rejects(
      importTranslation(['--input', input, '--translation', 'ZZT', '--output', output], () => {}),
      /already exists/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an import with unfixable problems writes nothing', async () => {
  const dir = tmpDir('kairo-import-translation-bad-')
  try {
    const source = buildFixtureSource('ZZT')
    verses(source, 1, 1).push({ verse: 32, text: 'An extra verse.' })
    const input = path.join(dir, 'bad.json')
    fs.writeFileSync(input, JSON.stringify(source))
    const output = path.join(dir, 'bad-pack.db')
    await assert.rejects(
      importTranslation(['--input', input, '--translation', 'ZZT', '--output', output], () => {}),
      /Cannot import ZZT — 1 problem\(s\):\n {2}Genesis 1 has 32 verses/,
    )
    assert.equal(fs.existsSync(output), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

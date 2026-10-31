import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildFixtureSource } from './local-bible-pack-fixture'
import { parsePackSource, writePackFile } from '../../../../../scripts/build-bible-pack'
import { packStatusFor, validatePackFile, validatePackRowsFor } from '../local-bible-pack'
import { BibleDatabase } from '../bible-db'
import { ScriptureService } from '../index'

function ampcSource() {
  const source = buildFixtureSource('AMPC')
  const mark = source.books[40]!.chapters[8]!
  mark.verses = mark.verses.filter(({ verse }) => verse !== 44 && verse !== 46)
  source.books[63]!.chapters[0]!.verses.push({ verse: 15, text: 'Synthetic AMPC final greeting zephyrquill.' })
  return source
}

test('AMPC converter preserves omitted verses and 3 John 1:15', () => {
  const { rows } = parsePackSource(ampcSource(), 'AMPC')
  const pack = validatePackRowsFor('ampc', 'Synthetic AMPC', 'en', rows)
  assert.equal(pack.verseCount, 31_101)
  assert.equal(pack.chapterCount, 1_189)
  assert.deepEqual(rows.filter((r) => r.bookId === 41 && r.chapter === 9 && r.verse >= 43 && r.verse <= 48).map((r) => r.verse), [43, 45, 47, 48])
  assert.ok(rows.some((r) => r.bookId === 64 && r.verse === 15))
})

test('AMPC validation rejects other gaps and substitutions with unchanged totals', () => {
  const { rows } = parsePackSource(ampcSource(), 'AMPC')
  const changed = rows.map((row) => ({ ...row }))
  changed.find((r) => r.bookId === 41 && r.chapter === 9 && r.verse === 45)!.verse = 44
  assert.throws(() => validatePackRowsFor('AMPC', 'Fixture', 'en', changed), /Missing verse 45|unexpected verse 44/i)
  assert.throws(() => validatePackRowsFor('NKJV', 'Fixture', 'en', rows), /Expected 31,102/)
  const corrupt = ampcSource()
  corrupt.books[0]!.chapters[0]!.verses.splice(0, 1)
  assert.throws(() => parsePackSource(corrupt, 'AMPC'), /expected verse 1/)
})

test('AMPC status uses its complete verse and chapter totals', () => {
  assert.equal(packStatusFor('AMPC', 31_101, 1_189, true).installed, true)
  assert.equal(packStatusFor('AMPC', 31_102, 1_189, true).installed, false)
  assert.equal(packStatusFor('AMPC', 31_101, 1_188, true).installed, false)
})

test('AMPC pack installs, searches and serves ranges without renumbering or changing KJV', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ampc-'))
  const db = new BibleDatabase(path.join(dir, 'bible.db'))
  try {
    db.importTranslation('KJV', 'KJV', 'en', [{ bookId: 43, chapter: 3, verse: 16, text: 'Synthetic KJV retained.' }], true)
    const { rows } = parsePackSource(ampcSource(), 'AMPC')
    const packPath = path.join(dir, 'ampc.db')
    writePackFile({ rows, name: 'Synthetic AMPC', language: 'en' }, packPath, false, 'AMPC')
    assert.equal(validatePackFile(packPath, 'AMPC').verseCount, 31_101)
    const service = new ScriptureService()
    Object.assign(service, { db })
    assert.equal(service.installLocalBiblePack(packPath).installed, true)
    assert.equal(service.getLocalBiblePackStatus('AMPC').installed, true)
    const option = (await service.getTranslationOptions('')).find((item) => item.id === 'AMPC')
    assert.equal(option?.available, true)
    assert.equal(option?.requiresApiKey, false)
    assert.deepEqual((await service.lookupVerses('Mark', 9, 43, 48, 'AMPC')).map((r) => r.verse), [43, 45, 47, 48])
    assert.deepEqual(await service.lookupVerses('Mark', 9, 44, undefined, 'AMPC'), [])
    const result = await service.search('3 John 1:15', 'AMPC', '')
    assert.equal(result[0]?.translation, 'AMPC')
    assert.match(result[0]?.verses[0]?.text ?? '', /final greeting/)
    assert.ok((await service.search('zephyrquill', 'AMPC', '')).length > 0)
    assert.equal(db.getVerseCount('KJV'), 1)
    service.removeLocalBibleTranslation('AMPC')
    assert.equal(db.getVerseCount('AMPC'), 0)
    assert.equal(db.getVerseCount('KJV'), 1)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

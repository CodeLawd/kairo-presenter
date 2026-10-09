import test from 'node:test'
import path from 'path'
import Database from 'better-sqlite3'
import assert from 'node:assert/strict'
import {
  BIBLE_TRANSLATIONS,
  DEFAULT_TRANSLATION_ID,
  buildTranslationAliasMap,
  bundledTranslationIdsInOrder,
  getDownloadablePack,
  getDownloadableTranslationIds,
  getTranslationDefinition,
  isBundledTranslation,
  translationCatalogEntries,
} from '../../../../lib/bible-translations'

test('every registry id is unique and normalized', () => {
  const ids = BIBLE_TRANSLATIONS.map((entry) => entry.id)
  assert.ok(ids.length > 0)
  assert.deepEqual(new Set(ids.map((id) => id.toUpperCase())).size, ids.length)
  for (const entry of BIBLE_TRANSLATIONS) {
    assert.equal(entry.id, entry.id.toUpperCase())
    assert.ok(entry.name.length > 0)
  }
})

test('the default translation ships with Kairo, so it works with no download or key', () => {
  assert.equal(DEFAULT_TRANSLATION_ID, 'KJV')
  assert.equal(isBundledTranslation(DEFAULT_TRANSLATION_ID), true)
})

test('bundled translations ship offline and can never be removed or overwritten', () => {
  for (const id of ['KJV', 'BBE', 'BSB']) {
    assert.equal(isBundledTranslation(id), true, `${id} must be bundled`)
    assert.equal(isBundledTranslation(id.toLowerCase()), true, 'bundled check is case-insensitive')
    assert.equal(getTranslationDefinition(id)?.access, 'local')
  }
  assert.equal(isBundledTranslation('NKJV'), false)
  assert.equal(isBundledTranslation('NOPE'), false)
  assert.deepEqual(bundledTranslationIdsInOrder(), ['KJV', 'BBE', 'BSB'])
})

test('public-domain texts missing from bible.db are API translations, not bundled', () => {
  for (const id of ['WEB', 'ASV', 'OEB']) {
    assert.equal(isBundledTranslation(id), false, `${id} is not in resources/bible.db`)
    assert.equal(getTranslationDefinition(id)?.access, 'api')
  }
})

test('registry bundled ids match the translations shipped in resources/bible.db', () => {
  const db = new Database(path.join(process.cwd(), 'resources', 'bible.db'), {
    readonly: true,
    fileMustExist: true,
  })
  try {
    const shipped = (db.prepare('SELECT id FROM translations').all() as Array<{ id: string }>)
      .map((row) => row.id.toUpperCase())
      .sort()
    assert.deepEqual([...bundledTranslationIdsInOrder()].sort(), shipped)
    for (const id of shipped) {
      assert.equal(getTranslationDefinition(id)?.access, 'local', `${id} ships locally`)
    }
  } finally {
    db.close()
  }
})

test('NKJV and NLT offer a one-click offline download', () => {
  for (const id of ['NKJV', 'NLT']) {
    const pack = getDownloadablePack(id)
    assert.ok(pack, `${id} must be downloadable`)
    assert.match(pack.url, /^https:\/\//)
    assert.match(pack.sha256, /^[0-9a-f]{64}$/)
    assert.ok(pack.approxLabel.length > 0)
  }
  assert.equal(getDownloadablePack('KJV'), undefined)
  assert.equal(getDownloadablePack('BBE'), undefined)
  assert.deepEqual(getDownloadableTranslationIds(), ['NKJV', 'NLT'])
})

test('sermon detection aliases resolve alternate abbreviations', () => {
  const aliases = buildTranslationAliasMap()
  assert.equal(aliases['NKJV'], 'NKJV')
  assert.equal(aliases['MESSAGE'], 'MSG')
  assert.equal(aliases['AMP'], 'AMPC')
  assert.equal(aliases['AMPLIFIED CLASSIC'], 'AMPC')
  assert.equal(aliases['PASSION'], 'TPT')
  assert.equal(aliases['BBE'], 'BBE')
})

test('the service catalog mirrors the registry in order', () => {
  const catalog = translationCatalogEntries()
  assert.equal(catalog.length, BIBLE_TRANSLATIONS.length)
  assert.deepEqual(catalog[0]?.[0], 'NKJV')
  assert.ok(catalog.some(([id]) => id === 'BBE'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ApiBibleCache } from '../api-bible-cache'
import { ApiCacheCrypto } from '../api-cache-crypto'
import { API_CACHE_MAX_AGE_MS } from '../api-cache-policy'

const NOW = Date.UTC(2026, 7, 25)
const BIBLE_ID = 'de4e12af7f28f599-01'

function openCache(): { cache: ApiBibleCache; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-bible-cache-'))
  const dbPath = path.join(dir, 'cache.db')
  const cache = ApiBibleCache.open(dbPath, ApiCacheCrypto.forTesting(Buffer.alloc(32, 3)))
  cache.upsertTranslation({
    bibleId: BIBLE_ID,
    translation: 'NKJV',
    name: 'New King James Version',
    copyright: '© Thomas Nelson',
  })
  return { cache, dbPath }
}

function johnVerses(numbers: number[]): Array<{ book: string; chapter: number; verse: number; text: string }> {
  return numbers.map((verse) => ({ book: 'John', chapter: 1, verse, text: `John 1:${verse} text` }))
}

test('returns a complete fresh cached range in verse order', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([3, 1, 2]), fetchedAt: NOW })

  const verses = cache.getRange(BIBLE_ID, 43, 1, 1, 3, NOW)
  assert.ok(verses)
  assert.deepEqual(verses!.map((v) => v.verse), [1, 2, 3])
  assert.equal(verses![0].text, 'John 1:1 text')
  assert.equal(verses![0].book, 'John')
})

test('returns a single verse when no range end is given', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1, 2]), fetchedAt: NOW })
  const verses = cache.getRange(BIBLE_ID, 43, 1, 2, undefined, NOW)
  assert.deepEqual(verses!.map((v) => v.verse), [2])
})

test('returns null when any requested verse is missing', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1, 3]), fetchedAt: NOW })
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 1, 3, NOW), null)
})

test('returns null when one requested verse is stale', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1, 2]), fetchedAt: NOW })
  cache.putPassage(BIBLE_ID, {
    bookId: 43, bookName: 'John', verses: johnVerses([3]), fetchedAt: NOW - API_CACHE_MAX_AGE_MS,
  })
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 1, 3, NOW), null)
})

test('returns null for a translation marked unavailable', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1]), fetchedAt: NOW })
  cache.markUnavailable(BIBLE_ID, 'Access revoked')
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 1, 1, NOW), null)
})

test('replacing a passage refreshes its fetched timestamp', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, {
    bookId: 43, bookName: 'John', verses: johnVerses([1]), fetchedAt: NOW - API_CACHE_MAX_AGE_MS,
  })
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 1, 1, NOW), null)
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1]), fetchedAt: NOW })
  assert.ok(cache.getRange(BIBLE_ID, 43, 1, 1, 1, NOW))
})

test('tracks chapter progress and verse counts per translation', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1, 2]), fetchedAt: NOW })
  cache.markChapterComplete(BIBLE_ID, 'JHN.1', NOW)
  cache.setTotalChapters(BIBLE_ID, 1189)

  const state = cache.getTranslationState(BIBLE_ID, NOW)
  assert.ok(state)
  assert.equal(state!.cachedVerses, 2)
  assert.equal(state!.cachedChapters, 1)
  assert.equal(state!.totalChapters, 1189)
  assert.equal(state!.status, 'partial')
  assert.equal(state!.expiresAt, NOW + API_CACHE_MAX_AGE_MS)
  assert.deepEqual(cache.getIncompleteChapters(BIBLE_ID, ['JHN.1', 'JHN.2'], NOW), ['JHN.2'])
})

test('reports a fully cached translation as downloaded and an old one as stale', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1]), fetchedAt: NOW })
  cache.markChapterComplete(BIBLE_ID, 'JHN.1', NOW)
  cache.setTotalChapters(BIBLE_ID, 1)
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'downloaded')
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW + API_CACHE_MAX_AGE_MS)!.status, 'stale')
})

test('lists every known translation state', () => {
  const { cache } = openCache()
  cache.upsertTranslation({ bibleId: 'other-01', translation: 'NLT', name: 'New Living Translation', copyright: '©' })
  assert.deepEqual(cache.listTranslationStates(NOW).map((s) => s.bibleId).sort(), ['de4e12af7f28f599-01', 'other-01'])
})

test('removeTranslation deletes metadata, verses, and chapter progress', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1, 2]), fetchedAt: NOW })
  cache.markChapterComplete(BIBLE_ID, 'JHN.1', NOW)

  cache.removeTranslation(BIBLE_ID)

  assert.equal(cache.getTranslationState(BIBLE_ID, NOW), null)
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 1, 2, NOW), null)
  assert.deepEqual(cache.countRowsForTesting(BIBLE_ID), { translations: 0, verses: 0, chapters: 0 })
})

test('cached database never contains plaintext verse text', () => {
  const { cache, dbPath } = openCache()
  cache.putPassage(BIBLE_ID, {
    bookId: 43,
    bookName: 'John',
    verses: [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world' }],
    fetchedAt: NOW,
  })
  cache.close()
  assert.ok(!fs.readFileSync(dbPath).includes(Buffer.from('For God so loved the world')))
})

test('serves a cached range whose translation omits a verse number', () => {
  const { cache } = openCache()
  // Versification differences mean 5:6 simply does not exist in this Bible.
  cache.putPassage(BIBLE_ID, {
    bookId: 43,
    bookName: 'John',
    verses: [
      { book: 'John', chapter: 5, verse: 5, text: 'five' },
      { book: 'John', chapter: 5, verse: 7, text: 'seven' },
    ],
    fetchedAt: NOW,
    coverage: { chapter: 5, verseStart: 5, verseEnd: 7 },
  })

  const verses = cache.getRange(BIBLE_ID, 43, 5, 5, 7, NOW)
  assert.deepEqual(verses!.map((v) => v.verse), [5, 7])
  assert.equal(cache.hasRange(BIBLE_ID, 43, 5, 5, 7), true)
})

test('a covered range that went stale is reported as present but not served', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, {
    bookId: 43,
    bookName: 'John',
    verses: [{ book: 'John', chapter: 5, verse: 5, text: 'five' }],
    fetchedAt: NOW - API_CACHE_MAX_AGE_MS,
    coverage: { chapter: 5, verseStart: 5, verseEnd: 7 },
  })
  assert.equal(cache.getRange(BIBLE_ID, 43, 5, 5, 7, NOW), null)
  assert.equal(cache.hasRange(BIBLE_ID, 43, 5, 5, 7), true)
})

test('a completed chapter covers any range inside it', () => {
  const { cache } = openCache()
  cache.putChapter(BIBLE_ID, 'JHN.5', {
    bookId: 43,
    bookName: 'John',
    verses: [
      { book: 'John', chapter: 5, verse: 1, text: 'one' },
      { book: 'John', chapter: 5, verse: 3, text: 'three' },
    ],
    fetchedAt: NOW,
    coverage: { chapter: 5 },
  })
  assert.deepEqual(cache.getRange(BIBLE_ID, 43, 5, 1, 3, NOW)!.map((v) => v.verse), [1, 3])
})

test('an uncovered gap is still a miss', () => {
  const { cache } = openCache()
  cache.putPassage(BIBLE_ID, { bookId: 43, bookName: 'John', verses: johnVerses([1]), fetchedAt: NOW })
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 1, 3, NOW), null)
})

test('refreshing a chapter drops verses the publisher removed', () => {
  const { cache } = openCache()
  cache.putChapter(BIBLE_ID, 'JHN.1', {
    bookId: 43, bookName: 'John', verses: johnVerses([1, 2, 3]), fetchedAt: NOW, coverage: { chapter: 1 },
  })
  cache.putChapter(BIBLE_ID, 'JHN.1', {
    bookId: 43, bookName: 'John', verses: johnVerses([1, 2]), fetchedAt: NOW, coverage: { chapter: 1 },
  })

  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.cachedVerses, 2)
  assert.equal(cache.getRange(BIBLE_ID, 43, 1, 3, 3, NOW), null)
})

test('markUnavailable purges cached text and chapter progress', () => {
  const { cache } = openCache()
  cache.putChapter(BIBLE_ID, 'JHN.1', {
    bookId: 43, bookName: 'John', verses: johnVerses([1, 2]), fetchedAt: NOW, coverage: { chapter: 1 },
  })

  cache.markUnavailable(BIBLE_ID, 'Access revoked')

  const state = cache.getTranslationState(BIBLE_ID, NOW)!
  assert.equal(state.status, 'unavailable')
  assert.equal(state.cachedVerses, 0)
  assert.equal(state.cachedChapters, 0)
  assert.equal(cache.hasRange(BIBLE_ID, 43, 1, 1, 2), false)
  assert.deepEqual(cache.countRowsForTesting(BIBLE_ID), { translations: 1, verses: 0, chapters: 0 })
})

test('access checks are recorded per translation', () => {
  const { cache } = openCache()
  assert.equal(cache.getLastAccessCheck(BIBLE_ID), null)
  cache.markAccessChecked(BIBLE_ID, NOW)
  assert.equal(cache.getLastAccessCheck(BIBLE_ID), NOW)
})

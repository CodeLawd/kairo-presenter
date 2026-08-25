import test from 'node:test'
import assert from 'node:assert/strict'
import type { ScriptureVerse } from '@shared/ipc'
import { ApiBibleLookup, type ApiBibleLookupCache, type ApiBibleLookupClient } from '../api-bible-lookup'
import { ApiBibleRequestError, type ApiBiblePassage } from '../api-bible-client'
import { API_CACHE_MESSAGES } from '../api-cache-policy'

const BIBLE_ID = 'nkjv-01'
const NOW = Date.UTC(2026, 7, 25)
const JOHN = { id: 43, name: 'John' }

function verse(n: number): ScriptureVerse {
  return { book: 'John', chapter: 3, verse: n, text: `verse ${n}` }
}

interface FakeCache extends ApiBibleLookupCache {
  puts: Array<{ bibleId: string; verses: ScriptureVerse[] }>
  unavailable: string[]
}

function fakeCache(overrides: Partial<ApiBibleLookupCache> = {}): FakeCache {
  const cache: FakeCache = {
    puts: [],
    unavailable: [],
    getRange: () => null,
    hasRange: () => false,
    getTranslationState: () => null,
    getLastAccessCheck: () => Number.MAX_SAFE_INTEGER,
    markAccessChecked: () => {},
    upsertTranslation: () => {},
    putPassage(bibleId, passage) {
      cache.puts.push({ bibleId, verses: passage.verses })
    },
    markUnavailable(bibleId) {
      cache.unavailable.push(bibleId)
    },
    ...overrides,
  }
  return cache
}

function fakeClient(result: ApiBiblePassage | Error) {
  const client = {
    calls: [] as string[],
    bibleCalls: [] as string[],
    bibleError: null as Error | null,
    async getPassage(_bibleId: string, passageId: string) {
      client.calls.push(passageId)
      if (result instanceof Error) throw result
      return result
    },
    async getBible(bibleId: string) {
      client.bibleCalls.push(bibleId)
      if (client.bibleError) throw client.bibleError
      return {
        id: bibleId,
        name: 'New King James Version',
        abbreviationLocal: 'NKJV',
        copyright: '© Thomas Nelson',
      }
    },
  }
  return client satisfies ApiBibleLookupClient & Record<string, unknown>
}

const PASSAGE: ApiBiblePassage = {
  bibleId: BIBLE_ID,
  passageId: 'JHN.3.16-JHN.3.17',
  reference: 'John 3:16-17',
  copyright: '© Thomas Nelson',
  verses: [verse(16), verse(17)],
}

const REQUEST = {
  bibleId: BIBLE_ID,
  translation: 'NKJV' as const,
  book: JOHN,
  chapter: 3,
  verseStart: 16,
  verseEnd: 17,
}

test('fresh cache hit does not call API.Bible', async () => {
  const client = fakeClient(PASSAGE)
  const cache = fakeCache({ getRange: () => [verse(16), verse(17)] })
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  const results = await lookup.lookupPassage(REQUEST)

  assert.equal(client.calls.length, 0)
  assert.deepEqual(results, [
    { reference: 'John 3:16–17', translation: 'NKJV', verses: [verse(16), verse(17)] },
  ])
})

test('cache miss fetches the API passage and stores every verse', async () => {
  const client = fakeClient(PASSAGE)
  const cache = fakeCache()
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  const results = await lookup.lookupPassage(REQUEST)

  assert.deepEqual(client.calls, ['JHN.3.16-JHN.3.17'])
  assert.equal(cache.puts.length, 1)
  assert.deepEqual(cache.puts[0].verses.map((v) => v.verse), [16, 17])
  assert.deepEqual(results[0].verses.map((v) => v.verse), [16, 17])
})

test('a single verse request uses a single passage id', async () => {
  const client = fakeClient({ ...PASSAGE, verses: [verse(16)] })
  const lookup = new ApiBibleLookup(fakeCache(), client, () => NOW)

  const results = await lookup.lookupPassage({ ...REQUEST, verseEnd: undefined })

  assert.deepEqual(client.calls, ['JHN.3.16'])
  assert.equal(results[0].reference, 'John 3:16')
})

test('stale cache is never served when refresh fails', async () => {
  const client = fakeClient(new Error('getaddrinfo ENOTFOUND rest.api.bible'))
  const cache = fakeCache({ hasRange: () => true })
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  await assert.rejects(() => lookup.lookupPassage(REQUEST), {
    message: API_CACHE_MESSAGES.refreshRequired,
  })
  assert.equal(cache.puts.length, 0)
})

test('a network failure with no cached copy reports the passage as unavailable offline', async () => {
  const client = fakeClient(new Error('socket hang up'))
  const lookup = new ApiBibleLookup(fakeCache(), client, () => NOW)

  await assert.rejects(() => lookup.lookupPassage(REQUEST), {
    message: API_CACHE_MESSAGES.notAvailableOffline,
  })
})

test('401 or 403 marks the translation unavailable', async () => {
  for (const status of [401, 403]) {
    const client = fakeClient(new ApiBibleRequestError('denied', status, null))
    const cache = fakeCache({ hasRange: () => true })
    const lookup = new ApiBibleLookup(cache, client, () => NOW)

    await assert.rejects(() => lookup.lookupPassage(REQUEST), {
      message: API_CACHE_MESSAGES.accessRevoked,
    })
    assert.deepEqual(cache.unavailable, [BIBLE_ID])
  }
})

test('a translation already marked unavailable is not requested again', async () => {
  const client = fakeClient(PASSAGE)
  const cache = fakeCache({
    getTranslationState: () => ({
      bibleId: BIBLE_ID,
      translation: 'NKJV',
      name: 'New King James Version',
      copyright: '©',
      status: 'unavailable',
      cachedChapters: 0,
      totalChapters: 0,
      cachedVerses: 0,
      fetchedAt: null,
      expiresAt: null,
    }),
  })
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  await assert.rejects(() => lookup.lookupPassage(REQUEST), {
    message: API_CACHE_MESSAGES.accessRevoked,
  })
  assert.equal(client.calls.length, 0)
})

test('a fetched passage records translation metadata and copyright', async () => {
  const upserts: Array<{ bibleId: string; copyright: string }> = []
  const cache = fakeCache({
    upsertTranslation: (meta) => {
      upserts.push({ bibleId: meta.bibleId, copyright: meta.copyright })
    },
  })
  const lookup = new ApiBibleLookup(cache, fakeClient(PASSAGE), () => NOW)

  await lookup.lookupPassage({ ...REQUEST, name: 'New King James Version' })

  assert.deepEqual(upserts, [{ bibleId: BIBLE_ID, copyright: '© Thomas Nelson' }])
})

test('an empty API response returns no results rather than caching nothing useful', async () => {
  const cache = fakeCache()
  const lookup = new ApiBibleLookup(cache, fakeClient({ ...PASSAGE, verses: [] }), () => NOW)

  assert.deepEqual(await lookup.lookupPassage(REQUEST), [])
  assert.equal(cache.puts.length, 0)
})

test('a cache hit records the range that was actually requested', async () => {
  const puts: Array<{ coverage?: unknown }> = []
  const cache = fakeCache({
    putPassage: (_bibleId, passage) => { puts.push({ coverage: passage.coverage }) },
  })
  const lookup = new ApiBibleLookup(cache, fakeClient(PASSAGE), () => NOW)

  await lookup.lookupPassage(REQUEST)

  assert.deepEqual(puts[0].coverage, { chapter: 3, verseStart: 16, verseEnd: 17 })
})

test('serving cached text revalidates access once per session', async () => {
  const checks: string[] = []
  const cache = fakeCache({
    getRange: () => [verse(16), verse(17)],
    getLastAccessCheck: () => null,
    markAccessChecked: (bibleId) => { checks.push(bibleId) },
  })
  const client = fakeClient(PASSAGE)
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  await lookup.lookupPassage(REQUEST)
  await lookup.lookupPassage(REQUEST)
  await lookup.whenIdle()

  assert.deepEqual(client.bibleCalls, [BIBLE_ID], 'access is revalidated exactly once per session')
  assert.deepEqual(checks, [BIBLE_ID])
})

test('access checked earlier in this session is not repeated', async () => {
  const cache = fakeCache({
    getRange: () => [verse(16)],
    getLastAccessCheck: () => NOW,
  })
  const client = fakeClient(PASSAGE)
  const lookup = new ApiBibleLookup(cache, client, () => NOW, NOW - 1)

  await lookup.lookupPassage(REQUEST)
  await lookup.whenIdle()

  assert.deepEqual(client.bibleCalls, [])
})

test('revalidation that fails offline keeps cached text usable', async () => {
  const cache = fakeCache({ getRange: () => [verse(16)], getLastAccessCheck: () => null })
  const client = fakeClient(PASSAGE)
  client.bibleError = new Error('getaddrinfo ENOTFOUND rest.api.bible')
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  const results = await lookup.lookupPassage(REQUEST)
  await lookup.whenIdle()

  assert.equal(results.length, 1)
  assert.deepEqual(cache.unavailable, [])
})

test('revalidation that is refused purges the translation', async () => {
  const cache = fakeCache({ getRange: () => [verse(16)], getLastAccessCheck: () => null })
  const client = fakeClient(PASSAGE)
  client.bibleError = new ApiBibleRequestError('denied', 403, null)
  const lookup = new ApiBibleLookup(cache, client, () => NOW)

  await lookup.lookupPassage(REQUEST)
  await lookup.whenIdle()

  assert.deepEqual(cache.unavailable, [BIBLE_ID])
})

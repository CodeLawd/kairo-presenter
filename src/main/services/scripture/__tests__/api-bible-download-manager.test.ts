import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ApiBibleDownloadProgress } from '@shared/ipc'
import { ApiBibleCache } from '../api-bible-cache'
import { ApiCacheCrypto } from '../api-cache-crypto'
import { ApiBibleDownloadManager } from '../api-bible-download-manager'
import { ApiBibleRequestError, type ApiBiblePassage, type ApiBibleDetails } from '../api-bible-client'
import { API_CACHE_MAX_AGE_MS, API_CACHE_MESSAGES } from '../api-cache-policy'

const BIBLE_ID = 'nkjv-01'
const NOW = Date.UTC(2026, 7, 25)

const DETAILS: ApiBibleDetails = {
  id: BIBLE_ID,
  name: 'New King James Version',
  abbreviation: 'engNKJV',
  abbreviationLocal: 'NKJV',
  copyright: '© Thomas Nelson',
}

interface ClientOptions {
  chaptersPerBook?: string[]
  details?: ApiBibleDetails | Error
  onGetChapter?: (chapterId: string, attempt: number) => void | Error
}

function fakeClient(options: ClientOptions = {}) {
  const attempts = new Map<string, number>()
  const state = {
    chapterCalls: [] as string[],
    inFlight: 0,
    maxInFlight: 0,
    async getBible(): Promise<ApiBibleDetails> {
      if (options.details instanceof Error) throw options.details
      return options.details ?? DETAILS
    },
    async listBooks() {
      return [{ id: 'JHN', name: 'John' }]
    },
    async listChapters() {
      return (options.chaptersPerBook ?? ['intro', '1', '2', '3']).map((number) => ({
        id: `JHN.${number}`,
        number,
        bookId: 'JHN',
      }))
    },
    async getChapter(_bibleId: string, chapterId: string): Promise<ApiBiblePassage> {
      state.inFlight += 1
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      try {
        const attempt = (attempts.get(chapterId) ?? 0) + 1
        attempts.set(chapterId, attempt)
        state.chapterCalls.push(chapterId)
        await Promise.resolve()
        const failure = options.onGetChapter?.(chapterId, attempt)
        if (failure) throw failure
        const chapter = Number(chapterId.split('.')[1])
        return {
          bibleId: BIBLE_ID,
          passageId: chapterId,
          reference: `John ${chapter}`,
          copyright: '© Thomas Nelson',
          verses: [{ book: 'John', chapter, verse: 1, text: `John ${chapter}:1` }],
        }
      } finally {
        state.inFlight -= 1
      }
    },
  }
  return state
}

function setup(client: ReturnType<typeof fakeClient>, overrides: { now?: () => number; enabled?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-bible-download-'))
  const cache = ApiBibleCache.open(
    path.join(dir, 'cache.db'),
    ApiCacheCrypto.forTesting(Buffer.alloc(32, 5)),
  )
  const progress: ApiBibleDownloadProgress[] = []
  const manager = new ApiBibleDownloadManager({
    cache,
    getClient: () => client as never,
    getAuthorizedTranslations: async () => [
      { bibleId: BIBLE_ID, translation: 'NKJV' as const, name: 'New King James Version' },
    ],
    isOfflineDownloadEnabled: () => overrides.enabled ?? true,
    clock: overrides.now ?? (() => NOW),
    sleep: async () => {},
    concurrency: 2,
  })
  manager.onProgress((value) => progress.push(value))
  return { cache, manager, progress }
}

test('refuses to download a translation without confirmed offline rights', async () => {
  const client = fakeClient()
  const { manager } = setup(client, { enabled: false })

  await assert.rejects(() => manager.startDownload(BIBLE_ID), {
    message: API_CACHE_MESSAGES.offlineDownloadNotPermitted,
  })
  assert.equal(client.chapterCalls.length, 0)
})

test('downloads every chapter except intro, with at most two concurrent requests', async () => {
  const client = fakeClient()
  const { manager, cache, progress } = setup(client)

  await manager.startDownload(BIBLE_ID)

  assert.deepEqual(client.chapterCalls.sort(), ['JHN.1', 'JHN.2', 'JHN.3'])
  assert.ok(client.maxInFlight <= 2, `max in flight was ${client.maxInFlight}`)
  const state = cache.getTranslationState(BIBLE_ID, NOW)!
  assert.equal(state.status, 'downloaded')
  assert.equal(state.totalChapters, 3)
  assert.equal(state.cachedChapters, 3)
  assert.equal(state.copyright, '© Thomas Nelson')
  assert.deepEqual(progress.at(-1), {
    bibleId: BIBLE_ID,
    status: 'downloaded',
    completedChapters: 3,
    totalChapters: 3,
    cachedVerses: 3,
  })
})

test('persists progress after every chapter so a pause resumes without refetching', async () => {
  const client = fakeClient()
  const first = setup(client)
  first.manager.pauseAfterNextChapter = true

  await first.manager.startDownload(BIBLE_ID)
  const paused = first.cache.getTranslationState(BIBLE_ID, NOW)!
  assert.equal(paused.status, 'paused')
  assert.ok(paused.cachedChapters >= 1 && paused.cachedChapters < 3)

  const completedBefore = client.chapterCalls.length
  await first.manager.startDownload(BIBLE_ID)

  assert.equal(first.cache.getTranslationState(BIBLE_ID, NOW)!.status, 'downloaded')
  assert.equal(client.chapterCalls.length, completedBefore + (3 - paused.cachedChapters))
})

test('a download interrupted by app exit resumes from the incomplete chapters', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client)
  cache.upsertTranslation({ bibleId: BIBLE_ID, translation: 'NKJV', name: 'NKJV', copyright: '©' })
  cache.setStatus(BIBLE_ID, 'downloading')

  manager.recoverInterruptedDownloads()
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'paused')

  await manager.startDownload(BIBLE_ID)
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'downloaded')
})

test('retries a rate-limited chapter using Retry-After', async () => {
  const client = fakeClient({
    onGetChapter: (chapterId, attempt) =>
      chapterId === 'JHN.2' && attempt === 1
        ? new ApiBibleRequestError('slow down', 429, 1_000)
        : undefined,
  })
  const { manager, cache } = setup(client)

  await manager.startDownload(BIBLE_ID)

  assert.equal(client.chapterCalls.filter((id) => id === 'JHN.2').length, 2)
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'downloaded')
})

test('a revoked translation is marked unavailable and stops downloading', async () => {
  const client = fakeClient({ details: new ApiBibleRequestError('denied', 403, null) })
  const { manager, cache, progress } = setup(client)
  cache.upsertTranslation({ bibleId: BIBLE_ID, translation: 'NKJV', name: 'NKJV', copyright: '©' })

  await assert.rejects(() => manager.startDownload(BIBLE_ID), {
    message: API_CACHE_MESSAGES.accessRevoked,
  })
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'unavailable')
  assert.equal(progress.at(-1)!.status, 'unavailable')
  assert.equal(client.chapterCalls.length, 0)
})

test('a failed chapter leaves the translation in a failed state with its error', async () => {
  const client = fakeClient({
    onGetChapter: (chapterId) => (chapterId === 'JHN.2' ? new Error('socket hang up') : undefined),
  })
  const { manager, cache } = setup(client)

  await assert.rejects(() => manager.startDownload(BIBLE_ID))

  const state = cache.getTranslationState(BIBLE_ID, NOW)!
  assert.equal(state.status, 'failed')
  assert.match(state.error!, /socket hang up/)
})

test('refresh re-fetches only chapters that reached the 30-day boundary', async () => {
  const client = fakeClient()
  let now = NOW
  const { manager, cache } = setup(client, { now: () => now })

  await manager.startDownload(BIBLE_ID)
  const initialCalls = client.chapterCalls.length

  now = NOW + API_CACHE_MAX_AGE_MS
  assert.equal(cache.getTranslationState(BIBLE_ID, now)!.status, 'stale')

  await manager.refreshTranslation(BIBLE_ID)

  assert.equal(client.chapterCalls.length, initialCalls + 3)
  assert.equal(cache.getTranslationState(BIBLE_ID, now)!.status, 'downloaded')
})

test('refresh keeps the old fetch time when the network call fails', async () => {
  const client = fakeClient()
  let now = NOW
  const { manager, cache } = setup(client, { now: () => now })
  await manager.startDownload(BIBLE_ID)

  now = NOW + API_CACHE_MAX_AGE_MS
  const failing = fakeClient({ onGetChapter: () => new Error('offline') })
  const offlineManager = new ApiBibleDownloadManager({
    cache,
    getClient: () => failing as never,
    getAuthorizedTranslations: async () => [],
    isOfflineDownloadEnabled: () => true,
    clock: () => now,
    sleep: async () => {},
  })

  await assert.rejects(() => offlineManager.refreshTranslation(BIBLE_ID))
  assert.equal(cache.getTranslationState(BIBLE_ID, now)!.fetchedAt, NOW)
})

test('listOfflineTranslations reports cache state plus the licence gate', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client, { enabled: false })
  cache.upsertTranslation({ bibleId: BIBLE_ID, translation: 'NKJV', name: 'NKJV', copyright: '©' })

  const [row] = await manager.listOfflineTranslations()
  assert.equal(row.bibleId, BIBLE_ID)
  assert.equal(row.offlineDownloadEnabled, false)
  assert.equal(row.status, 'not-downloaded')
})

test('an authorized translation with no cache row can still be downloaded', async () => {
  const client = fakeClient()
  const { manager } = setup(client)

  const rows = await manager.listOfflineTranslations()

  assert.deepEqual(rows.map((row) => row.bibleId), [BIBLE_ID])
  assert.equal(rows[0].status, 'not-downloaded')
  assert.equal(rows[0].name, 'New King James Version')
  assert.equal(rows[0].offlineDownloadEnabled, true)
  assert.equal(rows[0].cachedVerses, 0)
})

test('a revoked translation still on disk is listed even when no longer authorized', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client)
  cache.upsertTranslation({ bibleId: 'gone-01', translation: 'NLT', name: 'New Living Translation', copyright: '©' })
  cache.markUnavailable('gone-01', 'Access revoked')

  const rows = await manager.listOfflineTranslations()

  assert.deepEqual(rows.map((row) => row.bibleId).sort(), ['gone-01', BIBLE_ID])
  assert.equal(rows.find((row) => row.bibleId === 'gone-01')!.status, 'unavailable')
})

test('an unreachable API.Bible still lists what is cached', async () => {
  const client = fakeClient()
  const { cache } = setup(client)
  cache.upsertTranslation({ bibleId: BIBLE_ID, translation: 'NKJV', name: 'NKJV', copyright: '©' })
  const manager = new ApiBibleDownloadManager({
    cache,
    getClient: () => client as never,
    getAuthorizedTranslations: async () => { throw new Error('offline') },
    isOfflineDownloadEnabled: () => true,
    clock: () => NOW,
  })

  assert.deepEqual((await manager.listOfflineTranslations()).map((row) => row.bibleId), [BIBLE_ID])
})

test('refresh is refused when the offline licence was not confirmed', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client, { enabled: false })
  cache.upsertTranslation({ bibleId: BIBLE_ID, translation: 'NKJV', name: 'NKJV', copyright: '©' })

  await assert.rejects(() => manager.refreshTranslation(BIBLE_ID), {
    message: API_CACHE_MESSAGES.offlineDownloadNotPermitted,
  })
  assert.equal(client.chapterCalls.length, 0)
})

test('revoked access purges the cached text as well as blocking it', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client)
  await manager.startDownload(BIBLE_ID)
  assert.ok(cache.getTranslationState(BIBLE_ID, NOW)!.cachedVerses > 0)

  const revoked = fakeClient({ details: new ApiBibleRequestError('denied', 401, null) })
  const revokedManager = new ApiBibleDownloadManager({
    cache,
    getClient: () => revoked as never,
    getAuthorizedTranslations: async () => [],
    isOfflineDownloadEnabled: () => true,
    clock: () => NOW,
  })

  await assert.rejects(() => revokedManager.startDownload(BIBLE_ID))

  const state = cache.getTranslationState(BIBLE_ID, NOW)!
  assert.equal(state.status, 'unavailable')
  assert.equal(state.cachedVerses, 0)
})

test('removeTranslation purges cached text', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client)
  await manager.startDownload(BIBLE_ID)

  manager.removeTranslation(BIBLE_ID)

  assert.equal(cache.getTranslationState(BIBLE_ID, NOW), null)
  assert.deepEqual(cache.countRowsForTesting(BIBLE_ID), { translations: 0, verses: 0, chapters: 0 })
})

test('a background download returns before it finishes so it can be paused', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client)

  await manager.startDownloadInBackground(BIBLE_ID)
  // Nothing is committed yet: the caller was released immediately.
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW), null)

  await manager.whenIdle()
  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'downloaded')
})

test('a background download refuses an unlicensed translation up front', async () => {
  const client = fakeClient()
  const { manager } = setup(client, { enabled: false })

  await assert.rejects(() => manager.startDownloadInBackground(BIBLE_ID), {
    message: API_CACHE_MESSAGES.offlineDownloadNotPermitted,
  })
})

test('a background failure is recorded rather than thrown at the caller', async () => {
  const client = fakeClient({ onGetChapter: () => new Error('socket hang up') })
  const { manager, cache } = setup(client)

  await manager.startDownloadInBackground(BIBLE_ID)
  await manager.whenIdle()

  assert.equal(cache.getTranslationState(BIBLE_ID, NOW)!.status, 'failed')
})

test('hasCachedTranslation only reports what is on disk', async () => {
  const client = fakeClient()
  const { manager, cache } = setup(client)
  assert.equal(manager.hasCachedTranslation(BIBLE_ID), false)
  cache.upsertTranslation({ bibleId: BIBLE_ID, translation: 'NKJV', name: 'NKJV', copyright: '©' })
  assert.equal(manager.hasCachedTranslation(BIBLE_ID), true)
})

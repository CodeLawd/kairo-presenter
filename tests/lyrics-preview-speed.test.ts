import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { snippetResolver } from '../src/main/services/lyrics/snippet-resolver'
import { OnlineLyricsTextCache, OnlinePreviewPrefetcher, onlineLyricsTextCache } from '../src/main/services/lyrics/online-cache'
import { rankResults } from '../src/main/services/lyrics/online'
import type { LyricsOnlineResult } from '../src/lib/ipc'

const hit = (n: number): LyricsOnlineResult => ({ id: `web:${n}`, provider: 'web', url: `https://example.com/${n}`, title: 'A song', artist: 'An artist' })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test('search retains inline web lyrics for preview instead of discarding them', () => {
  const source = { ...hit(1), url: 'https://example.com/inline-cache-test' }
  const results = rankResults('A song', [{ ...source, lyrics: 'A first lyric\nAnother lyric' }])
  assert.equal(onlineLyricsTextCache.get(results[0]), 'A first lyric\nAnother lyric')
  assert.equal('lyrics' in results[0], false, 'raw lyrics stay in main process')
})

test('source cache distinguishes title-specific extraction and expires', (t) => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const cache = new OnlineLyricsTextCache()
  cache.remember(hit(1), 'Original source')
  assert.equal(cache.get(hit(1)), 'Original source')
  assert.equal(cache.get({ ...hit(1), title: 'Different song' }), undefined)
  now = 10 * 60_000 + 1
  assert.equal(cache.get(hit(1)), undefined)
})

test('source cache is bounded', () => {
  const cache = new OnlineLyricsTextCache()
  for (let i = 0; i < 51; i++) cache.remember(hit(i), `Source ${i}`)
  assert.equal(cache.get(hit(0)), undefined)
  assert.equal(cache.get(hit(50)), 'Source 50')
})

test('top two previews start before selection without waiting for them to finish', async () => {
  const prefetch = new OnlinePreviewPrefetcher()
  const work = deferred()
  const started: string[] = []
  const pending = prefetch.warm([hit(1), hit(2), hit(3)], async (source) => { started.push(source.id); await work.promise })
  assert.deepEqual(started, ['web:1', 'web:2'])
  work.resolve()
  await pending
})

test('background previews skip owned songs and deduplicate concurrent searches', async () => {
  const prefetch = new OnlinePreviewPrefetcher()
  const work = deferred()
  const started: string[] = []
  const prepare = async (source: LyricsOnlineResult) => { started.push(source.id); await work.promise }
  const first = prefetch.warm([{ ...hit(0), existingSongId: 'local' }, hit(1)], prepare)
  const second = prefetch.warm([hit(1), hit(2), hit(3)], prepare)
  assert.deepEqual(started, ['web:1', 'web:2'])
  work.resolve()
  await Promise.all([first, second])
})

test('background failure is contained and frees its slot for a later search', async () => {
  const prefetch = new OnlinePreviewPrefetcher()
  await prefetch.warm([hit(1), hit(2)], async () => { throw new Error('offline') })
  const started: string[] = []
  await prefetch.warm([hit(3), hit(4)], async (source) => { started.push(source.id) })
  assert.deepEqual(started, ['web:3', 'web:4'])
})

test('candidate pages fetch concurrently and retain search order', async (t) => {
  const work = deferred()
  const started: string[] = []
  t.mock.method(axios, 'get', async (url: string) => {
    started.push(url)
    await work.promise
    const n = url.slice(-1)
    return { data: `<h1 class="entry-title">Test Song ${n} Lyrics by Artist ${n}</h1><div class="entry-content"><p>Test song opening line<br>Another sung line</p><p>A closing line<br>Another closing line</p></div>` }
  })
  const urls = [1, 2, 3].map((n) => `https://africangospellyrics.com/test-song-${n}`)
  const resolver = snippetResolver as unknown as { gatherCandidates: (hits: {url: string}[], canonical: string, query: string) => Promise<LyricsOnlineResult[]> }
  const pending = resolver.gatherCandidates(urls.map((url) => ({ url })), 'test song', 'Test Song')
  try { assert.deepEqual(started, urls, 'all candidate requests start before the first one finishes') }
  finally { work.resolve() }
  const results = await pending
  assert.deepEqual(results.map((result) => result.url), urls)
})

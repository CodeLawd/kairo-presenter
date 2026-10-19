import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'
import { searchWebProviders } from '../src/main/services/lyrics/web-search'
import { snippetResolver } from '../src/main/services/lyrics/snippet-resolver'
import { fetchOnlineGlossMap } from '../src/main/services/lyrics/online-glosses'

const keys = { deepseekApiKey: 'deepseek-test', braveApiKey: 'brave-test' }
const hit = { title: 'A song', url: 'https://africangospellyrics.com/a-song/' }

test('DeepSeek is first and Brave is not called when the consumer accepts its results', async (t) => {
  const post = t.mock.method(axios, 'post', async (url, body, config) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/search')
    assert.deepEqual(body, { query: 'A song lyrics', count: 8, need_content: false })
    assert.equal(config.headers.Authorization, 'Bearer deepseek-test')
    return { data: { results: [hit] } }
  })
  const get = t.mock.method(axios, 'get', async () => { throw new Error('Brave should not run') })
  for await (const batch of searchWebProviders('A song lyrics', keys)) {
    assert.equal(batch.provider, 'deepseek')
    assert.equal(batch.results[0].url, hit.url)
    break
  }
  assert.equal(post.mock.callCount(), 1)
  assert.equal(get.mock.callCount(), 0)
})

for (const status of [401, 402, 429, 504]) {
  test(`DeepSeek HTTP ${status} falls back to Brave`, async (t) => {
    t.mock.method(axios, 'post', async () => {
      throw Object.assign(new Error('failed'), { isAxiosError: true, response: { status } })
    })
    t.mock.method(axios, 'get', async (_url, config) => {
      assert.equal(config.headers['X-Subscription-Token'], 'brave-test')
      return { data: { web: { results: [hit] } } }
    })
    const batches = []
    for await (const batch of searchWebProviders('A song lyrics', keys)) batches.push(batch)
    assert.deepEqual(batches.map((b) => b.provider), ['brave'])
  })
}

test('empty or malformed DeepSeek results fall back to Brave', async (t) => {
  t.mock.method(axios, 'post', async () => ({ data: { results: [{ url: 'javascript:alert(1)' }, null] } }))
  t.mock.method(axios, 'get', async () => ({ data: { web: { results: [hit] } } }))
  const batches = []
  for await (const batch of searchWebProviders('A song lyrics', keys)) batches.push(batch)
  assert.deepEqual(batches.map((b) => b.provider), ['brave'])
})

test('oversized queries preserve their meaning by using Brave instead of truncating', async (t) => {
  const query = 'a'.repeat(129)
  const post = t.mock.method(axios, 'post', async () => { throw new Error('too long') })
  t.mock.method(axios, 'get', async (_url, config) => {
    assert.equal(config.params.q, query)
    return { data: { web: { results: [hit] } } }
  })
  for await (const batch of searchWebProviders(query, keys)) assert.equal(batch.provider, 'brave')
  assert.equal(post.mock.callCount(), 0)
})

test('DeepSeek length limit counts Unicode characters and strips tracking URLs', async (t) => {
  t.mock.method(axios, 'post', async () => ({ data: { results: [{ ...hit, url: hit.url + '?share=twitter#respond' }] } }))
  for await (const batch of searchWebProviders('😀'.repeat(128), { deepseekApiKey: keys.deepseekApiKey })) {
    assert.equal(batch.results[0].url, hit.url)
  }
})

test('missing keys do not send paid requests', async (t) => {
  const post = t.mock.method(axios, 'post', async () => { throw new Error('no key') })
  const get = t.mock.method(axios, 'get', async () => { throw new Error('no key') })
  for await (const _batch of searchWebProviders('A song lyrics', {})) assert.fail('unexpected batch')
  assert.equal(post.mock.callCount() + get.mock.callCount(), 0)
})

test('unverified DeepSeek hits continue to Brave; verified results are cached', async (t) => {
  snippetResolver.clearCache()
  const providers: string[] = []
  t.mock.method(axios, 'post', async () => { providers.push('deepseek'); return { data: { results: [hit] } } })
  t.mock.method(axios, 'get', async () => { providers.push('brave'); return { data: { web: { results: [hit] } } } })
  const verified = [{ id: 'web:song', provider: 'web' as const, title: 'A song', artist: '', url: hit.url, lyrics: 'A song' }]
  // The existing candidate verifier is covered separately; exercise provider orchestration here.
  const internals = snippetResolver as unknown as { gatherCandidates: () => Promise<typeof verified> }
  let checks = 0
  t.mock.method(internals, 'gatherCandidates', async () => ++checks === 1 ? [] : verified)
  assert.deepEqual(await snippetResolver.resolve('A song', keys), verified)
  assert.deepEqual(await snippetResolver.resolve('A song', keys), verified)
  assert.deepEqual(providers, ['deepseek', 'brave'])
  snippetResolver.clearCache()
})

test('failed paid providers retain keyless lyric search', async (t) => {
  snippetResolver.clearCache()
  t.mock.method(axios, 'post', async () => { throw new Error('offline') })
  t.mock.method(axios, 'get', async () => { throw new Error('offline') })
  const internals = snippetResolver as unknown as {
    searchWebHtml: () => Promise<typeof hit[]>
    gatherCandidates: () => Promise<unknown[]>
  }
  const html = t.mock.method(internals, 'searchWebHtml', async () => [hit])
  t.mock.method(internals, 'gatherCandidates', async () => [])
  assert.deepEqual(await snippetResolver.resolve('Missing song', keys), [])
  assert.equal(html.mock.callCount(), 1)
  snippetResolver.clearCache()
})

test('published gloss lookup tries Brave when DeepSeek pages contain no glosses', async (t) => {
  const calls: string[] = []
  t.mock.method(axios, 'post', async () => { calls.push('deepseek'); return { data: { results: [hit] } } })
  t.mock.method(axios, 'get', async (url: string) => {
    if (url.includes('api.search.brave.com')) {
      calls.push('brave')
      return { data: { web: { results: [{ ...hit, url: 'https://africangospellyrics.com/gloss/' }] } } }
    }
    return { data: url.includes('/gloss/') ? '<article>Odudu (Power)<br>Abasi (God)</article>' : '<article>No bilingual lyrics here</article>' }
  })
  const pairs = await fetchOnlineGlossMap({ title: 'Odudu', ...keys })
  assert.ok(pairs.size > 0)
  assert.ok(calls.indexOf('deepseek') >= 0 && calls.indexOf('deepseek') < calls.indexOf('brave'))
})

test('unrelated or incomplete glosses do not suppress Brave for the requested lines', async (t) => {
  let braveCalled = false
  t.mock.method(axios, 'post', async () => ({ data: { results: [{ ...hit, url: 'https://africangospellyrics.com/partial/' }] } }))
  t.mock.method(axios, 'get', async (url: string) => {
    if (url.includes('api.search.brave.com')) {
      braveCalled = true
      return { data: { web: { results: [{ ...hit, url: 'https://africangospellyrics.com/complete/' }] } } }
    }
    if (url.includes('/complete/')) return { data: '<article>Odudu (Power)<br>Abasi (God)</article>' }
    return { data: '<article>Odudu (Power)<br>Jesu (Jesus)</article>' }
  })
  const pairs = await fetchOnlineGlossMap({ title: 'Odudu', ...keys, sourceLines: ['Odudu', 'Abasi'] })
  assert.equal(braveCalled, true)
  assert.ok(pairs.has('abasi'))
})

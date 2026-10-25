import './helpers/managed-transport'
import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { reviewOnlineLyrics } from '../src/main/services/lyrics/review'

const source = { title: 'Test song', artist: 'Test artist', apiKey: 'test-key' }
const text = 'Download this song\n\n[Verse 1]\nẸ ṣe Olúwa\n(Thank you Lord)\n\n[Chorus]\nYou are good\nYou are good\nSubscribe to our newsletter'
const response = (value: unknown, finish_reason = 'stop') => ({ data: { choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] } })
const selected = (keepLineIds: number[], sections = [{ type: 'verse', startLineId: keepLineIds.find((id) => ![2, 6].includes(id)) }]) => ({ matchesSong: true, keepLineIds, sections })

test('review removes page prose using source IDs, preserving languages, glosses, repeats and sections', async (t) => {
  t.mock.method(axios, 'post', async (_url, body, config) => {
    assert.equal(body.response_format.type, 'json_object')
    assert.deepEqual(config.headers, {}, 'Provider credentials stay off the desktop')
    const input = JSON.parse(body.messages[1].content)
    assert.equal(input.lines[3].text, 'Ẹ ṣe Olúwa')
    return response(selected([2, 3, 4, 6, 7, 8], [{ type: 'verse', startLineId: 3 }, { type: 'chorus', startLineId: 7 }]))
  })
  const result = await reviewOnlineLyrics(text, source)
  assert.equal(result.text, '[Verse 1]\nẸ ṣe Olúwa\n(Thank you Lord)\n\n[Chorus]\nYou are good\nYou are good')
  assert.deepEqual(result.review, { status: 'reviewed', removedLines: 2 })
})

test('unavailable managed access preserves original and reports unverified', async (t) => {
  t.mock.method(axios, 'post', async () => { throw new Error('must not call') })
  const result = await reviewOnlineLyrics(text, { ...source, apiKey: '' })
  assert.equal(result.text, text)
  assert.deepEqual(result.review, { status: 'unverified', reason: 'unavailable' })
})

for (const selection of [[3, 3], [4, 3], [-1], [999], ['3'], [3.5]]) {
  test(`invalid source selection ${JSON.stringify(selection)} cannot alter lyrics`, async (t) => {
    t.mock.method(axios, 'post', async () => response({ matchesSong: true, keepLineIds: selection }))
    const result = await reviewOnlineLyrics(text, source)
    assert.equal(result.text, text)
    assert.equal(result.review.status, 'unverified')
  })
}

test('timeout preserves original and reports unverified', async (t) => {
  t.mock.method(axios, 'post', async () => { throw new Error('timeout') })
  const result = await reviewOnlineLyrics(text, source)
  assert.equal(result.text, text)
  assert.deepEqual(result.review, { status: 'unverified', reason: 'unavailable' })
})

test('truncated and malformed responses are unverified', async (t) => {
  const post = t.mock.method(axios, 'post', async () => response({ matchesSong: true, keepLineIds: [3] }, 'length'))
  assert.equal((await reviewOnlineLyrics(text, source)).review.status, 'unverified')
  post.mock.mockImplementation(async () => ({ data: { choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] } }))
  assert.equal((await reviewOnlineLyrics(text, source)).review.status, 'unverified')
})

test('no matching lyrics blocks preview rather than importing page prose', async (t) => {
  t.mock.method(axios, 'post', async () => response({ matchesSong: false, keepLineIds: [], sections: [] }))
  await assert.rejects(reviewOnlineLyrics(text, source), /No matching song lyrics/)
})

test('empty or heading-only selection blocks preview', async (t) => {
  t.mock.method(axios, 'post', async () => response({ matchesSong: true, keepLineIds: [2, 6], sections: [] }))
  await assert.rejects(reviewOnlineLyrics(text, source), /No matching song lyrics/)
})

test('oversized input is visibly unverified and never silently truncated', async (t) => {
  const post = t.mock.method(axios, 'post', async () => { throw new Error('must not call') })
  const large = 'A'.repeat(100001)
  const result = await reviewOnlineLyrics(large, source)
  assert.equal(result.text, large)
  assert.deepEqual(result.review, { status: 'unverified', reason: 'too-large' })
  assert.equal(post.mock.callCount(), 0)
})

test('preview and import share one fetched and reviewed version', async (t) => {
  const { OnlineLyricsPreparation } = await import('../src/main/services/lyrics/review')
  const preparation = new OnlineLyricsPreparation()
  let fetches = 0
  const fetch = async () => { fetches++; return text }
  const post = t.mock.method(axios, 'post', async () => response(selected([2, 3, 4])))
  const input = { ...source, url: 'https://example.com/song', provider: 'web' }
  const [preview, imported] = await Promise.all([preparation.prepare(input, fetch), preparation.prepare(input, fetch)])
  assert.deepEqual(preview, imported)
  assert.equal(fetches, 1)
  assert.equal(post.mock.callCount(), 1)
  await preparation.prepare({ ...input, apiKey: 'changed-key' }, fetch)
  assert.equal(fetches, 2, 'credential changes trigger a fresh review')
})

test('a rejected page does not poison the preparation cache', async (t) => {
  const { OnlineLyricsPreparation } = await import('../src/main/services/lyrics/review')
  const preparation = new OnlineLyricsPreparation()
  const input = { ...source, url: 'https://example.com/song', provider: 'web' }
  const post = t.mock.method(axios, 'post', async () => response({ matchesSong: false, keepLineIds: [], sections: [] }))
  await assert.rejects(preparation.prepare(input, async () => text))
  post.mock.mockImplementation(async () => response(selected([3])))
  assert.equal((await preparation.prepare(input, async () => text)).text, '[Verse 1]\nẸ ṣe Olúwa')
})

test('prepared snapshots expire so a later preview can fetch updated source lyrics', async (t) => {
  const { OnlineLyricsPreparation } = await import('../src/main/services/lyrics/review')
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const preparation = new OnlineLyricsPreparation()
  const input = { ...source, apiKey: '', url: 'https://example.com/song', provider: 'web' }
  let fetched = 0
  const fetch = async () => `Version ${++fetched}`
  assert.equal((await preparation.prepare(input, fetch)).text, 'Version 1')
  assert.equal((await preparation.prepare(input, fetch)).text, 'Version 1')
  now += 10 * 60_000 + 1
  assert.equal((await preparation.prepare(input, fetch)).text, 'Version 2')
})

test('prepared source cache is bounded', async () => {
  const { OnlineLyricsPreparation } = await import('../src/main/services/lyrics/review')
  const preparation = new OnlineLyricsPreparation()
  const input = { ...source, apiKey: '', url: 'https://example.com/0', provider: 'web' }
  let fetched = 0
  const fetch = async () => `Version ${++fetched}`
  for (let i = 0; i < 51; i++) await preparation.prepare({ ...input, url: `https://example.com/${i}` }, fetch)
  await preparation.prepare(input, fetch)
  assert.equal(fetched, 52)
})

test('review preserves the two blank lines used by the section parser', async (t) => {
  t.mock.method(axios, 'post', async () => response(selected([0, 3])))
  const result = await reviewOnlineLyrics('First stanza\n\n\nSecond stanza', source)
  assert.equal(result.text, '[Verse 1]\nFirst stanza\n\n\nSecond stanza')
})

const unlabelled = 'First verse line\nAnother verse line\n\nRepeated refrain\nRepeated refrain\n\nSecond verse line\nFinal verse line\n\nRepeated refrain\nRepeated refrain'
const lyricIds = [0, 1, 3, 4, 6, 7, 9, 10]
const boundaries = [
  { type: 'verse', startLineId: 0 }, { type: 'chorus', startLineId: 3 },
  { type: 'verse', startLineId: 6 }, { type: 'chorus', startLineId: 9 },
]

test('unlabelled lyrics gain verse and chorus headings without changing any lyric line', async (t) => {
  t.mock.method(axios, 'post', async () => response(selected(lyricIds, boundaries)))
  const result = await reviewOnlineLyrics(unlabelled, source)
  assert.deepEqual(result.text.match(/\[[^\]]+\]/g), ['[Verse 1]', '[Chorus]', '[Verse 2]', '[Chorus]'])
  assert.deepEqual(result.text.split('\n').filter((line) => line && !line.startsWith('[')), lyricIds.map((id) => unlabelled.split('\n')[id]))
})

for (const sections of [
  [{ type: 'verse', startLineId: 1 }],
  [{ type: 'verse', startLineId: 0 }, { type: 'chorus', startLineId: 2 }],
  [{ type: 'verse', startLineId: 0 }, { type: 'chorus', startLineId: 6 }, { type: 'verse', startLineId: 3 }],
  [{ type: 'verse', startLineId: 0 }, { type: 'chorus', startLineId: 0 }],
  [{ type: 'invented-section', startLineId: 0 }],
  [{ type: 'verse', startLineId: 999 }],
  [],
]) {
  test(`invalid section boundaries cannot drop or reorder lyrics: ${JSON.stringify(sections)}`, async (t) => {
    t.mock.method(axios, 'post', async () => response(selected(lyricIds, sections)))
    const result = await reviewOnlineLyrics(unlabelled, source)
    assert.equal(result.text, unlabelled)
    assert.deepEqual(result.review, { status: 'unverified', reason: 'invalid-response' })
  })
}

test('duplicate source verse numbers are replaced by sequential local numbering', async (t) => {
  const raw = '[Verse 2]\nFirst line\n[Verse 2]\nSecond line'
  t.mock.method(axios, 'post', async () => response(selected([0, 1, 2, 3], [
    { type: 'verse', startLineId: 1 }, { type: 'verse', startLineId: 3 },
  ])))
  const result = await reviewOnlineLyrics(raw, source)
  assert.equal(result.text, '[Verse 1]\nFirst line\n\n[Verse 2]\nSecond line')
})

test('a section cannot detach a bilingual gloss from its source line', async (t) => {
  t.mock.method(axios, 'post', async () => response(selected([3, 4, 7, 8], [
    { type: 'verse', startLineId: 3 }, { type: 'chorus', startLineId: 4 },
  ])))
  const result = await reviewOnlineLyrics(text, source)
  assert.equal(result.text, text)
  assert.deepEqual(result.review, { status: 'unverified', reason: 'invalid-response' })
})

test('missing section classification cannot be presented as reviewed', async (t) => {
  t.mock.method(axios, 'post', async () => response({ matchesSong: true, keepLineIds: [3] }))
  const result = await reviewOnlineLyrics(text, source)
  assert.equal(result.text, text)
  assert.deepEqual(result.review, { status: 'unverified', reason: 'invalid-response' })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiBibleClient, ApiBibleRequestError, type ApiBibleTransport } from '../api-bible-client'

const BIBLE_ID = 'de4e12af7f28f599-01'

interface Call { url: string; config: Record<string, any> }

function transportOf(handler: (url: string) => unknown): { transport: ApiBibleTransport; calls: Call[] } {
  const calls: Call[] = []
  const transport: ApiBibleTransport = {
    async get(url, config) {
      calls.push({ url, config: (config ?? {}) as Record<string, any> })
      return { data: handler(url) }
    },
  }
  return { transport, calls }
}

function failingTransport(status: number, headers: Record<string, string> = {}): ApiBibleTransport {
  return {
    async get() {
      throw Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, headers, data: {} },
      })
    },
  }
}

const JOHN_3_16_CONTENT = [
  {
    name: 'para',
    items: [
      { name: 'verse', attrs: { number: '16', sid: 'JHN 3:16', verseId: 'JHN.3.16' }, items: [] },
      { type: 'text', text: 'For God so loved the world' },
    ],
  },
]

test('lists bibles with the api-key header', async () => {
  const { transport, calls } = transportOf(() => ({
    data: [{ id: BIBLE_ID, abbreviation: 'engKJV', abbreviationLocal: 'KJV' }],
  }))
  const bibles = await new ApiBibleClient('secret-key', transport).listBibles()

  assert.equal(calls[0].url, 'https://rest.api.bible/v1/bibles')
  assert.equal(calls[0].config.headers['api-key'], 'secret-key')
  assert.deepEqual(calls[0].config.params, { language: 'eng' })
  assert.equal(bibles[0].id, BIBLE_ID)
})

test('reads bible metadata including copyright', async () => {
  const { transport, calls } = transportOf(() => ({
    data: { id: BIBLE_ID, name: 'King James Version', abbreviation: 'engKJV', abbreviationLocal: 'KJV', copyright: 'Public Domain' },
  }))
  const details = await new ApiBibleClient('k', transport).getBible(BIBLE_ID)

  assert.equal(calls[0].url, `https://rest.api.bible/v1/bibles/${BIBLE_ID}`)
  assert.equal(details.copyright, 'Public Domain')
  assert.equal(details.name, 'King James Version')
})

test('lists books and chapters for a bible', async () => {
  const { transport, calls } = transportOf((url) =>
    url.endsWith('/books')
      ? { data: [{ id: 'JHN', name: 'John', abbreviation: 'JHN' }] }
      : { data: [{ id: 'JHN.intro', number: 'intro', bookId: 'JHN' }, { id: 'JHN.1', number: '1', bookId: 'JHN' }] },
  )
  const client = new ApiBibleClient('k', transport)

  const books = await client.listBooks(BIBLE_ID)
  const chapters = await client.listChapters(BIBLE_ID, 'JHN')

  assert.deepEqual(books.map((b) => b.id), ['JHN'])
  assert.equal(calls[1].url, `https://rest.api.bible/v1/bibles/${BIBLE_ID}/books/JHN/chapters`)
  assert.deepEqual(chapters.map((c) => c.id), ['JHN.intro', 'JHN.1'])
})

test('fetches a passage as individual verses with copyright', async () => {
  const { transport, calls } = transportOf(() => ({
    data: { id: 'JHN.3.16', reference: 'John 3:16', copyright: 'Public Domain', content: JOHN_3_16_CONTENT },
  }))
  const passage = await new ApiBibleClient('k', transport).getPassage(BIBLE_ID, 'JHN.3.16', 'John')

  assert.equal(calls[0].url, `https://rest.api.bible/v1/bibles/${BIBLE_ID}/passages/JHN.3.16`)
  assert.deepEqual(calls[0].config.params, {
    'content-type': 'json',
    'include-notes': false,
    'include-titles': false,
    'include-chapter-numbers': false,
  })
  assert.equal(passage.copyright, 'Public Domain')
  assert.deepEqual(passage.verses, [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world' }])
})

test('fetches a chapter through the chapters endpoint', async () => {
  const { transport, calls } = transportOf(() => ({
    data: { id: 'JHN.3', reference: 'John 3', copyright: 'Public Domain', content: JOHN_3_16_CONTENT },
  }))
  const passage = await new ApiBibleClient('k', transport).getChapter(BIBLE_ID, 'JHN.3', 'John')

  assert.equal(calls[0].url, `https://rest.api.bible/v1/bibles/${BIBLE_ID}/chapters/JHN.3`)
  assert.equal(passage.passageId, 'JHN.3')
  assert.equal(passage.verses.length, 1)
})

test('searches a bible by keyword / remembered phrase', async () => {
  const { transport, calls } = transportOf(() => ({
    data: {
      query: 'the lord is my shepherd',
      verses: [
        {
          id: 'PSA.23.1',
          orgId: 'PSA.23.1',
          bookId: 'PSA',
          reference: 'Psalm 23:1',
          text: '<p class="p">The LORD is my shepherd; I shall not want.</p>',
        },
      ],
    },
  }))
  const hits = await new ApiBibleClient('k', transport).search(BIBLE_ID, 'the lord is my shepherd', 5)

  assert.equal(calls[0].url, `https://rest.api.bible/v1/bibles/${BIBLE_ID}/search`)
  assert.deepEqual(calls[0].config.params, {
    query: 'the lord is my shepherd',
    limit: 5,
    sort: 'relevance',
  })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reference, 'Psalm 23:1')
  assert.equal(hits[0].chapter, 23)
  assert.equal(hits[0].verse, 1)
  assert.equal(hits[0].text, 'The LORD is my shepherd; I shall not want.')
})

test('propagates authorization failures as access errors', async () => {
  for (const status of [401, 403]) {
    const client = new ApiBibleClient('k', failingTransport(status))
    await assert.rejects(
      () => client.getPassage(BIBLE_ID, 'JHN.3.16', 'John'),
      (error: unknown) => {
        assert.ok(error instanceof ApiBibleRequestError)
        assert.equal(error.status, status)
        assert.equal(error.isAccessError, true)
        return true
      },
    )
  }
})

test('propagates rate limiting with the Retry-After delay', async () => {
  const client = new ApiBibleClient('k', failingTransport(429, { 'retry-after': '3' }))
  await assert.rejects(
    () => client.getChapter(BIBLE_ID, 'JHN.3', 'John'),
    (error: unknown) => {
      assert.ok(error instanceof ApiBibleRequestError)
      assert.equal(error.status, 429)
      assert.equal(error.isRateLimited, true)
      assert.equal(error.retryAfterMs, 3000)
      return true
    },
  )
})

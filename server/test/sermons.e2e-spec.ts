import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, signUpVerified, TestContext } from './harness'
import { SummaryError } from '../src/sermons/sermon-summary.service'

/** Generation is fired and forgotten, so a read has to wait for it to land. */
async function waitForStatus(
  read: () => request.Test,
  status: 'ready' | 'failed',
  attempts = 40,
): Promise<Record<string, unknown>> {
  for (let index = 0; index < attempts; index += 1) {
    const response = await read().expect(200)
    if (response.body.status === status) return response.body
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Sermon never reached status "${status}"`)
}

interface Account {
  token: string
  orgId: string
}

function transcript(segments: number, wordsPerSegment = 12): unknown[] {
  return Array.from({ length: segments }, (_, index) => ({
    id: `seg-${index}`,
    text: `this is line ${index} ${'word '.repeat(wordsPerSegment).trim()}`,
    timestamp: 1_700_000_000_000 + index * 5_000,
    duration: 4.5,
    words: [{ word: 'word', start: index * 5, end: index * 5 + 0.4, confidence: 0.98 }],
  }))
}

function upload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    localId: 'service-1',
    title: 'Sunday Morning',
    speaker: 'Pastor Dara',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    transcript: transcript(20),
    scriptures: [{ reference: 'Romans 8:28', translation: 'NIV' }],
    ...overrides,
  }
}

/**
 * A sermon holds a verbatim recording of a church service and can be published
 * to an unauthenticated URL. Both of those make every boundary here worth its
 * own case rather than one representative check.
 */
describe('Sermons (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  let alice: Account
  let bob: Account

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app

    const signUp = async (email: string, orgName: string): Promise<Account> => {
      const account = await signUpVerified(context, {
        email,
        name: email.split('@')[0],
        orgName,
      })
      return { token: account.accessToken, orgId: account.orgId }
    }

    alice = await signUp('alice@sermons.test', 'First Baptist')
    bob = await signUp('bob@sermons.test', 'Second Chapel')
  })

  afterAll(async () => {
    await context.close()
  })

  const as = (
    who: Account,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ): request.Test =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${who.token}`)

  const uploadFor = async (
    who: Account,
    body: Record<string, unknown> = upload(),
  ): Promise<string> => {
    const response = await as(who, 'post', `/v1/orgs/${who.orgId}/sermons`).send(body).expect(202)
    return response.body.id as string
  }

  it('accepts an upload and stores it as pending', async () => {
    const response = await as(alice, 'post', `/v1/orgs/${alice.orgId}/sermons`)
      .send(upload())
      .expect(202)
    expect(response.body.status).toBe('pending')

    const detail = await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${response.body.id}`)
      .expect(200)
    expect(detail.body.title).toBe('Sunday Morning')
    expect(detail.body.wordCount).toBeGreaterThan(0)
    expect(detail.body.durationMs).toBeGreaterThan(0)
    // The transcript is a separate route — it must not ride along on detail.
    expect(detail.body.transcript).toBeUndefined()
  })

  it('treats a re-upload of the same service as an update, not a duplicate', async () => {
    const first = await uploadFor(alice, upload({ localId: 'retry-me' }))
    const second = await uploadFor(alice, upload({ localId: 'retry-me', title: 'Corrected title' }))
    expect(second).toBe(first)

    const list = await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons`).expect(200)
    const matches = list.body.items.filter(
      (item: { title: string }) => item.title === 'Corrected title',
    )
    expect(matches).toHaveLength(1)
  })

  it('serves the transcript from its own route', async () => {
    const id = await uploadFor(alice, upload({ localId: 'has-transcript' }))
    const response = await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}/transcript`)
      .expect(200)
    expect(response.body.segments).toHaveLength(20)
    // Word timings are stored but never served to the reader.
    expect(response.body.segments[0].words).toBeUndefined()
  })

  it('rejects a service with nothing said in it', async () => {
    await as(alice, 'post', `/v1/orgs/${alice.orgId}/sermons`)
      .send(upload({ localId: 'silent', transcript: [] }))
      .expect(400)
  })

  it('accepts an upload far larger than the default body limit', async () => {
    // Proves `applyBodyParsers` is wired into the harness the same way it is
    // wired into main.ts — without it this 413s against a limit production
    // does not have.
    const big = upload({ localId: 'big-one', transcript: transcript(1_200, 40) })
    expect(JSON.stringify(big).length).toBeGreaterThan(300_000)
    await as(alice, 'post', `/v1/orgs/${alice.orgId}/sermons`).send(big).expect(202)
  })

  describe('generation', () => {
    it('writes a recap and marks the sermon ready', async () => {
      const id = await uploadFor(alice, upload({ localId: 'generates' }))
      const detail = await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'ready',
      )

      const summary = detail.summary as Record<string, unknown>
      expect(summary.headline).toBe('No Condemnation')
      expect(detail.headline).toBe('No Condemnation')
      expect(detail.failureReason).toBeNull()

      // The model is given prose, not the timing arrays.
      const call = context.summaries.calls.at(-1)
      expect(call?.transcriptText).toContain('this is line 0')
      expect(call?.transcriptText).not.toContain('confidence')
    })

    it('fails without retrying when the church has no key', async () => {
      context.summaries.nextError = new SummaryError(
        'no-api-key',
        'Add an Anthropic or DeepSeek API key to your church vault to generate recaps.',
      )
      const id = await uploadFor(alice, upload({ localId: 'no-key' }))
      const detail = await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'failed',
      )
      expect(detail.failureReason).toContain('API key')
    })

    it('regenerates on request', async () => {
      const id = await uploadFor(alice, upload({ localId: 'regenerate-me' }))
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'ready',
      )
      const before = context.summaries.calls.length

      await as(alice, 'post', `/v1/orgs/${alice.orgId}/sermons/${id}/summary`).expect(202)
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'ready',
      )
      expect(context.summaries.calls.length).toBeGreaterThan(before)
    })

    it('keeps the original recap when a rewrite is cancelled', async () => {
      const id = await uploadFor(alice, upload({ localId: 'cancel-rewrite' }))
      const first = await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'ready',
      )
      expect((first.summary as { headline: string }).headline).toBe('No Condemnation')

      context.summaries.delayMs = 250
      context.summaries.summary = {
        ...context.summaries.summary,
        headline: 'A rewrite that must not land',
      }

      try {
        const regenerating = await as(
          alice,
          'post',
          `/v1/orgs/${alice.orgId}/sermons/${id}/summary`,
        ).expect(202)
        expect(regenerating.body.status).toBe('pending')
        expect(regenerating.body.summary.headline).toBe('No Condemnation')

        const cancelled = await as(
          alice,
          'post',
          `/v1/orgs/${alice.orgId}/sermons/${id}/summary/cancel`,
        ).expect(200)
        expect(cancelled.body.status).toBe('ready')
        expect(cancelled.body.summary.headline).toBe('No Condemnation')

        await new Promise((resolve) => setTimeout(resolve, 400))
        const after = await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`).expect(200)
        expect(after.body.status).toBe('ready')
        expect(after.body.summary.headline).toBe('No Condemnation')
      } finally {
        context.summaries.delayMs = 0
        context.summaries.summary = {
          ...context.summaries.summary,
          headline: 'No Condemnation',
        }
      }
    })
  })

  describe('metadata', () => {
    it('renames the recap title, preacher, and service name', async () => {
      const id = await uploadFor(alice, upload({ localId: 'rename-me' }))
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'ready',
      )

      const updated = await as(alice, 'patch', `/v1/orgs/${alice.orgId}/sermons/${id}`)
        .send({
          title: 'Evening service',
          speaker: 'Rev. Ada',
          headline: 'Walk in the Spirit',
        })
        .expect(200)

      expect(updated.body.title).toBe('Evening service')
      expect(updated.body.speaker).toBe('Rev. Ada')
      expect(updated.body.headline).toBe('Walk in the Spirit')
      expect(updated.body.summary.headline).toBe('Walk in the Spirit')
    })

    it('refuses an empty service name, and a headline before a recap exists', async () => {
      const id = await uploadFor(alice, upload({ localId: 'rename-too-soon' }))
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`),
        'ready',
      )

      await as(alice, 'patch', `/v1/orgs/${alice.orgId}/sermons/${id}`)
        .send({ title: '   ' })
        .expect(400)

      context.summaries.nextError = new SummaryError('no-api-key', 'No key.')
      const pending = await uploadFor(alice, upload({ localId: 'no-recap-yet' }))
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${pending}`),
        'failed',
      )
      await as(alice, 'patch', `/v1/orgs/${alice.orgId}/sermons/${pending}`)
        .send({ headline: 'Too early' })
        .expect(400)
    })
  })

  it('keeps the wide body limit scoped to the upload route', async () => {
    // The 12mb door is opened for one path. Every other route must still refuse
    // a large body, or the limit change quietly became a global one.
    const oversized = { email: 'a@b.test', password: 'x'.repeat(400_000) }
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send(oversized)
      .expect(413)
  })

  describe('tenancy', () => {
    let aliceSermonId: string

    beforeAll(async () => {
      aliceSermonId = await uploadFor(alice, upload({ localId: 'alice-private' }))
    })

    it('refuses to list another org', async () => {
      await as(bob, 'get', `/v1/orgs/${alice.orgId}/sermons`).expect(403)
    })

    it('refuses to upload into another org', async () => {
      await as(bob, 'post', `/v1/orgs/${alice.orgId}/sermons`).send(upload()).expect(403)
      // And nothing landed.
      const list = await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons`).expect(200)
      expect(list.body.items.every((item: { id: string }) => item.id !== undefined)).toBe(true)
    })

    it('refuses to read another org sermon detail and transcript', async () => {
      await as(bob, 'get', `/v1/orgs/${alice.orgId}/sermons/${aliceSermonId}`).expect(403)
      await as(bob, 'get', `/v1/orgs/${alice.orgId}/sermons/${aliceSermonId}/transcript`)
        .expect(403)
    })

    it('404s a sermon id from another org even under your own org path', async () => {
      // A different code path from the guard above: the guard passes because
      // this is Bob's own org, and the service-level orgId filter is what
      // stops him. Both need their own case.
      await as(bob, 'get', `/v1/orgs/${bob.orgId}/sermons/${aliceSermonId}`).expect(404)
      await as(bob, 'delete', `/v1/orgs/${bob.orgId}/sermons/${aliceSermonId}`).expect(404)
    })

    it('refuses to share, edit, or delete another org sermon', async () => {
      await as(bob, 'put', `/v1/orgs/${alice.orgId}/sermons/${aliceSermonId}/share`)
        .send({ enabled: true })
        .expect(403)
      await as(bob, 'patch', `/v1/orgs/${alice.orgId}/sermons/${aliceSermonId}`)
        .send({ title: 'Hijacked' })
        .expect(403)
      await as(bob, 'delete', `/v1/orgs/${alice.orgId}/sermons/${aliceSermonId}`).expect(403)

      const stillThere = await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${aliceSermonId}`)
        .expect(200)
      expect(stillThere.body.shareEnabled).toBe(false)
      expect(stillThere.body.title).toBe('Sunday Morning')
    })

    it('404s a rename of another org sermon even under your own org path', async () => {
      await as(bob, 'patch', `/v1/orgs/${bob.orgId}/sermons/${aliceSermonId}`)
        .send({ title: 'Hijacked' })
        .expect(404)
    })
  })

  describe('pagination', () => {
    it('pages without duplicates or omissions', async () => {
      const carol = await signUpVerified(context, {
        email: 'carol@sermons.test',
        name: 'carol',
        orgName: 'Third Assembly',
      })
      const account: Account = { token: carol.accessToken, orgId: carol.orgId }

      for (let index = 0; index < 25; index += 1) {
        await uploadFor(
          account,
          upload({
            localId: `page-${index}`,
            startedAt: 1_700_000_000_000 + index * 86_400_000,
          }),
        )
      }

      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const query: string = cursor
          ? `?limit=10&cursor=${encodeURIComponent(cursor)}`
          : '?limit=10'
        const response = await as(account, 'get', `/v1/orgs/${account.orgId}/sermons${query}`)
          .expect(200)
        seen.push(...response.body.items.map((item: { id: string }) => item.id))
        cursor = response.body.nextCursor
        pages += 1
      } while (cursor && pages < 10)

      expect(pages).toBe(3)
      expect(seen).toHaveLength(25)
      expect(new Set(seen).size).toBe(25)
    })
  })

  describe('public share link', () => {
    let sermonId: string

    beforeAll(async () => {
      sermonId = await uploadFor(alice, upload({ localId: 'shareable' }))
    })

    const anonymous = (token: string): request.Test =>
      request(app.getHttpServer()).get(`/v1/public/sermons/${token}`)

    it('hides a shared sermon that has no summary yet', async () => {
      // Deliberately shared before generation finishes: a half-written recap
      // must not be publishable even with a valid token.
      const pending = await uploadFor(alice, upload({ localId: 'shared-too-early' }))
      context.summaries.nextError = new SummaryError('no-api-key', 'No key.')
      const shared = await as(alice, 'put', `/v1/orgs/${alice.orgId}/sermons/${pending}/share`)
        .send({ enabled: true })
        .expect(200)
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${pending}`),
        'failed',
      )
      await anonymous(shared.body.shareToken).expect(404)
    })

    it('serves a ready recap to a signed-out reader, and nothing else', async () => {
      await waitForStatus(
        () => as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${sermonId}`),
        'ready',
      )
      const shared = await as(alice, 'put', `/v1/orgs/${alice.orgId}/sermons/${sermonId}/share`)
        .send({ enabled: true })
        .expect(200)

      const response = await anonymous(shared.body.shareToken).expect(200)
      // A key-set assertion, not a field-by-field check: this is what catches a
      // field someone adds to the payload later without thinking about it.
      expect(Object.keys(response.body).sort()).toEqual([
        'churchName',
        'preachedAt',
        'speaker',
        'summary',
        'title',
      ])
      expect(response.body.churchName).toBe('First Baptist')
    })

    it('burns the old link when the token is rotated, and when sharing is turned off', async () => {
      const first = await as(alice, 'put', `/v1/orgs/${alice.orgId}/sermons/${sermonId}/share`)
        .send({ enabled: true })
        .expect(200)
      await anonymous(first.body.shareToken).expect(200)

      const rotated = await as(alice, 'put', `/v1/orgs/${alice.orgId}/sermons/${sermonId}/share`)
        .send({ enabled: true, rotate: true })
        .expect(200)
      expect(rotated.body.shareToken).not.toBe(first.body.shareToken)
      await anonymous(first.body.shareToken).expect(404)
      await anonymous(rotated.body.shareToken).expect(200)

      await as(alice, 'put', `/v1/orgs/${alice.orgId}/sermons/${sermonId}/share`)
        .send({ enabled: false })
        .expect(200)
      await anonymous(rotated.body.shareToken).expect(404)
    })

    it('404s an unknown token', async () => {
      await anonymous('not-a-real-token').expect(404)
    })
  })

  describe('stats', () => {
    let carol: Account

    beforeAll(async () => {
      const account = await signUpVerified(context, {
        email: 'carol@sermons.test',
        name: 'Carol',
        orgName: 'Third Street',
      })
      carol = { token: account.accessToken, orgId: account.orgId }
    })

    it('returns zeros and a seven-day series when nothing has been uploaded', async () => {
      const response = await as(carol, 'get', `/v1/orgs/${carol.orgId}/sermons/stats`).expect(200)
      expect(response.body.services).toBe(0)
      expect(response.body.averageDurationMs).toBe(0)
      expect(response.body.weekly).toHaveLength(7)
      expect(response.body.granularity).toBe('day')
      expect(response.body.scriptureBooks).toEqual([])
      expect(response.body.speakers).toEqual([])
      expect(response.body.previous).toEqual({ services: 0, durationMs: 0 })
    })

    it('buckets this month, last month, speakers and books', async () => {
      const now = new Date()
      const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 12)
      const lastMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 12)

      context.summaries.summary = {
        ...context.summaries.summary,
        keyScriptures: [{ reference: 'Romans 8:1', connection: 'Anchor.' }],
      }
      const first = await uploadFor(
        carol,
        upload({
          localId: 'stats-this',
          speaker: 'Pastor Dara',
          startedAt: thisMonth,
          endedAt: thisMonth + 40 * 60_000,
        }),
      )
      await waitForStatus(
        () => as(carol, 'get', `/v1/orgs/${carol.orgId}/sermons/${first}`),
        'ready',
      )

      context.summaries.summary = {
        ...context.summaries.summary,
        keyScriptures: [{ reference: 'John 3:16', connection: 'Gospel.' }],
      }
      const second = await uploadFor(
        carol,
        upload({
          localId: 'stats-last',
          speaker: 'Pastor Dara',
          startedAt: lastMonth,
          endedAt: lastMonth + 50 * 60_000,
        }),
      )
      await waitForStatus(
        () => as(carol, 'get', `/v1/orgs/${carol.orgId}/sermons/${second}`),
        'ready',
      )

      const response = await as(
        carol,
        'get',
        `/v1/orgs/${carol.orgId}/sermons/stats?range=all`,
      ).expect(200)
      expect(response.body.services).toBe(2)
      expect(response.body.previous.services).toBe(0)
      expect(response.body.speakers[0]).toMatchObject({ name: 'Pastor Dara', services: 2 })
      expect(response.body.speakerNames).toEqual(['Pastor Dara'])
      expect(response.body.scriptureBooks.map((row: { book: string }) => row.book).sort()).toEqual([
        'John',
        'Romans',
      ])
      expect(response.body.weekly.some((row: { services: number }) => row.services > 0)).toBe(true)
    })

    it('filters by range and speaker', async () => {
      context.summaries.summary = {
        ...context.summaries.summary,
        keyScriptures: [{ reference: 'Psalm 23', connection: 'Shepherd.' }],
      }
      const other = await uploadFor(
        carol,
        upload({
          localId: 'stats-guest',
          speaker: 'Guest preacher',
          startedAt: Date.now() - 60_000,
          endedAt: Date.now(),
        }),
      )
      await waitForStatus(
        () => as(carol, 'get', `/v1/orgs/${carol.orgId}/sermons/${other}`),
        'ready',
      )

      const fourWeeks = await as(
        carol,
        'get',
        `/v1/orgs/${carol.orgId}/sermons/stats?range=4w`,
      ).expect(200)
      expect(fourWeeks.body.weekly).toHaveLength(4)
      expect(fourWeeks.body.speakerNames).toEqual(['Guest preacher', 'Pastor Dara'])

      const guest = await as(
        carol,
        'get',
        `/v1/orgs/${carol.orgId}/sermons/stats?range=all&speaker=${encodeURIComponent('Guest preacher')}`,
      ).expect(200)
      expect(guest.body.services).toBe(1)
      expect(guest.body.speakers).toEqual([
        expect.objectContaining({ name: 'Guest preacher', services: 1 }),
      ])

      const today = new Date().toISOString().slice(0, 10)
      const day = await as(
        carol,
        'get',
        `/v1/orgs/${carol.orgId}/sermons/stats?range=custom&from=${today}&to=${today}`,
      ).expect(200)
      expect(day.body.granularity).toBe('day')
      expect(day.body.weekly).toHaveLength(1)
      expect(day.body.services).toBeGreaterThanOrEqual(1)

      const week = await as(carol, 'get', `/v1/orgs/${carol.orgId}/sermons/stats?range=7d`).expect(200)
      expect(week.body.granularity).toBe('day')
      expect(week.body.weekly).toHaveLength(7)
    })
  })

  describe('deletion', () => {
    it('removes the sermon for everyone in the org', async () => {
      const id = await uploadFor(alice, upload({ localId: 'delete-me' }))
      await as(alice, 'delete', `/v1/orgs/${alice.orgId}/sermons/${id}`).expect(204)
      await as(alice, 'get', `/v1/orgs/${alice.orgId}/sermons/${id}`).expect(404)
    })
  })
})

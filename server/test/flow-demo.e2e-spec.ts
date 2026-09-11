import request from 'supertest'
import { createTestApp, signUpVerified, TestContext } from './harness'

/**
 * The operator's journey, as the two clients actually see it: the booth POSTs
 * an ended service, and the website's Sermons page polls until the recap lands.
 */
describe('End service → recap appears on the web', () => {
  let context: TestContext

  beforeAll(async () => {
    context = await createTestApp()
  })
  afterAll(async () => {
    await context.close()
  })

  it('goes queued → generating → readable without anyone touching it', async () => {
    const account = await signUpVerified(context, {
      email: 'booth@flow.test',
      name: 'Booth',
      orgName: 'Grace Chapel',
    })
    const server = context.app.getHttpServer()
    const auth = { Authorization: `Bearer ${account.accessToken}` }
    const timeline: string[] = []
    // A real model takes tens of seconds; this makes that window observable.
    context.summaries.delayMs = 300

    // 1. What the desktop sends the moment the operator hits End Service.
    const upload = await request(server)
      .post(`/v1/orgs/${account.orgId}/sermons`)
      .set(auth)
      .send({
        localId: 'service-sunday',
        title: 'Sunday Morning',
        speaker: 'Pastor Dara',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_600_000,
        transcript: [
          {
            id: 's1',
            text: 'There is now no condemnation for those who are in Christ Jesus.',
            timestamp: 1_700_000_000_000,
            duration: 4,
            words: [{ word: 'condemnation', start: 1, end: 1.6, confidence: 0.97 }],
          },
        ],
        scriptures: [{ reference: 'Romans 8:1', translation: 'NKJV' }],
      })
      .expect(202)
    timeline.push(`desktop upload → HTTP 202, status "${upload.body.status}"`)

    // 2. What the website's Sermons list shows while the model is working.
    const listWhilePending = await request(server)
      .get(`/v1/orgs/${account.orgId}/sermons`)
      .set(auth)
      .expect(200)
    timeline.push(
      `website list → "${listWhilePending.body.items[0].title}" · status "${listWhilePending.body.items[0].status}"`,
    )
    expect(listWhilePending.body.items[0].status).toBe('pending')

    // 3. The same page, polling, once generation finishes.
    let detail = upload.body
    for (let attempt = 0; attempt < 40 && detail.status !== 'ready'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      const response = await request(server)
        .get(`/v1/orgs/${account.orgId}/sermons/${upload.body.id}`)
        .set(auth)
        .expect(200)
      detail = response.body
    }
    timeline.push(`website detail → status "${detail.status}", headline "${detail.summary.headline}"`)
    expect(detail.status).toBe('ready')
    expect(detail.summary.bigIdea).toBeTruthy()

    // eslint-disable-next-line no-console
    console.log('\n  TIMELINE\n' + timeline.map((line) => `    ${line}`).join('\n') + '\n')
  })
})

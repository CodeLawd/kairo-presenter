import type { OrgSecretsService } from '../orgs/org-secrets.service'
import { testConfig } from '../config/test-config'
import { SermonSummaryService, SummaryError } from './sermon-summary.service'

const INPUT = {
  orgId: 'org-1',
  title: 'Sunday Service',
  speaker: 'Pastor',
  preachedAt: new Date('2026-09-06'),
  transcriptText: 'a transcript',
  detectedScriptures: [],
}

/** Only the DeepSeek key is set, so `generate` always takes the DeepSeek path. */
const secretsWithDeepSeek = (): OrgSecretsService =>
  ({
    get: async () => ({ anthropicApiKey: '', deepseekApiKey: 'sk-deepseek' }),
  }) as unknown as OrgSecretsService

describe('SermonSummaryService — DeepSeek failures', () => {
  const fetchMock = jest.fn()
  const originalFetch = global.fetch

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  const service = (): SermonSummaryService =>
    new SermonSummaryService(secretsWithDeepSeek(), testConfig())

  const refuse = (status: number, body: string): void => {
    fetchMock.mockResolvedValue({
      ok: false,
      status,
      text: async () => body,
    })
  }

  it("carries the provider's own words, not just a status code", async () => {
    refuse(400, JSON.stringify({ error: { message: 'Model Not Exist' } }))

    await expect(service().generate(INPUT)).rejects.toThrow(/400.*Model Not Exist/)
  })

  it('falls back to the raw body when the error is not JSON', async () => {
    refuse(502, '  upstream unavailable  ')

    await expect(service().generate(INPUT)).rejects.toThrow(/\(502\): upstream unavailable/)
  })

  it('still reports the status when the body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => {
        throw new Error('stream already consumed')
      },
    })

    await expect(service().generate(INPUT)).rejects.toThrow(/DeepSeek refused the request \(401\)/)
  })

  it('retries a rate limit but never a rejected request', async () => {
    refuse(429, '{}')
    await expect(service().generate(INPUT)).rejects.toMatchObject({ retryable: true })

    refuse(400, '{}')
    await expect(service().generate(INPUT)).rejects.toMatchObject({ retryable: false })
  })

  it('sends the configured reasoning effort rather than the provider default', async () => {
    refuse(400, '{}')
    await expect(service().generate(INPUT)).rejects.toBeInstanceOf(SummaryError)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning_effort).toBe('low')
  })
})

describe('automatic review', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })
  const draft = { headline: 'Grace', bigIdea: 'Trust God.', keyPoints: [], memorableQuotes: [], takeaways: [], keyScriptures: [], callToAction: 'Trust him this week.' }

  it('returns the reviewed recap using the draft and transcript as evidence', async () => {
    const requests: { messages: { content: string }[] }[] = []
    const reviewed = { ...draft, bigIdea: 'God’s grace gives us confidence to trust him.' }
    global.fetch = (async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify({ choices: [{ message: {
        content: JSON.stringify(requests.length === 1 ? draft : reviewed),
      }, finish_reason: 'stop' }] }))
    }) as typeof fetch
    const result = await new SermonSummaryService(secretsWithDeepSeek(), testConfig()).generate(INPUT)
    expect(result.summary).toEqual(reviewed)
    expect(requests).toHaveLength(2)
    expect(requests[1].messages[1].content).toContain(JSON.stringify(draft))
    expect(requests[1].messages[1].content).toContain('<transcript>\na transcript\n</transcript>')
  })

  it('rejects an unchecked draft when review fails', async () => {
    let calls = 0
    global.fetch = (async () => {
      calls++
      return calls === 1
        ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }))
        : new Response('unavailable', { status: 503 })
    }) as typeof fetch
    await expect(new SermonSummaryService(secretsWithDeepSeek(), testConfig()).generate(INPUT))
      .rejects.toMatchObject({ code: 'provider', retryable: true })
  })
})

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

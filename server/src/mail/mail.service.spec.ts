import { MailService } from './mail.service'
import { testConfig } from '../config/test-config'

const BASE = testConfig({ publicWebUrl: 'https://app.test' })

describe('MailService', () => {
  const fetchMock = jest.fn()
  const originalFetch = global.fetch

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  const withBrevo = (): MailService =>
    new MailService({
      ...BASE,
      mail: { apiKey: 'xkeysib-test', fromEmail: 'no-reply@test', fromName: 'Kairo' },
    })

  it('sends nothing and throws nothing when Brevo is not configured', async () => {
    const service = new MailService(BASE)
    expect(service.enabled).toBe(false)
    await expect(
      service.sendWelcome('operator@grace.test', 'Joshua', {
        code: '123456',
        url: 'https://app.test/verify?token=abc',
      }),
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a rendered welcome email to Brevo with the link in both parts', async () => {
    fetchMock.mockResolvedValue({ status: 201, text: async () => '' })
    const verifyUrl = 'https://app.test/verify-email?token=abc123'

    await withBrevo().sendWelcome('operator@grace.test', 'Joshua', {
      code: '482913',
      url: verifyUrl,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.method).toBe('POST')
    expect(init.headers['api-key']).toBe('xkeysib-test')

    const body = JSON.parse(init.body)
    expect(body.to).toEqual([{ email: 'operator@grace.test' }])
    expect(body.sender).toEqual({ email: 'no-reply@test', name: 'Kairo' })
    // The code is in the subject so it is readable from a phone's lock screen.
    expect(body.subject).toBe('482913 is your Kairo confirmation code')
    // Real HTML from the emailcn template, not a placeholder…
    expect(body.htmlContent).toContain('<!DOCTYPE html')
    expect(body.htmlContent).toContain('Joshua')
    expect(body.htmlContent).toContain('482913')
    expect(body.htmlContent).toContain(verifyUrl)
    expect(body.htmlContent).not.toMatch(/Blazer|Fresh Drop|golden era|Nike/i)
    expect(body.htmlContent).not.toContain('emailcn')
    // …and a text alternative, because some clients show only that.
    expect(body.textContent).toContain('482913')
    expect(body.textContent).toContain(verifyUrl)
  }, 20_000)

  it('renders the reset email without leaking the welcome copy', async () => {
    fetchMock.mockResolvedValue({ status: 201, text: async () => '' })
    const resetUrl = 'https://app.test/reset-password?token=xyz'

    await withBrevo().sendPasswordReset('operator@grace.test', resetUrl)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.subject).toBe('Reset your Kairo password')
    expect(body.htmlContent).toContain(resetUrl)
    expect(body.htmlContent).not.toContain('Welcome')
  }, 20_000)

  it('swallows a Brevo rejection — a bounced email never fails the signup', async () => {
    fetchMock.mockResolvedValue({ status: 400, text: async () => '{"code":"invalid_parameter"}' })
    await expect(
      withBrevo().sendWelcome('bad@grace.test', 'Joshua', {
        code: '111111',
        url: 'https://app.test/verify',
      }),
    ).resolves.toBeUndefined()
  }, 20_000)

  it('swallows a network failure too', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(
      withBrevo().sendWelcome('operator@grace.test', 'Joshua', {
        code: '111111',
        url: 'https://app.test/verify',
      }),
    ).resolves.toBeUndefined()
  }, 20_000)
})

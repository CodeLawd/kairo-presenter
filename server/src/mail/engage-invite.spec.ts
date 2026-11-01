import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { MailService } from './mail.service'
import { loadConfig } from '../config/env'

const link = 'https://kairopresenter.com/engage/m/RAW_SECRET_TOKEN'
const config = () => loadConfig({ MONGO_URL: 'mongodb://localhost/test', JWT_SECRET: 'test', VAULT_ENCRYPTION_KEY: 'test' })
describe('Engage invitation delivery', () => {
  afterEach(() => jest.restoreAllMocks())
  it('refuses missing mail without logging the invitation', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const mail = new MailService(config())
    await expect(mail.sendEngageInvite('a@example.com', 'Sunday', link)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(log.mock.calls.flat().join(' ')).not.toContain('RAW_SECRET_TOKEN')
  })
  it('escapes content and never logs a provider response that echoes the link', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    let message: any
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      message = JSON.parse(init!.body as string)
      return new Response(link, { status: 400 })
    })
    const mail = new MailService({ ...config(), mail: { apiKey: 'key', fromEmail: 'a@example.com', fromName: 'Kairo' } })
    await expect(mail.sendEngageInvite('a@example.com', '<script>Sunday</script>', link)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(message.htmlContent).toContain('&lt;script&gt;Sunday&lt;/script&gt;')
    expect(message.htmlContent).not.toContain('<script>')
    expect(error.mock.calls.flat().join(' ')).not.toContain('RAW_SECRET_TOKEN')
  })
  it('reports successful delivery and keeps a thrown transport error private', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockRejectedValueOnce(new Error(link))
    const mail = new MailService({ ...config(), mail: { apiKey: 'key', fromEmail: 'a@example.com', fromName: 'Kairo' } })
    await expect(mail.sendEngageInvite('a@example.com', 'Sunday', link)).resolves.toBeUndefined()
    await expect(mail.sendEngageInvite('a@example.com', 'Sunday', link)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(error.mock.calls.flat().join(' ')).not.toContain('RAW_SECRET_TOKEN')
  })

})

import { HttpException } from '@nestjs/common'
import type { Connection } from 'mongoose'
import { LicensingService } from './licensing.service'
import { testConfig } from '../config/test-config'
import type { RequestUser } from '../common/decorators/current-user.decorator'

describe('managed Bible provider boundary', () => {
  afterEach(() => jest.restoreAllMocks())
  const prepare = () => {
    const service = new LicensingService({} as Connection, testConfig())
    jest.spyOn(service, 'reserve').mockResolvedValue(undefined)
    jest.spyOn(service, 'config').mockResolvedValue({ secrets: { providers: { bibleApiKey: 'private-platform-key' } } } as never)
    return service
  }
  it('uses the current fixed API.Bible origin and keeps credentials in headers', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"data":[]}'))
    const result = await prepare().managed({} as RequestUser, { provider: 'bible', method: 'GET', path: '/v1/bibles' })
    expect(result).toEqual({ data: [] })
    expect(fetch).toHaveBeenCalledWith('https://rest.api.bible/v1/bibles', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ 'api-key': 'private-platform-key' }) }))
  })
  it.each([[401, 403], [403, 403], [429, 429], [500, 503]])('maps upstream %i to sanitized HTTP %i', async (upstream, expected) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private-platform-key and confidential provider diagnostics', { status: upstream }))
    let failure: HttpException | undefined
    try { await prepare().managed({} as RequestUser, { provider: 'bible', method: 'GET', path: '/v1/bibles' }) } catch (error) { failure = error as HttpException }
    expect(failure).toBeInstanceOf(HttpException)
    expect(failure!.getStatus()).toBe(expected)
    expect(JSON.stringify(failure!.getResponse())).not.toContain('private-platform-key')
    expect(JSON.stringify(failure!.getResponse())).not.toContain('confidential')
  })
})

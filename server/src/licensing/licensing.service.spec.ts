import { HttpException } from '@nestjs/common'
import type { Connection } from 'mongoose'
import { LicensingService, renewalRefusal, sessionLimit } from './licensing.service'
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

describe('transcription grants', () => {
  afterEach(() => jest.restoreAllMocks())
  it('gives back the reserved minutes when Deepgram refuses the grant', async () => {
    const license = { status: 'active', devices: [{ deviceId: 'booth' }], features: ['transcription'] }
    const updateOne = jest.fn().mockResolvedValue({})
    const collection = { findOne: jest.fn().mockResolvedValue(license), findOneAndUpdate: jest.fn().mockResolvedValue(license), updateOne }
    const service = new LicensingService({ collection: () => collection } as unknown as Connection, testConfig())
    jest.spyOn(service, 'member').mockResolvedValue(undefined as never)
    jest.spyOn(service, 'config').mockResolvedValue({ secrets: { providers: { deepgramApiKey: 'platform-key' } } } as never)
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"err_msg":"Insufficient permissions."}', { status: 403 }))
    await expect(service.transcription({ orgId: 'church', deviceId: 'booth' } as RequestUser)).rejects.toThrow('Transcription grant unavailable')
    expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'church' }), expect.objectContaining({ $inc: { 'usage.transcriptionMinutes': -2 } }))
  })
})

describe('transcription renewal refusals', () => {
  const base = {
    status: 'active', expiresAt: null, features: ['transcription'], devices: [{ deviceId: 'booth' }],
    usage: { period: new Date().toISOString().slice(0, 7), transcriptionMinutes: 10, managedRequests: 0 },
    transcriptionMinutes: 600, maxTranscriptionSessions: 2,
    sessions: [{ id: 's1', deviceId: 'booth', until: 2_000, nextRenew: 500 }],
  }
  it('names the out-of-minutes case instead of calling it an expiry', () => {
    const row = { ...base, usage: { ...base.usage, transcriptionMinutes: 600 } }
    expect(renewalRefusal(row as never, 's1', 'booth', 1_000)).toBe("This month's transcription minutes are used up")
  })
  it('names an expired session', () => {
    expect(renewalRefusal(base as never, 's1', 'booth', 5_000)).toBe('The transcription session expired')
  })
  it('lets every computer on a three-computer licence transcribe at once', () => {
    const row = {
      ...base, maxDevices: 3, maxTranscriptionSessions: 1,
      devices: [{ deviceId: 'auditorium' }, { deviceId: 'youth' }, { deviceId: 'overflow' }],
      sessions: ['auditorium', 'youth', 'overflow'].map((deviceId) => ({ id: deviceId, deviceId, until: 2_000, nextRenew: 500 })),
    }
    expect(sessionLimit(row)).toBe(3)
    expect(renewalRefusal(row as never, 'youth', 'youth', 1_000)).not.toBe('Another computer is using transcription on this licence')
  })
})

describe('transcription sessions per computer', () => {
  afterEach(() => jest.restoreAllMocks())
  it("replaces this computer's lingering session instead of counting it against the limit", async () => {
    const license = { status: 'active', devices: [{ deviceId: 'booth' }], features: ['transcription'] }
    const findOneAndUpdate = jest.fn().mockResolvedValue(license)
    const collection = { findOne: jest.fn().mockResolvedValue(license), findOneAndUpdate, updateOne: jest.fn().mockResolvedValue({}) }
    const service = new LicensingService({ collection: () => collection } as unknown as Connection, testConfig())
    jest.spyOn(service, 'member').mockResolvedValue(undefined as never)
    jest.spyOn(service, 'config').mockResolvedValue({ secrets: { providers: { deepgramApiKey: 'platform-key' } } } as never)
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'token', expires_in: 30 })))
    await service.transcription({ orgId: 'church', deviceId: 'booth' } as RequestUser)
    const [, update] = findOneAndUpdate.mock.calls[0]
    expect(JSON.stringify(update)).toContain('"$ne":["$$s.deviceId","booth"]')
  })
})

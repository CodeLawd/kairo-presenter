import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import type { Connection } from 'mongoose'
import { LicensingService } from './licensing.service'
import { testConfig } from '../config/test-config'
import type { RequestUser } from '../common/decorators/current-user.decorator'

/**
 * Renewal against a real MongoDB: the update must extend the renewing
 * computer's session even when its place in `devices` differs from its place
 * in `sessions`. A positional `sessions.$` extended another computer's lease
 * here and left this one to expire three minutes into the service.
 */
describe('transcription renewal on a shared licence', () => {
  let server: MongoMemoryServer
  let client: MongoClient
  beforeAll(async () => {
    server = await MongoMemoryServer.create()
    client = await MongoClient.connect(server.getUri())
  })
  afterAll(async () => {
    await client.close()
    await server.stop()
  })

  it("extends the renewing computer's own lease", async () => {
    const licenses = client.db('kairo').collection('licenses')
    const now = Date.now()
    const period = new Date().toISOString().slice(0, 7)
    const until = now + 50_000
    await licenses.insertOne({
      orgId: 'church', status: 'active', expiresAt: null, features: ['transcription'],
      maxDevices: 2, maxTranscriptionSessions: 2, transcriptionMinutes: 600,
      usage: { period, transcriptionMinutes: 10, managedRequests: 0 },
      // The booth is first among devices but second among sessions.
      devices: [{ deviceId: 'booth' }, { deviceId: 'youth' }],
      sessions: [
        { id: 's-youth', deviceId: 'youth', until, nextRenew: now - 1 },
        { id: 's-booth', deviceId: 'booth', until, nextRenew: now - 1 },
      ],
    })
    const service = new LicensingService({ collection: () => licenses } as unknown as Connection, testConfig())
    jest.spyOn(service, 'member').mockResolvedValue(undefined as never)

    await expect(service.renew({ orgId: 'church', deviceId: 'booth' } as RequestUser, 's-booth')).resolves.toEqual({ renewAfterSeconds: 60 })

    const row = await licenses.findOne({ orgId: 'church' })
    const booth = row!.sessions.find((s: { id: string }) => s.id === 's-booth')
    const youth = row!.sessions.find((s: { id: string }) => s.id === 's-youth')
    expect(booth.until).toBeGreaterThan(until)
    expect(youth.until).toBe(until)
  })
})

import request from 'supertest'
import { createHash } from 'node:crypto'
import { getConnectionToken } from '@nestjs/mongoose'
import { Connection } from 'mongoose'
import { createTestApp, signUpVerified, type TestContext } from './harness'
import { LicensingService } from '../src/licensing/licensing.service'
import type { RequestUser } from '../src/common/decorators/current-user.decorator'

/** Real Mongo atomic reservations; only the external Deepgram token call is mocked. */
describe('Licensing budget reservations (e2e)', () => {
  let context: TestContext
  let db: Connection
  let service: LicensingService
  let owner: { accessToken: string; orgId: string }
  let other: { accessToken: string; orgId: string }
  let claims: RequestUser
  const previous = process.env.SUPERADMIN_EMAILS
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
  const call = () => request(context.app.getHttpServer())
  const license = () => db.collection('church_licenses')
  const newKey = async () => (await call().post('/v1/licensing/key').set(auth(owner.accessToken)).expect(201)).body.key as string

  beforeAll(async () => {
    process.env.SUPERADMIN_EMAILS = 'budget-owner@test.church'
    context = await createTestApp()
    // Keep one listener open across concurrent requests; supertest auto-listen
    // otherwise closes its temporary server when the first request completes.
    await context.app.listen(0, '127.0.0.1')
    db = context.app.get(getConnectionToken())
    service = context.app.get(LicensingService)
    owner = await signUpVerified(context, { email: 'budget-owner@test.church' })
    other = await signUpVerified(context, { email: 'budget-other@test.church' })
    claims = JSON.parse(Buffer.from(owner.accessToken.split('.')[1], 'base64url').toString()) as RequestUser
    const key = await newKey()
    await call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key, name: 'Budget booth' }).expect(201)
    await call().patch('/v1/admin/licensing/providers').set(auth(owner.accessToken)).send({ deepgramApiKey: 'test-deepgram-private-key' }).expect(200)
  })
  beforeEach(async () => {
    await license().updateOne({ orgId: owner.orgId }, { $set: {
      status: 'active', expiresAt: null, features: ['presentation', 'transcription', 'scripture', 'summaries'],
      maxTranscriptionSessions: 1, transcriptionMinutes: 10, managedRequests: 2, sessions: [],
      usage: { period: new Date().toISOString().slice(0, 7), transcriptionMinutes: 0, managedRequests: 0 },
    } })
  })
  afterEach(() => { jest.restoreAllMocks() })
  afterAll(async () => {
    if (previous === undefined) delete process.env.SUPERADMIN_EMAILS
    else process.env.SUPERADMIN_EMAILS = previous
    await context?.close()
  })

  it('never exceeds the shared monthly request cap under concurrent reservations', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => service.reserve(claims, 'scripture')))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(10)
    expect((await license().findOne({ orgId: owner.orgId }))!.usage.managedRequests).toBe(2)
  })

  it('resets an old UTC month once while preserving concurrent request caps', async () => {
    await license().updateOne({ orgId: owner.orgId }, { $set: { 'usage.period': '2000-01', 'usage.managedRequests': 20000 } })
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.reserve(claims, 'scripture')))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    const row = (await license().findOne({ orgId: owner.orgId }))!
    expect(row.usage.period).toBe(new Date().toISOString().slice(0, 7))
    expect(row.usage.managedRequests).toBe(2)
  })

  const mockDeepgram = () => jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(url).toBe('https://api.deepgram.com/v1/auth/grant')
    expect(init?.headers).toMatchObject({ Authorization: 'Token test-deepgram-private-key' })
    expect(JSON.parse(init?.body as string)).toEqual({ ttl_seconds: 30 })
    return new Response(JSON.stringify({ access_token: 'temporary-access-only', expires_in: 30 }))
  })

  it('atomically grants one concurrent transcription slot and binds release to church/device', async () => {
    const fetch = mockDeepgram()
    const grants = await Promise.all(Array.from({ length: 8 }, () => call().post('/v1/managed/transcription').set(auth(owner.accessToken))))
    expect(grants.filter(r => r.status === 201)).toHaveLength(1)
    expect(grants.filter(r => r.status === 403)).toHaveLength(7)
    expect(fetch).toHaveBeenCalledTimes(1)
    const grant = grants.find(r => r.status === 201)!.body
    expect(grant).toMatchObject({ accessToken: 'temporary-access-only', expiresIn: 30, renewAfterSeconds: 60 })
    const row = (await license().findOne({ orgId: owner.orgId }))!
    expect(row.sessions).toHaveLength(1)
    expect(row.usage.transcriptionMinutes).toBe(2)
    await call().post(`/v1/managed/transcription/${grant.sessionId}/renew`).set(auth(other.accessToken)).expect(403)
    await call().delete(`/v1/managed/transcription/${grant.sessionId}`).set(auth(other.accessToken)).expect(200)
    expect((await license().findOne({ orgId: owner.orgId }))!.sessions).toHaveLength(1)
    await call().delete(`/v1/managed/transcription/${grant.sessionId}`).set(auth(owner.accessToken)).expect(200)
    expect((await license().findOne({ orgId: owner.orgId }))!.sessions).toHaveLength(0)
  })

  it('never exceeds the minute budget when many session slots are available', async () => {
    const fetch = mockDeepgram()
    await license().updateOne({ orgId: owner.orgId }, { $set: { maxTranscriptionSessions: 10, transcriptionMinutes: 5 } })
    const grants = await Promise.all(Array.from({ length: 8 }, () => call().post('/v1/managed/transcription').set(auth(owner.accessToken))))
    expect(grants.filter(r => r.status === 201)).toHaveLength(2)
    expect(grants.filter(r => r.status === 403)).toHaveLength(6)
    expect(fetch).toHaveBeenCalledTimes(2)
    const row = (await license().findOne({ orgId: owner.orgId }))!
    expect(row.sessions).toHaveLength(2)
    expect(row.usage.transcriptionMinutes).toBe(4)
  })

  it('releases a failed provider grant slot without refunding reserved minutes', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('provider failure', { status: 503 }))
    await call().post('/v1/managed/transcription').set(auth(owner.accessToken)).expect(503)
    const row = (await license().findOne({ orgId: owner.orgId }))!
    expect(row.sessions).toHaveLength(0)
    expect(row.usage.transcriptionMinutes).toBe(2)
  })

  it('reserves minutes before grants and meters concurrent renewals once', async () => {
    mockDeepgram()
    await license().updateOne({ orgId: owner.orgId }, { $set: { transcriptionMinutes: 3 } })
    const grant = (await call().post('/v1/managed/transcription').set(auth(owner.accessToken)).expect(201)).body
    await call().post(`/v1/managed/transcription/${grant.sessionId}/renew`).set(auth(owner.accessToken)).expect(403)
    await license().updateOne({ orgId: owner.orgId, 'sessions.id': grant.sessionId }, { $set: { 'sessions.$.nextRenew': Date.now() - 1 } })
    const renewals = await Promise.all(Array.from({ length: 6 }, () => call().post(`/v1/managed/transcription/${grant.sessionId}/renew`).set(auth(owner.accessToken))))
    expect(renewals.filter(r => r.status === 201)).toHaveLength(1)
    expect(renewals.filter(r => r.status === 403)).toHaveLength(5)
    expect((await license().findOne({ orgId: owner.orgId }))!.usage.transcriptionMinutes).toBe(3)
    await call().delete(`/v1/managed/transcription/${grant.sessionId}`).set(auth(owner.accessToken)).expect(200)
    await call().post('/v1/managed/transcription').set(auth(owner.accessToken)).expect(403)
  })

  it('reclaims abandoned slots and never refunds already reserved time', async () => {
    mockDeepgram()
    const grant = (await call().post('/v1/managed/transcription').set(auth(owner.accessToken)).expect(201)).body
    await license().updateOne({ orgId: owner.orgId, 'sessions.id': grant.sessionId }, { $set: { 'sessions.$.until': Date.now() - 1 } })
    await call().post(`/v1/managed/transcription/${grant.sessionId}/renew`).set(auth(owner.accessToken)).expect(403)
    await call().post('/v1/managed/transcription').set(auth(owner.accessToken)).expect(201)
    const row = (await license().findOne({ orgId: owner.orgId }))!
    expect(row.sessions).toHaveLength(1)
    expect(row.usage.transcriptionMinutes).toBe(4)
  })

  it('reuses the church key for every activation without storing it in plaintext', async () => {
    const key = await newKey()
    const results = await Promise.all(Array.from({ length: 5 }, () => call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key, name: 'Racing booth' })))
    expect(results.filter(r => r.status === 201)).toHaveLength(5)
    const row = (await license().findOne({ orgId: owner.orgId }))!
    expect(row.devices).toHaveLength(1)
    expect(JSON.stringify(row)).not.toContain(key)
    expect(row.key.hash).toBe(createHash('sha256').update(key).digest('hex'))
  })

  it('stops the church key activating computers when the licence is revoked', async () => {
    const key = await newKey()
    await license().updateOne({ orgId: owner.orgId }, { $set: { status: 'revoked' } })
    await call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key, name: 'Revoked' }).expect(403)
    expect((await license().findOne({ orgId: owner.orgId }))!.devices).toHaveLength(1)
  })
})

import request from 'supertest'
import { verify } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import type { Connection } from 'mongoose'
import { createTestApp, signUpVerified, type TestContext } from './harness'
import { LicensingService } from '../src/licensing/licensing.service'
import type { RequestUser } from '../src/common/decorators/current-user.decorator'
import type { LicenseSnapshot } from '../../src/lib/cloud/licensing'

/** Real guards + Mongo: keys cannot cross churches, replay, or race past a device cap. */
describe('Managed licensing (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  let admin: { accessToken: string; orgId: string }
  let owner: { accessToken: string; orgId: string }
  let other: { accessToken: string; orgId: string }
  const previousSuperadmins = process.env.SUPERADMIN_EMAILS
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
  const call = () => request(app.getHttpServer())
  const key = async (token = owner.accessToken): Promise<string> => {
    const response = await call().post('/v1/licensing/key').set(auth(token)).expect(201)
    expect(response.body.key).toEqual(expect.stringMatching(/^[a-f0-9]{48}$/))
    return response.body.key
  }
  const login = async (deviceId: string): Promise<string> => {
    const response = await call().post('/v1/auth/login').set('X-PA-Client', 'desktop')
      .send({ email: 'licence-owner@test.church', password: 'a-long-enough-password', deviceId }).expect(200)
    return response.body.accessToken
  }

  beforeAll(async () => {
    process.env.SUPERADMIN_EMAILS = 'licence-superadmin@test.church'
    context = await createTestApp()
    app = context.app
    admin = await signUpVerified(context, { email: 'licence-superadmin@test.church' })
    owner = await signUpVerified(context, { email: 'licence-owner@test.church' })
    other = await signUpVerified(context, { email: 'licence-other@test.church' })
    await call().patch('/v1/admin/licensing/policy').set(auth(admin.accessToken)).send({ freeIssuanceEnabled: true }).expect(200)
  })
  afterAll(async () => {
    if (previousSuperadmins === undefined) delete process.env.SUPERADMIN_EMAILS
    else process.env.SUPERADMIN_EMAILS = previousSuperadmins
    await context?.close()
  })

  it('requires authentication and hides superadmin settings from church owners', async () => {
    await call().get('/v1/licensing').expect(401)
    await call().get('/v1/admin/licensing/policy').set(auth(owner.accessToken)).expect(404)
    await call().patch('/v1/admin/licensing/providers').set(auth(owner.accessToken)).send({ deepgramApiKey: 'stolen' }).expect(404)
    const response = await call().post('/v1/managed/transcription').set(auth(owner.accessToken))
    expect(response.status).toBe(403)
  })

  it('keeps one reusable church key, encrypted at rest, until it is revoked', async () => {
    const first = await key()
    const listed = await call().get('/v1/licensing/key').set(auth(owner.accessToken)).expect(200)
    expect(listed.body).toMatchObject({ key: first, createdAt: expect.any(String) })
    const again = await call().post('/v1/licensing/key').set(auth(owner.accessToken)).expect(201)
    expect(again.body.key).toBe(first)
    const others = await call().get('/v1/licensing/key').set(auth(other.accessToken)).expect(200)
    expect(others.body.key).toBeUndefined()
    const stored = await context.app.get<Connection>(getConnectionToken()).collection('church_licenses').findOne({ orgId: owner.orgId })
    expect(JSON.stringify(stored)).not.toContain(first)
    await call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key: first, name: 'Booth' }).expect(201)
    const secondDevice = await login('licence-device-reuse')
    await call().post('/v1/licensing/activate').set(auth(secondDevice)).send({ key: first, name: 'Second booth' }).expect(201)
    const afterUse = await context.app.get<Connection>(getConnectionToken()).collection('church_licenses').findOne({ orgId: owner.orgId })
    expect(JSON.stringify(afterUse)).not.toContain(first)
    expect((await call().get('/v1/licensing/key').set(auth(owner.accessToken)).expect(200)).body.key).toBe(first)
    await call().delete('/v1/licensing/devices/licence-device-reuse').set(auth(owner.accessToken)).expect(200)
    await call().delete('/v1/licensing/key').set(auth(owner.accessToken)).expect(200)
    expect((await call().get('/v1/licensing/key').set(auth(owner.accessToken)).expect(200)).body.key).toBeUndefined()
    await call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key: first, name: 'Revoked' }).expect(403)
    const replacement = await key()
    expect(replacement).not.toBe(first)
    // A licence from before keys were stored gains one the first time it is viewed.
    await context.app.get<Connection>(getConnectionToken()).collection('church_licenses').updateOne({ orgId: owner.orgId }, { $unset: { key: '', keyRevokedAt: '' } })
    const backfilled = await call().get('/v1/licensing/key').set(auth(owner.accessToken)).expect(200)
    expect(backfilled.body.key).toMatch(/^[a-f0-9]{48}$/)
  })

  it('allows free key issuance without billing and rejects keys belonging to another church', async () => {
    const activationKey = await key()
    const wrong = await call().post('/v1/licensing/activate').set(auth(other.accessToken)).send({ key: activationKey, name: 'Wrong church' })
    expect(wrong.status).toBeGreaterThanOrEqual(400)
    const response = await call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key: activationKey, name: 'Booth' }).expect(201)
    const snapshot = response.body as LicenseSnapshot
    expect(snapshot.activated).toBe(true)
    expect(snapshot.license?.orgId).toBe(owner.orgId)
    expect(snapshot.license?.expiresAt).toBeNull()
    expect(snapshot.lease).not.toBeNull()
    const lease = snapshot.lease!
    expect(verify(null, Buffer.from(JSON.stringify(lease.claims)), lease.publicKey, Buffer.from(lease.signature, 'base64'))).toBe(true)
    expect(lease.claims.orgId).toBe(owner.orgId)
    expect(lease.claims.expiresAt - lease.claims.issuedAt).toBeLessThanOrEqual(14 * 86400)
    expect(JSON.stringify(snapshot)).not.toContain(activationKey)
    const replay = await call().post('/v1/licensing/activate').set(auth(owner.accessToken)).send({ key: activationKey, name: 'Booth' }).expect(201)
    expect(replay.body.license.devices).toHaveLength(1)
  })

  it('keeps permanent provider credentials write-only and disallows arbitrary proxy URLs', async () => {
    const secret = 'platform-deepgram-secret-must-never-leak'
    const response = await call().patch('/v1/admin/licensing/providers').set(auth(admin.accessToken)).send({ deepgramApiKey: secret }).expect(200)
    expect(response.body.configured.deepgram).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain(secret)
    const read = await call().get('/v1/admin/licensing/providers').set(auth(admin.accessToken)).expect(200)
    expect(JSON.stringify(read.body)).not.toContain(secret)
    expect(read.body.hints.deepgram).toBe('leak')
    expect(read.body.hints.bible).toBe('')
    const snapshot = await call().get('/v1/licensing').set(auth(owner.accessToken)).expect(200)
    expect(snapshot.body.providers.deepgram).toBe(true)
    expect(JSON.stringify(snapshot.body)).not.toContain(secret)
    const malicious = await call().post('/v1/managed/request').set(auth(owner.accessToken)).send({ provider: 'bible', method: 'GET', path: 'https://attacker.test/steal' })
    expect(malicious.status).toBe(400)
  })

  it('lists licensed churches with their owners for superadmins', async () => {
    await call().get('/v1/admin/licensing/licenses').set(auth(owner.accessToken)).expect(404)
    await call().patch(`/v1/admin/licensing/licenses/${owner.orgId}`).set(auth(admin.accessToken)).send({ maxDevices: 3 }).expect(200)
    const { body } = await call().get('/v1/admin/licensing/licenses').set(auth(admin.accessToken)).expect(200)
    const licensed = body.find((row: { orgId: string }) => row.orgId === owner.orgId)
    expect(licensed).toMatchObject({ ownerEmail: 'licence-owner@test.church', license: { status: 'active', maxDevices: 3 } })
    expect(body.some((row: { orgId: string }) => row.orgId === other.orgId)).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/"keys?"|"hash"|"sessions"/)
  })

  it('enforces device capacity atomically and lets the church replace a deactivated computer', async () => {
    await call().patch(`/v1/admin/licensing/licenses/${owner.orgId}`).set(auth(admin.accessToken)).send({ maxDevices: 2 }).expect(200)
    const keys = await Promise.all([key(), key()])
    const tokens = await Promise.all([login('licence-device-a'), login('licence-device-b')])
    const results = await Promise.all(tokens.map((token, i) => call().post('/v1/licensing/activate').set(auth(token)).send({ key: keys[i], name: `Booth ${i}` })))
    expect(results.filter(result => result.status === 201)).toHaveLength(1)
    expect(results.filter(result => result.status >= 400)).toHaveLength(1)
    const winner = results.findIndex(result => result.status === 201)
    const snapshot = await call().get('/v1/licensing').set(auth(owner.accessToken)).expect(200)
    expect(snapshot.body.license.devices).toHaveLength(2)
    const loser = winner === 0 ? 1 : 0
    await call().delete(`/v1/licensing/devices/licence-device-${winner === 0 ? 'a' : 'b'}`).set(auth(owner.accessToken)).expect(200)
    const stale = await call().post('/v1/licensing/refresh').set(auth(tokens[winner])).expect(201)
    expect(stale.body.activated).toBe(false)
    const replacement = await call().post('/v1/licensing/activate').set(auth(tokens[loser])).send({ key: keys[loser], name: 'Replacement' }).expect(201)
    expect(replacement.body.activated).toBe(true)
  })

  it('authorizes dashboard recaps using the church entitlement without activating the browser', async () => {
    const browser = await call().post('/v1/auth/login').send({ email: 'licence-owner@test.church', password: 'a-long-enough-password' }).expect(200)
    const claims = JSON.parse(Buffer.from(browser.body.accessToken.split('.')[1], 'base64url').toString()) as RequestUser
    const before = await call().get('/v1/licensing').set(auth(owner.accessToken)).expect(200)
    expect(before.body.license.devices.some((device: { deviceId: string }) => device.deviceId === claims.deviceId)).toBe(false)
    await app.get(LicensingService).summaryKeys(claims)
    const after = await call().get('/v1/licensing').set(auth(owner.accessToken)).expect(200)
    expect(after.body.license.usage.managedRequests).toBe(before.body.license.usage.managedRequests + 2)
  })

  it('blocks managed use when a feature is removed and refresh returns no lease after revocation', async () => {
    await call().patch(`/v1/admin/licensing/licenses/${owner.orgId}`).set(auth(admin.accessToken)).send({ features: ['presentation'] }).expect(200)
    await call().post('/v1/managed/transcription').set(auth(owner.accessToken)).expect(403)
    await call().patch(`/v1/admin/licensing/licenses/${owner.orgId}`).set(auth(admin.accessToken)).send({ status: 'revoked' }).expect(200)
    const response = await call().post('/v1/licensing/refresh').set(auth(owner.accessToken)).expect(201)
    expect(response.body.activated).toBe(false)
    expect(response.body.lease).toBeNull()
    const claims = JSON.parse(Buffer.from(owner.accessToken.split('.')[1], 'base64url').toString()) as RequestUser
    await expect(app.get(LicensingService).summaryKeys(claims)).rejects.toThrow()
    const activationKeyResponse = await call().post('/v1/licensing/key').set(auth(owner.accessToken))
    expect(activationKeyResponse.status).toBeGreaterThanOrEqual(400)
  })

  it('lets superadmin stop free issuance without introducing a payment requirement', async () => {
    await call().patch('/v1/admin/licensing/policy').set(auth(admin.accessToken)).send({ freeIssuanceEnabled: false }).expect(200)
    const issuance = await call().post('/v1/licensing/key').set(auth(other.accessToken))
    expect(issuance.status).toBe(403)
    const policy = await call().get('/v1/admin/licensing/policy').set(auth(admin.accessToken)).expect(200)
    expect(policy.body.freeIssuanceEnabled).toBe(false)
    expect(policy.body).not.toHaveProperty('subscriptionId')
  })
})

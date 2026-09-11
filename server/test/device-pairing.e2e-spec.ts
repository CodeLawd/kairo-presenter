import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, signUpVerified, TestContext } from './harness'

/**
 * The booth-machine flow: the desktop shows a code, someone approves it from a
 * phone, the desktop polls until it has tokens. Nobody types a password into
 * the shared machine.
 */
describe('Device pairing (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  let owner: { token: string; orgId: string }

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
    const account = await signUpVerified(context, { email: 'pastor@grace.test', name: 'Pastor' })
    owner = { token: account.accessToken, orgId: account.orgId }
  })

  afterAll(async () => {
    await context.close()
  })

  const start = (deviceId = 'booth-pc') =>
    request(app.getHttpServer())
      .post('/v1/auth/device/start')
      .send({ deviceId, deviceName: 'Booth PC' })

  const poll = (deviceCode: string) =>
    request(app.getHttpServer()).post('/v1/auth/device/token').send({ deviceCode })

  const approve = (userCode: string) =>
    request(app.getHttpServer())
      .post('/v1/auth/device/approve')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userCode })

  it('issues a readable code and a separate secret for the device', async () => {
    const { body } = await start().expect(201)
    expect(body.userCode).toMatch(/^PROA-[A-Z0-9]{4}$/)
    expect(body.deviceCode).toEqual(expect.any(String))
    // The short code must not be enough to collect tokens on its own.
    expect(body.deviceCode).not.toContain(body.userCode)
    expect(body.verificationUri).toContain('/activate')
    expect(body.interval).toBe(5)
  })

  it('pairs end to end: pending, approved by a person, then tokens', async () => {
    const { body: started } = await start('living-room-mac').expect(201)

    const pending = await poll(started.deviceCode).expect(200)
    expect(pending.body.state).toBe('pending')

    const approval = await approve(started.userCode).expect(200)
    expect(approval.body).toEqual({ approved: true, deviceName: 'Booth PC' })

    const paired = await poll(started.deviceCode).expect(200)
    expect(paired.body.state).toBe('approved')
    expect(paired.body.accessToken).toEqual(expect.any(String))
    expect(paired.body.refreshToken).toEqual(expect.any(String))
    // Paired into the approver's own org, at their role — never wider.
    expect(paired.body.org).toMatchObject({ id: owner.orgId, role: 'owner' })

    const listed = await request(app.getHttpServer())
      .get(`/v1/orgs/${owner.orgId}/devices`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'living-room-mac',
          name: 'Booth PC',
          signedInAs: 'Pastor',
        }),
      ]),
    )
  })

  it('keeps the booth machine snapshot on the devices list', async () => {
    const { body: started } = await request(app.getHttpServer())
      .post('/v1/auth/device/start')
      .send({
        deviceId: 'foh-mac',
        deviceName: 'FOH Mac',
        device: {
          name: 'FOH Mac',
          hostname: 'foh.local',
          os: 'darwin',
          osVersion: '15.6.1',
          arch: 'arm64',
          appVersion: '0.1.0',
          electronVersion: '35.1.2',
        },
      })
      .expect(201)
    await approve(started.userCode).expect(200)
    await poll(started.deviceCode).expect(200)

    const listed = await request(app.getHttpServer())
      .get(`/v1/orgs/${owner.orgId}/devices`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'foh-mac',
          name: 'foh',
          hostname: 'foh.local',
          os: 'macOS',
          osVersion: '15.6.1',
          arch: 'arm64',
          appVersion: '0.1.0',
          electronVersion: '35.1.2',
          signedInAs: 'Pastor',
          lastLoginAt: expect.any(String),
          lastSeenAt: expect.any(String),
          online: expect.any(Boolean),
        }),
      ]),
    )
  })

  it('a device code is good for exactly one exchange', async () => {
    const { body: started } = await start('replay-mac').expect(201)
    await approve(started.userCode).expect(200)
    await poll(started.deviceCode).expect(200)

    // A leaked device code must not be redeemable for a second set of tokens.
    const replay = await poll(started.deviceCode).expect(200)
    expect(replay.body.state).toBe('expired')
  })

  it('tells a client polling too fast to slow down', async () => {
    const { body: started } = await start('impatient-mac').expect(201)
    await poll(started.deviceCode).expect(200)
    const second = await poll(started.deviceCode).expect(200)
    expect(second.body.state).toBe('slow_down')
  })

  it('reports a denial so the desktop can stop waiting', async () => {
    const { body: started } = await start('denied-mac').expect(201)
    await request(app.getHttpServer())
      .post('/v1/auth/device/deny')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userCode: started.userCode })
      .expect(200)

    const result = await poll(started.deviceCode).expect(200)
    expect(result.body.state).toBe('denied')
  })

  it('refuses to approve a code that does not exist', async () => {
    await approve('PROA-XXXX').expect(400)
  })

  it('requires a signed-in person to approve — anonymous approval is refused', async () => {
    const { body: started } = await start('anon-mac').expect(201)
    await request(app.getHttpServer())
      .post('/v1/auth/device/approve')
      .send({ userCode: started.userCode })
      .expect(401)
  })

  it('404s an unknown device code rather than hanging the client', async () => {
    await poll('not-a-real-device-code').expect(404)
  })
})

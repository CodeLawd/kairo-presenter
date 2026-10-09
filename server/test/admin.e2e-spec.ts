import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, signUpVerified, TestContext } from './harness'

const INGEST_KEY = 'test-ingest-key'

/**
 * The staff console sees every church, so the boundary is the whole point:
 * a church's own owner/admin must get nothing, and to them the API must not
 * even appear to exist.
 */
describe('Admin console (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  let staff: { accessToken: string; refreshToken: string }
  let pastor: { accessToken: string; refreshToken: string; orgId: string }

  beforeAll(async () => {
    process.env.SUPERADMIN_EMAILS = ' Staff@Kairo.test '
    process.env.DOWNLOAD_INGEST_KEY = INGEST_KEY
    context = await createTestApp()
    app = context.app
    staff = await signUpVerified(context, { email: 'staff@kairo.test', name: 'Staff', orgName: 'Kairo HQ' })
    pastor = await signUpVerified(context, { email: 'pastor@church.test', name: 'Pastor', orgName: 'Grace Church' })
  })

  afterAll(async () => {
    delete process.env.SUPERADMIN_EMAILS
    delete process.env.DOWNLOAD_INGEST_KEY
    await context.close()
  })

  const as = (token: string, method: 'get' | 'patch' | 'post' | 'delete', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`)

  it('hides every admin route from a church owner', async () => {
    for (const path of ['/v1/admin/overview', '/v1/admin/users', '/v1/admin/churches', '/v1/admin/downloads']) {
      await as(pastor.accessToken, 'get', path).expect(404)
    }
    await as(pastor.accessToken, 'patch', '/v1/admin/users/000000000000000000000000').send({ status: 'disabled' }).expect(404)
  })

  it('refuses anonymous callers', async () => {
    await request(app.getHttpServer()).get('/v1/admin/overview').expect(401)
  })

  it('flags staff in the session, and only staff', async () => {
    const mine = await as(staff.accessToken, 'get', '/v1/auth/session').expect(200)
    expect(mine.body.user).toMatchObject({ isAdmin: true, platformRole: 'superadmin' })
    const theirs = await as(pastor.accessToken, 'get', '/v1/auth/session').expect(200)
    expect(theirs.body.user).toMatchObject({ isAdmin: false, platformRole: null })
  })

  it('shows staff the overview, users and churches', async () => {
    const overview = await as(staff.accessToken, 'get', '/v1/admin/overview').expect(200)
    expect(overview.body.users.total).toBe(2)
    expect(overview.body.churches.total).toBe(2)
    expect(overview.body.signups).toHaveLength(30)

    const users = await as(staff.accessToken, 'get', '/v1/admin/users?q=pastor').expect(200)
    expect(users.body.total).toBe(1)
    expect(users.body.items[0]).toMatchObject({ email: 'pastor@church.test', status: 'active', platformRole: null })
    expect(users.body.items[0].churches[0]).toMatchObject({ name: 'Grace Church', role: 'owner' })

    const churches = await as(staff.accessToken, 'get', '/v1/admin/churches?q=grace').expect(200)
    expect(churches.body.items[0]).toMatchObject({ name: 'Grace Church', owner: { email: 'pastor@church.test' } })
  })

  it('disabling an account signs it out everywhere; enabling lets it back in', async () => {
    const users = await as(staff.accessToken, 'get', '/v1/admin/users?q=pastor').expect(200)
    const id = users.body.items[0].id

    await as(staff.accessToken, 'patch', `/v1/admin/users/${id}`).send({ status: 'disabled' }).expect(204)
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'pastor@church.test', password: 'a-long-enough-password' })
      .expect(401)
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('X-PA-Client', 'desktop')
      .send({ refreshToken: pastor.refreshToken })
      .expect(401)

    await as(staff.accessToken, 'patch', `/v1/admin/users/${id}`).send({ status: 'active' }).expect(204)
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'pastor@church.test', password: 'a-long-enough-password' })
      .expect(200)
  })

  it('will not let staff disable themselves', async () => {
    const users = await as(staff.accessToken, 'get', '/v1/admin/users?q=staff').expect(200)
    await as(staff.accessToken, 'patch', `/v1/admin/users/${users.body.items[0].id}`).send({ status: 'disabled' }).expect(400)
  })

  it('records downloads only with the ingest key, and counts them', async () => {
    const server = app.getHttpServer()
    await request(server).post('/v1/downloads/events').send({ platform: 'mac-arm64' }).expect(401)
    await request(server).post('/v1/downloads/events').set('X-Ingest-Key', 'wrong').send({ platform: 'mac-arm64' }).expect(401)
    await request(server)
      .post('/v1/downloads/events')
      .set('X-Ingest-Key', INGEST_KEY)
      .send({ platform: 'nintendo' })
      .expect(400)

    for (const platform of ['mac-arm64', 'mac-arm64', 'windows-x64']) {
      await request(server)
        .post('/v1/downloads/events')
        .set('X-Ingest-Key', INGEST_KEY)
        .send({ platform, version: '1.0.2', source: 'home', country: 'NG' })
        .expect(204)
    }
    await request(server)
      .post('/v1/downloads/events')
      .set('X-Ingest-Key', INGEST_KEY)
      .send({ platform: 'linux-x64', served: false })
      .expect(204)

    const stats = await as(staff.accessToken, 'get', '/v1/admin/downloads?days=7').expect(200)
    expect(stats.body.total).toBe(3)
    expect(stats.body.unavailable).toBe(1)
    expect(stats.body.byPlatform).toEqual([
      { key: 'mac-arm64', count: 2 },
      { key: 'windows-x64', count: 1 },
    ])
    expect(stats.body.byCountry).toEqual([{ key: 'NG', count: 3 }])
    expect(stats.body.byDay).toHaveLength(7)
    expect(stats.body.byDay.at(-1).count).toBe(3)
  })

  describe('admin team', () => {
    let helper: { accessToken: string; refreshToken: string }
    let helperId: string

    beforeAll(async () => {
      helper = await signUpVerified(context, { email: 'helper@kairo.test', name: 'Helper', orgName: 'Helper Church' })
      const users = await as(staff.accessToken, 'get', '/v1/admin/users?q=helper').expect(200)
      helperId = users.body.items[0].id
    })

    it('lists the superadmin from config', async () => {
      const team = await as(staff.accessToken, 'get', '/v1/admin/admins').expect(200)
      expect(team.body).toEqual([expect.objectContaining({ email: 'staff@kairo.test', role: 'superadmin' })])
    })

    it('a superadmin adds an admin by email, who can then open the console', async () => {
      await as(helper.accessToken, 'get', '/v1/admin/overview').expect(404)
      const added = await as(staff.accessToken, 'post', '/v1/admin/admins').send({ email: ' Helper@Kairo.test ' }).expect(201)
      expect(added.body).toMatchObject({ email: 'helper@kairo.test', role: 'admin' })
      await as(helper.accessToken, 'get', '/v1/admin/overview').expect(200)
      const session = await as(helper.accessToken, 'get', '/v1/auth/session').expect(200)
      expect(session.body.user).toMatchObject({ isAdmin: true, platformRole: 'admin' })
    })

    it('says so when no account uses the email', async () => {
      const response = await as(staff.accessToken, 'post', '/v1/admin/admins').send({ email: 'nobody@kairo.test' }).expect(404)
      expect(response.body.message).toMatch(/sign up first/)
    })

    it('an admin cannot add or remove admins, or disable staff', async () => {
      await as(helper.accessToken, 'post', '/v1/admin/admins').send({ email: 'pastor@church.test' }).expect(404)
      await as(helper.accessToken, 'delete', `/v1/admin/admins/${helperId}`).expect(404)
      const team = await as(helper.accessToken, 'get', '/v1/admin/admins').expect(200)
      const superId = team.body.find((entry: { role: string }) => entry.role === 'superadmin').id
      await as(helper.accessToken, 'patch', `/v1/admin/users/${superId}`).send({ status: 'disabled' }).expect(400)
    })

    it('only a superadmin can disable an admin', async () => {
      const users = await as(staff.accessToken, 'get', '/v1/admin/users?q=pastor').expect(200)
      const pastorId = users.body.items[0].id
      await as(staff.accessToken, 'post', '/v1/admin/admins').send({ email: 'pastor@church.test' }).expect(201)
      const fresh = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'helper@kairo.test', password: 'a-long-enough-password' })
        .expect(200)
      await as(fresh.body.accessToken, 'patch', `/v1/admin/users/${pastorId}`).send({ status: 'disabled' }).expect(403)
      await as(staff.accessToken, 'delete', `/v1/admin/admins/${pastorId}`).expect(204)
    })

    it('the superadmin cannot be removed from the website', async () => {
      const team = await as(staff.accessToken, 'get', '/v1/admin/admins').expect(200)
      const superId = team.body.find((entry: { role: string }) => entry.role === 'superadmin').id
      await as(staff.accessToken, 'delete', `/v1/admin/admins/${superId}`).expect(400)
    })

    it('removing an admin locks them out on their next request', async () => {
      await as(staff.accessToken, 'delete', `/v1/admin/admins/${helperId}`).expect(204)
      await as(helper.accessToken, 'get', '/v1/admin/overview').expect(404)
    })
  })
})

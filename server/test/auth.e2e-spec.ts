import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, DESKTOP, TestContext } from './harness'

const CREDENTIALS = {
  email: 'operator@grace.test',
  password: 'a-long-enough-password',
  name: 'Joshua',
  orgName: 'Grace Chapel',
}

describe('Auth (e2e)', () => {
  let context: TestContext
  let app: INestApplication

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
  })

  afterAll(async () => {
    await context.close()
  })

  const signUp = (overrides: Partial<typeof CREDENTIALS> = {}) =>
    request(app.getHttpServer())
      .post('/v1/auth/signup')
      .set(DESKTOP)
      .send({ ...CREDENTIALS, ...overrides })

  it('creates the account, its first org, and an owner session in one call', async () => {
    const response = await signUp().expect(201)

    expect(response.body.accessToken).toEqual(expect.any(String))
    expect(response.body.refreshToken).toEqual(expect.any(String))
    expect(response.body.user).toMatchObject({ email: CREDENTIALS.email, emailVerified: false })
    // A user with no org can do nothing, so signup must always land somewhere.
    expect(response.body.org).toMatchObject({ name: CREDENTIALS.orgName, role: 'owner' })
    expect(response.body.org.id).toEqual(expect.any(String))
  })

  it('refuses a second account on the same address', async () => {
    await signUp({ email: 'dupe@grace.test' }).expect(201)
    await signUp({ email: 'DUPE@grace.test' }).expect(409)
  })

  it('never says whether an email exists', async () => {
    await signUp({ email: 'real@grace.test' }).expect(201)

    const wrongPassword = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set(DESKTOP)
      .send({ email: 'real@grace.test', password: 'not-the-password' })
      .expect(401)
    const noSuchUser = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set(DESKTOP)
      .send({ email: 'ghost@grace.test', password: 'not-the-password' })
      .expect(401)

    expect(wrongPassword.body.message).toBe(noSuchUser.body.message)
  })

  it('rejects a password too short to be worth hashing', async () => {
    await signUp({ email: 'weak@grace.test', password: 'short' }).expect(400)
  })

  it('names the org from the church, never from the person', async () => {
    const { body } = await signUp({ email: 'church-name@grace.test', orgName: 'Riverside Chapel' }).expect(201)
    expect(body.org.name).toBe('Riverside Chapel')
    expect(body.org.name).not.toMatch(/Joshua/)
  })

  it('refuses signup without a church name', async () => {
    await signUp({ email: 'no-church@grace.test', orgName: '' }).expect(400)
  })

  it('signs in and returns a working access token', async () => {
    await signUp({ email: 'login@grace.test' }).expect(201)

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set(DESKTOP)
      .send({ email: 'login@grace.test', password: CREDENTIALS.password })
      .expect(200)

    const session = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200)

    expect(session.body.user.email).toBe('login@grace.test')
    expect(session.body.orgs).toHaveLength(1)
  })

  it('refuses a protected route with no token at all', async () => {
    await request(app.getHttpServer()).get('/v1/auth/session').expect(401)
  })

  it('gives the web client an HttpOnly cookie instead of a token in the body', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({ ...CREDENTIALS, email: 'web@grace.test' })
      .expect(201)

    // The page must never be able to read the refresh token.
    expect(response.body.refreshToken).toBeUndefined()
    const cookie = response.headers['set-cookie'][0]
    expect(cookie).toContain('pa_refresh=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('reports itself healthy without a token', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200)
    expect(response.body).toEqual({ status: 'ok', database: 'up' })
  })
})

describe('Google sign-in when unconfigured (e2e)', () => {
  let context: TestContext
  let app: INestApplication

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
  })

  afterAll(async () => {
    await context.close()
  })

  /**
   * The suite runs with no Google credentials on purpose, so this is the state
   * every developer and every fresh deploy is in until someone sets the keys.
   */
  it('answers 503 with a plain reason rather than a bare 500', async () => {
    const response = await request(app.getHttpServer()).get('/v1/auth/google').expect(503)
    expect(response.body.message).toMatch(/not configured/i)
  })

  it('does the same on the callback, so a stale link cannot 500 the server', async () => {
    await request(app.getHttpServer()).get('/v1/auth/google/callback?code=whatever').expect(503)
  })
})

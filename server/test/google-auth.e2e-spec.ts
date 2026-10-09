import request from 'supertest'
import { createTestApp, TestContext, DESKTOP } from './harness'
import { GoogleStrategy } from '../src/auth/strategies/google.strategy'
import { UsersService } from '../src/users/users.service'

/** Only Google's HTTPS transport is replaced; Passport, guards, tokens and Mongo are real. */
describe('Google sign-in (e2e)', () => {
  let context: TestContext
  let identity = { sub: 'google-one', email: 'google-one@gmail.com', email_verified: true, name: 'Joshua' }
  beforeAll(async () => {
    context = await createTestApp({ google: true })
    const strategy = context.app.get(GoogleStrategy) as unknown as {
      _oauth2: {
        getOAuthAccessToken: (code: string, options: unknown, done: (error: Error | null, access: string, refresh: string, params: Record<string, unknown>) => void) => void
        get: (url: string, access: string, done: (error: Error | null, body: string, response: Record<string, unknown>) => void) => void
      }
    }
    strategy._oauth2.getOAuthAccessToken = (_code, _options, done) => done(null, 'fake-google-access', '', {})
    strategy._oauth2.get = (_url, _token, done) => done(null, JSON.stringify(identity), {})
  })
  afterAll(async () => { await context?.close() })

  async function login(returnTo = '/dashboard') {
    const browser = request.agent(context.app.getHttpServer())
    const start = await browser.get('/v1/auth/google').query({ returnTo }).expect(302)
    const google = new URL(start.headers.location)
    expect(google.searchParams.get('redirect_uri')).toBe('http://localhost:3001/v1/auth/google/callback')
    const callback = await browser.get('/v1/auth/google/callback').query({ code: 'google-code', state: google.searchParams.get('state') }).expect(302)
    return { browser, callback }
  }

  it('creates a verified account, sets a refresh cookie and sends new users to church setup', async () => {
    const { browser, callback } = await login('/activate?userCode=ABCD-EFGH')
    expect(callback.headers.location).toBe('http://localhost:3001/onboarding?returnTo=%2Factivate%3FuserCode%3DABCD-EFGH')
    const refresh = await browser.post('/v1/auth/refresh').send({}).expect(200)
    expect(refresh.body.refreshToken).toBeUndefined()
    const session = await browser.get('/v1/auth/session').auth(refresh.body.accessToken, { type: 'bearer' }).expect(200)
    expect(session.body.user).toMatchObject({ email: identity.email, emailVerified: true })
    expect(session.body.orgs).toHaveLength(1)
    expect((callback.headers['set-cookie'] as unknown as string[]).some((cookie: string) => cookie.startsWith('pa_refresh=') && cookie.includes('HttpOnly'))).toBe(true)
  })

  it('returns existing users to pairing and issues a desktop session only after approval', async () => {
    const { browser } = await login()
    const refresh = await browser.post('/v1/auth/refresh').send({}).expect(200)
    const started = await request(context.app.getHttpServer()).post('/v1/auth/device/start').set(DESKTOP).send({ deviceId: 'google-booth', deviceName: 'Booth Mac' }).expect(201)
    expect(started.body.verificationUri).toContain(`userCode=${started.body.userCode}`)
    const destination = `/activate?userCode=${started.body.userCode}`
    const repeat = await login(destination)
    expect(repeat.callback.headers.location).toBe(`http://localhost:3001${destination}`)
    await browser.post('/v1/auth/device/approve').auth(refresh.body.accessToken, { type: 'bearer' }).send({ userCode: started.body.userCode }).expect(200)
    const paired = await request(context.app.getHttpServer()).post('/v1/auth/device/token').set(DESKTOP).send({ deviceCode: started.body.deviceCode }).expect(200)
    expect(paired.body.state).toBe('approved')
    expect(paired.body.refreshToken).toEqual(expect.any(String))
    expect(paired.body.user.email).toBe(identity.email)
  })

  it('never signs a disabled Google account in', async () => {
    const user = await context.app.get(UsersService).findByGoogleId(identity.sub)
    user!.status = 'disabled'
    await user!.save()
    const { callback, browser } = await login()
    expect(callback.headers.location).toContain('googleError=failed')
    await browser.post('/v1/auth/refresh').send({}).expect(401)
    user!.status = 'active'
    await user!.save()
  })

  it('does not automatically link an existing third-party email account', async () => {
    await request(context.app.getHttpServer()).post('/v1/auth/signup').set(DESKTOP).send({ email: 'person@external.test', password: 'a-long-enough-password', name: 'Original', orgName: 'Church' }).expect(201)
    identity = { sub: 'third-party-google', email: 'person@external.test', email_verified: true, name: 'Third party' }
    const { callback, browser } = await login()
    expect(callback.headers.location).toContain('googleError=failed')
    await browser.post('/v1/auth/refresh').send({}).expect(401)
  })
  it('requires Kairo email confirmation for a new third-party address Google does not own', async () => {
    identity = { sub: 'new-external-google', email: 'newperson@external.test', email_verified: true, name: 'New person' }
    const { browser } = await login()
    const refresh = await browser.post('/v1/auth/refresh').send({}).expect(200)
    const session = await browser.get('/v1/auth/session').auth(refresh.body.accessToken, { type: 'bearer' }).expect(200)
    expect(session.body.user.emailVerified).toBe(false)
    expect(context.mailer.lastCode(identity.email)).toMatch(/^\d{6}$/)
  })

  it('links verified Gmail to an existing account without creating another church', async () => {
    const original = await request(context.app.getHttpServer()).post('/v1/auth/signup').set(DESKTOP).send({ email: 'link-me@gmail.com', password: 'a-long-enough-password', name: 'Original', orgName: 'Existing Church' }).expect(201)
    identity = { sub: 'linked-google', email: 'link-me@gmail.com', email_verified: true, name: 'Google name' }
    const { browser, callback } = await login()
    expect(callback.headers.location).toBe('http://localhost:3001/dashboard')
    const refresh = await browser.post('/v1/auth/refresh').send({}).expect(200)
    const session = await browser.get('/v1/auth/session').auth(refresh.body.accessToken, { type: 'bearer' }).expect(200)
    expect(session.body.user.id).toBe(original.body.user.id)
    expect(session.body.user.emailVerified).toBe(true)
    expect(session.body.orgId).toBe(original.body.org.id)
    expect(session.body.orgs).toHaveLength(1)
  })

})

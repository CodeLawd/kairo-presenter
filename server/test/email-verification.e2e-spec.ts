import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, DESKTOP, signUpVerified, TestContext } from './harness'

/**
 * Every account must confirm its address. The rule has one deliberate limit:
 * it gates the API, never the app. Presenting is entirely local — the desktop
 * talks to ProPresenter, not to this server — so an unconfirmed account loses
 * cloud features and nothing else.
 */
describe('Email verification (e2e)', () => {
  let context: TestContext
  let app: INestApplication

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
  })

  afterAll(async () => {
    await context.close()
  })

  const signUp = (email: string) =>
    request(app.getHttpServer())
      .post('/v1/auth/signup')
      .set(DESKTOP)
      .send({ email, password: 'a-long-enough-password', name: 'Operator', orgName: 'Grace Chapel' })

  it('sends a confirmation link on signup', async () => {
    await signUp('fresh@grace.test').expect(201)

    const url = context.mailer.lastUrl('fresh@grace.test')
    expect(url).toContain('/verify-email?token=')
    expect(context.mailer.lastToken('fresh@grace.test')).toEqual(expect.any(String))
  })

  it('a new account starts unverified and says so', async () => {
    const { body } = await signUp('pending@grace.test').expect(201)
    expect(body.user.emailVerified).toBe(false)
  })

  it('blocks org routes until the address is confirmed', async () => {
    const { body } = await signUp('blocked@grace.test').expect(201)

    const denied = await request(app.getHttpServer())
      .get(`/v1/orgs/${body.org.id}`)
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(403)
    expect(denied.body.message).toMatch(/confirm your email/i)
    expect(denied.body.message).toMatch(/code/i)
  })

  it('blocks approving a booth machine — pairing is an org action', async () => {
    const { body } = await signUp('unverified-approver@grace.test').expect(201)
    const started = await request(app.getHttpServer())
      .post('/v1/auth/device/start')
      .send({ deviceId: 'some-mac' })
      .expect(201)

    await request(app.getHttpServer())
      .post('/v1/auth/device/approve')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ userCode: started.body.userCode })
      .expect(403)
  })

  it('still lets an unverified account read its session and sign out', async () => {
    const { body } = await signUp('halfway@grace.test').expect(201)

    // Without these, someone could not even see why they are stuck.
    await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200)
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(204)
  })

  it('unlocks everything once the link is clicked', async () => {
    const account = await signUpVerified(context, { email: 'confirmed@grace.test' })

    const allowed = await request(app.getHttpServer())
      .get(`/v1/orgs/${account.orgId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200)
    expect(allowed.body.id).toBe(account.orgId)
  })

  it('unlocks immediately, without waiting for the token to expire', async () => {
    const { body } = await signUp('impatient@grace.test').expect(201)
    const token = context.mailer.lastToken('impatient@grace.test')!
    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(200)

    // The access token still says unverified — it was minted before the click.
    // Being locked out for another 15 minutes after doing exactly what was
    // asked would be indefensible, so the guard re-checks.
    await request(app.getHttpServer())
      .get(`/v1/orgs/${body.org.id}`)
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200)
  })

  it('a confirmation link works exactly once', async () => {
    await signUp('once@grace.test').expect(201)
    const token = context.mailer.lastToken('once@grace.test')!

    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(200)
    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(400)
  })

  it('rejects a forged token', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(400)
  })

  it('resends the link when the first email is lost', async () => {
    await signUp('lost@grace.test').expect(201)
    const first = context.mailer.lastToken('lost@grace.test')

    await request(app.getHttpServer())
      .post('/v1/auth/resend-verification')
      .send({ email: 'lost@grace.test' })
      .expect(202)

    const second = context.mailer.lastToken('lost@grace.test')
    expect(second).not.toBe(first)
    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token: second }).expect(200)
  })

  it('resend never reveals whether an address has an account', async () => {
    const before = context.mailer.sent.length
    await request(app.getHttpServer())
      .post('/v1/auth/resend-verification')
      .send({ email: 'nobody@grace.test' })
      .expect(202)
    // Same 202, and nothing actually sent.
    expect(context.mailer.sent.length).toBe(before)
  })

  it('resending to an already-confirmed address sends nothing', async () => {
    await signUpVerified(context, { email: 'done@grace.test' })
    const before = context.mailer.sent.length

    await request(app.getHttpServer())
      .post('/v1/auth/resend-verification')
      .send({ email: 'done@grace.test' })
      .expect(202)
    expect(context.mailer.sent.length).toBe(before)
  })
})

/**
 * Confirming with the six-digit code, which is how someone sitting in front of
 * the desktop app does it — a booth machine frequently has no mail client, and
 * bouncing through a browser to click a link is the step people abandon.
 */
describe('Email verification by code (e2e)', () => {
  let context: TestContext
  let app: INestApplication

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
  })

  afterAll(async () => {
    await context.close()
  })

  const signUp = (email: string) =>
    request(app.getHttpServer())
      .post('/v1/auth/signup')
      .set(DESKTOP)
      .send({ email, password: 'a-long-enough-password', name: 'Operator', orgName: 'Grace Chapel' })

  const verify = (email: string, code: string) =>
    request(app.getHttpServer()).post('/v1/auth/verify-email-code').send({ email, code })

  it('emails a six-digit code alongside the link', async () => {
    await signUp('code@grace.test').expect(201)
    expect(context.mailer.lastCode('code@grace.test')).toMatch(/^\d{6}$/)
    expect(context.mailer.lastUrl('code@grace.test')).toContain('/verify-email?token=')
  })

  it('confirms the address and unlocks org routes', async () => {
    const { body } = await signUp('otp@grace.test').expect(201)
    await verify('otp@grace.test', context.mailer.lastCode('otp@grace.test')!).expect(200)

    await request(app.getHttpServer())
      .get(`/v1/orgs/${body.org.id}`)
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200)
  })

  it('accepts a code the way a person pastes it', async () => {
    await signUp('spaced@grace.test').expect(201)
    const code = context.mailer.lastCode('spaced@grace.test')!
    await verify('spaced@grace.test', `${code.slice(0, 3)} ${code.slice(3)}`).expect(200)
  })

  it('refuses a wrong code', async () => {
    await signUp('wrong@grace.test').expect(201)
    const code = context.mailer.lastCode('wrong@grace.test')!
    const wrong = code === '000000' ? '111111' : '000000'

    const failed = await verify('wrong@grace.test', wrong).expect(400)
    expect(failed.body.message).toMatch(/not right/i)
    // …and the real code still works afterwards.
    await verify('wrong@grace.test', code).expect(200)
  })

  it('burns the code after five wrong guesses', async () => {
    await signUp('bruteforce@grace.test').expect(201)
    const code = context.mailer.lastCode('bruteforce@grace.test')!

    for (let attempt = 0; attempt < 5; attempt++) {
      await verify('bruteforce@grace.test', '999999').expect(400)
    }

    // Six digits is only safe because a million guesses are not available: the
    // real code must now be dead too, not merely the wrong ones refused.
    const dead = await verify('bruteforce@grace.test', code).expect(400)
    expect(dead.body.message).toMatch(/expired|new one/i)
  })

  it('a code works exactly once', async () => {
    await signUp('reuse@grace.test').expect(201)
    const code = context.mailer.lastCode('reuse@grace.test')!
    await verify('reuse@grace.test', code).expect(200)
    // Already verified: silently fine, never an error the operator must decode.
    await verify('reuse@grace.test', code).expect(200)
  })

  it('resending invalidates the previous code', async () => {
    await signUp('rotate@grace.test').expect(201)
    const first = context.mailer.lastCode('rotate@grace.test')!

    await request(app.getHttpServer())
      .post('/v1/auth/resend-verification')
      .send({ email: 'rotate@grace.test' })
      .expect(202)
    const second = context.mailer.lastCode('rotate@grace.test')!
    expect(second).not.toBe(first)

    // Two live codes in two emails would be one more thing that can leak.
    await verify('rotate@grace.test', first).expect(400)
    await verify('rotate@grace.test', second).expect(200)
  })

  it('gives nothing away for an address with no account', async () => {
    await verify('ghost@grace.test', '123456').expect(400)
  })
})

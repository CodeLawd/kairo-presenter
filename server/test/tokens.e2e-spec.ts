import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, DESKTOP, TestContext } from './harness'

describe('Refresh token rotation (e2e)', () => {
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
      .send({ email, password: 'a-long-enough-password', name: 'Operator', orgName: 'Grace Chapel', deviceId: 'booth-pc' })

  const refresh = (token: string) =>
    request(app.getHttpServer()).post('/v1/auth/refresh').set(DESKTOP).send({ refreshToken: token })

  it('rotates: each refresh returns a NEW token and retires the old one', async () => {
    const { body } = await signUp('rotate@grace.test').expect(201)

    const first = await refresh(body.refreshToken).expect(200)
    expect(first.body.refreshToken).not.toBe(body.refreshToken)
    expect(first.body.accessToken).toEqual(expect.any(String))

    const second = await refresh(first.body.refreshToken).expect(200)
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken)
  })

  it('treats a replayed token as theft and kills the whole device chain', async () => {
    const { body } = await signUp('replay@grace.test').expect(201)
    const rotated = await refresh(body.refreshToken).expect(200)

    // Someone kept a copy of the original and is using it after the real holder
    // already rotated. There is no way to tell thief from owner, so both lose.
    await refresh(body.refreshToken).expect(401)

    // The token the legitimate holder has is now dead too — they sign in again.
    await refresh(rotated.body.refreshToken).expect(401)
  })

  it('rejects a refresh token that was never issued', async () => {
    await refresh('completely-made-up-token').expect(401)
  })

  it('rejects a refresh with no token supplied at all', async () => {
    await request(app.getHttpServer()).post('/v1/auth/refresh').set(DESKTOP).send({}).expect(401)
  })

  it('logout kills only that device, and its refresh token stops working', async () => {
    const { body } = await signUp('logout@grace.test').expect(201)

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set(DESKTOP)
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(204)

    await refresh(body.refreshToken).expect(401)
  })
})

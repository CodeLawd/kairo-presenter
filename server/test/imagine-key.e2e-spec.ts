import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { createTestApp, DESKTOP, signUpVerified, TestContext } from './harness'
import { User, UserDocument } from '../src/users/schemas/user.schema'

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'

/** One account is one account: the Imagine key follows the person, not the device. */
describe('Imagine key sync (e2e)', () => {
  let context: TestContext
  let app: INestApplication

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
  })

  afterAll(async () => {
    await context.close()
  })

  const as = (token: string, method: 'get' | 'put' | 'delete', path: string): request.Test =>
    request(app.getHttpServer())[method](path).set(DESKTOP).set('Authorization', `Bearer ${token}`)

  it('stores the key encrypted, returns it only to its owner, and forgets it', async () => {
    const a = await signUpVerified(context, { email: 'ik-a@example.com', orgName: 'A', password: 'a-long-enough-password' })
    const b = await signUpVerified(context, { email: 'ik-b@example.com', orgName: 'B', password: 'a-long-enough-password' })

    expect((await as(a.accessToken, 'get', '/v1/account/imagine-key').expect(200)).body).toEqual({ key: null })
    await as(a.accessToken, 'put', '/v1/account/imagine-key').send({ key: 'not-a-key' }).expect(400)
    await as(a.accessToken, 'put', '/v1/account/imagine-key').send({ key: KEY }).expect(200)

    expect((await as(a.accessToken, 'get', '/v1/account/imagine-key').expect(200)).body).toEqual({ key: KEY })
    expect((await as(b.accessToken, 'get', '/v1/account/imagine-key').expect(200)).body).toEqual({ key: null })

    const users = app.get<Model<UserDocument>>(getModelToken(User.name))
    const stored = await users.findOne({ email: 'ik-a@example.com' }).select('+imagineKey').lean().exec()
    expect(JSON.stringify(stored)).not.toContain(KEY)
    const exported = await as(a.accessToken, 'get', '/v1/account/export').expect(200)
    expect(JSON.stringify(exported.body)).not.toContain('imagineKey')

    await as(a.accessToken, 'delete', '/v1/account/imagine-key').expect(200)
    expect((await as(a.accessToken, 'get', '/v1/account/imagine-key').expect(200)).body).toEqual({ key: null })
  })

  it('needs a signed-in person', async () => {
    await request(app.getHttpServer()).get('/v1/account/imagine-key').set(DESKTOP).expect(401)
  })
})

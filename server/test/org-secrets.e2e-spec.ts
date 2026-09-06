import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, signUpVerified, TestContext } from './harness'

describe('Org secrets vault (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  let alice: { token: string; orgId: string }
  let bob: { token: string; orgId: string }

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app

    const signUp = async (email: string, orgName: string) => {
      const account = await signUpVerified(context, {
        email,
        name: email.split('@')[0],
        orgName,
      })
      return { token: account.accessToken, orgId: account.orgId }
    }

    alice = await signUp('vault-alice@first.test', 'Vault First')
    bob = await signUp('vault-bob@second.test', 'Vault Second')
  })

  afterAll(async () => {
    await context.close()
  })

  it('starts empty, accepts a put, and returns plaintext to the member', async () => {
    const empty = await request(app.getHttpServer())
      .get(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200)

    expect(empty.body.deepgramApiKey).toBe('')
    expect(empty.body.updatedAt).toBeNull()

    const put = await request(app.getHttpServer())
      .put(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ deepgramApiKey: 'dg-live', bibleApiKey: 'bible-live' })
      .expect(200)

    expect(put.body.deepgramApiKey).toBe('dg-live')
    expect(put.body.bibleApiKey).toBe('bible-live')
    expect(put.body.updatedAt).toBeTruthy()

    const get = await request(app.getHttpServer())
      .get(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200)

    expect(get.body.deepgramApiKey).toBe('dg-live')
    expect(get.body.bibleApiKey).toBe('bible-live')
  })

  it('merges partial puts and clears with null', async () => {
    await request(app.getHttpServer())
      .put(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ anthropicApiKey: 'sk-ant-test', bibleApiKey: null })
      .expect(200)

    const get = await request(app.getHttpServer())
      .get(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200)

    expect(get.body.deepgramApiKey).toBe('dg-live')
    expect(get.body.anthropicApiKey).toBe('sk-ant-test')
    expect(get.body.bibleApiKey).toBe('')
  })

  it('refuses another org’s vault', async () => {
    await request(app.getHttpServer())
      .get(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(403)

    await request(app.getHttpServer())
      .put(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ deepgramApiKey: 'hijack' })
      .expect(403)
  })
})

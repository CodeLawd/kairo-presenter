import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, signUpVerified, TestContext } from './harness'

describe('Retired org secrets vault (e2e)', () => {
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
    await context?.close()
  })

  it('returns empty key fields and refuses provider-key writes with migration guidance', async () => {
    const read = () => request(app.getHttpServer())
      .get(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200)
    const empty = await read()
    for (const field of ['deepgramApiKey', 'bibleApiKey', 'anthropicApiKey', 'deepseekApiKey', 'braveApiKey', 'googleTranslateApiKey']) {
      expect(empty.body[field]).toBe('')
    }
    expect(empty.body.updatedAt).toBeNull()
    const put = await request(app.getHttpServer())
      .put(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ deepgramApiKey: 'dg-private', bibleApiKey: 'bible-private' })
      .expect(403)
    expect(put.body.message).toMatch(/managed centrally/)
    expect(JSON.stringify(put.body)).not.toContain('dg-private')
    expect((await read()).body).toEqual(empty.body)
  })

  it('refuses partial edits and clearing retired credentials', async () => {
    await request(app.getHttpServer())
      .put(`/v1/orgs/${alice.orgId}/secrets`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ anthropicApiKey: 'sk-ant-test', bibleApiKey: null })
      .expect(403)
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

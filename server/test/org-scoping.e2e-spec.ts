import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { createTestApp, signUpVerified, TestContext } from './harness'

/**
 * The tenancy boundary. Every one of these would be a data breach if it passed
 * the wrong way, so each guarded route gets its own case rather than one
 * representative check.
 */
describe('Org scoping (e2e)', () => {
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

    alice = await signUp('alice@first.test', 'First Baptist')
    bob = await signUp('bob@second.test', 'Second Chapel')
  })

  afterAll(async () => {
    await context.close()
  })

  const as = (who: { token: string }, method: 'get' | 'patch', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${who.token}`)

  it('lets a member read their own org', async () => {
    const response = await as(alice, 'get', `/v1/orgs/${alice.orgId}`).expect(200)
    expect(response.body.name).toBe('First Baptist')
  })

  it('refuses to read another org', async () => {
    await as(bob, 'get', `/v1/orgs/${alice.orgId}`).expect(403)
  })

  it('refuses to read another org members list', async () => {
    await as(bob, 'get', `/v1/orgs/${alice.orgId}/members`).expect(403)
  })

  it('refuses to list another org booth machines', async () => {
    await as(bob, 'get', `/v1/orgs/${alice.orgId}/devices`).expect(403)
  })

  it('lists the caller’s own booth machine after a desktop signup', async () => {
    const response = await as(alice, 'get', `/v1/orgs/${alice.orgId}/devices`).expect(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ signedInAs: 'alice' })
  })

  it('refuses to rename another org', async () => {
    await as(bob, 'patch', `/v1/orgs/${alice.orgId}`).send({ name: 'Hijacked' }).expect(403)

    // And the name is genuinely untouched, not merely reported as refused.
    const check = await as(alice, 'get', `/v1/orgs/${alice.orgId}`).expect(200)
    expect(check.body.name).toBe('First Baptist')
  })

  it('lists only the orgs the caller belongs to', async () => {
    const response = await as(bob, 'get', '/v1/orgs').expect(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].id).toBe(bob.orgId)
  })

  it('an owner can update their own org profile', async () => {
    const response = await as(alice, 'patch', `/v1/orgs/${alice.orgId}`)
      .send({ timezone: 'Africa/Lagos', serviceTimes: [{ day: 0, time: '09:30', label: 'First' }] })
      .expect(200)
    expect(response.body.timezone).toBe('Africa/Lagos')
    expect(response.body.serviceTimes).toHaveLength(1)
  })

  it('rejects a malformed service time rather than storing it', async () => {
    await as(alice, 'patch', `/v1/orgs/${alice.orgId}`)
      .send({ serviceTimes: [{ day: 9, time: '25:00' }] })
      .expect(400)
  })

  it('refuses a well-formed token against an org id that does not exist', async () => {
    await as(alice, 'get', '/v1/orgs/64b7f9a2c1d2e3f4a5b6c7d8').expect(403)
  })
})

import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { createTestApp, DESKTOP, signUpVerified, TestContext } from './harness'
import { User, UserDocument } from '../src/users/schemas/user.schema'
import { Organization, OrganizationDocument } from '../src/orgs/schemas/organization.schema'
import { Membership, MembershipDocument } from '../src/orgs/schemas/membership.schema'
import { OrgSecrets, OrgSecretsDocument } from '../src/orgs/schemas/org-secrets.schema'
import { Session, SessionDocument } from '../src/auth/schemas/session.schema'
import { EmailToken, EmailTokenDocument } from '../src/auth/schemas/email-token.schema'
import { Sermon, SermonDocument } from '../src/sermons/schemas/sermon.schema'
import { CrashReport, CrashReportDocument } from '../src/crashes/schemas/crash-report.schema'
import { UsageDay, UsageDayDocument } from '../src/usage/schemas/usage-day.schema'
import { UsersService } from '../src/users/users.service'
import { OrgsService } from '../src/orgs/orgs.service'
import { TokenService } from '../src/auth/token.service'

const PASSWORD = 'a-long-enough-password'

interface Account {
  token: string
  refreshToken: string
  orgId: string
  userId: string
  email: string
}

/**
 * Export and erasure are the privacy policy's promises in code. Each boundary
 * gets its own case: what an export must never contain, what a deletion must
 * reach, and what it must leave alone.
 */
describe('Account data rights (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  const model = <T>(name: string): Model<T> => app.get<Model<T>>(getModelToken(name))

  beforeAll(async () => {
    context = await createTestApp()
    app = context.app
  })

  afterAll(async () => {
    await context.close()
  })

  const as = (token: string, method: 'get' | 'post' | 'put', path: string): request.Test =>
    request(app.getHttpServer())[method](path).set(DESKTOP).set('Authorization', `Bearer ${token}`)

  async function signUp(email: string, orgName: string): Promise<Account> {
    const account = await signUpVerified(context, { email, orgName, password: PASSWORD })
    const session = await as(account.accessToken, 'get', '/v1/auth/session').expect(200)
    return {
      token: account.accessToken,
      refreshToken: account.refreshToken,
      orgId: account.orgId,
      userId: session.body.user.id,
      email,
    }
  }

  /** A church's whole footprint: a sermon, a vault, a crash and a usage day. */
  async function fill(account: Account): Promise<void> {
    await as(account.token, 'post', `/v1/orgs/${account.orgId}/sermons`)
      .send({
        localId: 'service-1',
        title: 'Sunday Morning',
        speaker: 'Pastor Dara',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_600_000,
        transcript: [
          {
            id: 'seg-0',
            text: 'grace upon grace for every one of you',
            timestamp: 1_700_000_000_000,
            duration: 4.5,
            words: [{ word: 'grace', start: 0, end: 0.4, confidence: 0.98 }],
          },
        ],
      })
      .expect(202)
    await as(account.token, 'put', `/v1/orgs/${account.orgId}/secrets`)
      .send({ deepgramApiKey: 'dg-secret-value' })
      .expect(200)
    await as(account.token, 'post', '/v1/usage/page').send({ path: '/dashboard' }).expect(204)
    await model<CrashReportDocument>(CrashReport.name).create({
      installId: `install-${account.email}`,
      reportId: 'r1',
      orgId: new Types.ObjectId(account.orgId),
      userId: new Types.ObjectId(account.userId),
      kind: 'renderer',
      firstAt: new Date(),
      lastAt: new Date(),
    })
  }

  async function footprint(account: Account): Promise<Record<string, number>> {
    const userId = new Types.ObjectId(account.userId)
    const orgId = new Types.ObjectId(account.orgId)
    return {
      users: await model<UserDocument>(User.name).countDocuments({ _id: userId }),
      orgs: await model<OrganizationDocument>(Organization.name).countDocuments({ _id: orgId }),
      memberships: await model<MembershipDocument>(Membership.name).countDocuments({ userId }),
      sessions: await model<SessionDocument>(Session.name).countDocuments({ userId }),
      emailTokens: await model<EmailTokenDocument>(EmailToken.name).countDocuments({ userId }),
      sermons: await model<SermonDocument>(Sermon.name).countDocuments({ orgId }),
      secrets: await model<OrgSecretsDocument>(OrgSecrets.name).countDocuments({ orgId }),
      crashes: await model<CrashReportDocument>(CrashReport.name).countDocuments({ userId }),
      usage: await model<UsageDayDocument>(UsageDay.name).countDocuments({ userId }),
    }
  }

  describe('export', () => {
    let alice: Account

    beforeAll(async () => {
      alice = await signUp('alice@export.test', 'Export Chapel')
      await fill(alice)
    })

    it('needs a signed-in caller', async () => {
      await request(app.getHttpServer()).get('/v1/account/export').expect(401)
    })

    it('returns the account, sessions, churches, decrypted transcripts and telemetry', async () => {
      const { body } = await as(alice.token, 'get', '/v1/account/export').expect(200)

      expect(body.format).toBe('kairo-account-export/v1')
      expect(body.account).toMatchObject({ email: alice.email, hasPassword: true, googleLinked: false })
      expect(body.memberships).toEqual([
        expect.objectContaining({ orgId: alice.orgId, orgName: 'Export Chapel', role: 'owner' }),
      ])
      expect(body.sessions.length).toBeGreaterThan(0)
      expect(body.sessions[0]).toHaveProperty('ip')
      expect(body.sessions[0]).toHaveProperty('userAgent')

      expect(body.organizations).toHaveLength(1)
      const [org] = body.organizations
      expect(org).toMatchObject({ id: alice.orgId, name: 'Export Chapel', yourRole: 'owner', ownedByYou: true })
      expect(org.sermons).toHaveLength(1)
      expect(org.sermons[0].transcript[0].text).toBe('grace upon grace for every one of you')
      expect(org.apiKeys.configured).toEqual(['deepgramApiKey'])

      expect(body.crashReports).toHaveLength(1)
      expect(body.usageDays).toHaveLength(1)
    })

    it('never contains a password hash, token hashes, ciphertext or vault values', async () => {
      const { body } = await as(alice.token, 'get', '/v1/account/export').expect(200)
      const raw = JSON.stringify(body)
      expect(raw).not.toContain('passwordHash')
      expect(raw).not.toContain('$argon2')
      expect(raw).not.toContain('tokenHash')
      expect(raw).not.toContain('familyId')
      expect(raw).not.toContain('transcriptCiphertext')
      expect(raw).not.toContain('dg-secret-value')
    })

    it('is available before the email address is confirmed', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/v1/auth/signup')
        .set(DESKTOP)
        .send({ email: 'unconfirmed@export.test', password: PASSWORD, name: 'New', orgName: 'Fresh' })
        .expect(201)
      const exported = await as(body.accessToken, 'get', '/v1/account/export').expect(200)
      expect(exported.body.account.emailVerifiedAt).toBeNull()
    })
  })

  describe('deletion with a password', () => {
    let alice: Account
    let bob: Account

    beforeAll(async () => {
      alice = await signUp('alice@delete.test', 'Doomed Chapel')
      bob = await signUp('bob@delete.test', 'Bystander Chapel')
      await fill(alice)
      await fill(bob)
    })

    it('previews the church that goes with the account', async () => {
      const { body } = await as(alice.token, 'get', '/v1/account/deletion').expect(200)
      expect(body).toEqual({
        confirmWith: 'password',
        deleteOrgs: [{ id: alice.orgId, name: 'Doomed Chapel' }],
        leaveOrgs: [],
        blockers: [],
        sermonCounts: { [alice.orgId]: 1 },
      })
    })

    it('refuses a wrong password without touching anything', async () => {
      await as(alice.token, 'post', '/v1/account/delete')
        .send({ password: 'not-the-password', deleteOrgIds: [alice.orgId] })
        .expect(403)
      expect((await footprint(alice)).users).toBe(1)
    })

    it('refuses when the confirmed churches do not match', async () => {
      await as(alice.token, 'post', '/v1/account/delete')
        .send({ password: PASSWORD, deleteOrgIds: [] })
        .expect(400)
      await as(alice.token, 'post', '/v1/account/delete')
        .send({ password: PASSWORD, deleteOrgIds: [alice.orgId, bob.orgId] })
        .expect(400)
      expect((await footprint(alice)).orgs).toBe(1)
    })

    it('does not send an email code to an account that has a password', async () => {
      await as(alice.token, 'post', '/v1/account/deletion/code').expect(400)
    })

    it('erases the account, its church and everything linked to either', async () => {
      const { body } = await as(alice.token, 'post', '/v1/account/delete')
        .send({ password: PASSWORD, deleteOrgIds: [alice.orgId] })
        .expect(200)
      expect(body).toEqual({ deleted: true, deletedOrgIds: [alice.orgId] })

      expect(await footprint(alice)).toEqual({
        users: 0,
        orgs: 0,
        memberships: 0,
        sessions: 0,
        emailTokens: 0,
        sermons: 0,
        secrets: 0,
        crashes: 0,
        usage: 0,
      })
    })

    it('leaves no way back in', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set(DESKTOP)
        .send({ refreshToken: alice.refreshToken })
        .expect(401)
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .set(DESKTOP)
        .send({ email: alice.email, password: PASSWORD })
        .expect(401)
    })

    it('does not touch another church', async () => {
      const left = await footprint(bob)
      expect(left).toMatchObject({ users: 1, orgs: 1, sermons: 1, secrets: 1, crashes: 1, usage: 1 })
      expect(left.sessions).toBeGreaterThan(0)
    })
  })

  describe('shared churches', () => {
    let carol: Account
    let dave: Account

    beforeAll(async () => {
      carol = await signUp('carol@shared.test', 'Shared Chapel')
      dave = await signUp('dave@shared.test', 'Dave Chapel')
      // Dave also helps run Carol's church.
      await model<MembershipDocument>(Membership.name).create({
        orgId: new Types.ObjectId(carol.orgId),
        userId: new Types.ObjectId(dave.userId),
        role: 'admin',
        status: 'active',
      })
      await model<OrganizationDocument>(Organization.name).updateOne(
        { _id: carol.orgId },
        { $set: { seatsUsed: 2 } },
      )
    })

    it('blocks the sole owner of a church others still use', async () => {
      const preview = await as(carol.token, 'get', '/v1/account/deletion').expect(200)
      expect(preview.body.blockers).toEqual([{ id: carol.orgId, name: 'Shared Chapel', otherMembers: 1 }])

      await as(carol.token, 'post', '/v1/account/delete')
        .send({ password: PASSWORD, deleteOrgIds: [] })
        .expect(409)
      expect((await footprint(carol)).users).toBe(1)
    })

    it('lets a member leave a church that carries on, freeing the seat', async () => {
      const preview = await as(dave.token, 'get', '/v1/account/deletion').expect(200)
      expect(preview.body.deleteOrgs).toEqual([{ id: dave.orgId, name: 'Dave Chapel' }])
      expect(preview.body.leaveOrgs).toEqual([{ id: carol.orgId, name: 'Shared Chapel' }])

      await as(dave.token, 'post', '/v1/account/delete')
        .send({ password: PASSWORD, deleteOrgIds: [dave.orgId] })
        .expect(200)

      const org = await model<OrganizationDocument>(Organization.name).findById(carol.orgId).lean()
      expect(org?.seatsUsed).toBe(1)
      const members = await as(carol.token, 'get', `/v1/orgs/${carol.orgId}/members`).expect(200)
      expect(members.body.map((m: { userId: string }) => m.userId)).toEqual([carol.userId])

      // With Dave gone, Carol is alone and may now delete her church too.
      const after = await as(carol.token, 'get', '/v1/account/deletion').expect(200)
      expect(after.body.blockers).toEqual([])
      expect(after.body.deleteOrgs).toEqual([{ id: carol.orgId, name: 'Shared Chapel' }])
    })
  })

  describe('deletion without a password', () => {
    let token: string
    let orgId: string
    const email = 'google-only@delete.test'

    beforeAll(async () => {
      const user = await app.get(UsersService).create({
        email,
        name: 'Gale Google',
        googleId: 'google-delete',
        emailVerifiedAt: new Date(),
      })
      const org = await app.get(OrgsService).createWithOwner({ name: 'Google Chapel', ownerUserId: user._id })
      orgId = org._id.toString()
      const pair = await app.get(TokenService).issue({
        userId: user._id,
        orgId: org._id,
        role: 'owner',
        deviceId: 'browser',
        clientKind: 'web',
        emailVerified: true,
      })
      token = pair.accessToken
    })

    it('asks for an emailed code instead of a password', async () => {
      const preview = await as(token, 'get', '/v1/account/deletion').expect(200)
      expect(preview.body.confirmWith).toBe('email-code')

      await as(token, 'post', '/v1/account/delete').send({ deleteOrgIds: [orgId] }).expect(400)
      await as(token, 'post', '/v1/account/delete')
        .send({ password: 'anything', deleteOrgIds: [orgId] })
        .expect(400)
    })

    it('refuses a wrong code and accepts the one that was sent', async () => {
      await as(token, 'post', '/v1/account/deletion/code').expect(202)
      const code = context.mailer.lastCode(email, 'delete-account')
      expect(code).toMatch(/^\d{6}$/)

      const wrong = code === '000000' ? '111111' : '000000'
      await as(token, 'post', '/v1/account/delete').send({ code: wrong, deleteOrgIds: [orgId] }).expect(400)

      await as(token, 'post', '/v1/account/delete').send({ code, deleteOrgIds: [orgId] }).expect(200)
      expect(await model<UserDocument>(User.name).countDocuments({ email })).toBe(0)
      expect(await model<OrganizationDocument>(Organization.name).countDocuments({ _id: orgId })).toBe(0)
    })
  })
})

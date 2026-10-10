import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import { createTestApp, signUpVerified, TestContext } from './harness'
import { Session, type SessionDocument } from '../src/auth/schemas/session.schema'

const today = (): string => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

const SYSTEM = {
  os: 'darwin',
  osVersion: '15.4',
  arch: 'arm64',
  appVersion: '1.0.5',
  electronVersion: '33.4.11',
  locale: 'en-GB',
  cpuCount: 8,
  memoryGb: 16,
  screens: 2,
  ndiOutputs: 1,
  propresenter: false,
  transcription: true,
  automation: true,
  defaultTranslation: 'KJV',
  theme: 'light',
}

/**
 * Usage statistics: churches report counts, staff read them. The things that
 * matter are that nothing outside the fixed list is stored, that a re-sent day
 * replaces rather than doubles, and that only staff can read it back.
 */
describe('Usage statistics (e2e)', () => {
  let context: TestContext
  let app: INestApplication
  let staff: { accessToken: string }
  let church: { accessToken: string; orgId: string }

  beforeAll(async () => {
    process.env.SUPERADMIN_EMAILS = 'staff@kairo.test'
    context = await createTestApp()
    app = context.app
    staff = await signUpVerified(context, { email: 'staff@kairo.test', name: 'Staff', orgName: 'Kairo HQ' })
    church = await signUpVerified(context, { email: 'booth@grace.test', name: 'Booth', orgName: 'Grace Church' })
  })

  afterAll(async () => {
    delete process.env.SUPERADMIN_EMAILS
    await context.close()
  })

  const as = (token: string, method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`)

  it('requires sign-in to report', async () => {
    await request(app.getHttpServer()).post('/v1/usage/report').send({ installId: 'x', days: [], system: SYSTEM }).expect(401)
  })

  it('stores known counters only, and ignores days outside the window', async () => {
    const response = await as(church.accessToken, 'post', '/v1/usage/report')
      .send({
        installId: 'spoofed-by-body',
        days: [
          { day: today(), counts: { scripture_manual: 4, lyrics_slide: 10, transcript_text: 999 }, errors: { uncaught: 1, secret: 5 } },
          { day: daysAgo(90), counts: { lyrics_slide: 1 }, errors: {} },
          { day: 'not-a-day', counts: { lyrics_slide: 1 }, errors: {} },
        ],
        system: { ...SYSTEM, hostname: 'Pastor-MacBook' },
      })
      .expect(201)
    expect(response.body.accepted).toEqual([today()])

    const usage = await as(staff.accessToken, 'get', '/v1/admin/usage?days=7').expect(200)
    expect(usage.body.features).toEqual(
      expect.arrayContaining([
        { key: 'lyrics_slide', count: 10 },
        { key: 'scripture_manual', count: 4 },
      ]),
    )
    expect(usage.body.features.map((f: { key: string }) => f.key)).not.toContain('transcript_text')
    expect(usage.body.errors).toEqual([{ key: 'uncaught', count: 1 }])
    expect(usage.body.active).toMatchObject({ today: 1, week: 1, churches: 1 })
    expect(usage.body.systems.appVersion).toEqual([{ key: '1.0.5', count: 1 }])
  })

  it('a re-sent day replaces its totals instead of adding to them', async () => {
    for (const lyrics of [12, 12]) {
      await as(church.accessToken, 'post', '/v1/usage/report')
        .send({ installId: 'x', days: [{ day: today(), counts: { lyrics_slide: lyrics }, errors: {} }], system: SYSTEM })
        .expect(201)
    }
    const usage = await as(staff.accessToken, 'get', '/v1/admin/usage?days=7').expect(200)
    expect(usage.body.features).toEqual([{ key: 'lyrics_slide', count: 12 }])
  })

  it('keeps the signed-in device record on the current app version', async () => {
    await as(church.accessToken, 'post', '/v1/usage/report')
      // An updated app reports today's totals with its new version.
      .send({ installId: 'x', days: [{ day: today(), counts: { lyrics_slide: 12 }, errors: {} }], system: { ...SYSTEM, appVersion: '1.0.6' } })
      .expect(201)
    const sessions = app.get<Model<SessionDocument>>(getModelToken(Session.name))
    const rows = await sessions.find({ revokedAt: null, 'device.appVersion': '1.0.6' }).lean().exec()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('counts website pages by section, dropping ids', async () => {
    await as(church.accessToken, 'post', '/v1/usage/page').send({ path: '/dashboard/sermons/6612abc?tab=1' }).expect(204)
    await as(church.accessToken, 'post', '/v1/usage/page').send({ path: '/dashboard/sermons' }).expect(204)
    await as(church.accessToken, 'post', '/v1/usage/page').send({ path: '/pricing' }).expect(204)
    const usage = await as(staff.accessToken, 'get', '/v1/admin/usage?days=7').expect(200)
    expect(usage.body.web.pages).toEqual([{ key: '/dashboard/sermons', count: 2 }])
  })

  it('shows staff a per-church view, and hides all of it from everyone else', async () => {
    const list = await as(staff.accessToken, 'get', '/v1/admin/usage/churches').expect(200)
    expect(list.body.items[0]).toMatchObject({ name: 'Grace Church', installs: 1, lastActive: today() })

    const detail = await as(staff.accessToken, 'get', `/v1/admin/usage/churches/${church.orgId}?days=7`).expect(200)
    expect(detail.body.installs).toHaveLength(1)
    expect(detail.body.installs[0].system).toMatchObject({ os: 'darwin', appVersion: '1.0.6' })
    expect(detail.body.installs[0].system).not.toHaveProperty('hostname')

    const churches = await as(staff.accessToken, 'get', '/v1/admin/churches?q=grace').expect(200)
    expect(churches.body.items[0]).toMatchObject({ lastActive: today(), appVersion: '1.0.6' })

    for (const path of ['/v1/admin/usage', '/v1/admin/usage/churches', `/v1/admin/usage/churches/${church.orgId}`]) {
      await as(church.accessToken, 'get', path).expect(404)
    }
  })
})

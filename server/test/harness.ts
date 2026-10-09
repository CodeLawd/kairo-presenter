import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { AppModule } from '../src/app.module'
import { MailService } from '../src/mail/mail.service'
import { SermonSummaryService, SummaryError } from '../src/sermons/sermon-summary.service'
import { configureApp } from '../src/configure-app'

export interface SentMail {
  to: string
  kind: 'welcome' | 'password-reset'
  url: string
  /** Only on a welcome email — the six-digit confirmation code. */
  code?: string
}

/**
 * Stands in for Brevo. Recording what was "sent" lets a test pull the
 * confirmation link out of the email exactly the way a person would, rather
 * than reaching into the database for a token that is stored hashed anyway.
 */
export class FakeMailer {
  readonly sent: SentMail[] = []

  async sendWelcome(
    to: string,
    _firstName: string,
    confirmation: { code: string; url: string },
  ): Promise<void> {
    this.sent.push({ to, kind: 'welcome', url: confirmation.url, code: confirmation.code })
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    this.sent.push({ to, kind: 'password-reset', url: resetUrl })
  }

  get enabled(): boolean {
    return true
  }

  /** The most recent link sent to `to`, or null. */
  lastUrl(to: string, kind: SentMail['kind'] = 'welcome'): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const mail = this.sent[i]
      if (mail.to === to && mail.kind === kind) return mail.url
    }
    return null
  }

  /** The six-digit code from the most recent welcome email. */
  lastCode(to: string): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const mail = this.sent[i]
      if (mail.to === to && mail.kind === 'welcome') return mail.code ?? null
    }
    return null
  }

  /** The token out of that link — what the person's browser would send back. */
  lastToken(to: string, kind: SentMail['kind'] = 'welcome'): string | null {
    const url = this.lastUrl(to, kind)
    return url ? (new URL(url).searchParams.get('token') ?? null) : null
  }
}

export interface TestContext {
  app: INestApplication
  mailer: FakeMailer
  summaries: FakeSummaries
  close: () => Promise<void>
}

/**
 * Boots the real application against an in-memory Mongo.
 *
 * Deliberately the real module graph — guards, pipes, argon2 and all — because
 * the things worth testing here (org scoping, token rotation, refresh reuse)
 * only exist as the interaction between those pieces. A test with the guards
 * mocked out would pass while the API leaked another church's data.
 */
export async function createTestApp(options: { google?: boolean } = {}): Promise<TestContext> {
  const mongo = await MongoMemoryServer.create()
  process.env.MONGO_URL = mongo.getUri('proautomate-test')
  process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32'
  process.env.VAULT_ENCRYPTION_KEY = 'test-vault-key-that-is-long-enough-32b'
  process.env.NODE_ENV = 'test'
  // No SMTP and no Google on purpose: the suite must pass with zero credentials.
  delete process.env.SMTP_URL
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  delete process.env.GOOGLE_CALLBACK_URL
  process.env.PUBLIC_WEB_URL = "http://localhost:3001"
  if (options.google) {
    process.env.GOOGLE_CLIENT_ID = "test-google-client"
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret"
  }

  const mailer = new FakeMailer()
  const summaries = new FakeSummaries()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mailer)
    .overrideProvider(SermonSummaryService)
    .useValue(summaries)
    .compile()
  // The same middleware stack production runs. Sharing it is what keeps a
  // route working in tests for the same reasons it works in production.
  const app = moduleRef.createNestApplication({ bodyParser: false })
  configureApp(app)
  await app.init()

  return {
    app,
    mailer,
    summaries,
    close: async () => {
      await app.close()
      await mongo.stop()
    },
  }
}

/**
 * Stands in for the model.
 *
 * Always installed, never optional: a suite that reached the real provider
 * would spend a church's money on every run and fail with no key configured.
 * Tests drive it by setting `nextError` or `summary`.
 */
export class FakeSummaries {
  calls: { orgId: string; transcriptText: string }[] = []
  nextError: SummaryError | null = null
  /** Stand in for the seconds a real model takes, when a test needs to observe `pending`. */
  delayMs = 0
  summary = {
    headline: 'No Condemnation',
    bigIdea: 'A compact but self-contained explanation of what was taught.',
    keyPoints: [{ title: 'The verdict is in', explanation: 'It is not a feeling.' }],
    memorableQuotes: [],
    takeaways: ['Name one thing you are still condemning yourself for.'],
    keyScriptures: [{ reference: 'Romans 8:1', connection: 'The anchor text.' }],
    callToAction: 'Live like the verdict is in.',
  }

  async generate(input: { orgId: string; transcriptText: string }): Promise<unknown> {
    this.calls.push({ orgId: input.orgId, transcriptText: input.transcriptText })
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    if (this.nextError) {
      const error = this.nextError
      this.nextError = null
      throw error
    }
    return { summary: this.summary, model: 'fake-model' }
  }
}

/** Desktop clients get tokens in the body; the suite mostly speaks desktop. */
export const DESKTOP = { 'x-pa-client': 'desktop' } as const

/**
 * Signs up and confirms the address, returning a session that can actually do
 * something. Most suites want an ordinary, fully set-up account — not the
 * halfway state a bare signup leaves behind.
 */
export async function signUpVerified(
  context: TestContext,
  input: { email: string; password?: string; name?: string; orgName?: string },
): Promise<{ accessToken: string; refreshToken: string; orgId: string }> {
  const request = (await import('supertest')).default
  const server = context.app.getHttpServer()
  const password = input.password ?? 'a-long-enough-password'

  const { body } = await request(server)
    .post('/v1/auth/signup')
    .set(DESKTOP)
    .send({
      orgName: 'Test Church',
      ...input,
      password,
      name: input.name ?? 'Operator',
    })
    .expect(201)

  const token = context.mailer.lastToken(input.email)
  if (!token) throw new Error(`No verification email was sent to ${input.email}`)
  await request(server).post('/v1/auth/verify-email').send({ token }).expect(200)

  // Rotate so the new token carries the confirmed flag.
  const refreshed = await request(server)
    .post('/v1/auth/refresh')
    .set(DESKTOP)
    .send({ refreshToken: body.refreshToken })
    .expect(200)

  return {
    accessToken: refreshed.body.accessToken,
    refreshToken: refreshed.body.refreshToken,
    orgId: body.org.id,
  }
}

/**
 * Sign up and return a usable desktop session. Most suites need an account
 * before they can test anything else.
 */
export interface TestAccount {
  accessToken: string
  refreshToken: string
  userId: string
  orgId: string
  email: string
}

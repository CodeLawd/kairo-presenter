import { ConfigError, loadConfig } from './env'

const BASE = {
  JWT_SECRET: 'x'.repeat(48),
  MONGO_URL: 'mongodb://localhost:27018/test',
  VAULT_ENCRYPTION_KEY: 'y'.repeat(48),
}

describe('loadConfig', () => {
  it('refuses to boot without the secrets it cannot invent', () => {
    expect(() => loadConfig({ MONGO_URL: BASE.MONGO_URL })).toThrow(ConfigError)
    expect(() => loadConfig({ JWT_SECRET: BASE.JWT_SECRET })).toThrow(/MONGO_URL/)
  })

  it('rejects a weak signing secret in production only', () => {
    const weak = { ...BASE, JWT_SECRET: 'short', NODE_ENV: 'production' }
    expect(() => loadConfig(weak)).toThrow(/at least 32/)
    // Development must stay frictionless — a dev secret is not a production risk.
    expect(loadConfig({ ...weak, NODE_ENV: 'development' }).jwtSecret).toBe('short')
  })

  it('refuses to boot without VAULT_ENCRYPTION_KEY', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: BASE.JWT_SECRET, MONGO_URL: BASE.MONGO_URL }),
    ).toThrow(/VAULT_ENCRYPTION_KEY/)
  })

  it('rejects a weak vault key in production only', () => {
    const weak = { ...BASE, VAULT_ENCRYPTION_KEY: 'short', NODE_ENV: 'production', PUBLIC_WEB_URL: 'https://kairo.test' }
    expect(() => loadConfig(weak)).toThrow(/VAULT_ENCRYPTION_KEY must be at least 32/)
    expect(loadConfig({ ...weak, NODE_ENV: 'development' }).vaultEncryptionKey).toBe('short')
  })

  it('requires the website address in production only', () => {
    // A localhost fallback in production broke Google sign-in with an error
    // that blamed GOOGLE_CALLBACK_URL instead of the missing address.
    const prod = { ...BASE, NODE_ENV: 'production' }
    expect(() => loadConfig(prod)).toThrow(/PUBLIC_WEB_URL is required/)
    expect(loadConfig({ ...prod, PUBLIC_WEB_URL: 'https://kairo.test/' }).publicWebUrl).toBe('https://kairo.test')
    expect(loadConfig(BASE).publicWebUrl).toBe('http://localhost:3001')
  })

  it('treats unset Google and Brevo as features that are off, not as errors', () => {
    const config = loadConfig(BASE)
    expect(config.google).toBeNull()
    expect(config.mail).toBeNull()
  })

  it('needs BOTH halves of the Google credential before enabling it', () => {
    expect(loadConfig({ ...BASE, GOOGLE_CLIENT_ID: 'id' }).google).toBeNull()
    const both = loadConfig({ ...BASE, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
    expect(both.google).toMatchObject({ clientId: 'id', clientSecret: 'secret' })
  })

  it('returns Google through the website proxy so cookies stay first-party', () => {
    const config = loadConfig({ ...BASE, PUBLIC_WEB_URL: 'https://kairo.test/', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
    expect(config.google?.callbackUrl).toBe('https://kairo.test/v1/auth/google/callback')
  })

  it('rejects a Google callback on the API origin instead of the website', () => {
    expect(() => loadConfig({ ...BASE, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_CALLBACK_URL: 'http://localhost:3000/v1/auth/google/callback' })).toThrow(/GOOGLE_CALLBACK_URL/)
  })

  it('refuses to boot with a Brevo key but no sender address', () => {
    // A default sender would be an address Brevo has not verified, so every
    // send would be rejected by the provider and nobody would find out until a
    // user asked why no email arrived.
    expect(() => loadConfig({ ...BASE, BREVO_API_KEY: 'xkeysib-test' })).toThrow(
      /BREVO_SENDER_EMAIL/,
    )
  })

  it('enables Brevo once the key and a verified sender are both present', () => {
    const config = loadConfig({
      ...BASE,
      BREVO_API_KEY: 'xkeysib-test',
      BREVO_SENDER_EMAIL: 'hello@church.test',
    })
    expect(config.mail).toEqual({
      apiKey: 'xkeysib-test',
      fromEmail: 'hello@church.test',
      fromName: 'Kairo',
    })
  })

  it('reads a comma-separated CORS allowlist', () => {
    const config = loadConfig({ ...BASE, WEB_ORIGIN: 'https://app.test, https://admin.test ' })
    expect(config.webOrigins).toEqual(['https://app.test', 'https://admin.test'])
  })

  it('defaults recap thinking to low rather than the providers own high', () => {
    expect(loadConfig(BASE).sermons.reasoningEffort).toBe('low')
  })

  it('accepts a recap effort level in any casing', () => {
    const config = loadConfig({ ...BASE, SERMON_REASONING_EFFORT: ' HIGH ' })
    expect(config.sermons.reasoningEffort).toBe('high')
  })

  it('refuses an unknown recap effort instead of silently restoring the default', () => {
    expect(() => loadConfig({ ...BASE, SERMON_REASONING_EFFORT: 'medium-ish' })).toThrow(
      /SERMON_REASONING_EFFORT/,
    )
  })
})

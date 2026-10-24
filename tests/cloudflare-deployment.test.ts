import assert from 'node:assert/strict'
import test from 'node:test'
import { containerEnvironment } from '../server/cloudflare/environment'

test('container receives production config and explicitly allowed secrets only', () => {
  const env = containerEnvironment({ MONGO_URL: 'mongodb://example/db', JWT_SECRET: 'jwt', VAULT_ENCRYPTION_KEY: 'vault', BREVO_API_KEY: 'mail', CLOUDFLARE_API_TOKEN: 'never-forward' })
  assert.equal(env.NODE_ENV, 'production')
  assert.equal(env.PORT, '3000')
  assert.equal(env.PUBLIC_WEB_URL, 'https://kairopresenter.com')
  assert.equal(env.MONGO_URL, 'mongodb://example/db')
  assert.equal(env.BREVO_API_KEY, 'mail')
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined)
  assert.equal(env.GOOGLE_CLIENT_SECRET, undefined)
})

test('missing startup secrets fail without logging secret values', () => {
  assert.throws(() => containerEnvironment({ JWT_SECRET: 'do-not-log' }), /Missing API container secrets: MONGO_URL, VAULT_ENCRYPTION_KEY/)
})

test('container keeps optional integration and model overrides', () => {
  const env = containerEnvironment({ MONGO_URL: 'mongo', JWT_SECRET: 'jwt', VAULT_ENCRYPTION_KEY: 'vault', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', SERMON_MODEL: 'model', WEB_ORIGIN: 'https://kairopresenter.com' })
  assert.equal(env.GOOGLE_CLIENT_SECRET, 'secret')
  assert.equal(env.SERMON_MODEL, 'model')
})

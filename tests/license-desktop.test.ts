import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { validLicenseLease } from '../src/main/services/cloud/license-verifier'
import { LicensingService } from '../src/main/services/cloud/license-service'
import { managedPayload } from '../src/main/services/cloud/managed'
import type { LicenseSnapshot, SignedLicenseLease } from '../src/lib/cloud/licensing'
import type { SessionSnapshot } from '../src/lib/cloud/contracts'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const now = Math.floor(Date.now() / 1000)
function lease(overrides: Partial<SignedLicenseLease['claims']> = {}): SignedLicenseLease {
  const claims: SignedLicenseLease['claims'] = { orgId: 'church', deviceId: 'booth', features: ['presentation', 'transcription', 'scripture', 'summaries', 'translation', 'webSearch'], issuedAt: now - 10, refreshAfter: now + 86400, expiresAt: now + 14 * 86400 - 10, licenseExpiresAt: null, ...overrides }
  return { claims, signature: sign(null, Buffer.from(JSON.stringify(claims)), keys.privateKey).toString('base64'), publicKey }
}
function snapshot(signedLease = lease()): LicenseSnapshot {
  return { activated: true, lease: signedLease, providers: { deepgram: true, bible: true, anthropic: true, deepseek: true, brave: true, googleTranslate: true }, license: { orgId: 'church', status: 'active', expiresAt: null, features: signedLease.claims.features, maxDevices: 3, maxTranscriptionSessions: 1, transcriptionMinutes: 600, managedRequests: 5000, devices: [], usage: { period: '2026-10', transcriptionMinutes: 0, managedRequests: 0 } } }
}
test('signed lease binds church, device, feature and trusted key; rejects tampering and expiry', () => {
  const signed = lease()
  assert.equal(validLicenseLease(signed, publicKey, 'church', 'booth', 'transcription', now), true)
  assert.equal(validLicenseLease(signed, publicKey, 'other', 'booth', undefined, now), false)
  assert.equal(validLicenseLease(signed, publicKey, 'church', 'other', undefined, now), false)
  assert.equal(validLicenseLease({ ...signed, claims: { ...signed.claims, features: [] } }, publicKey, 'church', 'booth', undefined, now), false)
  assert.equal(validLicenseLease(signed, null, 'church', 'booth', undefined, now), false)
  assert.equal(validLicenseLease(lease({ features: ['presentation'] }), publicKey, 'church', 'booth', 'transcription', now), false)
  assert.equal(validLicenseLease(lease({ expiresAt: now }), publicKey, 'church', 'booth', undefined, now), false)
  assert.equal(validLicenseLease(lease({ licenseExpiresAt: now + 5 }), publicKey, 'church', 'booth', undefined, now), false)
  assert.equal(validLicenseLease(lease({ expiresAt: now + 15 * 86400 }), publicKey, 'church', 'booth', undefined, now), false)
})
function fixture() {
  const disk = new Map<string, string>()
  const requests: { method: string; path: string; body: unknown }[] = []
  let response = snapshot()
  let error = false
  let pending: Promise<LicenseSnapshot> | null = null
  let sessionListener: ((session: SessionSnapshot) => void) | undefined
  const session = { state: 'active', org: { id: 'church' } } as SessionSnapshot
  const service = new LicensingService({
    getSession: () => session, getDeviceId: () => 'booth',
    onSessionChange: listener => { sessionListener = listener; return () => undefined },
    managedRequest: async <T>(method: 'get' | 'post' | 'delete', path: string, body?: unknown): Promise<T> => {
      requests.push({ method, path, body }); if (error) throw new Error('Offline'); return (pending ? await pending : response) as T
    },
  }, { read: key => disk.get(key) ?? null, write: (key, value) => { disk.set(key, value); return true }, clear: key => { disk.delete(key) } })
  return { service, disk, requests, session, changed: (value: SessionSnapshot) => { Object.assign(session, value); sessionListener?.(value) }, defer: (value: Promise<LicenseSnapshot>) => { pending = value }, setResponse: (value: LicenseSnapshot) => { response = value }, offline: () => { error = true } }
}
test('activation securely pins authenticated key and caches lease; offline failure preserves active output entitlement', async () => {
  const f = fixture()
  f.service.start()
  assert.throws(() => f.service.assertFeature('transcription'), /Activate/)
  await f.service.activate(' key ', 'Booth')
  assert.deepEqual(f.requests[0], { method: 'post', path: '/v1/licensing/activate', body: { key: 'key', name: 'Booth' } })
  assert.equal(f.disk.get('license-trusted-key'), publicKey)
  assert.equal(f.service.getStatus().activated, true)
  f.offline()
  await assert.rejects(f.service.refresh(), /Offline/)
  assert.equal(f.service.getStatus().activated, true)
  f.service.assertFeature('transcription')
  f.changed({ ...f.session, state: 'signed-out' })
  assert.equal(f.service.getStatus().activated, false)
  assert.equal(f.disk.has('license-snapshot'), false)
})
test('activation rejects altered leases and signed leases for a different device without pinning them', async () => {
  const f = fixture()
  f.setResponse(snapshot(lease({ deviceId: 'other' })))
  await assert.rejects(f.service.activate('key'), /verified/)
  assert.equal(f.disk.has('license-trusted-key'), false)
  assert.equal(f.service.getStatus().activated, false)
})
test('managed provider payloads keep dedicated routes valid and carry LLM purpose', () => {
  for (const provider of ['bible', 'brave', 'googleTranslate'] as const) assert.equal('purpose' in managedPayload(provider, '/route', {}, undefined, 'translation'), false)
  assert.equal(managedPayload('anthropic', '/v1/messages', {}, undefined, 'summaries').purpose, 'summaries')
  assert.equal(managedPayload('deepseek', '/chat/completions', {}).purpose, 'scripture')
  assert.equal(managedPayload('deepseek', '/v1/tools/search', {}, undefined, 'webSearch').purpose, 'webSearch')
})
test('signout and church switching discard pending activation responses', async () => {
  for (const change of ['signout', 'church'] as const) {
    const f = fixture()
    f.service.start()
    await f.service.activate('key')
    let resolve!: (value: LicenseSnapshot) => void
    f.defer(new Promise(r => { resolve = r }))
    const pending = f.service.refresh()
    f.changed(change === 'signout' ? { ...f.session, state: 'signed-out', org: null } : { ...f.session, org: { ...f.session.org!, id: 'other' } })
    resolve(snapshot())
    await assert.rejects(pending, /account changed/)
    assert.equal(f.service.getStatus().activated, false)
    if (change === 'signout') assert.equal(f.disk.has('license-snapshot'), false)
  }
})
test('offline clock rollback beyond tolerance invalidates entitlement', async () => {
  const f = fixture()
  await f.service.activate('key')
  f.disk.set('license-observed-time', String(Math.floor(Date.now() / 1000) + 3600))
  f.service.start()
  assert.equal(f.service.getStatus().activated, false)
  assert.throws(() => f.service.assertFeature('transcription'), /Activate/)
})

test('cached leases must verify against the separately stored pin, including after restart', async () => {
  const f = fixture()
  await f.service.activate('key')
  const attacker = generateKeyPairSync('ed25519')
  const forged = lease()
  forged.claims.features = ['transcription']
  forged.publicKey = attacker.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  forged.signature = sign(null, Buffer.from(JSON.stringify(forged.claims)), attacker.privateKey).toString('base64')
  f.disk.set('license-snapshot', JSON.stringify(snapshot(forged)))
  f.service.start()
  assert.equal(f.service.getStatus().activated, false)
})

test('managed requests require activation and the feature associated with their purpose', async () => {
  const f = fixture()
  const request = managedPayload('deepseek', '/chat/completions', { model: 'deepseek-flash', messages: [] }, undefined, 'translation')
  await assert.rejects(f.service.request(request), /Activate/)
  assert.equal(f.requests.length, 0)
  await f.service.activate('key')
  await f.service.request(request)
  assert.deepEqual(f.requests.at(-1), { method: 'post', path: '/v1/managed/request', body: request })
  f.setResponse(snapshot(lease({ features: ['scripture'] })))
  await f.service.refresh()
  const count = f.requests.length
  await assert.rejects(f.service.request(request), /Activate/)
  assert.equal(f.requests.length, count)
})

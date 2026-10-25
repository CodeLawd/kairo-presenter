import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { InjectConnection } from '@nestjs/mongoose'
import { Connection, Types } from 'mongoose'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import type { AdminChurchLicense, ChurchLicense, LicenseActivationKey, LicensePolicy, LicenseSnapshot, LicenseUpdate, ManagedProviderPatch, ManagedProviderStatus, ManagedRequest, TranscriptionGrant, LicensedFeature } from '@contracts/licensing'
import type { RequestUser } from '../common/decorators/current-user.decorator'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { decryptJson, encryptJson, vaultKeyFromSecret } from '../orgs/vault-crypto'
import { FEATURES, leaseTimes, validateManagedRequest } from './managed-policy'

const DEFAULT_POLICY: LicensePolicy = { freeIssuanceEnabled: true, defaultMaxDevices: 3, defaultMaxTranscriptionSessions: 1, defaultTranscriptionMinutes: 600, defaultManagedRequests: 5000, offlineGraceDays: 14 }
const PROVIDERS = ['deepgram', 'bible', 'anthropic', 'deepseek', 'brave', 'googleTranslate'] as const
interface SecretConfig { privateKey: string; publicKey: string; providers: Record<string, string> }
interface KeyRow { hash: string; createdAt?: string; sealed?: { ciphertext: string; iv: string; authTag: string } }
interface LicenseRow extends ChurchLicense { key?: KeyRow | null; keyRevokedAt?: string; sessions: { id: string; deviceId: string; until: number; nextRenew: number }[] }
const period = () => new Date().toISOString().slice(0, 7)
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const active = () => ({ status: 'active' as const, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date().toISOString() } }] })

@Injectable()
export class LicensingService {
  private readonly key: Buffer
  constructor(@InjectConnection() private readonly db: Connection, @Inject(APP_CONFIG) config: AppConfig) { this.key = vaultKeyFromSecret(config.vaultEncryptionKey) }
  private get licenses() { return this.db.collection<LicenseRow>('church_licenses') }
  private get configs() { return this.db.collection('licensing_config') }
  private async audit(actor: string, action: string, orgId?: string) { await this.db.collection('licensing_audit').insertOne({ actor, action, ...(orgId ? { orgId } : {}), at: new Date() }) }
  async config() {
    let doc = await this.configs.findOne({ name: 'global' })
    if (!doc) {
      await this.configs.createIndex({ name: 1 }, { unique: true })
      const pair = generateKeyPairSync('ed25519')
      const secrets: SecretConfig = { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), providers: {} }
      try { const created = await this.configs.updateOne({ name: 'global' }, { $setOnInsert: { name: 'global', policy: DEFAULT_POLICY, envelope: encryptJson(this.key, secrets), updatedAt: null } }, { upsert: true }); if (created.upsertedCount) await this.audit('system', 'config.initialized') }
      catch (e) { if ((e as { code?: number }).code !== 11000) throw e }
      doc = await this.configs.findOne({ name: 'global' })
    }
    if (!doc) throw new ServiceUnavailableException('Licensing configuration unavailable')
    return { doc, secrets: decryptJson<SecretConfig>(this.key, doc.envelope) }
  }
  async policy(): Promise<LicensePolicy> { return (await this.config()).doc.policy }
  async updatePolicy(actor: string, patch: Partial<LicensePolicy>): Promise<LicensePolicy> {
    this.validateNumbers(patch as unknown as Record<string, unknown>, { defaultMaxDevices: [1, 100], defaultMaxTranscriptionSessions: [1, 20], defaultTranscriptionMinutes: [0, 100000], defaultManagedRequests: [0, 1000000], offlineGraceDays: [1, 14] }, ['freeIssuanceEnabled'])
    if (patch.freeIssuanceEnabled !== undefined && typeof patch.freeIssuanceEnabled !== 'boolean') throw new BadRequestException('Invalid issuance policy')
    await this.config()
    await this.configs.updateOne({ name: 'global' }, { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => ['policy.' + k, v])) })
    await this.audit(actor, 'policy.updated'); return this.policy()
  }
  async providerStatus(): Promise<ManagedProviderStatus> {
    const { doc, secrets } = await this.config()
    const key = (p: string) => secrets.providers[p + 'ApiKey'] ?? ''
    // A four-character tail lets staff recognise a saved key without exposing it; short keys reveal nothing.
    return { configured: Object.fromEntries(PROVIDERS.map(p => [p, !!key(p)])) as LicenseSnapshot['providers'], hints: Object.fromEntries(PROVIDERS.map(p => [p, key(p).length >= 16 ? key(p).slice(-4) : ''])) as ManagedProviderStatus['hints'], updatedAt: doc.updatedAt }
  }
  async updateProviders(actor: string, patch: ManagedProviderPatch): Promise<ManagedProviderStatus> {
    const allowed = PROVIDERS.map(p => p + 'ApiKey')
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([k, v]) => !allowed.includes(k) || (v !== null && (typeof v !== 'string' || v.length > 4096)))) throw new BadRequestException('Invalid provider configuration')
    // Compare-and-swap the encrypted envelope so simultaneous staff writes do not lose changes.
    for (let i = 0; i < 10; i++) {
      const { doc, secrets } = await this.config()
      for (const [k, v] of Object.entries(patch)) secrets.providers[k] = v?.trim() ?? ''
      const result = await this.configs.updateOne({ name: 'global', 'envelope.ciphertext': doc.envelope.ciphertext }, { $set: { envelope: encryptJson(this.key, secrets), updatedAt: new Date().toISOString() } })
      if (result.modifiedCount) { await this.audit(actor, 'providers.updated'); return this.providerStatus() }
    }
    throw new ServiceUnavailableException('Provider configuration changed; retry')
  }
  async member(user: RequestUser, admin = false) {
    if (!Types.ObjectId.isValid(user.orgId) || !Types.ObjectId.isValid(user.sub) || !user.deviceId || user.deviceId.length > 200) throw new ForbiddenException('Valid church and device required')
    const m = await this.db.collection('memberships').findOne({ orgId: new Types.ObjectId(user.orgId), userId: new Types.ObjectId(user.sub), status: 'active' })
    if (!m) throw new ForbiddenException('Active church membership required')
    if (admin && !['owner', 'admin'].includes(m.role)) throw new ForbiddenException('Only a church owner or admin can do this')
  }
  private async row(orgId: string) { return this.licenses.findOne({ orgId }) }
  private publicLicense(row: LicenseRow): ChurchLicense {
    const { orgId, status, expiresAt, features, maxDevices, maxTranscriptionSessions, transcriptionMinutes, managedRequests, devices, usage } = row
    return { orgId, status, expiresAt, features, maxDevices, maxTranscriptionSessions, transcriptionMinutes, managedRequests, devices, usage: usage.period === period() ? usage : { period: period(), transcriptionMinutes: 0, managedRequests: 0 } }
  }
  async snapshot(user: RequestUser): Promise<LicenseSnapshot> {
    await this.member(user)
    const row = await this.row(user.orgId)
    const providers = (await this.providerStatus()).configured
    const activated = !!row && row.status === 'active' && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()) && row.devices.some(d => d.deviceId === user.deviceId)
    if (!row || !activated) return { license: row ? this.publicLicense(row) : null, activated: false, lease: null, providers }
    const { secrets, doc } = await this.config()
    const claims = { orgId: user.orgId, deviceId: user.deviceId, features: row.features, ...leaseTimes(Math.floor(Date.now() / 1000), row.expiresAt ? Math.floor(Date.parse(row.expiresAt) / 1000) : null, doc.policy.offlineGraceDays) }
    await this.licenses.updateOne({ orgId: user.orgId, 'devices.deviceId': user.deviceId }, { $set: { 'devices.$.lastSeenAt': new Date().toISOString() } })
    return { license: this.publicLicense(row), activated: true, providers, lease: { claims, signature: sign(null, Buffer.from(JSON.stringify(claims)), secrets.privateKey).toString('base64'), publicKey: secrets.publicKey } }
  }
  /** The church's single activation key, readable again by its owners and admins. */
  async getKey(user: RequestUser): Promise<LicenseActivationKey | null> {
    await this.member(user, true)
    const row = await this.row(user.orgId)
    if (row?.key?.sealed) return this.readKey(row.key)
    // A licence created before keys were stored gets one on first view. A
    // revoked key stays revoked until someone explicitly creates a replacement.
    if (row && !row.keyRevokedAt && row.status === 'active' && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now())) return this.issueKey(user)
    return null
  }
  /** Issues the church's activation key, or returns the one it already has. */
  async issueKey(user: RequestUser): Promise<LicenseActivationKey> {
    await this.member(user, true)
    const policy = await this.policy()
    let row = await this.row(user.orgId)
    if (!row) {
      if (!policy.freeIssuanceEnabled) throw new ForbiddenException('Self-service licences are disabled; contact Kairo')
      await this.licenses.createIndex({ orgId: 1 }, { unique: true })
      const initial: LicenseRow = { orgId: user.orgId, status: 'active', expiresAt: null, features: FEATURES, maxDevices: policy.defaultMaxDevices, maxTranscriptionSessions: policy.defaultMaxTranscriptionSessions, transcriptionMinutes: policy.defaultTranscriptionMinutes, managedRequests: policy.defaultManagedRequests, devices: [], usage: { period: period(), managedRequests: 0, transcriptionMinutes: 0 }, key: null, sessions: [] }
      try { await this.licenses.updateOne({ orgId: user.orgId }, { $setOnInsert: initial }, { upsert: true }) } catch (e) { if ((e as { code?: number }).code !== 11000) throw e }
      await this.audit(user.sub, 'license.issued', user.orgId)
      row = await this.row(user.orgId)
    }
    if (!row || row.status !== 'active' || (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())) throw new ForbiddenException('Licence is inactive')
    if (row.key?.sealed) return this.readKey(row.key)
    const key = randomBytes(24).toString('hex'), createdAt = new Date().toISOString()
    // Only the first writer wins, so two tabs cannot rotate the church key by accident.
    const stored = await this.licenses.findOneAndUpdate({ orgId: user.orgId, ...active(), key: null }, { $set: { key: { hash: hash(key), createdAt, sealed: encryptJson(this.key, { key }) } }, $unset: { keyRevokedAt: '' } }, { returnDocument: 'after' })
    if (!stored) {
      const current = await this.row(user.orgId)
      if (current?.key?.sealed) return this.readKey(current.key)
      throw new ForbiddenException('Licence is inactive')
    }
    await this.audit(user.sub, 'activation-key.issued', user.orgId)
    return { id: hash(key).slice(0, 16), key, createdAt }
  }
  async revokeKey(user: RequestUser) {
    await this.member(user, true)
    // The timestamp stops a later page view from silently creating a new key.
    await this.licenses.updateOne({ orgId: user.orgId }, { $set: { keyRevokedAt: new Date().toISOString() }, $unset: { key: '' } })
    await this.audit(user.sub, 'activation-key.revoked', user.orgId)
    return null
  }
  private readKey(row: KeyRow): LicenseActivationKey {
    if (!row.sealed) throw new ServiceUnavailableException('Activation key unavailable')
    return { id: row.hash.slice(0, 16), key: decryptJson<{ key: string }>(this.key, row.sealed).key, createdAt: row.createdAt ?? null }
  }
  async activate(user: RequestUser, key: string, name: string) {
    await this.member(user)
    if (typeof key !== 'string' || !/^[a-f0-9]{48}$/.test(key) || typeof name !== 'string' || !name.trim() || name.length > 160) throw new BadRequestException('Valid activation key and device name required')
    const now = new Date().toISOString(), hashed = hash(key)
    const result = await this.licenses.findOneAndUpdate({ orgId: user.orgId, ...active(), 'key.hash': hashed, $expr: { $or: [{ $in: [{ $literal: user.deviceId }, '$devices.deviceId'] }, { $lt: [{ $size: '$devices' }, '$maxDevices'] }] } }, [{ $set: {
      devices: { $concatArrays: [{ $filter: { input: '$devices', as: 'd', cond: { $ne: ['$$d.deviceId', { $literal: user.deviceId }] } } }, { $literal: [{ deviceId: user.deviceId, name: name.trim(), activatedAt: now, lastSeenAt: now }] }] },
    } }], { returnDocument: 'after' })
    if (!result) throw new ForbiddenException('Activation key invalid or device limit reached')
    await this.audit(user.sub, 'device.activated', user.orgId); return this.snapshot(user)
  }
  async deactivate(user: RequestUser, deviceId: string) {
    await this.member(user, true)
    await this.licenses.updateOne({ orgId: user.orgId }, { $pull: { devices: { deviceId }, sessions: { deviceId } } })
    await this.audit(user.sub, 'device.deactivated', user.orgId); return this.snapshot(user)
  }
  async list(): Promise<AdminChurchLicense[]> {
    const rows = await this.licenses.find({}).limit(10000).toArray()
    const orgs = await this.db.collection('organizations').find({ _id: { $in: rows.map(r => new Types.ObjectId(r.orgId)) } }, { projection: { name: 1, ownerUserId: 1, createdAt: 1 } }).toArray()
    const owners = await this.db.collection('users').find({ _id: { $in: orgs.map(o => o.ownerUserId).filter(Boolean) } }, { projection: { email: 1 } }).toArray()
    const emails = new Map(owners.map(u => [String(u._id), String(u.email ?? '')]))
    const byId = new Map(orgs.map(o => [String(o._id), o]))
    return rows.map(r => {
      const o = byId.get(r.orgId)
      const orgName = String(o?.name ?? '')
      return { orgId: r.orgId, orgName, ownerEmail: o ? emails.get(String(o.ownerUserId)) ?? '' : '', createdAt: o?.createdAt ? new Date(o.createdAt).toISOString() : null, license: { ...this.publicLicense(r), orgName } }
    })
  }
  private validateNumbers(patch: Record<string, unknown>, ranges: Record<string, number[]>, extra: string[] = []) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequestException('Invalid configuration')
    for (const [k, v] of Object.entries(patch)) { const range = ranges[k]; if (!range && !extra.includes(k)) throw new BadRequestException('Unknown setting: ' + k); if (range && (!Number.isInteger(v) || Number(v) < range[0] || Number(v) > range[1])) throw new BadRequestException('Invalid setting: ' + k) }
  }
  async updateLicense(actor: string, orgId: string, patch: LicenseUpdate): Promise<ChurchLicense> {
    if (!Types.ObjectId.isValid(orgId)) throw new BadRequestException('Invalid church')
    this.validateNumbers(patch as Record<string, unknown>, { maxDevices: [1, 100], maxTranscriptionSessions: [1, 20], transcriptionMinutes: [0, 100000], managedRequests: [0, 1000000] }, ['status', 'expiresAt', 'features'])
    if (patch.status !== undefined && !['active', 'suspended', 'revoked'].includes(patch.status)) throw new BadRequestException('Invalid status')
    if (patch.features !== undefined && (!Array.isArray(patch.features) || patch.features.some(f => !FEATURES.includes(f)) || new Set(patch.features).size !== patch.features.length)) throw new BadRequestException('Invalid features')
    if (patch.expiresAt !== undefined && patch.expiresAt !== null) { if (typeof patch.expiresAt !== 'string' || !Number.isFinite(Date.parse(patch.expiresAt))) throw new BadRequestException('Invalid expiry'); patch.expiresAt = new Date(patch.expiresAt).toISOString() }
    if (!await this.row(orgId)) {
      if (!await this.db.collection('organizations').findOne({ _id: new Types.ObjectId(orgId) })) throw new BadRequestException('Church does not exist')
      const policy = await this.policy()
      await this.licenses.createIndex({ orgId: 1 }, { unique: true })
      const initial: LicenseRow = { orgId, status: 'active', expiresAt: null, features: FEATURES, maxDevices: policy.defaultMaxDevices, maxTranscriptionSessions: policy.defaultMaxTranscriptionSessions, transcriptionMinutes: policy.defaultTranscriptionMinutes, managedRequests: policy.defaultManagedRequests, devices: [], usage: { period: period(), managedRequests: 0, transcriptionMinutes: 0 }, key: null, sessions: [] }
      try { await this.licenses.updateOne({ orgId }, { $setOnInsert: initial }, { upsert: true }) } catch (e) { if ((e as { code?: number }).code !== 11000) throw e }
    }
    const result = await this.licenses.findOneAndUpdate({ orgId }, { $set: patch }, { returnDocument: 'after' })
    if (!result) throw new BadRequestException('Church has no licence')
    await this.audit(actor, 'license.updated', orgId); return this.publicLicense(result)
  }
  private async resetPeriod(orgId: string) { await this.licenses.updateOne({ orgId, 'usage.period': { $ne: period() } }, { $set: { usage: { period: period(), transcriptionMinutes: 0, managedRequests: 0 } } }) }
  async reserve(user: RequestUser, feature: LicensedFeature, requests = 1) { return this.reserveBudget(user, feature, requests, true) }
  private async reserveBudget(user: RequestUser, feature: LicensedFeature, requests: number, requireDevice: boolean) {
    await this.member(user); await this.resetPeriod(user.orgId)
    const result = await this.licenses.findOneAndUpdate({ orgId: user.orgId, ...active(), features: feature, ...(requireDevice ? { 'devices.deviceId': user.deviceId } : {}), 'usage.period': period(), $expr: { $lte: [{ $add: ['$usage.managedRequests', requests] }, '$managedRequests'] } }, { $inc: { 'usage.managedRequests': requests } }, { returnDocument: 'after' })
    if (!result) throw new ForbiddenException('Activate this device and check licence feature and monthly usage limits')
  }
  async summaryKeys(user: RequestUser) {
    await this.reserveBudget(user, 'summaries', 2, false)
    const { secrets } = await this.config(); return secrets.providers
  }
  async managed(user: RequestUser, request: ManagedRequest): Promise<unknown> {
    const plan = validateManagedRequest(request)
    await this.reserve(user, plan.feature)
    const { secrets } = await this.config(), key = secrets.providers[request.provider + 'ApiKey']
    if (!key) throw new ServiceUnavailableException('Managed provider has not been configured by Kairo')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    switch (request.provider) {
      case 'bible': headers['api-key'] = key; break
      case 'anthropic': headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; break
      case 'brave': headers['X-Subscription-Token'] = key; break
      case 'googleTranslate': headers['X-Goog-Api-Key'] = key; break
      default: headers.Authorization = 'Bearer ' + key
    }
    const response = await fetch(plan.url, { method: request.method, headers, ...(plan.body ? { body: JSON.stringify(plan.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(60000) })
    if (!response.ok) {
      // Preserve Bible access/rate-limit semantics without exposing provider bodies.
      // An upstream credential failure must never look like expired Kairo auth.
      const status = request.provider === 'bible' && response.status >= 400 && response.status < 500
        ? (response.status === 401 ? 403 : response.status)
        : 503
      await response.body?.cancel().catch(() => undefined)
      throw new HttpException('Managed provider request failed (' + response.status + ')', status)
    }
    return response.json()
  }
  async transcription(user: RequestUser): Promise<TranscriptionGrant> {
    await this.member(user); await this.resetPeriod(user.orgId)
    const current = await this.row(user.orgId)
    if (!current || current.status !== 'active' || (current.expiresAt && Date.parse(current.expiresAt) <= Date.now()) || !current.devices.some(d => d.deviceId === user.deviceId) || !current.features.includes('transcription')) throw new ForbiddenException('Activate this device and enable transcription on the licence')
    const { secrets } = await this.config(), key = secrets.providers.deepgramApiKey
    if (!key) throw new ServiceUnavailableException('Transcription provider is not configured')
    const now = Date.now(), id = randomUUID()
    const live = { $filter: { input: '$sessions', as: 's', cond: { $gt: ['$$s.until', now] } } }
    const row = await this.licenses.findOneAndUpdate({ orgId: user.orgId, ...active(), features: 'transcription', 'devices.deviceId': user.deviceId, 'usage.period': period(), $expr: { $and: [{ $lt: [{ $size: live }, '$maxTranscriptionSessions'] }, { $lte: [{ $add: ['$usage.transcriptionMinutes', 2] }, '$transcriptionMinutes'] }] } }, [{ $set: { sessions: { $concatArrays: [live, { $literal: [{ id, deviceId: user.deviceId, until: now + 90000, nextRenew: now + 60000 }] }] }, 'usage.transcriptionMinutes': { $add: ['$usage.transcriptionMinutes', 2] } } }], { returnDocument: 'after' })
    if (!row) throw new ForbiddenException('Transcription session or monthly minute limit reached; check activation')
    try {
      const response = await fetch('https://api.deepgram.com/v1/auth/grant', { method: 'POST', headers: { Authorization: 'Token ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 30 }), redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('grant failed')
      const grant = await response.json() as { access_token?: string; expires_in?: number }
      if (typeof grant.access_token !== 'string' || !grant.access_token) throw new Error('invalid grant')
      return { accessToken: grant.access_token, expiresIn: Math.min(grant.expires_in ?? 30, 30), sessionId: id, renewAfterSeconds: 60 }
    } catch { await this.licenses.updateOne({ orgId: user.orgId }, { $pull: { sessions: { id } } }); throw new ServiceUnavailableException('Transcription grant unavailable') }
  }
  async renew(user: RequestUser, id: string) {
    await this.member(user); await this.resetPeriod(user.orgId)
    const now = Date.now()
    const result = await this.licenses.findOneAndUpdate({ orgId: user.orgId, ...active(), features: 'transcription', 'devices.deviceId': user.deviceId, 'usage.period': period(), sessions: { $elemMatch: { id, deviceId: user.deviceId, until: { $gt: now }, nextRenew: { $lte: now } } }, $expr: { $and: [{ $lte: [{ $add: ['$usage.transcriptionMinutes', 1] }, '$transcriptionMinutes'] }, { $lte: [{ $size: { $filter: { input: '$sessions', as: 's', cond: { $gt: ['$$s.until', now] } } } }, '$maxTranscriptionSessions'] }] } }, { $set: { 'sessions.$.until': now + 90000, 'sessions.$.nextRenew': now + 60000 }, $inc: { 'usage.transcriptionMinutes': 1 } }, { returnDocument: 'after' })
    if (!result) throw new ForbiddenException('Session expired, renewal too early, or licence usage exhausted')
    return { renewAfterSeconds: 60 }
  }
  async release(user: RequestUser, id: string) { await this.member(user); await this.licenses.updateOne({ orgId: user.orgId }, { $pull: { sessions: { id, deviceId: user.deviceId } } }); return { released: true } }
}

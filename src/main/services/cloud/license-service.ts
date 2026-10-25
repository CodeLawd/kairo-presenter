import os from 'node:os'
import type { LicensedFeature, LicenseSnapshot, ManagedRequest, TranscriptionGrant } from '@shared/cloud/licensing'
import type { SessionSnapshot } from '@shared/cloud/contracts'
import type { SecureStore } from './secure-store'
import { validLicenseLease } from './license-verifier'

const EMPTY: LicenseSnapshot = { license: null, activated: false, lease: null, providers: { deepgram: false, bible: false, anthropic: false, deepseek: false, brave: false, googleTranslate: false } }
interface LicenseSession {
  getSession(): SessionSnapshot
  getDeviceId(): string
  onSessionChange(listener: (snapshot: SessionSnapshot) => void): () => void
  managedRequest<T>(method: 'get' | 'post' | 'delete', pathname: string, body?: unknown): Promise<T>
}
export class LicensingService {
  private snapshot: LicenseSnapshot = structuredClone(EMPTY)
  private listeners = new Set<(snapshot: LicenseSnapshot) => void>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<LicenseSnapshot> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private orgId = ''
  private highestTime = 0
  private persistedTime = 0

  constructor(private readonly session: LicenseSession, private readonly vault: Pick<SecureStore, 'read' | 'write' | 'clear'>, private trustedKey: string | null = null) {}

  start(): void {
    this.orgId = this.session.getSession().org?.id || ''
    this.highestTime = Number(this.vault.read('license-observed-time')) || 0
    this.persistedTime = this.highestTime
    this.trustedKey ||= this.vault.read('license-trusted-key')
    try { this.snapshot = JSON.parse(this.vault.read('license-snapshot') || 'null') || structuredClone(EMPTY) } catch { /* discard malformed cache */ }
    this.session.onSessionChange(session => {
      const orgId = session.org?.id || ''
      if (session.state === 'signed-out' || (orgId && orgId !== this.orgId)) { this.generation++; this.inFlight = null }
      if (orgId) this.orgId = orgId
      if (session.state === 'signed-out') { this.snapshot = structuredClone(EMPTY); this.vault.clear('license-snapshot'); this.emit() }
      else if (session.org && (!this.snapshot.activated || this.snapshot.lease?.claims?.orgId !== orgId || (this.snapshot.lease?.claims?.refreshAfter || 0) <= Date.now() / 1000)) void this.refresh().catch(() => this.emit())
      else this.emit()
    })
    this.refreshTimer ??= setInterval(() => { void this.refresh().catch(() => this.emit()) }, 86400_000)
    this.refreshTimer.unref()
    this.scheduleExpiry()
    this.emit()
  }
  getStatus(): LicenseSnapshot {
    const session = this.session.getSession()
    const orgId = session.org?.id || (session.state === 'stale' ? this.snapshot.lease?.claims?.orgId : '') || ''
    const now = Math.floor(Date.now() / 1000)
    const clockValid = now >= this.highestTime - 60
    this.highestTime = Math.max(now, this.highestTime)
    if (this.highestTime - this.persistedTime >= 60) { this.vault.write('license-observed-time', String(this.highestTime)); this.persistedTime = this.highestTime }
    const activated = session.state !== 'signed-out' && clockValid && this.snapshot.activated && this.snapshot.license?.status === 'active' && validLicenseLease(this.snapshot.lease, this.trustedKey, orgId, this.session.getDeviceId())
    return structuredClone({ ...this.snapshot, activated })
  }
  assertFeature(feature: LicensedFeature): void {
    const snapshot = this.getStatus()
    if (!snapshot.activated || !snapshot.lease?.claims?.features?.includes(feature)) throw new Error('Activate this computer in Account → Licence & Devices before using this feature.')
  }
  async activate(key: string, name = os.hostname()): Promise<LicenseSnapshot> {
    if (typeof key !== 'string' || !key.trim() || key.length > 512) throw new Error('Enter a valid activation key.')
    const context = this.context()
    return this.adopt(await this.session.managedRequest<LicenseSnapshot>('post', '/v1/licensing/activate', { key: key.trim(), name: typeof name === 'string' ? name.slice(0, 160) : os.hostname() }), context)
  }
  async refresh(): Promise<LicenseSnapshot> {
    if (this.inFlight) return this.inFlight
    const context = this.context()
    const flight = this.session.managedRequest<LicenseSnapshot>('post', '/v1/licensing/refresh').then(snapshot => this.adopt(snapshot, context)).finally(() => { if (this.inFlight === flight) this.inFlight = null })
    this.inFlight = flight
    return flight
  }
  private context(): { generation: number; orgId: string } {
    const session = this.session.getSession()
    if (session.state === 'signed-out' || !session.org?.id) throw new Error('Sign in to activate this computer.')
    return { generation: this.generation, orgId: session.org.id }
  }
  private adopt(snapshot: LicenseSnapshot, context: { generation: number; orgId: string }): LicenseSnapshot {
    const session = this.session.getSession()
    if (this.generation !== context.generation || session.state === 'signed-out' || session.org?.id !== context.orgId) throw new Error('Your account changed. Check activation again.')
    if (snapshot.activated) {
      const key = this.trustedKey || snapshot.lease?.publicKey || null
      if (!validLicenseLease(snapshot.lease, key, this.session.getSession().org?.id || '', this.session.getDeviceId())) throw new Error('The activation lease could not be verified.')
      if (!this.trustedKey && key) { this.trustedKey = key; this.vault.write('license-trusted-key', key) }
    }
    this.highestTime = Math.floor(Date.now() / 1000)
    this.persistedTime = this.highestTime
    this.vault.write('license-observed-time', String(this.highestTime))
    this.snapshot = snapshot
    this.scheduleExpiry()
    this.vault.write('license-snapshot', JSON.stringify(snapshot))
    return this.emit()
  }
  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = null
    const expiry = this.snapshot.lease?.claims?.expiresAt
    if (expiry && expiry * 1000 > Date.now()) {
      this.expiryTimer = setTimeout(() => { this.expiryTimer = null; this.emit() }, expiry * 1000 - Date.now() + 1)
      this.expiryTimer.unref()
    }
  }
  onChange(listener: (snapshot: LicenseSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(): LicenseSnapshot { const status = this.getStatus(); for (const listener of this.listeners) listener(status); return status }
  async request<T>(request: ManagedRequest): Promise<T> {
    const features = { bible: 'scripture', anthropic: request.purpose || 'scripture', deepseek: request.purpose || 'scripture', brave: 'webSearch', googleTranslate: 'translation' } as const
    this.assertFeature(features[request.provider])
    return this.session.managedRequest<T>('post', '/v1/managed/request', request)
  }
  async transcription(): Promise<TranscriptionGrant> { this.assertFeature('transcription'); return this.session.managedRequest('post', '/v1/managed/transcription') }
  renewTranscription(id: string): Promise<TranscriptionGrant> { return this.session.managedRequest('post', `/v1/managed/transcription/${encodeURIComponent(id)}/renew`) }
  async releaseTranscription(id: string): Promise<void> { await this.session.managedRequest('delete', `/v1/managed/transcription/${encodeURIComponent(id)}`) }
}

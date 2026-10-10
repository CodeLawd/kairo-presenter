import { randomUUID } from 'crypto'
import type { UsageReport, UsageReportResult } from '@shared/cloud/usage'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app, shell } from 'electron'
import log from 'electron-log/main'
import type {
  AuthResultPayload,
  CloudOrg,
  DevicePairingState,
  DeviceStartPayload,
  DevicePollPayload,
  OrgSecretsPayload,
  RefreshPayload,
  SermonUploadInput,
  SermonUploadResult,
  SessionSnapshot,
  SignInInput,
  SignUpInput,
} from '@shared/cloud/contracts'
import { isTerminalOutcome, nextPollDelaySec } from '@shared/cloud/device-code'
import {
  applyOrgSecretsToSettings,
  settingsToOrgSecretsPatch,
} from '@shared/cloud/org-secrets'
import { store } from '@main/db'
import { CloudApiClient, toApiError } from './api-client'
import { SecureStore, createSecureStore } from './secure-store'

/**
 * Where the API lives, inlined at build time by electron-vite.
 *
 * `import.meta.env`, not `process.env`: in a packaged app `process.env` is
 * whatever shell happened to launch it — empty when the user double-clicks the
 * icon — so a runtime read would silently fall back to localhost in production.
 * `MAIN_VITE_*` is substituted into the bundle when it is built.
 */
const API_BASE_URL = import.meta.env.MAIN_VITE_API_URL || 'http://localhost:3000'

const REFRESH_TOKEN_NAME = 'refresh-token'
/** Quiet background refresh — the operator never sees this happen. */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000
/**
 * After a failed refresh, retry on a widening schedule rather than going quiet
 * for half an hour: the commonest "offline" is the API (or the network) coming
 * up a few seconds after Kairo, and a booth should be back online as soon as
 * it can be. It settles at five minutes, so a machine with no internet is
 * still only a quiet retry now and then.
 */
const OFFLINE_RETRY_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000]
/**
 * Floor between vault reads. The pull is event-driven — launch, sign-in, and
 * window focus — so this only exists to swallow bursts (alt-tabbing, a window
 * that fires focus twice), not to poll on a timer.
 */
const SECRETS_MIN_INTERVAL_MS = 10 * 1000

const EMPTY_SESSION: SessionSnapshot = {
  state: 'signed-out',
  user: null,
  org: null,
  orgs: [],
  lastSyncedAt: null,
  credentialsPersisted: true, // corrected in the constructor from the real store
}

const IDLE_PAIRING: DevicePairingState = {
  status: 'idle',
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  message: null,
}

type SessionListener = (snapshot: SessionSnapshot) => void
type PairingListener = (state: DevicePairingState) => void
type SecretsListener = () => void

/**
 * The account, as the desktop app sees it.
 *
 * Everything here is best-effort by design: the session is read from disk at
 * launch and refreshed in the background, so a dead network means a stale chip
 * in the status bar and nothing else. No method on this class is ever awaited
 * on a path that leads to a slide going on screen.
 */
export class CloudSessionService {
  private readonly store: SecureStore
  private readonly api: CloudApiClient
  private snapshot: SessionSnapshot = { ...EMPTY_SESSION }
  private pairing: DevicePairingState = { ...IDLE_PAIRING }
  private sessionListeners = new Set<SessionListener>()
  private pairingListeners = new Set<PairingListener>()
  private secretsListeners = new Set<SecretsListener>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private pairingGeneration = 0
  private nextRefreshAllowedAt = 0
  /** Failed refreshes in a row, for the retry schedule; reset on success. */
  private offlineAttempts = 0
  private offlineRetry: ReturnType<typeof setTimeout> | null = null
  private deviceId = ''
  /** False until the first pull attempt finishes — blocks push from wiping the vault. */
  private secretsHydrated = false
  private secretsPullInFlight: Promise<void> | null = null
  /** `updatedAt` of the vault revision already on disk — skips no-op writes. */
  private lastSecretsUpdatedAt: string | null = null
  /** Set while a local save is being pushed, so a pull cannot overwrite it mid-flight. */
  private secretsPushInFlight = 0
  private lastSecretsPullAt = 0

  constructor(store?: SecureStore) {
    this.store = store ?? createSecureStore()
    this.snapshot = { ...this.snapshot, credentialsPersisted: this.store.available }
    if (!this.store.available) {
      // Plan 004: a missing keyring (bare Linux) must never block launch —
      // the session simply does not persist. The renderer reads
      // `credentialsPersisted` from the snapshot to say so in the UI.
      log.warn('[Session] OS keychain unavailable — sign-in will not persist between launches')
    }
    this.api = new CloudApiClient(API_BASE_URL, () => this.refreshAccessToken())
  }

  getSession(): SessionSnapshot {
    return { ...this.snapshot }
  }

  getPairing(): DevicePairingState {
    return { ...this.pairing }
  }

  /**
   * Restores a stored sign-in. Reads disk only — the network call that
   * validates it runs afterwards, so launch never waits on the internet.
   */
  start(): void {
    const token = this.store.read(REFRESH_TOKEN_NAME)
    if (token) {
      this.snapshot = { ...this.snapshot, state: 'stale' }
      // Deliberately not awaited: a slow API must not delay the first paint.
      // Coming back from 'stale' reloads the session, here and on every retry.
      void this.refreshAccessToken()
    }
    this.refreshTimer ??= setInterval(
      () => {
        void this.refreshAccessToken()
      },
      REFRESH_INTERVAL_MS + Math.floor(Math.random() * 60_000),
    )
  }

  /** Try now — after the machine wakes, or when someone asks. Cheap if already online. */
  reconnect(): void {
    if (this.snapshot.state !== 'stale') return
    this.nextRefreshAllowedAt = 0
    void this.refreshAccessToken()
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    if (this.offlineRetry) clearTimeout(this.offlineRetry)
    this.offlineRetry = null
    this.pairingGeneration += 1
  }

  async signUp(input: SignUpInput): Promise<SessionSnapshot> {
    const result = await this.api.request<AuthResultPayload>(
      'post',
      '/v1/auth/signup',
      { ...input, deviceId: this.getDeviceId(), ...this.devicePayload() },
      { authenticated: false },
    )
    return this.adopt(result)
  }

  async signIn(input: SignInInput): Promise<SessionSnapshot> {
    const result = await this.api.request<AuthResultPayload>(
      'post',
      '/v1/auth/login',
      { ...input, deviceId: this.getDeviceId(), ...this.devicePayload() },
      { authenticated: false },
    )
    return this.adopt(result)
  }

  async signOut(): Promise<SessionSnapshot> {
    this.cancelPairing()
    this.secretsHydrated = false
    this.lastSecretsUpdatedAt = null
    try {
      await this.api.request('post', '/v1/auth/logout', undefined, { allowRefresh: false })
    } catch {
      // Signing out must succeed locally even when the API cannot be told.
    }
    this.store.clear(REFRESH_TOKEN_NAME)
    this.api.setAccessToken(null)
    return this.emitSession({ ...EMPTY_SESSION })
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.api.request('post', '/v1/auth/forgot-password', { email }, { authenticated: false })
  }

  /**
   * Confirms the address with the code from the email.
   *
   * Followed immediately by a token rotation: the access token was minted
   * before the confirmation and still says unverified, and waiting up to a full
   * token lifetime after someone has done what was asked is indefensible.
   */
  async verifyEmailCode(code: string): Promise<SessionSnapshot> {
    const email = this.snapshot.user?.email
    if (!email) throw new Error('Sign in first.')

    await this.api.request(
      'post',
      '/v1/auth/verify-email-code',
      { email, code },
      { authenticated: false },
    )
    await this.refreshAccessToken()

    const user = this.snapshot.user
    const snapshot = this.emitSession({
      ...this.snapshot,
      user: user ? { ...user, emailVerified: true } : null,
    })
    void this.pullOrgSecrets()
    return snapshot
  }

  /** Sends the confirmation link again, for an email that never arrived. */
  async resendVerification(): Promise<void> {
    const email = this.snapshot.user?.email
    if (!email) return
    await this.api.request(
      'post',
      '/v1/auth/resend-verification',
      { email },
      { authenticated: false },
    )
  }

  // ─── Device pairing ─────────────────────────────────────────────────────────

  /**
   * Shows a short code and polls until someone approves it elsewhere.
   *
   * This is how a booth machine signs in: nobody types a password into a shared
   * computer, and Google sign-in never opens inside the app — the system browser
   * does it, which is both safer and the only place a password manager works.
   */
  async startPairing(): Promise<DevicePairingState> {
    const generation = ++this.pairingGeneration
    try {
      const started = await this.api.request<DeviceStartPayload>(
        'post',
        '/v1/auth/device/start',
        { deviceId: this.getDeviceId(), ...this.devicePayload() },
        { authenticated: false },
      )
      if (generation !== this.pairingGeneration) return this.getPairing()
      this.emitPairing({
        status: 'waiting',
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresAt: Date.now() + started.expiresIn * 1000,
        message: null,
      })
      void shell.openExternal(started.verificationUri).catch(() => {
        // The code is on screen either way; opening the browser is a courtesy.
      })
      void this.pollPairing(started, generation)
      return this.getPairing()
    } catch (error) {
      if (generation !== this.pairingGeneration) return this.getPairing()
      return this.emitPairing({
        ...IDLE_PAIRING,
        status: 'error',
        message: toApiError(error).message,
      })
    }
  }

  cancelPairing(): DevicePairingState {
    this.pairingGeneration += 1
    return this.emitPairing({ ...IDLE_PAIRING })
  }

  private async pollPairing(started: DeviceStartPayload, generation: number): Promise<void> {
    let intervalSec = started.interval
    const deadline = Date.now() + started.expiresIn * 1000

    while (generation === this.pairingGeneration && Date.now() < deadline) {
      await delay(intervalSec * 1000)
      if (generation !== this.pairingGeneration) return

      try {
        const result = await this.api.request<DevicePollPayload>(
          'post',
          '/v1/auth/device/token',
          { deviceCode: started.deviceCode },
          { authenticated: false },
        )

        if (generation !== this.pairingGeneration) return
        if (result.state === 'approved') {
          await this.adopt(result)
          this.emitPairing({ ...IDLE_PAIRING, status: 'approved' })
          return
        }
        intervalSec = nextPollDelaySec(result.state, intervalSec)
        if (isTerminalOutcome(result.state)) {
          this.emitPairing({
            ...IDLE_PAIRING,
            status: result.state === 'denied' ? 'denied' : 'expired',
            message:
              result.state === 'denied'
                ? 'That request was declined.'
                : 'The code expired. Start again.',
          })
          return
        }
      } catch (error) {
        // A blip mid-pairing is not a failure — keep polling until the deadline.
        log.warn('[Cloud] Pairing poll failed', { error: toApiError(error).message })
      }
    }

    if (generation === this.pairingGeneration) {
      this.emitPairing({
        ...IDLE_PAIRING,
        status: 'expired',
        message: 'The code expired. Start again.',
      })
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /** Exchanges the stored refresh token. Never throws — returns null instead. */
  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = this.store.read(REFRESH_TOKEN_NAME)
    if (!refreshToken) return null
    if (Date.now() < this.nextRefreshAllowedAt) return null

    try {
      const result = await this.api.request<RefreshPayload>(
        'post',
        '/v1/auth/refresh',
        { refreshToken, ...this.devicePayload() },
        { authenticated: false },
      )
      this.store.write(REFRESH_TOKEN_NAME, result.refreshToken)
      this.api.setAccessToken(result.accessToken)
      this.nextRefreshAllowedAt = 0
      this.offlineAttempts = 0
      if (this.offlineRetry) clearTimeout(this.offlineRetry)
      this.offlineRetry = null
      // Back from offline (or a launch that has not loaded it yet): a token
      // alone is not a session — reload who and which church, then the keys.
      const reconnecting = this.snapshot.state === 'stale' || !this.snapshot.user
      this.emitSession({ ...this.snapshot, state: 'active', lastSyncedAt: Date.now() })
      if (reconnecting) void this.loadSession().then(() => this.pullOrgSecrets())
      return result.accessToken
    } catch (error) {
      const { status, message } = toApiError(error)
      if (status === 401) {
        // The server has revoked this device. Signing out locally is the honest
        // response — anything else leaves a session that can never recover.
        log.info('[Cloud] Refresh token rejected — signing out locally')
        this.store.clear(REFRESH_TOKEN_NAME)
        this.emitSession({ ...EMPTY_SESSION })
        return null
      }
      // Offline: stay signed in and try again soon, then less often.
      const delay = OFFLINE_RETRY_MS[Math.min(this.offlineAttempts, OFFLINE_RETRY_MS.length - 1)]
      this.offlineAttempts += 1
      this.nextRefreshAllowedAt = Date.now() + delay
      if (this.offlineRetry) clearTimeout(this.offlineRetry)
      this.offlineRetry = setTimeout(() => {
        this.offlineRetry = null
        void this.refreshAccessToken()
      }, delay)
      this.emitSession({ ...this.snapshot, state: 'stale' })
      log.info('[Cloud] Working offline', { reason: message, retryInMs: delay })
      return null
    }
  }

  private async loadSession(): Promise<void> {
    try {
      const session = await this.api.request<{
        user: SessionSnapshot['user']
        orgId: string
        role: CloudOrg['role']
        orgs: CloudOrg[]
      }>('get', '/v1/auth/session')
      this.emitSession({
        state: 'active',
        user: session.user,
        org: session.orgs.find((org) => org.id === session.orgId) ?? session.orgs[0] ?? null,
        orgs: session.orgs,
        lastSyncedAt: Date.now(),
      })
      const org = this.snapshot.org
      if (org?.name) this.seedLocalChurchName(org.name)
    } catch (error) {
      log.info('[Cloud] Could not load session', { reason: toApiError(error).message })
    }
  }

  private async adopt(result: AuthResultPayload): Promise<SessionSnapshot> {
    this.store.write(REFRESH_TOKEN_NAME, result.refreshToken)
    this.api.setAccessToken(result.accessToken)
    this.nextRefreshAllowedAt = 0
    const snapshot = this.emitSession({
      state: 'active',
      user: result.user,
      org: result.org,
      orgs: [result.org],
      lastSyncedAt: Date.now(),
    })
    this.seedLocalChurchName(result.org.name)
    if (result.user.emailVerified) void this.pullOrgSecrets()
    return snapshot
  }

  /**
   * Hydrate local API keys from the org vault. Best-effort — a dead network
   * leaves whatever is already on disk and never blocks the booth.
   *
   * Called on launch, on sign-in, and when the window regains focus — never on
   * a timer, so an idle booth makes no requests at all.
   *
   * After a successful pull, cloud wins for every known secret field (including
   * empties), so a clear on the website is what the booth uses next.
   */
  async pullOrgSecrets(options: { throttle?: boolean } = {}): Promise<void> {
    if (this.secretsPullInFlight) return this.secretsPullInFlight
    // Focus-driven pulls arrive in bursts; a hard gate keeps that to one read.
    if (options.throttle && Date.now() - this.lastSecretsPullAt < SECRETS_MIN_INTERVAL_MS) {
      return
    }
    this.lastSecretsPullAt = Date.now()

    this.secretsPullInFlight = this.runPullOrgSecrets().finally(() => {
      this.secretsPullInFlight = null
    })
    return this.secretsPullInFlight
  }

  private async runPullOrgSecrets(): Promise<void> {
    const orgId = this.snapshot.org?.id
    if (!orgId || this.snapshot.state === 'signed-out') {
      this.secretsHydrated = true
      return
    }
    if (!this.snapshot.user?.emailVerified) {
      this.secretsHydrated = true
      return
    }
    // A save started locally is still travelling to the vault; a pull that lands
    // now would hand back the pre-save revision and undo it on screen.
    if (this.secretsPushInFlight > 0) return
    try {
      const secrets = await this.api.request<OrgSecretsPayload>(
        'get',
        `/v1/orgs/${orgId}/secrets`,
      )
      const revision = secrets.updatedAt ?? null
      // Same revision as what is already on disk: nothing to write, and no
      // settings:changed broadcast to blank a field the operator is typing into.
      if (this.secretsHydrated && revision !== null && revision === this.lastSecretsUpdatedAt) {
        return
      }
      const merged = applyOrgSecretsToSettings(
        { stt: store.get('stt'), lyrics: store.get('lyrics') },
        secrets,
      )
      store.set('stt', merged.stt)
      store.set('lyrics', merged.lyrics)
      this.lastSecretsUpdatedAt = revision
      log.info('[Cloud] Org secrets pulled')
      this.emitSecretsChanged()
    } catch (error) {
      log.warn('[Cloud] Org secrets pull failed', { reason: toApiError(error).message })
    } finally {
      this.secretsHydrated = true
    }
  }

  /**
   * Push local API-key changes to the org vault. Empty locals are omitted so a
   * machine that has not hydrated yet cannot wipe keys saved on the website.
   * Pass `clearLocalKeys` only when the operator explicitly cleared a field.
   */
  async pushOrgSecrets(clearLocalKeys: readonly string[] = []): Promise<void> {
    if (!this.secretsHydrated) {
      if (this.secretsPullInFlight) await this.secretsPullInFlight
    }
    const orgId = this.snapshot.org?.id
    if (!orgId || this.snapshot.state === 'signed-out') return
    if (!this.snapshot.user?.emailVerified) return
    let pushing = false
    try {
      const patch = settingsToOrgSecretsPatch(
        { stt: store.get('stt'), lyrics: store.get('lyrics') },
        clearLocalKeys,
      )
      if (Object.keys(patch).length === 0) return
      pushing = true
      this.secretsPushInFlight += 1
      const saved = await this.api.request<OrgSecretsPayload>(
        'put',
        `/v1/orgs/${orgId}/secrets`,
        { ...patch, updatedAt: new Date().toISOString() },
      )
      // Record the revision we just wrote so the next poll sees no change.
      this.lastSecretsUpdatedAt = saved?.updatedAt ?? null
      log.info('[Cloud] Org secrets pushed')
    } catch (error) {
      log.warn('[Cloud] Org secrets push failed', { reason: toApiError(error).message })
    } finally {
      if (pushing) this.secretsPushInFlight -= 1
    }
  }

  /**
   * Publish an ended service to the church's account.
   *
   * Throws rather than swallowing: the uploader needs the status code to decide
   * between retrying and giving up, which is the whole point of the queue.
   */
  async uploadSermon(payload: SermonUploadInput): Promise<SermonUploadResult> {
    const orgId = this.snapshot.org?.id
    if (!this.canUpload() || !orgId) {
      throw new Error('Sign in and confirm your email address to publish recaps.')
    }
    // A transcript is orders of magnitude larger than any other call this app
    // makes, and nobody is waiting on it — the 8s default would time out on
    // church wifi long before the upload finished.
    return this.api.request<SermonUploadResult>(
      'post',
      `/v1/orgs/${orgId}/sermons`,
      payload,
      { timeoutMs: 120_000 },
    )
  }

  /**
   * Sends usage counts (see `src/lib/cloud/usage.ts`). Same gate as recaps —
   * signed in with a confirmed address — and a short timeout: nobody waits on it.
   */
  async reportUsage(report: UsageReport): Promise<UsageReportResult> {
    if (!this.canUpload()) throw new Error('Not signed in')
    return this.api.request<UsageReportResult>('post', '/v1/usage/report', report, { timeoutMs: 15_000 })
  }

  /** This install's id and the machine facts usage reports carry. */
  usageDevice(): { installId: string; os: string; osVersion: string; arch: string; appVersion: string; electronVersion: string } {
    const { os: platform, osVersion, arch, appVersion, electronVersion } = this.deviceSnapshot()
    return { installId: this.getDeviceId(), os: platform, osVersion, arch, appVersion, electronVersion }
  }

  /** True when an upload could actually go out right now. */
  canUpload(): boolean {
    return (
      this.snapshot.state !== 'signed-out' &&
      Boolean(this.snapshot.org?.id) &&
      Boolean(this.snapshot.user?.emailVerified)
    )
  }

  /**
   * Church profile is the org. Saving it locally also renames the cloud org
   * so every machine sees the same church, not "Joshua's church".
   */
  async syncOrgProfile(patch: {
    name?: string
    timezone?: string
    serviceTimes?: { day: number; time: string; label?: string }[]
  }): Promise<void> {
    const orgId = this.snapshot.org?.id
    if (!orgId || this.snapshot.state === 'signed-out') return
    if (!this.snapshot.user?.emailVerified) return
    const name = patch.name?.trim()
    if (!name && patch.timezone === undefined && patch.serviceTimes === undefined) return

    try {
      const updated = await this.api.request<{ id: string; name: string }>(
        'patch',
        `/v1/orgs/${orgId}`,
        {
          name: name || undefined,
          timezone: patch.timezone,
          serviceTimes: patch.serviceTimes,
        },
      )
      if (updated?.name) {
        this.emitSession({
          ...this.snapshot,
          org: this.snapshot.org ? { ...this.snapshot.org, name: updated.name } : null,
          orgs: this.snapshot.orgs.map((org) =>
            org.id === orgId ? { ...org, name: updated.name } : org,
          ),
        })
      }
    } catch (error) {
      log.warn('[Cloud] Org profile sync failed', { reason: toApiError(error).message })
    }
  }

  /** First machine, empty profile: take the church name from the org they just created. */
  private seedLocalChurchName(orgName: string): void {
    const name = orgName.trim()
    if (!name) return
    const church = store.get('church')
    if (church.name.trim()) return
    store.set('church', { ...church, name })
    this.emitSecretsChanged()
  }

  onSessionChange(listener: SessionListener): () => void {
    this.sessionListeners.add(listener)
    return () => this.sessionListeners.delete(listener)
  }

  onPairingChange(listener: PairingListener): () => void {
    this.pairingListeners.add(listener)
    return () => this.pairingListeners.delete(listener)
  }

  /** Fired after a successful vault pull so the UI can refresh “Key saved”. */
  onSecretsChanged(listener: SecretsListener): () => void {
    this.secretsListeners.add(listener)
    return () => this.secretsListeners.delete(listener)
  }

  private emitSecretsChanged(): void {
    for (const listener of this.secretsListeners) {
      try {
        listener()
      } catch (error) {
        log.warn('[Cloud] Secrets listener threw', (error as Error).message)
      }
    }
  }

  private emitSession(snapshot: SessionSnapshot): SessionSnapshot {
    // Keychain availability can only change across launches, but stamp every
    // emission so caller-built literals can never drop the field.
    snapshot = { ...snapshot, credentialsPersisted: this.store.available }
    this.snapshot = snapshot
    for (const listener of this.sessionListeners) {
      try {
        listener({ ...snapshot })
      } catch (error) {
        log.warn('[Cloud] Session listener threw', (error as Error).message)
      }
    }
    return { ...snapshot }
  }

  private emitPairing(state: DevicePairingState): DevicePairingState {
    this.pairing = state
    for (const listener of this.pairingListeners) {
      try {
        listener({ ...state })
      } catch (error) {
        log.warn('[Cloud] Pairing listener threw', (error as Error).message)
      }
    }
    return { ...state }
  }

  /** Stable per install, so the server can name and revoke this machine. */
  private getDeviceId(): string {
    if (this.deviceId) return this.deviceId
    const file = path.join(app.getPath('userData'), 'cloud', 'device.json')
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { deviceId?: string }
        if (parsed.deviceId) {
          this.deviceId = parsed.deviceId
          return this.deviceId
        }
      }
    } catch {
      // A corrupt id file just means a new id — nothing is lost but the name.
    }
    this.deviceId = randomUUID()
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ deviceId: this.deviceId }))
    } catch {
      // Unwritable userData: the id lives for this session only.
    }
    return this.deviceId
  }

  private devicePayload(): { deviceName: string; device: ReturnType<CloudSessionService['deviceSnapshot']> } {
    const device = this.deviceSnapshot()
    return { deviceName: device.name, device }
  }

  private deviceSnapshot(): {
    name: string
    hostname: string
    os: string
    osVersion: string
    arch: string
    appVersion: string
    electronVersion: string
  } {
    const hostname = os.hostname()
    const osVersion =
      typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : os.release()
    return {
      name: hostname.replace(/\.local$/i, '') || this.deviceName(),
      hostname,
      os: process.platform,
      osVersion,
      arch: os.arch(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? '',
    }
  }

  private deviceName(): string {
    return `${process.platform === 'darwin' ? 'Mac' : 'PC'} · ${app.getName()}`
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const cloudSession = new CloudSessionService()

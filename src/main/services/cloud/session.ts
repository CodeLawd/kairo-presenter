import { randomUUID } from 'crypto'
import fs from 'fs'
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
 * After a failed refresh, stop trying for half an hour. Retrying every ten
 * minutes on a machine with no internet is noise in the log and battery on a
 * laptop, and the answer is not going to change until the network does.
 */
const REFRESH_BACKOFF_MS = 30 * 60 * 1000

const EMPTY_SESSION: SessionSnapshot = {
  state: 'signed-out',
  user: null,
  org: null,
  orgs: [],
  lastSyncedAt: null,
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
class CloudSessionService {
  private readonly store: SecureStore
  private readonly api: CloudApiClient
  private snapshot: SessionSnapshot = { ...EMPTY_SESSION }
  private pairing: DevicePairingState = { ...IDLE_PAIRING }
  private sessionListeners = new Set<SessionListener>()
  private pairingListeners = new Set<PairingListener>()
  private secretsListeners = new Set<SecretsListener>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private pairingAbort = false
  private nextRefreshAllowedAt = 0
  private deviceId = ''

  constructor(store?: SecureStore) {
    this.store = store ?? createSecureStore()
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
      void this.refreshAccessToken().then((ok) => {
        if (ok) void this.loadSession().then(() => this.pullOrgSecrets())
      })
    }
    this.refreshTimer ??= setInterval(
      () => {
        void this.refreshAccessToken()
      },
      REFRESH_INTERVAL_MS + Math.floor(Math.random() * 60_000),
    )
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    this.pairingAbort = true
  }

  async signUp(input: SignUpInput): Promise<SessionSnapshot> {
    const result = await this.api.request<AuthResultPayload>(
      'post',
      '/v1/auth/signup',
      { ...input, deviceId: this.getDeviceId(), deviceName: this.deviceName() },
      { authenticated: false },
    )
    return this.adopt(result)
  }

  async signIn(input: SignInInput): Promise<SessionSnapshot> {
    const result = await this.api.request<AuthResultPayload>(
      'post',
      '/v1/auth/login',
      { ...input, deviceId: this.getDeviceId() },
      { authenticated: false },
    )
    return this.adopt(result)
  }

  async signOut(): Promise<SessionSnapshot> {
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
    this.pairingAbort = false
    try {
      const started = await this.api.request<DeviceStartPayload>(
        'post',
        '/v1/auth/device/start',
        { deviceId: this.getDeviceId(), deviceName: this.deviceName() },
        { authenticated: false },
      )
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
      void this.pollPairing(started)
      return this.getPairing()
    } catch (error) {
      return this.emitPairing({
        ...IDLE_PAIRING,
        status: 'error',
        message: toApiError(error).message,
      })
    }
  }

  cancelPairing(): DevicePairingState {
    this.pairingAbort = true
    return this.emitPairing({ ...IDLE_PAIRING })
  }

  private async pollPairing(started: DeviceStartPayload): Promise<void> {
    let intervalSec = started.interval
    const deadline = Date.now() + started.expiresIn * 1000

    while (!this.pairingAbort && Date.now() < deadline) {
      await delay(intervalSec * 1000)
      if (this.pairingAbort) return

      try {
        const result = await this.api.request<DevicePollPayload>(
          'post',
          '/v1/auth/device/token',
          { deviceCode: started.deviceCode },
          { authenticated: false },
        )

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

    if (!this.pairingAbort) {
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
        { refreshToken },
        { authenticated: false },
      )
      this.store.write(REFRESH_TOKEN_NAME, result.refreshToken)
      this.api.setAccessToken(result.accessToken)
      this.nextRefreshAllowedAt = 0
      this.emitSession({ ...this.snapshot, state: 'active', lastSyncedAt: Date.now() })
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
      // Offline: stay signed in, stop hammering, say nothing to the operator.
      this.nextRefreshAllowedAt = Date.now() + REFRESH_BACKOFF_MS
      this.emitSession({ ...this.snapshot, state: 'stale' })
      log.info('[Cloud] Working offline', { reason: message })
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
   */
  async pullOrgSecrets(): Promise<void> {
    const orgId = this.snapshot.org?.id
    if (!orgId || this.snapshot.state === 'signed-out') return
    if (!this.snapshot.user?.emailVerified) return
    try {
      const secrets = await this.api.request<OrgSecretsPayload>(
        'get',
        `/v1/orgs/${orgId}/secrets`,
      )
      const merged = applyOrgSecretsToSettings(
        { stt: store.get('stt'), lyrics: store.get('lyrics') },
        secrets,
      )
      store.set('stt', merged.stt)
      store.set('lyrics', merged.lyrics)
      log.info('[Cloud] Org secrets pulled')
      this.emitSecretsChanged()
    } catch (error) {
      log.warn('[Cloud] Org secrets pull failed', { reason: toApiError(error).message })
    }
  }

  /**
   * Push the current local API-key snapshot to the org vault. Called after
   * settings saves — never awaited on a hot path that could delay slides.
   */
  async pushOrgSecrets(): Promise<void> {
    const orgId = this.snapshot.org?.id
    if (!orgId || this.snapshot.state === 'signed-out') return
    try {
      const patch = settingsToOrgSecretsPatch({
        stt: store.get('stt'),
        lyrics: store.get('lyrics'),
      })
      await this.api.request('put', `/v1/orgs/${orgId}/secrets`, {
        ...patch,
        updatedAt: new Date().toISOString(),
      })
      log.info('[Cloud] Org secrets pushed')
    } catch (error) {
      log.warn('[Cloud] Org secrets push failed', { reason: toApiError(error).message })
    }
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

  private deviceName(): string {
    return `${process.platform === 'darwin' ? 'Mac' : 'PC'} · ${app.getName()}`
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const cloudSession = new CloudSessionService()

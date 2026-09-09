import { app } from 'electron'
import log from 'electron-log/main'
import type { UpdateStatus } from '@shared/ipc'

// electron-updater is CJS-only and ships a default export object; the named
// `autoUpdater` binding is not reachable through electron-vite's ESM interop.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

type Listener = (status: UpdateStatus) => void

/**
 * GitHub Releases auto-update.
 *
 * The feed (owner/repo) comes from `build.publish` in package.json, which
 * electron-builder bakes into `app-update.yml` at package time — nothing is
 * configured here. A dev run or an unsigned/unpackaged build has no such file,
 * so every entry point no-ops instead of throwing.
 *
 * macOS auto-update requires a *signed* app: Squirrel.Mac refuses an update
 * whose signature does not match the running app's. The `zip` target in
 * `build.mac.target` is what actually gets downloaded — the dmg is only for
 * first installs.
 */
class UpdaterService {
  private status: UpdateStatus = { state: 'idle' }
  private listeners = new Set<Listener>()
  private wired = false

  /** True only for a packaged build that carries an update feed. */
  private get enabled(): boolean {
    return app.isPackaged
  }

  /**
   * Dev-only fake feed, off unless KAIRO_UPDATE_SIM=1. It drives the real UI
   * through the real IPC — check/download/install behave as they would against
   * GitHub — so the header pill and the Settings row can be seen in every state
   * without cutting a release. Never reachable in a packaged build.
   */
  private get simulated(): boolean {
    return !app.isPackaged && process.env.KAIRO_UPDATE_SIM === '1'
  }

  /** Called once on app ready. Wires events and runs the first check. */
  init(): void {
    if (this.simulated) {
      log.warn('[Updater] SIMULATED feed (KAIRO_UPDATE_SIM=1) — no real update will be installed')
      void this.check()
      return
    }
    if (!this.enabled) {
      log.info('[Updater] disabled (not a packaged build)')
      return
    }
    this.wire()
    // Download happens explicitly, so a service in progress is never
    // interrupted by a surprise background download.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = log
    void this.check()
  }

  private wire(): void {
    if (this.wired) return
    this.wired = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      log.info('[Updater] update available:', info.version)
      this.set({ state: 'available', version: info.version, notes: releaseNotes(info.releaseNotes) })
    })
    autoUpdater.on('update-not-available', () => {
      this.set({ state: 'idle', currentVersion: app.getVersion() })
    })
    autoUpdater.on('download-progress', (p) => {
      this.set({ ...this.status, state: 'downloading', percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      log.info('[Updater] update downloaded:', info.version)
      this.set({ state: 'downloaded', version: info.version, notes: releaseNotes(info.releaseNotes) })
    })
    autoUpdater.on('error', (err) => {
      // A dead network or a repo with no releases yet is normal, not fatal.
      log.warn('[Updater] error:', err?.message ?? String(err))
      this.set({ state: 'error', message: err?.message ?? 'Update check failed' })
    })
  }

  getStatus(): UpdateStatus {
    // The running version is only interesting while nothing is pending, and it
    // saves the renderer a second round trip just to render "you're on x.y.z".
    if (this.status.state === 'idle') return { ...this.status, currentVersion: app.getVersion() }
    return this.status
  }

  /** Manual "Check for Updates". Resolves with the status the check settled on. */
  async check(): Promise<UpdateStatus> {
    if (this.simulated) {
      this.set({ state: 'checking' })
      await delay(900)
      this.set({ state: 'available', version: fakeNextVersion(), notes: 'Simulated release notes.' })
      return this.status
    }
    if (!this.enabled) return this.status
    this.wire()
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      log.warn('[Updater] check failed:', (err as Error).message)
      this.set({ state: 'error', message: (err as Error).message })
    }
    return this.status
  }

  /** Downloads the pending update; no-op unless one is available. */
  async download(): Promise<UpdateStatus> {
    if (this.simulated) {
      if (this.status.state !== 'available') return this.status
      const { version, notes } = this.status
      for (let percent = 0; percent <= 100; percent += 5) {
        this.set({ state: 'downloading', version, notes, percent })
        await delay(150)
      }
      this.set({ state: 'downloaded', version, notes })
      return this.status
    }
    if (!this.enabled || this.status.state !== 'available') return this.status
    this.set({ ...this.status, state: 'downloading', percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      log.warn('[Updater] download failed:', (err as Error).message)
      this.set({ state: 'error', message: (err as Error).message })
    }
    return this.status
  }

  /**
   * Quits and installs. Only valid once downloaded — a live service must never
   * be torn down by a stray call, so anything else is a no-op.
   */
  install(): void {
    if (this.simulated) {
      // Quitting here would only kill the dev run, and the point is to watch
      // the button, not to lose the window.
      log.warn('[Updater] SIMULATED install — would quit and install now')
      this.set({ state: 'idle', currentVersion: fakeNextVersion() })
      return
    }
    if (!this.enabled || this.status.state !== 'downloaded') return
    log.info('[Updater] quitting to install')
    setImmediate(() => autoUpdater.quitAndInstall())
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.listeners.forEach((listener) => {
      try {
        listener(status)
      } catch (err) {
        log.error('[Updater] listener threw:', err)
      }
    })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Simulator only — the running version with its patch number bumped. */
function fakeNextVersion(): string {
  const [major = '1', minor = '0', patch = '0'] = app.getVersion().split('.')
  return `${major}.${minor}.${Number(patch) + 1}`
}

/** GitHub returns release notes as HTML or as a list of releases. */
function releaseNotes(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes.map((n) => (n as { note?: string }).note ?? '').filter(Boolean).join('\n\n')
  }
  return undefined
}

export const updaterService = new UpdaterService()

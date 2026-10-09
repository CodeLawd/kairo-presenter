import { app, net } from 'electron'
import log from 'electron-log/main'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants as fsConstants, createWriteStream, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { promisify } from 'node:util'
import type { UpdateStatus } from '@shared/ipc'
import {
  bundleFromExecutable,
  isAdhocSignature,
  pickMacZip,
  releaseAssetUrl,
  SWAP_SCRIPT,
  type UpdateFileInfo,
} from './mac-self-update'

// electron-updater is CJS-only and ships a default export object; the named
// `autoUpdater` binding is not reachable through electron-vite's ESM interop.
// eslint-disable-next-line import/default -- interop require documented above; verified in the packaged app
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

type Listener = (status: UpdateStatus) => void

const run = promisify(execFile)

/**
 * GitHub Releases auto-update.
 *
 * The feed (owner/repo) comes from `build.publish` in package.json, which
 * electron-builder bakes into `app-update.yml` at package time — nothing is
 * configured here. A dev run or an unsigned/unpackaged build has no such file,
 * so every entry point no-ops instead of throwing.
 *
 * macOS auto-update through Squirrel.Mac requires a Developer ID–signed app.
 * Until Kairo has one, a Mac build that is only ad-hoc signed downloads,
 * verifies and swaps in its own update instead (see ./mac-self-update.ts). The
 * `zip` target in `build.mac.target` is what gets downloaded either way — the
 * dmg is only for first installs.
 */
class UpdaterService {
  private status: UpdateStatus = { state: 'idle' }
  private listeners = new Set<Listener>()
  private wired = false
  /** Unsigned macOS build: Kairo installs its own updates (decided at init). */
  private selfUpdate = false
  /** The release `update-available` reported — the files and their hashes. */
  private pending: { version: string; files: UpdateFileInfo[] } | null = null
  /** An unpacked, verified update waiting for quit. */
  private staged: { bundle: string; dir: string } | null = null
  private installing = false

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
    void this.detectSelfUpdate().then(() => this.check())
  }

  /**
   * An ad-hoc signed Mac build can't use Squirrel, so it updates itself. Also
   * installs a downloaded update on an ordinary quit, as Squirrel would.
   */
  private async detectSelfUpdate(): Promise<void> {
    if (process.platform !== 'darwin') return
    const bundle = bundleFromExecutable(app.getPath('exe'))
    if (!bundle) return
    try {
      const { stderr, stdout } = await run('codesign', ['-dv', '--verbose=2', bundle])
      this.selfUpdate = isAdhocSignature(`${stdout}\n${stderr}`)
    } catch {
      // No signature at all: the same situation, Squirrel can't help.
      this.selfUpdate = true
    }
    if (!this.selfUpdate) return
    log.info('[Updater] unsigned macOS build — Kairo installs its own updates')
    autoUpdater.autoInstallOnAppQuit = false
    app.on('will-quit', () => {
      if (this.staged && !this.installing) this.swapOnQuit(false)
    })
  }

  private wire(): void {
    if (this.wired) return
    this.wired = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      log.info('[Updater] update available:', info.version)
      this.pending = { version: info.version, files: info.files as UpdateFileInfo[] }
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
    if (this.selfUpdate) {
      await this.downloadSelf()
      return this.status
    }
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
    if (this.selfUpdate) {
      if (this.swapOnQuit(true)) app.quit()
      return
    }
    setImmediate(() => autoUpdater.quitAndInstall())
  }

  /**
   * Downloads this Mac's update zip, checks it against the release's SHA-512,
   * unpacks it and confirms it is a validly signed Kairo before staging it.
   */
  private async downloadSelf(): Promise<void> {
    const pending = this.pending
    const file = pending && pickMacZip(pending.files, process.arch)
    if (!pending || !file) {
      this.set({ state: 'error', message: 'This release has no update file for this Mac.' })
      return
    }
    const { version, notes } = this.status.state === 'downloading' ? this.status : { version: pending.version, notes: undefined }
    let dir: string | null = null
    try {
      dir = await mkdtemp(path.join(app.getPath('temp'), 'kairo-update-'))
      const zip = path.join(dir, 'update.zip')
      const response = await net.fetch(releaseAssetUrl(pending.version, file.url))
      if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)

      const total = Number(response.headers.get('content-length')) || file.size || 0
      const hash = createHash('sha512')
      const out = createWriteStream(zip)
      const reader = response.body.getReader()
      let received = 0
      let shown = -1
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        received += value.length
        if (!out.write(value)) await once(out, 'drain')
        const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : undefined
        if (percent !== undefined && percent !== shown) {
          shown = percent
          this.set({ state: 'downloading', version, notes, percent })
        }
      }
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
      if (hash.digest('base64') !== file.sha512) {
        throw new Error('The update did not match its published checksum, so it was not installed.')
      }

      const unpacked = path.join(dir, 'app')
      await run('ditto', ['-x', '-k', zip, unpacked])
      await rm(zip, { force: true })
      const name = (await readdir(unpacked)).find((entry) => entry.endsWith('.app'))
      if (!name) throw new Error('The update did not contain an app.')
      const bundle = path.join(unpacked, name)

      // Same app (bundle id) and an intact signature — never swap in anything else.
      const current = bundleFromExecutable(app.getPath('exe'))
      if (!current) throw new Error('Could not find the installed Kairo.')
      const [mine, theirs] = await Promise.all([bundleId(current), bundleId(bundle)])
      if (mine !== theirs) throw new Error(`The update is not Kairo (${theirs}).`)
      await run('codesign', ['--verify', '--deep', '--strict', bundle])
      await run('xattr', ['-dr', 'com.apple.quarantine', bundle]).catch(() => undefined)

      this.staged = { bundle, dir }
      log.info('[Updater] update staged:', version)
      this.set({ state: 'downloaded', version: version ?? pending.version, notes })
    } catch (err) {
      log.warn('[Updater] self-update download failed:', (err as Error).message)
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      this.set({ state: 'error', message: (err as Error).message })
    }
  }

  /**
   * Starts the detached swap script; it waits for this process to exit. Sync,
   * because it also runs from `will-quit`. Returns false (and says why) when
   * Kairo can't replace itself where it is installed.
   */
  private swapOnQuit(relaunch: boolean): boolean {
    const staged = this.staged
    const current = bundleFromExecutable(app.getPath('exe'))
    if (!staged || !current) return false
    try {
      accessSync(path.dirname(current), fsConstants.W_OK)
      accessSync(current, fsConstants.W_OK)
    } catch {
      const site = import.meta.env.MAIN_VITE_WEB_URL || 'the Kairo website'
      this.set({
        state: 'error',
        message: `Kairo can't update itself in ${path.dirname(current)}. Download the new version from ${site} and drag it into Applications.`,
      })
      return false
    }
    const script = path.join(staged.dir, 'swap.sh')
    writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 })
    spawn('/bin/bash', [script, String(process.pid), current, staged.bundle, relaunch ? '1' : '0'], {
      detached: true,
      stdio: 'ignore',
    }).unref()
    this.installing = true
    log.info('[Updater] swap scheduled', relaunch ? '(reopening)' : '(on quit)')
    return true
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

/** CFBundleIdentifier of a bundle, from its Info.plist. */
async function bundleId(bundle: string): Promise<string> {
  const { stdout } = await run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    path.join(bundle, 'Contents', 'Info.plist'),
  ])
  return stdout.trim()
}

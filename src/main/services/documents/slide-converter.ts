/**
 * The slide converter Kairo downloads on demand: LibreOffice, unpacked into
 * Kairo's own folder and run headless. Never installed system-wide, needs no
 * admin password, and only fetched when a PowerPoint has nothing better
 * (PowerPoint, Keynote, a system LibreOffice) to convert it.
 */
import { app } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, promises as fs } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log/main'
import type { PowerpointConverterId, SlideConverterStatus } from '@shared/documents'

const run = promisify(execFile)

/** Pinned build. Bump the version, URLs and checksums together (TDF publishes a .sha256 next to each file). */
export const SLIDE_CONVERTER_VERSION = '26.2.7'
const BASE = `https://download.documentfoundation.org/libreoffice/stable/${SLIDE_CONVERTER_VERSION}`

interface Build { url: string; sha256: string; sizeBytes: number; kind: 'dmg' | 'msi' }

export function buildFor(platform: NodeJS.Platform = process.platform, arch: string = process.arch): Build | null {
  if (platform === 'darwin' && arch === 'arm64') return {
    url: `${BASE}/mac/aarch64/LibreOffice_${SLIDE_CONVERTER_VERSION}_MacOS_aarch64.dmg`,
    sha256: '58601808ae2b919c82dc7c4d6a26389de0e167f344ca48e5b6c9189218eb95ae', sizeBytes: 297_813_809, kind: 'dmg',
  }
  if (platform === 'darwin' && arch === 'x64') return {
    url: `${BASE}/mac/x86_64/LibreOffice_${SLIDE_CONVERTER_VERSION}_MacOS_x86-64.dmg`,
    sha256: '26a830205c617cc624b2a83783ef46434a4d6c337c3a873f79c43012171f83de', sizeBytes: 308_070_986, kind: 'dmg',
  }
  if (platform === 'win32' && arch === 'x64') return {
    url: `${BASE}/win/x86_64/LibreOffice_${SLIDE_CONVERTER_VERSION}_Win_x86-64.msi`,
    sha256: '480fecf759fc6393bd614fbf43753eb95a8198fc1a065d41b727e3b664cd1e59', sizeBytes: 373_121_024, kind: 'msi',
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try { await fs.access(path); return true } catch { return false }
}

class SlideConverterService {
  private state: SlideConverterStatus['state'] = 'missing'
  private received = 0
  private error: string | undefined
  private abort: AbortController | null = null
  private installing: Promise<SlideConverterStatus> | null = null
  private listeners = new Set<(status: SlideConverterStatus) => void>()
  /** Set by the documents service so status can say when another app already converts. */
  detectOthers: () => Promise<PowerpointConverterId | null> = async () => null

  private get root(): string { return join(app.getPath('userData'), 'slide-converter') }
  private get installDir(): string { return join(this.root, SLIDE_CONVERTER_VERSION) }

  /** The soffice binary of the downloaded converter, or null when it isn't installed. */
  async binary(): Promise<string | null> {
    const candidates = process.platform === 'darwin'
      ? [join(this.installDir, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')]
      : [join(this.installDir, 'program', 'soffice.exe'), join(this.installDir, 'LibreOffice', 'program', 'soffice.exe')]
    for (const candidate of candidates) if (await exists(candidate)) return candidate
    return null
  }

  onChanged(listener: (status: SlideConverterStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async status(): Promise<SlideConverterStatus> {
    const build = buildFor()
    let state = this.state
    if (!build) state = 'unsupported'
    else if (state !== 'downloading' && state !== 'installing') {
      state = (await this.binary()) ? 'ready' : this.state === 'error' ? 'error' : 'missing'
    }
    return {
      state,
      version: SLIDE_CONVERTER_VERSION,
      sizeBytes: build?.sizeBytes ?? 0,
      receivedBytes: this.received,
      error: state === 'error' ? this.error : undefined,
      otherConverter: await this.detectOthers().catch(() => null),
    }
  }

  private emit(): void {
    void this.status().then((status) => this.listeners.forEach((listener) => listener(status)))
  }

  /** Download, verify and unpack. Concurrent calls share one download. */
  install(): Promise<SlideConverterStatus> {
    this.installing ??= this.doInstall().finally(() => { this.installing = null })
    return this.installing
  }

  cancel(): void {
    this.abort?.abort()
  }

  async remove(): Promise<SlideConverterStatus> {
    this.cancel()
    await this.installing?.catch(() => undefined)
    await fs.rm(this.root, { recursive: true, force: true })
    this.state = 'missing'
    this.error = undefined
    this.received = 0
    this.emit()
    return this.status()
  }

  private async doInstall(): Promise<SlideConverterStatus> {
    const build = buildFor()
    if (!build) return this.status()
    if (await this.binary()) { this.state = 'ready'; this.emit(); return this.status() }
    const abort = new AbortController()
    this.abort = abort
    this.state = 'downloading'
    this.received = 0
    this.error = undefined
    this.emit()
    const download = join(this.root, `download.${build.kind}`)
    const staging = join(this.root, 'staging')
    try {
      await fs.mkdir(this.root, { recursive: true })
      await this.download(build, download, abort.signal)
      this.state = 'installing'
      this.emit()
      await fs.rm(staging, { recursive: true, force: true })
      await fs.mkdir(staging, { recursive: true })
      if (build.kind === 'dmg') await this.unpackDmg(download, staging)
      else await this.unpackMsi(download, staging)
      // Old versions go once the new one is in place.
      for (const entry of await fs.readdir(this.root)) {
        if (/^\d+\.\d+\.\d+$/.test(entry)) await fs.rm(join(this.root, entry), { recursive: true, force: true })
      }
      await fs.rename(staging, this.installDir)
      if (!(await this.binary())) throw new Error('The converter was downloaded but could not be unpacked.')
      this.state = 'ready'
      log.info('[SlideConverter] Installed', { version: SLIDE_CONVERTER_VERSION })
    } catch (error) {
      const canceled = abort.signal.aborted
      this.state = canceled ? 'missing' : 'error'
      this.error = canceled ? undefined : friendlyError(error)
      if (!canceled) log.warn('[SlideConverter] Install failed', { error: (error as Error).message })
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    } finally {
      await fs.rm(download, { force: true }).catch(() => undefined)
      this.abort = null
      this.received = this.state === 'ready' ? build.sizeBytes : 0
      this.emit()
    }
    return this.status()
  }

  private async download(build: Build, dest: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(build.url, { signal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`)
    const hash = createHash('sha256')
    const file = createWriteStream(dest)
    const reader = response.body.getReader()
    let lastEmit = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        if (!file.write(value)) await new Promise<void>((resolve) => file.once('drain', resolve))
        this.received += value.byteLength
        const now = Date.now()
        if (now - lastEmit > 250) { lastEmit = now; this.emit() }
      }
    } finally {
      await new Promise<void>((resolve) => file.end(resolve))
    }
    if (hash.digest('hex') !== build.sha256) throw new Error('checksum')
  }

  private async unpackDmg(dmg: string, staging: string): Promise<void> {
    const mount = join(this.root, 'mount')
    await fs.mkdir(mount, { recursive: true })
    await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount], { timeout: 120_000 })
    try {
      // ditto keeps the code signature and symlinks intact.
      await run('ditto', [join(mount, 'LibreOffice.app'), join(staging, 'LibreOffice.app')], { timeout: 600_000 })
    } finally {
      await run('hdiutil', ['detach', mount, '-force'], { timeout: 60_000 }).catch(() => undefined)
      await fs.rm(mount, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async unpackMsi(msi: string, staging: string): Promise<void> {
    // An administrative install only unpacks files: no admin rights, no registry, no Start menu entry.
    await run('msiexec', ['/a', msi, '/qn', `TARGETDIR=${staging}`], { timeout: 900_000, windowsHide: true })
  }
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'checksum') return 'The download was damaged. Try again.'
  if (/ENOSPC/.test(message)) return 'There isn’t enough free disk space. Free up about 1 GB and try again.'
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network|Download failed/i.test(message)) {
    return 'The download stopped. Check the internet connection and try again.'
  }
  return 'The converter couldn’t be set up. Try again.'
}

export const slideConverter = new SlideConverterService()

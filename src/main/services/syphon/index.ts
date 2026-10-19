/**
 * Syphon output (macOS): publishes an offscreen output's frames as a Syphon
 * server, so OBS, Resolume, vMix and other apps on the same Mac take Kairo in
 * — alpha included, for lyrics or a lower third over a camera.
 *
 * Loading is lazy and never throws: another platform or a missing addon is a
 * typed "unavailable" result, and a Syphon output then reports why it isn't
 * running instead of failing the app.
 */
import log from 'electron-log/main'
import path from 'node:path'

type Handle = { readonly __syphonHandle: unique symbol }

/** The native surface of native/syphon/syphon.mm. */
export interface SyphonAddon {
  available(): { ok: boolean; reason?: string }
  open(options: { name: string }): Handle
  /** False when the previous frame is still being copied: this one is dropped. */
  publish(server: Handle, sharedTextureHandle: Buffer, done: (error: Error | null) => void): boolean
  publishPixels(server: Handle, bgra: Buffer, width: number, height: number): boolean
  close(server: Handle): void
  stats(server: Handle): { published: number; skipped: number; failed: number; hasClients: boolean }
}

export type SyphonLoad = { ok: true; addon: SyphonAddon } | { ok: false; reason: string }

export type RequireFn = (id: string) => unknown

/** Where the built addon lives: packaged resources first, then the dev build. */
export function syphonCandidates(resourcesPath: string | undefined = process.resourcesPath, cwd = process.cwd()): string[] {
  return [
    ...(resourcesPath ? [path.join(resourcesPath, 'syphon', 'syphon.node')] : []),
    path.join(cwd, 'native', 'syphon', 'build', 'syphon.node'),
  ]
}

export function loadSyphon(
  requireFn: RequireFn = require,
  platform: NodeJS.Platform = process.platform,
  candidates: string[] = syphonCandidates(),
): SyphonLoad {
  if (platform !== 'darwin') return { ok: false, reason: 'Syphon is only available on a Mac' }
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const addon = requireFn(candidate) as SyphonAddon
      const status = addon.available()
      if (!status.ok) return { ok: false, reason: status.reason ?? 'Metal unavailable' }
      return { ok: true, addon }
    } catch (error) {
      errors.push(`${candidate}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  return { ok: false, reason: `Syphon addon not loaded (${errors.join('; ')})` }
}

let cached: SyphonLoad | null = null

/** The process-wide addon, loaded on first use and logged once. */
export function syphonAddon(): SyphonLoad {
  if (cached) return cached
  try {
    cached = loadSyphon()
  } catch (error) {
    cached = { ok: false, reason: `loader threw: ${(error as Error).message}` }
  }
  if (cached.ok) log.info('[Syphon] addon loaded')
  else log.info('[Syphon] unavailable', { reason: cached.reason })
  return cached
}

/** A shared texture from an offscreen paint: its handle, and how to give it back. */
export interface PaintedTexture {
  textureInfo: { sharedTextureHandle: Buffer }
  release(): void
}

/**
 * One Syphon server, named after its output ("Kairo – Lower Third"). It opens
 * on the first frame and closes with the output; other apps see it appear and
 * disappear in their Syphon source list.
 */
export class SyphonChannel {
  private server: Handle | null = null
  private failure: string | null = null

  constructor(
    readonly serverName: string,
    private readonly load: () => SyphonLoad = syphonAddon,
  ) {}

  /** Whether frames can go out, and if not, why — for the Screens window. */
  getStatus(): { available: boolean; reason?: string } {
    const loaded = this.load()
    if (!loaded.ok) return { available: false, reason: loaded.reason }
    if (this.failure) return { available: false, reason: this.failure }
    return { available: true }
  }

  /** Starts the server if it isn't running. Never throws. */
  start(): boolean {
    if (this.server) return true
    const loaded = this.load()
    if (!loaded.ok) return false
    try {
      this.server = loaded.addon.open({ name: this.serverName })
      this.failure = null
      log.info('[Syphon] server started', { name: this.serverName })
      return true
    } catch (error) {
      this.failure = (error as Error).message
      log.warn('[Syphon] server could not start', { name: this.serverName, error: this.failure })
      return false
    }
  }

  /** GPU path: publishes one painted texture. Always releases it, now or once the copy is done. */
  publish(texture: PaintedTexture): void {
    const loaded = this.load()
    if (!loaded.ok || !this.start() || !this.server) {
      texture.release()
      return
    }
    try {
      const started = loaded.addon.publish(this.server, texture.textureInfo.sharedTextureHandle, (error) => {
        texture.release()
        if (error) log.warn('[Syphon] frame failed', { name: this.serverName, error: error.message })
      })
      // Busy: the frame is dropped and the next paint carries newer pixels.
      if (!started) texture.release()
    } catch (error) {
      texture.release()
      log.warn('[Syphon] frame failed', { name: this.serverName, error: (error as Error).message })
    }
  }

  /** CPU path: publishes a BGRA bitmap. */
  publishPixels(bgra: Buffer, width: number, height: number): void {
    const loaded = this.load()
    if (!loaded.ok || !this.start() || !this.server) return
    try {
      loaded.addon.publishPixels(this.server, bgra, width, height)
    } catch (error) {
      log.warn('[Syphon] frame failed', { name: this.serverName, error: (error as Error).message })
    }
  }

  /** A clear frame, so receivers show nothing rather than the last slide. */
  clearFrame(width: number, height: number): void {
    if (this.server) this.publishPixels(Buffer.alloc(width * height * 4), width, height)
  }

  stop(): void {
    const loaded = this.load()
    const server = this.server
    this.server = null
    if (!server || !loaded.ok) return
    try {
      loaded.addon.close(server)
      log.info('[Syphon] server stopped', { name: this.serverName })
    } catch {
      /* teardown must not throw */
    }
  }
}

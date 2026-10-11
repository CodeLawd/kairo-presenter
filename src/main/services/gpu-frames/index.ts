/**
 * Loader for the gpu-frames native addon (plan 008).
 *
 * Offscreen outputs can capture through Chromium's shared GPU textures instead
 * of `getBitmap()`. The addon converts each texture to UYVY (video cards) or
 * UYVA (NDI) on the GPU, so the main thread handles a texture handle rather
 * than ~8 MB of pixels per frame.
 *
 * Loading is lazy and never throws: an unsupported platform or a missing or
 * broken addon is a typed "unavailable" result, and every surface keeps the
 * CPU capture path.
 */
import log from 'electron-log/main'
import path from 'node:path'

type Handle = { readonly __gpuFramesHandle: unique symbol }

/** Result of one GPU conversion: a UYVA buffer, or the ring slot written. */
export type ConvertResult = Buffer | { slot: number; sequence: number }

/** The native surface of native/gpu-frames/gpu_frames.mm. */
export interface GpuFramesAddon {
  available(): { ok: boolean; reason?: string; device?: string }
  open(options: { width: number; height: number; alpha?: boolean; ring?: Handle }): Handle
  /** False when every slot is busy: the frame is dropped and the texture may be released. */
  convert(converter: Handle, sharedTextureHandle: Buffer, done: (error: Error | null, result?: ConvertResult) => void): boolean
  close(converter: Handle): void
  stats(converter: Handle): { converted: number; skipped: number; failed: number; inFlight: number }
  createRing(name: string, width: number, height: number): Handle
  closeRing(ring: Handle): void
}

export type GpuFramesLoad =
  | { ok: true; addon: GpuFramesAddon; device: string }
  | { ok: false; reason: string }

export type RequireFn = (id: string) => unknown

/** Where the built addon lives: packaged resources first, then the dev build. */
export function addonCandidates(resourcesPath: string | undefined = process.resourcesPath, cwd = process.cwd()): string[] {
  return [
    ...(resourcesPath ? [path.join(resourcesPath, 'gpu-frames', 'gpu_frames.node')] : []),
    path.join(cwd, 'native', 'gpu-frames', 'build', 'gpu_frames.node'),
  ]
}

export function loadGpuFrames(
  requireFn: RequireFn = require,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  candidates: string[] = addonCandidates(),
): GpuFramesLoad {
  // Windows (D3D11) and Linux (dmabuf) are follow-ups; they stay on the CPU path.
  if (platform !== 'darwin') return { ok: false, reason: `GPU capture is macOS-only in this build (${platform})` }
  // A diagnostic escape hatch, not a setting: forces the CPU path everywhere.
  if (env.KAIRO_GPU_CAPTURE === '0') return { ok: false, reason: 'disabled by KAIRO_GPU_CAPTURE=0' }
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const addon = requireFn(candidate) as GpuFramesAddon
      const status = addon.available()
      if (!status.ok) return { ok: false, reason: status.reason ?? 'Metal unavailable' }
      return { ok: true, addon, device: status.device ?? 'unknown GPU' }
    } catch (error) {
      errors.push(`${candidate}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  return { ok: false, reason: `gpu-frames addon not loaded (${errors.join('; ')})` }
}

let cached: GpuFramesLoad | null = null

/** The process-wide addon, loaded on first use and logged once. */
export function gpuFrames(): GpuFramesLoad {
  if (cached) return cached
  try {
    cached = loadGpuFrames()
  } catch (error) {
    cached = { ok: false, reason: `loader threw: ${(error as Error).message}` }
  }
  if (cached.ok) log.info('[GPU capture] addon loaded', { device: cached.device })
  else log.info('[GPU capture] unavailable — offscreen outputs use CPU capture', { reason: cached.reason })
  return cached
}

// ─── Frame ring ───────────────────────────────────────────────────────────────

/**
 * A POSIX shared-memory ring of UYVY frames at one output raster, written by
 * a GPU converter in this process and read by the DeckLink helper. Only
 * converted pixels cross the process boundary — textures never do.
 */
export interface FrameRing {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly handle: Handle
  /** Unmaps and unlinks. Close every converter writing to it first. */
  close(): void
}

let ringCounter = 0

export function createFrameRing(addon: GpuFramesAddon, width: number, height: number): FrameRing {
  // macOS caps shm names at 31 bytes; pid + counter keeps rings unique per run.
  const name = `/kgf.${process.pid}.${++ringCounter}`
  const handle = addon.createRing(name, width, height)
  let closed = false
  return {
    name, width, height, handle,
    close() {
      if (closed) return
      closed = true
      try { addon.closeRing(handle) } catch { /* teardown must not throw */ }
    },
  }
}

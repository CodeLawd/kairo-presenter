/**
 * GPU capture for one offscreen surface (plan 008).
 *
 * Each `paint` hands over a shared texture. It is converted on the GPU and
 * released the moment the GPU is done with it — or at once, if the converter
 * is still busy with earlier frames, in which case that frame is dropped.
 * Textures are never queued: Chromium's pool is small, and holding them stalls
 * rendering.
 *
 * Any error disables GPU capture for the surface; the surface then rebuilds
 * its window on the CPU path (`onFallback`), so the operator keeps picture.
 */
import type { OffscreenSharedTexture, TextureInfo } from 'electron'
import type { FrameRing, GpuFramesAddon, GpuFramesLoad } from '../gpu-frames'
import type { SyphonChannel } from '../syphon'

const WIDTH = 1920
const HEIGHT = 1080

/** The parts of Electron's shared texture this uses. */
export type SharedTexture = Pick<OffscreenSharedTexture, 'release'> & { textureInfo: Pick<TextureInfo, 'sharedTextureHandle'> }

/** What a surface delivers converted frames to. */
export type CaptureTarget =
  /** NDI: UYVA buffers into the sender, which keeps transparency for keying. */
  | { kind: 'ndi'; deliver: (uyva: Buffer, width: number, height: number) => void }
  /** Video card: UYVY into the shared ring the DeckLink helper reads. */
  | { kind: 'ring'; ring: FrameRing }
  /** Syphon: the texture itself, copied as it is into the Syphon server's surface. */
  | { kind: 'syphon'; channel: SyphonChannel }

/**
 * One painted texture for `count` consumers: each gets its own handle, and the
 * texture goes back to Chromium once every one of them has released it.
 */
export function shareTexture(texture: SharedTexture, count: number): SharedTexture[] {
  let left = count
  const release = (): void => {
    if (--left === 0) texture.release()
  }
  return Array.from({ length: count }, () => {
    let released = false
    return {
      textureInfo: texture.textureInfo,
      release: () => {
        if (released) return
        released = true
        release()
      },
    }
  })
}

export class GpuCapture {
  private converter: ReturnType<GpuFramesAddon['open']> | null
  private failed = false

  private constructor(
    private readonly addon: GpuFramesAddon,
    private readonly target: CaptureTarget,
    private readonly onFallback: (reason: string) => void,
  ) {
    // Syphon takes the texture as painted, so it needs no converter.
    this.converter = target.kind === 'syphon'
      ? null
      : target.kind === 'ring'
        ? addon.open({ width: target.ring.width, height: target.ring.height, ring: target.ring.handle })
        : addon.open({ width: WIDTH, height: HEIGHT, alpha: true })
  }

  /**
   * A capture for `target`, or why the CPU path is used instead. Never throws.
   */
  static create(
    load: GpuFramesLoad,
    target: CaptureTarget | null,
    onFallback: (reason: string) => void,
  ): { capture: GpuCapture } | { reason: string } {
    if (!load.ok) return { reason: load.reason }
    if (!target) return { reason: 'sink has no GPU frame path' }
    try {
      return { capture: new GpuCapture(load.addon, target, onFallback) }
    } catch (error) {
      return { reason: `converter failed to open: ${(error as Error).message}` }
    }
  }

  /** Converts one painted texture. Always releases it, now or when the GPU is done. */
  handle(texture: SharedTexture): void {
    if (this.target.kind === 'syphon') {
      this.target.channel.publish(texture)
      return
    }
    const converter = this.converter
    if (!converter || this.failed) { texture.release(); return }
    let started = false
    try {
      started = this.addon.convert(converter, texture.textureInfo.sharedTextureHandle, (error, result) => {
        texture.release()
        if (error) { this.fail(error.message); return }
        if (this.target.kind === 'ndi' && Buffer.isBuffer(result)) {
          try { this.target.deliver(result, WIDTH, HEIGHT) } catch { /* the sink logs its own failures */ }
        }
        // Ring frames are already published by the addon; the helper picks them up.
      })
    } catch (error) {
      texture.release()
      this.fail((error as Error).message)
      return
    }
    // Busy: the frame is dropped and the next paint carries newer pixels.
    if (!started) texture.release()
  }

  stats(): ReturnType<GpuFramesAddon['stats']> | null {
    return this.converter ? this.addon.stats(this.converter) : null
  }

  /** Waits for in-flight GPU work, which also releases its textures. */
  close(): void {
    const converter = this.converter
    this.converter = null
    if (converter) {
      try { this.addon.close(converter) } catch { /* teardown must not throw */ }
    }
  }

  private fail(reason: string): void {
    if (this.failed) return
    this.failed = true
    this.onFallback(reason)
  }
}

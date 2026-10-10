import log from 'electron-log/main'
import { NDI_SENDER_NAME, PRODUCT_NAME } from '@shared/brand'
import { loadNdiProvider, type ProviderLoadResult } from './provider-loader'
import type { NdiAudioFrame, NdiProvider, NdiSender, NdiVideoFrame } from './provider'

// ─── Constants ────────────────────────────────────────────────────────────────

const WIDTH = 1920
const HEIGHT = 1080
const SENDER_NAME = NDI_SENDER_NAME
/** ~10fps repeat loop of the last rendered frame (D — NdiService.start()). */
const FRAME_INTERVAL_MS = 100
const FRAME_RATE_N = 30000
const FRAME_RATE_D = 1001
/** Native `frameFormatType` — FORMAT_TYPE_PROGRESSIVE. */
const FRAME_FORMAT_PROGRESSIVE = 1
/**
 * 'BGRA' fourCC per the NDI SDK (`NDIlib_FourCC_video_type_BGRA`). Verified
 * directly against the installed native binding, which
 * passes this number straight through to `NDIlib_FourCC_video_type_e` — it is
 * NOT read from a runtime export (the module's TS `FourCC` enum is a
 * `const enum` and does not exist in the compiled JS, so callers must hardcode
 * the raw integer). Electron's `nativeImage` bitmap data is BGRA-ordered on
 * macOS, so this is the correct fourCC for frames sourced from `getBitmap()`.
 */
const FOURCC_BGRA = 1095911234

/** Backoff between sender-creation attempts, so repeated pushes cannot hammer NDI. */
const RETRY_COOLDOWN_MS = 5000

// ─── Minimal native surface is now behind NdiProvider (see provider.ts) ───────
// Frame shape re-exported for the provider boundary; values below are unchanged.

export type { NdiVideoFrame }

// ─── Service ──────────────────────────────────────────────────────────────────

class NdiService {
  private provider: NdiProvider | null = null
  /** Kept so extra channels can share the provider that already loaded. */
  private loaded: Extract<ProviderLoadResult, { ok: true }> | null = null
  private sender: NdiSender | null = null
  private available = false
  private sending = false
  private frameTimer: ReturnType<typeof setTimeout> | null = null
  /** True while `sendVideo` is in flight, so ticks can never stack up. */
  private sendingFrame = false
  /** False once `stop()` runs, so the self-scheduling loop unwinds. */
  private frameLoopActive = false
  /** Set when new pixels arrive, so the next content reaches NDI immediately. */
  private frameDirty = false
  private currentFrame: Buffer
  private starting: Promise<void> | null = null
  /** Why the last sender attempt failed, surfaced in status and logs. */
  private senderError: string | null = null
  /** Earliest time another attempt may run — see RETRY_COOLDOWN_MS. */
  private retryAfter = 0
  private audioWarnedAt = 0

  /**
   * @param senderName The NDI source name. The primary sender keeps the legacy
   *   name so existing ProPresenter video-input bindings still find it; extra
   *   feeds come from `createChannel`.
   */
  constructor(
    loadResult?: ProviderLoadResult,
    readonly senderName: string = SENDER_NAME,
  ) {
    this.currentFrame = Buffer.alloc(WIDTH * HEIGHT * 4, 0) // fully transparent (alpha 0)

    // Dependency loading stays lazy and inside error handling per plan — a
    // missing/broken native module must never crash main; everything else
    // here just no-ops. Injectable for tests via loadResult. The loader
    // itself is also guarded: under a future ESM bundle `require` may not
    // exist, and that must degrade to NDI-unavailable, not a startup crash.
    let result: ProviderLoadResult
    try {
      result = loadResult ?? loadNdiProvider()
    } catch (err) {
      result = { ok: false, reason: `provider loader threw: ${(err as Error).message}` }
    }
    if (result.ok) {
      this.loaded = result
      this.provider = result.provider
      this.available = true
      try {
        log.info('[NDI] provider loaded', { sdkVersion: this.provider.version() })
      } catch {
        log.info('[NDI] provider loaded')
      }
    } else {
      this.available = false
      log.warn('[NDI] NDI unavailable — NDI features disabled', { error: result.reason })
    }
  }

  /**
   * A second, independent sender on the same loaded provider — one per extra
   * `ndi` output. Null when NDI is unavailable on this machine.
   */
  createChannel(senderName: string): NdiService | null {
    if (!this.available || !this.loaded) return null
    return new NdiService(this.loaded, senderName)
  }

  getStatus(): { available: boolean; sending: boolean; senderError: string | null } {
    return { available: this.available, sending: this.sending, senderError: this.senderError }
  }

  /** Idempotent — safe to call multiple times (e.g. app launch + explicit retry). */
  /**
   * Creates the NDI sender, retrying on a later call if it failed.
   *
   * The commonest failure is a second copy of the app already holding
   * SENDER_NAME — an NDI sender name is exclusive. That is transient: quit the
   * duplicate and the name frees up. So a failure must NOT disable NDI for the
   * rest of the process, or the only cure for a momentary clash is a restart.
   */
  async start(): Promise<void> {
    if (!this.available || this.sender) return
    if (this.starting) return this.starting
    if (Date.now() < this.retryAfter) return
    this.starting = this._start()
    return this.starting
  }

  private async _start(): Promise<void> {
    try {
      this.sender = await this.provider!.createSender({ name: this.senderName, clockVideo: true })
      this.sending = true
      this.senderError = null
      log.info('[NDI] Sender created', { name: this.senderName, width: WIDTH, height: HEIGHT })
      this.startFrameLoop()
    } catch (err) {
      this.senderError = (err as Error).message
      this.sending = false
      this.retryAfter = Date.now() + RETRY_COOLDOWN_MS
      log.error(
        `[NDI] Sender creation failed — will retry. Is a second copy of ${PRODUCT_NAME} running?`,
        this.senderError,
      )
    } finally {
      this.starting = null
    }
  }

  /**
   * Repeat loop for the current frame.
   *
   * Self-scheduling rather than `setInterval`: `sendVideo` is async and, on a
   * busy machine, can take longer than one tick. An interval keeps queueing
   * callbacks behind a slow send, and the backlog only grows — which is how a
   * long slideshow ended up minutes of frames behind what the operator saw.
   * Here the next tick is only scheduled once the previous send has returned.
   */
  private startFrameLoop(): void {
    if (this.frameLoopActive) return
    this.frameLoopActive = true
    const tick = (): void => {
      if (!this.frameLoopActive) return
      this.frameTimer = setTimeout(() => {
        void this.pushFrame().finally(tick)
      }, FRAME_INTERVAL_MS)
    }
    tick()
  }

  private async pushFrame(): Promise<void> {
    if (!this.sender || this.sendingFrame) return
    this.sendingFrame = true
    this.frameDirty = false
    try {
      await this.sendCurrentFrame()
    } catch (err) {
      log.error('[NDI] Frame push failed', (err as Error).message)
    } finally {
      this.sendingFrame = false
    }
  }

  private async sendCurrentFrame(): Promise<void> {
    if (!this.sender) return
    const frame: NdiVideoFrame = {
      xres: WIDTH,
      yres: HEIGHT,
      frameRateN: FRAME_RATE_N,
      frameRateD: FRAME_RATE_D,
      pictureAspectRatio: WIDTH / HEIGHT,
      frameFormatType: FRAME_FORMAT_PROGRESSIVE,
      lineStrideBytes: WIDTH * 4,
      data: this.currentFrame,
      fourCC: FOURCC_BGRA,
    }
    await this.sender.sendVideo(frame)
  }

  /** Called by the offscreen overlay window's 'paint' handler with the latest BGRA bitmap. */
  updateFrame(bgraBuffer: Buffer, width: number, height: number): void {
    if (width !== WIDTH || height !== HEIGHT) {
      log.warn('[NDI] updateFrame size mismatch — ignoring frame', { width, height })
      return
    }
    this.currentFrame = bgraBuffer
    this.frameDirty = true
    // New pixels go out now instead of waiting for the next repeat tick — that
    // wait was pure latency between a page turn and the wall.
    if (!this.sendingFrame) void this.pushFrame()
  }

  /**
   * Whether this machine's NDI binding can carry sound. Known from the adapter
   * before a sender exists.
   */
  get audioSupported(): boolean {
    if (this.sender) return typeof this.sender.sendAudio === 'function'
    return this.loaded?.adapter === 'grandi'
  }

  /** One block of program sound. Dropped silently when audio is unsupported. */
  sendAudio(frame: NdiAudioFrame): void {
    const sender = this.sender
    if (!sender?.sendAudio) return
    sender.sendAudio(frame).catch((err: unknown) => {
      // ~47 blocks a second: one line per 10 s is plenty.
      if (Date.now() - this.audioWarnedAt < 10_000) return
      this.audioWarnedAt = Date.now()
      log.warn('[NDI] Audio frame failed', (err as Error).message)
    })
  }

  /** True once new pixels have been handed to the sender. */
  get hasPendingFrame(): boolean {
    return this.frameDirty
  }

  /** Resets the repeating frame back to fully transparent (D2 clear semantics). */
  clearFrame(): void {
    this.currentFrame = Buffer.alloc(WIDTH * HEIGHT * 4, 0)
    this.frameDirty = true
    if (!this.sendingFrame) void this.pushFrame()
  }

  async stop(): Promise<void> {
    this.frameLoopActive = false
    if (this.frameTimer) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
    this.sending = false
    // The legacy native binding exposes no explicit destroy()/close() on the
    // Sender — the native NDI sender is released via a GC finalizer tied to
    // the `embedded` external value (confirmed by reading the native send
    // source). Dropping the last reference here makes it eligible for
    // collection; the NDI runtime also tears down at process exit regardless.
    // Providers with an explicit destroy() get it called best-effort. This
    // does not hang app quit — there is nothing to await.
    const sender = this.sender
    this.sender = null
    try {
      await sender?.destroy?.()
    } catch {
      /* teardown must never throw */
    }
  }
}

/** Test seam — same class, injectable provider result. */
export { NdiService }

export const ndiService = new NdiService()

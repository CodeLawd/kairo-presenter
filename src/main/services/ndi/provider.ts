/**
 * Platform-neutral NDI provider boundary (Plan 002).
 *
 * NdiService owns frame scheduling and current-frame state. Everything that
 * touches a native binding lives behind NdiProvider so platform loading,
 * tests, and future native upgrades never alter orchestration or renderer
 * behavior.
 */

export interface NdiVideoFrame {
  xres: number
  yres: number
  frameRateN: number
  frameRateD: number
  pictureAspectRatio: number
  frameFormatType: number
  lineStrideBytes: number
  data: Buffer
  fourCC: number
}

/** 32-bit float planar audio (NDI FourCC 'FLTp'): every channel's samples back to back. */
export interface NdiAudioFrame {
  sampleRate: number
  channels: number
  samples: number
  /** `samples * 4` for tightly packed planar floats. */
  channelStrideBytes: number
  data: Buffer
}

/** NDI FourCC for float planar audio ('FLTp'). */
export const FOURCC_AUDIO_FLTP = 1884572742

export interface NdiSender {
  sendVideo(frame: NdiVideoFrame): Promise<void>
  /** Absent when the native binding cannot send audio. */
  sendAudio?(frame: NdiAudioFrame): Promise<void>
  /** Optional explicit teardown; without it the binding relies on GC finalizers. */
  destroy?(): Promise<void> | void
}

export interface NdiSourceInfo {
  name: string
  url?: string
}

export interface NdiCreateSenderOptions {
  name: string
  clockVideo?: boolean
  clockAudio?: boolean
}

export interface NdiProvider {
  /** Stable adapter name for logs, e.g. 'grandi'. */
  readonly name: string
  version(): string
  createSender(opts: NdiCreateSenderOptions): Promise<NdiSender>
  findSources?(timeoutMs?: number): Promise<NdiSourceInfo[]>
}

// ─── grandi (tux-tn, NDI 6) shape ────────────────────────────────────────────
// The grandi API is finder/sender object based (`grandi.find()` …). The exact
// surface is resolved defensively so a version bump cannot crash main at
// require time — mismatches surface as a typed unavailable result instead.

interface GrandiLikeModule {
  version?: () => string
  default?: GrandiLikeModule
  find?: (...args: unknown[]) => Promise<unknown>
  send?: (opts: { name: string; clockVideo?: boolean; clockAudio?: boolean }) => Promise<{
    video: (frame: NdiVideoFrame) => Promise<void>
    audio?: (frame: NdiAudioFrame & { fourCC: number }) => Promise<void>
  }>
}

function unwrapDefault<T>(mod: T & { default?: unknown }): T {
  if (mod && typeof mod === 'object' && 'default' in mod && mod.default) {
    return (mod as { default: T }).default
  }
  return mod
}

export function createGrandiProvider(nativeRaw: GrandiLikeModule): NdiProvider {
  const native = unwrapDefault(nativeRaw)
  return {
    name: 'grandi',
    version: () => {
      if (typeof native.version === 'function') return native.version()
      return 'unknown (grandi)'
    },
    async createSender(opts) {
      // grandiose-compatible `send()` if present (some forks expose it).
      if (typeof native.send === 'function') {
        const sender = await native.send({ name: opts.name, clockVideo: opts.clockVideo })
        const audio = typeof sender.audio === 'function' ? sender.audio.bind(sender) : null
        return {
          sendVideo: (frame) => sender.video(frame),
          // Video is the clocked stream; audio frames go out as they arrive.
          ...(audio ? { sendAudio: (frame: NdiAudioFrame) => audio({ ...frame, fourCC: FOURCC_AUDIO_FLTP }) } : {}),
        }
      }
      throw new Error('grandi adapter: sender creation not supported by installed version')
    },
    async findSources(timeoutMs = 1000) {
      if (typeof native.find !== 'function') return []
      const finder = (await native.find()) as {
        wait?: (ms: number) => Promise<void>
        sources?: () => NdiSourceInfo[]
        destroy?: () => void
      } | null
      if (!finder || typeof finder !== 'object') return []
      try {
        if (typeof finder.wait === 'function') await finder.wait(timeoutMs)
        if (typeof finder.sources === 'function') return finder.sources() ?? []
        return []
      } finally {
        try {
          finder.destroy?.()
        } catch {
          /* ignore teardown errors */
        }
      }
    },
  }
}

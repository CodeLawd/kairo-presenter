/**
 * Capture (macOS): records one output to a movie file — Live → Start Capture.
 *
 * The recording takes its picture from the output's own surface through a
 * frame tap (the same textures NDI / Syphon get, or a display window's frames)
 * and writes it with macOS's encoders (native/recorder). Nothing else about the
 * output changes while it records.
 *
 * Everything that touches Electron comes in through `CaptureDeps`, so this
 * runs under plain Node in tests.
 */
import log from 'electron-log/main'
import path from 'node:path'
import { PRODUCT_NAME } from '@shared/brand'
import {
  captureFileName,
  captureFrameSize,
  captureSourceFor,
  IDLE_CAPTURE_STATUS,
  type CaptureAudioInput,
  type CaptureSettings,
  type CaptureStatus,
} from '@shared/capture'
import type { OverlayOutput } from '@shared/ipc'
import type { FrameTap } from '../output/program-surface'

type Handle = { readonly __recorderHandle: unique symbol }

export interface RecorderStats {
  frames: number
  late: number
  skipped: number
  failed: number
  audioBuffers: number
  seconds: number
  error?: string
}

/** The native surface of native/recorder/recorder.mm. */
export interface RecorderAddon {
  available(): { ok: boolean; reason?: string }
  audioInputs(): CaptureAudioInput[]
  open(options: {
    path: string
    width: number
    height: number
    fps: number
    codec: string
    bitrate: number
    audioDeviceId: string
  }): Handle
  /** False when the previous frame is still being copied: this one is dropped. */
  pushTexture(recorder: Handle, sharedTextureHandle: Buffer, done: (error: Error | null) => void): boolean
  pushPixels(recorder: Handle, bgra: Buffer, width: number, height: number): boolean
  stop(recorder: Handle, done: (error: Error | null, result?: { path: string; frames: number; seconds: number }) => void): void
  stats(recorder: Handle): RecorderStats
}

export type RecorderLoad = { ok: true; addon: RecorderAddon } | { ok: false; reason: string }

export interface CaptureDeps {
  load(): RecorderLoad
  settings(): CaptureSettings
  outputs(): readonly OverlayOutput[]
  /** Hands an output's frames to `tap`, or stops (`null`). */
  attach(outputId: string, tap: FrameTap | null): void
  /** The width / height of what the output paints, or null when it isn't running. */
  sourceAspect(outputId: string): number | null
  defaultFolder(): string
  ensureFolder(folder: string): Promise<void>
  /** Free space on the disk holding `folder`, or null when it can't be told. */
  freeBytes(folder: string): Promise<number | null>
  /** Asks for the microphone permission if needed; false when refused. */
  microphoneAccess(): Promise<boolean>
  now(): number
}

/** Below this much free space a recording does not start… */
export const MIN_FREE_TO_START = 2 * 1024 ** 3
/** …and below this one in progress stops, so the file is finished rather than cut off. */
export const MIN_FREE_WHILE_RECORDING = 512 * 1024 ** 2
const POLL_MS = 1000
const DISK_CHECK_EVERY = 10

interface Session {
  handle: Handle
  addon: RecorderAddon
  outputId: string
  sourceName: string
  path: string
  startedAt: number
  fps: number
  poll: ReturnType<typeof setInterval>
  polls: number
  lateSeen: number
  folder: string
  warnedPush: boolean
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export class CaptureService {
  private session: Session | null = null
  private starting: Promise<CaptureStatus> | null = null
  private stopping: Promise<CaptureStatus> | null = null
  private last: Pick<CaptureStatus, 'path' | 'sourceName' | 'error'> = { path: null, sourceName: null, error: null }
  private warning: string | null = null
  private listeners = new Set<(status: CaptureStatus) => void>()

  constructor(private readonly deps: CaptureDeps) {}

  onStatus(listener: (status: CaptureStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const status = this.status()
    for (const listener of this.listeners) listener(status)
  }

  status(): CaptureStatus {
    const loaded = this.deps.load()
    const s = this.session
    return {
      ...IDLE_CAPTURE_STATUS,
      available: loaded.ok,
      ...(loaded.ok ? {} : { reason: loaded.reason }),
      recording: !!s,
      startedAt: s?.startedAt ?? null,
      path: s?.path ?? this.last.path,
      sourceName: s?.sourceName ?? this.last.sourceName,
      error: s ? null : this.last.error,
      warning: s ? this.warning : null,
    }
  }

  audioInputs(): CaptureAudioInput[] {
    const loaded = this.deps.load()
    if (!loaded.ok) return []
    try {
      return loaded.addon.audioInputs()
    } catch {
      return []
    }
  }

  get recording(): boolean {
    return !!this.session
  }

  /** Starts recording with the saved Capture settings. Never throws; a failure is in `error`. */
  start(): Promise<CaptureStatus> {
    if (this.session) return Promise.resolve(this.status())
    this.starting ??= this.begin().finally(() => { this.starting = null })
    return this.starting
  }

  private refuse(error: string): CaptureStatus {
    this.last = { ...this.last, error }
    log.warn('[Capture] could not start', { error })
    this.emit()
    return this.status()
  }

  private async begin(): Promise<CaptureStatus> {
    const loaded = this.deps.load()
    if (!loaded.ok) return this.refuse(loaded.reason)
    const settings = this.deps.settings()
    const output = captureSourceFor(settings, this.deps.outputs())
    if (!output) return this.refuse('Add a screen in Screens first — a recording takes its picture from one')
    if (!output.enabled) return this.refuse(`${output.name} is off — turn it on in Screens to record it`)
    const aspect = this.deps.sourceAspect(output.id)
    if (aspect === null) return this.refuse(`${output.name} isn’t showing — check it in Screens`)

    const folder = settings.folder || this.deps.defaultFolder()
    try {
      await this.deps.ensureFolder(folder)
    } catch (error) {
      return this.refuse(`Can’t save to ${folder}: ${(error as Error).message}`)
    }
    const free = await this.deps.freeBytes(folder).catch(() => null)
    if (free !== null && free < MIN_FREE_TO_START) {
      return this.refuse(`Only ${gigabytes(free)} free on that disk — free some space or choose another folder`)
    }

    if (settings.audioDeviceId) {
      if (!(await this.deps.microphoneAccess())) {
        return this.refuse('Kairo isn’t allowed to record sound — allow it in System Settings → Privacy & Security → Microphone')
      }
      const inputs = this.audioInputs()
      if (!inputs.some((input) => input.id === settings.audioDeviceId)) {
        return this.refuse(`${settings.audioDeviceName || 'The audio input'} isn’t connected — plug it in or choose another in Capture Settings`)
      }
    }
    // A second Start while the checks above ran is the same recording.
    if (this.session) return this.status()

    const { width, height } = captureFrameSize(settings.resolution, aspect)
    const startedAt = this.deps.now()
    const file = path.join(folder, captureFileName(PRODUCT_NAME, output.name, new Date(startedAt)))
    let handle: Handle
    try {
      handle = loaded.addon.open({
        path: file,
        width,
        height,
        fps: settings.frameRate,
        codec: settings.codec,
        bitrate: settings.bitrateMbps * 1_000_000,
        audioDeviceId: settings.audioDeviceId,
      })
    } catch (error) {
      return this.refuse((error as Error).message.replace(/^open: /, ''))
    }

    const session: Session = {
      handle,
      addon: loaded.addon,
      outputId: output.id,
      sourceName: output.name,
      path: file,
      startedAt,
      fps: settings.frameRate,
      poll: setInterval(() => void this.check(session), POLL_MS),
      polls: 0,
      lateSeen: 0,
      folder,
      warnedPush: false,
    }
    // The app's windows keep it running; the check alone must never hold a process open.
    session.poll.unref?.()
    this.session = session
    this.warning = null
    this.last = { path: file, sourceName: output.name, error: null }
    this.deps.attach(output.id, this.tapFor(session))
    log.info('[Capture] recording', { file, source: output.name, width, height, fps: settings.frameRate, codec: settings.codec, audio: !!settings.audioDeviceId })
    this.emit()
    return this.status()
  }

  private tapFor(session: Session): FrameTap {
    const { addon, handle } = session
    const failed = (error: unknown): void => {
      if (session.warnedPush) return
      session.warnedPush = true
      log.warn('[Capture] frame not recorded', { error: (error as Error).message })
    }
    return {
      fps: session.fps,
      texture: (texture) => {
        if (this.session !== session) { texture.release(); return }
        try {
          const started = addon.pushTexture(handle, texture.textureInfo.sharedTextureHandle, (error) => {
            texture.release()
            if (error) failed(error)
          })
          // Busy: dropped; the next paint carries newer pixels.
          if (!started) texture.release()
        } catch (error) {
          texture.release()
          failed(error)
        }
      },
      pixels: (bgra, width, height) => {
        if (this.session !== session) return
        try {
          addon.pushPixels(handle, bgra, width, height)
        } catch (error) {
          failed(error)
        }
      },
    }
  }

  /** Once a second: writer failures, a struggling encoder, a vanished source, a filling disk. */
  private async check(session: Session): Promise<void> {
    if (this.session !== session) return
    session.polls++
    let stats: RecorderStats
    try {
      stats = session.addon.stats(session.handle)
    } catch (error) {
      await this.finish(session, (error as Error).message)
      return
    }
    if (stats.error) {
      await this.finish(session, `Recording stopped: ${stats.error}`)
      return
    }
    if (session.polls % DISK_CHECK_EVERY === 0) {
      const free = await this.deps.freeBytes(session.folder).catch(() => null)
      if (this.session !== session) return
      if (free !== null && free < MIN_FREE_WHILE_RECORDING) {
        await this.finish(session, `Recording stopped: the disk is nearly full (${gigabytes(free)} left)`)
        return
      }
    }
    const newlyLate = stats.late - session.lateSeen
    session.lateSeen = stats.late
    const warning =
      this.deps.sourceAspect(session.outputId) === null
        ? `${session.sourceName} isn’t showing — recording black until it’s back`
        : newlyLate > session.fps / 2
          ? 'This Mac is struggling to keep up — H.264 or 720p records with less work'
          : null
    if (warning !== this.warning) {
      this.warning = warning
      this.emit()
    }
  }

  /** Stops and finishes the file. Safe to call when nothing is recording. */
  stop(): Promise<CaptureStatus> {
    const session = this.session
    if (!session) return this.stopping ?? Promise.resolve(this.status())
    return this.finish(session, null)
  }

  private finish(session: Session, error: string | null): Promise<CaptureStatus> {
    if (this.session !== session) return this.stopping ?? Promise.resolve(this.status())
    this.session = null
    this.warning = null
    clearInterval(session.poll)
    this.deps.attach(session.outputId, null)
    this.stopping = new Promise<CaptureStatus>((resolve) => {
      const done = (problem: string | null): void => {
        this.last = { path: session.path, sourceName: session.sourceName, error: problem }
        if (problem) log.warn('[Capture] stopped with a problem', { file: session.path, error: problem })
        else log.info('[Capture] saved', { file: session.path })
        this.stopping = null
        this.emit()
        resolve(this.status())
      }
      try {
        session.addon.stop(session.handle, (stopError) => done(error ?? (stopError ? `The file could not be finished: ${stopError.message}` : null)))
      } catch (stopError) {
        done(error ?? (stopError as Error).message)
      }
    })
    this.emit()
    return this.stopping
  }
}

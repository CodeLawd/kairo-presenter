/**
 * Capture: recording one of Kairo's outputs to a movie file on this Mac
 * (Live → Start Capture), like ProPresenter's Capture. Settings and the
 * status the renderer shows; the recording itself is `src/main/services/capture`.
 */
import { isRenderedKind } from './overlay-outputs'
import type { OverlayOutput } from './ipc'

export type CaptureCodec = 'h264' | 'hevc' | 'prores422' | 'prores4444'
export type CaptureResolution = '1080p' | '720p'
export type CaptureFrameRate = 24 | 25 | 30 | 50 | 60

export interface CaptureSettings {
  /** The output recorded. '' (or one that is gone) = the first audience output. */
  sourceOutputId: string
  /** Where files go. '' = Movies/Kairo in the home folder. */
  folder: string
  codec: CaptureCodec
  resolution: CaptureResolution
  frameRate: CaptureFrameRate
  /** H.264 / HEVC average bitrate. ProRes sets its own. */
  bitrateMbps: number
  /** The audio input recorded with the picture (its system id). '' = no sound. */
  audioDeviceId: string
  /** Its name when chosen, so a disconnected input can still be named. */
  audioDeviceName: string
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  sourceOutputId: '',
  folder: '',
  codec: 'h264',
  resolution: '1080p',
  frameRate: 30,
  bitrateMbps: 12,
  audioDeviceId: '',
  audioDeviceName: '',
}

export const CAPTURE_CODECS: { value: CaptureCodec; label: string; hint: string }[] = [
  { value: 'h264', label: 'H.264', hint: 'Plays everywhere. Good for sharing and uploading.' },
  { value: 'hevc', label: 'HEVC (H.265)', hint: 'Same quality as H.264 in about half the space.' },
  { value: 'prores422', label: 'Apple ProRes 422', hint: 'For editing. Large files.' },
  { value: 'prores4444', label: 'Apple ProRes 4444', hint: 'For editing, with transparency — lyrics and lower thirds to key over video.' },
]

export const CAPTURE_RESOLUTIONS: { value: CaptureResolution; label: string; width: number }[] = [
  { value: '1080p', label: '1080p (1920 wide)', width: 1920 },
  { value: '720p', label: '720p (1280 wide)', width: 1280 },
]

export const CAPTURE_FRAME_RATES: CaptureFrameRate[] = [24, 25, 30, 50, 60]

export const CAPTURE_BITRATES: { value: number; label: string }[] = [
  { value: 6, label: 'Small — 6 Mbps' },
  { value: 12, label: 'Standard — 12 Mbps' },
  { value: 20, label: 'High — 20 Mbps' },
  { value: 40, label: 'Very high — 40 Mbps' },
]

/** About how much disk an hour takes, in GB — shown beside the codec. */
export function gigabytesPerHour(settings: CaptureSettings): number {
  if (settings.codec === 'h264' || settings.codec === 'hevc') return (settings.bitrateMbps * 3600) / 8 / 1000
  // Apple's published ProRes rates at 1080p29.97, scaled by size and rate.
  const mbps1080p30 = settings.codec === 'prores4444' ? 330 : 147
  const pixels = settings.resolution === '720p' ? (1280 * 720) / (1920 * 1080) : 1
  return (mbps1080p30 * pixels * (settings.frameRate / 30) * 3600) / 8 / 1000
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function normalizeCaptureSettings(value: unknown): CaptureSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<CaptureSettings>
  const d = DEFAULT_CAPTURE_SETTINGS
  const text = (x: unknown): string => (typeof x === 'string' ? x : '')
  const bitrate = Number(v.bitrateMbps)
  return {
    sourceOutputId: text(v.sourceOutputId),
    folder: text(v.folder),
    codec: oneOf(v.codec, CAPTURE_CODECS.map((c) => c.value), d.codec),
    resolution: oneOf(v.resolution, CAPTURE_RESOLUTIONS.map((r) => r.value), d.resolution),
    frameRate: oneOf(Number(v.frameRate) as CaptureFrameRate, CAPTURE_FRAME_RATES, d.frameRate),
    bitrateMbps: Number.isFinite(bitrate) ? Math.min(100, Math.max(2, Math.round(bitrate))) : d.bitrateMbps,
    audioDeviceId: text(v.audioDeviceId),
    audioDeviceName: text(v.audioDeviceName),
  }
}

/** Outputs a recording can take its picture from: any rendered output. */
export function captureSources(outputs: readonly OverlayOutput[]): OverlayOutput[] {
  return outputs.filter((o) => isRenderedKind(o.kind))
}

/** The output a recording takes: the chosen one, else the first audience screen, else any. */
export function captureSourceFor(settings: CaptureSettings, outputs: readonly OverlayOutput[]): OverlayOutput | null {
  const sources = captureSources(outputs)
  return (
    sources.find((o) => o.id === settings.sourceOutputId) ??
    sources.find((o) => o.kind === 'screen' && o.enabled) ??
    sources.find((o) => o.enabled) ??
    // Every output is off: name one, so the operator is told to turn it on.
    sources[0] ??
    null
  )
}

/** The recording's frame: the chosen width at the source's shape, both even (encoders need it). */
export function captureFrameSize(resolution: CaptureResolution, aspect: number): { width: number; height: number } {
  const width = CAPTURE_RESOLUTIONS.find((r) => r.value === resolution)?.width ?? 1920
  const shape = Number.isFinite(aspect) && aspect > 0.2 && aspect < 5 ? aspect : 16 / 9
  const height = Math.max(2, Math.round(width / shape / 2) * 2)
  return { width, height }
}

/** "Kairo Main Screen 2026-10-20 10.30.05.mov" — sorts by time, safe on every filesystem. */
export function captureFileName(product: string, sourceName: string, at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`
  const source = [...sourceName].filter((c) => c >= ' ' && !'\\/:*?"<>|'.includes(c)).join('').trim()
  return `${[product, source, stamp].filter(Boolean).join(' ')}.mov`
}

export interface CaptureAudioInput {
  id: string
  name: string
}

export interface CaptureStatus {
  /** False off a Mac or without the recorder addon; `reason` says why. */
  available: boolean
  reason?: string
  recording: boolean
  /** Epoch ms the current recording started. */
  startedAt: number | null
  /** The file being written, or the last one finished. */
  path: string | null
  /** The output being (or last) recorded. */
  sourceName: string | null
  /** Why the last recording stopped on its own, or could not start. */
  error: string | null
  /** A problem while recording that has not stopped it (frames late, source not showing). */
  warning: string | null
}

export const IDLE_CAPTURE_STATUS: CaptureStatus = {
  available: false,
  recording: false,
  startedAt: null,
  path: null,
  sourceName: null,
  error: null,
  warning: null,
}

export interface CaptureAPI {
  status: () => Promise<CaptureStatus>
  /** Starts with the saved settings. A refusal comes back in `error`, never as a throw. */
  start: () => Promise<CaptureStatus>
  /** Stops and finishes the file. */
  stop: () => Promise<CaptureStatus>
  audioInputs: () => Promise<CaptureAudioInput[]>
  /** Folder picker for Save To; null when cancelled. Saves the choice. */
  chooseFolder: () => Promise<string | null>
  /** Shows the last recording in Finder, or the folder when there is none yet. */
  reveal: () => Promise<void>
  onStatus: (callback: (status: CaptureStatus) => void) => () => void
}

/** "1:02:03" / "4:05" — the elapsed time on the Live button. */
export function formatCaptureElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

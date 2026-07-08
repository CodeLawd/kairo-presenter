import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { spawn, type ChildProcess } from 'child_process'
import log from 'electron-log/main'
import type { AudioLevel } from '@shared/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioTestResult {
  deviceId: string
  durationMs: number
  averageRms: number
  peakRms: number
  hasSpeech: boolean
  sampleCount: number
  error?: string
}

export type AudioCaptureErrorCode =
  | 'DEVICE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'CAPTURE_FAILED'
  | 'SOX_NOT_FOUND'
  | 'UNKNOWN'

export interface AudioCaptureError {
  code: AudioCaptureErrorCode
  message: string
}

// ─── Typed EventEmitter ───────────────────────────────────────────────────────

interface AudioCaptureEvents {
  data:          [chunk: Buffer]
  level:         [level: AudioLevel]
  started:       [deviceId: string]
  stopped:       []
  error:         [err: AudioCaptureError]
  deviceChanged: [deviceId: string]
}

export declare interface AudioCaptureService {
  on<K extends keyof AudioCaptureEvents>(event: K, listener: (...args: AudioCaptureEvents[K]) => void): this
  emit<K extends keyof AudioCaptureEvents>(event: K, ...args: AudioCaptureEvents[K]): boolean
  off<K extends keyof AudioCaptureEvents>(event: K, listener: (...args: AudioCaptureEvents[K]) => void): this
  once<K extends keyof AudioCaptureEvents>(event: K, listener: (...args: AudioCaptureEvents[K]) => void): this
}

// ─── PCM math ─────────────────────────────────────────────────────────────────

function computeRMS(buf: Buffer): number {
  const numSamples = Math.floor(buf.length / 2)
  if (numSamples === 0) return 0
  let sum = 0
  for (let i = 0; i < buf.length - 1; i += 2) {
    const s = buf.readInt16LE(i) / 32768
    sum += s * s
  }
  return Math.sqrt(sum / numSamples)
}

function computePeak(buf: Buffer): number {
  let peak = 0
  for (let i = 0; i < buf.length - 1; i += 2) {
    const abs = Math.abs(buf.readInt16LE(i)) / 32768
    if (abs > peak) peak = abs
  }
  return peak
}

// ─── Sox command builder ──────────────────────────────────────────────────────

/** Returns [cmd, args, env] for spawning sox to capture raw 16kHz mono PCM on stdout. */
function buildSoxCommand(
  deviceId: string | null
): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const env = { ...process.env }

  // On macOS, sox uses CoreAudio. AUDIODEV selects the device.
  // On Linux, AUDIODEV can be hw:X,Y; on Windows, the device name.
  if (deviceId && deviceId !== 'default') {
    env['AUDIODEV'] = deviceId
  }

  // 'rec' is the SoX recording frontend; same binary as 'sox' on most installs.
  // Falls back to 'sox' with --default-device on macOS if rec isn't found.
  const cmd = process.platform === 'win32' ? 'sox' : 'rec'

  const args: string[] = [
    '-q',                     // quiet (no progress output)
    '-r', '16000',            // 16 kHz
    '-c', '1',                // mono
    '-e', 'signed-integer',   // encoding
    '-b', '16',               // 16-bit
    '-t', 'raw',              // raw PCM, no header
    '-',                      // output to stdout
  ]

  // On macOS, prepend type flag so sox uses CoreAudio for the source
  if (process.platform === 'darwin') {
    args.unshift('-t', 'coreaudio')
    // When a specific device is selected, it goes right after the type
    if (deviceId && deviceId !== 'default') {
      args.splice(2, 0, deviceId) // insert after '-t coreaudio'
    } else {
      args.splice(2, 0, 'default')
    }
  }

  return { cmd, args, env }
}

/** Classify a sox/rec stderr message into an error code. */
function classifyError(msg: string): AudioCaptureErrorCode {
  const lower = msg.toLowerCase()
  if (lower.includes('no such device') || lower.includes('device not found') || lower.includes('cannot find')) {
    return 'DEVICE_NOT_FOUND'
  }
  if (lower.includes('permission') || lower.includes('access denied') || lower.includes('eperm')) {
    return 'PERMISSION_DENIED'
  }
  if (lower.includes('command not found') || lower.includes('enoent') || lower.includes('not found')) {
    return 'SOX_NOT_FOUND'
  }
  return 'CAPTURE_FAILED'
}

// ─── Service ──────────────────────────────────────────────────────────────────

// ~15 fps level updates
const LEVEL_INTERVAL_MS = 67

// Peak hold decays multiplicatively per emission
const PEAK_DECAY = 0.94

// Max accumulated buffer size safety cap
const BUFFER_MAX = 512 * 1024

export class AudioCaptureService extends EventEmitter {
  private proc: ChildProcess | null = null
  private outputStream: PassThrough | null = null
  private capturing = false
  private currentDeviceId: string | null = null

  // Level state
  private levelTimer: NodeJS.Timeout | null = null
  private accumulator: Buffer[] = []
  private accumulatedBytes = 0
  private peakLevel = 0

  // ─── Public state ─────────────────────────────────────────────────────────

  get isCapturing(): boolean {
    return this.capturing }

  get deviceId(): string | null {
    return this.currentDeviceId
  }

  /** Returns the raw PCM PassThrough stream — pipe directly to Deepgram WebSocket. */
  getStream(): PassThrough | null {
    return this.outputStream
  }

  // ─── Start / Stop ──────────────────────────────────────────────────────────

  async start(deviceId: string): Promise<void> {
    if (this.capturing) {
      log.warn('[Audio] start() called while already capturing — stopping first')
      await this.stop()
    }

    log.info('[Audio] Starting capture', { deviceId })

    // Check sox is available
    const soxAvailable = await this.checkSox()
    if (!soxAvailable) {
      this.emitErr({
        code: 'SOX_NOT_FOUND',
        message:
          'SoX (Sound eXchange) is not installed. Install it with: brew install sox (macOS) or apt install sox (Linux)',
      })
      return
    }

    this.outputStream = new PassThrough()
    this.currentDeviceId = deviceId
    this.capturing = true
    this.peakLevel = 0

    const { cmd, args, env } = buildSoxCommand(deviceId)
    log.debug('[Audio] Spawning', { cmd, args: args.join(' ') })

    try {
      this.proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      this.capturing = false
      this.emitErr({ code: 'SOX_NOT_FOUND', message: `Failed to spawn ${cmd}: ${(err as Error).message}` })
      return
    }

    const proc = this.proc

    // ── stdout → PCM data ────────────────────────────────────────────────────
    proc.stdout!.on('data', (chunk: Buffer) => {
      if (!this.capturing) return

      // Forward to consumers
      this.outputStream?.write(chunk)
      this.emit('data', chunk)

      // Accumulate for level computation (bounded)
      if (this.accumulatedBytes < BUFFER_MAX) {
        this.accumulator.push(chunk)
        this.accumulatedBytes += chunk.length
      }
    })

    // ── stderr → error detection ─────────────────────────────────────────────
    let stderrBuf = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      // Only log debug since sox writes informational stuff to stderr too
      log.debug('[Audio] sox stderr:', chunk.toString().trim())
    })

    // ── process exit ─────────────────────────────────────────────────────────
    proc.on('close', (code, signal) => {
      const wasCapturing = this.capturing
      this.cleanup()

      if (wasCapturing && signal !== 'SIGTERM' && signal !== 'SIGKILL' && code !== 0) {
        const msg = stderrBuf.trim() || `sox exited with code ${code}`
        log.error('[Audio] sox process exited unexpectedly', { code, signal, msg })
        this.emitErr({ code: classifyError(msg), message: msg })
      }
    })

    proc.on('error', (err) => {
      this.cleanup()
      const msg = err.message
      this.emitErr({
        code: classifyError(msg),
        message: `Audio capture process error: ${msg}`,
      })
    })

    this.startLevelTimer()
    this.emit('started', deviceId)
    log.info('[Audio] Capture started', { deviceId })
  }

  async stop(): Promise<void> {
    if (!this.capturing && !this.proc) return
    log.info('[Audio] Stopping capture')

    this.capturing = false
    this.stopLevelTimer()

    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }

    this.outputStream?.end()
    this.outputStream = null
    this.currentDeviceId = null
    this.accumulator = []
    this.accumulatedBytes = 0
    this.peakLevel = 0

    this.emit('stopped')
  }

  // ─── Test ──────────────────────────────────────────────────────────────────

  async test(deviceId: string, durationMs = 3_000): Promise<AudioTestResult> {
    const samples: number[] = []
    let testError: string | undefined

    const onLevel = (level: AudioLevel): void => {
      samples.push(level.rms)
    }
    const onError = (err: AudioCaptureError): void => {
      testError = err.message
    }

    this.on('level', onLevel)
    this.on('error', onError)

    try {
      await this.start(deviceId)

      if (testError) {
        // start() failed synchronously via error event
        return { deviceId, durationMs, averageRms: 0, peakRms: 0, hasSpeech: false, sampleCount: 0, error: testError }
      }

      await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
      await this.stop()
    } catch (err) {
      testError = (err as Error).message
      await this.stop().catch(() => undefined)
    } finally {
      this.off('level', onLevel)
      this.off('error', onError)
    }

    if (testError) {
      return { deviceId, durationMs, averageRms: 0, peakRms: 0, hasSpeech: false, sampleCount: 0, error: testError }
    }

    const avg = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0
    const peak = samples.length > 0 ? Math.max(...samples) : 0

    log.info('[Audio] Test complete', { deviceId, durationMs, avgRms: avg.toFixed(4), peakRms: peak.toFixed(4), samples: samples.length })

    return {
      deviceId,
      durationMs,
      averageRms: avg,
      peakRms: peak,
      hasSpeech: peak > 0.02,
      sampleCount: samples.length,
    }
  }

  // ─── Level timer ──────────────────────────────────────────────────────────

  private startLevelTimer(): void {
    this.levelTimer = setInterval(() => {
      if (this.accumulator.length === 0) {
        this.peakLevel *= PEAK_DECAY
        this.emit('level', {
          rms: 0,
          peak: this.peakLevel,
          clipping: false,
          timestamp: Date.now(),
        })
        return
      }

      const combined = Buffer.concat(this.accumulator)
      this.accumulator = []
      this.accumulatedBytes = 0

      const rms = computeRMS(combined)
      const chunkPeak = computePeak(combined)
      this.peakLevel = Math.max(chunkPeak, this.peakLevel * PEAK_DECAY)

      this.emit('level', {
        rms,
        peak: this.peakLevel,
        clipping: this.peakLevel > 0.99,
        timestamp: Date.now(),
      })
    }, LEVEL_INTERVAL_MS)
  }

  private stopLevelTimer(): void {
    if (this.levelTimer) {
      clearInterval(this.levelTimer)
      this.levelTimer = null
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private cleanup(): void {
    this.capturing = false
    this.stopLevelTimer()
    this.outputStream?.end()
    this.outputStream = null
    this.accumulator = []
    this.accumulatedBytes = 0
  }

  private emitErr(err: AudioCaptureError): void {
    log.error('[Audio] Error', err.code, err.message)
    this.emit('error', err)
  }

  private async checkSox(): Promise<boolean> {
    const cmd = process.platform === 'win32' ? 'where sox' : 'which rec || which sox'
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn('sh', ['-c', cmd], { stdio: 'ignore' })
        p.on('close', (code) => (code === 0 ? resolve() : reject()))
        p.on('error', reject)
      })
      return true
    } catch {
      return false
    }
  }
}

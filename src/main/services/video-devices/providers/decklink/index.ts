import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import log from 'electron-log/main'
import { createFrameRing, gpuFrames, type FrameRing, type GpuFramesLoad } from '../../../gpu-frames'
import type { VideoDeviceProvider, VideoOutputSink, VideoPort, VideoProviderStatus } from '../../provider'
import { openWorkerPlayback } from './worker-sink'
const execute = promisify(execFile)

/** Qualified native boundary: enumeration and playback execute out of process. */
export class DeckLinkProvider implements VideoDeviceProvider {
  readonly name = 'decklink'
  private scanned = false
  private version?: string
  private ports: VideoPort[] = []
  constructor(
    private readonly helperPath: string,
    /** Built `playback-worker.ts`; frames go to the helper from there, off the main thread. */
    private readonly workerPath: string,
    private readonly runtimePath = '/Library/Frameworks/DeckLinkAPI.framework',
    /** The gpu-frames addon; injectable for tests. */
    private readonly loadGpu: () => GpuFramesLoad = gpuFrames,
    private readonly openPlayback: typeof openWorkerPlayback = openWorkerPlayback,
  ) {}
  status(): VideoProviderStatus {
    if (process.platform !== 'darwin') return { available: false, reason: 'DeckLink is supported on macOS in this build' }
    if (!existsSync(this.runtimePath)) return { available: false, reason: 'Install Blackmagic Desktop Video to use DeckLink cards' }
    if (!existsSync(this.helperPath)) return { available: false, reason: 'DeckLink native helper is not included in this build' }
    return { available: true, version: this.version }
  }
  async listPorts(): Promise<VideoPort[]> {
    if (!this.status().available) return []
    const { stdout } = await execute(this.helperPath, ['--list'], { timeout: 8000, maxBuffer: 1024 * 1024 })
    const result = JSON.parse(stdout) as { version: string; ports: VideoPort[] }
    if (!Array.isArray(result.ports)) throw new Error('Invalid DeckLink inventory')
    this.scanned = true
    this.version = result.version
    this.ports = result.ports.map((port) => ({ ...port, unavailableReason: port.unavailableReason || (port.modes.length ? null : 'No output modes available in the current device profile') }))
    return structuredClone(this.ports)
  }
  onPortsChanged(listener: () => void): () => void {
    let previous = '', checking = false, closed = false
    // Poll inventory out of process; profile and unplug changes use the same path.
    const timer = setInterval(() => {
      if (closed || checking || !this.scanned || !this.status().available) return
      checking = true
      void this.listPorts().then((ports) => {
        const key = JSON.stringify(ports)
        if (!closed && key !== previous) { previous = key; listener() }
      }).catch(() => { if (!closed && previous !== 'unavailable') { previous = 'unavailable'; listener() } })
        .finally(() => { checking = false })
    }, 2000)
    timer.unref()
    return () => { closed = true; clearInterval(timer) }
  }
  async openOutput(portId: string, modeId: string, opts: { keyFill: boolean }): Promise<VideoOutputSink> {
    if (opts.keyFill) throw new Error('DeckLink key/fill is not qualified in this build')
    const port = this.ports.find((candidate) => candidate.id === portId)
    if (!port) throw new Error('Device disconnected')
    const mode = port.modes.find((candidate) => candidate.id === modeId)
    if (!mode) throw new Error('Unsupported video mode')
    // GPU capture (plan 008): a shared ring at the mode's raster that the
    // helper reads on the hardware clock. Without it, frames go down stdin.
    const gpu = this.loadGpu()
    let ring: FrameRing | null = null
    if (gpu.ok) {
      try {
        ring = createFrameRing(gpu.addon, mode.width, mode.height)
      } catch (error) {
        log.warn('[DeckLink] GPU frame ring unavailable — using CPU frames', { reason: (error as Error).message })
      }
    }
    let sink: Awaited<ReturnType<typeof openWorkerPlayback>>
    try {
      sink = await this.openPlayback(this.workerPath, { helperPath: this.helperPath, portId, modeId, ringName: ring?.name })
    } catch (error) {
      ring?.close()
      throw error
    }
    if (ring && !sink.ringStatus?.ok) {
      log.warn('[DeckLink] helper did not attach the GPU frame ring — using CPU frames', {
        reason: sink.ringStatus && !sink.ringStatus.ok ? sink.ringStatus.reason : 'no ring response',
      })
      ring.close()
      ring = null
    }
    if (!ring) return sink
    const attached = ring
    const close = sink.close.bind(sink)
    return {
      ...sink,
      frameRing: attached,
      // The helper stops reading first; any surface still writing keeps the
      // mapping alive until its GPU work drains (see gpu_frames.mm Ring).
      close: () => close().finally(() => attached.close()),
    }
  }
}

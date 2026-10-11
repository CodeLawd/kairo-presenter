import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
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
    this.ports = result.ports.map((port) => ({ ...port, unavailableReason: port.modes.length ? port.unavailableReason : 'No output modes available in the current device profile' }))
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
    if (!port.modes.some((mode) => mode.id === modeId)) throw new Error('Unsupported video mode')
    return openWorkerPlayback(this.workerPath, { helperPath: this.helperPath, portId, modeId })
  }
}

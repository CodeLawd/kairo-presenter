import type { VideoDeviceProvider, VideoPort, VideoOutputSink, VideoProviderStatus } from '../provider'

/** Hardware boundary double; no native code is imported by these tests. */
export class FakeVideoDeviceProvider implements VideoDeviceProvider {
  readonly name = 'fake'
  availability: VideoProviderStatus = { available: true, version: 'test' }
  ports: VideoPort[] = []
  opens = 0
  closes = 0
  frames: Buffer[] = []
  openError: Error | null = null
  enumerationError: Error | null = null
  beforeOpen: (() => Promise<void>) | null = null
  private listeners = new Set<() => void>()
  status(): VideoProviderStatus { return this.availability }
  async listPorts(): Promise<VideoPort[]> {
    if (this.enumerationError) throw this.enumerationError
    return this.ports
  }
  onPortsChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  changed(): void { for (const listener of this.listeners) listener() }
  async openOutput(_portId: string, _modeId: string, _opts: { keyFill: boolean }): Promise<VideoOutputSink> {
    this.opens++
    await this.beforeOpen?.()
    if (this.openError) throw this.openError
    let closed = false
    return {
      setFrame: (frame) => { if (!closed) this.frames.push(Buffer.from(frame)) },
      close: async () => { if (!closed) { closed = true; this.closes++ } },
    }
  }
}

export const fakePort: VideoPort = {
  id: 'fake:1:0', provider: 'fake', deviceName: 'Test card', portName: 'SDI 1',
  supportsKeyFill: false, unavailableReason: null,
  modes: [{ id: 'fake:1080p', label: '1080p29.97', width: 1920, height: 1080,
    frameRateN: 30000, frameRateD: 1001, interlaced: false }],
}

import { PassThrough } from 'stream'
import log from 'electron-log/main'
import type { AudioDevice } from '@shared/ipc'
import { listAudioInputDevices } from './devices'

class AudioService {
  private rendererStream: PassThrough | null = null

  // ─── Public API ──────────────────────────────────────────────────────────────

  async getDevices(): Promise<AudioDevice[]> {
    log.info('[AudioService] Enumerating input devices')
    return listAudioInputDevices()
  }

  /**
   * Creates a PassThrough stream the orchestrator pipes to Deepgram.
   * Data is pushed from the renderer via feedPCMChunk().
   */
  createRendererStream(): PassThrough {
    if (this.rendererStream) this.rendererStream.destroy()
    this.rendererStream = new PassThrough()
    log.info('[AudioService] Renderer PCM stream created')
    return this.rendererStream
  }

  /** Called by IPC handler for each PCM chunk arriving from renderer. */
  feedPCMChunk(buffer: Buffer): void {
    if (this.rendererStream && !this.rendererStream.destroyed) {
      this.rendererStream.write(buffer)
    }
  }

  destroyRendererStream(): void {
    if (this.rendererStream) {
      this.rendererStream.destroy()
      this.rendererStream = null
      log.info('[AudioService] Renderer PCM stream destroyed')
    }
  }

  /** Noop — renderer handles actual capture now. */
  async startCapture(_deviceId: string): Promise<void> {}

  async stopCapture(): Promise<void> {
    this.destroyRendererStream()
  }

  getPCMStream(): PassThrough | null {
    return this.rendererStream
  }
}

export const audioService = new AudioService()

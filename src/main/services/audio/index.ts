import { PassThrough } from 'stream'
import log from 'electron-log/main'

/**
 * Hard cap on audio queued in the relay: 5s of 16kHz mono PCM16
 * (16000 * 2 bytes/s * 5). Deepgram keeps its own bounded ~30s replay buffer for
 * reconnects, so this only needs to absorb short consumer stalls — anything
 * longer is discarded rather than allowed to grow the main process.
 */
export const MAX_QUEUED_BYTES = 160_000

// Rate-limit the overflow warning so a long stall cannot flood the log.
const OVERFLOW_LOG_INTERVAL_MS = 5_000

class AudioService {
  private rendererStream: PassThrough | null = null
  private droppedChunks = 0
  private droppedBytes = 0
  private lastOverflowLogAt = 0

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Creates a PassThrough stream the orchestrator pipes to Deepgram.
   * Data is pushed from the renderer via feedPCMChunk().
   */
  createRendererStream(): PassThrough {
    this.destroyRendererStream()
    this.rendererStream = new PassThrough()
    log.info('[AudioService] Renderer PCM stream created')
    return this.rendererStream
  }

  /**
   * Called by the IPC handler for each PCM chunk arriving from the renderer.
   *
   * While Deepgram is detached the PassThrough has no 'data' listener and stops
   * flowing, so writes accumulate in its internal buffer. Past the cap the
   * incoming chunk is dropped (newest-first) rather than queued.
   */
  feedPCMChunk(buffer: Buffer): void {
    const stream = this.rendererStream
    if (!stream || stream.destroyed || !stream.writable) return

    // Both sides count: a PassThrough parks bytes in its readable buffer until
    // that hits its highWaterMark, and only then does the writable side grow.
    const queued = stream.writableLength + stream.readableLength
    if (queued + buffer.length > MAX_QUEUED_BYTES) {
      this.droppedChunks++
      this.droppedBytes += buffer.length
      const now = Date.now()
      if (now - this.lastOverflowLogAt >= OVERFLOW_LOG_INTERVAL_MS) {
        this.lastOverflowLogAt = now
        log.warn('[AudioService] PCM queue full — dropping newest audio', {
          queuedBytes: queued,
          capBytes: MAX_QUEUED_BYTES,
          droppedChunks: this.droppedChunks,
          droppedBytes: this.droppedBytes,
        })
      }
      return
    }

    stream.write(buffer)
  }

  destroyRendererStream(): void {
    if (!this.rendererStream) return
    this.rendererStream.destroy()
    this.rendererStream = null
    log.info('[AudioService] Renderer PCM stream destroyed', {
      droppedChunks: this.droppedChunks,
      droppedBytes: this.droppedBytes,
    })
    this.droppedChunks = 0
    this.droppedBytes = 0
    this.lastOverflowLogAt = 0
  }

  async stopCapture(): Promise<void> {
    this.destroyRendererStream()
  }

  getPCMStream(): PassThrough | null {
    return this.rendererStream
  }
}

export const audioService = new AudioService()

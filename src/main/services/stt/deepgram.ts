import { EventEmitter } from 'events'
import type { Readable } from 'stream'
import log from 'electron-log/main'
import { DeepgramClient } from '@deepgram/sdk'
import type { TranscriptResult, InterimResult, TranscriptWord } from '@shared/ipc'

// ─── Local message types (subset of SDK types we care about) ─────────────────

interface DGWord {
  word: string
  punctuated_word?: string
  start: number
  end: number
  confidence: number
}

interface DGResultsMsg {
  type: 'Results'
  is_final?: boolean
  speech_final?: boolean
  duration?: number
  channel?: {
    alternatives?: Array<{
      transcript?: string
      confidence?: number
      words?: DGWord[]
    }>
  }
}

interface DGUtteranceEndMsg {
  type: 'UtteranceEnd'
  last_word_end?: number
}

interface DGMetadataMsg {
  type: 'Metadata'
  [key: string]: unknown
}

type DGMessage = DGResultsMsg | DGUtteranceEndMsg | DGMetadataMsg | { type: string }

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DeepgramSessionStats {
  totalWords: number
  averageConfidence: number
  uptimeMs: number
  reconnectCount: number
}

interface DeepgramSTTEvents {
  interim:      [result: InterimResult]
  final:        [result: TranscriptResult]
  utteranceEnd: [timestamp: number]
  error:        [err: Error]
  connected:    []
  disconnected: []
  reconnecting: [attempt: number, delayMs: number]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECONNECT_BASE_MS   = 1_000
const RECONNECT_MAX_MS    = 30_000
const KEEPALIVE_INTERVAL  = 10_000
const RECONNECT_MAX_TRIES = 20

// ─── Typed event emitter ──────────────────────────────────────────────────────

export declare interface DeepgramSTTService {
  on<K extends keyof DeepgramSTTEvents>(event: K, listener: (...args: DeepgramSTTEvents[K]) => void): this
  emit<K extends keyof DeepgramSTTEvents>(event: K, ...args: DeepgramSTTEvents[K]): boolean
  off<K extends keyof DeepgramSTTEvents>(event: K, listener: (...args: DeepgramSTTEvents[K]) => void): this
  once<K extends keyof DeepgramSTTEvents>(event: K, listener: (...args: DeepgramSTTEvents[K]) => void): this
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DeepgramSTTService extends EventEmitter {
  private connectionGeneration = 0
  private apiKey   = ''
  private language = 'en'
  private client:  DeepgramClient | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socket: any = null

  private audioSource: Readable | null = null

  private active       = false
  private destroyed    = false
  private reconnecting = false
  private reconnectAttempt = 0
  private reconnectTimer:  NodeJS.Timeout | null = null
  private keepAliveTimer:  NodeJS.Timeout | null = null
  private connectStartedAt = 0

  private statsStartedAt  = 0
  private totalWords      = 0
  private confidenceSum   = 0
  private confidenceCount = 0
  private reconnectCount  = 0

  // ─── Resilience Buffering ─────────────────────────────────────────────────
  private audioBuffer: Buffer[] = []
  private audioBufferBytes = 0

  // ─── Configuration ─────────────────────────────────────────────────────────

  configure(apiKey: string, language = 'en'): void {
    this.apiKey   = apiKey
    this.language = language
    this.client   = new DeepgramClient({ apiKey })
    log.info('[Deepgram] Configured', { language })
  }

  // ─── Connect / Disconnect ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (!this.client || !this.apiKey) {
      this.emit('error', new Error('DeepgramSTTService not configured — call configure() first'))
      return
    }
    if (this.active) return

    this.destroyed      = false
    this.active         = true
    this.statsStartedAt = Date.now()

    await this.openSocket()
  }

  disconnect(): void {
    this.connectionGeneration++
    this.destroyed        = true
    this.active           = false
    this.reconnecting     = false
    this.reconnectAttempt = 0
    this.audioBuffer      = []
    this.audioBufferBytes = 0

    this.clearTimers()
    this.closeSocket()
    this.detachStream()

    this.emit('disconnected')
    log.info('[Deepgram] Disconnected')
  }

  // ─── Audio stream ──────────────────────────────────────────────────────────

  /**
   * Pipe a Readable (raw 16-bit LE PCM, 16kHz mono) to Deepgram.
   * Call after connect(). Reattach the new stream if the source changes.
   */
  attachStream(stream: Readable): void {
    this.detachStream()
    this.audioSource = stream

    stream.on('data', this.onAudioChunk)
    stream.once('end', this.onAudioEnd)
    stream.once('error', this.onAudioError)

    log.info('[Deepgram] Audio stream attached')
  }

  private onAudioEnd = (): void => { this.detachStream() }

  private onAudioError = (err: Error): void => {
    log.error('[Deepgram] Audio stream error', err.message)
    this.detachStream()
  }

  detachStream(): void {
    if (!this.audioSource) return
    this.audioSource.off('data', this.onAudioChunk)
    this.audioSource.off('end', this.onAudioEnd)
    this.audioSource.off('error', this.onAudioError)
    this.audioSource = null
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  getStats(): DeepgramSessionStats {
    return {
      totalWords:        this.totalWords,
      averageConfidence: this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0,
      uptimeMs:          this.statsStartedAt > 0 ? Date.now() - this.statsStartedAt : 0,
      reconnectCount:    this.reconnectCount,
    }
  }

  resetStats(): void {
    this.totalWords      = 0
    this.confidenceSum   = 0
    this.confidenceCount = 0
    this.reconnectCount  = 0
    this.statsStartedAt  = Date.now()
  }

  isActive(): boolean {
    return this.active
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === 1
  }

  // ─── Internal: socket lifecycle ────────────────────────────────────────────

  private async openSocket(): Promise<void> {
    if (!this.client || !this.active || this.destroyed) return
    const generation = ++this.connectionGeneration

    this.connectStartedAt = Date.now()
    log.info('[Deepgram] Opening WebSocket', { attempt: this.reconnectAttempt })

    try {
      const candidate = await this.client.listen.v1.connect({
        model:            'nova-3',
        language:         this.language,
        punctuate:        'true',
        smart_format:     'true',
        // Avoid the smart formatter holding unfinished number entities for 3s.
        queryParams:      { no_delay: true },
        interim_results:  'true',
        utterance_end_ms: 1500,
        vad_events:       'true',
        encoding:         'linear16',
        sample_rate:      16000,
        channels:         1,
        Authorization:    `Token ${this.apiKey}`,
        reconnectAttempts: 0,
      })
      if (!this.active || generation !== this.connectionGeneration) {
        candidate.close()
        return
      }
      this.socket = candidate
    } catch (err) {
      if (generation !== this.connectionGeneration || !this.active) return
      log.error('[Deepgram] connect() threw', (err as Error).message)
      this.handleSocketClose()
      return
    }

    const socket = this.socket
    const isCurrent = (): boolean => this.active && generation === this.connectionGeneration && this.socket === socket

    socket.on('open', () => {
      if (!isCurrent()) return
      log.info('[Deepgram] WebSocket open', {
        connectMs: Date.now() - this.connectStartedAt,
        attempt:   this.reconnectAttempt,
      })
      this.reconnecting     = false
      this.reconnectAttempt = 0
      this.startKeepAlive()

      // Drain resilience buffer
      if (this.audioBuffer.length > 0) {
        log.info(`[Deepgram] Draining buffered audio: ${this.audioBuffer.length} chunks (${this.audioBufferBytes} bytes)`)
        let sent = 0
        for (const b of this.audioBuffer) {
          try {
            const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
            socket.sendMedia(ab)
            sent++
          } catch (err) {
            log.error('[Deepgram] Failed to drain buffer chunk:', (err as Error).message)
            this.audioBuffer = this.audioBuffer.slice(sent)
            this.audioBufferBytes = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
            this.closeSocket()
            this.handleSocketClose()
            return
          }
        }
        this.audioBuffer = []
        this.audioBufferBytes = 0
      }

      this.emit('connected')
    })

    socket.on('message', (msg: DGMessage) => {
      if (isCurrent()) this.handleMessage(msg)
    })

    socket.on('close', () => {
      if (!isCurrent()) return
      log.info('[Deepgram] WebSocket closed')
      this.clearKeepAlive()
      this.handleSocketClose()
    })

    socket.on('error', (err: Error) => {
      if (!isCurrent()) return
      log.error('[Deepgram] WebSocket error', err?.message)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })

    socket.connect()
  }

  private closeSocket(): void {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    try {
      socket.sendCloseStream({ type: 'CloseStream' })
    } catch {
      // The stream may no longer accept control messages.
    }
    try { socket.close() } catch { /* already closed */ }
  }

  private handleSocketClose(): void {
    this.socket = null
    this.clearKeepAlive()

    if (!this.active || this.destroyed) return
    this.scheduleReconnect()
  }

  // ─── Internal: reconnect ───────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= RECONNECT_MAX_TRIES) {
      log.error('[Deepgram] Max reconnect attempts reached')
      this.emit('error', new Error(`Deepgram reconnect failed after ${RECONNECT_MAX_TRIES} attempts`))
      this.active = false
      return
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS
    )
    this.reconnectAttempt++
    this.reconnecting = true

    log.info('[Deepgram] Reconnecting', { attempt: this.reconnectAttempt, delayMs: delay })
    this.emit('reconnecting', this.reconnectAttempt, delay)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.active && !this.destroyed) {
        this.reconnectCount++
        this.openSocket().catch((err: Error) => {
          log.error('[Deepgram] openSocket error during reconnect', err.message)
        })
      }
    }, delay)
  }

  // ─── Internal: message handling ────────────────────────────────────────────

  private handleMessage(msg: DGMessage): void {
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'Results') {
      this.handleResults(msg as DGResultsMsg)
    } else if (msg.type === 'UtteranceEnd') {
      const ue = msg as DGUtteranceEndMsg
      this.emit('utteranceEnd', Date.now())
      log.debug('[Deepgram] UtteranceEnd', { lastWordEnd: ue.last_word_end })
    } else if (msg.type === 'Metadata') {
      log.debug('[Deepgram] Metadata received')
    }
  }

  private handleResults(msg: DGResultsMsg): void {
    const alt = msg.channel?.alternatives?.[0]
    if (!alt) return

    const text = alt.transcript?.trim() ?? ''
    if (!text) return

    const words: TranscriptWord[] = (alt.words ?? []).map((w) => ({
      word:       w.punctuated_word ?? w.word,
      start:      w.start,
      end:        w.end,
      confidence: w.confidence,
    }))

    const confidence = alt.confidence ?? 0
    const now = Date.now()

    if (msg.is_final || msg.speech_final) {
      this.totalWords      += words.length
      this.confidenceSum   += confidence
      this.confidenceCount += 1

      const result: TranscriptResult = {
        id:        `dg-${now}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        words,
        isFinal:   true,
        timestamp: now,
        duration:  msg.duration ?? 0,
      }
      this.emit('final', result)
      log.debug('[Deepgram] Final', { text: text.slice(0, 60), confidence: confidence.toFixed(3) })
    } else {
      const interim: InterimResult = {
        text,
        stability: confidence,
        timestamp: now,
      }
      this.emit('interim', interim)
    }
  }

  // ─── Internal: keep-alive ──────────────────────────────────────────────────

  private startKeepAlive(): void {
    this.clearKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === 1) {
        try {
          this.socket.sendKeepAlive({ type: 'KeepAlive' })
        } catch {
          // socket may have closed between check and send
        }
      }
    }, KEEPALIVE_INTERVAL)
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearKeepAlive()
  }

  // ─── Internal: audio forwarding ───────────────────────────────────────────

  private onAudioChunk = (chunk: Buffer): void => {
    if (this.socket && this.socket.readyState === 1) {
      try {
        const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
        this.socket.sendMedia(ab)
      } catch {
        this.bufferAudio(chunk)
        this.closeSocket()
        this.handleSocketClose()
      }
    } else if (this.active && !this.destroyed) {
      this.bufferAudio(chunk)
    }
  }

  private bufferAudio(chunk: Buffer): void {
    // Retain at most 30s of 16kHz mono 16-bit PCM during reconnect.
    this.audioBuffer.push(chunk)
    this.audioBufferBytes += chunk.length
    while (this.audioBufferBytes > 960000 && this.audioBuffer.length > 0) {
      const oldest = this.audioBuffer.shift()!
      this.audioBufferBytes -= oldest.length
    }
  }
}

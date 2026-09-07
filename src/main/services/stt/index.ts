import log from 'electron-log/main'
import type { STTProvider, TranscriptResult, InterimResult } from '@shared/ipc'
import { DeepgramSTTService } from './deepgram'
import { TranscriptionBuffer } from './buffer'

type TranscriptCallback = (result: TranscriptResult) => void
type InterimCallback = (result: InterimResult) => void

class STTService {
  private provider: STTProvider = 'none'
  private active = false
  private history: TranscriptResult[] = []
  private transcriptCallbacks: TranscriptCallback[] = []
  private interimCallbacks: InterimCallback[] = []

  readonly deepgram = new DeepgramSTTService()
  readonly buffer   = new TranscriptionBuffer()

  constructor() {
    this.deepgram.on('final', (result) => {
      this.history.push(result)
      this.buffer.push(result)
      this.transcriptCallbacks.forEach((cb) => cb(result))
    })

    this.deepgram.on('interim', (result) => {
      this.interimCallbacks.forEach((cb) => cb(result))
    })

    this.deepgram.on('error', (err) => {
      log.error('[STT] Deepgram error', err.message)
    })

    this.deepgram.on('connected', () => {
      log.info('[STT] Deepgram connected')
    })

    this.deepgram.on('disconnected', () => {
      log.info('[STT] Deepgram disconnected')
    })

    this.deepgram.on('reconnecting', (attempt, delayMs) => {
      log.warn('[STT] Deepgram reconnecting', { attempt, delayMs })
    })
  }

  // ─── Event subscriptions ──────────────────────────────────────────────────

  onTranscript(callback: TranscriptCallback): void {
    this.transcriptCallbacks.push(callback)
  }

  offTranscript(callback: TranscriptCallback): void {
    this.transcriptCallbacks = this.transcriptCallbacks.filter((item) => item !== callback)
  }

  onInterim(callback: InterimCallback): void {
    this.interimCallbacks.push(callback)
  }

  offInterim(callback: InterimCallback): void {
    this.interimCallbacks = this.interimCallbacks.filter((item) => item !== callback)
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  configure(provider: STTProvider, apiKey: string, language: string): void {
    this.provider = provider
    log.info('[STT] Configured', { provider, language })

    if (provider === 'deepgram') {
      this.deepgram.configure(apiKey, language)
    }
  }

  async start(): Promise<void> {
    if (this.provider === 'none') {
      log.warn('[STT] start called but no provider configured')
      return
    }

    this.active = true
    log.info('[STT] Starting', { provider: this.provider })

    if (this.provider === 'deepgram') {
      await this.deepgram.connect()
    }
  }

  stop(): void {
    this.active = false
    // Keep the saved transcript, but never analyze a previous capture window on restart.
    this.buffer.clear()
    log.info('[STT] Stopped', { provider: this.provider })

    if (this.provider === 'deepgram') {
      this.deepgram.disconnect()
    }
  }

  getHistory(): TranscriptResult[] {
    return [...this.history]
  }

  setHistory(history: TranscriptResult[]): void {
    this.history = [...history]
    this.buffer.clearAll()
    for (const r of history) {
      this.buffer.push(r)
    }
    log.info('[STT] Transcript history and buffer restored', { count: history.length })
  }

  clearHistory(): void {
    this.history = []
    this.buffer.clearAll()
    log.info('[STT] Transcript history cleared')
  }

  isActive(): boolean {
    return this.active
  }
}

export const sttService = new STTService()

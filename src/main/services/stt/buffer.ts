import { EventEmitter } from 'events'
import type { TranscriptResult } from '@shared/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BufferSegment {
  id: string
  text: string
  timestamp: number
  duration: number
}

export interface TriggerPhraseMatch {
  phrase: string
  context: string
  timestamp: number
}

export interface FullTranscriptEntry {
  timestamp: number
  text: string
  duration: number
}

export interface BufferConfig {
  windowSeconds: number
  analyzeIntervalSeconds: number
  triggerPhrases: string[]
}

interface BufferEvents {
  sentenceComplete: [text: string, timestamp: number]
  triggerPhrase:    [match: TriggerPhraseMatch]
  analyzeReady:     [context: string, timestamp: number]
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_TRIGGER_PHRASES = [
  'turn to',
  'turn your bibles to',
  "let's read",
  'the scripture says',
  'the bible says',
  'it is written',
  'as it says in',
  'chapter',
  'verse',
]

const DEFAULT_CONFIG: BufferConfig = {
  windowSeconds:          90,
  analyzeIntervalSeconds: 8,
  triggerPhrases:         DEFAULT_TRIGGER_PHRASES,
}

// ─── Typed event emitter ──────────────────────────────────────────────────────

export declare interface TranscriptionBuffer {
  on<K extends keyof BufferEvents>(event: K, listener: (...args: BufferEvents[K]) => void): this
  emit<K extends keyof BufferEvents>(event: K, ...args: BufferEvents[K]): boolean
  off<K extends keyof BufferEvents>(event: K, listener: (...args: BufferEvents[K]) => void): this
  once<K extends keyof BufferEvents>(event: K, listener: (...args: BufferEvents[K]) => void): this
}

// ─── Sentence boundary detection ─────────────────────────────────────────────

const SENTENCE_END_RE = /[.?!](?:\s|$)/

/**
 * Splits text into sentences on '.', '?', '!'.
 * Returns each sentence with trailing punctuation included.
 * Final fragment (no terminal punctuation) returned as last element if non-empty.
 */
function splitSentences(text: string): string[] {
  const results: string[] = []
  let remaining = text.trim()

  while (remaining.length > 0) {
    const m = SENTENCE_END_RE.exec(remaining)
    if (!m) break
    const end = m.index + 1
    results.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }

  if (remaining.length > 0) {
    results.push(remaining)
  }

  return results
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class TranscriptionBuffer extends EventEmitter {
  private config: BufferConfig

  // Rolling window — evicted when older than windowSeconds
  private window: BufferSegment[] = []

  // Full session history, never evicted
  private history: FullTranscriptEntry[] = []

  // Pending text not yet confirmed as a complete sentence
  private sentenceAccumulator = ''

  // Analyze-ready debounce
  private analyzeTimer: NodeJS.Timeout | null = null
  private dirtyAfterLastAnalyze = false

  constructor(config: Partial<BufferConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startAnalyzeTimer()
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  configure(config: Partial<BufferConfig>): void {
    this.config = { ...this.config, ...config }
    this.restartAnalyzeTimer()
  }

  // ─── Ingest ─────────────────────────────────────────────────────────────────

  /** Feed a final transcript segment from Deepgram. */
  push(result: TranscriptResult): void {
    const segment: BufferSegment = {
      id:        result.id,
      text:      result.text.trim(),
      timestamp: result.timestamp,
      duration:  result.duration,
    }

    if (!segment.text) return

    this.window.push(segment)
    this.history.push({ timestamp: segment.timestamp, text: segment.text, duration: segment.duration })

    this.evictExpired()
    this.processSentences(segment.text, segment.timestamp)
    this.checkTriggerPhrases(segment.text, segment.timestamp)
    this.dirtyAfterLastAnalyze = true
  }

  // ─── Context accessors ──────────────────────────────────────────────────────

  /** All text in the rolling window joined by spaces. */
  getContext(): string {
    return this.window.map((s) => s.text).join(' ')
  }

  /** Text from segments whose timestamp falls within the last `seconds`. */
  getRecentContext(seconds: number): string {
    const cutoff = Date.now() - seconds * 1_000
    return this.window
      .filter((s) => s.timestamp >= cutoff)
      .map((s) => s.text)
      .join(' ')
  }

  // ─── History accessors ──────────────────────────────────────────────────────

  getFullTranscript(): FullTranscriptEntry[] {
    return [...this.history]
  }

  exportAsText(): string {
    return this.history.map((e) => e.text).join(' ')
  }

  exportAsMarkdown(): string {
    if (this.history.length === 0) return ''

    const lines: string[] = []
    let currentMinute = -1

    for (const entry of this.history) {
      const d = new Date(entry.timestamp)
      const minute = d.getHours() * 60 + d.getMinutes()

      if (minute !== currentMinute) {
        currentMinute = minute
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        lines.push(`\n## ${hh}:${mm}\n`)
      }

      lines.push(entry.text)
    }

    return lines.join(' ').replace(/ \n/g, '\n').trim()
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  getWindowSize(): number {
    return this.window.length
  }

  getHistorySize(): number {
    return this.history.length
  }

  clear(): void {
    this.window              = []
    this.sentenceAccumulator = ''
    this.dirtyAfterLastAnalyze = false
  }

  clearAll(): void {
    this.clear()
    this.history = []
  }

  // ─── Internal: window eviction ──────────────────────────────────────────────

  private evictExpired(): void {
    const cutoff = Date.now() - this.config.windowSeconds * 1_000
    let i = 0
    while (i < this.window.length && this.window[i].timestamp < cutoff) i++
    if (i > 0) this.window.splice(0, i)
  }

  // ─── Internal: sentence detection ───────────────────────────────────────────

  private processSentences(text: string, timestamp: number): void {
    this.sentenceAccumulator = (this.sentenceAccumulator + ' ' + text).trim()

    const sentences = splitSentences(this.sentenceAccumulator)
    if (sentences.length === 0) return

    // Last element may be an incomplete sentence (no terminal punctuation)
    const lastHasTerminator = SENTENCE_END_RE.test(sentences[sentences.length - 1])

    const completeSentences = lastHasTerminator ? sentences : sentences.slice(0, -1)
    const remainder         = lastHasTerminator ? '' : sentences[sentences.length - 1]

    for (const sentence of completeSentences) {
      if (sentence.trim()) {
        this.emit('sentenceComplete', sentence.trim(), timestamp)
      }
    }

    this.sentenceAccumulator = remainder
  }

  // ─── Internal: trigger phrase detection ─────────────────────────────────────

  private checkTriggerPhrases(text: string, timestamp: number): void {
    const lower = text.toLowerCase()

    for (const phrase of this.config.triggerPhrases) {
      if (!lower.includes(phrase.toLowerCase())) continue

      const contextWindowMs = 10_000
      const contextStart    = timestamp - contextWindowMs
      const contextEnd      = timestamp + contextWindowMs

      // Build context from segments near the trigger
      const contextText = this.window
        .filter((s) => s.timestamp >= contextStart && s.timestamp <= contextEnd)
        .map((s) => s.text)
        .join(' ')

      const match: TriggerPhraseMatch = {
        phrase,
        context:   contextText,
        timestamp,
      }

      this.emit('triggerPhrase', match)
      // Trigger immediate analysis (bypass debounce interval)
      this.emitAnalyzeReady()
      // Only emit one trigger per segment even if multiple phrases match
      return
    }
  }

  // ─── Internal: analyze-ready timer ──────────────────────────────────────────

  private emitAnalyzeReady(): void {
    const context = this.getContext()
    if (!context.trim()) return

    this.dirtyAfterLastAnalyze = false
    this.emit('analyzeReady', context, Date.now())
  }

  private startAnalyzeTimer(): void {
    const intervalMs = this.config.analyzeIntervalSeconds * 1_000
    this.analyzeTimer = setInterval(() => {
      if (this.dirtyAfterLastAnalyze) {
        this.emitAnalyzeReady()
      }
    }, intervalMs)
  }

  private restartAnalyzeTimer(): void {
    if (this.analyzeTimer) {
      clearInterval(this.analyzeTimer)
      this.analyzeTimer = null
    }
    this.startAnalyzeTimer()
  }

  /** Call when the buffer is no longer needed to clean up the interval. */
  destroy(): void {
    if (this.analyzeTimer) {
      clearInterval(this.analyzeTimer)
      this.analyzeTimer = null
    }
    this.removeAllListeners()
  }
}

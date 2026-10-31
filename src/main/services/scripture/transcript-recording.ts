import { createWriteStream } from 'node:fs'
import type { InterimResult, TranscriptResult } from '@shared/ipc'

export type RecordedTranscriptEvent =
  | { type: 'interim'; result: InterimResult }
  | { type: 'final'; result: TranscriptResult }
  | { type: 'gap'; count: number }

export interface TranscriptRecorder {
  record(type: 'interim', result: InterimResult): void
  record(type: 'final', result: TranscriptResult): void
  close(): Promise<void>
}

/**
 * Identity of the speech behind a transcript event: where it starts in the
 * provider's audio, per connection (offsets restart on reconnect). Quote
 * evidence and voice commands must key the same final identically.
 */
export function transcriptEvidenceKey(
  result: Pick<TranscriptResult, 'audioEpoch' | 'audioStart'>,
  fallback: string | number,
): string {
  return `${result.audioEpoch ?? 'legacy'}:${result.audioStart ?? fallback}`
}

/** Explicit local diagnostic opt-in. Never overwrite an existing recording or block live capture on disk. */
export function createTranscriptRecorder(filePath?: string): TranscriptRecorder | null {
  if (!filePath?.trim()) return null
  const stream = createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
  let failed = false
  let blocked = false
  let closed = false
  let dropped = 0
  stream.on('error', () => { failed = true })
  stream.on('drain', () => { blocked = false })
  // Replay refuses a recording with gaps, so every dropped run is marked.
  const flushGap = (): void => {
    if (!dropped) return
    stream.write(`${JSON.stringify({ type: 'gap', count: dropped })}\n`)
    dropped = 0
  }
  return {
    record(type: 'interim' | 'final', result: InterimResult | TranscriptResult) {
      if (failed || closed) return
      if (blocked) { dropped++; return }
      flushGap()
      blocked = !stream.write(`${JSON.stringify({ type, result })}\n`)
    },
    close() {
      if (closed || failed) return Promise.resolve()
      closed = true
      flushGap()
      return new Promise((resolve) => {
        stream.once('error', () => resolve())
        stream.end(() => resolve())
      })
    },
  }
}

/** Deterministic event-order replay; recorded provider offsets and arrival clocks stay intact. */
export function replayTranscriptEvents(
  events: readonly RecordedTranscriptEvent[],
  target: { interim: (result: InterimResult) => void; final: (result: TranscriptResult) => void },
): void {
  for (const event of events) {
    if (event.type === 'gap') throw new Error(`Incomplete transcript recording: ${event.count} events dropped`)
    if (event.type === 'interim') target.interim(event.result)
    else target.final(event.result)
  }
}

import type { SermonUploadInput, SermonUploadSegment } from './cloud/contracts'
import type { ServiceRecord } from './service-records'

/** Matches the server's own ceiling — reject locally rather than upload a 400. */
export const MAX_TRANSCRIPT_WORDS = 60_000
const MAX_SEGMENT_CHARS = 20_000

export class TranscriptTooLongError extends Error {
  constructor() {
    super('That service is too long to publish. Record long services in separate parts.')
  }
}

/**
 * The service record as the API wants it.
 *
 * Word timings are kept: they are the bulk of the payload and nothing reads
 * them yet, but they are also the one thing that cannot be recovered later, and
 * re-uploading every past sermon to add them is not a migration anyone wants to
 * run. The server's route has a wide body limit for exactly this reason.
 */
export function toSermonUpload(record: ServiceRecord): SermonUploadInput {
  const seen = new Set<string>()
  const transcript: SermonUploadSegment[] = []
  let words = 0

  for (const segment of record.transcript) {
    const text = segment.text?.trim() ?? ''
    if (!text || seen.has(segment.id)) continue
    seen.add(segment.id)
    words += text.split(/\s+/).length
    transcript.push({
      id: segment.id,
      text: text.slice(0, MAX_SEGMENT_CHARS),
      timestamp: segment.timestamp,
      duration: segment.duration,
      words: (segment.words ?? []).map((word) => ({
        word: word.word,
        start: word.start,
        end: word.end,
        confidence: word.confidence,
      })),
    })
  }

  // Fail loudly rather than truncate. A recap silently missing its last hour is
  // worse than one that never published.
  if (words > MAX_TRANSCRIPT_WORDS) throw new TranscriptTooLongError()

  return {
    localId: record.id,
    title: record.title,
    speaker: record.speaker,
    startedAt: record.createdAt,
    endedAt: record.endedAt ?? Date.now(),
    transcript,
    scriptures: record.scriptures.map((item) => ({
      reference: item.reference,
      translation: item.translation ?? '',
    })),
  }
}

/**
 * Whether another attempt could plausibly succeed.
 *
 * A refusal from the server (bad request, forbidden, too large) will refuse
 * again forever; everything else — offline, a 500, a timeout — is worth
 * retrying, because the booth losing wifi is the normal case here.
 */
export function shouldRetryUpload(status: number | null): boolean {
  if (status === null) return true
  if (status === 408 || status === 429) return true
  return status >= 500
}

/** 30s, 2m, 10m, 30m, then hourly. */
export function nextUploadBackoffMs(attempts: number): number {
  const ladder = [30_000, 120_000, 600_000, 1_800_000, 3_600_000]
  return ladder[Math.min(Math.max(attempts - 1, 0), ladder.length - 1)]
}

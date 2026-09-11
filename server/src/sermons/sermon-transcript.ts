import type { SermonTranscriptSegment, SermonUploadSegment } from '@contracts/contracts'

/**
 * Hard ceiling on an upload, in words.
 *
 * The route's body limit (12 MB) is the first gate, but word timings compress
 * badly and Mongo refuses any document over 16 MB — a base64 envelope of a
 * 12 MB payload lands right on that line. 60k words is roughly seven hours of
 * speech, so anything past it is a stuck microphone, not a sermon.
 */
export const MAX_TRANSCRIPT_WORDS = 60_000

/** Words actually spoken, counted from the text rather than the timing array. */
export function countTranscriptWords(segments: readonly SermonUploadSegment[]): number {
  let total = 0
  for (const segment of segments) {
    const trimmed = segment.text.trim()
    if (trimmed) total += trimmed.split(/\s+/).length
  }
  return total
}

/**
 * Wall-clock length of the service.
 *
 * Derived from the segment timestamps rather than `endedAt - startedAt`,
 * because a service left open after everyone went home would otherwise report
 * a four-hour sermon.
 */
export function transcriptDurationMs(segments: readonly SermonUploadSegment[]): number {
  if (segments.length === 0) return 0
  let first = Infinity
  let last = 0
  for (const segment of segments) {
    if (segment.timestamp < first) first = segment.timestamp
    const end = segment.timestamp + Math.max(0, Math.round(segment.duration * 1000))
    if (end > last) last = end
  }
  return Math.max(0, last - first)
}

/** What to tell someone whose service is past the ceiling. */
export function transcriptTooLongMessage(wordCount: number): string {
  return (
    `That transcript is ${wordCount.toLocaleString()} words — too long to store. ` +
    'Split the service into separate recordings.'
  )
}

/** The transcript as the website shows it — word timings dropped. */
export function readableTranscript(
  segments: readonly SermonUploadSegment[],
): SermonTranscriptSegment[] {
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => ({
      id: segment.id,
      text: segment.text.trim(),
      timestamp: segment.timestamp,
      duration: segment.duration,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

/** One block of prose for the model. Nothing but what was said. */
export function transcriptToText(segments: readonly SermonUploadSegment[]): string {
  return readableTranscript(segments)
    .map((segment) => segment.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

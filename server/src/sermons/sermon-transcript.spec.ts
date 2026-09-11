import type { SermonUploadSegment } from '@contracts/contracts'
import {
  countTranscriptWords,
  MAX_TRANSCRIPT_WORDS,
  readableTranscript,
  transcriptDurationMs,
  transcriptToText,
  transcriptTooLongMessage,
} from './sermon-transcript'

function segment(partial: Partial<SermonUploadSegment> & { text: string }): SermonUploadSegment {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    text: partial.text,
    timestamp: partial.timestamp ?? 0,
    duration: partial.duration ?? 1,
    words: partial.words ?? [],
  }
}

describe('sermon transcript helpers', () => {
  it('counts spoken words from the text, not the timing array', () => {
    const segments = [
      segment({ text: 'grace and peace to you' }),
      segment({ text: '   ' }),
      segment({ text: 'from God our Father' }),
    ]
    expect(countTranscriptWords(segments)).toBe(9)
  })

  it('measures duration across the segments, not the open service', () => {
    const segments = [
      segment({ text: 'one', timestamp: 10_000, duration: 2 }),
      segment({ text: 'two', timestamp: 40_000, duration: 5 }),
    ]
    // Last segment ends at 45s, first starts at 10s.
    expect(transcriptDurationMs(segments)).toBe(35_000)
    expect(transcriptDurationMs([])).toBe(0)
  })

  it('counts a transcript past the ceiling and explains why it is refused', () => {
    const huge = [segment({ text: 'word '.repeat(MAX_TRANSCRIPT_WORDS + 1) })]
    const wordCount = countTranscriptWords(huge)
    expect(wordCount).toBeGreaterThan(MAX_TRANSCRIPT_WORDS)
    expect(transcriptTooLongMessage(wordCount)).toContain('too long to store')
  })

  it('leaves a normal sermon well inside the ceiling', () => {
    expect(countTranscriptWords([segment({ text: 'word '.repeat(6_000) })])).toBe(6_000)
  })

  it('drops word timings and empty segments, and orders by time', () => {
    const segments = [
      segment({ id: 'b', text: 'second', timestamp: 2_000, words: [
        { word: 'second', start: 2, end: 2.4, confidence: 0.9 },
      ] }),
      segment({ id: 'blank', text: '   ', timestamp: 1_500 }),
      segment({ id: 'a', text: '  first  ', timestamp: 1_000 }),
    ]
    expect(readableTranscript(segments)).toEqual([
      { id: 'a', text: 'first', timestamp: 1_000, duration: 1 },
      { id: 'b', text: 'second', timestamp: 2_000, duration: 1 },
    ])
  })

  it('joins to one block of prose for the model', () => {
    const segments = [
      segment({ text: 'Turn with me', timestamp: 1 }),
      segment({ text: 'to  Romans   eight', timestamp: 2 }),
    ]
    expect(transcriptToText(segments)).toBe('Turn with me to Romans eight')
  })
})

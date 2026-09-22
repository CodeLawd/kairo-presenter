import { normalizeScriptureQuery } from '../../../lib/scripture-query'

export interface ParsedScriptureReference {
  book: string
  chapter: number
  verseStart?: number
  verseEnd?: number
  /** True for chapter-only queries ("Psalms 23") → load the whole chapter. */
  isChapter?: boolean
}

export function parseScriptureReference(input: string): ParsedScriptureReference | null {
  // Chapter-only queries ("Psalms 23", "ps 23") only count when the book is
  // known — otherwise a remembered phrase like "love 123" would be mistaken
  // for a chapter reference and skip phrase search entirely.
  const normalized = normalizeScriptureQuery(input)
  if (normalized) {
    const chapterOnly = normalized.match(/^(.+?)\s+(\d+)$/)
    if (chapterOnly && !chapterOnly[0].includes(':')) {
      const chapter = Number.parseInt(chapterOnly[2], 10)
      if (!Number.isInteger(chapter) || chapter < 1) return null
      return {
        book: chapterOnly[1].trim(),
        chapter,
        isChapter: true,
      }
    }
    const match = normalized.match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?$/)
    if (!match) return null
    return {
      book: match[1].trim(),
      chapter: Number.parseInt(match[2], 10),
      verseStart: Number.parseInt(match[3], 10),
      verseEnd: match[4] ? Number.parseInt(match[4], 10) : undefined,
    }
  }
  // Already-canonical verse references fall back to the raw input.
  const match = input.trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?$/)
  if (!match) return null
  return {
    book: match[1].trim(),
    chapter: Number.parseInt(match[2], 10),
    verseStart: Number.parseInt(match[3], 10),
    verseEnd: match[4] ? Number.parseInt(match[4], 10) : undefined,
  }
}

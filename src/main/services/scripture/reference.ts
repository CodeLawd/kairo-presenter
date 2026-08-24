import { normalizeScriptureQuery } from '../../../lib/scripture-query'

export interface ParsedScriptureReference {
  book: string
  chapter: number
  verseStart: number
  verseEnd?: number
}

export function parseScriptureReference(input: string): ParsedScriptureReference | null {
  const normalized = normalizeScriptureQuery(input) ?? input.trim()
  const match = normalized.match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?$/)
  if (!match) return null
  return {
    book: match[1].trim(),
    chapter: Number.parseInt(match[2], 10),
    verseStart: Number.parseInt(match[3], 10),
    verseEnd: match[4] ? Number.parseInt(match[4], 10) : undefined,
  }
}

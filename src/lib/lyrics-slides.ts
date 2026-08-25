import type { LyricsSong, LyricsSongSection, SongPresentOptions } from './ipc'
import { resolveLyricLineColor } from './lyrics-style'

/** Default couplet size used when a freshly imported song has no slide breaks yet. */
export const DEFAULT_IMPORT_SLIDE_LINES = 2
export const DEFAULT_MAX_CHARS_PER_LINE = 40

export interface LyricSlide {
  sectionLabel: string
  lines: string[]
  /** Parallel to `lines` — resolved paint color when set. */
  lineColors?: (string | undefined)[]
}

export interface ColoredLyricLine {
  text: string
  color?: string
  /** Index into the section's `lines` array (before soft-wrap). */
  sourceLineIndex: number
}

/**
 * Soft-wraps one lyric line at word boundaries. Never splits a word.
 * This only affects how a long line paints on a slide — it never creates a new slide.
 */
export function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line]
  const words = line.split(/\s+/)
  const wrapped: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word
    } else {
      wrapped.push(current)
      current = word
    }
  }
  if (current) wrapped.push(current)
  return wrapped.length > 0 ? wrapped : [line]
}

/**
 * Keeps a single blank line as a slide break, drops leading/trailing blanks,
 * and collapses runs of blanks so the editor doesn't accumulate empty rows.
 */
export function preserveSlideBreaks(rawLines: string[]): string[] {
  const out: string[] = []
  let pendingBreak = false

  for (const raw of rawLines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      if (out.length > 0) pendingBreak = true
      continue
    }
    if (pendingBreak) {
      out.push('')
      pendingBreak = false
    }
    out.push(line)
  }

  return out
}

/**
 * Inserts a blank line every `every` lyric lines.
 *
 * Used by the editor's 1-line / 2-line tools, and by import when a section
 * arrives as a flat wall of text with no breaks of its own.
 */
export function insertSlideBreaks(text: string, every: number): string {
  const size = Math.max(1, Math.floor(every))
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim())
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % size === 0) out.push('')
    out.push(lines[i])
  }
  return out.join('\n')
}

/**
 * Import-time helper: if the section already has blank-line breaks, keep them;
 * otherwise break into couplets so the operator has something to edit rather
 * than one giant slide.
 */
export function applyImportSlideBreaks(
  lines: string[],
  every = DEFAULT_IMPORT_SLIDE_LINES
): string[] {
  if (lines.some((line) => !line.trim())) return preserveSlideBreaks(lines)
  return preserveSlideBreaks(insertSlideBreaks(lines.join('\n'), every).split('\n'))
}

/**
 * Splits a section into on-screen slides.
 *
 * Blank lines are the only slide boundaries — the operator (or the import
 * default) decides what goes together. Long lyric lines may still soft-wrap
 * within a slide so they fit the screen.
 */
export function splitIntoSlideChunks(
  lines: string[],
  maxChars: number = DEFAULT_MAX_CHARS_PER_LINE
): string[][] {
  return splitIntoColoredSlideChunks(lines, undefined, '', maxChars).map((chunk) =>
    chunk.map((line) => line.text)
  )
}

/**
 * Like splitIntoSlideChunks, but keeps gloss / override colors through soft-wrap.
 */
export function splitIntoColoredSlideChunks(
  lines: string[],
  lineColors: (string | null | undefined)[] | undefined,
  glossColor: string,
  maxChars: number = DEFAULT_MAX_CHARS_PER_LINE
): ColoredLyricLine[][] {
  const chunks: ColoredLyricLine[][] = []
  let current: ColoredLyricLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      if (current.length > 0) {
        chunks.push(current)
        current = []
      }
      continue
    }
    const color = resolveLyricLineColor(line, glossColor, lineColors?.[i])
    for (const part of wrapLine(line, maxChars)) {
      current.push({ text: part, color, sourceLineIndex: i })
    }
  }
  if (current.length > 0) chunks.push(current)

  return chunks.length > 0 ? chunks : [[]]
}

export function buildSlides(
  song: LyricsSong,
  opts: SongPresentOptions & { glossColor?: string } = {}
): LyricSlide[] {
  const maxChars = opts.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE
  const glossColor = opts.glossColor ?? ''
  const slides: LyricSlide[] = []

  for (const section of song.sections) {
    const chunks = splitIntoColoredSlideChunks(
      section.lines,
      section.lineColors,
      glossColor,
      maxChars
    )
    for (let i = 0; i < chunks.length; i++) {
      const label =
        chunks.length === 1
          ? section.label
          : `${section.label} (${i + 1}/${chunks.length})`
      slides.push({
        sectionLabel: label,
        lines: chunks[i].map((l) => l.text),
        lineColors: chunks[i].map((l) => l.color),
      })
    }
  }
  return slides
}

export function sectionSlideChunks(
  section: LyricsSongSection,
  opts: SongPresentOptions = {}
): string[][] {
  const maxChars = opts.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE
  return splitIntoSlideChunks(section.lines, maxChars)
}

export function sectionColoredSlideChunks(
  section: LyricsSongSection,
  glossColor: string,
  opts: SongPresentOptions = {}
): ColoredLyricLine[][] {
  const maxChars = opts.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE
  return splitIntoColoredSlideChunks(section.lines, section.lineColors, glossColor, maxChars)
}

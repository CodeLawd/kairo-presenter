// ─── Song text: [Label] lines start sections, blank lines break slides ───────
// How a song reads as plain text — the way it is pasted into the song editor,
// which splits it into sections and slides with these. Pure — no DOM.

import type { LyricsSectionType } from './ipc'
import { defaultLabelForType, sectionTypeFromLabel } from './lyrics-section-edit'

export interface ReflowSlide {
  /** Line index in the text where this slide's first lyric line is. */
  startLine: number
  lines: string[]
}

export interface ReflowSection {
  label: string
  type: LyricsSectionType
  /** Line index of the `[Label]` line; null for lyrics before any header. */
  headerLine: number | null
  /** The body as stored: lines with single blank lines between slides. */
  linesText: string
  slides: ReflowSlide[]
}

const HEADER_RE = /^\[([^\]]{1,40})\]$/

/** "[Chorus]" → "Chorus"; anything else → null. */
export function reflowHeaderLabel(line: string): string | null {
  const match = line.trim().match(HEADER_RE)
  return match ? match[1].trim() || null : null
}

export function parseReflow(text: string): ReflowSection[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sections: ReflowSection[] = []
  let current: { label: string | null; headerLine: number | null; body: Array<{ text: string; line: number }> } | null = null

  const flush = (): void => {
    if (!current) return
    const body = [...current.body]
    while (body.length > 0 && !body[0].text.trim()) body.shift()
    while (body.length > 0 && !body[body.length - 1].text.trim()) body.pop()
    // Lyrics typed before any header still count — as the first verse.
    if (body.length === 0 && current.label === null) return
    const label = current.label ?? `Verse ${sections.filter((s) => s.type === 'verse').length + 1}`

    const slides: ReflowSlide[] = []
    const stored: string[] = []
    let slide: ReflowSlide | null = null
    for (const { text: raw, line } of body) {
      const lyric = raw.trimEnd()
      if (!lyric.trim()) {
        if (slide) {
          slides.push(slide)
          slide = null
          stored.push('')
        }
        continue
      }
      if (!slide) slide = { startLine: line, lines: [] }
      slide.lines.push(lyric)
      stored.push(lyric)
    }
    if (slide) slides.push(slide)

    sections.push({
      label,
      type: sectionTypeFromLabel(label),
      headerLine: current.headerLine,
      linesText: stored.join('\n'),
      slides,
    })
  }

  lines.forEach((raw, index) => {
    const label = reflowHeaderLabel(raw)
    if (label !== null) {
      flush()
      current = { label, headerLine: index, body: [] }
      return
    }
    if (!current) current = { label: null, headerLine: null, body: [] }
    current.body.push({ text: raw, line: index })
  })
  flush()
  return sections
}

/**
 * The next free label for a new section of `type`. Verses are always numbered
 * ("Verse 1", "Verse 2"); the rest start bare ("Chorus", then "Chorus 2").
 */
export function nextSectionLabel(sections: readonly Pick<ReflowSection, 'label'>[], type: LyricsSectionType): string {
  const taken = new Set(sections.map((s) => s.label.toLowerCase()))
  for (let n = 1; n < 100; n++) {
    const label = type === 'verse' ? `Verse ${n}` : defaultLabelForType(type, n)
    if (!taken.has(label.toLowerCase())) return label
  }
  return defaultLabelForType(type)
}

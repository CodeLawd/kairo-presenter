import type { LyricsSectionType } from './ipc'

export interface EditableSection {
  _key: string
  type: LyricsSectionType
  label: string
  linesText: string
}

const TYPE_LABEL: Record<LyricsSectionType, string> = {
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  'pre-chorus': 'Pre-Chorus',
  tag: 'Tag',
  intro: 'Intro',
  outro: 'Outro',
  ending: 'Ending',
}

export function defaultLabelForType(type: LyricsSectionType, index = 1): string {
  const base = TYPE_LABEL[type] ?? type
  return index > 1 ? `${base} ${index}` : base
}

/**
 * Splits section text at the line under the cursor.
 * Everything from that line onward becomes the new section body.
 */
export function splitTextAtCursor(text: string, cursor: number): { before: string; after: string } {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeCursor - 1)) + 1
  const before = text.slice(0, lineStart).replace(/\n+$/, '')
  const after = text.slice(lineStart).replace(/^\n+/, '')
  return { before, after }
}

/**
 * Breaks lines that jam multiple phrases with 2+ spaces into one row each.
 * Blank lines (slide breaks) are preserved.
 */
export function expandJammedLines(text: string): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trimEnd()
      if (!trimmed.trim()) return ['']
      if (/\s{2,}/.test(trimmed)) {
        return trimmed.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean)
      }
      return [trimmed]
    })
    .join('\n')
}

/**
 * Inserts a new section after `index`, moving text from the cursor line onward
 * into it. Returns null when there is nothing to move.
 */
export function splitSectionAtCursor<T extends EditableSection>(
  sections: T[],
  index: number,
  cursor: number,
  makeKey: () => string,
  newType: LyricsSectionType = 'verse'
): T[] | null {
  const current = sections[index]
  if (!current) return null

  const { before, after } = splitTextAtCursor(current.linesText, cursor)
  if (!after.trim() || !before.trim()) return null

  const typeCount = sections.filter((s) => s.type === newType).length + 1
  const next: T = {
    ...current,
    _key: makeKey(),
    type: newType,
    label: defaultLabelForType(newType, typeCount),
    linesText: after,
  }

  const updated = sections.map((section, i) =>
    i === index ? { ...section, linesText: before } : section
  )
  updated.splice(index + 1, 0, next)
  return updated
}

/**
 * Reads `[Label]`-marked text back into sections.
 *
 * The import preview shows a song as editable text, and the operator's edit has
 * to become sections again to display (and, on save, to parse). Lines before
 * the first marker are kept as a verse rather than dropped — a song sheet that
 * starts straight into lyrics is normal.
 */
export function parseMarkedSections(text: string): {
  type: LyricsSectionType
  label: string
  lines: string[]
}[] {
  const sections: { type: LyricsSectionType; label: string; lines: string[] }[] = []
  let label: string | null = null
  let lines: string[] = []

  const flush = (): void => {
    const trimmed = [...lines]
    while (trimmed.length > 0 && !trimmed[trimmed.length - 1].trim()) trimmed.pop()
    while (trimmed.length > 0 && !trimmed[0].trim()) trimmed.shift()
    if (trimmed.length === 0 && label === null) return
    const resolved = label ?? defaultLabelForType('verse', sections.length + 1)
    sections.push({ type: sectionTypeFromLabel(resolved), label: resolved, lines: trimmed })
  }

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = raw.trim().match(/^\[([^\]]{1,40})\]$/)
    if (marker) {
      flush()
      label = marker[1].trim()
      lines = []
      continue
    }
    lines.push(raw)
  }
  flush()

  return sections
}

/** "Pre-Chorus 2" → 'pre-chorus'. Anything unrecognised reads as a verse. */
export function sectionTypeFromLabel(label: string): LyricsSectionType {
  const base = label.toLowerCase().replace(/\s*\d+\s*$/, '').trim()
  const match = (Object.keys(TYPE_LABEL) as LyricsSectionType[]).find(
    (type) => TYPE_LABEL[type].toLowerCase() === base || type === base,
  )
  return match ?? 'verse'
}

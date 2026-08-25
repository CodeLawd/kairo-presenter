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

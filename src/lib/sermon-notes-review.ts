import type { SermonReferenceMatch } from './ipc'

/** Must match TipTap `getText({ blockSeparator })` when scanning and painting. */
export const SERMON_NOTES_BLOCK_SEPARATOR = '\n'

function comparisonKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Returns a canonical label only when the source notation needs interpretation. */
export function normalizedReferenceLabel(match: SermonReferenceMatch): string | null {
  const source = comparisonKey(match.text)
  const canonical = comparisonKey(match.reference)
  return source.startsWith(canonical) ? null : match.reference
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Plain-text → TipTap HTML that survives HTML whitespace collapsing.
 * One paragraph per line so soft breaks stay editable as blocks.
 */
export function plainTextToEditorHtml(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return lines.map((line) => {
    const escaped = escapeHtml(line.replace(/\t/g, '    '))
      // Leading / trailing / repeated spaces are collapsed by HTML parsers.
      .replace(/^ /g, '&nbsp;')
      .replace(/ $/g, '&nbsp;')
      .replace(/ {2,}/g, (spaces) => '&nbsp;'.repeat(spaces.length))
    return `<p>${escaped || '<br>'}</p>`
  }).join('')
}

/**
 * Minimal ProseMirror doc surface for TipTap-compatible offset mapping.
 * Mirrors `@tiptap/core` `getTextBetween`: a block separator before every block
 * with `pos > 0`, plus leaf serializers such as hardBreak → "\\n".
 */
export interface SermonNotesDocNode {
  isText: boolean
  isBlock: boolean
  text?: string | null
  type: { name: string }
  nodeSize: number
  content: { size: number }
  nodesBetween: (
    from: number,
    to: number,
    fn: (
      node: SermonNotesDocNode,
      pos: number,
      parent: SermonNotesDocNode | null,
      index: number,
    ) => void | boolean,
  ) => void
}

/**
 * Map a character range from TipTap `getText({ blockSeparator })` onto
 * ProseMirror document positions.
 *
 * Naive `offset + 1` only works for a single textblock. Imported HTML creates
 * many blocks (and lists nest still more), so each block boundary shifts
 * positions relative to the plain-text index.
 */
export function mapTextRangeToPos(
  doc: SermonNotesDocNode,
  start: number,
  end: number,
  blockSeparator: string = SERMON_NOTES_BLOCK_SEPARATOR,
): { from: number; to: number } | null {
  if (start < 0 || end < start) return null

  let chars = 0
  let fromPos: number | null = null
  let toPos: number | null = null
  const rangeFrom = 0
  const rangeTo = doc.content.size

  doc.nodesBetween(rangeFrom, rangeTo, (node, pos, parent) => {
    if (toPos !== null) return false

    // Same rule as TipTap getTextBetween: separator before every block after the start.
    if (node.isBlock && pos > rangeFrom) {
      chars += blockSeparator.length
    }

    // hardBreak serializer in StarterKit returns "\n" and stops descent.
    if (node.type.name === 'hardBreak') {
      if (parent) {
        if (fromPos === null && chars === start) fromPos = pos
        chars += 1
        if (chars === end) toPos = pos + node.nodeSize
      }
      return false
    }

    if (node.isText && node.text) {
      const sliceStart = Math.max(rangeFrom, pos) - pos
      const sliceEnd = rangeTo - pos
      const sliced = node.text.slice(sliceStart, sliceEnd)
      for (let i = 0; i < sliced.length; i += 1) {
        const docPos = pos + sliceStart + i
        if (fromPos === null && chars === start) fromPos = docPos
        chars += 1
        if (chars === end) {
          toPos = docPos + 1
          return false
        }
      }
    }
  })

  if (fromPos === null || toPos === null || fromPos >= toPos) return null
  return { from: fromPos, to: toPos }
}

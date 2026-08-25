import type { LyricsSectionType } from '@shared/ipc'

export interface SectionLabelResult {
  type: LyricsSectionType
  /** 1-based index parsed from the label (Verse 2 → 2). Defaults to 1. */
  index: number
}

/**
 * Detects whether a line is a section header in any of these forms:
 *   [V1]  {V1}  (V1)   — bracketed short codes
 *   V1  C  B  PC  T  I  O  E  — raw short codes
 *   Verse 1  Chorus  Bridge  Pre-Chorus  Tag  Intro  Outro  Ending — English words
 *
 * Returns null if the line is not a section header.
 *
 * Note: "End" / "END." are NOT endings — LRCLIB and live transcriptions use them
 * as stage cues. Only "Ending" or the short code "E" / "E1" count.
 */
export function parseSectionLabel(rawLine: string): SectionLabelResult | null {
  // Strip surrounding brackets / braces / parens and whitespace
  const stripped = rawLine.replace(/^[\[\({]\s*|\s*[\]\)}]$/g, '').trim()
  // Strip trailing colon
  const line = stripped.replace(/:+\s*$/, '').trim()
  if (!line) return null

  const lower = line.toLowerCase().replace(/\s+/g, ' ')

  // ── Verse ──────────────────────────────────────────────────────────────────
  const verseMatch = lower.match(/^v(?:erse)?\.?\s*(\d*)$/)
  if (verseMatch) {
    const n = parseInt(verseMatch[1] || '1') || 1
    return { type: 'verse', index: n }
  }

  // ── Chorus ─────────────────────────────────────────────────────────────────
  const chorusMatch = lower.match(/^c(?:horus)?\.?\s*(\d*)$/)
  if (chorusMatch) {
    const n = parseInt(chorusMatch[1] || '1') || 1
    return { type: 'chorus', index: n }
  }

  // ── Bridge ─────────────────────────────────────────────────────────────────
  const bridgeMatch = lower.match(/^b(?:ridge)?\.?\s*(\d*)$/)
  if (bridgeMatch) {
    const n = parseInt(bridgeMatch[1] || '1') || 1
    return { type: 'bridge', index: n }
  }

  // ── Pre-Chorus ─────────────────────────────────────────────────────────────
  if (/^(?:pc|p\.?c\.?|pre[-\s]?c(?:ho(?:rus)?)?|prechorus)\.?\s*\d*$/.test(lower)) {
    return { type: 'pre-chorus', index: 1 }
  }

  // ── Tag ────────────────────────────────────────────────────────────────────
  if (/^t(?:ag)?\.?\s*\d*$/.test(lower)) {
    return { type: 'tag', index: 1 }
  }

  // ── Intro ──────────────────────────────────────────────────────────────────
  if (/^i(?:ntro(?:duction)?)?\.?\s*\d*$/.test(lower)) {
    return { type: 'intro', index: 1 }
  }

  // ── Outro ──────────────────────────────────────────────────────────────────
  if (/^o(?:utro)?\.?\s*\d*$/.test(lower)) {
    return { type: 'outro', index: 1 }
  }

  // ── Ending ─────────────────────────────────────────────────────────────────
  // "Ending" / "E" / "E2" only — never "End" or "END." (those are stage cues).
  if (/^ending\.?\s*\d*$/.test(lower)) {
    return { type: 'ending', index: 1 }
  }
  const endingShort = lower.match(/^e(\d*)$/)
  if (endingShort) {
    const n = parseInt(endingShort[1] || '1') || 1
    return { type: 'ending', index: n }
  }

  return null
}

/**
 * Returns true if the line looks like a section label in any supported form.
 */
export function isSectionLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  // Must be short — section labels are never full sentences
  if (trimmed.length > 30) return false
  return parseSectionLabel(trimmed) !== null
}

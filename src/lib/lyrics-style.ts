import { isGlossLine } from './lyrics-translate'

/** Factory default — slightly darker yellow / gold for bilingual glosses. */
export const DEFAULT_GLOSS_COLOR = '#D4A017'

/**
 * Resolves the paint color for one lyric line.
 * Manual override wins; otherwise gloss lines `(…)` use the settings gloss color.
 */
export function resolveLyricLineColor(
  line: string,
  glossColor: string,
  override?: string | null
): string | undefined {
  const trimmedOverride = override?.trim()
  if (trimmedOverride) return trimmedOverride
  if (isGlossLine(line)) {
    const c = glossColor.trim() || DEFAULT_GLOSS_COLOR
    return c
  }
  return undefined
}

export function normalizeGlossColor(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_GLOSS_COLOR
  const t = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const [, a, b, c] = t
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase()
  }
  return DEFAULT_GLOSS_COLOR
}

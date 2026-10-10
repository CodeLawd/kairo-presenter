import { normalizeHotkey } from './lyrics-hotkeys'

/*
 * How a song section's lines are stored in the SQLite cache (`sections.lines`).
 * A plain section is a JSON array of lines — the original format — and the
 * object form `{ lines, lineColors?, hotkey? }` is used only when one of the
 * extras is set, so older rows and newer ones read the same way.
 */

/**
 * Persist lines; the object form (with colors and/or a hotkey) only when one
 * is set, so a plain section stays the original plain array.
 */
export function serializeSectionLines(lines: string[], lineColors?: (string | null)[], hotkey?: string): string {
  const key = normalizeHotkey(hotkey)
  const hasColors = Boolean(lineColors && lineColors.some((c) => Boolean(c?.trim())))
  if (!hasColors && !key) return JSON.stringify(lines)
  const colors = hasColors ? lines.map((_, i) => lineColors![i]?.trim() || null) : undefined
  return JSON.stringify({ lines, ...(colors ? { lineColors: colors } : {}), ...(key ? { hotkey: key } : {}) })
}

export function parseSectionLines(raw: string): {
  lines: string[]
  lineColors?: (string | null)[]
  hotkey?: string
} {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return { lines: parsed.map((x) => String(x ?? '')) }
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { lines?: unknown }).lines)
    ) {
      const obj = parsed as { lines: unknown[]; lineColors?: unknown[]; hotkey?: unknown }
      const lines = obj.lines.map((x) => String(x ?? ''))
      const rawColors = obj.lineColors
      const lineColors = Array.isArray(rawColors)
        ? lines.map((_, i) => {
            const c = rawColors[i]
            return typeof c === 'string' && c.trim() ? c.trim() : null
          })
        : undefined
      return { lines, lineColors, hotkey: normalizeHotkey(obj.hotkey) }
    }
  } catch {
    /* fall through */
  }
  return { lines: [] }
}

import type { CustomOverlayTheme, OverlayContentKind, OverlayOutput, OverlayTheme } from './ipc'
import { normalizeOverlayTheme } from './overlay-defaults'
import { setContentOverride, themeForContentKind, withContentPatch } from './overlay-outputs'

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `theme-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createCustomTheme(
  name: string,
  theme: OverlayTheme,
  kind: OverlayContentKind = 'scripture',
  now = Date.now(),
  id = newId(),
): CustomOverlayTheme {
  return {
    id,
    name: name.trim() || 'Untitled theme',
    kind,
    createdAt: now,
    updatedAt: now,
    theme: structuredClone(theme),
  }
}

/** The next unused "Untitled theme" / "Untitled theme 2" name for this kind. */
export function nextUntitledThemeName(
  library: readonly CustomOverlayTheme[],
  kind: OverlayContentKind,
): string {
  const names = new Set(themesForKind(library, kind).map((item) => item.name))
  if (!names.has('Untitled theme')) return 'Untitled theme'
  let n = 2
  while (names.has(`Untitled theme ${n}`)) n += 1
  return `Untitled theme ${n}`
}
export function themesForKind(
  library: readonly CustomOverlayTheme[],
  kind: OverlayContentKind,
): CustomOverlayTheme[] {
  return library.filter((item) => item.kind === kind)
}

/**
 * Persist a draft onto one library row. Every other row is returned as-is
 * (same object), and the saved theme is a deep clone so later draft edits
 * cannot leak into a sibling theme.
 */
export function updateLibraryTheme(
  library: readonly CustomOverlayTheme[],
  id: string,
  patch: { name: string; theme: OverlayTheme },
  now = Date.now(),
): CustomOverlayTheme[] {
  return library.map((item) =>
    item.id === id
      ? { ...item, name: patch.name, updatedAt: now, theme: structuredClone(patch.theme) }
      : item,
  )
}

export function normalizeThemeLibrary(
  raw: unknown,
  activeTheme: OverlayTheme,
  now = Date.now(),
  legacyId = newId(),
): CustomOverlayTheme[] {
  if (!Array.isArray(raw)) {
    return [createCustomTheme('My current theme', activeTheme, 'scripture', now, legacyId)]
  }

  const seen = new Set<string>()
  const normalized: CustomOverlayTheme[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<CustomOverlayTheme>
    if (typeof candidate.id !== 'string' || !candidate.id || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : now
    normalized.push({
      id: candidate.id,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'Untitled theme',
      // Everything saved before the split was a scripture theme.
      kind: candidate.kind === 'lyrics' ? 'lyrics' : 'scripture',
      createdAt,
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : createdAt,
      theme: normalizeOverlayTheme(candidate.theme),
    })
  }
  return normalized
}

// ─── Themes on outputs ─────────────────────────────────────────────────────────
// Outputs keep a resolved copy of their theme so rendering never depends on the
// library. These keep those copies in step with the library entry they name.

/** True when `output` shows `theme` for the theme's kind. */
export function outputUsesTheme(output: OverlayOutput, theme: Pick<CustomOverlayTheme, 'id' | 'kind'>): boolean {
  return theme.kind === 'lyrics' ? output.lyrics?.themeId === theme.id : output.themeId === theme.id
}

/** Puts `theme` on `output` for its kind. A lyrics theme turns the lyrics override on. */
export function assignThemeToOutput(output: OverlayOutput, theme: CustomOverlayTheme): OverlayOutput {
  if (theme.kind === 'lyrics') {
    const base = setContentOverride(output, 'lyrics', true)
    return withContentPatch(base, 'lyrics', {
      themeId: theme.id,
      theme: themeForContentKind(structuredClone(theme.theme), 'lyrics'),
    })
  }
  return { ...output, themeId: theme.id, theme: structuredClone(theme.theme) }
}

/** Lyrics go back to following the scripture theme. Scripture always has a theme, so it is left alone. */
export function unassignThemeFromOutput(output: OverlayOutput, theme: Pick<CustomOverlayTheme, 'id' | 'kind'>): OverlayOutput {
  if (theme.kind !== 'lyrics' || !outputUsesTheme(output, theme)) return output
  return setContentOverride(output, 'lyrics', false)
}

/** Refreshes every output's copy of `theme` after it was edited. */
export function syncThemeToOutputs(outputs: readonly OverlayOutput[], theme: CustomOverlayTheme): OverlayOutput[] {
  return outputs.map((output) => (outputUsesTheme(output, theme) ? assignThemeToOutput(output, theme) : output))
}

/** After a delete: outputs keep the look they had, as a one-off no longer tied to the library. */
export function detachThemeFromOutputs(outputs: readonly OverlayOutput[], theme: Pick<CustomOverlayTheme, 'id' | 'kind'>): OverlayOutput[] {
  return outputs.map((output) => {
    if (!outputUsesTheme(output, theme)) return output
    return theme.kind === 'lyrics' && output.lyrics
      ? { ...output, lyrics: { ...output.lyrics, themeId: null } }
      : { ...output, themeId: null }
  })
}

import type { CustomOverlayTheme, OverlayContentKind, OverlayOutput, OverlayTheme } from './ipc'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlayTheme } from './overlay-defaults'
import { applyLayoutPreset } from './overlay-boxes'
import { setContentOverride, withContentPatch } from './overlay-outputs'

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
    baseline: structuredClone(theme),
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
      ? {
          ...item,
          name: patch.name,
          updatedAt: now,
          theme: structuredClone(patch.theme),
          // A theme saved before defaults existed takes its pre-edit look as its default.
          baseline: item.baseline ?? item.theme,
        }
      : item,
  )
}

/** The default Reset returns `id` to. */
export function themeBaseline(item: CustomOverlayTheme): OverlayTheme {
  return item.baseline ?? item.theme
}

/** Makes `theme` the default for `id` — "Set as default". */
export function setThemeBaseline(
  library: readonly CustomOverlayTheme[],
  id: string,
  theme: OverlayTheme,
): CustomOverlayTheme[] {
  return library.map((item) => (item.id === id ? { ...item, baseline: structuredClone(theme) } : item))
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
      ...(candidate.baseline ? { baseline: normalizeOverlayTheme(candidate.baseline) } : {}),
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
      theme: structuredClone(theme.theme),
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

// ─── Built-in themes ──────────────────────────────────────────────────────────

export const BUILT_IN_THEMES: Array<{
  id: string
  name: string
  kind: OverlayContentKind
  theme: OverlayTheme
}> = [
  { id: 'broadcast', name: 'Broadcast', kind: 'scripture', theme: DEFAULT_OVERLAY_SETTINGS.theme },
  {
    id: 'warm-paper',
    name: 'Warm paper',
    kind: 'scripture',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'color', color: '#e8dfcf' },
        verse: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.verse,
          fontFamily: "Georgia, 'Times New Roman', serif",
          color: '#201d19',
          align: 'left',
          shadow: { ...DEFAULT_OVERLAY_SETTINGS.theme.verse.shadow, enabled: false },
        },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, color: '#8b4b32', position: 'above' },
        layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, backdropBox: false },
      },
      'center',
      72
    ),
  },
  {
    id: 'midnight',
    name: 'Midnight',
    kind: 'scripture',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'gradient', color: '#07111f', color2: '#18324b', angleDeg: 135 },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, color: '#AABED7' },
        layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, backdropBox: false },
      },
      'center',
      76
    ),
  },

  // ── Lyrics ────────────────────────────────────────────────────────────────
  // Lyric slides are read at a glance from the back of a room, so these start
  // full-frame with a transparent background — the motion background belongs to
  // ProPresenter's media layer underneath, not baked into our frame.
  {
    id: 'lyrics-stage',
    name: 'Stage lyrics',
    kind: 'lyrics',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'transparent' },
        verse: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.verse,
          fontSizePx: 96,
          fontWeight: 700,
          align: 'center',
          verticalAlign: 'middle',
          lineHeight: 1.25,
        },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, show: false },
        layout: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.layout,
          backdropBox: false,
          autoFitText: true,
        },
      },
      'full',
      92
    ),
  },
  {
    id: 'lyrics-lower',
    name: 'Lyrics lower third',
    kind: 'lyrics',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'transparent' },
        verse: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.verse,
          fontSizePx: 64,
          fontWeight: 600,
          align: 'center',
          verticalAlign: 'bottom',
        },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, show: false },
        layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, autoFitText: true },
      },
      'lower-third',
      84
    ),
  },
]

/** Built-in starters for one content kind. */
export function builtInThemesForKind(kind: OverlayContentKind): typeof BUILT_IN_THEMES {
  return BUILT_IN_THEMES.filter((item) => item.kind === kind)
}

/**
 * A library nobody has shaped yet: empty, or only the single default theme the
 * first launch writes ("My current theme", unchanged).
 */
export function isUntouchedThemeLibrary(library: readonly CustomOverlayTheme[]): boolean {
  if (library.length === 0) return true
  if (library.length !== 1) return false
  const only = library[0]
  return only.kind === 'scripture' && only.name === 'My current theme' &&
    JSON.stringify(normalizeOverlayTheme(only.theme)) === JSON.stringify(normalizeOverlayTheme(DEFAULT_OVERLAY_SETTINGS.theme))
}

/**
 * A new install's library: every built-in as a real theme. The untouched
 * default becomes "Broadcast" in place, keeping its id so screens that point
 * at it still do.
 */
export function seedBuiltInThemes(library: readonly CustomOverlayTheme[], now = Date.now()): CustomOverlayTheme[] {
  const reuseId = library[0]?.id
  return BUILT_IN_THEMES.map((item, index) =>
    createCustomTheme(item.name, item.theme, item.kind, now + index, index === 0 && reuseId ? reuseId : undefined),
  )
}

/**
 * A new screen or NDI feed starts with the default theme for each kind that
 * has one (`themeDefaults`). Kinds without a default — or whose default was
 * deleted — keep the output's built-in look.
 */
export function withDefaultThemes(
  output: OverlayOutput,
  library: readonly CustomOverlayTheme[],
  defaults: Partial<Record<CustomOverlayTheme['kind'], string>> | undefined,
): OverlayOutput {
  if (output.kind !== 'screen' && output.kind !== 'ndi') return output
  let next = output
  for (const kind of ['scripture', 'lyrics'] as const) {
    const theme = library.find((entry) => entry.id === defaults?.[kind] && entry.kind === kind)
    if (theme) next = assignThemeToOutput(next, theme)
  }
  return next
}

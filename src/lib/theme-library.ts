import type { CustomOverlayTheme, OverlayContentKind, OverlayTheme } from './ipc'
import { normalizeOverlayTheme } from './overlay-defaults'

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

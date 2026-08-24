import type { CustomOverlayTheme, OverlayTheme } from './ipc'
import { normalizeOverlayTheme } from './overlay-defaults'

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `theme-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createCustomTheme(
  name: string,
  theme: OverlayTheme,
  now = Date.now(),
  id = newId(),
): CustomOverlayTheme {
  return {
    id,
    name: name.trim() || 'Untitled theme',
    createdAt: now,
    updatedAt: now,
    theme: structuredClone(theme),
  }
}

export function normalizeThemeLibrary(
  raw: unknown,
  activeTheme: OverlayTheme,
  now = Date.now(),
  legacyId = newId(),
): CustomOverlayTheme[] {
  if (!Array.isArray(raw)) return [createCustomTheme('My current theme', activeTheme, now, legacyId)]

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
      createdAt,
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : createdAt,
      theme: normalizeOverlayTheme(candidate.theme),
    })
  }
  return normalized
}

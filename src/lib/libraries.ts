/**
 * User-made libraries: named containers that own items.
 *
 * The same shape serves songs, documents and saved passages, so the three
 * pages read alike. A library owns; a playlist (setlist / sermon plan) orders.
 * Keeping those two ideas apart is what lets the same song sit in one library
 * forever and appear in a different service order every week.
 */
export type LibraryKind = 'songs' | 'documents' | 'scripture'
export const LIBRARY_KINDS: LibraryKind[] = ['songs', 'documents', 'scripture']

export interface Library {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/**
 * State for one kind.
 *
 * `assignments` maps item id → library id. Items with no entry belong to the
 * default library, so nothing has to be written when the app first meets an
 * existing song or document.
 */
export interface LibraryState {
  libraries: Library[]
  assignments: Record<string, string>
}

/** The always-present library. Never renamed, never deleted, holds the rest. */
export const DEFAULT_LIBRARY_ID = 'default'

export const DEFAULT_LIBRARY_NAME: Record<LibraryKind, string> = {
  songs: 'All songs',
  documents: 'All documents',
  scripture: 'All passages',
}

export const LIBRARY_MAX = 50

export const LIBRARIES_CHANNEL = 'libraries:command'
export const LIBRARIES_CHANGED = 'libraries:changed'

export type LibrariesCommand =
  | { action: 'list' }
  | { action: 'create'; kind: LibraryKind; name: string }
  | { action: 'rename'; kind: LibraryKind; libraryId: string; name: string }
  /** Items in the deleted library move to the default — never destroyed. */
  | { action: 'delete'; kind: LibraryKind; libraryId: string }
  | { action: 'assign'; kind: LibraryKind; itemIds: string[]; libraryId: string }

export type LibrariesState = Record<LibraryKind, LibraryState>

export interface LibrariesAPI {
  command: (command: LibrariesCommand) => Promise<LibrariesState>
  onChanged: (callback: (state: LibrariesState) => void) => () => void
}

export function emptyLibraryState(): LibraryState {
  return { libraries: [], assignments: {} }
}

export function emptyLibrariesState(): LibrariesState {
  return { songs: emptyLibraryState(), documents: emptyLibraryState(), scripture: emptyLibraryState() }
}

/** Display name for a library — not a filesystem path. */
export function normalizeLibraryName(name: string, fallback = 'New library'): string {
  // eslint-disable-next-line no-control-regex -- stripping C0 controls from display names is the point.
  const trimmed = String(name ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return (trimmed || fallback).slice(0, 80)
}

/** Read any stored shape into a total one, dropping malformed entries. */
export function normalizeLibraryState(raw: unknown): LibraryState {
  const value = (raw ?? {}) as Partial<LibraryState>
  const libraries = Array.isArray(value.libraries)
    ? value.libraries
      .filter((library): library is Library =>
        typeof library?.id === 'string' && library.id !== DEFAULT_LIBRARY_ID)
      .map(library => ({ ...library, name: normalizeLibraryName(library.name) }))
    : []
  const known = new Set(libraries.map(library => library.id))
  const assignments: Record<string, string> = {}
  for (const [itemId, libraryId] of Object.entries(value.assignments ?? {})) {
    // An assignment to a library that no longer exists is the default library,
    // which is also what an absent entry means — so it is simply dropped.
    if (typeof libraryId === 'string' && known.has(libraryId)) assignments[itemId] = libraryId
  }
  return { libraries, assignments }
}

export function normalizeLibrariesState(raw: unknown): LibrariesState {
  const value = (raw ?? {}) as Partial<Record<LibraryKind, unknown>>
  return {
    songs: normalizeLibraryState(value.songs),
    documents: normalizeLibraryState(value.documents),
    scripture: normalizeLibraryState(value.scripture),
  }
}

/** Which library an item is in. Anything unassigned is in the default. */
export function libraryOf(state: LibraryState, itemId: string): string {
  return state.assignments[itemId] ?? DEFAULT_LIBRARY_ID
}

export function itemsInLibrary<T extends { id: string }>(
  state: LibraryState,
  items: T[],
  libraryId: string,
): T[] {
  if (libraryId === DEFAULT_LIBRARY_ID) return items
  return items.filter(item => state.assignments[item.id] === libraryId)
}

/** Item counts per library id, including the default's total. */
export function libraryCounts<T extends { id: string }>(
  state: LibraryState,
  items: T[],
): Record<string, number> {
  const counts: Record<string, number> = { [DEFAULT_LIBRARY_ID]: items.length }
  for (const library of state.libraries) counts[library.id] = 0
  for (const item of items) {
    const id = state.assignments[item.id]
    if (id && id in counts) counts[id] += 1
  }
  return counts
}

export function withAssignment(
  state: LibraryState,
  itemIds: string[],
  libraryId: string,
): LibraryState {
  const assignments = { ...state.assignments }
  for (const itemId of itemIds) {
    // Moving to the default means "no entry", which keeps the map small and
    // makes a deleted library's items fall home on their own.
    if (libraryId === DEFAULT_LIBRARY_ID) delete assignments[itemId]
    else assignments[itemId] = libraryId
  }
  return { ...state, assignments }
}

/** Delete a library; everything it held moves to the default. */
export function withoutLibrary(state: LibraryState, libraryId: string): LibraryState {
  const libraries = state.libraries.filter(library => library.id !== libraryId)
  const assignments: Record<string, string> = {}
  for (const [itemId, id] of Object.entries(state.assignments)) {
    if (id !== libraryId) assignments[itemId] = id
  }
  return { libraries, assignments }
}

/** Forget an item that no longer exists, so deletes leave no stale rows. */
export function withoutItem(state: LibraryState, itemId: string): LibraryState {
  if (!(itemId in state.assignments)) return state
  const assignments = { ...state.assignments }
  delete assignments[itemId]
  return { ...state, assignments }
}

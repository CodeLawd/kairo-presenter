/**
 * Named song setlists — the song-side twin of sermon plans.
 *
 * Deliberately a list of song ids, not copies of songs. A setlist that held
 * snapshots would drift the moment someone fixed a typo in the lyrics, and the
 * booth would sing from the stale copy. The library stays the single source of
 * truth; a setlist is only a name and an order.
 */
export interface SongSetlist {
  id: string
  name: string
  /** Song ids, in service order. */
  songIds: string[]
  createdAt: number
  updatedAt: number
}

export interface SetlistState {
  lists: SongSetlist[]
  /** The list drops and quick-open additions land in. */
  activeId: string | null
}

export const SETLIST_CHANNEL = 'setlist:command'
export const SETLIST_CHANGED = 'setlist:changed'

export type SetlistCommand =
  | { action: 'list' }
  | { action: 'create'; name: string }
  | { action: 'rename'; listId: string; name: string }
  | { action: 'delete'; listId: string }
  | { action: 'select'; listId: string | null }
  /** Append a song to a list, or move it to `index` when already there. */
  | { action: 'add'; songId: string; index?: number; listId?: string }
  | { action: 'removeSong'; songId: string; listId?: string }
  | { action: 'clear'; listId?: string }

export interface SetlistAPI {
  command: (command: SetlistCommand) => Promise<SetlistState>
  onChanged: (callback: (state: SetlistState) => void) => () => void
}

/** Most services run well under this; the cap only stops runaway input. */
export const SETLIST_MAX = 100
export const SETLIST_MAX_LISTS = 50
export const DEFAULT_SETLIST_NAME = 'Sunday service'

export function emptySetlistState(): SetlistState {
  return { lists: [], activeId: null }
}

/** Display name for a setlist — not a filesystem path. */
export function normalizeSetlistName(name: string, fallback = DEFAULT_SETLIST_NAME): string {
  // eslint-disable-next-line no-control-regex -- stripping C0 controls from display names is the point.
  const trimmed = String(name ?? '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return (trimmed || fallback).slice(0, 80)
}

/**
 * Insert a song at `index`, or append when no index is given.
 *
 * Adding a song that is already listed moves it rather than duplicating it:
 * the same song twice in one service is nearly always a mis-drop, and undoing
 * a duplicate costs more than re-dragging the rare intentional repeat.
 */
export function withSong(songIds: string[], songId: string, index?: number): string[] {
  if (!songId) return songIds
  const rest = songIds.filter(id => id !== songId)
  if (index === undefined || index >= rest.length) {
    return rest.length >= SETLIST_MAX ? songIds : [...rest, songId]
  }
  const at = Math.max(0, Math.trunc(index))
  return [...rest.slice(0, at), songId, ...rest.slice(at)]
}

export function withoutSong(songIds: string[], songId: string): string[] {
  return songIds.filter(id => id !== songId)
}

/** Drop ids whose song is gone from the library, keeping the rest in order. */
export function prunedSetlist(songIds: string[], libraryIds: Iterable<string>): string[] {
  const known = new Set(libraryIds)
  return songIds.filter(id => known.has(id))
}

/**
 * Read any stored shape into the current one.
 *
 * Stores written before setlists could be named held a single bare list; it
 * becomes the first named list rather than being thrown away.
 */
export function migrateSetlistState(raw: unknown, now = Date.now()): SetlistState {
  const value = (raw ?? {}) as Partial<SetlistState> & { songIds?: unknown; updatedAt?: number }
  const lists = Array.isArray(value.lists)
    ? value.lists.filter((list): list is SongSetlist => typeof list?.id === 'string')
      .map(list => ({
        ...list,
        name: normalizeSetlistName(list.name),
        songIds: Array.isArray(list.songIds) ? list.songIds.filter(id => typeof id === 'string') : [],
      }))
    : []

  if (!lists.length && Array.isArray(value.songIds) && value.songIds.length) {
    const songIds = (value.songIds as unknown[]).filter((id): id is string => typeof id === 'string')
    lists.push({
      id: 'setlist-legacy',
      name: DEFAULT_SETLIST_NAME,
      songIds,
      createdAt: value.updatedAt ?? now,
      updatedAt: value.updatedAt ?? now,
    })
  }

  const activeId = lists.some(list => list.id === value.activeId)
    ? (value.activeId as string)
    : lists[0]?.id ?? null
  return { lists, activeId }
}

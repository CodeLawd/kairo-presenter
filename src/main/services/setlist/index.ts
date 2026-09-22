import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import log from 'electron-log/main'
import {
  DEFAULT_SETLIST_NAME, emptySetlistState, migrateSetlistState, normalizeSetlistName,
  SETLIST_MAX_LISTS, withoutSong, withSong,
  type SetlistCommand, type SetlistState, type SongSetlist,
} from '@shared/setlist'

/**
 * Named song setlists, persisted beside the other booth state.
 *
 * Its own store file rather than a settings key: this changes many times during
 * a service and has nothing to do with configuration.
 */
class SetlistService {
  private readonly db = new Store<SetlistState>({ name: 'kairo-setlist', defaults: emptySetlistState() })
  private listeners: Array<(state: SetlistState) => void> = []

  /** Every read normalizes, so a legacy single-list store is never seen raw. */
  snapshot(): SetlistState {
    return migrateSetlistState(this.db.store)
  }

  onChanged(callback: (state: SetlistState) => void): void {
    this.listeners.push(callback)
  }

  private write(state: SetlistState): SetlistState {
    this.db.store = state
    for (const listener of this.listeners) listener(state)
    return state
  }

  /** Apply an edit to one list, defaulting to the active one. */
  private editList(
    state: SetlistState,
    listId: string | undefined,
    edit: (songIds: string[]) => string[],
  ): SetlistState {
    const targetId = listId ?? state.activeId
    const target = state.lists.find(list => list.id === targetId)
    if (!target) throw new Error('Create a setlist first.')
    const songIds = edit(target.songIds)
    return {
      ...state,
      lists: state.lists.map(list =>
        list.id === target.id ? { ...list, songIds, updatedAt: Date.now() } : list,
      ),
    }
  }

  apply(command: SetlistCommand): SetlistState {
    const state = this.snapshot()
    switch (command.action) {
      case 'list':
        return state

      case 'create': {
        if (state.lists.length >= SETLIST_MAX_LISTS) throw new Error('Delete a setlist before creating another.')
        const now = Date.now()
        const created: SongSetlist = {
          id: randomUUID(),
          name: normalizeSetlistName(command.name, DEFAULT_SETLIST_NAME),
          songIds: [],
          createdAt: now,
          updatedAt: now,
        }
        // New lists go to the top and become active: creating one is always a
        // prelude to filling it.
        return this.write({ lists: [created, ...state.lists], activeId: created.id })
      }

      case 'rename':
        return this.write({
          ...state,
          lists: state.lists.map(list =>
            list.id === command.listId
              ? { ...list, name: normalizeSetlistName(command.name, list.name), updatedAt: Date.now() }
              : list,
          ),
        })

      case 'delete': {
        const lists = state.lists.filter(list => list.id !== command.listId)
        const activeId = state.activeId === command.listId ? lists[0]?.id ?? null : state.activeId
        return this.write({ lists, activeId })
      }

      case 'select':
        return this.write({
          ...state,
          activeId: state.lists.some(list => list.id === command.listId) ? command.listId : null,
        })

      case 'add':
        return this.write(this.editList(state, command.listId, songIds =>
          withSong(songIds, command.songId, command.index)))

      case 'removeSong':
        return this.write(this.editList(state, command.listId, songIds =>
          withoutSong(songIds, command.songId)))

      case 'clear':
        return this.write(this.editList(state, command.listId, () => []))

      default:
        throw new Error('Unknown setlist command.')
    }
  }

  /** Drop a song the library no longer has, so deletes leave no ghosts behind. */
  forgetSong(songId: string): void {
    const state = this.snapshot()
    if (!state.lists.some(list => list.songIds.includes(songId))) return
    this.write({
      ...state,
      lists: state.lists.map(list =>
        list.songIds.includes(songId)
          ? { ...list, songIds: withoutSong(list.songIds, songId), updatedAt: Date.now() }
          : list,
      ),
    })
    log.info('[Setlist] Removed a song that left the library', { songId })
  }
}

export const setlistService = new SetlistService()

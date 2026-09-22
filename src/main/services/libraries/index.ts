import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import log from 'electron-log/main'
import {
  emptyLibrariesState, LIBRARY_MAX, normalizeLibrariesState, normalizeLibraryName,
  withAssignment, withoutItem, withoutLibrary,
  type LibrariesCommand, type LibrariesState, type Library, type LibraryKind,
} from '@shared/libraries'

/**
 * User-made libraries for songs, documents and saved passages.
 *
 * One store for all three kinds: the shape is identical, and a single file
 * keeps a rename on one page from racing a write on another.
 */
class LibrariesService {
  private readonly db = new Store<LibrariesState>({
    name: 'kairo-libraries',
    defaults: emptyLibrariesState(),
  })
  private listeners: Array<(state: LibrariesState) => void> = []

  /** Every read normalizes, so a hand-edited file is never seen raw. */
  snapshot(): LibrariesState {
    return normalizeLibrariesState(this.db.store)
  }

  onChanged(callback: (state: LibrariesState) => void): void {
    this.listeners.push(callback)
  }

  private write(state: LibrariesState): LibrariesState {
    this.db.store = state
    for (const listener of this.listeners) listener(state)
    return state
  }

  apply(command: LibrariesCommand): LibrariesState {
    const state = this.snapshot()
    if (command.action === 'list') return state
    const kind: LibraryKind = command.kind
    const current = state[kind]
    if (!current) throw new Error('Unknown library kind.')

    switch (command.action) {
      case 'create': {
        if (current.libraries.length >= LIBRARY_MAX) {
          throw new Error('Delete a library before creating another.')
        }
        const now = Date.now()
        const created: Library = {
          id: randomUUID(),
          name: normalizeLibraryName(command.name),
          createdAt: now,
          updatedAt: now,
        }
        return this.write({ ...state, [kind]: { ...current, libraries: [...current.libraries, created] } })
      }

      case 'rename':
        return this.write({
          ...state,
          [kind]: {
            ...current,
            libraries: current.libraries.map(library =>
              library.id === command.libraryId
                ? { ...library, name: normalizeLibraryName(command.name, library.name), updatedAt: Date.now() }
                : library,
            ),
          },
        })

      case 'delete':
        // Items come home to the default rather than disappearing with it.
        return this.write({ ...state, [kind]: withoutLibrary(current, command.libraryId) })

      case 'assign':
        return this.write({
          ...state,
          [kind]: withAssignment(current, command.itemIds, command.libraryId),
        })

      default:
        throw new Error('Unknown library command.')
    }
  }

  /** Drop an item that no longer exists anywhere in the app. */
  forgetItem(kind: LibraryKind, itemId: string): void {
    const state = this.snapshot()
    const next = withoutItem(state[kind], itemId)
    if (next === state[kind]) return
    this.write({ ...state, [kind]: next })
    log.info('[Libraries] Forgot a deleted item', { kind, itemId })
  }
}

export const librariesService = new LibrariesService()

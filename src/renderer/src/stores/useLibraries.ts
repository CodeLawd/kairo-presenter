import { useEffect } from 'react'
import { create } from 'zustand'
import {
  emptyLibrariesState,
  type LibrariesCommand,
  type LibrariesState,
  type LibraryKind,
  type LibraryState,
} from '@shared/libraries'

/** MIME type carried by a library-item drag, so only item drops are accepted. */
export const LIBRARY_ITEM_DRAG_TYPE = 'application/x-kairo-library-item'

interface LibrariesStore {
  state: LibrariesState
  loaded: boolean
  set: (state: LibrariesState) => void
}

export const useLibrariesStore = create<LibrariesStore>(set => ({
  state: emptyLibrariesState(),
  loaded: false,
  set: (state) => set({ state, loaded: true }),
}))

/** The library state for one page's kind. */
export function useLibrary(kind: LibraryKind): LibraryState {
  return useLibrariesStore((store) => store.state[kind])
}

/**
 * Send a command and apply the result.
 *
 * Main owns the file and returns the authoritative state — the renderer never
 * guesses what a create or a move produced.
 */
export async function runLibrariesCommand(command: LibrariesCommand): Promise<LibrariesState> {
  const next = await window.api.libraries.command(command)
  useLibrariesStore.getState().set(next)
  return next
}

/** Keep the store in step with main for the whole session. */
export function useLibrariesSync(): void {
  useEffect(() => {
    let received = false
    const unsub = window.api.libraries.onChanged(value => {
      received = true
      useLibrariesStore.getState().set(value)
    })
    void window.api.libraries
      .command({ action: 'list' })
      .then(value => { if (!received) useLibrariesStore.getState().set(value) })
      .catch(() => undefined)
    return unsub
  }, [])
}

/** Marks what kind of item a drag carries, so a Scripture library never
 *  accepts a song dragged from the ⌘F song finder (which opens on any page). */
export function libraryKindDragType(kind: LibraryKind): string {
  return `application/x-kairo-kind-${kind}`
}

export function startLibraryItemDrag(
  event: React.DragEvent,
  itemId: string,
  label: string,
  kind?: LibraryKind,
): void {
  event.dataTransfer.setData(LIBRARY_ITEM_DRAG_TYPE, itemId)
  event.dataTransfer.setData('text/plain', label)
  if (kind) event.dataTransfer.setData(libraryKindDragType(kind), itemId)
  event.dataTransfer.effectAllowed = 'copyMove'
}

/** A library row accepts the drag: an item, and not one marked as another kind. */
export function acceptsLibraryDrag(types: readonly string[], kind: LibraryKind): boolean {
  if (!types.includes(LIBRARY_ITEM_DRAG_TYPE)) return false
  const marked = types.filter((type) => type.startsWith('application/x-kairo-kind-'))
  return marked.length === 0 || marked.includes(libraryKindDragType(kind))
}

export function itemIdFromDrag(transfer: DataTransfer): string {
  return transfer.getData(LIBRARY_ITEM_DRAG_TYPE) || ''
}

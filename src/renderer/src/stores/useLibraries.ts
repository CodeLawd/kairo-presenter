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

export function startLibraryItemDrag(event: React.DragEvent, itemId: string, label: string): void {
  event.dataTransfer.setData(LIBRARY_ITEM_DRAG_TYPE, itemId)
  event.dataTransfer.setData('text/plain', label)
  event.dataTransfer.effectAllowed = 'copyMove'
}

export function itemIdFromDrag(transfer: DataTransfer): string {
  return transfer.getData(LIBRARY_ITEM_DRAG_TYPE) || ''
}

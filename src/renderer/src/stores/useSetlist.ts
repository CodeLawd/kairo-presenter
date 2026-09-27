import { useEffect } from 'react'
import { create } from 'zustand'
import { setDragPreview } from '@/lib/drag'
import { emptySetlistState, type SetlistCommand, type SetlistState, type SongSetlist } from '@shared/setlist'

/** MIME type carried by a song drag, so only song drops are accepted. */
export const SONG_DRAG_TYPE = 'application/x-kairo-song'

interface SetlistStore extends SetlistState {
  loaded: boolean
  set: (state: SetlistState) => void
}

export const useSetlistStore = create<SetlistStore>(set => ({
  ...emptySetlistState(),
  loaded: false,
  set: (state) => set({ ...state, loaded: true }),
}))

/** The list drops land in, or null when none exists yet. */
export function activeSetlist(state: SetlistState): SongSetlist | null {
  return state.lists.find(list => list.id === state.activeId) ?? null
}

/**
 * Send a setlist command and apply the result.
 *
 * Every mutation goes through main, which owns the file, and the returned
 * snapshot is authoritative — the renderer never guesses the new order.
 */
export async function runSetlistCommand(command: SetlistCommand): Promise<void> {
  const next = await window.api.setlist.command(command)
  useSetlistStore.getState().set(next)
}

/** Read the dragged song id, whichever way the drag was started. */
export function songIdFromDrag(transfer: DataTransfer): string {
  return transfer.getData(SONG_DRAG_TYPE) || transfer.getData('text/plain') || ''
}

export function startSongDrag(event: React.DragEvent, songId: string, title: string): void {
  event.dataTransfer.setData(SONG_DRAG_TYPE, songId)
  event.dataTransfer.setData('text/plain', title)
  event.dataTransfer.effectAllowed = 'copyMove'
  setDragPreview(event, title)
}

/**
 * Keep the store in step with main for the whole session.
 *
 * Mounted once at the app root, not in the setlist panel: the quick-open
 * search shows which songs are already queued, and it opens from any route —
 * including ones where the Lyrics page (and its panel) is not mounted.
 */
export function useSetlistSync(): void {
  useEffect(() => {
    let received = false
    const unsub = window.api.setlist.onChanged(value => {
      received = true
      useSetlistStore.getState().set(value)
    })
    void window.api.setlist
      .command({ action: 'list' })
      .then(value => { if (!received) useSetlistStore.getState().set(value) })
      .catch(() => undefined)
    return unsub
  }, [])
}

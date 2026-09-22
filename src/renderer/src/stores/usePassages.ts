import { useEffect } from 'react'
import { create } from 'zustand'
import type { PassagesCommand, SavedPassage } from '@shared/passages'

interface PassagesStore {
  passages: SavedPassage[]
  loaded: boolean
  set: (passages: SavedPassage[]) => void
}

export const usePassagesStore = create<PassagesStore>(set => ({
  passages: [],
  loaded: false,
  set: (passages) => set({ passages, loaded: true }),
}))

export async function runPassagesCommand(command: PassagesCommand): Promise<SavedPassage[]> {
  const next = await window.api.passages.command(command)
  usePassagesStore.getState().set(next)
  return next
}

/** Keep saved passages in step with main for the whole session. */
export function usePassagesSync(): void {
  useEffect(() => {
    let received = false
    const unsub = window.api.passages.onChanged(value => {
      received = true
      usePassagesStore.getState().set(value)
    })
    void window.api.passages
      .command({ action: 'list' })
      .then(value => { if (!received) usePassagesStore.getState().set(value) })
      .catch(() => undefined)
    return unsub
  }, [])
}

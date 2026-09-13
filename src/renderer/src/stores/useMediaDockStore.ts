import { create } from 'zustand'

interface MediaDockState {
  open: boolean
  /** What's currently on the booth background — drives the header badge. */
  liveItemId: string | null
  liveName: string | null
  livePaused: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  setLive: (live: { id: string | null; name: string | null; paused?: boolean }) => void
}

export const useMediaDockStore = create<MediaDockState>((set) => ({
  open: false,
  liveItemId: null,
  liveName: null,
  livePaused: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setLive: ({ id, name, paused = false }) =>
    set({ liveItemId: id, liveName: name, livePaused: paused }),
}))

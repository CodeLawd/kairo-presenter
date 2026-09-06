import { create } from 'zustand'
import type { TracksLibrary } from '@shared/ipc'

export const EMPTY_TRACKS_LIBRARY: TracksLibrary = {
  folder: '',
  items: [],
  liveId: null,
  livePaused: false,
  error: null,
}

interface TracksPlaybackState {
  library: TracksLibrary
  currentTime: number
  duration: number
  ended: boolean
  seekToken: number
  seekSeconds: number
  setLibrary: (library: TracksLibrary) => void
  setTime: (time: { currentTime: number; duration: number; ended: boolean }) => void
  requestSeek: (seconds: number) => void
}

export const useTracksPlaybackStore = create<TracksPlaybackState>((set) => ({
  library: EMPTY_TRACKS_LIBRARY,
  currentTime: 0,
  duration: 0,
  ended: false,
  seekToken: 0,
  seekSeconds: 0,
  setLibrary: (library) => set({ library }),
  setTime: (time) => set(time),
  requestSeek: (seconds) =>
    set((current) => ({
      seekToken: current.seekToken + 1,
      seekSeconds: Math.max(0, seconds),
      currentTime: Math.max(0, seconds),
      ended: false,
    })),
}))

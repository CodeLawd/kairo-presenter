import { create } from 'zustand'

export type BoothToolboxTab = 'search' | 'audio' | 'timers' | 'messages'

interface BoothToolboxState {
  tab: BoothToolboxTab
  setTab: (tab: BoothToolboxTab) => void
}

export const useBoothToolboxStore = create<BoothToolboxState>((set) => ({
  tab: 'search',
  setTab: (tab) => set({ tab }),
}))

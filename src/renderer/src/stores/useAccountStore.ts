import { create } from 'zustand'
import type { DevicePairingState, SessionSnapshot } from '@shared/ipc'

const EMPTY_SESSION: SessionSnapshot = {
  state: 'signed-out',
  user: null,
  org: null,
  orgs: [],
  lastSyncedAt: null,
}

const IDLE_PAIRING: DevicePairingState = {
  status: 'idle',
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  message: null,
}

interface AccountStore {
  session: SessionSnapshot
  pairing: DevicePairingState

  setSession: (session: SessionSnapshot) => void
  setPairing: (pairing: DevicePairingState) => void
}

/**
 * Account state, hydrated from the startup snapshot and kept current by the two
 * push subscriptions. Deliberately separate from `useBootstrapStore`: nothing
 * here may ever become something a screen waits on.
 */
export const useAccountStore = create<AccountStore>((set) => ({
  session: EMPTY_SESSION,
  pairing: IDLE_PAIRING,

  setSession: (session) => set({ session }),
  setPairing: (pairing) => set({ pairing }),
}))

export { isSignedIn } from '@shared/cloud/auth-state'

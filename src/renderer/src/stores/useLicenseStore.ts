import { useEffect } from 'react'
import { create } from 'zustand'
import type { LicenseSnapshot } from '@shared/cloud/licensing'

export const useLicenseStore = create<{ snapshot: LicenseSnapshot | null; setSnapshot: (snapshot: LicenseSnapshot) => void }>(set => ({ snapshot: null, setSnapshot: snapshot => set({ snapshot }) }))
export function useLicense(): LicenseSnapshot | null {
  const snapshot = useLicenseStore(state => state.snapshot)
  useEffect(() => {
    const set = useLicenseStore.getState().setSnapshot
    let alive = true
    let changed = false
    const off = window.api.account.onLicenseChange(value => { changed = true; set(value) })
    void window.api.account.getLicense().then(value => { if (alive && !changed) set(value) }).catch(() => undefined)
    return () => { alive = false; off() }
  }, [])
  return snapshot
}

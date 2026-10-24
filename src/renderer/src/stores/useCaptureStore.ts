import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { IDLE_CAPTURE_STATUS, type CaptureStatus } from '@shared/capture'

interface CaptureStore {
  status: CaptureStatus
  /** Start or Stop is on its way to the main process. */
  busy: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
}

/** Recording state, pushed from the main process; one subscription for the app. */
export const useCaptureStore = create<CaptureStore>((set, get) => ({
  status: IDLE_CAPTURE_STATUS,
  busy: false,
  start: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      set({ status: await window.api.capture.start() })
    } finally {
      set({ busy: false })
    }
  },
  stop: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      set({ status: await window.api.capture.stop() })
    } finally {
      set({ busy: false })
    }
  },
}))

let subscribed = false

/** Call once near the root: keeps `useCaptureStore` in step with the main process. */
export function useCaptureSubscription(): void {
  useEffect(() => {
    if (subscribed) return
    subscribed = true
    const set = (status: CaptureStatus): void => useCaptureStore.setState({ status })
    void window.api.capture.status().then(set).catch(() => undefined)
    const unsubscribe = window.api.capture.onStatus(set)
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [])
}

/** Milliseconds since the recording started, ticking once a second; 0 when not recording. */
export function useCaptureElapsed(): number {
  const startedAt = useCaptureStore((s) => s.status.startedAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return startedAt ? Math.max(0, now - startedAt) : 0
}

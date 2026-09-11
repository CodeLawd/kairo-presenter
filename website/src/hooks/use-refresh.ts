'use client'

import { useEffect, useRef } from 'react'

/**
 * Run `callback` on an interval, but only while the tab is actually being
 * looked at. A background tab polling an API helps nobody.
 *
 * Pass `enabled: false` to stop — the timer is torn down rather than left
 * waking up to do nothing.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
): void {
  const latest = useRef(callback)
  latest.current = callback

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') latest.current()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [enabled, intervalMs])
}

/**
 * Run `callback` when the reader comes back to the tab.
 *
 * Returning to a page is the moment someone expects to see what changed
 * elsewhere. `minIntervalMs` is a floor, because `focus` and
 * `visibilitychange` both fire on a single alt-tab and neither is worth a
 * request on its own.
 */
export function useRevalidateOnFocus(callback: () => void, minIntervalMs: number): void {
  const latest = useRef(callback)
  latest.current = callback
  const lastRunAt = useRef(0)

  useEffect(() => {
    const onFocus = (): void => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRunAt.current < minIntervalMs) return
      lastRunAt.current = Date.now()
      latest.current()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [minIntervalMs])
}

import { useEffect, useState } from 'react'
import { DEFAULT_PRESENTATION_SETTINGS, EMPTY_PROGRAM_STATE, type PresentationSettings, type ProgramState } from '@shared/program'
import { useSettings } from './useSettings'

/** The `presentation` settings section (transition, messages, props, logo, audio). */
export function usePresentation(): [PresentationSettings, (next: PresentationSettings) => Promise<void>] {
  return useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
}

/** Live program state (message, props, logo, camera, timer) pushed from main. */
export function useProgramState(): ProgramState {
  const [state, setState] = useState<ProgramState>(EMPTY_PROGRAM_STATE)
  useEffect(() => {
    let cancelled = false
    window.api.program
      .getState()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => undefined)
    const unsubscribe = window.api.program.onState(setState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return state
}

/**
 * Re-renders every `intervalMs` while `active` — for clocks and countdowns
 * derived from `Date.now()`. Idle, it costs nothing.
 */
export function useNow(intervalMs = 250, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}

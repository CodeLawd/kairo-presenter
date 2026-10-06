import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_PRESENTATION_SETTINGS, EMPTY_PROGRAM_STATE, type PresentationSettings, type ProgramState } from '@shared/program'
import { useSettings } from './useSettings'

/** The `presentation` settings section (transition, messages, props, logo, audio). */
export function usePresentation(): [PresentationSettings, (next: PresentationSettings) => Promise<void>] {
  return useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
}

// One subscription for the whole renderer: every panel, the layer strip and the
// live preview read the same state, so main's broadcast is received once.
let programState: ProgramState = EMPTY_PROGRAM_STATE
const programListeners = new Set<() => void>()
let stopProgramFeed: (() => void) | null = null

function subscribeProgram(listener: () => void): () => void {
  programListeners.add(listener)
  if (!stopProgramFeed) {
    const publish = (next: ProgramState): void => {
      programState = next
      programListeners.forEach((l) => l())
    }
    stopProgramFeed = window.api.program.onState(publish)
    window.api.program.getState().then(publish).catch(() => undefined)
  }
  return () => {
    programListeners.delete(listener)
    if (programListeners.size === 0 && stopProgramFeed) {
      stopProgramFeed()
      stopProgramFeed = null
    }
  }
}

/** Live program state (message, props, logo, camera, timer) pushed from main. */
export function useProgramState(): ProgramState {
  return useSyncExternalStore(subscribeProgram, () => programState, () => EMPTY_PROGRAM_STATE)
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

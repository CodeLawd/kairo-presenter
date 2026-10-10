import { useCallback, useRef, useState } from 'react'
import type { OverlayTheme } from '@shared/ipc'

/** Edits closer together than this are one undo step — a drag, a scrub, a slider. */
const COALESCE_MS = 600
const MAX_STEPS = 100

/**
 * Undo/redo for the theme open in the editor. `record` is called with the
 * theme as it was before each edit; `undo`/`redo` hand back the theme to show.
 */
export function useThemeHistory(): {
  canUndo: boolean
  canRedo: boolean
  record: (before: OverlayTheme) => void
  undo: (current: OverlayTheme) => OverlayTheme | null
  redo: (current: OverlayTheme) => OverlayTheme | null
  clear: () => void
} {
  const past = useRef<OverlayTheme[]>([])
  const future = useRef<OverlayTheme[]>([])
  const lastEdit = useRef(0)
  const [state, setState] = useState({ canUndo: false, canRedo: false })

  const sync = useCallback(() => {
    setState({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 })
  }, [])

  const record = useCallback(
    (before: OverlayTheme) => {
      const now = Date.now()
      if (now - lastEdit.current > COALESCE_MS) {
        past.current.push(before)
        if (past.current.length > MAX_STEPS) past.current.shift()
      }
      lastEdit.current = now
      future.current = []
      sync()
    },
    [sync],
  )

  const step = useCallback(
    (from: { current: OverlayTheme[] }, to: { current: OverlayTheme[] }, current: OverlayTheme) => {
      const target = from.current.pop()
      if (!target) return null
      to.current.push(current)
      // The next edit starts a fresh step rather than folding into this one.
      lastEdit.current = 0
      sync()
      return target
    },
    [sync],
  )

  const undo = useCallback((current: OverlayTheme) => step(past, future, current), [step])
  const redo = useCallback((current: OverlayTheme) => step(future, past, current), [step])

  const clear = useCallback(() => {
    past.current = []
    future.current = []
    lastEdit.current = 0
    sync()
  }, [sync])

  return { ...state, record, undo, redo, clear }
}

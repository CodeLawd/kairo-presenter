import { useCallback, useEffect, useRef, useState } from 'react'
import type { PresentationSettings } from '@shared/program'
import { usePresentation } from './useProgramState'

function report(err: unknown): void {
  console.error(err)
  window.alert((err as Error).message ?? String(err))
}

/**
 * Presentation settings with writes coalesced: a panel follows every change at
 * once, but a slider or colour drag reaches settings (a disk write and a
 * reconcile of every screen in main) once it settles, not on every step.
 */
export function useDraftPresentation(): [
  PresentationSettings,
  (next: PresentationSettings) => void,
  /** Writes a waiting change now instead of after the pause; resolves once saved. */
  () => Promise<void>,
] {
  const [stored, save] = usePresentation()
  const [draft, setDraft] = useState<PresentationSettings | null>(null)
  const pending = useRef<PresentationSettings | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    // Drop the draft once saved, unless a newer change is already waiting.
    if (next) await save(next).then(() => { if (!pending.current) setDraft(null) }, report)
  }, [save])
  useEffect(() => () => void flush(), [flush])
  const update = useCallback(
    (next: PresentationSettings) => {
      pending.current = next
      setDraft(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 250)
    },
    [flush],
  )
  return [draft ?? stored, update, flush]
}

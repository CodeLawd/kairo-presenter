import { useEffect, useRef, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { KairoMark } from '@/components/brand/KairoMark'
import { MovableDialog } from '@/components/shared/MovableDialog'
import { useCaptureStore } from '@/stores/useCaptureStore'

/** Always mounted, including during startup and account setup. */
export function QuitConfirmation(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const recording = useCaptureStore((s) => s.status.recording)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let active = true
    const show = (): void => {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setError('')
      setOpen(true)
    }
    const unsubscribe = window.api.app.onQuitRequested(show)
    // Recover a quit requested before React mounted or while the UI reloaded.
    void window.api.app.quitPending().then((pending) => {
      if (active && pending) show()
    }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])

  const respond = async (confirmed: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await window.api.app.respondToQuit(confirmed)
      if (!confirmed) { setOpen(false); setBusy(false) }
    } catch {
      setError('Could not close Kairo. Please try again.')
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="quit-confirmation-overlay fixed inset-0 bg-black/35" />
        <div className="quit-confirmation-panel fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
          <MovableDialog className="w-full max-w-[420px] pointer-events-auto">
            <AlertDialog.Content
              className="w-full overflow-hidden rounded-2xl modal-glass text-white outline-none"
              onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus() }}
              onCloseAutoFocus={(event) => { event.preventDefault(); previousFocus.current?.focus() }}
              onEscapeKeyDown={(event) => { event.preventDefault(); void respond(false) }}
            >
              <div data-modal-drag className="px-7 pb-7 pt-8">
                <KairoMark size="lg" />
                <AlertDialog.Title className="mt-6 text-[24px] font-semibold leading-tight tracking-tight">
                  Quit Kairo?
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-3 text-[14px] leading-relaxed text-zinc-400">
                  Your screens will go offline and live transcription will stop.{recording ? ' The recording will be stopped and saved.' : ''} Ready to close Kairo?
                </AlertDialog.Description>
                {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-2 bg-surface-tertiary px-7 py-5">
                <button ref={cancelRef} type="button" className="btn-secondary min-h-10" disabled={busy} onClick={() => { void respond(false) }}>
                  Keep Kairo open
                </button>
                <button type="button" className="btn-primary min-h-10 min-w-24" disabled={busy} onClick={() => { void respond(true) }}>
                  {busy ? 'Closing…' : 'Quit Kairo'}
                </button>
              </div>
            </AlertDialog.Content>
          </MovableDialog>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

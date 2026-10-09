import { useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { Loader, Mic } from '@/icons'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'
import PasswordInput from '@/components/ui/password-input'

/**
 * Shown when someone presses Start without a Deepgram key: transcription runs on
 * Deepgram, so listening without one would open a service that hears nothing.
 * The key can be pasted right here — it is checked with Deepgram, saved the
 * same way Settings saves it, and listening starts.
 */
export function DeepgramKeyDialog({ open, onOpenChange, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the key is saved — the caller starts listening. */
  onSaved: () => void
}): React.ReactElement {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setKey('')
    setError('')
  }, [open])

  const save = async (): Promise<void> => {
    const value = key.trim()
    if (!value || busy) return
    setBusy(true)
    setError('')
    try {
      const check = await window.api.settings.testApiKey('deepgram', value)
      if (!check.ok) {
        setError(check.message || 'Deepgram did not accept that key.')
        return
      }
      // Blank secret fields mean "unchanged", so only this key is written.
      const stt = useBootstrapStore.getState().settings.stt
      await window.api.settings.set('stt', { ...stt, apiKey: value, provider: 'deepgram' })
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The key could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-secondary p-6 text-white animate-spring-in">
          <div className="grid size-10 place-items-center rounded-full bg-surface-tertiary text-zinc-300">
            <Mic size={18} aria-hidden="true" />
          </div>
          <Dialog.Title className="mt-4 text-[17px] font-semibold tracking-tight text-zinc-50">
            Set up live transcription
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
            Kairo listens to the sermon through Deepgram. Add your Deepgram API key once and it’s saved for every service.
          </Dialog.Description>

          <form
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <label htmlFor="deepgram-key" className="label">Deepgram API key</label>
            <PasswordInput
              id="deepgram-key"
              value={key}
              onChange={(event) => { setKey(event.target.value); setError('') }}
              placeholder="Paste your key"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
            {error ? (
              <p role="alert" className="onboarding-error mt-2 text-[12px] text-red-400">{error}</p>
            ) : (
              <p className="mt-2 text-[12px] text-zinc-500">You can change it any time in Settings → API Keys.</p>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-[12px] font-medium text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  onOpenChange(false)
                  useAppStore.getState().openSettings('apikeys')
                }}
              >
                Open Settings
              </button>
              <div className="flex gap-2">
                <Dialog.Close type="button" disabled={busy} className="btn-secondary text-[13px]">
                  Not now
                </Dialog.Close>
                <button type="submit" disabled={busy || !key.trim()} className="btn-primary inline-flex items-center gap-2 text-[13px]">
                  {busy && <Loader size={13} className="animate-spin" aria-hidden="true" />}
                  {busy ? 'Checking…' : 'Save and start'}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

import { useState } from 'react'
import { useLicense, useLicenseStore } from '@/stores/useLicenseStore'
import { isSignedIn, useAccountStore } from '@/stores/useAccountStore'

/**
 * Activation for this computer: paste a key, press Activate. Keys come from the
 * church's Licence & Devices page on the website.
 */
export default function LicensePanel({ bare = false }: { bare?: boolean }): React.ReactElement {
  const snapshot = useLicense()
  const signedIn = useAccountStore(state => isSignedIn(state.session))
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activate = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.account.activateLicense(key)
      if (result.ok && result.data) { useLicenseStore.getState().setSnapshot(result.data); setKey('') }
      else setError(/device limit/i.test(result.error ?? '')
        ? 'That key didn’t work — it may have been revoked, or every computer slot is taken.'
        : result.error || 'Couldn’t activate. Try again.')
    } catch { setError('Couldn’t reach Kairo. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  const body = !signedIn ? (
    <p className="text-[13px] text-slate-400">Sign in to activate this computer.</p>
  ) : snapshot?.activated ? (
    <p className="flex items-center gap-2 text-[13px] text-slate-300">
      <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
      This computer is activated.
    </p>
  ) : (
    <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void activate() }}>
      <div className="flex gap-2">
        <input aria-label="Activation key" className="input flex-1 font-mono" autoComplete="off" spellCheck={false} autoFocus={bare} value={key} onChange={event => setKey(event.target.value)} placeholder="Activation key" required />
        <button type="submit" className="btn-primary" disabled={busy || !key.trim()}>{busy ? 'Activating…' : 'Activate'}</button>
      </div>
      <button type="button" className="self-start text-xs text-teal-400 hover:underline" onClick={() => void window.api.account.openWeb('/dashboard/licence')}>
        Get a key ↗
      </button>
    </form>
  )

  return (
    <section className={bare ? 'flex flex-col gap-2' : 'flex flex-col gap-3 rounded-lg bg-surface-tertiary p-4'} aria-label="Activation">
      {!bare && <h3 className="text-sm font-semibold text-white">Activation</h3>}
      {body}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </section>
  )
}

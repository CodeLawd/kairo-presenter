import { useRef, useState } from 'react'
import { Loader } from '@/icons'
import { createSingleFlight, MIN_PASSWORD_LENGTH, validateSignUp } from '@shared/cloud/auth-state'
import { useAccountStore } from '@/stores/useAccountStore'
import PasswordInput from '@/components/ui/password-input'
import { ProviderLogo } from '@/components/brand/ProviderLogos'

export type AuthMode = 'signIn' | 'signUp'
type Mode = AuthMode

/**
 * Email + password, used by both the setup wizard and the account gate.
 *
 * Sign-in is the default for the launch gate; sign-up is one toggle away.
 */
export default function AuthPanel({
  initialMode = 'signIn',
  onDone,
  onModeChange,
}: {
  initialMode?: Mode
  onDone?: () => void
  /** Told when the operator switches between creating an account and signing in. */
  onModeChange?: (mode: Mode) => void
}): React.ReactElement {
  const setSession = useAccountStore((s) => s.setSession)
  const pairing = useAccountStore((s) => s.pairing)
  const setPairing = useAccountStore((s) => s.setPairing)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [churchName, setChurchName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const submitFlight = useRef(createSingleFlight()).current

  const submit = (): Promise<void> =>
    submitFlight.run(async () => {
      setError(null)
      setNotice(null)

      if (mode === 'signUp') {
        // Checked here as well as on the server so the answer is instant and the
        // message sits under the field it belongs to.
        const invalid = validateSignUp({ name, churchName, email, password })
        if (invalid) {
          setError(invalid)
          return
        }
      }

      setBusy(true)
      try {
        const result =
          mode === 'signUp'
            ? await window.api.account.signUp({
                email: email.trim(),
                password,
                name: name.trim(),
                orgName: churchName.trim(),
              })
            : await window.api.account.signIn({ email: email.trim(), password })

        if (!result.ok || !result.data) {
          setError(result.error ?? 'Something went wrong.')
          return
        }
        setSession(result.data)
        onDone?.()
      } finally {
        setBusy(false)
      }
    })

  const resetPassword = async (): Promise<void> => {
    if (!email.trim()) {
      setError('Enter your email address first')
      return
    }
    await window.api.account.requestPasswordReset(email.trim())
    // Deliberately unconditional: the API will not say whether the address is
    // registered, and neither should this.
    setNotice('If that address has an account, a reset link is on its way.')
  }

  const pairInBrowser = async (): Promise<void> => {
    if (busy || pairing.status === 'waiting') return
    setBusy(true)
    setError(null)
    setNotice(null)
    try { setPairing(await window.api.account.startDevicePairing()) }
    catch { setError('Could not open browser sign-in. Please try again.') }
    finally { setBusy(false) }
  }

  if (pairing.status === 'waiting') {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <p className="text-sm text-slate-300">Finish signing in with Google in your browser, then approve this computer.</p>
        <p className="text-center font-mono text-2xl tracking-widest text-white">{pairing.userCode}</p>
        <p className="text-xs text-slate-500">Check that the browser shows this same code. Kairo will finish signing in automatically.</p>
        <button type="button" className="btn-secondary" onClick={() => void window.api.account.openWeb(`/activate?userCode=${encodeURIComponent(pairing.userCode ?? '')}`)}>Open browser again</button>
        <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => void window.api.account.cancelDevicePairing().then(setPairing)}>Cancel</button>
      </div>
    )
  }

  return (
    <div className="onboarding-step flex flex-col gap-4">
      <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2" disabled={busy} onClick={() => void pairInBrowser()}>
        <ProviderLogo id="google" />
        Continue with Google
      </button>
      {pairing.message && <p className="text-xs text-rose-400" role="alert">{pairing.message}</p>}
      <div className="flex items-center gap-3 text-xs text-slate-500" aria-hidden="true">
        <span className="h-px flex-1 bg-surface-border" />or<span className="h-px flex-1 bg-surface-border" />
      </div>
      {mode === 'signUp' && (
        <>
          <div>
            <label className="label" htmlFor="account-name">Your name</label>
            <input
              id="account-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Joshua Alexander"
              autoComplete="name"
              disabled={busy}
            />
          </div>
          <div>
            <label className="label" htmlFor="account-church">Church name</label>
            <input
              id="account-church"
              className="input"
              value={churchName}
              onChange={(e) => setChurchName(e.target.value)}
              placeholder="Grace Chapel"
              autoComplete="organization"
              disabled={busy}
            />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="account-email">Email</label>
        <input
          id="account-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@church.org"
          autoComplete="email"
          spellCheck={false}
          disabled={busy}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label className="label mb-0" htmlFor="account-password">Password</label>
          {mode === 'signIn' && (
            <button
              type="button"
              className="text-[12px] text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:text-slate-300 disabled:opacity-50"
              onClick={() => void resetPassword()}
              disabled={busy}
            >
              Forgot password
            </button>
          )}
        </div>
        <PasswordInput
          id="account-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          placeholder={mode === 'signUp' ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}
          autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          disabled={busy}
        />
      </div>

      <p className="min-h-[1rem] text-[12px]" aria-live="polite">
        {error && <span className="text-rose-400">{error}</span>}
        {notice && !error && <span className="text-teal-400">{notice}</span>}
      </p>

      <button
        type="button"
        className="btn-primary inline-flex items-center justify-center gap-2"
        onClick={() => void submit()}
        disabled={busy}
      >
        {busy && <Loader size={14} className="animate-spin" aria-hidden="true" />}
        {mode === 'signUp' ? 'Create account' : 'Sign in'}
      </button>

      <div className="flex flex-col gap-2.5 pt-0.5 text-[12px] leading-relaxed">
        <p className="text-slate-500">
          {mode === 'signUp' ? 'Already have an account?' : 'Don’t have an account?'}{' '}
          <button
            type="button"
            className="text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white disabled:opacity-50"
            onClick={() => {
              const next = mode === 'signUp' ? 'signIn' : 'signUp'
              setMode(next)
              onModeChange?.(next)
              setError(null)
              setNotice(null)
            }}
            disabled={busy}
          >
            {mode === 'signUp' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}

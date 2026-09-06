import { useState } from 'react'
import { PRODUCT_NAME } from '@shared/brand'
import { needsEmailConfirmation } from '@shared/cloud/auth-state'
import { KairoMark } from '@/components/brand/KairoMark'
import { useAccountStore } from '@/stores/useAccountStore'
import AuthPanel from './AuthPanel'
import DevicePairingPanel from './DevicePairingPanel'
import VerifyEmailNotice from './VerifyEmailNotice'

type Mode = 'auth' | 'pairing'

/**
 * Full-screen wall until the operator has a confirmed session.
 *
 * Sign-in (or pairing) first; a newly created account stays here for the
 * email code; only then do setup and the booth open.
 */
export default function AccountGate(): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [mode, setMode] = useState<Mode>('auth')
  const [signingOut, setSigningOut] = useState(false)
  const verifying = needsEmailConfirmation(session)

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    try {
      setSession(await window.api.account.signOut())
      setMode('auth')
    } finally {
      setSigningOut(false)
    }
  }

  const title = verifying
    ? 'Confirm your email'
    : mode === 'pairing'
      ? 'Pair this machine'
      : `Sign in to ${PRODUCT_NAME}`

  const blurb = verifying
    ? 'We sent a 6-digit code. Enter it here — no browser needed.'
    : mode === 'pairing'
      ? 'Approve this computer from a phone — no password typed here.'
      : `An account is required to use ${PRODUCT_NAME}. Sign in, or create one if you don’t have one yet.`

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-surface animate-fade-in">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[28%] h-56 w-56 -translate-x-1/2 rounded-full bg-[#F59E0B]/12 blur-3xl"
      />

      <div className="relative w-[24.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-surface-border/60 bg-surface-secondary/40 shadow-2xl animate-spring-in">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-[#F59E0B]/10 to-transparent"
        />

        <div className="relative px-7 pb-7 pt-8">
          <div className="mb-6 flex justify-center">
            <KairoMark size="md" glow />
          </div>

          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">{title}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{blurb}</p>

          <div className="mt-5">
            {verifying ? (
              <div className="flex flex-col gap-4">
                <VerifyEmailNotice />
                <button
                  type="button"
                  className="self-start text-[12px] text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:text-slate-300 disabled:opacity-50"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                >
                  {signingOut ? 'Signing out…' : 'Use a different email'}
                </button>
              </div>
            ) : mode === 'pairing' ? (
              <DevicePairingPanel onUsePassword={() => setMode('auth')} />
            ) : (
              <AuthPanel initialMode="signIn" onUsePairing={() => setMode('pairing')} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

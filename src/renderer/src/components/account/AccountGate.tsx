import { useState } from 'react'
import { PRODUCT_NAME } from '@shared/brand'
import { needsEmailConfirmation } from '@shared/cloud/auth-state'
import { KairoMark } from '@/components/brand/KairoMark'
import { useAccountStore } from '@/stores/useAccountStore'
import AuthPanel from './AuthPanel'
import VerifyEmailNotice from './VerifyEmailNotice'

/**
 * Full-screen wall until the operator has a confirmed session.
 *
 * Sign-in first; a newly created account stays here for the email code; only
 * then do setup and the booth open.
 */
export default function AccountGate(): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [signingOut, setSigningOut] = useState(false)
  const verifying = needsEmailConfirmation(session)

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    try {
      setSession(await window.api.account.signOut())
    } finally {
      setSigningOut(false)
    }
  }

  const title = verifying ? 'Confirm your email' : `Sign in to ${PRODUCT_NAME}`

  const blurb = verifying
    ? 'We sent a 6-digit code. Enter it here — no browser needed.'
    : `An account is required to use ${PRODUCT_NAME}. Sign in, or create one if you don’t have one yet.`

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-surface animate-fade-in">
      <div className="relative w-[24.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-surface-secondary shadow-2xl animate-spring-in">

        <div className="relative px-7 pb-7 pt-8">
          <div className="mb-6 flex justify-center">
            <KairoMark size="md" />
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
            ) : (
              <AuthPanel initialMode="signIn" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

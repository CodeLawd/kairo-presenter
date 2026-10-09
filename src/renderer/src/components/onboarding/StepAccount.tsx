import { useState, type CSSProperties } from 'react'
import { PRODUCT_NAME } from '@shared/brand'
import { needsEmailConfirmation } from '@shared/cloud/auth-state'
import AuthPanel, { type AuthMode } from '@/components/account/AuthPanel'
import VerifyEmailNotice from '@/components/account/VerifyEmailNotice'
import { useAccountStore } from '@/stores/useAccountStore'

const at = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties

/**
 * The account page of first-run setup, after the tour: create an account (the
 * default — this is a first launch), or sign in, then the emailed code. The
 * wizard moves on by itself once the session can enter the app.
 */
export default function StepAccount({ mode, onModeChange }: {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
}): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [signingOut, setSigningOut] = useState(false)
  const verifying = needsEmailConfirmation(session)

  const useDifferentEmail = async (): Promise<void> => {
    setSigningOut(true)
    try {
      setSession(await window.api.account.signOut())
      onModeChange('signUp')
    } finally {
      setSigningOut(false)
    }
  }

  const title = verifying ? 'Confirm your email' : mode === 'signUp' ? 'Create your account' : `Sign in to ${PRODUCT_NAME}`
  const blurb = verifying
    ? `Enter the 6-digit code we sent to ${session.user?.email ?? 'your email'}.`
    : mode === 'signUp'
      ? 'Your church’s songs, themes and settings follow you to every Kairo computer.'
      : 'Welcome back. Your church’s library comes with you.'

  return (
    <div className="onboarding-setup">
      <h2 id="onboarding-slide-title" key={title} className="onboarding-setup-title ob-in">{title}</h2>
      <p className="ob-rise mt-2 max-w-[44ch] text-center text-[14px] leading-relaxed text-slate-400" style={at(1)}>{blurb}</p>
      <div className="ob-in mt-8 w-full max-w-[380px]" style={at(2)}>
        {verifying ? (
          <div className="flex flex-col items-center gap-6">
            <VerifyEmailNotice showEmail={false} centered />
            <button
              type="button"
              className="onboarding-text-button"
              onClick={() => void useDifferentEmail()}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Use a different email'}
            </button>
          </div>
        ) : (
          <AuthPanel key={mode} initialMode={mode} onModeChange={onModeChange} />
        )}
      </div>
    </div>
  )
}

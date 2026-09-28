import { Check } from '@/icons'
import { needsEmailConfirmation } from '@shared/cloud/auth-state'
import AuthPanel from '@/components/account/AuthPanel'
import VerifyEmailNotice from '@/components/account/VerifyEmailNotice'
import { useAccountStore } from '@/stores/useAccountStore'
import StepShell from './StepShell'
import { useState } from 'react'

/**
 * The account step.
 *
 * Auth and email confirmation happen on the launch wall, so this screen is a
 * confirmation. Signing out here (wrong email) returns the operator to the
 * sign-in wall; Continue is disabled until they are signed in again.
 */
export default function StepAccount(): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [signingOut, setSigningOut] = useState(false)

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    try {
      setSession(await window.api.account.signOut())
    } finally {
      setSigningOut(false)
    }
  }

  if (session.state !== 'signed-out') {
    // Signed in but unconfirmed is its own state, not a signed-in screen with a
    // warning stapled to it. The step asks for the one thing still outstanding.
    if (needsEmailConfirmation(session)) {
      return (
        <StepShell
          title="Confirm your email"
          blurb={`We sent a 6-digit code. It confirms ${session.org?.name ?? 'your church'} and turns on syncing across your machines.`}
        >
          <VerifyEmailNotice />

          {/*
            The way out. Someone who mistyped their address is otherwise stuck
            on this screen forever: the code goes to an inbox they cannot read,
            and every route back to the sign-up form is behind the account they
            are trying to abandon.
          */}
          <button
            type="button"
            className="self-start text-[12px] text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline disabled:opacity-50"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Use a different email'}
          </button>
        </StepShell>
      )
    }

    return (
      <StepShell
        title="You are signed in"
        blurb="Your setup will follow this account to your other Kairo computers."
      >
        <p className="inline-flex items-center gap-2 text-[13px] text-teal-400">
          <Check size={14} aria-hidden="true" />
          {session.user?.email}
          {session.org && <span className="text-slate-500">· {session.org.name}</span>}
        </p>
      </StepShell>
    )
  }

  return (
    <StepShell
      title="Create an account"
      blurb="An account is required to use Kairo. It also shares your themes and settings across every machine in your church."
    >
      <AuthPanel initialMode="signUp" />
    </StepShell>
  )
}

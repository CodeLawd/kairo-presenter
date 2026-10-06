import { useState } from 'react'
import { Check, LogOut, RefreshCw } from '@/icons'
import { describeSessionState, needsEmailConfirmation } from '@shared/cloud/auth-state'
import { useAccountStore } from '@/stores/useAccountStore'
import AuthPanel from '@/components/account/AuthPanel'
import VerifyEmailNotice from '@/components/account/VerifyEmailNotice'

/**
 * Account and setup, in one place.
 *
 * "Run setup again" lives here rather than in the wizard because the wizard is
 * gone once it is answered — without a way back in, a mistake made during setup
 * could only be undone by editing the settings that setup exists to explain.
 */
export default function AccountSection({
  onRunSetup,
}: {
  onRunSetup: () => void
}): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [busy, setBusy] = useState(false)
  const status = describeSessionState(session)
  const signedIn = session.state !== 'signed-out'

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      setSession(await window.api.account.signOut())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {signedIn ? (
        <section className="space-y-1.5">
          <h3 className="px-0.5 text-[11px] font-semibold tracking-tight text-white/45">Account</h3>
          <div className="overflow-hidden rounded-md bg-[#2c2c2c]">
            <div className="flex min-h-[38px] items-center justify-between gap-4 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] leading-none text-white">{session.user?.email}</p>
                <p className="mt-1 text-[11px] text-white/40">{status.detail}</p>
              </div>
              <Check size={14} className="shrink-0 text-[#28C840]" aria-hidden="true" />
            </div>
            {session.org ? (
              <div className="flex min-h-[38px] items-center justify-between gap-4 px-3.5 py-2">
                <p className="text-[13px] text-white">Organization</p>
                <p className="text-[13px] text-white/55">{session.org.name}</p>
              </div>
            ) : null}
            {session.state === 'stale' ? (
              <p className="px-3.5 py-2.5 text-[12px] text-amber-400">
                Working offline — signed in, but Kairo cannot be reached right now. Nothing is
                interrupted.
              </p>
            ) : null}
            {needsEmailConfirmation(session) ? (
              <div className="px-3.5 py-3">
                <VerifyEmailNotice />
              </div>
            ) : null}
            <div className="flex justify-end px-3.5 py-2.5">
              <button
                type="button"
                className="btn-secondary inline-flex w-fit items-center gap-2"
                onClick={() => void signOut()}
                disabled={busy}
              >
                <LogOut size={14} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </section>
      ) : (
        <AuthPanel initialMode="signIn" />
      )}

      <section className="space-y-1.5">
        <h3 className="px-0.5 text-[11px] font-semibold tracking-tight text-white/45">Setup</h3>
        <div className="overflow-hidden rounded-md bg-[#2c2c2c] px-3.5 py-3">
          <p className="text-[13px] leading-relaxed text-white/45">
            Walk through ProPresenter, outputs, API keys and your church profile again. Nothing is
            reset — the wizard opens on what you already have.
          </p>
          <button
            type="button"
            className="btn-secondary mt-3 inline-flex items-center gap-2"
            onClick={onRunSetup}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Run setup again
          </button>
        </div>
      </section>
    </div>
  )
}

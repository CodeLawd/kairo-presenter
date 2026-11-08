import { useShallow } from "zustand/react/shallow";
import { useState } from 'react'
import { AlertTriangle, X } from '@/icons'
import { CREDENTIALS_NOT_SAVED_NOTICE } from '@/lib/credentials-notice'
import { useAccountStore } from '@/stores/useAccountStore'
import { useAppStore } from '@/stores/useAppStore'

/**
 * Says once, after sign-in, that this launch's sign-in won't be remembered.
 *
 * The Settings → Account row says the same, but nobody opens Settings to learn
 * why they were signed out. The app is only mounted past the sign-in wall, so
 * this appears once an account is in. It stays until dismissed — a missed notice
 * means a surprise sign-in next launch — and, like the update toast, waits out a
 * live session rather than cover the operator's view.
 */
export default function KeychainNotice(): React.ReactElement | null {
  const credentialsPersisted = useAccountStore((s) => s.session.credentialsPersisted)
  const signedIn = useAccountStore((s) => s.session.state !== 'signed-out')
  const { isTranscribing, liveOutputLabel } = useAppStore(useShallow((state) => ({ isTranscribing: state.isTranscribing, liveOutputLabel: state.liveOutputLabel })))
  const isLive = isTranscribing || Boolean(liveOutputLabel?.trim())
  const [dismissed, setDismissed] = useState(false)

  const needed = signedIn && credentialsPersisted === false
  if (!needed || dismissed || isLive) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-fade-in absolute bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg bg-surface-elevated px-3.5 py-3"
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-200">{CREDENTIALS_NOT_SAVED_NOTICE}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
        aria-label="Dismiss keychain notice"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

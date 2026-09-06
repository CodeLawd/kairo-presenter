import { useEffect } from 'react'
import { Loader } from '@/icons'
import { useAccountStore } from '@/stores/useAccountStore'

/**
 * Pairing by code, for a booth machine.
 *
 * The whole point is that no password is typed into a shared computer: the code
 * goes up on screen, someone approves it from their own phone, and this panel
 * waits. Cancelling stops the poll immediately — waiting is never a trap.
 */
export default function DevicePairingPanel({
  onDone,
  onUsePassword,
}: {
  onDone?: () => void
  onUsePassword?: () => void
}): React.ReactElement {
  const pairing = useAccountStore((s) => s.pairing)
  const setPairing = useAccountStore((s) => s.setPairing)

  useEffect(() => {
    let cancelled = false
    void window.api.account.startDevicePairing().then((state) => {
      if (!cancelled) setPairing(state)
    })
    return () => {
      cancelled = true
      // Leaving the panel must stop the polling, not orphan it in the background.
      void window.api.account.cancelDevicePairing()
    }
  }, [setPairing])

  useEffect(() => {
    if (pairing.status === 'approved') onDone?.()
  }, [pairing.status, onDone])

  const failed =
    pairing.status === 'denied' || pairing.status === 'expired' || pairing.status === 'error'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-slate-500">
        Open <span className="text-slate-300">{pairing.verificationUri ?? 'the Kairo site'}</span>{' '}
        on your phone and enter this code.
      </p>

      <div className="rounded-lg border border-surface-border bg-surface-secondary/60 px-6 py-5 text-center">
        <span className="font-mono text-[28px] tracking-[0.2em] text-white">
          {pairing.userCode ?? '· · · ·'}
        </span>
      </div>

      <p className="min-h-[1.25rem] text-[12px]" aria-live="polite">
        {pairing.status === 'waiting' && (
          <span className="inline-flex items-center gap-2 text-slate-400">
            <Loader size={13} className="animate-spin" aria-hidden="true" />
            Waiting for approval…
          </span>
        )}
        {pairing.status === 'approved' && <span className="text-teal-400">Approved. Signing in…</span>}
        {failed && <span className="text-rose-400">{pairing.message ?? 'That did not work.'}</span>}
      </p>

      <div className="flex items-center gap-4 text-[12px]">
        {failed && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              void window.api.account.startDevicePairing().then(setPairing)
            }
          >
            Get a new code
          </button>
        )}
        {onUsePassword && (
          <button
            type="button"
            className="text-[12px] text-slate-600 transition-colors hover:text-slate-400 focus-visible:outline-none focus-visible:text-slate-400"
            onClick={onUsePassword}
          >
            Use email and password
          </button>
        )}
      </div>
    </div>
  )
}

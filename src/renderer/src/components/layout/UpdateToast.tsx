import { useEffect, useRef, useState } from 'react'
import { Download, X } from '@/icons'
import { useUpdates } from '@/hooks/useUpdates'
import { useAppStore } from '@/stores/useAppStore'

/** Long enough to read mid-task, short enough not to sit over the booth UI. */
const DISMISS_MS = 12_000

/**
 * One-time nudge when an update finishes downloading.
 *
 * The header pill is deliberately quiet, so an operator heads-down in Operator
 * can miss that an update is ready. This says it once and goes away — the
 * update installs on the next quit either way, so nothing is lost by ignoring
 * it.
 *
 * Never appears while a session is live: covering the operator's view mid-
 * service to advertise a restart is exactly the wrong trade. It waits for the
 * session to end and shows then.
 */
export default function UpdateToast(): React.ReactElement | null {
  const { status, install } = useUpdates()
  const { isTranscribing, liveOutputLabel } = useAppStore()
  const isLive = isTranscribing || Boolean(liveOutputLabel?.trim())
  const [visible, setVisible] = useState(false)
  /** Keyed by version so a later update can still announce itself once. */
  const announced = useRef<string | null>(null)

  const version = status.state === 'downloaded' ? status.version : null

  useEffect(() => {
    if (!version || isLive || announced.current === version) return
    announced.current = version
    setVisible(true)
  }, [version, isLive])

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(false), DISMISS_MS)
    return () => clearTimeout(timer)
  }, [visible])

  // A restart the operator did not ask for is never acceptable, so the toast
  // retreats the moment a session starts.
  useEffect(() => {
    if (isLive) setVisible(false)
  }, [isLive])

  if (!visible || !version) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-fade-in absolute bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-surface-border bg-surface-elevated px-3.5 py-3 shadow-xl"
    >
      <Download size={15} className="mt-0.5 shrink-0 text-teal-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug text-white">Kairo {version} is ready</p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
          It installs the next time you quit — or restart now.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void install()}
            className="rounded border border-teal-800/60 px-2 py-1 text-[11px] font-semibold text-teal-300 transition-colors hover:border-teal-600 hover:bg-teal-950/40"
          >
            Restart now
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="rounded px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Later
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
        aria-label="Dismiss update notice"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

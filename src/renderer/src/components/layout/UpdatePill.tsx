import { useState } from 'react'
import { Download } from '@/icons'
import { useUpdates } from '@/hooks/useUpdates'
import { useAppStore } from '@/stores/useAppStore'

/**
 * Header affordance for a pending update — the whole flow without opening
 * Settings. Renders nothing at all unless there is something to act on, so the
 * booth header stays quiet on every ordinary Sunday.
 *
 * Installing quits the app, which during a live service would drop the output
 * mid-sentence. So the install click is always two-step, and while a session is
 * live the pill says so instead of pretending a restart is free. The update
 * also installs on the next quit by itself — nobody has to press this.
 */
export default function UpdatePill(): React.ReactElement | null {
  const { status, download, install } = useUpdates()
  const [confirming, setConfirming] = useState(false)
  const { isTranscribing, liveOutputLabel } = useAppStore()
  const isLive = isTranscribing || Boolean(liveOutputLabel?.trim())

  if (status.state === 'idle' || status.state === 'checking' || status.state === 'error') return null

  const base =
    'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1'

  if (status.state === 'downloading') {
    return (
      <div
        className={`${base} border-white/10 text-zinc-400`}
        role="status"
        aria-label={`Downloading update${typeof status.percent === 'number' ? `, ${status.percent} percent` : ''}`}
      >
        <Download size={13} aria-hidden="true" />
        {typeof status.percent === 'number' ? `${status.percent}%` : 'UPDATING'}
      </div>
    )
  }

  if (status.state === 'available') {
    return (
      <button
        type="button"
        onClick={() => void download()}
        className={`${base} border-teal-800/60 text-teal-300 hover:border-teal-600 hover:bg-teal-950/40 focus-visible:ring-teal-400`}
        title={`Kairo ${status.version} is available — download it now, install whenever you like`}
      >
        <Download size={13} aria-hidden="true" />
        UPDATE
      </button>
    )
  }

  // Downloaded — the only state that can interrupt a service.
  return (
    <button
      type="button"
      onClick={() => (confirming ? void install() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
      className={`${base} ${
        confirming
          ? 'border-amber-600 bg-amber-950/40 text-amber-200 focus-visible:ring-amber-400'
          : 'border-teal-800/60 text-teal-300 hover:border-teal-600 hover:bg-teal-950/40 focus-visible:ring-teal-400'
      }`}
      title={
        confirming
          ? 'Click again to quit and install now'
          : `Kairo ${status.version} is ready. It installs on the next quit — click to restart now.`
      }
    >
      <Download size={13} aria-hidden="true" />
      {confirming ? (isLive ? 'RESTART? SERVICE IS LIVE' : 'RESTART NOW?') : `UPDATE ${status.version}`}
    </button>
  )
}

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
    'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1'

  if (status.state === 'downloading') {
    return (
      <div
        className={`${base} text-zinc-500`}
        role="status"
        aria-label={`Downloading update${typeof status.percent === 'number' ? `, ${status.percent} percent` : ''}`}
      >
        <Download size={13} aria-hidden="true" />
        {typeof status.percent === 'number' ? `${status.percent}%` : 'Updating'}
      </div>
    )
  }

  if (status.state === 'available') {
    return (
      <button
        type="button"
        onClick={() => void download()}
        className={`${base} text-teal-400 hover:bg-tint-teal focus-visible:ring-teal-400`}
        title={`Kairo ${status.version} is available — download it now, install whenever you like`}
      >
        <Download size={13} aria-hidden="true" />
        Update
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
          ? 'bg-tint-amber text-amber-200 focus-visible:ring-amber-400'
          : 'text-teal-400 hover:bg-tint-teal focus-visible:ring-teal-400'
      }`}
      title={
        confirming
          ? 'Click again to quit and install now'
          : `Kairo ${status.version} is ready. It installs on the next quit — click to restart now.`
      }
    >
      <Download size={13} aria-hidden="true" />
      {confirming ? (isLive ? 'Restart? Service is live' : 'Restart now?') : `Update ${status.version}`}
    </button>
  )
}

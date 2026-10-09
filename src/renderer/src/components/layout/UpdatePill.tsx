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

  // The brand blue — the one header item that should catch the eye.
  const base =
    'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-live/50'
  const solid = 'bg-live text-white hover:bg-live/85'

  if (status.state === 'downloading') {
    return (
      <div
        className={`${base} bg-live/15 text-live`}
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
        className={`${base} ${solid}`}
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
      // Confirming keeps the blue but rings it, so the second click reads as a
      // deliberate step rather than the same button again.
      className={`${base} ${solid} ${confirming ? 'ring-2 ring-white/70' : ''}`}
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

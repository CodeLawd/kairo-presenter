import { Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward } from '@/icons'
import { useState } from 'react'
import { formatMediaClock } from '@shared/media-playback'
import { cn } from '@/lib/utils'

export const LIVE_VIDEO_SKIP_SECONDS = 5

export function LiveVideoControls({
  paused,
  ended,
  loop,
  currentTime,
  duration,
  onTogglePause,
  onSeek,
  onSkip,
  onRestart,
  onToggleLoop,
  showLoop = true,
}: {
  paused: boolean
  ended: boolean
  loop: boolean
  currentTime: number
  duration: number
  onTogglePause: () => void
  onSeek: (seconds: number) => void
  onSkip: (delta: number) => void
  onRestart: () => void
  onToggleLoop?: () => void
  showLoop?: boolean
}): React.ReactElement {
  const [scrub, setScrub] = useState<number | null>(null)
  const ready = duration > 0
  const shown = scrub ?? currentTime
  const playing = !paused && !ended

  return (
    <div
      className="bg-surface-secondary px-3 pb-2 pt-2"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return
        if (event.key === ' ' || event.key === 'k') {
          event.preventDefault()
          onTogglePause()
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onSkip(-LIVE_VIDEO_SKIP_SECONDS)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onSkip(LIVE_VIDEO_SKIP_SECONDS)
        } else if (event.key === 'Home') {
          event.preventDefault()
          onRestart()
        }
      }}
    >
      <input
        type="range"
        min={0}
        max={ready ? duration : 0}
        step={0.05}
        value={ready ? Math.min(shown, duration) : 0}
        disabled={!ready}
        aria-label="Seek"
        onChange={(event) => {
          const next = Number(event.target.value)
          setScrub(next)
          onSeek(next)
        }}
        onPointerUp={() => setScrub(null)}
        className="video-seek"
        style={{
          background: ready
            ? `linear-gradient(to right, rgb(var(--neutral-200)) 0%, rgb(var(--neutral-200)) ${(shown / duration) * 100}%, rgb(var(--range-track)) ${(shown / duration) * 100}%, rgb(var(--range-track)) 100%)`
            : 'rgb(var(--range-track))',
        }}
      />

      <div className="mt-2 flex items-center gap-1">
        <TransportButton label="Restart" onClick={onRestart}>
          <RotateCcw size={12} aria-hidden="true" />
        </TransportButton>
        <TransportButton
          label={`Skip back ${LIVE_VIDEO_SKIP_SECONDS} seconds`}
          onClick={() => onSkip(-LIVE_VIDEO_SKIP_SECONDS)}
        >
          <SkipBack size={12} aria-hidden="true" />
        </TransportButton>
        <TransportButton
          label={playing ? 'Pause' : 'Play'}
          onClick={onTogglePause}
          primary
        >
          {playing
            ? <Pause size={13} fill="currentColor" aria-hidden="true" />
            : <Play size={13} fill="currentColor" aria-hidden="true" />}
        </TransportButton>
        <TransportButton
          label={`Skip forward ${LIVE_VIDEO_SKIP_SECONDS} seconds`}
          onClick={() => onSkip(LIVE_VIDEO_SKIP_SECONDS)}
        >
          <SkipForward size={12} aria-hidden="true" />
        </TransportButton>

        <span className="ml-2 min-w-0 flex-1 font-mono text-[11px] tabular-nums text-zinc-400">
          {formatMediaClock(shown)}
          <span className="text-slate-600"> / </span>
          {ready ? formatMediaClock(duration) : '–:––'}
        </span>

        {showLoop && onToggleLoop && (
          <button
            type="button"
            onClick={onToggleLoop}
            title={loop ? 'Loop on' : 'Loop off'}
            aria-pressed={loop}
            aria-label={loop ? 'Turn loop off' : 'Turn loop on'}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-md transition-colors',
              loop
                ? 'bg-surface-elevated text-white'
                : 'text-zinc-500 hover:bg-surface-elevated hover:text-zinc-200',
            )}
          >
            <Repeat size={12} aria-hidden="true" />
          </button>
        )}
      </div>

    </div>
  )
}

function TransportButton({
  label,
  onClick,
  primary = false,
  children,
}: {
  label: string
  onClick: () => void
  primary?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-md transition-colors',
        primary
          ? 'text-white hover:bg-surface-elevated'
          : 'text-zinc-300 hover:bg-surface-elevated hover:text-white',
      )}
    >
      {children}
    </button>
  )
}

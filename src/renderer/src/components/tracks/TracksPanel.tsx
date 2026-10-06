import { FolderOpen, Pause, Play, Plus, X } from '@/icons'
import { useCallback, useState } from 'react'
import { formatMediaClock } from '@shared/media-playback'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'
import { cn } from '@/lib/utils'

export function TracksPanel(): React.ReactElement {
  const library = useTracksPlaybackStore((state) => state.library)
  const currentTime = useTracksPlaybackStore((state) => state.currentTime)
  const duration = useTracksPlaybackStore((state) => state.duration)
  const ended = useTracksPlaybackStore((state) => state.ended)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)

  const live = library.items.find((item) => item.id === library.liveId) ?? null
  const playing = !!live && !library.livePaused && !ended
  const shown = scrub ?? currentTime
  const ready = duration > 0

  const run = useCallback(async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const seek = (seconds: number): void => {
    const cap = duration > 0 ? duration : seconds
    useTracksPlaybackStore.getState().requestSeek(Math.min(cap, Math.max(0, seconds)))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 bg-surface-tertiary px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          House audio
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => window.api.tracks.importFiles())}
          className="flex items-center gap-1 text-[10px] font-semibold text-teal-400/90 hover:text-teal-300 disabled:opacity-50"
        >
          <Plus size={11} aria-hidden="true" />
          Add
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => window.api.tracks.chooseFolder())}
          className="grid size-5 place-items-center text-slate-500 hover:text-slate-200"
          title="Choose audio folder"
          aria-label="Choose audio folder"
        >
          <FolderOpen size={12} aria-hidden="true" />
        </button>
      </div>

      {(error || library.error) && (
        <p className="px-3 pb-1 text-[10px] leading-snug text-amber-300">{library.error ?? error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-transparent">
        {library.items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[10px] leading-relaxed text-zinc-600">
            Plays on this Mac, not through ProPresenter.
            Add walk-in tracks — they sit next to your Media folder.
          </p>
        ) : (
          <ul>
            {library.items.map((item) => {
              const active = item.id === library.liveId
              return (
                <li key={item.id}>
                  <div
                    className={cn(
                      'px-3 py-1.5',
                      active && 'bg-surface-elevated',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (active) {
                            void window.api.tracks.setPaused(!(library.livePaused || ended))
                            return
                          }
                          void window.api.tracks.play(item.id)
                        }}
                        title={active && playing ? 'Pause' : 'Play'}
                        aria-label={active && playing ? `Pause ${item.name}` : `Play ${item.name}`}
                        className={cn(
                          'grid size-6 shrink-0 place-items-center rounded-md transition-colors',
                          active
                            ? 'bg-tint-teal text-teal-200 hover:bg-tint-teal'
                            : 'text-slate-500 hover:bg-surface hover:text-slate-200',
                        )}
                      >
                        {active && playing
                          ? <Pause size={11} fill="currentColor" aria-hidden="true" />
                          : <Play size={11} fill="currentColor" aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!active) void window.api.tracks.play(item.id)
                        }}
                        className={cn(
                          'min-w-0 flex-1 truncate text-left text-[11px] font-medium',
                          active ? 'text-teal-200' : 'text-slate-300 hover:text-white',
                        )}
                      >
                        {item.name}
                      </button>
                      {active && (
                        <>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">
                            {formatMediaClock(shown)}
                            <span className="text-slate-600"> / </span>
                            {ready ? formatMediaClock(duration) : '–:––'}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setScrub(null)
                              void window.api.tracks.stop()
                            }}
                            title="Stop and clear"
                            aria-label={`Stop ${item.name}`}
                            className="grid size-5 shrink-0 place-items-center rounded text-slate-600 hover:bg-surface hover:text-slate-200"
                          >
                            <X size={11} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                    {active && (
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
                          seek(next)
                        }}
                        onPointerUp={() => setScrub(null)}
                        className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-teal-400 disabled:cursor-default [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-teal-400"
                        style={{
                          background: ready
                            ? `linear-gradient(to right, rgb(45 212 191) 0%, rgb(45 212 191) ${(shown / duration) * 100}%, rgb(63 63 70) ${(shown / duration) * 100}%, rgb(63 63 70) 100%)`
                            : 'rgb(63 63 70)',
                        }}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

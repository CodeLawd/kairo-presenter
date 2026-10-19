import { FolderOpen, Music2, Pause, Play, Plus, X } from '@/icons'
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

  const addTracks = (): void => void run(() => window.api.tracks.importFiles())

  // Grouped like the other operator panels: the title and its actions above
  // one rounded box of tracks.
  return (
    <div className="flex flex-col px-3 pt-3">
      <div className="flex min-h-7 shrink-0 items-center gap-1.5 px-1 pb-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">House audio</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => window.api.tracks.chooseFolder())}
          className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-50"
          title="Choose audio folder"
          aria-label="Choose audio folder"
        >
          <FolderOpen size={14} aria-hidden="true" />
        </button>
        {library.items.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={addTracks}
            className="btn-secondary flex items-center gap-1 px-2.5 py-1 text-[12px]"
          >
            <Plus size={12} aria-hidden="true" />
            Add
          </button>
        )}
      </div>

      {(error || library.error) && (
        <p className="px-1 pb-2 text-[11px] leading-snug text-red-400">{library.error ?? error}</p>
      )}

      <div className="pref-group pref-group-dim shrink-0 overflow-hidden rounded-lg bg-surface">
        {library.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <span className="grid size-9 place-items-center rounded-full bg-surface-tertiary text-zinc-400">
              <Music2 size={16} aria-hidden="true" />
            </span>
            <p className="text-[12px] font-medium text-zinc-300">No walk-in tracks yet</p>
            <p className="max-w-[16rem] text-[11px] leading-relaxed text-zinc-500">
              Music for before and after the service. It plays on this Mac, from a folder next to your Media.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={addTracks}
              className="btn-primary mt-1 flex items-center gap-1 px-3 py-1.5 text-[12px]"
            >
              <Plus size={12} aria-hidden="true" />
              Add tracks
            </button>
          </div>
        ) : (
          <ul className="pref-group">
            {library.items.map((item) => {
              const active = item.id === library.liveId
              return (
                <li key={item.id}>
                  <div
                    className={cn(
                      'px-3.5 py-2',
                      active && 'bg-surface-tertiary',
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
                            ? 'bg-teal-500 text-on-accent hover:bg-teal-600'
                            : 'text-slate-400 hover:bg-surface-tertiary hover:text-white',
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
                          'min-w-0 flex-1 truncate text-left text-[12px]',
                          active ? 'font-semibold text-white' : 'font-medium text-slate-300 hover:text-white',
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
                            className="grid size-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-surface-elevated hover:text-white"
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
                            ? `linear-gradient(to right, rgb(var(--control-accent)) 0%, rgb(var(--control-accent)) ${(shown / duration) * 100}%, rgb(var(--range-track)) ${(shown / duration) * 100}%, rgb(var(--range-track)) 100%)`
                            : 'rgb(var(--range-track))',
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

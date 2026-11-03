import { FolderOpen, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X } from '@/icons'
import { MusicNote01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useRef, useState } from 'react'
import { formatMediaClock } from '@shared/media-playback'
import type { TrackItem } from '@shared/ipc'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function TracksPanel(): React.ReactElement {
  const library = useTracksPlaybackStore((state) => state.library)
  const currentTime = useTracksPlaybackStore((state) => state.currentTime)
  const duration = useTracksPlaybackStore((state) => state.duration)
  const ended = useTracksPlaybackStore((state) => state.ended)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Escape clears the name being edited, then the blur handler must not save it.
  const cancelRename = useRef(false)

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

  const beginRename = (item: TrackItem): void => {
    cancelRename.current = false
    setRenamingId(item.id)
  }

  const commitRename = (item: TrackItem, name: string): void => {
    setRenamingId(null)
    if (cancelRename.current) {
      cancelRename.current = false
      return
    }
    const trimmed = name.trim()
    if (!trimmed || trimmed === item.name) return
    void run(() => window.api.tracks.rename(item.id, trimmed))
  }

  /** The folder is the library, so removing a track moves its file to the Trash. */
  const removeTrack = (item: TrackItem): void => {
    const ok = window.confirm(`Move “${item.name}” to the Trash?\n\nThe file leaves the audio folder, and you can restore it from the Trash.`)
    if (!ok) return
    void run(() => window.api.tracks.remove(item.id))
  }

  // Grouped like the other operator panels: the title and its actions above
  // one rounded box of tracks.
  return (
    <div className="flex flex-col px-3 pt-3">
      <div className="flex min-h-7 shrink-0 items-center gap-1.5 px-1 pb-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">House audio</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => window.api.tracks.rescan())}
          className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-50"
          title="Refresh the audio folder"
          aria-label="Refresh the audio folder"
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
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
              <HugeiconsIcon icon={MusicNote01Icon} />
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
          <ul className="space-y-0.5 p-1">
            {library.items.map((item) => {
              const active = item.id === library.liveId
              return (
                <li key={item.id}>
                  <div
                    className={cn(
                      'group rounded-md px-2.5 py-2 transition-colors',
                      active ? 'bg-surface-rail' : 'hover:bg-surface-rail/60',
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
                            : 'text-zinc-400 hover:bg-surface-tertiary hover:text-white',
                        )}
                      >
                        {active && playing
                          ? <Pause size={11} fill="currentColor" aria-hidden="true" />
                          : <Play size={11} fill="currentColor" aria-hidden="true" />}
                      </button>
                      {renamingId === item.id ? (
                        <input
                          autoFocus
                          defaultValue={item.name}
                          maxLength={120}
                          aria-label={`Rename ${item.name}`}
                          className="input min-w-0 flex-1 px-1.5 py-0.5 text-[12px]"
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={(event) => commitRename(item, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                            if (event.key === 'Escape') {
                              cancelRename.current = true
                              event.currentTarget.blur()
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (!active) void window.api.tracks.play(item.id)
                          }}
                          className={cn(
                            'min-w-0 flex-1 truncate text-left text-[12px]',
                            active ? 'font-semibold text-white' : 'font-medium text-zinc-200 hover:text-white',
                          )}
                        >
                          {item.name}
                        </button>
                      )}
                      {active && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setScrub(null)
                              void window.api.tracks.stop()
                            }}
                            title="Stop and clear"
                            aria-label={`Stop ${item.name}`}
                            className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-surface-tertiary hover:text-white"
                          >
                            <X size={11} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Options for ${item.name}`}
                            title="More"
                            className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-surface-tertiary hover:text-white disabled:opacity-40"
                          >
                            <MoreHorizontal size={14} aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => beginRename(item)}>
                            <Pencil size={13} aria-hidden="true" /> Rename…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void run(() => window.api.tracks.reveal(item.id))}>
                            <FolderOpen size={13} aria-hidden="true" /> Show in folder
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => removeTrack(item)}>
                            <Trash2 size={13} aria-hidden="true" /> Move to Trash…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {active && (
                      // Elapsed and total flank the bar, so the top row stays just the name and actions.
                      <div className="mt-2 flex items-center gap-2 pl-8">
                        <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-zinc-400">
                          {formatMediaClock(shown)}
                        </span>
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
                          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full disabled:cursor-default [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_rgb(var(--control-accent))]"
                          style={{
                            background: ready
                              ? `linear-gradient(to right, rgb(var(--control-accent)) 0%, rgb(var(--control-accent)) ${(shown / duration) * 100}%, rgb(var(--range-track)) ${(shown / duration) * 100}%, rgb(var(--range-track)) 100%)`
                              : 'rgb(var(--range-track))',
                          }}
                        />
                        <span className="w-8 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                          {ready ? formatMediaClock(duration) : '–:––'}
                        </span>
                      </div>
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

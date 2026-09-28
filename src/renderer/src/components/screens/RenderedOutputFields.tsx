import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSettings } from '@/hooks/useSettings'
import type { MediaPlaylist, OverlayOutput } from '@shared/ipc'
import {
  DEFAULT_PRESENTATION_SETTINGS,
  OUTPUT_SHOW_KEYS,
  outputShowLabel,
} from '@shared/program'

// ─── Inspector fields for outputs Kairo renders itself (screen / ndi) ─────────
// Self-contained so the Screens window only has to place them.

type Patch = (patch: Partial<OverlayOutput>) => void

function useMediaPlaylists(): MediaPlaylist[] {
  const [playlists, setPlaylists] = useState<MediaPlaylist[]>([])
  useEffect(() => {
    let cancelled = false
    window.api.media
      .getLibrary()
      .then((library) => {
        if (!cancelled) setPlaylists(library.playlists)
      })
      .catch(() => undefined)
    const unsubscribe = window.api.media.onLibraryChange((library) => setPlaylists(library.playlists))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return playlists
}

/**
 * What a screen shows: the service (every push lands here) or its own media
 * playlist — a lobby or foyer display that ignores pushes and Clear.
 */
export function ScreenSourceFields({ output, onChange }: { output: OverlayOutput; onChange: Patch }): React.ReactElement {
  const playlists = useMediaPlaylists()
  const lobby = output.source === 'playlist'
  const missing = lobby && output.playlistId !== '' && !playlists.some((p) => p.id === output.playlistId)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px border border-surface-border bg-surface-border" role="radiogroup" aria-label="Source">
        {([
          ['program', 'The service'],
          ['playlist', 'Its own playlist'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={output.source === value}
            onClick={() => onChange({ source: value })}
            className={cn(
              'py-1.5 text-[11px] font-medium transition-colors',
              output.source === value ? 'bg-teal-600 text-white' : 'bg-surface-secondary text-slate-400 hover:text-slate-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {lobby ? (
        <>
          <div className="space-y-1.5">
            <label htmlFor={`${output.id}-playlist`} className="block text-[11px] font-medium text-slate-400">Playlist</label>
            <select
              id={`${output.id}-playlist`}
              className="input w-full"
              value={missing ? 'missing' : output.playlistId}
              onChange={(e) => onChange({ playlistId: e.target.value })}
            >
              <option value="">— choose a media playlist —</option>
              {missing && <option value="missing" disabled>Deleted playlist</option>}
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.itemIds.length})</option>
              ))}
            </select>
            {playlists.length === 0 && (
              <p className="text-[10px] leading-snug text-slate-500">Make a playlist in the Media dock first.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${output.id}-slide-sec`} className="block text-[11px] font-medium text-slate-400">
              Each image stays up for
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`${output.id}-slide-sec`}
                type="number"
                min={3}
                max={600}
                className="input w-20"
                value={output.slideSec}
                onChange={(e) => onChange({ slideSec: Math.max(3, Math.min(600, Number(e.target.value) || 8)) })}
              />
              <span className="text-[11px] text-slate-500">seconds · videos play to their end</span>
            </div>
          </div>
          <p className="text-[10px] leading-snug text-slate-500">
            Scripture, lyrics, documents, backgrounds and Clear never reach this screen. Messages, the
            logo and props still do unless turned off below.
          </p>
        </>
      ) : (
        <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-400">
          <input
            type="checkbox"
            className="mt-0.5 accent-teal-500"
            checked={output.aspect === 'fill'}
            onChange={(e) => onChange({ aspect: e.target.checked ? 'fill' : 'letterbox' })}
          />
          Fill the display’s shape — no black bars on 4:3 or ultrawide. The Theme preview stays 16:9.
        </label>
      )}
    </div>
  )
}

/** Which kinds of content this output shows. */
export function ShowFilterFields({ output, onChange }: { output: OverlayOutput; onChange: Patch }): React.ReactElement {
  // A lobby only ever shows its playlist plus the program layers.
  const keys = output.source === 'playlist'
    ? OUTPUT_SHOW_KEYS.filter((k) => k === 'messages' || k === 'overlays')
    : OUTPUT_SHOW_KEYS
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key) => {
        const on = output.show[key]
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ show: { ...output.show, [key]: !on } })}
            className={cn(
              'border px-2 py-0.5 text-[10px] transition-colors',
              on ? 'border-teal-600 bg-tint-teal text-teal-300' : 'border-surface-border bg-surface-secondary text-slate-500 line-through',
            )}
          >
            {outputShowLabel(key)}
          </button>
        )
      })}
    </div>
  )
}

/** Program sound over NDI — one setting for every NDI feed. */
export function NdiSoundField(): React.ReactElement {
  const [presentation, setPresentation] = useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.program
      .ndiAudioSupported()
      .then((value) => {
        if (!cancelled) setSupported(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-400">
        <input
          type="checkbox"
          className="mt-0.5 accent-teal-500"
          disabled={supported === false}
          checked={presentation.audio.ndi && supported !== false}
          onChange={(e) =>
            void setPresentation({ ...presentation, audio: { ...presentation.audio, ndi: e.target.checked } })
          }
        />
        Send program sound with every NDI feed — background videos and the camera’s audio input.
      </label>
      {supported === false && (
        <p className="text-[10px] leading-snug text-amber-400">
          This machine’s NDI library can only send video. Sound needs the NDI 6 runtime Kairo ships for
          your platform.
        </p>
      )}
    </div>
  )
}

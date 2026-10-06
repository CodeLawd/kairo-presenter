import { useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { useSettings } from '@/hooks/useSettings'
import type { MediaPlaylist, OverlayOutput } from '@shared/ipc'
import {
  DEFAULT_PRESENTATION_SETTINGS,
  PLAYLIST_SHOW_KEYS,
  outputShowLabel,
  type OutputShowFilter,
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
    <>
      <FieldRow label="Content" htmlFor={`${output.id}-source`}>
        <select
          id={`${output.id}-source`}
          className="input w-full"
          value={output.source}
          onChange={(e) => onChange({ source: e.target.value as OverlayOutput['source'] })}
        >
          <option value="program">Follows the service</option>
          <option value="playlist">Plays its own playlist</option>
        </select>
      </FieldRow>

      {lobby ? (
        <>
          <FieldRow
            label="Playlist"
            htmlFor={`${output.id}-playlist`}
            hint={playlists.length === 0 ? 'Make a playlist in the Media dock first.' : undefined}
          >
            <select
              id={`${output.id}-playlist`}
              className="input w-full"
              value={missing ? 'missing' : output.playlistId}
              onChange={(e) => onChange({ playlistId: e.target.value })}
            >
              <option value="">Choose a playlist</option>
              {missing && <option value="missing" disabled>Deleted playlist</option>}
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.itemIds.length})</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Image length" htmlFor={`${output.id}-slide-sec`} hint="Videos play to their end.">
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
              <span className="text-[12px] text-slate-500">seconds</span>
            </div>
          </FieldRow>
        </>
      ) : (
        <FieldRow label="Fit" htmlFor={`${output.id}-fit`}>
          <select
            id={`${output.id}-fit`}
            className="input w-full"
            value={output.aspect}
            onChange={(e) => onChange({ aspect: e.target.value as OverlayOutput['aspect'] })}
          >
            <option value="letterbox">16:9 with black bars</option>
            <option value="fill">Fill the display</option>
          </select>
        </FieldRow>
      )}
    </>
  )
}

/** Label on the left, control on the right — one line per setting, like ProPresenter. */
export function FieldRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-x-4">
      <label htmlFor={htmlFor} className="pt-2 text-[12px] text-slate-400">{label}</label>
      <div className="space-y-1">
        {children}
        {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
      </div>
    </div>
  )
}

/** Layers grouped the way the Looks grid reads, top to bottom. */
export const LOOK_GROUPS: Array<{ title: string; keys: Array<keyof OutputShowFilter> }> = [
  { title: 'Slides', keys: ['scripture', 'lyrics', 'documents'] },
  { title: 'Media', keys: ['backgrounds'] },
  { title: 'Layers', keys: ['messages', 'overlays'] },
  { title: 'Confidence', keys: ['countdown', 'clock', 'stageMessage'] },
]

/** Whether `key` can be turned on for this output at all. */
export function lookKeyApplies(output: OverlayOutput, key: keyof OutputShowFilter): boolean {
  return output.source !== 'playlist' || PLAYLIST_SHOW_KEYS.includes(key)
}

/** One output's layers as a checklist — the column of the Looks grid for that output. */
export function LookFields({ output, onChange }: { output: OverlayOutput; onChange: Patch }): React.ReactElement {
  return (
    <div className="space-y-4">
      {LOOK_GROUPS.map((group) => {
        const keys = group.keys.filter((key) => lookKeyApplies(output, key))
        if (keys.length === 0) return null
        return (
          <div key={group.title} className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{group.title}</p>
            {keys.map((key) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-[12px] text-slate-300 hover:bg-surface-tertiary"
              >
                {outputShowLabel(key)}
                <input
                  type="checkbox"
                  className="accent-teal-500"
                  checked={output.show[key]}
                  onChange={(e) => onChange({ show: { ...output.show, [key]: e.target.checked } })}
                />
              </label>
            ))}
            {group.title === 'Confidence' && keys.some((key) => output.show[key]) && (
              <ConfidenceLayoutFields output={output} onChange={onChange} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Where the countdown, clock and stage message sit on this screen, and how big. */
function ConfidenceLayoutFields({ output, onChange }: { output: OverlayOutput; onChange: Patch }): React.ReactElement {
  const layout = output.confidence
  return (
    <div className="space-y-2 px-2 pt-2">
      <Segmented
        label="Position"
        value={layout.position}
        options={[
          ['top', 'Top'],
          ['bottom', 'Bottom'],
        ]}
        onChange={(position) => onChange({ confidence: { ...layout, position } })}
      />
      <Segmented
        label="Size"
        value={layout.size}
        options={[
          ['small', 'Small'],
          ['medium', 'Medium'],
          ['large', 'Large'],
        ]}
        onChange={(size) => onChange({ confidence: { ...layout, size } })}
      />
    </div>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-slate-300">{label}</span>
      <SegmentedControl
        label={label}
        value={value}
        options={options.map(([v, text]) => ({ value: v, label: text }))}
        onChange={onChange}
        className="w-56 bg-surface-secondary"
      />
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
        <p className="text-[11px] leading-snug text-slate-500">
          This machine’s NDI library can only send video. Sound needs the NDI 6 runtime Kairo ships for
          your platform.
        </p>
      )}
    </div>
  )
}

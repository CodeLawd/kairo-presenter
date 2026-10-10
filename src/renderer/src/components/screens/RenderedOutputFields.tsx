import { useEffect, useRef, useState } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { useSettings } from '@/hooks/useSettings'
import type { MediaPlaylist, OverlayOutput } from '@shared/ipc'
import { aspectRatioOf, OUTPUT_ASPECTS } from '@shared/displays'
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
        <FitField output={output} onChange={onChange} />
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

/**
 * The shape an output draws in, with a test pattern on the real display so the
 * operator sees the result — shown on each change and on demand.
 */
function FitField({
  output,
  onChange,
}: {
  output: OverlayOutput
  onChange: (patch: Partial<OverlayOutput>) => void
}): React.ReactElement {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const preview = (next: Pick<OverlayOutput, 'aspect' | 'customAspect'>, delayMs = 0): void => {
    if (output.displayId == null) return
    if (timer.current) clearTimeout(timer.current)
    const displayId = output.displayId
    // Debounced: typing a custom ratio must not open a window per keystroke.
    timer.current = setTimeout(() => {
      void window.api.displays.testPattern({ displayId, name: output.name, ...next })
    }, delayMs)
  }
  const change = (patch: Pick<OverlayOutput, 'aspect' | 'customAspect'>, delayMs = 0): void => {
    onChange(patch)
    preview(patch, delayMs)
  }

  return (
    <FieldRow label="Fit" htmlFor={`${output.id}-fit`} hint={fitHint(output)}>
      <div className="flex gap-2">
        <select
          id={`${output.id}-fit`}
          className="input min-w-0 flex-1"
          value={output.aspect}
          onChange={(e) => change({ aspect: e.target.value as OverlayOutput['aspect'], customAspect: output.customAspect })}
        >
          {OUTPUT_ASPECTS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary shrink-0 px-3 text-[12px]"
          disabled={output.displayId == null}
          onClick={() => preview({ aspect: output.aspect, customAspect: output.customAspect })}
          title={output.displayId == null ? 'Choose a display first' : 'Show a test pattern on this display for a few seconds'}
        >
          Test pattern
        </button>
      </div>
      {output.aspect === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={100}
            aria-label="Ratio width"
            className="input w-20"
            value={output.customAspect.width}
            onChange={(e) => change({ aspect: 'custom', customAspect: { ...output.customAspect, width: clampRatio(e.target.value) } }, 500)}
          />
          <span className="text-[12px] text-slate-500">:</span>
          <input
            type="number"
            min={1}
            max={100}
            aria-label="Ratio height"
            className="input w-20"
            value={output.customAspect.height}
            onChange={(e) => change({ aspect: 'custom', customAspect: { ...output.customAspect, height: clampRatio(e.target.value) } }, 500)}
          />
          <span className="text-[12px] text-slate-500">width : height</span>
        </div>
      )}
    </FieldRow>
  )
}

function clampRatio(value: string): number {
  return Math.max(1, Math.min(100, Math.round(Number(value) || 1)))
}

/** What the chosen shape will look like on the display it is bound to. */
function fitHint(output: OverlayOutput): string | undefined {
  const display = output.displaySize
  if (!display || display.width <= 0 || display.height <= 0) {
    return output.aspect === 'fill' ? 'Takes the shape of the display once one is chosen.' : undefined
  }
  const screen = display.width / display.height
  const frame = aspectRatioOf(output.aspect, output.customAspect, display) ?? screen
  const shape = describeRatio(screen)
  if (Math.abs(frame - screen) / screen < 0.02) return `Fills the display (${shape}) edge to edge.`
  return frame < screen
    ? `Your display is ${shape} — black bars at the sides.`
    : `Your display is ${shape} — black bars above and below.`
}

/** 1.777… → "16:9", 1.6 → "16:10"; anything unusual as "2.4:1". */
function describeRatio(ratio: number): string {
  const known: Array<[number, string]> = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [21 / 9, '21:9'], [32 / 9, '32:9'], [9 / 16, '9:16'], [1, '1:1'], [64 / 27, '21:9']]
  const match = known.find(([value]) => Math.abs(value - ratio) / ratio < 0.02)
  return match ? match[1] : `${ratio.toFixed(2).replace(/\.?0+$/, '')}:1`
}

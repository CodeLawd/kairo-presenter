import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronRight, RefreshCw } from '@/icons'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import type { OverlayOutput } from '@shared/ipc'
import type { VideoDeviceSnapshot, VideoMode, VideoTestPattern } from '@shared/video-devices'
import { FieldRow } from './RenderedOutputFields'

type PatternChoice = VideoTestPattern | 'off'

const PATTERNS: ReadonlyArray<{ value: PatternChoice; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'bars', label: 'Color bars' },
  { value: 'text', label: 'Fine text' },
  { value: 'motion', label: 'Motion' },
]

const fpsOf = (mode: VideoMode): number => mode.frameRateN / mode.frameRateD
const formatFps = (fps: number): string => fps.toFixed(2).replace(/\.?0+$/, '')


/**
 * The Hardware tab of a video card output, laid out like ProPresenter's: what
 * the connector is sending first, then where it goes and in what format, then
 * the tools for checking the signal.
 */
export function VideoDeviceFields({ output, snapshot, onChange, onRefresh, source }: {
  output: OverlayOutput
  snapshot: VideoDeviceSnapshot
  onChange: (patch: Partial<OverlayOutput>) => void
  onRefresh?: () => void
  /** The Content field (follows the service / own playlist), placed after the format. */
  source?: React.ReactNode
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const port = snapshot.ports.find((candidate) => candidate.id === output.devicePortId)
  const available = snapshot.providers.some((provider) => provider.available)
  const state = snapshot.outputs[output.id]
  const mode = port?.modes.find((candidate) => candidate.id === output.deviceModeId)

  const setPattern = async (choice: PatternChoice): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if (!await window.api.videoDevices.setTestPattern(output.id, choice === 'off' ? null : choice)) {
        setError('The output is unavailable. Check its connection and try again.')
      }
    } catch {
      setError('Could not change the test pattern. Try again.')
    } finally { setBusy(false) }
  }

  if (!available) return (
    <p className="text-[12px] text-slate-400" role="status">
      {snapshot.providers.length === 0
        ? 'This version of Kairo cannot drive video cards yet'
        : snapshot.providers.find((provider) => provider.reason)?.reason ??
          'Install Blackmagic Desktop Video to use DeckLink cards'}
    </p>
  )

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <FieldRow label="Output" htmlFor={`${output.id}-port`}>
          <div className="flex gap-2">
            <select id={`${output.id}-port`} className="input min-w-0 flex-1" value={output.devicePortId}
              onChange={(event) => {
                const chosen = snapshot.ports.find((candidate) => candidate.id === event.target.value)
                onChange({ devicePortId: chosen?.id ?? '',
                  devicePortLabel: chosen ? `${chosen.deviceName} · ${chosen.portName}` : '',
                  deviceModeId: chosen?.modes[0]?.id ?? '', deviceKeyFill: false })
              }}>
              <option value="">Choose an output</option>
              {snapshot.ports.map((candidate) => (
                <option key={candidate.id} value={candidate.id} disabled={!!candidate.unavailableReason}>
                  {candidate.portName}{candidate.unavailableReason ? ` — ${candidate.unavailableReason}` : ''}
                </option>
              ))}
              {output.devicePortId && !port &&
                <option value={output.devicePortId}>{output.devicePortLabel || 'Saved output'} — disconnected</option>}
            </select>
            {onRefresh && (
              <button type="button" onClick={onRefresh} title="Look for video cards again" aria-label="Look for video cards again"
                className="grid w-[38px] shrink-0 place-items-center rounded-md bg-surface-tertiary text-slate-400 hover:bg-surface-elevated hover:text-slate-200">
                <RefreshCw size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </FieldRow>
        {port ? (
          <FieldRow label="Mode" htmlFor={`${output.id}-mode`}>
            <select id={`${output.id}-mode`} className="input w-full" value={output.deviceModeId}
              onChange={(event) => onChange({ deviceModeId: event.target.value })}>
              <option value="">Choose a mode</option>
              {port.modes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              {output.deviceModeId && !port.modes.some((candidate) => candidate.id === output.deviceModeId) &&
                <option value={output.deviceModeId}>Saved mode — unavailable</option>}
            </select>
          </FieldRow>
        ) : <div />}
        {source}
        <FieldRow label="Test pattern">
          <fieldset disabled={busy || !state?.ready} className="disabled:opacity-40">
            <SegmentedControl label="Test pattern" value={state?.testPattern ?? 'off'} options={PATTERNS}
              onChange={(choice) => void setPattern(choice)} className="bg-surface-tertiary" />
          </fieldset>
        </FieldRow>
      </div>

      {port?.supportsKeyFill && (
        <label className="flex items-center gap-2 text-[13px] text-slate-200">
          <input type="checkbox" className="accent-teal-500" checked={output.deviceKeyFill}
            onChange={(event) => onChange({ deviceKeyFill: event.target.checked })} />
          Key/fill
        </label>
      )}

      {/* Only a problem earns a line; a healthy output says nothing. */}
      {!state?.ready && (
        <p role="status" className="text-[13px] text-amber-400">
          {state?.reason || (snapshot.ports.length ? 'Choose an output' : 'No video cards detected')}
        </p>
      )}
      {error && <p role="alert" className="text-[13px] text-red-400">{error}</p>}

      <SignalDetails output={output} snapshot={snapshot} mode={mode} />
    </div>
  )
}

/**
 * The connector on the canvas band, like ProPresenter's display box: its name
 * at the top, outlined in blue while it is sending.
 */
export function VideoConnectorTile({ output, snapshot }: { output: OverlayOutput; snapshot: VideoDeviceSnapshot }): React.ReactElement {
  const port = snapshot.ports.find((candidate) => candidate.id === output.devicePortId)
  const sending = !!snapshot.outputs[output.id]?.ready && output.enabled
  return (
    <div className="flex h-40 items-center justify-center">
      <div className={cn(
        'flex aspect-video h-full flex-col items-center rounded-md bg-surface-elevated pt-3',
        sending ? 'outline outline-2 outline-live' : 'outline outline-1 outline-surface-border',
      )}>
        <p className="truncate px-3 text-[13px] text-slate-200">{port?.portName ?? (output.devicePortLabel || 'No output chosen')}</p>
      </div>
    </div>
  )
}

/** Frame counters, folded away: one line says whether the signal is healthy. */
function SignalDetails({ output, snapshot, mode }: {
  output: OverlayOutput
  snapshot: VideoDeviceSnapshot
  mode: VideoMode | undefined
}): React.ReactElement {
  const diagnostics = snapshot.outputs[output.id]?.diagnostics
  const hardware = diagnostics?.hardware
  const missed = hardware ? hardware.late + hardware.dropped : 0
  const fps = mode ? fpsOf(mode) : 0
  const summary = !hardware
    ? 'Waiting for the card'
    : missed > 0
      ? `${hardware.late} late · ${hardware.dropped} dropped`
      : `Smooth · ${hardware.outputFps.toFixed(1)} fps`
  const rows: Array<[string, string]> = [
    ['Rendered', diagnostics ? `${diagnostics.captureFps.toFixed(1)} fps` : '—'],
    ['Sent to card', hardware ? `${hardware.outputFps.toFixed(1)} fps` : '—'],
    ['Target', mode ? `${formatFps(fps)} fps${mode.interlaced ? ` · ${formatFps(fps * 2)} fields/s` : ''}` : '—'],
    ['Late', hardware ? String(hardware.late) : '—'],
    ['Dropped', hardware ? String(hardware.dropped) : '—'],
    ['Repeated', hardware ? String(hardware.repeated) : '—'],
  ]
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1 text-[13px] text-slate-300">
          <ChevronRight size={12} aria-hidden="true" className="transition-transform group-open:rotate-90" />
          Signal
        </span>
        <span className={cn('text-[12px]', missed > 0 ? 'text-amber-400' : 'text-slate-300')}>{summary}</span>
      </summary>
      <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 rounded-md bg-surface p-3 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="tabular-nums text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

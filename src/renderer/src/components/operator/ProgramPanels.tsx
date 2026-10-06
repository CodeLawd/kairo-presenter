import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Switch } from '@/components/ui/switch'
import { Image, Layers, Pause, Play, Plus, RotateCcw, Send, Trash2, Video, Volume2, X } from '@/icons'
import { cn } from '@/lib/utils'
import { useNow, usePresentation, useProgramState } from '@/hooks/useProgramState'
import {
  formatClock,
  timerReadout,
  timerRunning,
  type PresentationSettings,
  type ProgramProp,
  type ProgramTimerState,
  type ProgramTimerStyle,
  type PropPosition,
} from '@shared/program'

// ─── Booth toolbox panels for the program layers (standalone phases 2–3) ──────
// Everything here acts on Kairo's own screens and NDI feeds, not ProPresenter.

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="space-y-2.5 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function report(err: unknown): void {
  console.error(err)
  window.alert((err as Error).message ?? String(err))
}

// ─── Timers ───────────────────────────────────────────────────────────────────

const PRESET_MINUTES = [1, 3, 5, 10, 15, 30]

/**
 * Presentation settings with writes coalesced: the panel follows every change
 * at once, but a slider or colour drag reaches settings (a disk write and a
 * reconcile of every screen in main) once it settles, not on every step.
 */
function useDraftPresentation(): [PresentationSettings, (next: PresentationSettings) => void] {
  const [stored, save] = usePresentation()
  const [draft, setDraft] = useState<PresentationSettings | null>(null)
  const pending = useRef<PresentationSettings | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    // Drop the draft once saved, unless a newer change is already waiting.
    if (next) void save(next).then(() => !pending.current && setDraft(null), report)
  }, [save])
  useEffect(() => flush, [flush])
  const update = useCallback(
    (next: PresentationSettings) => {
      pending.current = next
      setDraft(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 250)
    },
    [flush],
  )
  return [draft ?? stored, update]
}

/** Screens whose Look allows the layer show it only while this is on. */
function OnScreensToggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} on screens`}
      onClick={() => onChange(!on)}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        on ? 'bg-slate-200 text-surface' : 'bg-surface-tertiary text-zinc-300 hover:bg-surface-elevated hover:text-white',
      )}
    >
      {on ? 'On screens' : 'Show'}
    </button>
  )
}

type TimePart = 'h' | 'm' | 's'
const TIME_PARTS: Array<{ part: TimePart; label: string; max: number }> = [
  { part: 'h', label: 'Hours', max: 99 },
  { part: 'm', label: 'Minutes', max: 59 },
  { part: 's', label: 'Seconds', max: 59 },
]

function splitTime(totalSec: number): Record<TimePart, string> {
  const t = Math.abs(Math.trunc(totalSec))
  return {
    h: String(Math.floor(t / 3600)),
    m: String(Math.floor((t % 3600) / 60)).padStart(2, '0'),
    s: String(t % 60).padStart(2, '0'),
  }
}

/** The countdown readout, H:MM:SS. Click any part to type over it; the colons stay put. */
function CountdownReadout({ timer, style }: { timer: ProgramTimerState; style: ProgramTimerStyle }): React.ReactElement {
  const running = timerRunning(timer)
  const now = useNow(250, running)
  const { seconds: remaining, timeUp } = timerReadout(timer, now, style.rollover)
  const [draft, setDraft] = useState<(Record<TimePart, string> & { focus: TimePart }) | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const commit = (): void => {
    if (!draft) return
    const seconds = (Number(draft.h) || 0) * 3600 + (Number(draft.m) || 0) * 60 + (Number(draft.s) || 0)
    setDraft(null)
    if (seconds > 0) void window.api.program.timer.set(seconds).catch(report)
  }

  // Same time-up colour as the screens, so the booth reads what the room sees.
  const color = timeUp ? '' : running ? 'text-white' : 'text-zinc-200'
  const colorStyle = timeUp ? { color: style.overrunColor } : undefined
  const digits = 'bg-transparent font-mono text-4xl font-semibold tabular-nums outline-none'
  const colon = <span className={cn(digits, color, 'select-none')} style={colorStyle}>:</span>

  if (draft) {
    return (
      <div
        ref={boxRef}
        className="flex items-center justify-center py-0.5"
        onBlur={(e) => {
          if (!boxRef.current?.contains(e.relatedTarget as Node | null)) commit()
        }}
      >
        {TIME_PARTS.map(({ part, label, max }, index) => (
          <Fragment key={part}>
            {index > 0 && colon}
            <input
              autoFocus={draft.focus === part}
              inputMode="numeric"
              aria-label={label}
              value={draft[part]}
              maxLength={2}
              className={cn(digits, color, 'rounded-md px-0.5 text-center focus:bg-surface-tertiary')}
              // Exactly as wide as its digits (plus the same padding as the readout), so editing never shifts the layout.
              style={{ ...colorStyle, width: `calc(${Math.max(1, draft[part].length)}ch + 0.25rem)` }}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '')
                setDraft({ ...draft, [part]: Number(value) > max ? String(max) : value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setDraft(null)
                // The colon jumps to the next part, like a time field.
                if (e.key === ':') {
                  e.preventDefault()
                  boxRef.current?.querySelectorAll('input')[index + 1]?.focus()
                }
              }}
            />
          </Fragment>
        ))}
      </div>
    )
  }

  const parts = splitTime(remaining)
  return (
    <div className={cn('flex items-center justify-center py-0.5', digits, color)} style={colorStyle} aria-live="off">
      {remaining < 0 && <span className="select-none">-</span>}
      {TIME_PARTS.map(({ part, label }, index) => (
        <Fragment key={part}>
          {index > 0 && <span className="select-none">:</span>}
          <button
            type="button"
            title={`Change ${label.toLowerCase()}`}
            className="cursor-text rounded-md px-0.5 hover:bg-surface-tertiary"
            onClick={() => setDraft({ ...splitTime(Math.max(0, remaining)), focus: part })}
          >
            {parts[part]}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

/** The shared switch in the panel's neutral look: light grey when on. */
function MiniSwitch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }): React.ReactElement {
  return (
    <Switch
      size="sm"
      checked={on}
      onCheckedChange={onChange}
      aria-label={label}
      className="data-[state=checked]:bg-slate-300 data-[state=unchecked]:bg-surface-elevated"
    />
  )
}

/** Roll over, and how the countdown looks on screens and stage displays. */
function TimerStyleFields({
  style,
  onChange,
}: {
  style: ProgramTimerStyle
  onChange: (patch: Partial<ProgramTimerStyle>) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const row = 'flex items-center justify-between gap-3 text-[12px] text-zinc-300'
  return (
    <div className="space-y-2 rounded-md bg-surface-tertiary/60 px-2.5 py-2">
      <label className={row}>
        <span title="Keep counting into overtime (-0:12) after 0:00. Off: stop at 0:00.">Roll over past 0:00</span>
        <MiniSwitch on={style.rollover} label="Roll over past 0:00" onChange={(rollover) => onChange({ rollover })} />
      </label>
      <button
        type="button"
        className="flex w-full items-center justify-between text-[12px] text-zinc-300 hover:text-white"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Style
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full" style={{ background: style.color }} />
          <span className="h-3 w-3 rounded-full" style={{ background: style.overrunColor }} />
        </span>
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          <label className={row}>
            Color
            <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.color, '#5eead4')} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
          <label className={row}>
            Time-up color
            <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.overrunColor, '#f87171')} onChange={(e) => onChange({ overrunColor: e.target.value })} />
          </label>
          <label className={row}>
            <span title="A dark bar behind the clock and countdown on screens">Backdrop</span>
            <MiniSwitch on={style.backdrop} label="Backdrop" onChange={(backdrop) => onChange({ backdrop })} />
          </label>
        </div>
      )}
    </div>
  )
}

function ClockReadout(): React.ReactElement {
  const now = useNow(1000)
  return <span className="font-mono text-[13px] tabular-nums text-zinc-300">{formatClock(new Date(now))}</span>
}

export function TimersPanel(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = useDraftPresentation()
  const running = timerRunning(state.timer)
  const [stageDraft, setStageDraft] = useState('')

  return (
    <div className="h-full overflow-y-auto">
      <Section
        title="Countdown"
        action={
          <OnScreensToggle
            on={state.countdownOnScreens}
            label="Countdown"
            onChange={(on) => void window.api.program.setOnScreens('countdown', on).catch(report)}
          />
        }
      >
        <CountdownReadout timer={state.timer} style={presentation.timer} />
        <div className="flex justify-center gap-2">
          {running ? (
            <button type="button" className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs" onClick={() => void window.api.program.timer.pause().catch(report)}>
              <Pause size={12} aria-hidden="true" /> Pause
            </button>
          ) : (
            <button type="button" className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs" onClick={() => void window.api.program.timer.start().catch(report)}>
              <Play size={12} aria-hidden="true" /> Start
            </button>
          )}
          <button type="button" className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs" onClick={() => void window.api.program.timer.reset().catch(report)}>
            <RotateCcw size={12} aria-hidden="true" /> Reset
          </button>
        </div>
        <div className="flex justify-center gap-1">
          {PRESET_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className="rounded-md px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-surface-tertiary hover:text-white"
              onClick={() => void window.api.program.timer.set(m * 60).catch(report)}
            >
              {m}m
            </button>
          ))}
        </div>
        <TimerStyleFields
          style={presentation.timer}
          onChange={(patch) => setPresentation({ ...presentation, timer: { ...presentation.timer, ...patch } })}
        />
      </Section>

      <Section
        title="Clock"
        action={
          <OnScreensToggle
            on={state.clockOnScreens}
            label="Clock"
            onChange={(on) => void window.api.program.setOnScreens('clock', on).catch(report)}
          />
        }
      >
        <ClockReadout />
      </Section>

      <Section title="Stage message">
        {state.stageMessage && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-tint-red px-2.5 py-1.5 text-xs text-red-100">
            <span className="min-w-0 break-words">{state.stageMessage}</span>
            <button
              type="button"
              aria-label="Take the stage message down"
              title="Take down"
              className="shrink-0 text-red-200 hover:text-white"
              onClick={() => void window.api.program.setStageMessage(null).catch(report)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!stageDraft.trim()) return
            void window.api.program.setStageMessage(stageDraft).then(() => setStageDraft(''), report)
          }}
        >
          <input
            className="input flex-1 py-1 text-xs"
            placeholder="Wrap up · 2 minutes"
            aria-label="Stage message"
            value={stageDraft}
            onChange={(e) => setStageDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary flex items-center gap-1 px-3 py-1 text-xs" disabled={!stageDraft.trim()}>
            <Send size={12} aria-hidden="true" /> Send
          </button>
        </form>
      </Section>
    </div>
  )
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function MessagesPanel(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = useDraftPresentation()
  const [draft, setDraft] = useState('')
  const [styleOpen, setStyleOpen] = useState(false)
  const style = presentation.message

  const patchStyle = (patch: Partial<PresentationSettings['message']>): void => {
    setPresentation({ ...presentation, message: { ...style, ...patch } })
  }
  const send = (): void => {
    if (!draft.trim()) return
    void window.api.program.showMessage(draft).then(() => setDraft(''), report)
  }
  const row = 'flex items-center justify-between gap-3 text-[12px] text-zinc-300'

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Message">
        {state.message && (
          <div className="flex items-start justify-between gap-2 rounded-md bg-surface-tertiary px-2.5 py-2 text-xs text-white">
            <span className="min-w-0 whitespace-pre-wrap break-words">{state.message}</span>
            <button
              type="button"
              className="shrink-0 text-[11px] text-zinc-400 hover:text-white"
              onClick={() => void window.api.program.clearMessage().catch(report)}
            >
              Take down
            </button>
          </div>
        )}
        <textarea
          className="input min-h-[56px] w-full resize-none py-1.5 text-xs"
          rows={2}
          placeholder="Parents of child 42, please come to the nursery"
          aria-label="Message for the screens"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter shows it; Shift+Enter starts a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="flex justify-end">
          <button type="button" className="btn-primary flex items-center gap-1 px-3 py-1 text-xs" disabled={!draft.trim()} onClick={send}>
            <Send size={12} aria-hidden="true" /> {state.message ? 'Replace' : 'Show'}
          </button>
        </div>
      </Section>

      <Section title="Style">
        <div className="space-y-2.5 rounded-md bg-surface-tertiary/60 px-2.5 py-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-[12px] text-zinc-300 hover:text-white"
            aria-expanded={styleOpen}
            onClick={() => setStyleOpen(!styleOpen)}
          >
            {style.position === 'top' ? 'Top' : 'Bottom'} · {style.fontSizePx}px{style.scroll ? ' · ticker' : ''}
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full ring-1 ring-white/20" style={{ background: style.color }} />
              <span className="h-3 w-3 rounded-full ring-1 ring-white/20" style={{ background: style.background }} />
            </span>
          </button>
          {styleOpen && (
            <div className="space-y-2.5 pt-1">
              <div className={row}>
                Position
                <SegmentedControl
                  label="Position"
                  value={style.position}
                  options={[
                    { value: 'top', label: 'Top' },
                    { value: 'bottom', label: 'Bottom' },
                  ]}
                  onChange={(position) => patchStyle({ position })}
                  className="w-28"
                  itemClassName="py-0.5 text-[11px]"
                />

              </div>
              <label className={row}>
                Size
                <span className="flex items-center gap-2">
                  <input
                    type="range"
                    min={16}
                    max={160}
                    value={style.fontSizePx}
                    aria-label="Size"
                    className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-surface-elevated [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    onChange={(e) => patchStyle({ fontSizePx: Number(e.target.value) })}
                  />
                  <span className="w-8 text-right text-[11px] tabular-nums text-zinc-400">{style.fontSizePx}</span>
                </span>
              </label>
              <label className={row}>
                Text
                <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.color, '#ffffff')} onChange={(e) => patchStyle({ color: e.target.value })} />
              </label>
              <label className={row}>
                Bar
                <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.background, '#000000')} onChange={(e) => patchStyle({ background: e.target.value })} />
              </label>
              <label className={row}>
                Scroll as a ticker
                <MiniSwitch on={style.scroll} label="Scroll as a ticker" onChange={(scroll) => patchStyle({ scroll })} />
              </label>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

// ─── Show: logo, props, camera, program audio ─────────────────────────────────

const POSITIONS: Array<{ value: PropPosition; label: string }> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'center', label: 'Centre' },
]

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

type DeviceLabels = Record<'videoinput' | 'audioinput' | 'audiooutput', string[]>

/** Device labels by kind, from one enumeration, refreshed on hot-plug. */
function useDeviceLabels(): [DeviceLabels, () => void] {
  const [labels, setLabels] = useState<DeviceLabels>({ videoinput: [], audioinput: [], audiooutput: [] })
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((devices) => {
          if (cancelled) return
          const of = (kind: MediaDeviceKind): string[] =>
            [...new Set(devices.filter((d) => d.kind === kind && d.label).map((d) => d.label))]
          setLabels({ videoinput: of('videoinput'), audioinput: of('audioinput'), audiooutput: of('audiooutput') })
        })
        .catch(() => undefined)
    }
    load()
    navigator.mediaDevices?.addEventListener('devicechange', load)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener('devicechange', load)
    }
  }, [generation])
  return [labels, () => setGeneration((g) => g + 1)]
}

export function ShowPanel(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = useDraftPresentation()
  const [devices, reloadCameras] = useDeviceLabels()
  const { videoinput: cameras, audiooutput: speakers, audioinput: mics } = devices
  const [camera, setCamera] = useState('')
  const [cameraAudio, setCameraAudio] = useState('')
  const liveCameraAudio = state.camera ? state.cameraAudio ?? '' : cameraAudio

  const save = (next: PresentationSettings): void => {
    setPresentation(next)
  }
  const patchProp = (id: string, patch: Partial<ProgramProp>): void => {
    save({ ...presentation, props: presentation.props.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  }

  const pickLogo = async (): Promise<void> => {
    const path = await window.api.program.pickImage()
    if (path) save({ ...presentation, logo: { ...presentation.logo, mediaPath: path } })
  }
  const addProp = async (): Promise<void> => {
    const path = await window.api.program.pickImage()
    if (!path) return
    const prop: ProgramProp = {
      id: `prop-${Date.now().toString(36)}`,
      name: fileName(path).replace(/\.[^.]+$/, ''),
      mediaPath: path,
      position: 'top-right',
      widthPct: 12,
      marginPct: 2,
      opacity: 1,
    }
    save({ ...presentation, props: [...presentation.props, prop] })
  }

  // Camera labels only appear once capture has been allowed once.
  const requestCameraAccess = (): void => {
    void navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop())
        reloadCameras()
      })
      .catch(report)
  }

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Logo">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn('flex-1 rounded px-3 py-1.5 text-xs font-medium', state.logo ? 'bg-teal-600 text-white' : 'btn-secondary')}
            aria-pressed={state.logo}
            onClick={() => void window.api.program.setLogo(!state.logo).catch(report)}
          >
            {state.logo ? 'Logo is up — take down' : 'To logo'}
          </button>
          <button type="button" className="btn-secondary flex items-center gap-1 px-2 py-1.5 text-[11px]" onClick={() => void pickLogo().catch(report)}>
            <Image size={12} aria-hidden="true" /> {presentation.logo.mediaPath ? 'Change' : 'Choose'}
          </button>
        </div>
        <p className="truncate text-[10px] text-zinc-500">
          {presentation.logo.mediaPath ? fileName(presentation.logo.mediaPath) : 'No image — the logo is a plain colour.'}
        </p>
      </Section>

      <Section title="Props">
        {presentation.props.length === 0 && <p className="text-[11px] text-zinc-500">No props yet.</p>}
        <ul className="space-y-2">
          {presentation.props.map((prop) => {
            const on = state.activePropIds.includes(prop.id)
            return (
              <li key={prop.id} className="space-y-1.5 rounded p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={cn('flex-1 truncate rounded px-2 py-1 text-left text-xs', on ? 'bg-teal-600 text-white' : 'bg-surface-tertiary text-zinc-300')}
                    aria-pressed={on}
                    onClick={() => void window.api.program.setProp(prop.id, !on).catch(report)}
                  >
                    <Layers size={11} className="mr-1 inline" aria-hidden="true" />
                    {prop.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${prop.name}`}
                    className="text-zinc-500 hover:text-red-400"
                    onClick={() => {
                      if (window.confirm(`Remove the “${prop.name}” prop?`)) {
                        save({ ...presentation, props: presentation.props.filter((p) => p.id !== prop.id) })
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-zinc-500">
                  <select className="input py-0.5 text-[11px]" aria-label="Position" value={prop.position} onChange={(e) => patchProp(prop.id, { position: e.target.value as PropPosition })}>
                    {POSITIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1">
                    Width
                    <input
                      type="range"
                      min={2}
                      max={100}
                      value={prop.widthPct}
                      className="flex-1"
                      onChange={(e) => patchProp(prop.id, { widthPct: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex flex-1 items-center justify-center gap-1 py-1 text-xs" onClick={() => void addProp().catch(report)}>
            <Plus size={12} aria-hidden="true" /> Add prop
          </button>
          {state.activePropIds.length > 0 && (
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void window.api.program.clearProps().catch(report)}>
              Clear props
            </button>
          )}
        </div>
      </Section>

      <Section title="Camera / capture">
        {cameras.length === 0 ? (
          <button type="button" className="btn-secondary w-full py-1 text-xs" onClick={requestCameraAccess}>
            Allow camera access to list inputs
          </button>
        ) : (
          <div className="flex gap-2">
            <select className="input flex-1 py-1 text-xs" aria-label="Camera" value={camera || state.camera || ''} onChange={(e) => setCamera(e.target.value)}>
              <option value="">— choose an input —</option>
              {cameras.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            {state.camera ? (
              <button type="button" className="rounded bg-red-600 px-3 py-1 text-xs text-white" onClick={() => void window.api.program.setCamera(null).catch(report)}>
                Off
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary flex items-center gap-1 px-3 py-1 text-xs disabled:opacity-40"
                disabled={!camera}
                onClick={() => void window.api.program.setCamera(camera, cameraAudio || null).catch(report)}
              >
                <Video size={12} aria-hidden="true" /> Go live
              </button>
            )}
          </div>
        )}
        {cameras.length > 0 && (
          <select
            className="input w-full py-1 text-xs"
            aria-label="Camera sound"
            value={liveCameraAudio}
            onChange={(e) => {
              const next = e.target.value
              setCameraAudio(next)
              // Changing the sound of a live camera reopens it with the new input.
              if (state.camera) void window.api.program.setCamera(state.camera, next || null).catch(report)
            }}
          >
            <option value="">No sound</option>
            {mics.map((label) => (
              <option key={label} value={label}>Sound: {label}</option>
            ))}
          </select>
        )}
        {state.camera && (
          <p className="truncate text-[10px] text-teal-400">
            Live: {state.camera}
            {state.cameraAudio ? ` · sound from ${state.cameraAudio}` : ''}
          </p>
        )}
        {liveCameraAudio && (
          <p className="text-[10px] leading-snug text-zinc-500">
            Plays through the sound output below. Keep the mic away from the room speakers to avoid feedback.
          </p>
        )}
      </Section>

      <Section title="Sound">
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={presentation.audio.enabled}
            onChange={(e) => save({ ...presentation, audio: { ...presentation.audio, enabled: e.target.checked } })}
          />
          <Volume2 size={12} aria-hidden="true" /> Play sound from background videos
        </label>
        {(presentation.audio.enabled || !!liveCameraAudio) && (
          <div className="space-y-1.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              aria-label="Volume"
              value={presentation.audio.volume}
              className="w-full"
              onChange={(e) => save({ ...presentation, audio: { ...presentation.audio, volume: Number(e.target.value) } })}
            />
            <select
              className="input w-full py-1 text-xs"
              aria-label="Sound output"
              value={presentation.audio.outputLabel}
              onChange={(e) => save({ ...presentation, audio: { ...presentation.audio, outputLabel: e.target.value } })}
            >
              <option value="">System default output</option>
              {speakers.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            <p className="text-[10px] leading-snug text-zinc-500">
              Video and camera sound play from the first Kairo screen (else the NDI feed) only, so
              screens never echo each other.
            </p>
          </div>
        )}
      </Section>
    </div>
  )
}

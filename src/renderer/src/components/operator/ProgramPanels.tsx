import { useEffect, useState } from 'react'
import { Image, Layers, Pause, Play, Plus, RotateCcw, Send, Trash2, Video, Volume2, X } from '@/icons'
import { cn } from '@/lib/utils'
import { useNow, usePresentation, useProgramState } from '@/hooks/useProgramState'
import {
  formatTimer,
  timerRemainingSec,
  timerRunning,
  type PresentationSettings,
  type ProgramProp,
  type ProgramTimerState,
  type PropPosition,
} from '@shared/program'

// ─── Booth toolbox panels for the program layers (standalone phases 2–3) ──────
// Everything here acts on Kairo's own screens and NDI feeds, not ProPresenter.

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="space-y-2 border-b border-surface-border/40 px-3 py-3 last:border-b-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
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

/** The countdown readout — the only part of the panel that ticks, and only while running. */
function CountdownReadout({ timer }: { timer: ProgramTimerState }): React.ReactElement {
  const running = timerRunning(timer)
  const now = useNow(250, running)
  const remaining = timerRemainingSec(timer, now)
  return (
    <p
      className={cn(
        'text-center font-mono text-4xl font-semibold tabular-nums',
        remaining < 0 ? 'text-red-400' : running ? 'text-teal-300' : 'text-zinc-300',
      )}
      aria-live="off"
    >
      {formatTimer(remaining)}
    </p>
  )
}

export function TimersPanel(): React.ReactElement {
  const state = useProgramState()
  const running = timerRunning(state.timer)
  const [minutes, setMinutes] = useState('')
  const [stageDraft, setStageDraft] = useState('')

  const setFromInput = (): void => {
    const value = Number(minutes)
    if (!Number.isFinite(value) || value <= 0) return
    void window.api.program.timer.set(Math.round(value * 60)).catch(report)
    setMinutes('')
  }

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Countdown">
        <CountdownReadout timer={state.timer} />
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
        <div className="flex flex-wrap justify-center gap-1">
          {PRESET_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className="rounded border border-surface-border px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
              onClick={() => void window.api.program.timer.set(m * 60).catch(report)}
            >
              {m} min
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setFromInput()
          }}
        >
          <input
            className="input flex-1 py-1 text-xs"
            inputMode="decimal"
            placeholder="Minutes"
            aria-label="Countdown minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <button type="submit" className="btn-secondary px-3 py-1 text-xs">Set</button>
        </form>
        <p className="text-[10px] leading-snug text-zinc-500">
          Shows on every stage display that has the countdown turned on.
        </p>
      </Section>

      <Section title="Stage message">
        {state.stageMessage && (
          <div className="flex items-start justify-between gap-2 rounded bg-tint-red px-2 py-1.5 text-xs text-red-100">
            <span className="min-w-0 break-words">{state.stageMessage}</span>
            <button
              type="button"
              aria-label="Clear stage message"
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
          <button type="submit" className="btn-primary flex items-center gap-1 px-3 py-1 text-xs">
            <Send size={12} aria-hidden="true" /> Send
          </button>
        </form>
        <p className="text-[10px] leading-snug text-zinc-500">Stage displays only — the room never sees it.</p>
      </Section>
    </div>
  )
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function MessagesPanel(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = usePresentation()
  const [draft, setDraft] = useState('')
  const style = presentation.message

  const patchStyle = (patch: Partial<PresentationSettings['message']>): void => {
    void setPresentation({ ...presentation, message: { ...style, ...patch } }).catch(report)
  }

  return (
    <div className="h-full overflow-y-auto">
      <Section title="On screen">
        {state.message ? (
          <div className="flex items-start justify-between gap-2 rounded bg-tint-teal px-2 py-1.5 text-xs text-teal-100">
            <span className="min-w-0 whitespace-pre-wrap break-words">{state.message}</span>
            <button
              type="button"
              className="shrink-0 rounded border border-teal-500/40 px-2 py-0.5 text-[11px] hover:bg-tint-teal"
              onClick={() => void window.api.program.clearMessage().catch(report)}
            >
              Take down
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">No message showing.</p>
        )}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim()) return
            void window.api.program.showMessage(draft).then(() => setDraft(''), report)
          }}
        >
          <textarea
            className="input min-h-[64px] w-full resize-y py-1.5 text-xs"
            placeholder="Parents of child 42, please come to the nursery"
            aria-label="Message for the screens"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary flex w-full items-center justify-center gap-1 py-1.5 text-xs">
            <Send size={12} aria-hidden="true" /> Show on screens
          </button>
        </form>
      </Section>

      <Section title="Style">
        <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
          <label className="flex flex-col gap-1">
            Position
            <select className="input py-1 text-xs" value={style.position} onChange={(e) => patchStyle({ position: e.target.value as 'top' | 'bottom' })}>
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Size
            <input
              type="number"
              min={16}
              max={160}
              className="input py-1 text-xs"
              value={style.fontSizePx}
              onChange={(e) => patchStyle({ fontSizePx: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            Text
            <input type="color" className="h-7 w-full cursor-pointer rounded bg-transparent" value={hexOr(style.color, '#ffffff')} onChange={(e) => patchStyle({ color: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            Bar
            <input type="color" className="h-7 w-full cursor-pointer rounded bg-transparent" value={hexOr(style.background, '#000000')} onChange={(e) => patchStyle({ background: e.target.value })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input type="checkbox" checked={style.scroll} onChange={(e) => patchStyle({ scroll: e.target.checked })} />
          Scroll as a ticker
        </label>
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
  const [presentation, setPresentation] = usePresentation()
  const [devices, reloadCameras] = useDeviceLabels()
  const { videoinput: cameras, audiooutput: speakers, audioinput: mics } = devices
  const [camera, setCamera] = useState('')
  const [cameraAudio, setCameraAudio] = useState('')
  const liveCameraAudio = state.camera ? state.cameraAudio ?? '' : cameraAudio

  const save = (next: PresentationSettings): void => {
    void setPresentation(next).catch(report)
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
              <li key={prop.id} className="space-y-1.5 rounded border border-surface-border/50 p-2">
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

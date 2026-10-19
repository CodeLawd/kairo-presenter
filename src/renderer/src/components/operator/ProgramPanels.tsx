import { Children, useCallback, useEffect, useRef, useState } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Popover } from 'radix-ui'
import { Switch } from '@/components/ui/switch'
import { ChevronRight, Clock, Copy, Edit2, Layers, MonitorPlay, Pause, Pencil, Play, Plus, Send, Settings, SkipBack, Trash2, Video, Volume2, X } from '@/icons'
import { cn } from '@/lib/utils'
import { useNow, usePresentation, useProgramState } from '@/hooks/useProgramState'
import { useAppStore } from '@/stores/useAppStore'
import { PropPreview } from '@/components/props/PropPreview'
import { RowContextMenu } from '@/components/shared/RowContextMenu'
import {
  DEFAULT_TIMER,
  MAX_PROGRAM_TIMERS,
  MAX_SAVED_MESSAGE_LENGTH,
  MAX_SAVED_MESSAGES,
  formatClock,
  formatTimer,
  idleTimer,
  screenTimerDef,
  timerReadout,
  timerRunning,
  type PresentationSettings,
  type ProgramProp,
  type ProgramTimerDef,
  type ProgramTimerState,
  type ProgramTimerStyle,
} from '@shared/program'

// ─── Booth toolbox panels for the program layers (standalone phases 2–3) ──────
// Everything here acts on Kairo's own screens and NDI feeds, not ProPresenter.

/**
 * A titled group, as in macOS System Settings: the title (and its action, e.g.
 * Show) sits above one rounded box. By default the content is one padded block;
 * with `split`, every child is its own row, divided by a faint inset line.
 */
function Section({
  title,
  action,
  split = false,
  children,
}: {
  title: string
  action?: React.ReactNode
  split?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="space-y-1.5 px-3 pt-3 last:pb-3">
      <div className="flex min-h-7 items-center justify-between gap-2 px-1">
        <h3 className="text-[12px] font-semibold text-zinc-200">{title}</h3>
        {action}
      </div>
      <div className="pref-group pref-group-dim overflow-hidden rounded-lg bg-surface">
        {split
          ? Children.toArray(children).map((child, i) => (
              <div key={i} className="px-3.5 py-2.5">{child}</div>
            ))
          : <div className="space-y-2.5 px-3.5 py-3">{children}</div>}
      </div>
    </section>
  )
}

function report(err: unknown): void {
  console.error(err)
  window.alert((err as Error).message ?? String(err))
}

// ─── Timers ───────────────────────────────────────────────────────────────────

/**
 * Presentation settings with writes coalesced: the panel follows every change
 * at once, but a slider or colour drag reaches settings (a disk write and a
 * reconcile of every screen in main) once it settles, not on every step.
 */
export function useDraftPresentation(): [
  PresentationSettings,
  (next: PresentationSettings) => void,
  /** Writes a waiting change now instead of after the pause; resolves once saved. */
  () => Promise<void>,
] {
  const [stored, save] = usePresentation()
  const [draft, setDraft] = useState<PresentationSettings | null>(null)
  const pending = useRef<PresentationSettings | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    // Drop the draft once saved, unless a newer change is already waiting.
    if (next) await save(next).then(() => { if (!pending.current) setDraft(null) }, report)
  }, [save])
  useEffect(() => () => void flush(), [flush])
  const update = useCallback(
    (next: PresentationSettings) => {
      pending.current = next
      setDraft(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 250)
    },
    [flush],
  )
  return [draft ?? stored, update, flush]
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

/** One timer: its name and time, reset and play; expanded, its settings. */
function TimerRow({
  def,
  run,
  onScreens,
  expanded,
  canRemove,
  style,
  onToggle,
  onChange,
  onRemove,
}: {
  def: ProgramTimerDef
  run: ProgramTimerState | null
  onScreens: boolean
  expanded: boolean
  canRemove: boolean
  style: ProgramTimerStyle
  onToggle: () => void
  onChange: (patch: Partial<ProgramTimerDef>) => void
  onRemove: () => void
}): React.ReactElement {
  const running = run ? timerRunning(run) : false
  const now = useNow(250, running || def.kind === 'countdownTo')
  const current = run ?? idleTimer(def, now)
  const { seconds, timeUp } = timerReadout(current, now, def.overrun)
  const [durationDraft, setDurationDraft] = useState<string | null>(null)
  const started = running || (run !== null && run.remainingSec !== run.durationSec)

  // A countdown to a time is worked out when it's reset; let the save land first.
  const resetSoon = (): void => {
    setTimeout(() => void window.api.program.timer.reset(def.id).catch(report), 400)
  }
  const commitDuration = (): void => {
    if (durationDraft === null) return
    const next = parseDuration(durationDraft)
    setDurationDraft(null)
    if (next === null || next <= 0) return
    onChange({ durationSec: next })
    if (!running) void window.api.program.timer.set(next, def.id).catch(report)
  }

  return (
    <div className="-mx-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded text-zinc-500 hover:text-white"
          aria-expanded={expanded}
          aria-label={expanded ? `Close ${def.name}` : `Edit ${def.name}`}
          onClick={onToggle}
        >
          <ChevronRight size={13} aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-90')} />
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <span className="block truncate text-[12px] font-medium text-zinc-200">{def.name}</span>
          <span
            className={cn('flex items-center gap-1 font-mono text-[15px] tabular-nums', running ? 'text-white' : 'text-zinc-400')}
            style={timeUp ? { color: style.overrunColor } : undefined}
          >
            <Clock size={12} aria-hidden="true" className="shrink-0" />
            {def.kind === 'countdownTo' && !started
              ? <span className="font-sans text-[12px]">Countdown to {formatTimeOfDay(def.targetTime)}</span>
              : formatTimer(seconds)}
          </span>
        </button>
        <button
          type="button"
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md',
            onScreens ? 'bg-teal-500 text-on-accent' : 'text-zinc-500 hover:bg-surface-tertiary hover:text-white',
          )}
          aria-pressed={onScreens}
          aria-label={onScreens ? `${def.name} is the timer on screens` : `Use ${def.name} on screens`}
          title={onScreens ? 'This is the timer screens show' : 'Show this timer on screens'}
          onClick={() => void window.api.program.timer.show(def.id).catch(report)}
        >
          <MonitorPlay size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white"
          aria-label={`Reset ${def.name}`}
          title="Reset"
          onClick={() => void window.api.program.timer.reset(def.id).catch(report)}
        >
          <SkipBack size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md',
            running ? 'bg-surface-tertiary text-white hover:bg-surface-elevated' : 'text-zinc-300 hover:bg-surface-tertiary hover:text-white',
          )}
          aria-label={running ? `Pause ${def.name}` : `Start ${def.name}`}
          title={running ? 'Pause' : 'Start'}
          onClick={() =>
            void (running ? window.api.program.timer.pause(def.id) : window.api.program.timer.start(def.id)).catch(report)
          }
        >
          {running ? <Pause size={13} fill="currentColor" aria-hidden="true" /> : <Play size={13} fill="currentColor" aria-hidden="true" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-2.5 rounded-md bg-surface-secondary px-3 py-3 text-[12px] text-zinc-300">
          <label className="flex items-center justify-between gap-3">
            Name
            <input
              className="input w-[150px] px-2 py-1 text-[12px]"
              value={def.name}
              maxLength={80}
              aria-label="Timer name"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            Type
            <select
              className="input w-[150px] px-2 py-1 text-[12px]"
              value={def.kind}
              aria-label="Timer type"
              disabled={running}
              onChange={(e) => {
                onChange({ kind: e.target.value as ProgramTimerDef['kind'] })
                resetSoon()
              }}
            >
              <option value="countdown">Countdown</option>
              <option value="countdownTo">Countdown to a time</option>
            </select>
          </label>
          {def.kind === 'countdown' ? (
            <label className="flex items-center justify-between gap-3">
              Duration
              <input
                className="input w-[150px] px-2 py-1 font-mono text-[12px] tabular-nums"
                value={durationDraft ?? formatTimer(def.durationSec)}
                aria-label="Duration, hours:minutes:seconds"
                placeholder="5:00"
                onFocus={(e) => {
                  setDurationDraft(formatTimer(def.durationSec))
                  e.currentTarget.select()
                }}
                onChange={(e) => setDurationDraft(e.target.value)}
                onBlur={commitDuration}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setDurationDraft(null)
                }}
              />
            </label>
          ) : (
            <label className="flex items-center justify-between gap-3">
              Counts down to
              <input
                type="time"
                className="input w-[150px] px-2 py-1 text-[12px]"
                value={def.targetTime}
                aria-label="Time it counts down to"
                onChange={(e) => {
                  if (!/^\d{2}:\d{2}$/.test(e.target.value)) return
                  onChange({ targetTime: e.target.value })
                  if (!running) resetSoon()
                }}
              />
            </label>
          )}
          <label className="flex items-center justify-between gap-3">
            <span title="Keep counting into overtime (-0:12) after 0:00. Off: stop at 0:00.">Allows overrun</span>
            <MiniSwitch on={def.overrun} label="Allows overrun" onChange={(overrun) => onChange({ overrun })} />
          </label>
          {canRemove && (
            <div className="flex justify-end pt-0.5">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-surface-tertiary hover:text-red-400"
                onClick={onRemove}
              >
                <Trash2 size={12} aria-hidden="true" /> Delete timer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** How every timer looks on screens and stage displays, behind a gear. */
function TimerStyleButton({
  style,
  onChange,
}: {
  style: ProgramTimerStyle
  onChange: (patch: Partial<ProgramTimerStyle>) => void
}): React.ReactElement {
  const row = 'flex items-center justify-between gap-3 py-2.5 text-[12px] text-zinc-300'
  return (
    <Popover.Root>
      <Popover.Trigger
        className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white data-[state=open]:bg-surface-tertiary data-[state=open]:text-white"
        aria-label="Timer style"
        title="Timer style"
      >
        <Settings size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-60 rounded-xl bg-surface-elevated px-3.5 pb-1.5 pt-3 text-zinc-200 ring-1 ring-surface-border animate-spring-in"
        >
          <p className="text-[12px] font-semibold text-white">Timer style</p>
          <div className="divide-y divide-surface-border">
            <label className={row}>
              Colour
              <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.color, '#5eead4')} onChange={(e) => onChange({ color: e.target.value })} />
            </label>
            <label className={row}>
              Time-up colour
              <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.overrunColor, '#f87171')} onChange={(e) => onChange({ overrunColor: e.target.value })} />
            </label>
            <label className={row}>
              <span title="A dark bar behind the clock and countdown on screens">Backdrop</span>
              <MiniSwitch on={style.backdrop} label="Backdrop" onChange={(backdrop) => onChange({ backdrop })} />
            </label>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ClockReadout(): React.ReactElement {
  const now = useNow(1000)
  return <span className="font-mono text-[13px] tabular-nums text-zinc-300">{formatClock(new Date(now))}</span>
}

/** `5:00`, `1:02:03` → seconds; null when it isn't a time. */
function parseDuration(text: string): number | null {
  const parts = text.trim().split(':').map((part) => part.trim())
  if (parts.length === 0 || parts.length > 3 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/** `17:00` → `5:00 PM`. */
function formatTimeOfDay(targetTime: string): string {
  const [hours, minutes] = targetTime.split(':').map(Number)
  return formatClock(new Date(2000, 0, 1, hours, minutes))
}

export function TimersPanel(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = useDraftPresentation()
  const [stageDraft, setStageDraft] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const timers = presentation.timers
  const onScreens = screenTimerDef(presentation, state)

  const patchTimer = (id: string, patch: Partial<ProgramTimerDef>): void => {
    setPresentation({ ...presentation, timers: timers.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }
  const addTimer = (): void => {
    if (timers.length >= MAX_PROGRAM_TIMERS) return
    const id = `timer-${Date.now().toString(36)}`
    setPresentation({
      ...presentation,
      timers: [...timers, { ...DEFAULT_TIMER, id, name: `Timer ${timers.length + 1}`, overrun: presentation.timer.rollover }],
    })
    setExpandedId(id)
  }
  const removeTimer = (id: string): void => {
    if (timers.length <= 1) return
    setPresentation({ ...presentation, timers: timers.filter((t) => t.id !== id) })
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Timers as ProPresenter lists them: one row each, expand to edit. */}
      <Section
        title="Timers"
        split
        action={
          <div className="flex items-center gap-1">
            <TimerStyleButton
              style={presentation.timer}
              onChange={(patch) => setPresentation({ ...presentation, timer: { ...presentation.timer, ...patch } })}
            />
            <OnScreensToggle
              on={state.countdownOnScreens}
              label={onScreens.name}
              onChange={(on) => void window.api.program.setOnScreens('countdown', on).catch(report)}
            />
            <button
              type="button"
              className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-40"
              aria-label="New timer"
              title="New timer"
              disabled={timers.length >= MAX_PROGRAM_TIMERS}
              onClick={addTimer}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
        }
      >
        {timers.map((def) => (
          <TimerRow
            key={def.id}
            def={def}
            run={state.timers[def.id] ?? null}
            onScreens={def.id === onScreens.id}
            expanded={expandedId === def.id}
            canRemove={timers.length > 1}
            style={presentation.timer}
            onToggle={() => setExpandedId(expandedId === def.id ? null : def.id)}
            onChange={(patch) => patchTimer(def.id, patch)}
            onRemove={() => removeTimer(def.id)}
          />
        ))}
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
        <div className="flex items-center justify-between gap-3 text-[12px] text-zinc-300">
          Time now
          <ClockReadout />
        </div>
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
  const style = presentation.message

  const patchStyle = (patch: Partial<PresentationSettings['message']>): void => {
    setPresentation({ ...presentation, message: { ...style, ...patch } })
  }
  const saved = presentation.messages
  /** Keeps `text` in the saved list (once), newest first. */
  const remember = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || saved.some((m) => m.text === trimmed)) return
    const message = { id: `msg-${Date.now().toString(36)}`, text: trimmed.slice(0, MAX_SAVED_MESSAGE_LENGTH) }
    setPresentation({ ...presentation, messages: [message, ...saved].slice(0, MAX_SAVED_MESSAGES) })
  }
  const forget = (id: string): void => {
    setPresentation({ ...presentation, messages: saved.filter((m) => m.id !== id) })
  }
  const show = (text: string): void => {
    void window.api.program.showMessage(text).catch(report)
  }
  const takeDown = (): void => {
    void window.api.program.clearMessage().catch(report)
  }
  // Showing a new message keeps it for next time, so the list builds itself.
  const sendDraft = (): void => {
    if (!draft.trim()) return
    remember(draft)
    void window.api.program.showMessage(draft).then(() => setDraft(''), report)
  }
  const saveDraft = (): void => {
    if (!draft.trim()) return
    remember(draft)
    setDraft('')
  }
  const liveUnsaved = state.message && !saved.some((m) => m.text === state.message)

  return (
    <div className="h-full overflow-y-auto">
      {/* Saved messages, one row each, like ProPresenter's Messages list. */}
      <Section title="Messages" split action={<MessageStyleButton style={style} onChange={patchStyle} />}>
        {liveUnsaved && (
          <MessageRow text={state.message ?? ''} live onTakeDown={takeDown} />
        )}
        {saved.map((m) => (
          <MessageRow
            key={m.id}
            text={m.text}
            live={state.message === m.text}
            onShow={() => show(m.text)}
            onTakeDown={takeDown}
            onRemove={() => forget(m.id)}
          />
        ))}
        {saved.length === 0 && !liveUnsaved && (
          <p className="py-1 text-center text-[11px] text-zinc-500">No saved messages yet. Write one below.</p>
        )}
      </Section>

      <Section title="New message">
        <textarea
          className="input min-h-[56px] w-full resize-none py-1.5 text-xs"
          rows={2}
          placeholder="Parents of child 42, please come to the nursery"
          aria-label="New message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter shows it; Shift+Enter starts a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendDraft()
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={!draft.trim()} onClick={saveDraft}>
            Save
          </button>
          <button type="button" className="btn-primary flex items-center gap-1 px-3 py-1 text-xs" disabled={!draft.trim()} onClick={sendDraft}>
            <Send size={12} aria-hidden="true" /> Show
          </button>
        </div>
      </Section>

    </div>
  )
}

/**
 * How messages look on screen — position, size, colours, ticker — tucked
 * behind a gear by the Messages title: set once, rarely touched mid-service.
 */
function MessageStyleButton({
  style,
  onChange,
}: {
  style: PresentationSettings['message']
  onChange: (patch: Partial<PresentationSettings['message']>) => void
}): React.ReactElement {
  const row = 'flex items-center justify-between gap-3 py-2.5 text-[12px] text-zinc-300'
  return (
    <Popover.Root>
      <Popover.Trigger
        className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white data-[state=open]:bg-surface-tertiary data-[state=open]:text-white"
        aria-label="Message style"
        title="Message style"
      >
        <Settings size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-64 rounded-xl bg-surface-elevated px-3.5 pb-1.5 pt-3 text-zinc-200 ring-1 ring-surface-border animate-spring-in"
        >
          <p className="text-[12px] font-semibold text-white">Message style</p>
          <div className="divide-y divide-surface-border">
            <div className={row}>
              Position
              <SegmentedControl
                label="Position"
                value={style.position}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
                onChange={(position) => onChange({ position })}
                fit
                itemClassName="px-2.5 py-0.5 text-[11px] whitespace-nowrap"
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
                  className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-surface-border [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                  onChange={(e) => onChange({ fontSizePx: Number(e.target.value) })}
                />
                <span className="w-8 text-right text-[11px] tabular-nums text-zinc-400">{style.fontSizePx}</span>
              </span>
            </label>
            <label className={row}>
              Text
              <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.color, '#ffffff')} onChange={(e) => onChange({ color: e.target.value })} />
            </label>
            <label className={row}>
              Bar
              <input type="color" className="h-5 w-8 cursor-pointer rounded bg-transparent" value={hexOr(style.background, '#000000')} onChange={(e) => onChange({ background: e.target.value })} />
            </label>
            <label className={row}>
              Scroll as a ticker
              <MiniSwitch on={style.scroll} label="Scroll as a ticker" onChange={(scroll) => onChange({ scroll })} />
            </label>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** One saved message: its text, and Show — or, while it's up, Take down. */
function MessageRow({
  text,
  live,
  onShow,
  onTakeDown,
  onRemove,
}: {
  text: string
  live: boolean
  onShow?: () => void
  onTakeDown: () => void
  onRemove?: () => void
}): React.ReactElement {
  return (
    <div className="group/message flex items-center gap-2">
      {live && <span className="size-1.5 shrink-0 rounded-full bg-live" title="On screen" aria-label="On screen" />}
      <p className={cn('line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px]', live ? 'text-white' : 'text-zinc-300')}>
        {text}
      </p>
      {onRemove && !live && (
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 opacity-0 hover:bg-surface-tertiary hover:text-red-400 focus-visible:opacity-100 group-hover/message:opacity-100"
          aria-label="Delete message"
          title="Delete"
          onClick={onRemove}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      )}
      {live ? (
        <button type="button" className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]" onClick={onTakeDown}>
          Take down
        </button>
      ) : (
        <button type="button" className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]" onClick={onShow}>
          Show
        </button>
      )}
    </div>
  )
}

function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

// ─── Shared by the Props, Camera and Audio tabs ───────────────────────────────

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

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * The props, as ProPresenter shows them: a grid of thumbnails, click one to
 * put it up or take it down. They're built in the Props editor.
 */
export function PropsPanel(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = useDraftPresentation()
  const props = presentation.props
  const openEditor = (select: string | null = null): void => useAppStore.getState().openProps(select)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const deleteProp = (id: string): void => {
    if (state.activePropIds.includes(id)) void window.api.program.setProp(id, false).catch(report)
    setPresentation({ ...presentation, props: props.filter((p) => p.id !== id) })
  }
  const renameProp = (id: string, name: string): void => {
    setRenamingId(null)
    const trimmed = name.trim()
    if (!trimmed) return
    setPresentation({ ...presentation, props: props.map((p) => (p.id === id ? { ...p, name: trimmed.slice(0, 80) } : p)) })
  }
  /** A copy just after the original, with fresh ids so the two never share state. */
  const duplicateProp = (prop: ProgramProp): void => {
    const stamp = Date.now().toString(36)
    const copy: ProgramProp = {
      ...prop,
      id: `prop-${stamp}`,
      name: `${prop.name} copy`.slice(0, 80),
      objects: prop.objects.map((o, i) => ({ ...o, id: `${o.kind}-${stamp}-${i}` })),
    }
    const index = props.findIndex((p) => p.id === prop.id)
    setPresentation({ ...presentation, props: [...props.slice(0, index + 1), copy, ...props.slice(index + 1)] })
  }

  if (props.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-surface-tertiary text-zinc-400">
          <Layers size={18} aria-hidden="true" />
        </span>
        <p className="text-[13px] font-semibold text-white">No props yet</p>
        <p className="max-w-[17rem] text-[11px] leading-relaxed text-zinc-500">
          A prop sits over the slides — a logo in the corner, a welcome banner, a giving card.
        </p>
        <button type="button" className="btn-primary mt-1 flex items-center gap-1 px-3 py-1.5 text-[12px]" onClick={() => openEditor()}>
          <Plus size={12} aria-hidden="true" /> Create a prop
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-3 pb-3 pt-3">
      <div className="flex min-h-7 items-center gap-1 px-1 pb-2">
        <h3 className="min-w-0 flex-1 text-[12px] font-semibold text-zinc-200">Props</h3>
        {state.activePropIds.length > 1 && (
          <button type="button" className="mr-1 text-[11px] text-zinc-400 hover:text-white" onClick={() => void window.api.program.clearProps().catch(report)}>
            Take all down
          </button>
        )}
        <button
          type="button"
          className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white"
          aria-label="Edit props"
          title="Edit props"
          onClick={() => openEditor()}
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white"
          aria-label="New prop"
          title="New prop"
          onClick={() => openEditor()}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3 gap-y-3">
        {props.map((prop) => {
          const on = state.activePropIds.includes(prop.id)
          const empty = prop.objects.length === 0 && !prop.background
          return (
            <li key={prop.id} className="min-w-0">
              {/* Right-click for what you can do to it, as in ProPresenter. */}
              <RowContextMenu
                items={[
                  {
                    label: on ? 'Take down' : 'Show',
                    icon: <MonitorPlay size={13} aria-hidden="true" />,
                    onSelect: () => void window.api.program.setProp(prop.id, !on).catch(report),
                  },
                  { label: 'Edit…', icon: <Pencil size={13} aria-hidden="true" />, onSelect: () => openEditor(prop.id) },
                  { label: 'Rename', icon: <Edit2 size={13} aria-hidden="true" />, onSelect: () => setRenamingId(prop.id) },
                  { label: 'Duplicate', icon: <Copy size={13} aria-hidden="true" />, onSelect: () => duplicateProp(prop) },
                  { label: 'Delete', icon: <Trash2 size={13} aria-hidden="true" />, destructive: true, onSelect: () => deleteProp(prop.id) },
                ]}
              >
                <button
                  type="button"
                  // Never disabled: a disabled button gets no right-click. An empty
                  // prop has nothing to show, so clicking it opens it to edit.
                  className={cn('group/prop block w-full text-left', empty && !on && 'opacity-60')}
                  aria-pressed={on}
                  title={empty && !on ? 'Empty — click to add something' : on ? 'Take down' : 'Show'}
                  onClick={() =>
                    empty && !on
                      ? openEditor(prop.id)
                      : void window.api.program.setProp(prop.id, !on).catch(report)
                  }
                >
                  <span
                    className={cn(
                      'block overflow-hidden rounded-md ring-2 transition-shadow',
                      // Red is what's on screen.
                      on ? 'ring-live' : 'ring-transparent group-hover/prop:ring-surface-border',
                    )}
                  >
                    <PropPreview prop={prop} width={240} className="!h-auto !w-full aspect-video" />
                  </span>
                  {renamingId !== prop.id && (
                    <span className={cn('mt-1.5 block truncate text-center text-[11px]', on ? 'font-semibold text-white' : 'text-zinc-300')}>
                      {prop.name}
                    </span>
                  )}
                </button>
              </RowContextMenu>
              {renamingId === prop.id && (
                <input
                  autoFocus
                  defaultValue={prop.name}
                  maxLength={80}
                  aria-label="Prop name"
                  className="input mt-1 w-full px-1.5 py-0.5 text-center text-[11px]"
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => renameProp(prop.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Camera ───────────────────────────────────────────────────────────────────

/** A camera or capture input, live on the screens behind the words. */
export function LivePanel(): React.ReactElement {
  const state = useProgramState()
  const [devices, reloadCameras] = useDeviceLabels()
  const { videoinput: cameras, audioinput: mics } = devices
  const [camera, setCamera] = useState('')
  const [cameraAudio, setCameraAudio] = useState('')
  const liveCameraAudio = state.camera ? state.cameraAudio ?? '' : cameraAudio

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

    </div>
  )
}

// ─── Sound from videos and the camera (shown on the Audio tab) ────────────────

/** Whether background videos and the camera play sound, how loud, and where. */
export function ProgramSoundSection(): React.ReactElement {
  const state = useProgramState()
  const [presentation, setPresentation] = useDraftPresentation()
  const [devices] = useDeviceLabels()
  const { audiooutput: speakers } = devices
  const liveCameraAudio = state.camera ? state.cameraAudio ?? '' : ''
  const save = (next: PresentationSettings): void => {
    setPresentation(next)
  }

  return (
    <>
      <Section title="Video sound">
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
    </>
  )
}

import { Children, useEffect, useState } from "react";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
import { Popover } from "radix-ui";
import { Switch } from "@/components/ui/switch";
import {
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  Layers,
  MonitorPlay,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Settings,
  SkipBack,
  Trash2,
  Video,
  Volume2,
  X,
} from "@/icons";
import { cn } from "@/lib/utils";
import { useNow, useProgramState } from "@/hooks/useProgramState";
import { useDraftPresentation } from "@/hooks/useDraftPresentation";
import { VideoLayoutCanvas } from "@/components/operator/VideoLayoutCanvas";
import { useAppStore } from "@/stores/useAppStore";
import { PropPreview } from "@/components/props/PropPreview";
import { RowContextMenu } from "@/components/shared/RowContextMenu";
import {
  DEFAULT_TIMER,
  MAX_PROGRAM_TIMERS,
  MAX_SAVED_MESSAGE_LENGTH,
  MAX_SAVED_MESSAGES,
  formatClock,
  defaultTimerTheme,
  idleTimer,
  propTimerViewFor,
  screenTimerDef,
  timerReadout,
  timerReadoutObject,
  timerRunning,
  type VideoSettings,
  type PresentationSettings,
  type ProgramProp,
  type ProgramTimerDef,
  type ProgramTimerState,
} from "@shared/program";

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
  title: string;
  action?: React.ReactNode;
  split?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="space-y-1.5 px-3 pt-3 last:pb-3">
      <div className="flex min-h-7 items-center justify-between gap-2 px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
          {title}
        </h3>
        {action}
      </div>
      <div className="pref-group pref-group-dim overflow-hidden rounded-lg bg-surface">
        {split ? (
          Children.toArray(children).map((child, i) => (
            <div key={i} className="px-3.5 py-2.5">
              {child}
            </div>
          ))
        ) : (
          <div className="space-y-2.5 px-3.5 py-3">{children}</div>
        )}
      </div>
    </section>
  );
}

function report(err: unknown): void {
  console.error(err);
  window.alert((err as Error).message ?? String(err));
}

// ─── Timers ───────────────────────────────────────────────────────────────────

/** Screens whose Look allows the layer show it only while this is on. */
function OnScreensToggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} on screens`}
      onClick={() => onChange(!on)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        on
          ? "bg-slate-200 text-surface"
          : "bg-surface-tertiary text-zinc-300 hover:bg-surface-elevated hover:text-white",
      )}
    >
      {on ? "On screens" : "Show"}
    </button>
  );
}

/** The shared switch in the panel's neutral look: light grey when on. */
function MiniSwitch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}): React.ReactElement {
  return (
    <Switch
      size="sm"
      checked={on}
      onCheckedChange={onChange}
      aria-label={label}
      className="data-[state=checked]:bg-slate-300 data-[state=unchecked]:bg-surface-elevated"
    />
  );
}

/** `5` → `05`; timer readouts are padded like ProPresenter's. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `5:00` → `00:05:00`. */
function formatTimerPadded(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const total = Math.abs(Math.trunc(seconds));
  return `${sign}${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** The time of day as a 12-hour field, stored back as 24-hour `HH:MM`. */
function TimeOfDayField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const [hours, minutes] = value.split(":").map((part) => Number(part) || 0);
  const hour12 = hours % 12 || 12;
  const pm = hours >= 12;
  const write = (
    nextHour: number,
    nextMinute: number,
    nextPm: boolean,
  ): void => {
    const h24 = (nextHour % 12) + (nextPm ? 12 : 0);
    onChange(`${pad2(h24)}:${pad2(nextMinute)}`);
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={12}
        value={hour12}
        aria-label="Hour"
        className="input h-9 w-16 px-2 text-center font-mono text-[15px] tabular-nums"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) =>
          write(clampInt(Number(e.target.value) || 12, 1, 12), minutes, pm)
        }
      />
      <span className="text-zinc-500">:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={minutes}
        aria-label="Minute"
        className="input h-9 w-16 px-2 text-center font-mono text-[15px] tabular-nums"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) =>
          write(hour12, clampInt(Number(e.target.value) || 0, 0, 59), pm)
        }
      />
      <select
        className="input h-9 w-[72px] px-2 text-[12px]"
        value={pm ? "PM" : "AM"}
        aria-label="AM or PM"
        onChange={(e) => write(hour12, minutes, e.target.value === "PM")}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

/** One timer, as ProPresenter lists it: name over the readout, reset and play. */
function TimerRow({
  def,
  run,
  onScreens,
  visible,
  expanded,
  canRemove,
  onToggle,
  onChange,
  onRemove,
}: {
  def: ProgramTimerDef;
  run: ProgramTimerState | null;
  onScreens: boolean;
  /** The countdown layer is up on screens. */
  visible: boolean;
  expanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ProgramTimerDef>) => void;
  onRemove: () => void;
}): React.ReactElement {
  const running = run ? timerRunning(run) : false;
  const now = useNow(250, running || def.kind === "countdownTo");
  const current = run ?? idleTimer(def, now);
  const { seconds, timeUp } = timerReadout(current, now, def.overrun);
  const [durationDraft, setDurationDraft] = useState<string | null>(null);
  const started =
    running || (run !== null && run.remainingSec !== run.durationSec);
  // The time-up colour comes from this timer's own readout object.
  const overrunColor = timerReadoutObject(def)?.overrunColor ?? "#f87171";

  // A countdown to a time is worked out when it's reset; let the save land first.
  const resetSoon = (): void => {
    setTimeout(
      () => void window.api.program.timer.reset(def.id).catch(report),
      400,
    );
  };
  const commitDuration = (): void => {
    if (durationDraft === null) return;
    const next = parseDuration(durationDraft);
    setDurationDraft(null);
    if (next === null || next <= 0) return;
    onChange({ durationSec: next });
    if (!running) void window.api.program.timer.set(next, def.id).catch(report);
  };

  return (
    <div
      className={cn(
        "transition-colors",
        expanded ? "bg-surface-secondary" : "hover:bg-surface-tertiary/50",
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-3">
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:text-white"
          aria-expanded={expanded}
          aria-label={expanded ? `Close ${def.name}` : `Edit ${def.name}`}
          onClick={onToggle}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onToggle}
        >
          <span className="block truncate text-[13px] font-semibold text-zinc-100">
            {def.name}
          </span>
          <span
            className={cn(
              "mt-1 flex items-center gap-1.5 font-mono text-[19px] font-medium leading-none tabular-nums",
              running ? "text-white" : "text-zinc-300",
            )}
            style={timeUp ? { color: overrunColor } : undefined}
          >
            <Clock
              size={13}
              aria-hidden="true"
              className="shrink-0 text-zinc-500"
            />
            {def.kind === "countdownTo" && !started ? (
              <span className="font-sans text-[12px] font-normal text-zinc-400">
                Countdown to {formatTimeOfDay(def.targetTime)}
              </span>
            ) : (
              formatTimerPadded(seconds)
            )}
          </span>
        </button>
        <button
          type="button"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md transition-colors",
            onScreens && visible
              ? "bg-teal-500/15 text-teal-300"
              : onScreens
                ? "text-teal-400 hover:bg-surface-tertiary"
                : "text-zinc-500 hover:bg-surface-tertiary hover:text-white",
          )}
          aria-pressed={onScreens && visible}
          aria-label={
            onScreens && visible
              ? `Take ${def.name} off screens`
              : `Show ${def.name} on screens`
          }
          title={
            onScreens && visible
              ? "Take this timer off screens"
              : "Show this timer on screens"
          }
          onClick={() => {
            // Clicking the live one takes it down; any other puts it up.
            if (onScreens && visible) {
              void window.api.program
                .setOnScreens("countdown", false)
                .catch(report);
              return;
            }
            if (!onScreens)
              void window.api.program.timer.show(def.id).catch(report);
            void window.api.program
              .setOnScreens("countdown", true)
              .catch(report);
          }}
        >
          <MonitorPlay size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-surface-tertiary hover:text-white"
          aria-label={`Reset ${def.name}`}
          title="Reset"
          onClick={() =>
            void window.api.program.timer.reset(def.id).catch(report)
          }
        >
          <SkipBack size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md transition-colors",
            running
              ? "bg-surface-tertiary text-white hover:bg-surface-elevated"
              : "text-zinc-300 hover:bg-surface-tertiary hover:text-white",
          )}
          aria-label={running ? `Pause ${def.name}` : `Start ${def.name}`}
          title={running ? "Pause" : "Start"}
          onClick={() =>
            void (
              running
                ? window.api.program.timer.pause(def.id)
                : window.api.program.timer.start(def.id)
            ).catch(report)
          }
        >
          {running ? (
            <Pause size={15} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={15} fill="currentColor" aria-hidden="true" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 px-4 pb-4 pt-1">
          <input
            className="input h-9 w-full px-2.5 text-[13px] font-semibold"
            value={def.name}
            maxLength={80}
            aria-label="Timer name"
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <div className="space-y-2.5 text-[12px]">
            <label className="flex items-center gap-3">
              <span className="w-[52px] shrink-0 text-zinc-400">Type</span>
              <select
                className="input h-9 flex-1 px-2.5 text-[12px]"
                value={def.kind}
                aria-label="Timer type"
                disabled={running}
                onChange={(e) => {
                  onChange({ kind: e.target.value as ProgramTimerDef["kind"] });
                  resetSoon();
                }}
              >
                <option value="countdown">Countdown</option>
                <option value="countdownTo">Countdown to Time</option>
              </select>
            </label>
            {def.kind === "countdown" ? (
              <label className="flex items-center gap-3">
                <span className="w-[52px] shrink-0 text-zinc-400">Time</span>
                <input
                  className="input h-9 flex-1 px-2.5 font-mono text-[15px] tabular-nums"
                  value={durationDraft ?? formatTimerPadded(def.durationSec)}
                  aria-label="Duration, hours:minutes:seconds"
                  placeholder="00:05:00"
                  onFocus={(e) => {
                    setDurationDraft(formatTimerPadded(def.durationSec));
                    e.currentTarget.select();
                  }}
                  onChange={(e) => setDurationDraft(e.target.value)}
                  onBlur={commitDuration}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setDurationDraft(null);
                  }}
                />
              </label>
            ) : (
              <div className="flex items-center gap-3">
                <span className="w-[52px] shrink-0 text-zinc-400">Time</span>
                <TimeOfDayField
                  value={def.targetTime}
                  onChange={(targetTime) => {
                    onChange({ targetTime });
                    if (!running) resetSoon();
                  }}
                />
              </div>
            )}
            <label className="flex items-center gap-2 pl-[64px] text-[12px] text-zinc-300">
              <input
                type="checkbox"
                className="size-4 accent-teal-500"
                checked={def.overrun}
                onChange={(e) => onChange({ overrun: e.target.checked })}
              />
              Allows Overrun
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="flex items-center gap-1 hover:bg-surface-tertiary hover:text-green-400 px-1.5 py-1 text-[11px] rounded-md"
              onClick={() =>
                useAppStore.getState().openProps(`timer:${def.id}`)
              }
            >
              <Pencil size={11} aria-hidden="true" /> Edit
            </button>
            {canRemove && (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-surface-tertiary hover:text-red-400"
                onClick={onRemove}
              >
                <Trash2 size={12} aria-hidden="true" color="red" /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ClockReadout(): React.ReactElement {
  const now = useNow(1000);
  return (
    <span className="font-mono text-[13px] tabular-nums text-zinc-300">
      {formatClock(new Date(now))}
    </span>
  );
}

/** `5:00`, `1:02:03` → seconds; null when it isn't a time. */
function parseDuration(text: string): number | null {
  const parts = text
    .trim()
    .split(":")
    .map((part) => part.trim());
  if (
    parts.length === 0 ||
    parts.length > 3 ||
    parts.some((part) => !/^\d{1,3}$/.test(part))
  )
    return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** `17:00` → `5:00 PM`. */
function formatTimeOfDay(targetTime: string): string {
  const [hours, minutes] = targetTime.split(":").map(Number);
  return formatClock(new Date(2000, 0, 1, hours, minutes));
}

export function TimersPanel(): React.ReactElement {
  const state = useProgramState();
  const [presentation, setPresentation] = useDraftPresentation();
  const [stageDraft, setStageDraft] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timers = presentation.timers;
  const onScreens = screenTimerDef(presentation, state);

  const patchTimer = (id: string, patch: Partial<ProgramTimerDef>): void => {
    setPresentation({
      ...presentation,
      timers: timers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  };
  const addTimer = (): void => {
    if (timers.length >= MAX_PROGRAM_TIMERS) return;
    const id = `timer-${Date.now().toString(36)}`;
    setPresentation({
      ...presentation,
      timers: [
        ...timers,
        {
          ...DEFAULT_TIMER,
          id,
          name: `Timer ${timers.length + 1}`,
          overrun: true,
          theme: defaultTimerTheme(),
        },
      ],
    });
    setExpandedId(id);
  };
  const removeTimer = (id: string): void => {
    if (timers.length <= 1) return;
    const next = timers.filter((t) => t.id !== id);
    setPresentation({ ...presentation, timers: next });
    // The timer on screens was deleted: move screens to the next one.
    if (onScreens.id === id && next[0])
      void window.api.program.timer.show(next[0].id).catch(report);
    if (expandedId === id) setExpandedId(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Timers as ProPresenter lists them: one roomy row each, expand to edit. */}
      <section className="px-3 pt-3">
        <div className="flex h-9 items-center justify-between px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
            Timers
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-40"
              aria-label="New timer"
              title="New timer"
              disabled={timers.length >= MAX_PROGRAM_TIMERS}
              onClick={addTimer}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-surface-border">
          <div className="divide-y divide-surface-border">
            {timers.map((def) => (
              <TimerRow
                key={def.id}
                def={def}
                run={state.timers[def.id] ?? null}
                onScreens={def.id === onScreens.id}
                visible={state.countdownOnScreens}
                expanded={expandedId === def.id}
                canRemove={timers.length > 1}
                onToggle={() =>
                  setExpandedId(expandedId === def.id ? null : def.id)
                }
                onChange={(patch) => patchTimer(def.id, patch)}
                onRemove={() => removeTimer(def.id)}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            useAppStore.getState().openProps(`timer:${onScreens.id}`)
          }
          className="mt-1.5 flex items-center gap-1.5 rounded-md px-1 py-1.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <Layers size={11} aria-hidden="true" /> Edit the timer design
        </button>
      </section>

      <Section
        title="Clock"
        action={
          <OnScreensToggle
            on={state.clockOnScreens}
            label="Clock"
            onChange={(on) =>
              void window.api.program.setOnScreens("clock", on).catch(report)
            }
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
              onClick={() =>
                void window.api.program.setStageMessage(null).catch(report)
              }
            >
              <X size={12} />
            </button>
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!stageDraft.trim()) return;
            void window.api.program
              .setStageMessage(stageDraft)
              .then(() => setStageDraft(""), report);
          }}
        >
          <input
            className="input flex-1 py-1 text-xs"
            placeholder="Wrap up · 2 minutes"
            aria-label="Stage message"
            value={stageDraft}
            onChange={(e) => setStageDraft(e.target.value)}
          />
          <button
            type="submit"
            className="btn-primary flex items-center gap-1 px-3 py-1 text-xs"
            disabled={!stageDraft.trim()}
          >
            <Send size={12} aria-hidden="true" /> Send
          </button>
        </form>
      </Section>
    </div>
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function MessagesPanel(): React.ReactElement {
  const state = useProgramState();
  const [presentation, setPresentation] = useDraftPresentation();
  const [draft, setDraft] = useState("");
  const style = presentation.message;

  const patchStyle = (
    patch: Partial<PresentationSettings["message"]>,
  ): void => {
    setPresentation({ ...presentation, message: { ...style, ...patch } });
  };
  const saved = presentation.messages;
  /** Keeps `text` in the saved list (once), newest first. */
  const remember = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || saved.some((m) => m.text === trimmed)) return;
    const message = {
      id: `msg-${Date.now().toString(36)}`,
      text: trimmed.slice(0, MAX_SAVED_MESSAGE_LENGTH),
    };
    setPresentation({
      ...presentation,
      messages: [message, ...saved].slice(0, MAX_SAVED_MESSAGES),
    });
  };
  const forget = (id: string): void => {
    setPresentation({
      ...presentation,
      messages: saved.filter((m) => m.id !== id),
    });
  };
  const show = (text: string): void => {
    void window.api.program.showMessage(text).catch(report);
  };
  const takeDown = (): void => {
    void window.api.program.clearMessage().catch(report);
  };
  // Showing a new message keeps it for next time, so the list builds itself.
  const sendDraft = (): void => {
    if (!draft.trim()) return;
    remember(draft);
    void window.api.program.showMessage(draft).then(() => setDraft(""), report);
  };
  const saveDraft = (): void => {
    if (!draft.trim()) return;
    remember(draft);
    setDraft("");
  };
  const liveUnsaved =
    state.message && !saved.some((m) => m.text === state.message);

  return (
    <div className="h-full overflow-y-auto">
      {/* Saved messages, one row each, like ProPresenter's Messages list. */}
      <Section
        title="Messages"
        split
        action={<MessageStyleButton style={style} onChange={patchStyle} />}
      >
        {liveUnsaved && (
          <MessageRow text={state.message ?? ""} live onTakeDown={takeDown} />
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
          <p className="py-1 text-center text-[11px] text-zinc-500">
            No saved messages yet. Write one below.
          </p>
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
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendDraft();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1 text-xs"
            disabled={!draft.trim()}
            onClick={saveDraft}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1 px-3 py-1 text-xs"
            disabled={!draft.trim()}
            onClick={sendDraft}
          >
            <Send size={12} aria-hidden="true" /> Show
          </button>
        </div>
      </Section>
    </div>
  );
}

/**
 * How messages look on screen — position, size, colours, ticker — tucked
 * behind a gear by the Messages title: set once, rarely touched mid-service.
 */
function MessageStyleButton({
  style,
  onChange,
}: {
  style: PresentationSettings["message"];
  onChange: (patch: Partial<PresentationSettings["message"]>) => void;
}): React.ReactElement {
  const row =
    "flex items-center justify-between gap-3 py-2.5 text-[12px] text-zinc-300";
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
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" },
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
                  onChange={(e) =>
                    onChange({ fontSizePx: Number(e.target.value) })
                  }
                />
                <span className="w-8 text-right text-[11px] tabular-nums text-zinc-400">
                  {style.fontSizePx}
                </span>
              </span>
            </label>
            <label className={row}>
              Text
              <input
                type="color"
                className="h-5 w-8 cursor-pointer rounded bg-transparent"
                value={hexOr(style.color, "#ffffff")}
                onChange={(e) => onChange({ color: e.target.value })}
              />
            </label>
            <label className={row}>
              Bar
              <input
                type="color"
                className="h-5 w-8 cursor-pointer rounded bg-transparent"
                value={hexOr(style.background, "#000000")}
                onChange={(e) => onChange({ background: e.target.value })}
              />
            </label>
            <label className={row}>
              Scroll as a ticker
              <MiniSwitch
                on={style.scroll}
                label="Scroll as a ticker"
                onChange={(scroll) => onChange({ scroll })}
              />
            </label>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One saved message: its text, and Show — or, while it's up, Take down. */
function MessageRow({
  text,
  live,
  onShow,
  onTakeDown,
  onRemove,
}: {
  text: string;
  live: boolean;
  onShow?: () => void;
  onTakeDown: () => void;
  onRemove?: () => void;
}): React.ReactElement {
  return (
    <div className="group/message flex items-center gap-2">
      {live && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-live"
          title="On screen"
          aria-label="On screen"
        />
      )}
      <p
        className={cn(
          "line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px]",
          live ? "text-white" : "text-zinc-300",
        )}
      >
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
        <button
          type="button"
          className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
          onClick={onTakeDown}
        >
          Take down
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
          onClick={onShow}
        >
          Show
        </button>
      )}
    </div>
  );
}

function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

// ─── Shared by the Props, Video and Audio tabs ────────────────────────────────

type DeviceLabels = Record<
  "videoinput" | "audioinput" | "audiooutput",
  string[]
>;

/** Device labels by kind, from one enumeration, refreshed on hot-plug. */
function useDeviceLabels(): [DeviceLabels, () => void] {
  const [labels, setLabels] = useState<DeviceLabels>({
    videoinput: [],
    audioinput: [],
    audiooutput: [],
  });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          const of = (kind: MediaDeviceKind): string[] => [
            ...new Set(
              devices
                .filter((d) => d.kind === kind && d.label)
                .map((d) => d.label),
            ),
          ];
          setLabels({
            videoinput: of("videoinput"),
            audioinput: of("audioinput"),
            audiooutput: of("audiooutput"),
          });
        })
        .catch(() => undefined);
    };
    load();
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener("devicechange", load);
    };
  }, [generation]);
  return [labels, () => setGeneration((g) => g + 1)];
}

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * The props, as ProPresenter shows them: a grid of thumbnails, click one to
 * put it up or take it down. They're built in the Props editor.
 */
export function PropsPanel(): React.ReactElement {
  const state = useProgramState();
  const [presentation, setPresentation] = useDraftPresentation();
  const props = presentation.props;
  // Thumbnails carry the timer markup and tick it themselves.
  const timerView = propTimerViewFor(state, presentation);
  const openEditor = (select: string | null = null): void =>
    useAppStore.getState().openProps(select);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const deleteProp = (id: string): void => {
    if (state.activePropIds.includes(id))
      void window.api.program.setProp(id, false).catch(report);
    setPresentation({
      ...presentation,
      props: props.filter((p) => p.id !== id),
    });
  };
  const renameProp = (id: string, name: string): void => {
    setRenamingId(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    setPresentation({
      ...presentation,
      props: props.map((p) =>
        p.id === id ? { ...p, name: trimmed.slice(0, 80) } : p,
      ),
    });
  };
  /** A copy just after the original, with fresh ids so the two never share state. */
  const duplicateProp = (prop: ProgramProp): void => {
    const stamp = Date.now().toString(36);
    const copy: ProgramProp = {
      ...prop,
      id: `prop-${stamp}`,
      name: `${prop.name} copy`.slice(0, 80),
      objects: prop.objects.map((o, i) => ({
        ...o,
        id: `${o.kind}-${stamp}-${i}`,
      })),
    };
    const index = props.findIndex((p) => p.id === prop.id);
    setPresentation({
      ...presentation,
      props: [...props.slice(0, index + 1), copy, ...props.slice(index + 1)],
    });
  };

  if (props.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-surface-tertiary text-zinc-400">
          <Layers size={18} aria-hidden="true" />
        </span>
        <p className="text-[13px] font-semibold text-white">No props yet</p>
        <p className="max-w-[17rem] text-[11px] leading-relaxed text-zinc-500">
          A prop sits over the slides — a logo in the corner, a welcome banner,
          a giving card.
        </p>
        <button
          type="button"
          className="btn-primary mt-1 flex items-center gap-1 px-3 py-1.5 text-[12px]"
          onClick={() => openEditor()}
        >
          <Plus size={12} aria-hidden="true" /> Create a prop
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 pb-3 pt-3">
      <div className="flex min-h-7 items-center gap-1 px-1 pb-2">
        <h3 className="min-w-0 flex-1 text-[12px] font-semibold text-zinc-200">
          Props
        </h3>
        {state.activePropIds.length > 1 && (
          <button
            type="button"
            className="mr-1 text-[11px] text-zinc-400 hover:text-white"
            onClick={() => void window.api.program.clearProps().catch(report)}
          >
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
          const on = state.activePropIds.includes(prop.id);
          const empty = prop.objects.length === 0 && !prop.background;
          return (
            <li key={prop.id} className="min-w-0">
              {/* Right-click for what you can do to it, as in ProPresenter. */}
              <RowContextMenu
                items={[
                  {
                    label: on ? "Take down" : "Show",
                    icon: <MonitorPlay size={13} aria-hidden="true" />,
                    onSelect: () =>
                      void window.api.program
                        .setProp(prop.id, !on)
                        .catch(report),
                  },
                  {
                    label: "Edit…",
                    icon: <Pencil size={13} aria-hidden="true" />,
                    onSelect: () => openEditor(prop.id),
                  },
                  {
                    label: "Rename",
                    icon: <Edit2 size={13} aria-hidden="true" />,
                    onSelect: () => setRenamingId(prop.id),
                  },
                  {
                    label: "Duplicate",
                    icon: <Copy size={13} aria-hidden="true" />,
                    onSelect: () => duplicateProp(prop),
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 size={13} aria-hidden="true" />,
                    destructive: true,
                    onSelect: () => deleteProp(prop.id),
                  },
                ]}
              >
                <button
                  type="button"
                  // Never disabled: a disabled button gets no right-click. An empty
                  // prop has nothing to show, so clicking it opens it to edit.
                  className={cn(
                    "group/prop block w-full text-left",
                    empty && !on && "opacity-60",
                  )}
                  aria-pressed={on}
                  title={
                    empty && !on
                      ? "Empty — click to add something"
                      : on
                        ? "Take down"
                        : "Show"
                  }
                  onClick={() =>
                    empty && !on
                      ? openEditor(prop.id)
                      : void window.api.program
                          .setProp(prop.id, !on)
                          .catch(report)
                  }
                >
                  <span
                    className={cn(
                      "block overflow-hidden rounded-md ring-2 transition-shadow",
                      // Red is what's on screen.
                      on
                        ? "ring-live"
                        : "ring-transparent group-hover/prop:ring-surface-border",
                    )}
                  >
                    <PropPreview
                      prop={prop}
                      timer={timerView}
                      className="aspect-video"
                    />
                  </span>
                  {renamingId !== prop.id && (
                    <span
                      className={cn(
                        "mt-1.5 block truncate text-center text-[11px]",
                        on ? "font-semibold text-white" : "text-zinc-300",
                      )}
                    >
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
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Video input ──────────────────────────────────────────────────────────────

/** A video input (camera or capture card), live on the screens behind the words. */
export function VideoPanel(): React.ReactElement {
  const state = useProgramState();
  const [presentation, setPresentation] = useDraftPresentation();
  const [devices, reloadCameras] = useDeviceLabels();
  const { videoinput: cameras, audioinput: mics } = devices;
  const [camera, setCamera] = useState("");
  const [cameraAudio, setCameraAudio] = useState("");
  const liveCameraAudio = state.camera
    ? (state.cameraAudio ?? "")
    : cameraAudio;
  const videoSettings = presentation.video;
  const patchVideo = (patch: Partial<VideoSettings>): void => {
    setPresentation({ ...presentation, video: { ...videoSettings, ...patch } });
  };

  // Video input labels only appear once capture has been allowed once.
  const requestCameraAccess = (): void => {
    void navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        reloadCameras();
      })
      .catch(report);
  };

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Video input">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md",
              state.camera
                ? "bg-tint-live text-live"
                : "bg-surface-tertiary text-zinc-400",
            )}
          >
            <Video size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-zinc-100">
              {state.camera ?? "Nothing on screens"}
            </p>
            <p className="text-[10px] text-zinc-500">
              {state.camera
                ? "Live on every screen"
                : "Choose an input and put it up"}
            </p>
          </div>
          {state.camera && (
            <span
              className="size-2 shrink-0 rounded-full bg-live"
              title="Live on screens"
              aria-label="Live on screens"
            />
          )}
        </div>

        {cameras.length === 0 ? (
          <button
            type="button"
            className="btn-secondary w-full py-1.5 text-xs"
            onClick={requestCameraAccess}
          >
            Allow video access to list inputs
          </button>
        ) : (
          <div className="flex gap-2">
            <select
              className="input h-8 flex-1 py-0 text-xs"
              aria-label="Video input"
              value={camera || state.camera || ""}
              onChange={(e) => {
                const next = e.target.value;
                setCamera(next);
                // Switching while live reopens the stream on the new input.
                if (state.camera && next)
                  void window.api.program
                    .setCamera(next, state.cameraAudio ?? cameraAudio ?? null)
                    .catch(report);
              }}
            >
              <option value="">— choose an input —</option>
              {cameras.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            {state.camera ? (
              <button
                type="button"
                className="rounded-md bg-live px-3 py-1 text-xs font-medium text-white hover:brightness-110"
                onClick={() =>
                  void window.api.program.setCamera(null).catch(report)
                }
              >
                Take off
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary flex items-center gap-1 px-3 py-1 text-xs disabled:opacity-40"
                disabled={!camera}
                onClick={() =>
                  void window.api.program
                    .setCamera(camera, cameraAudio || null)
                    .catch(report)
                }
              >
                <Video size={12} aria-hidden="true" /> Go live
              </button>
            )}
          </div>
        )}
        {cameras.length > 0 && (
          <select
            className="input w-full py-1 text-xs"
            aria-label="Video input sound"
            value={liveCameraAudio}
            onChange={(e) => {
              const next = e.target.value;
              setCameraAudio(next);
              // Changing the sound of a live video input reopens it with the new input.
              if (state.camera)
                void window.api.program
                  .setCamera(state.camera, next || null)
                  .catch(report);
            }}
          >
            <option value="">No sound</option>
            {mics.map((label) => (
              <option key={label} value={label}>
                Sound: {label}
              </option>
            ))}
          </select>
        )}
        {liveCameraAudio && (
          <p className="text-[10px] leading-snug text-zinc-500">
            Plays through the sound output below. Keep the mic away from the
            room speakers to avoid feedback.
          </p>
        )}
      </Section>

      <Section title="Video layout">
        <VideoLayoutCanvas
          value={videoSettings}
          onChange={(patch) => patchVideo(patch)}
          live={!!state.camera}
        />
      </Section>
    </div>
  );
}

// ─── Sound from videos and the video input (shown on the Audio tab) ───────────

/** Whether background videos and the video input play sound, how loud, and where. */
export function ProgramSoundSection(): React.ReactElement {
  const state = useProgramState();
  const [presentation, setPresentation] = useDraftPresentation();
  const [devices] = useDeviceLabels();
  const { audiooutput: speakers } = devices;
  const liveCameraAudio = state.camera ? (state.cameraAudio ?? "") : "";
  const save = (next: PresentationSettings): void => {
    setPresentation(next);
  };

  return (
    <>
      <Section title="Program sound">
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={presentation.audio.enabled}
            onChange={(e) =>
              save({
                ...presentation,
                audio: { ...presentation.audio, enabled: e.target.checked },
              })
            }
          />
          <Volume2 size={12} aria-hidden="true" /> Play sound from background
          videos
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
              onChange={(e) =>
                save({
                  ...presentation,
                  audio: {
                    ...presentation.audio,
                    volume: Number(e.target.value),
                  },
                })
              }
            />
            <select
              className="input w-full py-1 text-xs"
              aria-label="Sound output"
              value={presentation.audio.outputLabel}
              onChange={(e) =>
                save({
                  ...presentation,
                  audio: { ...presentation.audio, outputLabel: e.target.value },
                })
              }
            >
              <option value="">System default output</option>
              {speakers.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <p className="text-[10px] leading-snug text-zinc-500">
              Video and input sound play from the first Kairo screen (else the
              NDI feed) only, so screens never echo each other.
            </p>
          </div>
        )}
      </Section>
    </>
  );
}

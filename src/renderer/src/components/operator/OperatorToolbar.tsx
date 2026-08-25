import { Fragment, useCallback, useEffect, useState } from 'react'
import { Keyboard, ListMusic } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LivePlanState, SermonPlan } from '@shared/ipc'

/** Radix Select rejects an empty item value, so "no playlist" needs a sentinel. */
const NO_LIVE_PLAN = 'none'

const EMPTY_LIVE_PLAN: LivePlanState = {
  planId: null,
  title: null,
  itemCount: 0,
  unavailableCount: 0,
}

const SHORTCUT_LEGEND: Array<[string, string]> = [
  ['Space', 'Send focused verse'],
  ['Esc', 'Dismiss'],
  ['Backspace', 'Clear output'],
  ['Ctrl+F', 'Search'],
  ['Ctrl+A', 'Toggle automation'],
]

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':')
}

/** Sermon plans are named after the imported file, so titles arrive snake_cased. */
export function displayPlanTitle(title: string): string {
  return title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Operator's live controls, rendered into the app shell's single top bar rather
 * than a second row of its own.
 */
export default function OperatorToolbar(): React.ReactElement {
  const { isTranscribing, sessionStartTime, autoModeEnabled, confidenceThreshold, setAutoMode } =
    useAppStore()
  // Both come from the shared snapshot, so returning to Operator never blanks
  // the playlist selector while a fresh read resolves.
  const plans = useBootstrapStore((s) => s.sermonPlans)
  const livePlan = useBootstrapStore((s) => s.livePlan) ?? EMPTY_LIVE_PLAN
  const setLivePlan = useBootstrapStore((s) => s.setLivePlan)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!isTranscribing) {
      setElapsedSeconds(0)
      return
    }
    const tick = (): void => {
      const diff = Math.floor((Date.now() - sessionStartTime) / 1000)
      setElapsedSeconds(diff >= 0 ? diff : 0)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [isTranscribing, sessionStartTime])

  // Playlists edited on the Scripture tab are published to the shared snapshot,
  // so this only needs the live push subscription.
  useEffect(() => window.api.scripture.onLivePlanChange(setLivePlan), [setLivePlan])

  const handleSelectLivePlan = useCallback((value: string): void => {
    window.api.scripture
      .setLivePlan(value === NO_LIVE_PLAN ? null : value)
      .then(setLivePlan)
      .catch(console.error)
  }, [])

  const handleToggleAutoMode = useCallback(
    (next: boolean): void => {
      window.api.scripture
        .setAutoMode(next)
        .then(() => setAutoMode(next, confidenceThreshold))
        .catch(console.error)
    },
    [confidenceThreshold, setAutoMode],
  )

  const hasPlans = plans.length > 0

  return (
    <div className="no-drag flex h-8 min-w-0 items-center gap-2">
      <span
        className={[
          'shrink-0 font-mono text-[11px] tabular-nums',
          isTranscribing ? 'text-teal-300' : 'text-zinc-600',
        ].join(' ')}
        title="Session elapsed time"
      >
        {formatElapsed(elapsedSeconds)}
      </span>

      <Select
        value={livePlan.planId ?? NO_LIVE_PLAN}
        onValueChange={handleSelectLivePlan}
        disabled={!hasPlans}
      >
        {/* `cn` is a plain join, so the trigger's base `w-fit` would win a
            class-vs-class fight — the inline width is what actually pins it. */}
        <SelectTrigger
          style={{ width: 208 }}
          className="h-8 overflow-hidden text-[11px] *:data-[slot=select-value]:min-w-0"
          aria-label="Live reference playlist"
          title={
            hasPlans
              ? 'Verses from this playlist project instantly, without a Bible lookup'
              : 'Import sermon notes on the Scripture tab to create a playlist'
          }
        >
          <ListMusic size={13} className="text-zinc-500" aria-hidden="true" />
          <SelectValue placeholder={hasPlans ? 'No reference playlist' : 'No playlists'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_LIVE_PLAN}>No reference playlist</SelectItem>
          {plans.map((plan) => (
            <SelectItem key={plan.id} value={plan.id}>
              {displayPlanTitle(plan.title)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {livePlan.unavailableCount > 0 && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-400"
          title={`${livePlan.unavailableCount} playlist item(s) have no verse text — they cannot be matched by reading.`}
        />
      )}

      <div
        className="flex h-8 shrink-0 items-center gap-2 border-l border-surface-border/70 pl-3 text-[11px] text-zinc-400"
        title="Press Ctrl+A to toggle"
      >
        <span className="hidden lg:inline">Automation</span>
        <Switch
          checked={autoModeEnabled}
          onCheckedChange={handleToggleAutoMode}
          aria-label="Toggle automation"
        />
      </div>

      <div className="group relative shrink-0">
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard size={14} />
        </button>
        <div className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-max rounded-lg border border-surface-border bg-surface p-2.5 shadow-xl group-hover:block group-focus-within:block">
          <dl className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5 text-[10px]">
            {SHORTCUT_LEGEND.map(([keys, action]) => (
              <Fragment key={keys}>
                <dt className="justify-self-end">
                  <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                    {keys}
                  </kbd>
                </dt>
                <dd className="text-slate-500">{action}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}

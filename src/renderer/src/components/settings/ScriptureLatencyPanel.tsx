import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, RefreshCw } from '@/icons'
import { cn } from '@/lib/utils'
import type { ScriptureLatencyMetrics, ScriptureResolver, TraceStatus } from '@shared/scripture-trace'
import type { ScriptureTraceRecord } from '@shared/ipc'

type Filter = 'all' | 'presented' | 'issues'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'presented', label: 'Presented' },
  { id: 'issues', label: 'Not shown' },
]

/** How the verse was found, in the operator's words. */
const RESOLVER_LABEL: Record<ScriptureResolver, string> = {
  explicit: 'Reference spoken',
  'quotation-local': 'Verse quoted',
  'sermon-plan': 'Sermon plan',
  ai: 'AI match',
}

const STATUS: Record<TraceStatus, { label: string; tone: string }> = {
  active: { label: 'In progress', tone: 'text-[#0A84FF]' },
  presented: { label: 'Presented', tone: 'text-[#30D158]' },
  cancelled: { label: 'Cancelled', tone: 'text-white/40' },
  superseded: { label: 'Replaced', tone: 'text-white/40' },
  failed: { label: 'Failed', tone: 'text-[#FF453A]' },
}

/**
 * The individual steps, in pipeline order. Labels must match the names
 * `slowestStage` uses so the slow step can be highlighted.
 */
const STAGES: { key: keyof ScriptureLatencyMetrics; label: string; deliberate?: boolean }[] = [
  { key: 'detectionMs', label: 'Detection' },
  { key: 'bibleLookupMs', label: 'Bible lookup' },
  { key: 'suggestionPublishMs', label: 'Suggestion publish' },
  { key: 'suggestionRenderMs', label: 'On-screen render' },
  { key: 'countdownMs', label: 'Safety delay', deliberate: true },
  { key: 'presenterRequestMs', label: 'Output request' },
  { key: 'presenterConfirmationMs', label: 'Output confirmation' },
]

function ms(value: number | undefined): string {
  if (value === undefined) return '—'
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** What the operator actually waited for — excludes the safety delay and ProPresenter. */
function headline(record: ScriptureTraceRecord): number | undefined {
  return record.metrics.operatorVisibleMs ?? record.metrics.totalToPresenterRequestMs
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 px-3.5 py-2.5">
      <p className="text-[11px] text-white/40">{label}</p>
      <p className="mt-0.5 font-mono text-[18px] font-medium tabular-nums leading-tight text-white">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-white/30">{hint}</p>
    </div>
  )
}

function TraceRow({ record }: { record: ScriptureTraceRecord }): React.JSX.Element {
  const { trace, metrics } = record
  const [open, setOpen] = useState(false)
  const status = STATUS[trace.status]
  const time = headline(record)
  const stages = STAGES.flatMap((stage) => {
    const value = metrics[stage.key] as number | undefined
    return value === undefined ? [] : [{ ...stage, value }]
  })
  const longest = Math.max(1, ...stages.map((stage) => stage.value))

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-surface-secondary"
      >
        <ChevronRight
          size={11}
          className={cn('shrink-0 text-white/30 transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight text-white">{trace.reference ?? trace.sourceText}</p>
          <p className="mt-0.5 truncate text-[11px] text-white/35">
            {RESOLVER_LABEL[trace.resolver]}
            {' · '}
            <span className={status.tone}>{status.label}</span>
          </p>
        </div>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-white/70">{ms(time)}</span>
      </button>

      {open ? (
        <div className="space-y-1 px-3.5 pb-3 pl-[34px]">
          {stages.length === 0 ? (
            <p className="text-[11px] text-white/35">No timing recorded for this verse.</p>
          ) : (
            stages.map((stage) => {
              const slowest = metrics.slowestStage?.name === stage.label
              return (
                <div key={stage.key} className="grid grid-cols-[124px_minmax(0,1fr)_52px] items-center gap-2.5">
                  <span className={cn('truncate text-[11px]', slowest ? 'text-amber-400' : 'text-white/45')}>
                    {stage.label}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        stage.deliberate ? 'bg-surface-border' : slowest ? 'bg-amber-400' : 'bg-[#0A84FF]',
                      )}
                      style={{ width: `${Math.max(2, (stage.value / longest) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      'text-right font-mono text-[11px] tabular-nums',
                      slowest ? 'text-amber-400' : 'text-white/60',
                    )}
                  >
                    {ms(stage.value)}
                  </span>
                </div>
              )
            })
          )}
          {trace.failureReason ? (
            <p className="pt-1 text-[11px] text-[#FF453A]">{trace.failureReason}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Where the milliseconds went.
 *
 * Lives in Settings rather than the Operator view: it is for working out why a
 * verse was slow after the fact, not something anyone should be reading during
 * a service.
 */
export function ScriptureLatencyPanel(): React.JSX.Element {
  const [records, setRecords] = useState<ScriptureTraceRecord[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      setRecords(await window.api.scripture.recentTraces(100))
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = records.filter((r) =>
    filter === 'all'
      ? true
      : filter === 'presented'
        ? r.trace.status === 'presented'
        : r.trace.status === 'cancelled' || r.trace.status === 'failed' || r.trace.status === 'superseded',
  )
  const times = records.flatMap((r) => {
    const value = headline(r)
    return value === undefined ? [] : [value]
  })
  const presented = records.filter((r) => r.trace.status === 'presented').length

  return (
    <div>
      <div className="flex divide-x divide-white/[0.07] border-b border-white/[0.07]">
        <Stat label="Typical" value={ms(percentile(times, 50))} hint="Half of verses were faster" />
        <Stat label="Slow" value={ms(percentile(times, 95))} hint="Only 1 in 20 was slower" />
        <Stat label="Presented" value={String(presented)} hint={`of ${records.length} detected`} />
      </div>

      <div className="flex items-center justify-between gap-3 px-3.5 py-2">
        <div className="flex items-center gap-0.5 rounded-md bg-surface-tertiary p-0.5" role="radiogroup" aria-label="Filter verses">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={cn(
                'rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                filter === option.id ? 'bg-surface-border text-white' : 'text-white/45 hover:text-white/75',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="grid h-6 w-6 place-items-center rounded-md text-white/35 hover:bg-surface-tertiary hover:text-white"
          aria-label="Refresh timings"
          title="Refresh"
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        <p className="px-3.5 pb-4 pt-2 text-[12px] text-white/35">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="px-3.5 pb-4 pt-2 text-[12px] text-white/35">
          {records.length === 0
            ? 'No verses detected yet this session. Timings appear here once auto-detection finds one.'
            : 'Nothing matches this filter.'}
        </p>
      ) : (
        <ul className="max-h-[320px] divide-y divide-white/[0.05] overflow-y-auto border-t border-white/[0.07]">
          {visible.map((record) => (
            <TraceRow key={record.trace.correlationId} record={record} />
          ))}
        </ul>
      )}
    </div>
  )
}

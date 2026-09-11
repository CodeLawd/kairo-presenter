import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  summarizeByResolver,
  type ScriptureLatencyMetrics,
  type ScriptureLatencyTrace,
  type TraceStatus,
} from '@shared/scripture-trace'
import type { ScriptureTraceRecord } from '@shared/ipc'

type Filter = 'all' | TraceStatus

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'presented', label: 'Presented' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'superseded', label: 'Superseded' },
  { id: 'failed', label: 'Failed' },
]

const STATUS_TONE: Record<TraceStatus, string> = {
  active: 'text-sky-400',
  presented: 'text-emerald-400',
  cancelled: 'text-white/40',
  superseded: 'text-white/40',
  failed: 'text-amber-400',
}

/** Stages in pipeline order, with the label the operator should read. */
const STAGE_ROWS: { key: keyof ScriptureLatencyMetrics; label: string }[] = [
  { key: 'detectionMs', label: 'Detection' },
  { key: 'bibleLookupMs', label: 'Bible lookup' },
  { key: 'suggestionPublishMs', label: 'Suggestion publish' },
  { key: 'suggestionRenderMs', label: 'On-screen render' },
  { key: 'operatorVisibleMs', label: 'Visible in Kairo' },
  { key: 'preparationMs', label: 'Preparation total' },
  { key: 'countdownMs', label: 'Safety delay' },
  { key: 'presenterRequestMs', label: 'ProPresenter request' },
  { key: 'presenterConfirmationMs', label: 'Output confirmation' },
]

function ms(value: number | undefined): string {
  if (value === undefined) return '—'
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${Math.round(value)}ms`
}

function TraceRow({ record }: { record: ScriptureTraceRecord }): React.JSX.Element {
  const { trace, metrics } = record
  const [open, setOpen] = useState(false)
  // What the operator actually waited for, in preference to anything that
  // includes the deliberate safety delay or ProPresenter.
  const headline = metrics.operatorVisibleMs ?? metrics.totalToPresenterRequestMs

  return (
    <div className="border-b border-white/[0.05] last:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-baseline gap-3 px-1 py-2 text-left hover:bg-white/[0.03]"
      >
        <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">
          {trace.reference ?? trace.sourceText}
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/30">
          {trace.resolver} · {trace.transcriptSource}
        </span>
        <span className={cn('shrink-0 font-mono text-[11px] tabular-nums', STATUS_TONE[trace.status])}>
          {headline !== undefined ? ms(headline) : trace.status}
        </span>
      </button>

      {open ? (
        <div className="px-1 pb-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {STAGE_ROWS.map((row) => {
              const value = metrics[row.key] as number | undefined
              if (value === undefined) return null
              const slowest = metrics.slowestStage?.name === row.label
              return (
                <div key={row.key} className="flex items-baseline justify-between gap-3">
                  <dt className={cn('text-[11px]', slowest ? 'text-amber-400' : 'text-white/45')}>
                    {row.label}
                  </dt>
                  <dd
                    className={cn(
                      'font-mono text-[11px] tabular-nums',
                      slowest ? 'text-amber-400' : 'text-white/70',
                    )}
                  >
                    {ms(value)}
                  </dd>
                </div>
              )
            })}
          </dl>
          {/* Saying "accepted" when we only know the request returned 200 is the
              difference between a useful diagnostic and a misleading one. */}
          <p className="mt-2 text-[10px] text-white/30">
            {trace.confirmation === 'request-accepted'
              ? 'ProPresenter accepted the request. Visible output not independently confirmed.'
              : trace.confirmation
                ? `Confirmed: ${trace.confirmation}`
                : 'No output confirmation recorded.'}
            {trace.failureReason ? ` · ${trace.failureReason}` : ''}
          </p>
        </div>
      ) : null}
    </div>
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

  const visible = records.filter((r) => filter === 'all' || r.trace.status === filter)
  const summaries = summarizeByResolver(
    records.map((r) => r.trace as ScriptureLatencyTrace),
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] transition-colors',
                filter === option.id
                  ? 'bg-white/[0.12] text-white'
                  : 'text-white/40 hover:bg-white/[0.05] hover:text-white/70',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md px-2 py-1 text-[11px] text-white/40 hover:bg-white/[0.05] hover:text-white/70"
        >
          Refresh
        </button>
      </div>

      {summaries.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
          {summaries.map((summary) => (
            <div key={summary.resolver}>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                {summary.resolver} · {summary.presented} presented
                {summary.cancelled > 0 ? ` · ${summary.cancelled} cancelled` : ''}
                {summary.failed > 0 ? ` · ${summary.failed} failed` : ''}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5">
                {(['operatorVisibleMs', 'preparationMs', 'presenterRequestMs'] as const).map(
                  (key) => {
                    const stage = summary.stages[key]
                    if (!stage) return null
                    const label =
                      key === 'operatorVisibleMs'
                        ? 'Visible in Kairo'
                        : key === 'preparationMs'
                          ? 'Preparation'
                          : 'PP request'
                    return (
                      <span key={key} className="text-[11px] text-white/50">
                        {label}{' '}
                        <span className="font-mono tabular-nums text-white/75">
                          p50 {ms(stage.p50)} · p95 {ms(stage.p95)}
                        </span>
                      </span>
                    )
                  },
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2">
        {loading ? (
          <p className="px-1 py-6 text-center text-[12px] text-white/35">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] text-white/35">
            {records.length === 0
              ? 'No scripture has been detected yet this session.'
              : 'Nothing matches this filter.'}
          </p>
        ) : (
          visible.map((record) => <TraceRow key={record.trace.correlationId} record={record} />)
        )}
      </div>
    </div>
  )
}

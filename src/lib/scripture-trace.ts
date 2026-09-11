/**
 * Latency tracing for one detected scripture, from transcript to congregation.
 *
 * ## Clocks
 *
 * Every timestamp here is `Date.now()` — wall clock, milliseconds.
 *
 * That is deliberate and it is the one rule not to break. A trace spans the
 * renderer and the main process, and in Electron each process gets its own
 * `performance.now()` time origin: subtracting one process's reading from
 * another's produces a number that looks plausible and means nothing. Wall
 * clock is comparable everywhere, and at the tens-of-milliseconds resolution
 * this pipeline cares about, its lower precision does not matter.
 *
 * If a single stage ever needs sub-millisecond accuracy, measure it with
 * `performance.now()` *inside one process* and record the resulting duration —
 * never the raw reading.
 */

/** How the reference was arrived at. Ordered loosely by how much we trust it. */
export type ScriptureResolver = 'explicit' | 'quotation-local' | 'sermon-plan' | 'ai'

export type TranscriptSource = 'interim' | 'final'

export type TraceStatus =
  /** Still moving through the pipeline. */
  | 'active'
  /** Reached ProPresenter. */
  | 'presented'
  /** The operator stopped it — correct behaviour, not a failure. */
  | 'cancelled'
  /** A better result replaced it before it could present. */
  | 'superseded'
  | 'failed'

/** Why a trace ended badly. Kept separate from the message so it can be counted. */
export type TraceFailureReason =
  | 'reference-not-resolved'
  | 'verse-not-found'
  | 'translation-unavailable'
  | 'presenter-disconnected'
  | 'presenter-timeout'
  | 'presenter-rejected'
  | 'confirmation-timeout'
  | 'unknown'

/**
 * How sure we are that the verse actually reached the congregation.
 *
 * A 200 from ProPresenter means the request was accepted, which is not the same
 * as pixels changing on a screen. Recording which of these we achieved keeps
 * diagnostics from overstating what we know.
 */
export type ConfirmationLevel =
  | 'visible-state'
  | 'active-document'
  | 'content-match'
  | 'request-accepted'
  | 'none'

/** Every point on the path. Named for the field each one sets. */
export type ScriptureTraceStage =
  | 'detectionStartedAt'
  | 'citationRecognizedAt'
  | 'bibleLookupStartedAt'
  | 'bibleLookupCompletedAt'
  | 'suggestionPublishedAt'
  | 'suggestionRenderedAt'
  | 'countdownStartedAt'
  | 'countdownCompletedAt'
  | 'presenterRequestStartedAt'
  | 'presenterRequestCompletedAt'
  | 'presenterStateCheckStartedAt'
  | 'presenterStateConfirmedAt'

export interface ScriptureLatencyTrace {
  correlationId: string
  reference?: string
  sourceText: string
  transcriptSource: TranscriptSource
  resolver: ScriptureResolver
  status: TraceStatus

  /** When Kairo received the transcript — not when the microphone heard it. */
  sttReceivedAt: number

  detectionStartedAt?: number
  citationRecognizedAt?: number
  bibleLookupStartedAt?: number
  bibleLookupCompletedAt?: number
  suggestionPublishedAt?: number
  /**
   * When the suggestion was actually painted in Kairo's own window.
   *
   * Stamped in the renderer after the browser has composited the frame, so it
   * includes the IPC hop and React's commit — the part of the wait an operator
   * experiences before ProPresenter is involved at all.
   */
  suggestionRenderedAt?: number
  countdownStartedAt?: number
  countdownCompletedAt?: number
  presenterRequestStartedAt?: number
  presenterRequestCompletedAt?: number
  presenterStateCheckStartedAt?: number
  presenterStateConfirmedAt?: number

  confirmation?: ConfirmationLevel
  failureReason?: TraceFailureReason
  error?: string
  supersededBy?: string
}

export interface ScriptureLatencyMetrics {
  detectionMs?: number
  bibleLookupMs?: number
  suggestionPublishMs?: number
  /** Main process publish → painted in Kairo's window. The IPC and React hop. */
  suggestionRenderMs?: number
  /**
   * Transcript received → the operator can see the verse on Kairo's screen.
   *
   * The headline number for the operator's own experience: it owes nothing to
   * the safety delay or to ProPresenter.
   */
  operatorVisibleMs?: number
  /** Everything Kairo did before the deliberate delay started. */
  preparationMs?: number
  countdownMs?: number
  presenterRequestMs?: number
  presenterConfirmationMs?: number
  /** Transcript to confirmed on screen. Only when confirmation was achieved. */
  totalMs?: number
  /** Transcript to request accepted. Always available once presented. */
  totalToPresenterRequestMs?: number
  slowestStage?: { name: string; durationMs: number }
}

export interface TraceStartInput {
  correlationId: string
  sourceText: string
  transcriptSource: TranscriptSource
  resolver: ScriptureResolver
  reference?: string
  /** Carried from the transcript that produced this hit. */
  sttReceivedAt: number
  detectionStartedAt?: number
  citationRecognizedAt?: number
}

function since(from: number | undefined, to: number | undefined): number | undefined {
  if (from === undefined || to === undefined) return undefined
  const delta = to - from
  return delta >= 0 ? delta : undefined
}

/**
 * Durations are derived, never stored.
 *
 * Storing both timestamps and durations means two sources of truth that drift
 * the first time a stage moves.
 */
export function deriveMetrics(trace: ScriptureLatencyTrace): ScriptureLatencyMetrics {
  const detectionMs = since(trace.sttReceivedAt, trace.citationRecognizedAt)
  const bibleLookupMs = since(trace.bibleLookupStartedAt, trace.bibleLookupCompletedAt)
  const suggestionPublishMs = since(trace.bibleLookupCompletedAt, trace.suggestionPublishedAt)
  const suggestionRenderMs = since(trace.suggestionPublishedAt, trace.suggestionRenderedAt)
  const operatorVisibleMs = since(trace.sttReceivedAt, trace.suggestionRenderedAt)
  const preparationMs = since(trace.sttReceivedAt, trace.countdownStartedAt)
  const countdownMs = since(trace.countdownStartedAt, trace.countdownCompletedAt)
  const presenterRequestMs = since(
    trace.presenterRequestStartedAt,
    trace.presenterRequestCompletedAt,
  )
  const presenterConfirmationMs = since(
    trace.presenterStateCheckStartedAt,
    trace.presenterStateConfirmedAt,
  )

  const metrics: ScriptureLatencyMetrics = {
    detectionMs,
    bibleLookupMs,
    suggestionPublishMs,
    suggestionRenderMs,
    operatorVisibleMs,
    preparationMs,
    countdownMs,
    presenterRequestMs,
    presenterConfirmationMs,
    totalMs: since(trace.sttReceivedAt, trace.presenterStateConfirmedAt),
    totalToPresenterRequestMs: since(
      trace.sttReceivedAt,
      trace.presenterRequestCompletedAt,
    ),
  }

  // The countdown is almost always the largest number and is deliberate, so
  // naming it "slowest" every time would bury whatever actually went wrong.
  const candidates: [string, number | undefined][] = [
    ['Detection', detectionMs],
    ['Bible lookup', bibleLookupMs],
    ['Suggestion publish', suggestionPublishMs],
    ['On-screen render', suggestionRenderMs],
    ['ProPresenter request', presenterRequestMs],
    ['Output confirmation', presenterConfirmationMs],
  ]
  let slowest: { name: string; durationMs: number } | undefined
  for (const [name, durationMs] of candidates) {
    if (durationMs === undefined) continue
    if (!slowest || durationMs > slowest.durationMs) slowest = { name, durationMs }
  }
  if (slowest) metrics.slowestStage = slowest

  return metrics
}

/** Stages that have been recorded, in the order they happened. */
export function recordedStages(
  trace: ScriptureLatencyTrace,
): { stage: ScriptureTraceStage; at: number }[] {
  const stages: ScriptureTraceStage[] = [
    'detectionStartedAt',
    'citationRecognizedAt',
    'bibleLookupStartedAt',
    'bibleLookupCompletedAt',
    'suggestionPublishedAt',
    'suggestionRenderedAt',
    'countdownStartedAt',
    'countdownCompletedAt',
    'presenterRequestStartedAt',
    'presenterRequestCompletedAt',
    'presenterStateCheckStartedAt',
    'presenterStateConfirmedAt',
  ]
  return stages
    .map((stage) => ({ stage, at: trace[stage] }))
    .filter((entry): entry is { stage: ScriptureTraceStage; at: number } => entry.at !== undefined)
}

/** A trace stops advancing once it has ended. */
export function isTerminal(status: TraceStatus): boolean {
  return status !== 'active'
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface StageSummary {
  count: number
  p50: number
  p95: number
  max: number
}

export interface ResolverSummary {
  resolver: ScriptureResolver
  presented: number
  cancelled: number
  superseded: number
  failed: number
  /** Keyed by the metric name, e.g. `detectionMs`. Absent when never recorded. */
  stages: Partial<Record<keyof ScriptureLatencyMetrics, StageSummary>>
}

/** Nearest-rank percentile. Exact for the small samples one service produces. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil(fraction * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

const SUMMARISED_STAGES = [
  'detectionMs',
  'bibleLookupMs',
  'suggestionPublishMs',
  'suggestionRenderMs',
  'operatorVisibleMs',
  'preparationMs',
  'presenterRequestMs',
  'presenterConfirmationMs',
  'totalToPresenterRequestMs',
] as const satisfies readonly (keyof ScriptureLatencyMetrics)[]

/**
 * Roll traces up per resolver.
 *
 * Only `presented` traces contribute timings. A cancelled suggestion is the
 * operator doing their job and a superseded one never had a chance to finish —
 * counting either as slow would make the numbers describe something nobody
 * experienced.
 */
export function summarizeByResolver(
  traces: readonly ScriptureLatencyTrace[],
): ResolverSummary[] {
  const byResolver = new Map<ScriptureResolver, ScriptureLatencyTrace[]>()
  for (const trace of traces) {
    const bucket = byResolver.get(trace.resolver)
    if (bucket) bucket.push(trace)
    else byResolver.set(trace.resolver, [trace])
  }

  const summaries: ResolverSummary[] = []
  for (const [resolver, bucket] of byResolver) {
    const summary: ResolverSummary = {
      resolver,
      presented: bucket.filter((t) => t.status === 'presented').length,
      cancelled: bucket.filter((t) => t.status === 'cancelled').length,
      superseded: bucket.filter((t) => t.status === 'superseded').length,
      failed: bucket.filter((t) => t.status === 'failed').length,
      stages: {},
    }

    // A cancelled suggestion was still shown to the operator, and how fast it
    // appeared is exactly what we are measuring — so on-screen timings come
    // from every trace that reached the screen, not only presented ones.
    const timed = bucket
      .filter((t) => t.status === 'presented' || t.suggestionRenderedAt !== undefined)
      .map(deriveMetrics)
    for (const stage of SUMMARISED_STAGES) {
      const values = timed
        .map((m) => m[stage])
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => a - b)
      if (values.length === 0) continue
      summary.stages[stage] = {
        count: values.length,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        max: values[values.length - 1],
      }
    }
    summaries.push(summary)
  }
  return summaries.sort((a, b) => b.presented - a.presented)
}

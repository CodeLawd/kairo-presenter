import {
  deriveMetrics,
  isTerminal,
  type ConfirmationLevel,
  type ScriptureLatencyMetrics,
  type ScriptureLatencyTrace,
  type ScriptureTraceStage,
  type TraceFailureReason,
  type TraceStartInput,
  type TraceStatus,
} from './scripture-trace'

/**
 * A service runs for hours and a busy preacher cites constantly. Traces are for
 * looking at what just happened, not for keeping a permanent record, so the
 * buffer is small and fixed.
 */
export const MAX_RECENT_TRACES = 500

export interface CompleteInput {
  status: TraceStatus
  /** How sure we are it reached the congregation. Defaults to nothing claimed. */
  confirmation?: ConfirmationLevel
  failureReason?: TraceFailureReason
  error?: string
  supersededBy?: string
}

/**
 * Holds recent scripture traces.
 *
 * Deliberately has no timers, no IPC and no logging — it is a data structure,
 * so it can be tested without booting anything. The main-process wrapper is
 * what knows about broadcasting and log lines.
 */
export class ScriptureTraceStore {
  private readonly traces = new Map<string, ScriptureLatencyTrace>()
  /** Insertion order, oldest first — Map preserves it, but this is explicit. */
  private readonly order: string[] = []

  constructor(private readonly limit: number = MAX_RECENT_TRACES) {}

  start(input: TraceStartInput): ScriptureLatencyTrace {
    const trace: ScriptureLatencyTrace = {
      correlationId: input.correlationId,
      reference: input.reference,
      sourceText: input.sourceText,
      transcriptSource: input.transcriptSource,
      resolver: input.resolver,
      translation: input.translation,
      autoPresentDelayMs: input.autoPresentDelayMs,
      presenterConnectionMode: input.presenterConnectionMode,
      status: 'active',
      sttReceivedAt: input.sttReceivedAt,
      detectionStartedAt: input.detectionStartedAt,
      citationRecognizedAt: input.citationRecognizedAt,
    }
    this.traces.set(trace.correlationId, trace)
    this.order.push(trace.correlationId)
    this.evict()
    return trace
  }

  annotate(
    correlationId: string,
    fields: Partial<Pick<ScriptureLatencyTrace,
      'translation' | 'autoPresentDelayMs' | 'presenterConnectionMode' | 'presenterOutputMode'>>,
  ): void {
    const trace = this.traces.get(correlationId)
    if (!trace) return
    Object.assign(trace, fields)
  }

  /**
   * Record that a stage happened.
   *
   * Ignored once the trace has ended: a cancelled suggestion whose in-flight
   * ProPresenter call later returns must not look like it presented.
   */
  mark(correlationId: string, stage: ScriptureTraceStage, at: number = Date.now()): void {
    const trace = this.traces.get(correlationId)
    if (!trace) return
    const lateRendererPaint = stage === 'suggestionRenderedAt' && trace.status === 'presented'
    if (isTerminal(trace.status) && !lateRendererPaint) return
    if (trace[stage] === undefined) trace[stage] = at
  }

  complete(correlationId: string, input: CompleteInput | TraceStatus): void {
    const trace = this.traces.get(correlationId)
    if (!trace || isTerminal(trace.status)) return
    const next = typeof input === 'string' ? { status: input } : input
    trace.status = next.status
    if (next.confirmation) trace.confirmation = next.confirmation
    if (next.failureReason) trace.failureReason = next.failureReason
    if (next.error) trace.error = next.error
    if (next.supersededBy) trace.supersededBy = next.supersededBy
  }

  get(correlationId: string): ScriptureLatencyTrace | undefined {
    return this.traces.get(correlationId)
  }

  /** Newest first — what a diagnostics panel wants. */
  getRecent(limit = 50): ScriptureLatencyTrace[] {
    const out: ScriptureLatencyTrace[] = []
    for (let index = this.order.length - 1; index >= 0 && out.length < limit; index -= 1) {
      const trace = this.traces.get(this.order[index])
      if (trace) out.push(trace)
    }
    return out
  }

  metrics(correlationId: string): ScriptureLatencyMetrics | undefined {
    const trace = this.traces.get(correlationId)
    return trace ? deriveMetrics(trace) : undefined
  }

  get size(): number {
    return this.traces.size
  }

  clear(): void {
    this.traces.clear()
    this.order.length = 0
  }

  private evict(): void {
    while (this.order.length > this.limit) {
      const oldest = this.order.shift()
      if (oldest !== undefined) this.traces.delete(oldest)
    }
  }
}

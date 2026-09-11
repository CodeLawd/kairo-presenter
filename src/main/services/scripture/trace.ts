import { randomUUID } from 'node:crypto'
import log from 'electron-log/main'
import {
  deriveMetrics,
  type ScriptureLatencyTrace,
  type ScriptureResolver,
  type ScriptureTraceStage,
  type TranscriptSource,
} from '@shared/scripture-trace'
import {
  ScriptureTraceStore,
  type CompleteInput,
} from '@shared/scripture-trace-store'

/**
 * The main process's view of scripture latency.
 *
 * Thin on purpose: `ScriptureTraceStore` holds the data and does the arithmetic,
 * and this adds the two things a service needs and a data structure should not
 * have — id generation and structured logging.
 */
class ScriptureTraceService {
  private readonly store = new ScriptureTraceStore()

  /**
   * Begin tracing a reference that was actually recognized.
   *
   * Deliberately called on a hit, never per transcript: interim segments arrive
   * several times a second and almost none of them contain a citation, so a
   * trace per segment would be mostly noise and would evict the real ones.
   */
  start(input: {
    reference: string
    sourceText: string
    resolver: ScriptureResolver
    transcriptSource?: TranscriptSource
    sttReceivedAt?: number
    detectionStartedAt?: number
    translation?: string
    autoPresentDelayMs?: number
  }): string {
    const correlationId = randomUUID()
    const now = Date.now()
    this.store.start({
      correlationId,
      reference: input.reference,
      sourceText: input.sourceText,
      resolver: input.resolver,
      transcriptSource: input.transcriptSource ?? 'final',
      // A reference built without a transcript behind it (recovery, tests)
      // starts its clock now rather than pretending to a time it never had.
      sttReceivedAt: input.sttReceivedAt ?? now,
      detectionStartedAt: input.detectionStartedAt,
      translation: input.translation,
      autoPresentDelayMs: input.autoPresentDelayMs,
      citationRecognizedAt: now,
    })
    this.event('scripture.detected', correlationId, {
      reference: input.reference,
      resolver: input.resolver,
    })
    return correlationId
  }

  annotate(
    correlationId: string | undefined,
    fields: Parameters<ScriptureTraceStore['annotate']>[1],
  ): void {
    if (correlationId) this.store.annotate(correlationId, fields)
  }

  mark(correlationId: string | undefined, stage: ScriptureTraceStage): void {
    if (!correlationId) return
    this.store.mark(correlationId, stage)
    const eventNames: Partial<Record<ScriptureTraceStage, string>> = {
      bibleLookupStartedAt: 'scripture.lookup.started',
      bibleLookupCompletedAt: 'scripture.lookup.completed',
      suggestionPublishedAt: 'scripture.suggestion.published',
      suggestionRenderedAt: 'scripture.suggestion.rendered',
      countdownStartedAt: 'scripture.countdown.started',
      countdownCompletedAt: 'scripture.countdown.completed',
      presenterRequestStartedAt: 'scripture.presenter.started',
      presenterRequestCompletedAt: 'scripture.presenter.completed',
      presenterStateCheckStartedAt: 'scripture.presenter.confirmation-started',
      presenterStateConfirmedAt: 'scripture.presenter.confirmed',
    }
    const eventName = eventNames[stage]
    if (eventName) this.event(eventName, correlationId, {})
  }

  complete(correlationId: string | undefined, input: CompleteInput): void {
    if (!correlationId) return
    this.store.complete(correlationId, input)
    const trace = this.store.get(correlationId)
    if (!trace) return
    const metrics = deriveMetrics(trace)
    this.event(`scripture.${input.status}`, correlationId, {
      reference: trace.reference,
      resolver: trace.resolver,
      totalMs: metrics.totalMs ?? metrics.totalToPresenterRequestMs,
      preparationMs: metrics.preparationMs,
      slowestStage: metrics.slowestStage?.name,
      failureReason: trace.failureReason,
    })
  }

  get(correlationId: string): ScriptureLatencyTrace | undefined {
    return this.store.get(correlationId)
  }

  recent(limit?: number): ScriptureLatencyTrace[] {
    return this.store.getRecent(limit)
  }

  /** Trace plus derived metrics, which is what a diagnostics view wants. */
  recentWithMetrics(
    limit?: number,
  ): { trace: ScriptureLatencyTrace; metrics: ReturnType<typeof deriveMetrics> }[] {
    return this.store.getRecent(limit).map((trace) => ({ trace, metrics: deriveMetrics(trace) }))
  }

  /** Structured, so these can be grepped and counted rather than read. */
  private event(name: string, correlationId: string, fields: Record<string, unknown>): void {
    const payload: Record<string, unknown> = { event: name, correlationId }
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) payload[key] = value
    }
    log.info(JSON.stringify(payload))
  }
}

export const scriptureTrace = new ScriptureTraceService()

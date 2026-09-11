import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveMetrics,
  isTerminal,
  percentile,
  recordedStages,
  summarizeByResolver,
  type ScriptureLatencyTrace,
} from '../src/lib/scripture-trace'
import { ScriptureTraceStore } from '../src/lib/scripture-trace-store'

const T0 = 1_700_000_000_000

function trace(overrides: Partial<ScriptureLatencyTrace> = {}): ScriptureLatencyTrace {
  return {
    correlationId: 'c1',
    reference: 'Psalm 119:9',
    sourceText: 'turn with me to psalm one nineteen verse nine',
    transcriptSource: 'interim',
    resolver: 'explicit',
    status: 'active',
    sttReceivedAt: T0,
    ...overrides,
  }
}

/** A full, realistic journey: 3ms detect, 17ms lookup, 1s delay, 182ms present. */
function presented(): ScriptureLatencyTrace {
  return trace({
    status: 'presented',
    detectionStartedAt: T0,
    citationRecognizedAt: T0 + 3,
    bibleLookupStartedAt: T0 + 4,
    bibleLookupCompletedAt: T0 + 21,
    suggestionPublishedAt: T0 + 29,
    countdownStartedAt: T0 + 31,
    countdownCompletedAt: T0 + 1_032,
    presenterRequestStartedAt: T0 + 1_033,
    presenterRequestCompletedAt: T0 + 1_215,
    presenterStateCheckStartedAt: T0 + 1_216,
    presenterStateConfirmedAt: T0 + 1_297,
    confirmation: 'visible-state',
  })
}

describe('deriveMetrics', () => {
  test('derives each stage from its timestamps', () => {
    const m = deriveMetrics(presented())
    assert.equal(m.detectionMs, 3)
    assert.equal(m.bibleLookupMs, 17)
    assert.equal(m.suggestionPublishMs, 8)
    assert.equal(m.preparationMs, 31, 'everything before the deliberate delay')
    assert.equal(m.countdownMs, 1_001)
    assert.equal(m.presenterRequestMs, 182)
    assert.equal(m.presenterConfirmationMs, 81)
    assert.equal(m.totalMs, 1_297)
  })

  test('separates confirmed-visible from request-accepted totals', () => {
    // These answer different questions and must never be conflated.
    const t = presented()
    delete t.presenterStateConfirmedAt
    const m = deriveMetrics(t)
    assert.equal(m.totalMs, undefined, 'no confirmation means no end-to-end number')
    assert.equal(m.totalToPresenterRequestMs, 1_215)
  })

  test('excludes the deliberate countdown from the slowest stage', () => {
    // The countdown is the biggest number nearly every time and is a setting,
    // not a problem — reporting it as "slowest" would bury the real answer.
    const m = deriveMetrics(presented())
    assert.equal(m.slowestStage?.name, 'ProPresenter request')
    assert.equal(m.slowestStage?.durationMs, 182)
  })

  test('omits stages that never happened rather than reporting zero', () => {
    const m = deriveMetrics(trace({ citationRecognizedAt: T0 + 5 }))
    assert.equal(m.detectionMs, 5)
    assert.equal(m.bibleLookupMs, undefined)
    assert.equal(m.countdownMs, undefined)
    assert.equal(m.totalMs, undefined)
  })

  test('refuses to report a negative duration from clock skew', () => {
    const m = deriveMetrics(trace({ citationRecognizedAt: T0 - 40 }))
    assert.equal(m.detectionMs, undefined)
  })

  test('lists recorded stages in order', () => {
    const stages = recordedStages(presented()).map((entry) => entry.stage)
    assert.deepEqual(stages.slice(0, 3), [
      'detectionStartedAt',
      'citationRecognizedAt',
      'bibleLookupStartedAt',
    ])
    const times = recordedStages(presented()).map((entry) => entry.at)
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'timestamps are monotonic')
  })
})

describe('ScriptureTraceStore', () => {
  const start = (store: ScriptureTraceStore, id: string): void => {
    store.start({
      correlationId: id,
      sourceText: 'psalm one nineteen nine',
      transcriptSource: 'interim',
      resolver: 'explicit',
      sttReceivedAt: T0,
    })
  }

  test('records stages and derives metrics for a live trace', () => {
    const store = new ScriptureTraceStore()
    start(store, 'a')
    store.mark('a', 'citationRecognizedAt', T0 + 4)
    store.mark('a', 'bibleLookupStartedAt', T0 + 5)
    store.mark('a', 'bibleLookupCompletedAt', T0 + 19)
    assert.equal(store.metrics('a')?.detectionMs, 4)
    assert.equal(store.metrics('a')?.bibleLookupMs, 14)
  })

  test('attaches runtime configuration without changing stage timestamps', () => {
    const store = new ScriptureTraceStore()
    start(store, 'metadata')
    store.annotate('metadata', {
      translation: 'KJV',
      autoPresentDelayMs: 1000,
      presenterConnectionMode: 'connected',
      presenterOutputMode: 'library',
    })
    assert.deepEqual(
      {
        translation: store.get('metadata')?.translation,
        delay: store.get('metadata')?.autoPresentDelayMs,
        connection: store.get('metadata')?.presenterConnectionMode,
        output: store.get('metadata')?.presenterOutputMode,
      },
      { translation: 'KJV', delay: 1000, connection: 'connected', output: 'library' },
    )
  })

  test('keeps the first observation when two renderer surfaces report the same paint', () => {
    const store = new ScriptureTraceStore()
    start(store, 'a')
    store.mark('a', 'suggestionRenderedAt', T0 + 20)
    store.mark('a', 'suggestionRenderedAt', T0 + 45)
    assert.equal(store.get('a')?.suggestionRenderedAt, T0 + 20)
  })

  test('a cancelled trace stops advancing', () => {
    // An in-flight ProPresenter call that returns after the operator cancelled
    // must not make the trace look like it presented.
    const store = new ScriptureTraceStore()
    start(store, 'a')
    store.complete('a', 'cancelled')
    store.mark('a', 'presenterRequestCompletedAt', T0 + 900)

    assert.equal(store.get('a')?.status, 'cancelled')
    assert.equal(store.get('a')?.presenterRequestCompletedAt, undefined)
    assert.equal(store.metrics('a')?.totalToPresenterRequestMs, undefined)
  })

  test('the first completion wins', () => {
    const store = new ScriptureTraceStore()
    start(store, 'a')
    store.complete('a', 'cancelled')
    store.complete('a', { status: 'presented' })
    assert.equal(store.get('a')?.status, 'cancelled')
  })

  test('a renderer paint may close its independent stage after presentation completes', () => {
    const store = new ScriptureTraceStore()
    start(store, 'a')
    store.complete('a', { status: 'presented', confirmation: 'request-accepted' })
    store.mark('a', 'suggestionRenderedAt', T0 + 30)
    assert.equal(store.metrics('a')?.operatorVisibleMs, 30)
  })

  test('records why a trace ended badly', () => {
    const store = new ScriptureTraceStore()
    start(store, 'a')
    store.complete('a', {
      status: 'failed',
      failureReason: 'presenter-disconnected',
      error: 'ECONNREFUSED',
    })
    assert.equal(store.get('a')?.failureReason, 'presenter-disconnected')
    assert.equal(store.get('a')?.error, 'ECONNREFUSED')
  })

  test('supersession names the winner', () => {
    const store = new ScriptureTraceStore()
    start(store, 'ai')
    store.complete('ai', { status: 'superseded', supersededBy: 'explicit-1' })
    assert.equal(store.get('ai')?.supersededBy, 'explicit-1')
  })

  test('marking an unknown trace is a no-op, not a crash', () => {
    const store = new ScriptureTraceStore()
    store.mark('nope', 'countdownStartedAt')
    store.complete('nope', 'presented')
    assert.equal(store.get('nope'), undefined)
    assert.equal(store.size, 0)
  })

  test('evicts the oldest traces so a long service cannot grow memory', () => {
    const store = new ScriptureTraceStore(3)
    for (const id of ['a', 'b', 'c', 'd']) start(store, id)

    assert.equal(store.size, 3)
    assert.equal(store.get('a'), undefined, 'oldest dropped')
    assert.deepEqual(
      store.getRecent().map((t) => t.correlationId),
      ['d', 'c', 'b'],
      'newest first',
    )
  })

  test('getRecent honours its limit', () => {
    const store = new ScriptureTraceStore()
    for (const id of ['a', 'b', 'c']) start(store, id)
    assert.deepEqual(
      store.getRecent(2).map((t) => t.correlationId),
      ['c', 'b'],
    )
  })
})

describe('isTerminal', () => {
  test('only an active trace may still advance', () => {
    assert.equal(isTerminal('active'), false)
    for (const status of ['presented', 'cancelled', 'superseded', 'failed'] as const) {
      assert.equal(isTerminal(status), true, status)
    }
  })
})

describe('summarizeByResolver', () => {
  const presentedWith = (
    resolver: 'explicit' | 'ai',
    detectionMs: number,
    requestMs: number,
  ): ScriptureLatencyTrace =>
    trace({
      resolver,
      status: 'presented',
      citationRecognizedAt: T0 + detectionMs,
      presenterRequestStartedAt: T0 + 1_000,
      presenterRequestCompletedAt: T0 + 1_000 + requestMs,
    })

  test('reports p50 and p95 per resolver', () => {
    const traces = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((ms) =>
      presentedWith('explicit', ms, ms * 2),
    )
    const [summary] = summarizeByResolver(traces)

    assert.equal(summary.resolver, 'explicit')
    assert.equal(summary.presented, 10)
    assert.equal(summary.stages.detectionMs?.p50, 5)
    assert.equal(summary.stages.detectionMs?.min, 1)
    assert.equal(summary.stages.detectionMs?.mean, 14.5)
    assert.equal(summary.stages.detectionMs?.p90, 9)
    assert.equal(summary.stages.detectionMs?.p95, 100)
    assert.equal(summary.stages.detectionMs?.p99, 100)
    assert.equal(summary.stages.detectionMs?.max, 100)
    assert.equal(summary.stages.presenterRequestMs?.p50, 10)
  })

  test('cancelled and superseded traces are counted but never timed', () => {
    // An operator cancelling is the safety delay working. Letting that inflate
    // p95 would make the numbers describe something nobody waited for.
    const summary = summarizeByResolver([
      presentedWith('explicit', 5, 10),
      trace({ status: 'cancelled', citationRecognizedAt: T0 + 9_000 }),
      trace({ status: 'superseded', citationRecognizedAt: T0 + 9_000 }),
      trace({ status: 'failed', failureReason: 'presenter-disconnected' }),
    ])[0]

    assert.equal(summary.presented, 1)
    assert.equal(summary.cancelled, 1)
    assert.equal(summary.superseded, 1)
    assert.equal(summary.failed, 1)
    assert.equal(summary.stages.detectionMs?.count, 1, 'only the presented one is timed')
    assert.equal(summary.stages.detectionMs?.p95, 5)
  })

  test('groups resolvers separately, busiest first', () => {
    const summaries = summarizeByResolver([
      presentedWith('ai', 400, 10),
      presentedWith('explicit', 3, 10),
      presentedWith('explicit', 4, 10),
    ])
    assert.deepEqual(
      summaries.map((s) => s.resolver),
      ['explicit', 'ai'],
    )
    assert.equal(summaries[1].stages.detectionMs?.p50, 400)
  })

  test('omits a stage nothing ever recorded', () => {
    const summary = summarizeByResolver([presentedWith('explicit', 5, 10)])[0]
    assert.equal(summary.stages.presenterConfirmationMs, undefined)
  })
})

describe('percentile', () => {
  test('nearest-rank, and safe on an empty sample', () => {
    assert.equal(percentile([], 0.95), 0)
    assert.equal(percentile([5], 0.5), 5)
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2)
    assert.equal(percentile([1, 2, 3, 4], 1), 4)
  })
})

describe('operator-visible latency', () => {
  test('measures transcript → painted in Kairo, excluding delay and ProPresenter', () => {
    // The number the operator actually experiences: it must not include the
    // safety delay or anything ProPresenter does.
    const t = trace({
      status: 'presented',
      citationRecognizedAt: T0 + 3,
      bibleLookupStartedAt: T0 + 4,
      bibleLookupCompletedAt: T0 + 21,
      suggestionPublishedAt: T0 + 29,
      suggestionRenderedAt: T0 + 47,
      countdownStartedAt: T0 + 48,
      countdownCompletedAt: T0 + 1_048,
      presenterRequestStartedAt: T0 + 1_049,
      presenterRequestCompletedAt: T0 + 1_231,
    })
    const m = deriveMetrics(t)

    assert.equal(m.suggestionRenderMs, 18, 'IPC hop plus React commit plus paint')
    assert.equal(m.operatorVisibleMs, 47, 'transcript received → on screen')
    assert.ok(
      m.operatorVisibleMs! < m.countdownMs!,
      'the operator sees it long before the safety delay expires',
    )
    assert.ok(m.operatorVisibleMs! < m.totalToPresenterRequestMs!)
  })

  test('a cancelled suggestion still counts toward on-screen latency', () => {
    // It was shown to the operator — that is exactly what is being measured —
    // and it is why they were able to cancel it at all.
    const summary = summarizeByResolver([
      trace({
        status: 'cancelled',
        suggestionPublishedAt: T0 + 20,
        suggestionRenderedAt: T0 + 44,
      }),
    ])[0]

    assert.equal(summary.cancelled, 1)
    assert.equal(summary.presented, 0)
    assert.equal(summary.stages.operatorVisibleMs?.count, 1)
    assert.equal(summary.stages.operatorVisibleMs?.p50, 44)
  })

  test('is absent when the renderer never reported a paint', () => {
    const m = deriveMetrics(trace({ suggestionPublishedAt: T0 + 20 }))
    assert.equal(m.operatorVisibleMs, undefined)
    assert.equal(m.suggestionRenderMs, undefined)
  })
})

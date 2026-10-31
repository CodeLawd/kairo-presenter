import { performance } from 'node:perf_hooks'
import { percentile as nearestRank } from '@shared/scripture-trace'
import type { GlobalQuoteMatch } from './global-quote'
import type { RecordedTranscriptEvent } from './transcript-recording'
export interface ReplayEvent { atMs: number; type: 'interim' | 'final'; text: string; audioStart?: number; audioEpoch?: number }
export interface ReplayCase {
 id: string
 split: 'calibration' | 'held-out'
 expectedResolution?: 'local' | 'AI'
 category: 'exact' | 'noisy' | 'ambiguous' | 'negative' | 'paraphrase'
 events: ReplayEvent[]
 expected: string[]
 evidenceAtMs?: number
}
export interface ReplayFixture { version: 1; description: string; cases: ReplayCase[] }
export function canonicalQuote(match: Pick<GlobalQuoteMatch, 'book' | 'chapter' | 'verse'>): string { return `${match.book} ${match.chapter}:${match.verse}` }
/** The trace summary's nearest-rank percentile, but null rather than 0 when nothing was measured. */
export function percentile(values: number[], p: number): number | null {
 return values.length ? nearestRank([...values].sort((a,b)=>a-b), p) : null
}
export interface ReplayCaseReport {
 id: string; split: ReplayCase['split']; category: ReplayCase['category']; expectedResolution: 'local' | 'AI'; expected: string[]
 found: string[]; missing: string[]; wrong: string[]; firstCorrectAtMs: number | null
 evidenceToFirstMatchMs: number | null; queryMs: number[]; eventCount: number
}
/** Deterministic transcript-revision replay of corpus retrieval/scoring, without network or renderer. */
export async function evaluateReplayCase(scenario: ReplayCase, resolve: (text: string) => GlobalQuoteMatch[] | Promise<GlobalQuoteMatch[]>): Promise<ReplayCaseReport> {
 let previousAt = -Infinity
 let committed = ''
 let currentStart: number | undefined
 let currentEpoch: number | undefined
 const found = new Set<string>()
 const queryMs: number[] = []
 let firstCorrectAtMs: number | null = null
 for (const event of scenario.events) {
  if (!Number.isFinite(event.atMs) || event.atMs < previousAt) throw new Error(`Non-monotonic replay timestamps: ${scenario.id}`)
  previousAt = event.atMs
  if (event.audioEpoch !== currentEpoch) { committed = ''; currentStart = undefined; currentEpoch = event.audioEpoch }
  if (currentStart !== undefined && event.audioStart !== undefined && event.audioStart < currentStart) throw new Error(`Reordered audio offsets: ${scenario.id}`)
  currentStart = event.audioStart
  const text = `${committed} ${event.text}`.trim().slice(-1200)
  const started = performance.now()
  const matches = await resolve(text)
  queryMs.push(performance.now() - started)
  for (const match of matches) {
   const key = canonicalQuote(match)
   found.add(key)
   if (scenario.expected.includes(key) && firstCorrectAtMs === null) firstCorrectAtMs = event.atMs
  }
  if (event.type === 'final') committed = text
 }
 return { id: scenario.id, split: scenario.split, category: scenario.category, expectedResolution: scenario.expectedResolution ?? 'local', expected: scenario.expected,
  found: [...found], missing: scenario.category === 'ambiguous' && scenario.expected.some(ref=>found.has(ref)) ? [] : scenario.expected.filter(ref => !found.has(ref)), wrong: [...found].filter(ref => !scenario.expected.includes(ref)),
  firstCorrectAtMs, evidenceToFirstMatchMs: firstCorrectAtMs !== null && scenario.evidenceAtMs !== undefined ? firstCorrectAtMs - scenario.evidenceAtMs : null,
  queryMs, eventCount: scenario.events.length }
}
export function summarizeReplay(rows: ReplayCaseReport[]) {
 const positive = rows.filter(row => row.expected.length > 0)
 const negative = rows.filter(row => row.category === 'negative')
 const query = rows.flatMap(row => row.queryMs)
 const evidence = rows.flatMap(row => row.evidenceToFirstMatchMs === null ? [] : [row.evidenceToFirstMatchMs])
 return {
  cases: rows.length, events: rows.reduce((n,row)=>n+row.eventCount,0), positiveCases: positive.length,
  missedCases: positive.filter(row=>row.missing.length===row.expected.length).length,
  partiallyMissedCases: positive.filter(row=>row.missing.length>0&&row.missing.length<row.expected.length).length,
  wrongPassageCases: rows.filter(row=>row.wrong.length>0).length,
  expectedAIFallbackCases: positive.filter(row=>row.expectedResolution==='AI').length,
  missedExpectedLocalCases: positive.filter(row=>row.expectedResolution==='local'&&row.missing.length===row.expected.length).length,
  unresolvedExpectedAIFallbackCases: positive.filter(row=>row.expectedResolution==='AI'&&row.missing.length===row.expected.length).length,
  negativeCases: negative.length, falsePositiveNegativeCases: negative.filter(row=>row.found.length>0).length,
  retrievalAndScoringMs: { p50: percentile(query,0.5), p95: percentile(query,0.95), max: query.length ? Math.max(...query) : null },
  annotatedReplayEvidenceToFirstMatchMs: { p50: percentile(evidence,0.5), p95: percentile(evidence,0.95), samples: evidence.length },
  audioToScreenMs: null,
 }
}
export function recordedEventsToReplay(events: RecordedTranscriptEvent[]): ReplayEvent[] {
 let epoch: number | undefined
 return events.map(event => {
  if (event.type === 'gap') throw new Error(`Incomplete recording: ${event.count} events dropped`)
  epoch ??= event.result.timestamp
  return { type: event.type, text: event.result.text, atMs: event.result.timestamp - epoch, audioStart: event.result.audioStart, audioEpoch: event.result.audioEpoch }
 })
}

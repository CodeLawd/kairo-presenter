import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';

import type { TranscriptResult } from '../../../../lib/ipc';
import { ScriptureDetector, type ScriptureReference } from '../detector';
import { subscribeExplicitScriptureDetection } from '../live-detection-wiring';
import { matchChapterQuote, tokenizeChapter } from '../quote-recovery';

const passages = [
  ['Genesis', 12, 3], ['Exodus', 20, 12], ['Joshua', 1, 9],
  ['Psalms', 23, 4], ['Proverbs', 3, 5], ['Isaiah', 40, 31],
  ['Jeremiah', 29, 11], ['Matthew', 5, 9], ['Mark', 10, 27],
  ['Luke', 4, 18], ['John', 3, 16], ['Romans', 8, 28],
  ['1 Corinthians', 13, 4], ['Galatians', 5, 22], ['Ephesians', 6, 10],
  ['Philippians', 4, 13], ['Colossians', 3, 16], ['Hebrews', 11, 6],
  ['James', 1, 5], ['Revelation', 21, 4],
] as const;

const key = (r: ScriptureReference): string => `${r.book} ${r.chapter}:${r.verseStart}`;

function replay(segments: string[], chapterVerses?: Array<{ book: string; chapter: number; verse: number; text: string }>): { found: string[]; latencyMs: number; refs: ScriptureReference[] } {
  let finalListener!: (result: TranscriptResult) => void;
  const source = {
    onTranscript(listener: typeof finalListener) { finalListener = listener; },
    offTranscript() {}, onInterim() {}, offInterim() {},
  };
  mock.timers.enable({ apis: ['setTimeout'] });
  const detector = new ScriptureDetector({ apiKey: 'test-key' });
  Object.assign(detector, { callModel: async () => '[]' });
  if (chapterVerses) detector.setChapterVerseProvider(() => chapterVerses);
  const found: string[] = [];
  const refs: ScriptureReference[] = [];
  detector.on('detection', detected => { refs.push(...detected); found.push(...detected.map(key)); });
  const cleanup = subscribeExplicitScriptureDetection(source, detector);
  const start = performance.now();
  try {
    for (const text of segments) {
      finalListener({ id: text, text, words: [], timestamp: Date.now(), duration: 0, isFinal: true });
    }
    const latencyMs = performance.now() - start;
    mock.timers.tick(10_000);
    return { found, latencyMs, refs };
  } finally { cleanup(); detector.destroy(); mock.timers.reset(); }
}

test('large transcript sample: citation recall, false positives, and local latency', () => {
  const samples: Array<{ label: string; segments: string[]; expected: string[] }> = [];
  for (const [book, chapter, verse] of passages) {
    const expected = [`${book} ${chapter}:${verse}`];
    samples.push(
      { label: `${book} colon`, segments: [`Please read ${book} ${chapter}:${verse}.`], expected },
      { label: `${book} spoken verse`, segments: [`Turn to ${book} chapter ${chapter} verse ${verse}.`], expected },
      { label: `${book} split final`, segments: [`Turn to ${book} chapter ${chapter}.`, `Verse ${verse}.`], expected },
      { label: `${book} verse lead-in`, segments: [`In ${book} ${chapter}, we read from verse ${verse}.`], expected },
      { label: `${book} comma`, segments: [`Please read ${book} ${chapter}, verse ${verse}.`], expected },
      { label: `${book} sentence break`, segments: [`${book} chapter ${chapter}. Look at verse ${verse}.`], expected },
      { label: `${book} split book`, segments: [`Go to ${book}.`, `Chapter ${chapter} verse ${verse}.`], expected },
      { label: `${book} plain speech`, segments: [`We are grateful for the volunteers today.`], expected: [] },
      { label: `${book} ordinary number`, segments: [`Our study group discussed ${chapter} ideas with ${verse} people.`], expected: [] },
      { label: `${book} unrelated verse`, segments: [`The song has verse ${verse} and a beautiful refrain.`], expected: [] },
    );
  }
  const timings: number[] = [];
  const failures: string[] = [];
  for (const sample of samples) {
    const actual = replay(sample.segments);
    timings.push(actual.latencyMs);
    if (JSON.stringify(actual.found) !== JSON.stringify(sample.expected)) {
      failures.push(`${sample.label}: expected ${JSON.stringify(sample.expected)}, got ${JSON.stringify(actual.found)}`);
    }
  }
  timings.sort((a, b) => a - b);
  console.log(`Large transcript sample: ${samples.length} cases; p50=${timings[Math.floor(timings.length * .5)].toFixed(3)}ms p95=${timings[Math.floor(timings.length * .95)].toFixed(3)}ms max=${timings.at(-1)!.toFixed(3)}ms`);
  assert.deepEqual(failures, []);
});

test('large quotation sample: exact readings and distorted wording', () => {
  const db = new Database('resources/bible.db', { readonly: true });
  const rows = db.prepare(`SELECT b.name AS book, v.chapter, v.verse, v.text
    FROM verses v JOIN books b ON b.id = v.book_id
    WHERE b.name = ? AND v.chapter = ? ORDER BY v.verse`) as { all(book: string, chapter: number): Array<{ book: string; chapter: number; verse: number; text: string }> };
  const fixtureFailures: string[] = [];
  const misses: string[] = [];
  const outcomes = { exact: 0, openingExcerpt: 0, middleExcerpt: 0, firstWordChanged: 0, middleWordChanged: 0, lastWordChanged: 0, scrambledRejected: 0, unrelatedRejected: 0 };
  let count = 0;
  try {
    for (const [book, chapter, verse] of passages) {
      const candidates = rows.all(book, chapter);
      const target = candidates.find(row => row.verse === verse);
      if (!target) { fixtureFailures.push(`missing fixture: ${book} ${chapter}:${verse}`); continue; }
      const words = target.text.replace(/<[^>]+>/g, ' ').match(/[A-Za-z]+/g) ?? [];
      if (words.length < 9) { fixtureFailures.push(`short fixture: ${book} ${chapter}:${verse}`); continue; }
      const expected = `${book} ${chapter}:${verse}`;
      const make = (speech: string) => replay([`In ${book} chapter ${chapter}.`, speech], candidates);
      const matched = (speech: string) => make(speech).refs.some(ref => key(ref) === expected && ref.resolver === 'quotation-local');
      const exact = make(words.join(' ')); count++;
      if (exact.refs.some(ref => key(ref) === expected && ref.resolver === 'quotation-local')) outcomes.exact++;
      else misses.push(`exact ${expected}: ${JSON.stringify(exact.found)} direct=${JSON.stringify(matchChapterQuote(words.join(' '), tokenizeChapter(candidates)))}`);
      if (matched(words.slice(0, 10).join(' '))) outcomes.openingExcerpt++; count++;
      if (matched(words.slice(2, 12).join(' '))) outcomes.middleExcerpt++; count++;
      for (const [position, field] of [[0, 'firstWordChanged'], [Math.floor(words.length / 2), 'middleWordChanged'], [words.length - 1, 'lastWordChanged']] as const) {
        const changed = [...words]; changed[position] = 'unexpected';
        if (matched(changed.join(' '))) outcomes[field]++;
        count++;
      }
      const scrambled = make(words.slice(0, 8).reverse().join(' ')); count++;
      if (!scrambled.refs.some(ref => ref.resolver === 'quotation-local')) outcomes.scrambledRejected++;
      const unrelated = make('We had lunch with our friends and discussed the service plans.'); count++;
      if (!unrelated.refs.some(ref => ref.resolver === 'quotation-local')) outcomes.unrelatedRejected++;
    }
  } finally { db.close(); }
  console.log(`Quote sample: ${count} cases; ${JSON.stringify(outcomes)}; misses=${JSON.stringify(misses)}`);
  assert.deepEqual(fixtureFailures, []);
  assert.deepEqual(misses, []);
  assert.equal(outcomes.scrambledRejected, 20);
  assert.equal(outcomes.unrelatedRejected, 20);
});

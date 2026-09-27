import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';

import type { TranscriptResult } from '../../../../lib/ipc';
import { ScriptureDetector, type ScriptureReference } from '../detector';
import { subscribeExplicitScriptureDetection } from '../live-detection-wiring';
import type { QuoteCandidate } from '../quote-recovery';

type Passage = QuoteCandidate;
type Case = { category: string; variant: string; label: string; segments: string[]; expected: string | null; quote?: boolean; chapter?: QuoteCandidate[] };
const key = (ref: ScriptureReference): string => `${ref.book} ${ref.chapter}:${ref.verseStart}`;

function replay(sample: Case): { refs: ScriptureReference[]; elapsedMs: number } {
  let finalListener!: (result: TranscriptResult) => void;
  const source = {
    onTranscript(listener: typeof finalListener) { finalListener = listener; },
    offTranscript() {}, onInterim() {}, offInterim() {},
  };
  mock.timers.enable({ apis: ['setTimeout'] });
  const detector = new ScriptureDetector({ apiKey: 'sample-key' });
  Object.assign(detector, { callModel: async () => '[]' });
  if (sample.chapter) detector.setChapterVerseProvider(() => sample.chapter!);
  const refs: ScriptureReference[] = [];
  detector.on('detection', found => refs.push(...found));
  const cleanup = subscribeExplicitScriptureDetection(source, detector);
  const start = performance.now();
  try {
    for (const text of sample.segments) {
      finalListener({ id: text, text, words: [], timestamp: Date.now(), duration: 0, isFinal: true });
    }
    const elapsedMs = performance.now() - start;
    mock.timers.tick(10_000);
    return { refs, elapsedMs };
  } finally { cleanup(); detector.destroy(); mock.timers.reset(); }
}

test('1000 transcript cases across 50 Bible books', () => {
  const db = new Database('resources/bible.db', { readonly: true });
  const books = db.prepare('SELECT id, name FROM books ORDER BY id').all() as Array<{ id: number; name: string }>;
  const verses = db.prepare('SELECT chapter, verse, text FROM verses WHERE book_id = ? ORDER BY chapter, verse') as {
    all(id: number): Array<{ chapter: number; verse: number; text: string }>;
  };
  const chapters = db.prepare('SELECT chapter, verse, text FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse') as {
    all(id: number, chapter: number): Array<{ chapter: number; verse: number; text: string }>;
  };
  const samples: Case[] = [];
  try {
    for (let i = 0; i < 50; i++) {
      const book = books[Math.floor(i * books.length / 50)];
      const eligible = verses.all(book.id).filter(row => row.verse > 2 && (row.text.match(/[A-Za-z]+/g)?.length ?? 0) >= 16);
      assert.ok(eligible.length > 0, `fixture for ${book.name}`);
      const selected = eligible[(book.id * 53) % eligible.length];
      const passage: Passage = { book: book.name, ...selected };
      const chapter = chapters.all(book.id, passage.chapter).map(row => ({ book: book.name, ...row }));
      const { verse, text: verseText } = passage;
      const name = book.name;
      const chapterNumber = passage.chapter;
      const expected = `${name} ${chapterNumber}:${verse}`;
      const add = (category: string, variant: string, segments: string[], wanted: string | null, quote = false) =>
        samples.push({ category, variant, label: `${expected} ${variant}`, segments, expected: wanted, quote, chapter: quote ? chapter : undefined });

      add('citation', 'colon', [`Please read ${name} ${chapterNumber}:${verse}.`], expected);
      add('citation', 'chapter verse', [`Turn to ${name} chapter ${chapterNumber} verse ${verse}.`], expected);
      add('citation', 'comma', [`Open ${name} ${chapterNumber}, verse ${verse}.`], expected);
      add('citation', 'split finals', [`Turn to ${name} chapter ${chapterNumber}.`, `Verse ${verse}.`], expected);
      add('citation', 'split book', [`Go to ${name}.`, `Chapter ${chapterNumber} verse ${verse}.`], expected);
      add('citation', 'verse lead', [`In ${name} ${chapterNumber}, we read from verse ${verse}.`], expected);
      add('citation', 'sentence break', [`${name} chapter ${chapterNumber}. Look at verse ${verse}.`], expected);
      add('citation', 'chapter number', [`${name} chapter number ${chapterNumber} verse number ${verse}.`], expected);
      add('control', 'ordinary numbers', [`The group listed ${chapterNumber} ideas and invited ${verse} people.`], null);
      add('control', 'unrelated verse', [`The song has verse ${verse} and a refrain.`], null);
      add('control', 'ordinary words', ['The volunteers prepared the room before the service.'], null);
      add('control', 'numeric announcement', [`We need ${verse} chairs for the next gathering.`], null);

      const words = verseText.replace(/<[^>]+>|\{[^}]+\}/g, ' ').match(/[A-Za-z]+/g)!;
      const quote = (label: string, speech: string, wanted: string | null) =>
        add('quotation', label, [`In ${name} chapter ${chapterNumber}.`, speech], wanted, true);
      quote('exact', words.join(' '), expected);
      quote('opening excerpt', words.slice(0, 12).join(' '), expected);
      // Haggai 1:5 and 1:7 contain the same excerpt; without the opening
      // words, picking either verse would be a false claim of certainty.
      const middleExpected = name === 'Haggai' && chapterNumber === 1 && verse === 5 ? null : expected;
      quote('middle excerpt', words.slice(2, 14).join(' '), middleExpected);
      for (const [label, index] of [['first word changed', 0], ['middle word changed', Math.floor(words.length / 2)], ['last word changed', words.length - 1]] as const) {
        const changed = [...words]; changed[index] = 'unexpected';
        quote(label, changed.join(' '), expected);
      }
      quote('scrambled', words.slice(0, 8).reverse().join(' '), null);
      quote('unrelated', 'The volunteers prepared the room before the service.', null);
    }
  } finally { db.close(); }

  assert.equal(samples.length, 1000);
  const scores = new Map<string, { total: number; passed: number }>();
  const misses: string[] = [];
  const timings: number[] = [];
  for (const sample of samples) {
    const { refs, elapsedMs } = replay(sample);
    timings.push(elapsedMs);
    const actual = sample.quote
      ? refs.filter(ref => ref.resolver === 'quotation-local').map(key)
      : refs.map(key);
    const passed = sample.expected ? actual.includes(sample.expected) : actual.length === 0;
    const bucket = `${sample.category}/${sample.variant}`;
    const score = scores.get(bucket) ?? { total: 0, passed: 0 };
    score.total++;
    if (passed) score.passed++;
    scores.set(bucket, score);
    if (!passed) misses.push(`${sample.label}: expected ${sample.expected ?? 'none'}, got ${JSON.stringify(actual)}`);
  }
  timings.sort((a, b) => a - b);
  const passed = samples.length - misses.length;
  console.log(`1000-case sample: ${passed}/${samples.length} expected outcomes; p50=${timings[500].toFixed(3)}ms p95=${timings[950].toFixed(3)}ms`);
  console.log(`1000-case categories: ${JSON.stringify([...scores])}`);
  console.log(`1000-case misses (${misses.length}): ${JSON.stringify(misses)}`);
  assert.deepEqual(misses, []);
});

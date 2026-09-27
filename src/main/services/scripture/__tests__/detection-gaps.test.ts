import assert from 'node:assert/strict';
import test from 'node:test';

import type { TranscriptResult } from '../../../../lib/ipc';
import { ScriptureDetector, type ScriptureReference } from '../detector';
import { subscribeExplicitScriptureDetection } from '../live-detection-wiring';
import type { QuoteCandidate } from '../quote-recovery';

const key = (r: ScriptureReference): string =>
  `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd ? `-${r.verseEnd}` : ''}`;

const JOHN_3: QuoteCandidate[] = [
  { book: 'John', chapter: 3, verse: 3, text: 'Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.' },
  { book: 'John', chapter: 3, verse: 7, text: 'Marvel not that I said unto thee, Ye must be born again.' },
  { book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
  { book: 'John', chapter: 3, verse: 17, text: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.' },
];

/** A detector that records emitted references as keys, destroyed afterwards. */
async function withDetector(
  config: ConstructorParameters<typeof ScriptureDetector>[0],
  run: (detector: ScriptureDetector, found: string[]) => void | Promise<void>,
): Promise<void> {
  const detector = new ScriptureDetector(config);
  const found: string[] = [];
  detector.on('detection', refs => found.push(...refs.map(key)));
  try { await run(detector, found); } finally { detector.destroy(); }
}

/**
 * Feeds finals through the real live wiring; the model is stubbed to record
 * what it would see. A function step acts on the detector between finals.
 */
function replay(
  segments: Array<string | ((detector: ScriptureDetector) => void)>,
  chapterVerses?: QuoteCandidate[],
): { found: ScriptureReference[]; modelSaw: string[] } {
  let finalListener!: (result: TranscriptResult) => void;
  const source = {
    onTranscript(listener: typeof finalListener) { finalListener = listener; },
    offTranscript() {}, onInterim() {}, offInterim() {},
  };
  const detector = new ScriptureDetector({ apiKey: 'test-key' });
  const modelSaw: string[] = [];
  Object.assign(detector, { callModel: async (text: string) => { modelSaw.push(text); return '[]'; } });
  if (chapterVerses) detector.setChapterVerseProvider(() => chapterVerses);
  const found: ScriptureReference[] = [];
  detector.on('detection', refs => found.push(...refs));
  const cleanup = subscribeExplicitScriptureDetection(source, detector);
  try {
    for (const step of segments) {
      if (typeof step === 'function') step(detector);
      else finalListener({ id: step, text: step, words: [], timestamp: Date.now(), duration: 0, isFinal: true });
    }
  } finally { cleanup(); detector.destroy(); }
  return { found, modelSaw };
}

for (const [segments, expected] of [
  // Lead-ins between chapter and verse.
  [['John chapter three from verse sixteen.'], 'John 3:16'],
  [['Turn with me to John chapter 3, beginning at verse 16.'], 'John 3:16'],
  [['Romans chapter 8 starting from verse 28.'], 'Romans 8:28'],
  [['Hebrews 11 in verse 6'], 'Hebrews 11:6'],
  [['Romans chapter 8, and the Bible says in verse 28'], 'Romans 8:28'],
  [['Hebrews chapter 11, the 6th verse'], 'Hebrews 11:6'],
  // Sentence break inside one final.
  [['Romans chapter 8. Look at verse 28.'], 'Romans 8:28'],
  // Verse before book.
  [['Let us read verse 28 of Romans chapter 8.'], 'Romans 8:28'],
  [['In verse 28 of Romans 8, Paul says'], 'Romans 8:28'],
  [['Verses 28 to 30 of Romans 8.'], 'Romans 8:28-30'],
  // Punctuated bare book names.
  [['Go to Romans.', 'Chapter 8.', 'Verse 28.'], 'Romans 8:28'],
  [['Open your Bible to the book of Romans.', 'Chapter 8 verse 28.'], 'Romans 8:28'],
  [['Go to Romans.', 'So chapter 8 verse 28.'], 'Romans 8:28'],
  [['Go to Romans.', 'Now, chapter 8, verse 28.'], 'Romans 8:28'],
  // Spoken hundreds in the verse.
  [['Psalm one hundred and nineteen verse one hundred and five'], 'Psalms 119:105'],
  // Ordinals, Roman numerals and STT spellings of book names.
  [['1st Corinthians 13 verse 4'], '1 Corinthians 13:4'],
  [['2nd Chronicles 7:14'], '2 Chronicles 7:14'],
  [['3rd John verse 4'], '3 John 1:4'],
  [['I Corinthians 13:4'], '1 Corinthians 13:4'],
  [['II Timothy 3:16'], '2 Timothy 3:16'],
  [['Phillipians 4:13'], 'Philippians 4:13'],
  [['Philipians chapter four verse thirteen'], 'Philippians 4:13'],
  [['Philippines 4:13'], 'Philippians 4:13'],
  [['Hebrew 11:1'], 'Hebrews 11:1'],
  [['Roman 8:28'], 'Romans 8:28'],
  [['Song of Songs 2:4'], 'Song of Solomon 2:4'],
  [['Go to Phillipians.', 'Chapter 4 verse 13.'], 'Philippians 4:13'],
  // Comma-separated adjacent verses.
  [['Luke 4:18,19'], 'Luke 4:18-19'],
  [['Luke 4 18, 19'], 'Luke 4:18-19'],
  // Chapter and verse fused by smart formatting, when only one reading exists.
  [['John 316.'], 'John 3:16'],
  [['Romans 828.'], 'Romans 8:28'],
  [['Jeremiah 2911.'], 'Jeremiah 29:11'],
  [['Philippians 413'], 'Philippians 4:13'],
  [['Psalm 1195'], 'Psalms 119:5'],
  // Previously handled forms must keep working.
  [['Romans 8, verse 28.'], 'Romans 8:28'],
  [['Romans eight twenty eight.'], 'Romans 8:28'],
  [['Romans chapter 8.', 'Look at verse 28.'], 'Romans 8:28'],
  [['Isaiah 40.', '31.'], 'Isaiah 40:31'],
  [['Proverbs 3 5 and 6'], 'Proverbs 3:5-6'],
  [['Galatians 5 22 and 23'], 'Galatians 5:22-23'],
] as Array<[string[], string]>) {
  test(`detects locally: ${segments.join(' | ')}`, () => {
    const { found, modelSaw } = replay(segments);
    assert.deepEqual(found.map(key), [expected]);
    assert.deepEqual(modelSaw, [], 'a spoken citation must not need the model');
  });
}

// Commentary between the parts is ordinary speech and rightly reaches the
// model; the citation must still resolve locally once its verse arrives.
for (const segments of [
  ['Go to Romans.', 'Paul writes to the church in Rome.', 'Chapter 8 verse 28.'],
  ['Paul writes in Romans', '8, verse 28.'],
]) {
  test(`detects a citation interrupted by speech: ${segments.join(' | ')}`, () => {
    assert.deepEqual(replay(segments).found.map(key), ['Romans 8:28']);
  });
}

for (const segments of [
  ['Romans chapter 8. 28 people came forward.'],
  ['Romans chapter 8 and 28 people came forward.'],
  ['I want to talk to John.', 'Chapter 3 of my life was hard.'],
  ['That verse 3 of the song moved me.'],
  ['We have one hundred and five volunteers today.'],
  ['I John 3 times called the office.'],
  ['We sent a team to the Philippines last year.'],
  ['The Roman soldiers came.'],
]) {
  test(`does not invent a verse: ${segments.join(' | ')}`, () => {
    const found = replay(segments).found.filter(ref => ref.verseStart !== 1 || /verse/.test(ref.sourceText));
    assert.deepEqual(found.map(key), []);
  });
}

test('a quote after a named chapter resolves locally inside that chapter', () => {
  const { found, modelSaw } = replay(
    ['In John 3 Jesus says for God so loved the world that he gave his only begotten son.'],
    JOHN_3,
  );
  assert.deepEqual(found.map(key), ['John 3:16']);
  assert.equal(found[0].detectionType, 'quote');
  assert.equal(found[0].resolver, 'quotation-local');
  assert.ok(found[0].confidence >= 0.8, 'a long verbatim run is confident enough to auto-present');
  assert.deepEqual(modelSaw, []);
});

test('the chapter stays in scope when the quote arrives in the next final', () => {
  const { found } = replay(['In John 3, Jesus tells Nicodemus,', 'ye must be born again.'], JOHN_3);
  assert.deepEqual(found.map(key), ['John 3:7']);
  assert.ok(found[0].confidence < 0.7, 'a short run is shown for review, not auto-presented');
});

test('a quote resolves inside a chapter announced across separate finals', () => {
  const { found, modelSaw } = replay(
    ['Go to John.', 'Chapter 3.', 'For God so loved the world that he gave his only begotten son.'],
    JOHN_3,
  );
  assert.deepEqual(found.map(key), ['John 3:16']);
  assert.deepEqual(modelSaw, []);
});

test('a released card does not come back from speech already in the window', () => {
  const release = (detector: ScriptureDetector): void => detector.release({ book: 'Romans', chapter: 8, verseStart: 28 });
  const { found } = replay(['Paul writes in Romans', '8, verse 28.', release, 'Amen, amen.']);
  assert.deepEqual(found.map(key), ['Romans 8:28']);
});

test('a chapter-only final reaches the model with the next final instead of vanishing', () => {
  const { found, modelSaw } = replay(
    ['Paul writes in Romans 12,', 'be not conformed to this world but be ye transformed by the renewing of your mind.'],
    [],
  );
  assert.deepEqual(found, []);
  assert.equal(modelSaw.length, 1);
  assert.match(modelSaw[0], /Romans 12, be not conformed/);
});

test('a released reference detects again on the next mention, but not from the model', () =>
  withDetector({ apiKey: 'test', minIntervalMs: 0 }, async (detector, found) => {
    Object.assign(detector, {
      callModel: async () => JSON.stringify([{ book: 'John', chapter: 3, verseStart: 16, confidence: 0.9, detectionType: 'quote', sourceText: 'God so loved' }]),
    });
    detector.analyzeExplicit('John 3:16', true);
    detector.analyzeExplicit('John 3:16', true);
    assert.deepEqual(found, ['John 3:16'], 'repeats are suppressed while the card is live');

    detector.release({ book: 'John', chapter: 3, verseStart: 16 });
    detector.analyze('for God so loved the world');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(found, ['John 3:16'], 'the model re-reading old speech must not resurrect it');

    detector.analyzeExplicit('John 3:16', true);
    assert.deepEqual(found, ['John 3:16', 'John 3:16']);
    detector.analyzeExplicit('John 3:16', true);
    assert.deepEqual(found, ['John 3:16', 'John 3:16'], 'suppression resumes after the re-detection');
  }));

test('releasing one verse of a passage frees the passage for the next mention', () =>
  withDetector({ apiKey: '' }, (detector, found) => {
    detector.analyzeExplicit('Romans 8:28-30', true);
    detector.release({ book: 'Romans', chapter: 8, verseStart: 29 });
    detector.analyzeExplicit('Romans 8:29', true);
    assert.deepEqual(found, ['Romans 8:28-30', 'Romans 8:29']);
  }));

for (const [text, expected] of [
  ['Luke 4:18, 20', 'Luke 4:18'],
  ['Psalm 119', null],
  ['Genesis 111.', null],
  ['Psalm 911.', null],
] as Array<[string, string | null]>) {
  test(`does not guess a verse from ambiguous numbers: ${text}`, () => {
    const found = replay([text]).found.map(key);
    assert.deepEqual(found, expected ? [expected] : []);
  });
}

test('merged digits are only split once the transcript is final', () =>
  withDetector({ apiKey: '' }, (detector, found) => {
    // An interim "Jeremiah 291" is usually "Jeremiah 29:11" still arriving.
    detector.analyzeExplicit('Jeremiah 291', true, true);
    assert.deepEqual(found, []);
    detector.analyzeExplicit('Jeremiah 2911', true, false);
    assert.deepEqual(found, ['Jeremiah 29:11']);
  }));

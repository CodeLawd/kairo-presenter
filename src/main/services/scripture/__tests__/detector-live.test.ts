import assert from "node:assert/strict";
import test from "node:test";

import type { ScriptureReference } from "../detector";
import {
  canAutoPresentScriptureReference,
  matchExplicitScriptures,
  ScriptureDetector,
} from "../detector";

test("keeps chapter-only AI guesses reviewable but blocks automatic presentation", () => {
  const refs: ScriptureReference[] = [
    {
      book: "Matthew",
      chapter: 6,
      verseStart: 1,
      confidence: 0.8,
      detectionType: "partial",
      sourceText: "Matthew chapter six",
    },
    {
      book: "Matthew",
      chapter: 6,
      verseStart: 33,
      confidence: 0.98,
      detectionType: "explicit",
      sourceText: "Matthew six thirty three",
    },
  ];

  assert.equal(canAutoPresentScriptureReference(refs[0]), false);
  assert.equal(canAutoPresentScriptureReference(refs[1]), true);
});

test("emits a spoken explicit range synchronously before AI analysis", () => {
  const detector = new ScriptureDetector({
    apiKey: "test-key",
    minIntervalMs: 0,
  });
  const detections: ScriptureReference[][] = [];
  detector.on("detection", (refs) => detections.push(refs));

  detector.analyze(
    "We have the record in Genesis chapter eight verse fifteen to twenty two.",
  );

  assert.deepEqual(detections[0], [
    {
      book: "Genesis",
      chapter: 8,
      verseStart: 15,
      verseEnd: 22,
      confidence: 0.9,
      detectionType: "explicit",
      resolver: "explicit",
      sourceText: "genesis chapter 8 verse 15 to 22",
    },
  ]);
  detector.destroy();
});

test("suppresses a verse detection that overlaps a cached passage range", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  detector.fallbackMode = true;
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyze("Genesis chapter eight verse fifteen to twenty two");
  detector.analyze("Genesis chapter eight verse twenty two");

  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [["Genesis", 8, 15, 22]],
  );
  detector.destroy();
});

test("allows an explicit passage range to supersede an earlier single-verse guess", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  detector.fallbackMode = true;
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyze("Genesis chapter eight verse twenty one");
  detector.analyze("Genesis chapter eight verse fifteen to twenty two");

  assert.deepEqual(
    emitted.map((ref) => [ref.verseStart, ref.verseEnd]),
    [
      [21, undefined],
      [15, 22],
    ],
  );
  detector.destroy();
});

test("interim fast detection waits until verse numbers are present", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyzeExplicit("We have the record in Genesis chapter eight", true);
  detector.analyzeExplicit(
    "We have the record in Genesis chapter eight verse fifteen to twenty two",
    true,
  );

  assert.deepEqual(emitted.map((ref) => [ref.verseStart, ref.verseEnd]), [[15, 22]]);
  detector.destroy();
});

test("joins adjacent speech fragments into one explicit passage reference", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyzeExplicit("Deuteronomy chapter number one", true);
  detector.analyzeExplicit("And I want us to read from verse", true);
  detector.analyzeExplicit("six", true);
  detector.analyzeExplicit("six to eight", true);

  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [
      ["Deuteronomy", 1, 6, undefined],
      ["Deuteronomy", 1, 6, 8],
    ],
  );
  detector.destroy();
});

test("ignores a repeated chapter number before a spoken verse range", () => {
  const refs = matchExplicitScriptures(
    "In John nineteen nineteen twenty eight to thirty, when he knew all things were accomplished",
  );

  assert.deepEqual(
    refs.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [["John", 19, 28, 30]],
  );
});

test("defers an ambiguous repeated chapter pair in interim speech", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyzeExplicit("John nineteen nineteen", true, true);
  detector.analyzeExplicit("John nineteen nineteen twenty eight to thirty", true, true);

  assert.deepEqual(
    emitted.map((ref) => [ref.chapter, ref.verseStart, ref.verseEnd]),
    [[19, 28, 30]],
  );
  detector.destroy();
});

test("accepts spoken ordinal names for numbered Bible books", () => {
  const cases = [
    ["Second Kings chapter two nineteen to 22", "2 Kings", 2, 19, 22],
    ["First Corinthians chapter thirteen verse four", "1 Corinthians", 13, 4, undefined],
    ["Third John chapter one verse two", "3 John", 1, 2, undefined],
  ] as const;

  for (const [text, book, chapter, verseStart, verseEnd] of cases) {
    const refs = matchExplicitScriptures(text);
    assert.deepEqual(
      refs.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
      [[book, chapter, verseStart, verseEnd]],
    );
  }
});

test("joins a numbered book chapter fragment with a following verse range", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyzeExplicit("Second Kings chapter two", true);
  detector.analyzeExplicit("nineteen to 22", true);

  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [["2 Kings", 2, 19, 22]],
  );
  detector.destroy();
});

test("understands a spoken three-digit Psalm followed by an implicit range", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyzeExplicit("Psalm one thirty nine", true);
  detector.analyzeExplicit("Twenty three twenty four", true);

  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [["Psalms", 139, 23, 24]],
  );
  detector.destroy();
});

test("understands an implicit verse range in one transcript chunk", () => {
  const refs = matchExplicitScriptures("Psalm one thirty nine twenty three twenty four");

  assert.deepEqual(
    refs.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [["Psalms", 139, 23, 24]],
  );
});

test("does not emit a premature single verse while an interim range is forming", () => {
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));

  detector.analyzeExplicit("Psalm one thirty nine", true, true);
  detector.analyzeExplicit("Twenty three", true, true);
  detector.analyzeExplicit("Twenty three twenty four", true, true);

  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
    [["Psalms", 139, 23, 24]],
  );
  detector.destroy();
});

test("normalizes hybrid digit-word numbers produced by STT", () => {
  const cases = [
    "Matthew 2four 14",
    "Matthew twenty4 fourteen",
  ];

  for (const text of cases) {
    const refs = matchExplicitScriptures(text);
    assert.deepEqual(
      refs.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.verseEnd]),
      [["Matthew", 24, 14, undefined]],
    );
  }
});

test("recognizes Psalm 115 ranges across written and spoken number formats", () => {
  for (const text of [
    "Psalms 115:2-13",
    "pslams 115:2–13",
    "Psalm one hundred and fifteen verses two through thirteen",
    "Psalm 115 verses twelve to thirteen",
  ]) {
    const refs = matchExplicitScriptures(text);
    assert.deepEqual(refs.map((r) => [r.book, r.chapter, r.verseStart, r.verseEnd]),
      [["Psalms", 115, text.includes('twelve') ? 12 : 2, 13]], text);
  }
});

test("does not invent a chapter from a corrupted alphanumeric citation", () => {
  assert.deepEqual(matchExplicitScriptures("Psalm 1one512-thirteen says, The Lord has been mindful of you"), []);
});

test("corrupted citations without an AI key stay local", () => {
  const detector = new ScriptureDetector({ apiKey: "" });
  let calls = 0;
  detector.on("processing", () => { calls++; });
  detector.analyze("Psalm 1one512-thirteen says");
  assert.equal(calls, 0);
  detector.destroy();
});

test("destroying a detector suppresses a late model error", async () => {
  const detector = new ScriptureDetector({ apiKey: "test" });
  let reject!: (error: Error) => void;
  Object.assign(detector, { callModel: () => new Promise<string>((_resolve, fail) => { reject = fail; }) });
  const request = (detector as unknown as { runDetection(text: string): Promise<void> }).runDetection("a quotation");
  detector.destroy();
  reject(new Error("late network failure"));
  await assert.doesNotReject(request);
});

test('retries an empty model response in the same detection cycle', async () => {
  const detector = new ScriptureDetector({ apiKey: 'test', minIntervalMs: 0 });
  const emitted: ScriptureReference[] = [];
  detector.on('detection', refs => emitted.push(...refs));
  let calls = 0;
  Object.assign(detector, {
    callModel: async () => {
      calls++;
      return calls === 1
        ? ''
        : JSON.stringify([{ book: 'Acts', chapter: 16, verseStart: 14, confidence: 0.96, detectionType: 'quote', sourceText: 'the Lord opened her heart' }]);
    },
  });

  await (detector as unknown as { runDetection(text: string): Promise<void> }).runDetection('the Lord opened her heart');

  assert.equal(calls, 2);
  assert.deepEqual(emitted.map(ref => [ref.book, ref.chapter, ref.verseStart]), [['Acts', 16, 14]]);
  detector.destroy();
});

test('the default detector throttle permits a fresh final after 1.5 seconds', () => {
  const detector = new ScriptureDetector({ apiKey: 'test' });
  let calls = 0;
  Object.assign(detector, {
    lastCallTime: Date.now() - 1_500,
    runDetection: async () => { calls++; },
  });

  detector.analyze('the Lord opened her heart');

  assert.equal(calls, 1);
  detector.destroy();
});

test('an AI result keeps the transcript origin that started its request', async () => {
  const detector = new ScriptureDetector({ apiKey: 'test', minIntervalMs: 0 });
  let resolve!: (value: string) => void;
  Object.assign(detector, { callModel: () => new Promise<string>(done => { resolve = done; }) });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  detector.beginTranscript({ sttReceivedAt: 100, source: 'final' });
  detector.analyze('the Lord opened her heart');
  detector.beginTranscript({ sttReceivedAt: 200, source: 'interim' });
  resolve(JSON.stringify([{ book: 'Acts', chapter: 16, verseStart: 14, confidence: 0.95, detectionType: 'quote', sourceText: 'opened her heart' }]));
  await new Promise(resolveTick => setImmediate(resolveTick));
  assert.equal(refs[0]?.sttReceivedAt, 100);
  assert.equal(refs[0]?.transcriptSource, 'final');
  detector.destroy();
});

test('a newer explicit citation supersedes an in-flight AI result', async () => {
  const detector = new ScriptureDetector({ apiKey: 'test', minIntervalMs: 0 });
  let resolve!: (value: string) => void;
  Object.assign(detector, { callModel: () => new Promise<string>(done => { resolve = done; }) });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  detector.beginTranscript({ sttReceivedAt: 100, source: 'final' });
  detector.analyze('a remembered quotation');
  detector.beginTranscript({ sttReceivedAt: 200, source: 'interim' });
  detector.analyzeExplicit('John 3:16', true, true);
  resolve(JSON.stringify([{ book: 'Romans', chapter: 8, verseStart: 28, confidence: 0.8, detectionType: 'paraphrase', sourceText: 'all things work' }]));
  await new Promise(resolveTick => setImmediate(resolveTick));
  assert.deepEqual(refs.map(ref => `${ref.book} ${ref.chapter}:${ref.verseStart}`), ['John 3:16']);
  detector.destroy();
});

for (const [speech, book, chapter, verse] of [
  ['Hebrews 13, look at verse number five there', 'Hebrews', 13, 5],
  ['the book of Joshua chapter number 1 and we begin to read from verse 9', 'Joshua', 1, 9],
  ['Hebrews chapter number thirteen and verse five', 'Hebrews', 13, 5],
] as const) {
  test(`detects natural citation: ${speech}`, () => {
    const detector = new ScriptureDetector({ apiKey: '' });
    const refs: ScriptureReference[] = [];
    detector.on('detection', batch => refs.push(...batch));
    detector.analyzeExplicit(speech, true, true);
    assert.deepEqual(refs.map(r => [r.book, r.chapter, r.verseStart]), [[book, chapter, verse]]);
    detector.destroy();
  });
}

test('Acts of the Apostle replaces Exodus context without inventing a verse', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  detector.analyzeExplicit('Exodus 6:9', true);
  detector.analyzeExplicit('Acts of the Apostle chapter 16,', true);
  detector.analyzeExplicit('Lydia the seller of purple', true);
  detector.analyzeExplicit('verse number fourteen', true, true);
  assert.deepEqual(refs.map(r => [r.book, r.chapter, r.verseStart]), [['Exodus', 6, 9], ['Acts', 16, 14]]);
  detector.destroy();
});

test('ordinary numbers cannot become verses of the preceding citation', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  detector.analyzeExplicit('Exodus 6:9', true);
  detector.analyzeExplicit('we have 16 people here', true);
  assert.equal(refs.length, 1);
  detector.destroy();
});

test('rejects nonexistent explicit references and malformed ranges', () => {
  for (const text of ['2 cor 7:100', 'Hebrews 14:5', 'John 3:0', 'John 3:16-100', 'John 3:18-16']) {
    assert.deepEqual(matchExplicitScriptures(text), [], text);
  }
  assert.equal(matchExplicitScriptures('Psalm 119:176').length, 1);
});

test('rejects nonexistent model references before emitting detections', async () => {
  const detector = new ScriptureDetector({ apiKey: 'test' });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  Object.assign(detector, { callModel: async () => JSON.stringify([
    { book: '2 Corinthians', chapter: 7, verseStart: 100, confidence: 0.99, detectionType: 'explicit', sourceText: '2 cor 7:100' },
  ]) });
  await (detector as unknown as { runDetection(text: string): Promise<void> }).runDetection('2 cor 7:100');
  assert.deepEqual(refs, []);
  detector.destroy();
});

test('joins the Hebrews screenshot fragments immediately on the verse cue', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  for (const text of ['Give me Hebrews chapter number thirteen', "and let’s read the Word of God", 'Hebrews 13, look at verse number five there']) {
    detector.analyzeExplicit(text, true, true);
  }
  assert.deepEqual(refs.map(r => [r.book, r.chapter, r.verseStart]), [['Hebrews', 13, 5]]);
  detector.destroy();
});

test('an invalid new chapter cannot reuse the previous book context', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  detector.analyzeExplicit('Exodus chapter six', true);
  detector.analyzeExplicit('Hebrews chapter fourteen verse five', true);
  assert.deepEqual(refs, []);
  detector.destroy();
});

test('rejects reversed contextual ranges instead of silently selecting their start', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const refs: ScriptureReference[] = [];
  detector.on('detection', batch => refs.push(...batch));
  detector.analyzeExplicit('John chapter three', true);
  detector.analyzeExplicit('verse eighteen to sixteen', true);
  assert.deepEqual(refs, []);
  detector.destroy();
});

for (const [segments, book, chapter, start, end] of [
  [['Isaiah 62 verses eleven and', 'twelve.'], 'Isaiah', 62, 11, 12],
  [['Isaiah sixty two', 'eleven and twelve. It reads, and I quote,'], 'Isaiah', 62, 11, 12],
  [['Mark chapter one', 'verse 32 to 39.'], 'Mark', 1, 32, 39],
  [['Mark one', 'thirty two', 'to 39.'], 'Mark', 1, 32, 39],
] as const) {
  test(`completes screenshot range: ${segments.join(' / ')}`, () => {
    const detector = new ScriptureDetector({ apiKey: '' });
    const refs: ScriptureReference[] = [];
    detector.on('detection', batch => refs.push(...batch));
    for (const segment of segments) detector.analyzeExplicit(segment, true);
    assert.deepEqual(refs.slice(-1).map(r => [r.book, r.chapter, r.verseStart, r.verseEnd]), [[book, chapter, start, end]]);
    detector.destroy();
  });
}

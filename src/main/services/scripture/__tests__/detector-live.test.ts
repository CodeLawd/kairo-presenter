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

import assert from "node:assert/strict";
import test from "node:test";

import type { InterimResult, SermonPlan, TranscriptResult } from "../../../../lib/ipc";
import { buildSermonPlanIndex } from "../../../../lib/sermon-plan-match";
import type { ScriptureReference } from "../detector";
import { ScriptureDetector } from "../detector";
import { subscribeExplicitScriptureDetection } from "../live-detection-wiring";

test("a final-only transcript still reaches fast explicit scripture detection", () => {
  let finalListener: ((result: TranscriptResult) => void) | null = null;
  let interimListener: ((result: InterimResult) => void) | null = null;
  const source = {
    onTranscript(listener: (result: TranscriptResult) => void) {
      finalListener = listener;
    },
    offTranscript() {
      finalListener = null;
    },
    onInterim(listener: (result: InterimResult) => void) {
      interimListener = listener;
    },
    offInterim() {
      interimListener = null;
    },
  };
  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));
  const unsubscribe = subscribeExplicitScriptureDetection(source, detector);

  assert.ok(finalListener);
  (finalListener as (result: TranscriptResult) => void)({
    id: "final-1",
    text: "Ezekiel twenty one twenty seven",
    words: [],
    timestamp: Date.now(),
    duration: 0,
    isFinal: true,
  });

  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart]),
    [["Ezekiel", 21, 27]],
  );
  unsubscribe();
  assert.equal(finalListener, null);
  assert.equal(interimListener, null);
  detector.destroy();
});

test("plan-quote matching runs on finals only, and never alongside a citation", () => {
  let finalListener: ((result: TranscriptResult) => void) | null = null;
  let interimListener: ((result: InterimResult) => void) | null = null;
  const source = {
    onTranscript(listener: (result: TranscriptResult) => void) {
      finalListener = listener;
    },
    offTranscript() {
      finalListener = null;
    },
    onInterim(listener: (result: InterimResult) => void) {
      interimListener = listener;
    },
    offInterim() {
      interimListener = null;
    },
  };

  const plan: SermonPlan = {
    id: "plan-1",
    title: "Sunday",
    sourceFileName: "notes.docx",
    createdAt: 0,
    updatedAt: 0,
    items: [
      {
        id: "item-1",
        reference: "Romans 8:28",
        translation: "NKJV",
        available: true,
        verses: [
          {
            book: "Romans",
            chapter: 8,
            verse: 28,
            text: "And we know that all things work together for good to those who love God, to those who are the called according to His purpose.",
          },
        ],
      },
    ],
  };
  const index = buildSermonPlanIndex(plan);

  const detector = new ScriptureDetector({ apiKey: "test-key" });
  detector.setPlanIndexProvider(() => index);
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));
  const unsubscribe = subscribeExplicitScriptureDetection(source, detector);

  const sendFinal = (text: string): void =>
    (finalListener as unknown as (result: TranscriptResult) => void)({
      id: `final-${text.slice(0, 8)}`,
      text,
      words: [],
      timestamp: Date.now(),
      duration: 0,
      isFinal: true,
    });

  // Interim speech never reaches the quote path.
  (interimListener as unknown as (result: InterimResult) => void)({
    text: "and we know that all things work together for good to those who love God",
    stability: 0.5,
    timestamp: Date.now(),
  });
  assert.equal(emitted.length, 0);

  // Reading the verse without naming it resolves from the playlist.
  sendFinal("and we know that all things work together for good to those who love God");
  assert.deepEqual(
    emitted.map((ref) => [ref.book, ref.chapter, ref.verseStart, ref.detectionType]),
    [["Romans", 8, 28, "quote"]],
  );

  // The spoken citation for the same verse is deduplicated, not emitted twice.
  emitted.length = 0;
  sendFinal("Romans chapter eight verse twenty eight");
  assert.equal(emitted.length, 0);

  unsubscribe();
  detector.destroy();
});

test("with no live playlist the quote path is inert", () => {
  let finalListener: ((result: TranscriptResult) => void) | null = null;
  const source = {
    onTranscript(listener: (result: TranscriptResult) => void) {
      finalListener = listener;
    },
    offTranscript() {
      finalListener = null;
    },
    onInterim() {},
    offInterim() {},
  };

  const detector = new ScriptureDetector({ apiKey: "test-key" });
  const emitted: ScriptureReference[] = [];
  detector.on("detection", (refs) => emitted.push(...refs));
  const unsubscribe = subscribeExplicitScriptureDetection(source, detector);

  (finalListener as unknown as (result: TranscriptResult) => void)({
    id: "final-1",
    text: "and we know that all things work together for good to those who love God",
    words: [],
    timestamp: Date.now(),
    duration: 0,
    isFinal: true,
  });

  assert.equal(emitted.length, 0);
  unsubscribe();
  detector.destroy();
});

test("corrupted final citations reach contextual analysis without waiting for the buffer", () => {
  let finalListener!: (result: TranscriptResult) => void;
  let interimListener!: (result: InterimResult) => void;
  const source = {
    onTranscript(cb: typeof finalListener) { finalListener = cb; }, offTranscript() {},
    onInterim(cb: typeof interimListener) { interimListener = cb; }, offInterim() {},
  };
  const detector = new ScriptureDetector({ apiKey: 'test-key' });
  const analyzed: string[] = [];
  detector.analyze = (text) => { analyzed.push(text); };
  const unsubscribe = subscribeExplicitScriptureDetection(source, detector);
  const text = 'Psalm 1one512-thirteen says, The Lord has been mindful of you';
  interimListener({ text, stability: 0.8, timestamp: Date.now() });
  assert.deepEqual(analyzed, []);
  finalListener({ text, id: 'corrupt', words: [], timestamp: Date.now(), duration: 2, isFinal: true });
  assert.deepEqual(analyzed, [text]);
  unsubscribe();
  detector.destroy();
});

test('a quote updates sermon progress even when its detection is deduplicated', () => {
  const detector = new ScriptureDetector({ apiKey: '' });
  const text = 'And we know that all things work together for good to those who love God';
  const index = buildSermonPlanIndex({ id: 'plan', title: 'Sunday', sourceFileName: 'notes', createdAt: 0, updatedAt: 0, items: [{ id: 'item', reference: 'Romans 8:28', translation: 'NKJV', available: true, verses: [{ book: 'Romans', chapter: 8, verse: 28, text }] }] });
  detector.setPlanIndexProvider(() => index);
  const progress: string[] = [];
  detector.on('planProgress', reference => progress.push(reference));
  detector.analyzeExplicit('Romans 8:28', true);
  detector.analyzePlanQuote(text);
  assert.deepEqual(progress, ['Romans 8:28']);
  detector.destroy();
});

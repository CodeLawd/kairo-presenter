import assert from "node:assert/strict";
import test from "node:test";

import type { InterimResult, TranscriptResult } from "../../../../lib/ipc";
import type { ScriptureReference } from "../detector";
import { ScriptureDetector } from "../detector";
import { subscribeExplicitScriptureDetection } from "../live-detection-wiring";

interface Harness {
  detector: ScriptureDetector;
  emitted: ScriptureReference[];
  sendInterim: (text: string) => void;
  sendFinal: (text: string) => void;
  unsubscribe: () => void;
}

function harness(): Harness {
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

  return {
    detector,
    emitted,
    sendInterim: (text) =>
      interimListener?.({ text, stability: 0.9, timestamp: Date.now() }),
    sendFinal: (text) =>
      finalListener?.({
        id: `f-${Math.random()}`,
        text,
        words: [],
        isFinal: true,
        timestamp: Date.now(),
        duration: 1,
      }),
    unsubscribe,
  };
}

test("an explicit citation carries the moment its transcript arrived", () => {
  const h = harness();
  const before = Date.now();
  h.sendInterim("turn with me to Romans 8:28");
  const after = Date.now();
  h.unsubscribe();

  assert.equal(h.emitted.length, 1);
  const ref = h.emitted[0];
  assert.equal(ref.book, "Romans");
  assert.equal(ref.chapter, 8);
  assert.equal(ref.verseStart, 28);

  // The whole point of the trace: latency is measured from when Kairo received
  // the transcript, not from when the parser happened to run.
  assert.ok(ref.sttReceivedAt !== undefined, "sttReceivedAt stamped");
  assert.ok(
    ref.sttReceivedAt! >= before && ref.sttReceivedAt! <= after,
    "stamped at receipt, within this call",
  );
  assert.equal(ref.transcriptSource, "interim");
  assert.ok(ref.detectionStartedAt !== undefined, "detectionStartedAt stamped");
  assert.ok(
    ref.detectionStartedAt! >= ref.sttReceivedAt!,
    "parsing cannot start before the transcript arrived",
  );
});

test("a final transcript is labelled as final, not interim", () => {
  const h = harness();
  h.sendFinal("let us read John 3:16");
  h.unsubscribe();

  assert.equal(h.emitted.length, 1);
  assert.equal(h.emitted[0].transcriptSource, "final");
});

test("the explicit path never reaches the model", async () => {
  // The architectural guarantee this whole feature rests on: a spoken citation
  // resolves locally. If someone later routes it through the LLM, the fast path
  // silently becomes a network round trip and this test is what catches it.
  const h = harness();
  let modelCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    modelCalls += 1;
    throw new Error(`unexpected network call: ${String(args[0])}`);
  }) as typeof fetch;

  try {
    h.sendInterim("turn with me to Romans 8:28");
    h.sendInterim("and also Psalm 23:1");
    // Give any accidental async work a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = originalFetch;
    h.unsubscribe();
  }

  assert.equal(modelCalls, 0, "no network call on the explicit path");
  assert.equal(h.emitted.length, 2, "both citations resolved locally");
});

test("interim transcripts without a citation produce nothing to trace", () => {
  // Traces are created per detection, never per transcript — interims arrive
  // several times a second and would otherwise flood the ring buffer.
  const h = harness();
  h.sendInterim("good morning everyone it is good to see you all here today");
  h.sendInterim("we are going to talk about faith this morning");
  h.unsubscribe();

  assert.equal(h.emitted.length, 0);
});

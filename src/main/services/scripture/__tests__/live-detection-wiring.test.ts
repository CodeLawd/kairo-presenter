import assert from "node:assert/strict";
import test from "node:test";

import type { InterimResult, TranscriptResult } from "../../../../lib/ipc";
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

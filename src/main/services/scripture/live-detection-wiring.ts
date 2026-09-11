import type { InterimResult, TranscriptResult } from "@shared/ipc";
import { hasCorruptedScriptureCitation, type ScriptureDetector } from "./detector";

interface LiveTranscriptSource {
  onTranscript(callback: (result: TranscriptResult) => void): void;
  offTranscript(callback: (result: TranscriptResult) => void): void;
  onInterim(callback: (result: InterimResult) => void): void;
  offInterim(callback: (result: InterimResult) => void): void;
}

export function subscribeExplicitScriptureDetection(
  source: LiveTranscriptSource,
  detector: ScriptureDetector,
): () => void {
  let recoveryText = "";
  let recoveryStartedAt = 0;
  let recentFinalText = "";
  let recentFinalAt = 0;
  const analyzeFinal = (result: TranscriptResult): void => {
    // Stamped here, at the edge, because this is the first moment Kairo holds
    // the transcript. Anything measured from later would flatter the parser.
    detector.beginTranscript({ sttReceivedAt: Date.now(), source: "final" });
    // Explicit citations run first so they claim the dedup slot with the
    // authoritative range; the plan-quote path only covers reading that was
    // never announced. Interims stay citation-only — half-sentences would
    // retrigger the quote matcher on every partial update.
    if (detector.analyzeExplicit(result.text, true, false)) {
      recoveryText = "";
      recentFinalText = "";
      return;
    }
    if (detector.analyzePlanQuote(result.text)) return;
    // Ask for contextual recovery on finals; never guess a split for damaged numbers.
    const now = Date.now();
    if (now - recoveryStartedAt > 12_000) recoveryText = "";
    if (hasCorruptedScriptureCitation(result.text)) {
      recoveryText = result.text;
      recoveryStartedAt = now;
    } else if (recoveryText) {
      recoveryText = `${recoveryText} ${result.text}`.slice(-1200);
    }
    if (recoveryText && detector.analyzeQuoteRecovery(recoveryText)) {
      recoveryText = "";
      return;
    }
    if (recoveryText) {
      detector.analyze(recoveryText);
      return;
    }

    // Feed every final segment into the detector immediately. The detector
    // coalesces rapid updates and enforces its own short request interval, so
    // quote/paraphrase detection no longer waits for the buffer's 8-second tick.
    if (now - recentFinalAt > 12_000) recentFinalText = "";
    recentFinalAt = now;
    recentFinalText = `${recentFinalText} ${result.text}`.trim().slice(-1_200);
    detector.analyze(recentFinalText);
  };
  const analyzeInterim = (result: InterimResult): void => {
    detector.beginTranscript({ sttReceivedAt: Date.now(), source: "interim" });
    detector.analyzeExplicit(result.text, true, true);
  };
  source.onTranscript(analyzeFinal);
  source.onInterim(analyzeInterim);
  return () => {
    source.offTranscript(analyzeFinal);
    source.offInterim(analyzeInterim);
  };
}

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
  const analyzeFinal = (result: TranscriptResult): void => {
    // Explicit citations run first so they claim the dedup slot with the
    // authoritative range; the plan-quote path only covers reading that was
    // never announced. Interims stay citation-only — half-sentences would
    // retrigger the quote matcher on every partial update.
    if (detector.analyzeExplicit(result.text, true, false)) return;
    if (detector.analyzePlanQuote(result.text)) return;
    // Ask for contextual recovery on finals; never guess a split for damaged numbers.
    if (hasCorruptedScriptureCitation(result.text)) detector.analyze(result.text);
  };
  const analyzeInterim = (result: InterimResult): void => {
    detector.analyzeExplicit(result.text, true, true);
  };
  source.onTranscript(analyzeFinal);
  source.onInterim(analyzeInterim);
  return () => {
    source.offTranscript(analyzeFinal);
    source.offInterim(analyzeInterim);
  };
}

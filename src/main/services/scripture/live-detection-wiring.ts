import type { InterimResult, TranscriptResult } from "@shared/ipc";
import type { ScriptureDetector } from "./detector";

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
    detector.analyzeExplicit(result.text, true, false);
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

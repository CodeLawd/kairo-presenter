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
  // Every local resolution consumes the speech behind it, so neither the
  // window pass nor the model re-reads a verse the operator already has.
  const settle = (): void => {
    recoveryText = "";
    recentFinalText = "";
  };
  const analyzeFinal = (result: TranscriptResult): void => {
    // Stamped here, at the edge, because this is the first moment Kairo holds
    // the transcript. Anything measured from later would flatter the parser.
    detector.beginTranscript({ sttReceivedAt: Date.now(), source: "final" });
    // Explicit citations run first so they claim the dedup slot with the
    // authoritative range; the plan-quote path only covers reading that was
    // never announced. Interims stay citation-only — half-sentences would
    // retrigger the quote matcher on every partial update.
    if (detector.analyzeExplicit(result.text, true, false)) {
      settle();
      return;
    }
    // Every final joins the model's context — including a chapter-only
    // citation, which previously vanished here and took any quote spoken
    // with it ("In John 3 Jesus says, for God so loved…").
    const now = Date.now();
    if (now - recentFinalAt > 12_000) recentFinalText = "";
    recentFinalAt = now;
    recentFinalText = `${recentFinalText} ${result.text}`.trim().slice(-1_200);

    // A named chapter scopes a local quote match, which needs no model call.
    if (detector.analyzeChapterQuote(result.text)) {
      settle();
      return;
    }
    // Deepgram can finalize "Isaiah forty nine" just before "fourteen to
    // twenty six". Hold the model back for one segment so it cannot guess while
    // the range is still arriving; the next final carries this text with it.
    // If no verse comes, the detector falls back to Isaiah 49:1 by itself.
    if (detector.holdIncompleteCitation(result.text)) return;
    if (detector.analyzePlanQuote(result.text)) {
      settle();
      return;
    }
    // Ask for contextual recovery on finals; never guess a split for damaged numbers.
    if (now - recoveryStartedAt > 12_000) recoveryText = "";
    if (hasCorruptedScriptureCitation(result.text)) {
      recoveryText = result.text;
      recoveryStartedAt = now;
    } else if (recoveryText) {
      recoveryText = `${recoveryText} ${result.text}`.slice(-1200);
    }
    if (recoveryText && detector.analyzeQuoteRecovery(recoveryText)) {
      settle();
      return;
    }
    if (recoveryText) {
      detector.analyze(recoveryText);
      return;
    }

    // A citation split across finals ("Paul writes in Romans" | "8, verse 28").
    if (detector.analyzeWindowCitation(recentFinalText)) {
      settle();
      return;
    }
    // Feed every final segment into the detector immediately. The detector
    // coalesces rapid updates and enforces its own short request interval, so
    // quote/paraphrase detection no longer waits for the buffer's 8-second tick.
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

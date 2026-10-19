import { dispatchToOutputs } from './services/output/dispatch';
import { dispatchHealth } from '@shared/output-health';
import { singleVerseSuggestion } from "@shared/single-verse-presentation";
import path from "path";
import fs from "fs";
import { app } from "electron";
import log from "electron-log/main";
import type {
  OrchestratorConfig,
  SessionStats,
  ServiceHealth,
  ServiceName,
  OrchestratorStatus,
  PendingAutoPresent,
  ScriptureSuggestion,
  ScriptureTranslation,
  ScriptureVerse,
  AppSettings,
  OverlayContentKind,
  OverlayDispatchResult,
  OverlayOutput,
  OverlayOutputKind,
  OverlayTheme,
} from "@shared/ipc";
import { normalizeOverlaySettings } from "@shared/overlay-defaults";
import { outputThemeFor } from "@shared/overlay-outputs";
import { formatOverlayReference, formatOverlayVerseText } from "@shared/overlay-content";
import { ScriptureDetector } from "./services/scripture/detector";
import { subscribeExplicitScriptureDetection } from "./services/scripture/live-detection-wiring";
import { scriptureTrace } from "./services/scripture/trace";
import { livePlanService } from "./services/scripture/live-plan";
import { matchPlanReference } from "@shared/sermon-plan-match";
import {
  canAutoPresentScriptureReference,
  type DetectorStats,
  type ScriptureReference,
} from "./services/scripture/detector";
import { BibleDatabase } from "./services/scripture/bible-db";
import { audioService } from "./services/audio";
import { sttService } from "./services/stt";
import { scriptureService } from "./services/scripture";
import { lookupDetectedScripture, lookupWithTranslationFallback } from "./services/scripture/detection-lookup";
import { scriptureKeyterms } from "./services/stt/keyterms";
import { resilienceManager } from "./services/resilience";
import { mediaService } from "./services/media";
import { themeForPush } from "@shared/media-playback";
import { surfaceManager, type SurfaceTarget } from "./services/output/surface-manager";
import { programService } from "./services/output/program-service";
import type { OutputShowFilter, ProgramSlideInfo } from "@shared/program";
import { store } from "./db";
import { usageService } from "./services/usage";

/**
 * Lays the background pushed from the Media dock under a theme.
 *
 * Backgrounds live outside themes on purpose: a lyric theme is text only,
 * while the loop behind it changes every song. Scripture may still bake in a
 * look of its own. `force` is for the two cases where the dock must win: the
 * dock's own push, and a lyric slide (which must never resurrect a scripture
 * image over the file the operator just sent).
 */
/**
 * `theme` with the dock's live background applied per `themeForPush`: a theme
 * with its own background outranks the dock (scripture over a running song
 * keeps the scripture look, a song theme with a background keeps its own); a
 * transparent theme takes it; `force` is the dock's own "present this background" action.
 */
function withLiveBackground(theme: OverlayTheme, force = false, showsBackgrounds = true): OverlayTheme {
  const live = mediaService.getLiveItem();
  return themeForPush(theme, {
    showsBackgrounds,
    live,
    playback: live ? mediaService.getPlayback(live.id) : undefined,
    force,
  });
}

/** Verse content formatted once per push and shared by every destination. */
interface PushContent {
  /** Reference line as it should read on screen, translation suffix included. */
  reference: string;
  /** Verse body, verse numbers and maxVerses truncation already applied. */
  text: string;
  /** Lyric gloss / paint colors, parallel to `text` lines. */
  coloredLines?: Array<{ text: string; color?: string }>;
}

interface PreparedScriptureProjection {
  suggestion: ScriptureSuggestion;
  content: PushContent;
}

/** Why a rendered output's window could not take a slide; NDI falls back to "NDI sender unavailable". */
const SURFACE_GONE: Partial<Record<OverlayOutputKind, string>> = {
  screen: "Screen window is not available",
  device: "Video card surface is not available",
};

// ─── Constants ────────────────────────────────────────────────────────────────

// Haiku: ~$0.80/MTok input, ~$4.00/MTok output
// ~900 tokens input (system prompt + context), ~150 tokens output per call
const COST_PER_CALL_USD = (900 * 0.8 + 150 * 4.0) / 1_000_000;

// ─── Callback types ───────────────────────────────────────────────────────────

type StatusCallback = (status: OrchestratorStatus) => void;
type PendingAutoCallback = (pending: PendingAutoPresent) => void;

// ─── Session shape (internal) ─────────────────────────────────────────────────

interface Session {
  sessionId: string;
  startedAt: number;
  totalDetections: number;
  totalPresentations: number;
  detectorCalls: number;
  avgDetectorLatencyMs: number;
  startHistoryLength: number;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

class Orchestrator {
  private cfg: OrchestratorConfig | null = null;
  private running = false;
  private db: BibleDatabase | null = null;
  public detector: ScriptureDetector | null = null;

  private health = new Map<ServiceName, ServiceHealth>();

  private autoTimers = new Map<string, NodeJS.Timeout>();
  private pendingSuggestions = new Map<string, ScriptureSuggestion>();
  /**
   * The verse behind each suggestion card, so dismissing the card can release
   * the detector's dedup. Kept after the card is presented too (unlike
   * pendingSuggestions): the card stays on the Operator and can still be
   * dismissed. Cleared with the session.
   */
  private suggestionRefs = new Map<
    string,
    Pick<ScriptureReference, "book" | "chapter" | "verseStart">
  >();

  private session: Session | null = null;

  private explicitDetectionCleanup: (() => void) | null = null;

  private statusCallbacks: StatusCallback[] = [];
  private pendingAutoCallbacks: PendingAutoCallback[] = [];

  constructor() {
    this.initHealth();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  onStatus(callback: StatusCallback): void {
    this.statusCallbacks.push(callback);
  }

  onPendingAuto(callback: PendingAutoCallback): void {
    this.pendingAutoCallbacks.push(callback);
  }

  getStatus(): OrchestratorStatus {
    return {
      running: this.running,
      autoMode: this.cfg?.autoMode ?? false,
      health: Array.from(this.health.values()),
      totalPresentations: this.session?.totalPresentations ?? 0,
    };
  }

  getStats(): SessionStats | null {
    if (!this.session) return null;
    const history = sttService
      .getHistory()
      .slice(this.session.startHistoryLength);
    const totalWords = history.reduce(
      (sum, r) =>
        sum + (r.words?.length ?? r.text.split(/\s+/).filter(Boolean).length),
      0,
    );
    return {
      sessionId: this.session.sessionId,
      startedAt: this.session.startedAt,
      durationMs: Date.now() - this.session.startedAt,
      totalWords,
      totalDetections: this.session.totalDetections,
      totalPresentations: this.session.totalPresentations,
      detectorCalls: this.session.detectorCalls,
      avgDetectorLatencyMs: this.session.avgDetectorLatencyMs,
      estimatedCostUsd: this.session.detectorCalls * COST_PER_CALL_USD,
    };
  }

  async start(config: OrchestratorConfig): Promise<void> {
    if (this.running) {
      await this.stop();
    }

    this.cfg = config;
    log.info("[Orchestrator] Starting", {
      provider: config.sttProvider,
      lang: config.sttLanguage,
    });

    // Open bible DB
    try {
      const dbPath = this.resolveBibleDbPath();
      this.db = new BibleDatabase(dbPath);
    } catch (err) {
      const msg = (err as Error).message;
      log.error("[Orchestrator] BibleDB open failed", msg);
      this.updateHealth("detector", "error", msg);
    }

    this.createDetector(config);
    if (config.llmApiKey) this.updateHealth("detector", "ok");

    // Configure STT
    this.configureStt(config);

    // Start STT (connects Deepgram WebSocket)
    try {
      await sttService.start();
      this.updateHealth("stt", "ok");
    } catch (err) {
      const msg = (err as Error).message;
      log.error("[Orchestrator] STT start failed", msg);
      this.updateHealth("stt", "error", msg);
    }

    this.attachAudioStream();

    // Init session
    this.session = {
      sessionId: `session-${Date.now()}`,
      startedAt: Date.now(),
      totalDetections: 0,
      totalPresentations: 0,
      detectorCalls: 0,
      avgDetectorLatencyMs: 0,
      startHistoryLength: sttService.getHistory().length,
    };

    // Register state serialization callback with resilienceManager
    resilienceManager.registerStateCallback(() => {
      if (!this.running || !this.session) return null;
      return {
        session: this.session,
        pendingSuggestions: Array.from(this.pendingSuggestions.values()),
        transcriptHistory: sttService.getHistory(),
        config: this.cfg,
      };
    });

    this.running = true;
    this.emitStatus();
    log.info("[Orchestrator] Started", { sessionId: this.session.sessionId });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    log.info("[Orchestrator] Stopping");
    this.running = false;

    // Cancel all auto-present countdowns
    for (const [id, timer] of this.autoTimers) {
      clearTimeout(timer);
      log.debug("[Orchestrator] Auto-present cancelled on stop", { id });
    }
    this.autoTimers.clear();
    this.pendingSuggestions.clear();
    this.suggestionRefs.clear();

    // Detach audio PCM stream from Deepgram
    sttService.deepgram.detachStream();

    // Stop audio capture
    try {
      await audioService.stopCapture();
    } catch (err) {
      log.error("[Orchestrator] Audio stop error", (err as Error).message);
    }

    // Stop STT
    sttService.stop();

    this.explicitDetectionCleanup?.();
    this.explicitDetectionCleanup = null;

    resilienceManager.registerStateCallback(null);

    // Tear down detector
    if (this.detector) {
      this.detector.destroy();
      this.detector = null;
    }

    // Close DB
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.running = false;
    this.emitStatus();

    const stats = this.getStats();
    if (stats) {
      log.info("[Orchestrator] Session complete", {
        durationSec: Math.round(stats.durationMs / 1000),
        words: stats.totalWords,
        detections: stats.totalDetections,
        presentations: stats.totalPresentations,
        costUsd: stats.estimatedCostUsd.toFixed(4),
      });
    }

    this.session = null;
  }

  async approveSuggestion(suggestionId: string): Promise<void> {
    const suggestion = this.pendingSuggestions.get(suggestionId);
    if (suggestion) {
      this.cancelAutoPresent(suggestionId);
      this.pendingSuggestions.delete(suggestionId);
      scriptureService.dismissSuggestion(suggestionId);
      usageService.track("scripture_manual");
      await this.presentScripture(suggestion);
      return;
    }

    // Manual search suggestion from scriptureService
    const manual = scriptureService.getPendingSuggestion(suggestionId);
    if (manual) {
      scriptureService.dismissSuggestion(suggestionId);
      usageService.track("scripture_manual");
      await this.presentScripture(manual);
    }
  }

  dismissSuggestion(suggestionId: string): void {
    this.cancelAutoPresent(suggestionId);
    this.pendingSuggestions.delete(suggestionId);
    // The card is gone, so the next time the preacher says this verse it must
    // come back instead of being swallowed as a duplicate.
    const ref = this.suggestionRefs.get(suggestionId);
    if (ref) this.detector?.release(ref);
    this.suggestionRefs.delete(suggestionId);
    scriptureService.dismissSuggestion(suggestionId);
  }

  /**
   * Keeps the running session's automation flag in sync with the Operator's
   * toggle. Without this `cfg` only ever reflects the value captured at
   * `start()`, so flipping Automation mid-service had no effect on auto-push.
   */
  setAutoMode(enabled: boolean): void {
    if (this.cfg) this.cfg.autoMode = enabled;
  }

  setConfidenceThreshold(threshold: number): void {
    if (this.cfg) this.cfg.confidenceThreshold = Math.max(0, Math.min(1, threshold));
  }

  setScriptureTranslation(translation: AppSettings["scripture"]["defaultTranslation"]): void {
    if (this.cfg) this.cfg.scriptureTranslation = translation;
  }

  dismissAuto(suggestionId: string): void {
    this.cancelAutoPresent(suggestionId);
    log.info("[Orchestrator] Auto-present dismissed by user", { suggestionId });
  }

  /**
   * Configures transcription with book names boosted, the live playlist's own
   * books first. Deepgram fixes keyterms per connection, so choosing a
   * different playlist mid-service takes effect from the next start.
   */
  private configureStt(config: OrchestratorConfig): void {
    const playlistBooks =
      livePlanService.getIndex()?.ordered.map((entry) => entry.verse.book) ?? [];
    sttService.configure(
      config.sttProvider,
      config.sttApiKey,
      config.sttLanguage,
      scriptureKeyterms(config.sttLanguage, playlistBooks),
    );
  }

  /**
   * Builds the detector and subscribes it to live transcription. It is built
   * even without an LLM key so the local citation parser, chapter-quote match
   * and live-playlist match still drive the Operator.
   */
  private createDetector(config: OrchestratorConfig): void {
    this.explicitDetectionCleanup?.();
    this.detector?.destroy();
    this.suggestionRefs.clear();

    const detector = new ScriptureDetector({
      provider: config.llmProvider,
      apiKey: config.llmApiKey,
      model: config.scriptureModel,
    });
    this.detector = detector;
    detector.setPlanIndexProvider(() => livePlanService.getIndex());
    detector.setQuoteSearchProvider(phrase => scriptureService.searchLocalQuoteCandidates(phrase));
    detector.setChapterVerseProvider((book, chapter) => scriptureService.getLocalChapterVerses(book, chapter));
    detector.on("planProgress", (reference, itemId) => livePlanService.observe(reference, itemId));

    detector.on("detection", (refs) => {
      this.handleDetection(refs).catch((err) =>
        log.error("[Orchestrator] handleDetection error", (err as Error).message),
      );
    });

    detector.on("requestSuccess", () => {
      resilienceManager.handleClaudeSuccess();
    });

    detector.on("stats", (stats: DetectorStats) => {
      if (this.session) {
        this.session.detectorCalls = stats.totalCalls;
        this.session.avgDetectorLatencyMs = stats.averageLatencyMs;
      }
    });

    detector.on("error", (err: Error) => {
      log.error("[Orchestrator] Detector error", err.message);
      this.updateHealth("detector", "error", err.message);
      this.emitStatus();
      resilienceManager.handleClaudeError(err);
    });

    // Final transcript events drive analysis directly through the live wiring.
    // Keeping the older buffer timer attached here would duplicate model calls
    // and reintroduce an avoidable delay.
    this.explicitDetectionCleanup = subscribeExplicitScriptureDetection(
      sttService,
      detector,
    );
  }

  // ─── Detection handler ─────────────────────────────────────────────────────

  private async handleDetection(refs: ScriptureReference[]): Promise<void> {
    if (!this.cfg || !this.running) return;
    const detectionSession = this.session;

    // One pass per translation the preacher named ("John 3:16 in the NLT and
    // the NIV"); a reference with none named takes the playlist's or default.
    const requests = refs.flatMap((ref) =>
      (ref.translations?.length ? ref.translations : [null]).map((requested) => ({ ref, requested })),
    );
    for (const { ref, requested } of requests) {
      const correlationId = scriptureTrace.start({
        reference: `${ref.book} ${ref.chapter}:${ref.verseStart}${ref.verseEnd != null ? `-${ref.verseEnd}` : ""}`,
        sourceText: ref.sourceText,
        resolver: ref.resolver ?? (ref.detectionType === "quote" ? "quotation-local" : "explicit"),
        transcriptSource: ref.transcriptSource,
        sttReceivedAt: ref.sttReceivedAt,
        detectionStartedAt: ref.detectionStartedAt,
        autoPresentDelayMs: (this.cfg.autoPresentDelaySec ?? 1) * 1_000,
      });

      // Live sermon playlist first: its verses are already resolved, in the
      // translation the preacher chose, so a hit skips the Bible lookup
      // entirely. A miss — or a range the playlist only partly covers — falls
      // through to the normal path untouched, so off-plan verses still detect.
      // A named translation only takes the playlist's copy in that translation.
      const planEntries = matchPlanReference(livePlanService.getIndex(), ref, requested ?? undefined);
      const planEntry = planEntries[0] ?? null;
      // Progress follows the playlist even when the verse is asked for in a
      // translation the playlist doesn't hold.
      const progressEntry = planEntry ?? (requested ? matchPlanReference(livePlanService.getIndex(), ref)[0] ?? null : null);
      if (progressEntry) livePlanService.observe(progressEntry.reference, progressEntry.planItemId);
      let translation = requested ?? (planEntry ? planEntry.translation : this.cfg.scriptureTranslation);
      let requestedTranslation: string | undefined;
      scriptureTrace.annotate(correlationId, { translation });
      let verses: ScriptureVerse[] = planEntries.map((entry) => entry.verse);

      scriptureTrace.mark(correlationId, "bibleLookupStartedAt");
      if (verses.length === 0) {
        const found = await lookupWithTranslationFallback(
          async (candidate) => {
            try {
              return await lookupDetectedScripture(
                scriptureService,
                ref,
                candidate,
                store.get("stt").bibleApiKey,
              );
            } catch (err) {
              log.warn("[Orchestrator] Bible lookup error", {
                book: ref.book,
                err: (err as Error).message,
              });
              return [];
            }
          },
          translation,
          requested,
          this.cfg.scriptureTranslation,
        );
        verses = found.verses;
        translation = found.translation;
        requestedTranslation = found.requestedTranslation;
        scriptureTrace.annotate(correlationId, { translation });
      }

      scriptureTrace.mark(correlationId, "bibleLookupCompletedAt");

      // A lookup can finish after stop or after another service has started.
      if (!this.running || this.session !== detectionSession) {
        scriptureTrace.complete(correlationId, { status: "superseded" });
        return;
      }

      if (verses.length === 0) {
        scriptureTrace.complete(correlationId, {
          status: "failed",
          failureReason: "verse-not-found",
          error: `${translation} text is not available locally for this reference`,
        });
        // No card reached the operator; let the next mention try again.
        this.detector?.release(ref);
        continue;
      }

      // One Operator suggestion per verse — never jumble a range into a single card
      const requestedVerseItems: ScriptureVerse[] =
        verses.length > 0
          ? verses
          : ref.verseEnd != null && ref.verseEnd > ref.verseStart
            ? Array.from(
                { length: ref.verseEnd - ref.verseStart + 1 },
                (_, i) =>
                  ({
                    book: ref.book,
                    chapter: ref.chapter,
                    verse: ref.verseStart + i,
                    text: "",
                  }) satisfies ScriptureVerse,
              )
            : [
                {
                  book: ref.book,
                  chapter: ref.chapter,
                  verse: ref.verseStart,
                  text: "",
                } satisfies ScriptureVerse,
              ];

      const verseItems = requestedVerseItems;

      const passageId = `${ref.book.toLowerCase().replace(/\s+/g, "-")}-${ref.chapter}-${ref.verseStart}-${ref.verseEnd ?? ref.verseStart}-${translation.toLowerCase()}-${Date.now()}`;
      const passageReference =
        ref.verseEnd != null && ref.verseEnd > ref.verseStart
          ? `${ref.book} ${ref.chapter}:${ref.verseStart}-${ref.verseEnd}`
          : `${ref.book} ${ref.chapter}:${ref.verseStart}`;

      for (const [verseIndex, verse] of verseItems.entries()) {
        const suggestion: ScriptureSuggestion = {
          // Only the first verse of a passage owns the trace: the rest are
          // separate cards produced by the same detection, and counting them
          // all would multiply one citation into several latency samples.
          correlationId: verseIndex === 0 ? correlationId : undefined,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
          verses: verse.text ? [verse] : [],
          translation,
          ...(requestedTranslation ? { requestedTranslation } : {}),
          confidence: ref.confidence,
          source: "auto",
          triggerText: ref.sourceText,
          passageId,
          passageReference,
          passageIndex: verseIndex,
          passageLength: verseItems.length,
          ...(planEntry
            ? {
                planId: planEntry.planId,
                planItemId: planEntry.planItemId,
                planMatch:
                  ref.detectionType === "quote"
                    ? ("quote" as const)
                    : ("reference" as const),
              }
            : {}),
        };

        this.pendingSuggestions.set(suggestion.id, suggestion);
        this.suggestionRefs.set(suggestion.id, {
          book: ref.book,
          chapter: ref.chapter,
          verseStart: verse.verse,
        });
        if (this.session) this.session.totalDetections++;

        // Publish through scriptureService so existing IPC/renderer pipeline works
        scriptureService.receiveSuggestion(suggestion);
        if (verseIndex === 0) {
          scriptureTrace.mark(correlationId, "suggestionPublishedAt");
        }

        if (
          this.cfg.autoMode &&
          verseIndex === 0 &&
          verseItems.length === 1 &&
          canAutoPresentScriptureReference(ref) &&
          ref.confidence >= (this.cfg.confidenceThreshold ?? 0.7)
        ) {
          const prepared = this.prepareScriptureProjection(suggestion);
          if (prepared) this.scheduleAutoPresent(prepared);
        }
      }

      this.updateHealth("detector", "ok");
    }

    this.emitStatus();
  }

  // ─── Auto-present countdown ────────────────────────────────────────────────

  /**
   * The operator's window to cancel before a verse reaches the congregation.
   *
   * This delay is the largest single component of user-visible latency, and it
   * is deliberate — see `scripture.autoPresentDelaySec`. It is not something to
   * optimize away.
   *
   * There is no per-verse stagger: the caller only schedules single-verse
   * detections (`verseItems.length === 1`), so a multi-verse passage is
   * suggested but never auto-presented. A `staggerIndex` multiplier used to live
   * here for a sequence that no code path could produce.
   */
  private scheduleAutoPresent(prepared: PreparedScriptureProjection): void {
    const { suggestion } = prepared;
    const delayMs = (this.cfg?.autoPresentDelaySec ?? 1) * 1_000;
    const expiresAt = Date.now() + delayMs;

    // The booth should never receive an older verse after the preacher has
    // already moved to a newer citation. One countdown owns auto-present at a
    // time; previous suggestions remain reviewable but cannot fire later.
    for (const [pendingId, pendingTimer] of this.autoTimers) {
      clearTimeout(pendingTimer);
      this.autoTimers.delete(pendingId);
      const older = this.pendingSuggestions.get(pendingId);
      scriptureTrace.complete(older?.correlationId, {
        status: "superseded",
        supersededBy: suggestion.correlationId,
      });
    }

    scriptureTrace.mark(suggestion.correlationId, "countdownStartedAt");
    const timer = setTimeout(async () => {
      this.autoTimers.delete(suggestion.id);
      this.pendingSuggestions.delete(suggestion.id);
      scriptureTrace.mark(suggestion.correlationId, "countdownCompletedAt");
      usageService.track("scripture_auto");
      await this.presentScripture(suggestion, prepared).catch((err) =>
        log.error("[Orchestrator] Auto-present error", (err as Error).message),
      );
    }, delayMs);

    this.autoTimers.set(suggestion.id, timer);

    const pending: PendingAutoPresent = {
      suggestionId: suggestion.id,
      reference: suggestion.reference,
      expiresAt,
    };
    this.pendingAutoCallbacks.forEach((cb) => cb(pending));

    log.info("[Orchestrator] Auto-present scheduled", {
      ref: suggestion.reference,
      delaySec: this.cfg?.autoPresentDelaySec ?? 1,
    });
  }

  private cancelAutoPresent(suggestionId: string): void {
    const timer = this.autoTimers.get(suggestionId);
    if (timer) {
      clearTimeout(timer);
      this.autoTimers.delete(suggestionId);
    }
    // Cancelled, not failed: the operator caught something and the design
    // worked. Keeping these out of the failure count is the whole point.
    const pending = this.pendingSuggestions.get(suggestionId);
    scriptureTrace.complete(pending?.correlationId, { status: "cancelled" });
  }

  /**
   * The operator switched a card to another translation. Looks the verse up
   * there and keeps the new copy as the card's pending suggestion, so
   * presenting it — even after it was already shown — uses the new text.
   */
  async retranslateSuggestion(
    suggestion: ScriptureSuggestion,
    translation: ScriptureTranslation,
  ): Promise<ScriptureSuggestion> {
    const results = await scriptureService.search(
      suggestion.reference,
      translation,
      store.get("stt").bibleApiKey,
    );
    const verses = results.flatMap((result) => result.verses);
    if (verses.length === 0) {
      throw new Error(
        `${translation} isn't available for ${suggestion.reference}. Download it or add an API.Bible key in Settings → Scripture.`,
      );
    }
    const { requestedTranslation: _shown, ...rest } = suggestion;
    const updated: ScriptureSuggestion = { ...rest, translation, verses };
    this.pendingSuggestions.set(updated.id, updated);
    return updated;
  }

  async presentScriptureDirectly(suggestion: ScriptureSuggestion): Promise<void> {
    usageService.track("scripture_manual");
    await this.presentScripture(suggestion);
  }

  private async presentScripture(
    suggestion: ScriptureSuggestion,
    prepared: PreparedScriptureProjection | null = null,
  ): Promise<void> {
    suggestion = singleVerseSuggestion(suggestion);
    const correlationId = suggestion.correlationId;
    scriptureTrace.mark(correlationId, "presenterRequestStartedAt");
    const content = prepared?.content ?? this.prepareScriptureProjection(suggestion)?.content;
    const results = await this.dispatchScripture(suggestion, content);
    scriptureTrace.mark(correlationId, "presenterRequestCompletedAt");
    const failed = results.filter((r) => !r.ok);
    scriptureTrace.annotate(correlationId, {
      presenterOutputMode: results.filter((result) => result.ok).map((result) => result.kind).join(",") || undefined,
      presenterConnectionMode: failed.length > 0 ? "degraded" : "connected",
    });
    this.recordDispatchHealth(results);

    // The program goes live whether or not a screen took it — the operator's
    // preview, the stage displays and the next push all follow the program,
    // screen problem: it lives in output health and the Screens status.
    if (!results.some((r) => r.ok)) {
      log.warn("[Orchestrator] Scripture is live but no screen took it", {
        ref: suggestion.reference,
        reasons: results.map((r) => `${r.name}: ${r.reason ?? "unknown"}`),
      });
    }

    livePlanService.observe(suggestion.reference, suggestion.planItemId);
    if (this.session) this.session.totalPresentations++;
    if (content) programService.setSlide({ reference: content.reference, text: content.text });
    scriptureTrace.mark(correlationId, "presenterStateCheckStartedAt");
    const confirmation = results.some((result) => result.ok) ? "request-accepted" as const : "none" as const;
    scriptureTrace.complete(correlationId, {
      status: "presented",
      confirmation,
    });
    this.emitStatus();
  }

  async presentLyricSlide(
    reference: string,
    text: string,
    coloredLines?: Array<{ text: string; color?: string }>,
    /** The slide after this one, for the stage displays. */
    next: ProgramSlideInfo | null = null,
  ): Promise<void> {
    if (!text.trim()) throw new Error("Slide is empty — nothing to push.");

    const results = await this.dispatchContent({ reference, text, coloredLines }, "lyrics");
    this.recordDispatchHealth(results);

    // Live in the program even when no screen took it — see presentScripture.
    if (!results.some((r) => r.ok)) {
      log.warn("[Orchestrator] Lyric slide is live but no screen took it", {
        reference,
        reasons: results.map((r) => `${r.name}: ${r.reason ?? "unknown"}`),
      });
    }

    if (this.session) this.session.totalPresentations++;
    programService.setSlide({ reference, text }, next);
    this.emitStatus();
  }

  // ─── Output fan-out (phase 3) ──────────────────────────────────────────────

  private async dispatchScripture(
    suggestion: ScriptureSuggestion,
    preparedContent?: PushContent,
  ): Promise<OverlayDispatchResult[]> {
    preparedContent ??= this.prepareScriptureProjection(suggestion)?.content;
    if (!preparedContent) return [];
    return this.dispatchContent(preparedContent, "scripture");
  }

  /** Resolve and format everything that can be prepared before the safety delay. */
  private prepareScriptureProjection(
    suggestion: ScriptureSuggestion,
  ): PreparedScriptureProjection | null {
    suggestion = singleVerseSuggestion(suggestion);
    const overlay = normalizeOverlaySettings(store.get("overlay"));
    const text = formatOverlayVerseText(suggestion.verses, {
      showVerseNumbers: overlay.showVerseNumbers,
      maxVerses: overlay.maxVerses,
    });
    if (!text) return null;
    return {
      suggestion,
      content: {
        reference: formatOverlayReference(
          suggestion.reference,
          suggestion.translation,
          overlay.showTranslation,
        ),
        text,
      },
    };
  }

  private async dispatchContent(
    content: PushContent,
    kind: OverlayContentKind,
  ): Promise<OverlayDispatchResult[]> {
    const overlay = normalizeOverlaySettings(store.get("overlay"));
    return dispatchToOutputs(overlay.outputs, kind, (output) => this.pushRendered(output, kind, content));
  }

  // ─── Presentation layer: in-app rendered NDI slide ─────────────────────────

  private async pushRendered(
    output: OverlayOutput,
    kind: OverlayContentKind,
    content: PushContent,
  ): Promise<string | null> {
    const surface = surfaceManager.surfaceFor(output);
    if (!surface) {
      return surfaceManager.outputState(output).reason;
    }
    const theme = withLiveBackground(outputThemeFor(output, kind), kind === "lyrics", output.show.backgrounds);
    const shown = await surface.showSlide(output.id, content.reference, content.text, theme, content.coloredLines);
    if (!shown) return SURFACE_GONE[output.kind] ?? "NDI sender unavailable";
    return null;
  }

  /**
   * Rendered outputs that can take a push right now, each with its surface.
   * With `show`, only the ones whose content filter allows that kind.
   */
  private liveSurfaceTargets(show?: keyof OutputShowFilter): SurfaceTarget[] {
    return surfaceManager.liveTargets(show);
  }

  async presentDocumentPage(mediaPath: string, slide?: import('@shared/documents').DocumentSlide): Promise<boolean> {
    const targets = this.liveSurfaceTargets("documents");
    if (targets.length === 0) {
      return false;
    }

    const shown = await Promise.all(
      targets.map(async ({ output, surface }) => {
        // Reuse the current document surface for responsive page turns.
        if (await surface.swapDocumentPage(output.id, mediaPath, slide)) return true;

        const theme = outputThemeFor(output, "scripture");
        const ok = await surface.showDocument(output.id, {
          ...theme,
          background: {
            ...theme.background,
            type: "image",
            mediaPath,
            mediaFit: "contain",
            hue: 0,
            opacity: 1,
            brightness: 1,
            contrast: 1,
            saturation: 1,
          },
        }, slide);
        return ok;
      }),
    );
    if (!shown.some(Boolean)) return false;
    mediaService.setLiveItem(null);
    return true;
  }

  async presentLiveBackground(): Promise<boolean> {
    const live = mediaService.getLiveItem();
    if (!live) return false;
    const targets = this.liveSurfaceTargets("backgrounds");
    if (targets.length === 0) return false;

    const shown = await Promise.all(
      targets.map((target) => this.showLiveBackgroundOn(target, true)),
    );
    return shown.some(Boolean);
  }

  private async showLiveBackgroundOn(
    { output, surface }: SurfaceTarget,
    swap: boolean,
  ): Promise<boolean> {
    const theme = withLiveBackground(outputThemeFor(output, "scripture"), true);
    const swapped = swap && (await surface.setBackground(theme.background));
    if (!swapped && !(await surface.showSlide(output.id, "", "", theme))) return false;
    return true;
  }

  /**
   * Pushes a sample John 3:16 (KJV) overlay to every enabled output — used by
   * the Theme page's "Send test verse" button. Shares `dispatchScripture` with
   * the real detection flow so both exercise identical routing.
   */
  async testOverlay(): Promise<boolean> {
    const sample: ScriptureSuggestion = {
      id: "overlay-test",
      reference: "John 3:16",
      verses: [
        {
          book: "John",
          chapter: 3,
          verse: 16,
          text:
            "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
        },
      ],
      translation: "KJV",
      confidence: 1,
      source: "manual",
      triggerText: "",
    };
    const results = await this.dispatchScripture(sample, this.prepareScriptureProjection(sample)?.content);
    return results.some((r) => r.ok);
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  private initHealth(): void {
    const services: ServiceName[] = ["audio", "stt", "detector", "output"];
    for (const service of services) {
      this.health.set(service, {
        service,
        status: "ok",
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Creates the renderer-fed PCM stream and hands it to Deepgram. The renderer
   * runs getUserMedia and pushes chunks over the audio:pcmChunk IPC; the main
   * process only relays. Cold start and session recovery share this so the two
   * cannot drift.
   */
  private attachAudioStream(): void {
    try {
      const pcmStream = audioService.createRendererStream();
      sttService.deepgram.attachStream(pcmStream);
      this.updateHealth("audio", "ok");
    } catch (err) {
      const msg = (err as Error).message;
      log.error("[Orchestrator] Audio stream setup failed", msg);
      this.updateHealth("audio", "error", msg);
    }
  }

  private recordDispatchHealth(results: readonly OverlayDispatchResult[]): void {
    const { output } = dispatchHealth(results);
    this.updateHealth("output", output.status, output.lastError);
  }

  private updateHealth(
    service: ServiceName,
    status: ServiceHealth["status"],
    lastError?: string,
  ): void {
    this.health.set(service, {
      service,
      status,
      ...(lastError ? { lastError } : {}),
      lastUpdated: Date.now(),
    });
  }

  async clearText(): Promise<boolean> {
    programService.clearCurrent();
    let targets: SurfaceTarget[] | null = null;
    await Promise.all(
      surfaceManager.allSurfaces().map(async (surface) => {
        if (await surface.clearText()) return;
        // Nothing was painted here: put the dock background up instead, or
        // blank it when there is no background either. Only this surface —
        // repainting the others would restart their background video.
        targets ??= this.liveSurfaceTargets("backgrounds");
        const target = targets.find((t) => t.surface === surface);
        if (!target || !mediaService.getLiveItem()) {
          await surface.clear();
          return;
        }
        await this.showLiveBackgroundOn(target, false);
      }),
    );

    return true;
  }

  /** Blank every Kairo screen and feed and reset the live program. */
  async clearOverlay(): Promise<boolean> {
    await Promise.all(surfaceManager.allSurfaces().map((surface) => surface.clear()));
    mediaService.setLiveItem(null);
    programService.clearProgram();
    return true;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private resolveBibleDbPath(): string {
    const userData = app.getPath("userData");
    const dest = path.join(userData, "bible.db");

    if (!fs.existsSync(dest)) {
      const src = app.isPackaged
        ? path.join(process.resourcesPath, "bible.db")
        : path.join(app.getAppPath(), "..", "resources", "bible.db");

      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        log.info("[Orchestrator] Copied bible.db to userData", { dest });
      } else {
        log.warn("[Orchestrator] bible.db not found at", src);
      }
    }

    return dest;
  }

  // Recovery blob from disk; validated piecemeal below, never trusted wholesale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async restoreSession(state: any): Promise<void> {
    if (!state) return;
    log.info("[Orchestrator] Restoring session from recovery data", { sessionId: state.session?.sessionId });

    if (this.running) {
      await this.stop();
    }

    // Restore configuration and session data
    this.cfg = state.config;
    this.session = state.session;

    // Restore pending suggestions
    this.pendingSuggestions.clear();
    if (Array.isArray(state.pendingSuggestions)) {
      for (const sug of state.pendingSuggestions) {
        this.pendingSuggestions.set(sug.id, sug);
        scriptureService.receiveSuggestion(sug);
      }
    }

    // Restore transcription history
    if (Array.isArray(state.transcriptHistory)) {
      sttService.setHistory(state.transcriptHistory);
    }

    resilienceManager.registerStateCallback(() => {
      if (!this.running || !this.session) return null;
      return {
        session: this.session,
        pendingSuggestions: Array.from(this.pendingSuggestions.values()),
        transcriptHistory: sttService.getHistory(),
        config: this.cfg,
      };
    });

    this.running = true;

    // Start database and detector if configuring key
    if (this.cfg) {
      try {
        const dbPath = this.resolveBibleDbPath();
        this.db = new BibleDatabase(dbPath);
        this.updateHealth("detector", "ok");
      } catch (err) {
        log.error("[Orchestrator] BibleDB recovery failed", (err as Error).message);
        this.updateHealth("detector", "error", (err as Error).message);
      }

      // Same wiring as a cold start. Recovery used to skip the detector when no
      // LLM key was set, which silently disabled even explicit citations.
      this.createDetector(this.cfg);

      this.configureStt(this.cfg);

      try {
        await sttService.start();
        this.updateHealth("stt", "ok");
      } catch (err) {
        log.error("[Orchestrator] STT start failed on recovery", (err as Error).message);
        this.updateHealth("stt", "error", (err as Error).message);
      }

      this.attachAudioStream();
    }

    this.emitStatus();
    log.info("[Orchestrator] Session recovery successful", { sessionId: this.session?.sessionId });
  }

  private emitStatus(): void {
    const status = this.getStatus();
    this.statusCallbacks.forEach((cb) => cb(status));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const orchestrator = new Orchestrator();

// Break circular dep: inject orchestrator into resilienceManager instead of lazy-require
resilienceManager.setOrchestrator(orchestrator);

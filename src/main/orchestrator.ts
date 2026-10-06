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
  ScriptureVerse,
  AppSettings,
  OverlayContentKind,
  OverlayDispatchResult,
  OverlayLayer,
  OverlayOutput,
  OverlayTheme,
} from "@shared/ipc";
import { normalizeOverlaySettings } from "@shared/overlay-defaults";
import { isOwnedNdiName } from "@shared/brand";
import { normalizeResourceBindings } from "@shared/propresenter-resources";
import {
  chooseNdiVideoInputId,
  firstLookId,
  getDispatchPlan,
  isRenderedKind,
  ppLayerOf,
  outputRequiresPropresenter,
  outputTemplateFor,
  outputThemeFor,
  OVERLAY_LAYERS,
} from "@shared/overlay-outputs";
import { ndiRoutedThroughPropresenter, propresenterEnabled, setupUsesPropresenter } from "@shared/pp-connect-gate";
import { dispatchHealth } from "@shared/output-health";
import { formatOverlayReference, formatOverlayVerseText, renderOverlayTemplate } from "@shared/overlay-content";
import { confirmPresenterOutput } from "@shared/presenter-confirmation";
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
import { proPresenterService } from "./services/propresenter";
import { scriptureService } from "./services/scripture";
import { lookupDetectedScripture } from "./services/scripture/detection-lookup";
import { scriptureKeyterms } from "./services/stt/keyterms";
import { resilienceManager } from "./services/resilience";
import { mediaService } from "./services/media";
import { themeForPush } from "@shared/media-playback";
import { surfaceManager, type SurfaceTarget } from "./services/output/surface-manager";
import { programService } from "./services/output/program-service";
import type { OutputShowFilter, ProgramSlideInfo } from "@shared/program";
import { store } from "./db";

/**
 * Lays the background pushed from the Media dock under a theme.
 *
 * Backgrounds live outside themes on purpose: a lyric theme is text only,
 * while the loop behind it changes every song. Scripture may still bake in a
 * look of its own. `force` is for the two cases where the dock must win: the
 * dock's own push, and a lyric slide (which must never resurrect a scripture
 * image over the file the operator just sent).
 */
/** The operator switched the ProPresenter integration on in Settings. */
function ppEnabled(): boolean {
  return propresenterEnabled({ propresenter: store.get("propresenter") });
}

/**
 * ProPresenter can be talked to right now: the integration is on AND the link
 * is up. Every PP call is gated on this — with the integration off, Kairo
 * never reaches for ProPresenter, even when a stale connection exists.
 */
function ppConnected(): boolean {
  return ppEnabled() && proPresenterService.getStatus().state === "connected";
}

/**
 * `theme` with the dock's live background applied per `themeForPush`: a theme
 * with its own background outranks the dock (scripture over a running song
 * keeps the scripture look); lyric themes are forced transparent so they take
 * it; `force` is the dock's own "present this background" action.
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

/** Milliseconds to let the offscreen overlay window paint at least once before triggering the PP video input (D — NDI push sequence). */
const NDI_PAINT_SETTLE_MS = 150;
/** How long a confirmed ProPresenter video input is trusted without re-listing. */
const VIDEO_INPUT_MEMO_MS = 30_000;

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

  /** Single pending auto-clear timer for the scripture overlay (one at a time). */
  private overlayClearTimer: NodeJS.Timeout | null = null;

  /** D2 — mechanism-aware clear semantics. Set on EVERY successful present (including library). */
  /**
   * Which PP layers currently hold content this app pushed. Replaces phase 2's
   * single `lastOverlayMechanism` — with fan-out, several layers can be live at
   * once and `clearOverlay` has to take down every one of them.
   */
  private activeLayers = new Set<OverlayLayer>();
  /**
   * Last confirmed ProPresenter video input, with the moment it was confirmed.
   *
   * Confirming costs a `/v1/video_inputs` round trip, and a booth pushing
   * slide after slide paid it every single push. Inputs do not come and go
   * mid-service, so a short memo is enough; anything older re-confirms.
   */
  private confirmedVideoInput: { uuid: string; at: number } | null = null;

  /** Drop the memo when the operator rebinds the video input themselves. */
  forgetVideoInputBinding(): void {
    this.confirmedVideoInput = null;
  }

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
    const pp = proPresenterService.getStatus();
    return {
      running: this.running,
      autoMode: this.cfg?.autoMode ?? false,
      ppConnected: pp.state === "connected",
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
      await this.presentScripture(suggestion);
      return;
    }

    // Manual search suggestion from scriptureService
    const manual = scriptureService.getPendingSuggestion(suggestionId);
    if (manual) {
      scriptureService.dismissSuggestion(suggestionId);
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

    for (const ref of refs) {
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
      const planEntries = matchPlanReference(livePlanService.getIndex(), ref);
      const planEntry = planEntries[0] ?? null;
      if (planEntry) livePlanService.observe(planEntry.reference, planEntry.planItemId);
      const translation = planEntry
        ? planEntry.translation
        : this.cfg.scriptureTranslation;
      scriptureTrace.annotate(correlationId, { translation });
      let verses: ScriptureVerse[] = planEntries.map((entry) => entry.verse);

      scriptureTrace.mark(correlationId, "bibleLookupStartedAt");
      if (verses.length === 0) {
        try {
          verses = await lookupDetectedScripture(
            scriptureService,
            ref,
            translation,
            store.get("stt").bibleApiKey,
          );
        } catch (err) {
          log.warn("[Orchestrator] Bible lookup error", {
            book: ref.book,
            err: (err as Error).message,
          });
        }
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

      const passageId = `${ref.book.toLowerCase().replace(/\s+/g, "-")}-${ref.chapter}-${ref.verseStart}-${ref.verseEnd ?? ref.verseStart}-${Date.now()}`;
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

  async presentScriptureDirectly(suggestion: ScriptureSuggestion): Promise<void> {
    await this.presentScripture(suggestion);
  }

  // ─── ProPresenter presentation ─────────────────────────────────────────────

  private async presentScripture(
    suggestion: ScriptureSuggestion,
    prepared: PreparedScriptureProjection | null = null,
  ): Promise<void> {
    suggestion = singleVerseSuggestion(suggestion);
    const correlationId = suggestion.correlationId;
    const ppStatus = proPresenterService.getStatus();
    scriptureTrace.annotate(correlationId, {
      presenterConnectionMode: ppStatus.state === "connected" ? "connected" : "disconnected",
    });
    const ppOffline = !ppConnected();
    // Queue for replay only on a ProPresenter setup that is waiting for PP to
    // come back, and only when nothing of Kairo's own could show it. With the
    // integration off there is nothing to wait for — the push just runs.
    if (ppEnabled() && ppOffline && !this.hasPpIndependentOutput()) {
      log.warn("[Orchestrator] PP not connected — queueing scripture projection", {
        ref: suggestion.reference,
      });
      resilienceManager.queueProjection(suggestion);
      this.updateHealth("propresenter", "error", "ProPresenter disconnected");
      scriptureTrace.complete(correlationId, {
        status: "failed",
        failureReason: "presenter-disconnected",
      });
      this.emitStatus();
      return;
    }

    scriptureTrace.mark(correlationId, "presenterRequestStartedAt");
    const content = prepared?.content ?? this.prepareScriptureProjection(suggestion)?.content;
    const results = await this.dispatchScripture(suggestion, content);
    scriptureTrace.mark(correlationId, "presenterRequestCompletedAt");
    const failed = results.filter((r) => !r.ok);
    scriptureTrace.annotate(correlationId, {
      presenterOutputMode: results.filter((result) => result.ok).map((result) => result.kind).join(",") || undefined,
      presenterConnectionMode: ppOffline ? "disconnected" : failed.length > 0 ? "degraded" : "connected",
    });
    this.recordDispatchHealth(results, ppOffline);

    // The program goes live whether or not a screen took it — the operator's
    // preview, the stage displays and the next push all follow the program,
    // like ProPresenter with no screen assigned. Why nothing showed is a
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
    const confirmation = await confirmPresenterOutput({
      reference: suggestion.reference,
      successfulKinds: results.filter(result => result.ok).map(result => result.kind),
      readStatus: () => proPresenterService.getStatus(),
    });
    if (confirmation !== "request-accepted" && confirmation !== "none") {
      scriptureTrace.mark(correlationId, "presenterStateConfirmedAt");
    }
    scriptureTrace.complete(correlationId, {
      status: "presented",
      confirmation,
    });
    this.emitStatus();
  }

  /**
   * Pushes one lyric slide to every configured overlay output.
   *
   * Same fan-out as scripture — NDI slide on the main screen, plain text on
   * stage, messages layer as the last resort — so a lyric slide inherits the
   * operator's overlay theme instead of needing a presentation in the PP
   * library (which the PP19 REST API cannot create).
   */
  async presentLyricSlide(
    reference: string,
    text: string,
    coloredLines?: Array<{ text: string; color?: string }>,
    /** The slide after this one, for the stage displays. */
    next: ProgramSlideInfo | null = null,
  ): Promise<void> {
    if (!text.trim()) throw new Error("Slide is empty — nothing to push.");

    // A disconnected ProPresenter is NOT a reason to withhold the slide. The
    // rendered NDI frame leaves this machine over the network whatever PP is
    // doing — only the "cut PP to that video input" step needs the API — so a
    // projector fed from NDI keeps working through a PP restart mid-service.
    // Outputs that genuinely require the API (stage message, library) report
    // their own failure below.
    const ppOffline = !ppConnected();

    const results = await this.dispatchContent({ reference, text, coloredLines }, "lyrics", null);
    this.recordDispatchHealth(results, ppOffline);

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

  /**
   * One push, many destinations.
   *
   * `getDispatchPlan` turns the configured output list into layer groups. Groups
   * run CONCURRENTLY — they land on different ProPresenter layers, so they can
   * all be on screen at once, which is the whole point: the main screen gets the
   * rendered NDI slide while the pastor's stage screen gets plain text. Within a
   * group the outputs run in order and stop at the first success, because they
   * compete for one layer and a second push would only replace the first.
   *
   * `fallbackOnly` outputs run last and only when nothing else worked — that is
   * what preserves the legacy modes' last-resort message overlay.
   *
   * Records which layers ended up holding content in `activeLayers` so
   * `clearOverlay` knows exactly what to take down. Returns one result per
   * attempted output; an empty array means nothing was configured to try.
   */
  private async dispatchScripture(
    suggestion: ScriptureSuggestion,
    preparedContent?: PushContent,
  ): Promise<OverlayDispatchResult[]> {
    suggestion = singleVerseSuggestion(suggestion);
    if (!preparedContent) return [];
    return this.dispatchContent(preparedContent, "scripture", suggestion);
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

  /**
   * The destination-agnostic half of a push: everything below here cares only
   * about `content`, so lyric slides ride the exact same output fan-out,
   * layer bookkeeping and auto-clear timer that scripture does.
   *
   * `suggestion` is only needed by the `library` output kind, which searches
   * ProPresenter for a presentation matching a scripture reference. Callers
   * with no suggestion (lyrics) get that one kind skipped.
   */
  private async dispatchContent(
    content: PushContent,
    kind: OverlayContentKind,
    suggestion: ScriptureSuggestion | null,
  ): Promise<OverlayDispatchResult[]> {
    const overlay = normalizeOverlaySettings(store.get("overlay"));
    // Rendered outputs can opt out of a content kind (a lower-third NDI feed
    // that never shows lyrics, say). PP outputs have no filter.
    // ProPresenter outputs only take part while ProPresenter can be reached.
    // Otherwise they are left out entirely — not attempted, not reported —
    // so a standalone service never hears about software it is not using.
    const ppLive = ppConnected();
    const plan = getDispatchPlan(overlay.outputs, (output) =>
      outputRequiresPropresenter(output.kind)
        ? ppLive
        : !isRenderedKind(output.kind) || output.show[kind],
    );

    // A fresh present is starting — any auto-clear timer left over from a
    // *different* prior push must not fire later and clear this one.
    this.cancelOverlayAutoClear();

    // A Look is whole-system state: triggering several in a row would just
    // leave the last one standing, so fire exactly the first one configured.
    // With PP down the call can only time out, delaying every other output.
    const lookId = firstLookId(plan.groups);
    if (lookId && ppConnected()) {
      const ok = await proPresenterService.rawClient.triggerLook(lookId);
      if (!ok) log.warn("[Orchestrator] Look trigger failed — pushing anyway", { lookId });
    }

    // Kairo's own destinations all run; each PP layer takes its first success.
    // Everything lands on a different window or layer, so it runs concurrently.
    const [rendered, grouped] = await Promise.all([
      Promise.all(plan.rendered.map((output) => this.pushToOutput(output, null, kind, suggestion, content))),
      Promise.all(plan.groups.map((group) => this.runInOrder(group.outputs, group.layer, kind, suggestion, content))),
    ]);
    const results = [...rendered, ...grouped.flat()];

    if (!results.some((r) => r.ok)) {
      for (const output of plan.fallbacks) {
        const result = await this.pushToOutput(output, ppLayerOf(output, overlay.outputs), kind, suggestion, content);
        results.push(result);
        if (result.ok) break;
      }
    }

    if (results.some((r) => r.ok)) this.scheduleOverlayAutoClear(overlay.autoClearSec);
    return results;
  }

  /** Runs one PP layer's outputs in order and stops at the first success. */
  private async runInOrder(
    outputs: readonly OverlayOutput[],
    layer: OverlayLayer,
    kind: OverlayContentKind,
    suggestion: ScriptureSuggestion | null,
    content: PushContent,
  ): Promise<OverlayDispatchResult[]> {
    const results: OverlayDispatchResult[] = [];
    for (const output of outputs) {
      const result = await this.pushToOutput(output, layer, kind, suggestion, content);
      results.push(result);
      if (result.ok) break;
    }
    return results;
  }

  /**
   * Routes one output to the push path for its kind, and on success records the
   * PP layer it claimed (`layer` null for Kairo's own destinations). Never
   * throws — a failing destination must not take the others down with it.
   */
  private async pushToOutput(
    output: OverlayOutput,
    layer: OverlayLayer | null,
    kind: OverlayContentKind,
    suggestion: ScriptureSuggestion | null,
    content: PushContent,
  ): Promise<OverlayDispatchResult> {
    const base = { outputId: output.id, name: output.name, kind: output.kind, layer };

    // Fail fast rather than wait out a request timeout: the operator should
    // see "not connected" at once, and the other outputs must not wait on it.
    if (outputRequiresPropresenter(output.kind) && !ppConnected()) {
      return { ...base, ok: false, reason: "ProPresenter is not connected" };
    }

    try {
      let reason: string | null;
      switch (output.kind) {
        case "library":
          // Library lookup is reference-driven; non-scripture content has none.
          reason = suggestion
            ? await this.pushScriptureLibrary(suggestion)
            : "library output only supports scripture references";
          break;
        case "ndi":
        case "screen":
          reason = await this.pushRendered(output, kind, content);
          break;
        case "stage":
          reason = await this.pushStage(output, kind, content);
          break;
        case "message":
        default:
          reason = await this.pushMessageOverlay(output, kind, content);
          break;
      }

      if (reason === null) {
        if (layer) this.activeLayers.add(layer);
        log.info("[Orchestrator] Content presented", {
          ref: suggestion?.reference ?? content.reference,
          content: kind,
          output: output.name,
          kind: output.kind,
          layer,
        });
        return { ...base, ok: true };
      }
      log.warn("[Orchestrator] Output push failed", {
        ref: suggestion?.reference ?? content.reference,
        output: output.name,
        reason,
      });
      return { ...base, ok: false, reason };
    } catch (err) {
      const reason = (err as Error).message;
      log.error("[Orchestrator] Output push threw", { output: output.name, reason });
      return { ...base, ok: false, reason };
    }
  }

  // ─── Presentation layer: existing PP library slides ────────────────────────

  private async pushScriptureLibrary(suggestion: ScriptureSuggestion): Promise<string | null> {
    const client = proPresenterService.rawClient;
    const match = await client.searchLibraries(suggestion.reference);
    if (!match) {
      // Native creation is an opt-in extension of the existing library path: a
      // machine with no resource binding keeps the old no-match fallback. When
      // an operator has chosen a scripture theme, create one native slide and
      // apply it only after the UUID has been confirmed by ProPresenter.
      const bindings = normalizeResourceBindings(store.get("propresenterResources"));
      if (!bindings.scriptureThemeId) return "no matching presentation in the ProPresenter library";

      let themeId: string | undefined;
      try {
        if (await client.resourceExists("theme", bindings.scriptureThemeId)) {
          themeId = bindings.scriptureThemeId;
        } else {
          log.warn("[Orchestrator] Bound scripture theme is unavailable — using the unthemed creation path", {
            themeId: bindings.scriptureThemeId,
            reference: suggestion.reference,
          });
        }
      } catch (err) {
        log.warn("[Orchestrator] Could not confirm bound scripture theme — using the unthemed creation path", {
          themeId: bindings.scriptureThemeId,
          reference: suggestion.reference,
          error: (err as Error).message,
        });
      }

      const overlay = normalizeOverlaySettings(store.get("overlay"));
      const outputReference = formatOverlayReference(
        suggestion.reference,
        suggestion.translation,
        overlay.showTranslation,
      );

      const presentation = await client.createPresentation(
        `Scripture — ${suggestion.reference}`,
        [{
          label: outputReference,
          notes: "scripture",
          lines: [outputReference, ...suggestion.verses.map((verse) => verse.text)],
        }],
        themeId ? { themeId } : {},
      );
      if (!presentation) return "no matching presentation in the ProPresenter library";
      const triggered = await client.triggerSlide(presentation.id.uuid, 0);
      return triggered ? null : "native scripture presentation trigger rejected by ProPresenter";
    }

    const ok = await client.triggerLibraryPresentation(
      match.libraryId,
      match.presentationName,
    );
    return ok ? null : "library trigger rejected by ProPresenter";
  }

  // ─── Messages layer ────────────────────────────────────────────────────────

  /**
   * Pushes through the messages-layer overlay path. ProPresenter does the token
   * substitution itself here, so the template goes across untouched.
   */
  private async pushMessageOverlay(
    output: OverlayOutput,
    kind: OverlayContentKind,
    content: PushContent,
  ): Promise<string | null> {
    const client = proPresenterService.rawClient;
    const bindings = normalizeResourceBindings(store.get("propresenterResources"));
    const boundMessageId = bindings.lowerThirdMessageId;

    if (boundMessageId) {
      let available = false;
      try {
        available = await client.resourceExists("message", boundMessageId);
      } catch (err) {
        log.warn("[Orchestrator] Could not confirm bound lower-third message — using the default message path", {
          messageId: boundMessageId,
          error: (err as Error).message,
        });
      }

      if (available) {
        const shownBound = await client.showBoundMessage(boundMessageId, content.reference, content.text);
        if (shownBound) return null;
        log.warn("[Orchestrator] Bound lower-third message was rejected — using the default message path", {
          messageId: boundMessageId,
        });
      } else {
        log.warn("[Orchestrator] Bound lower-third message is unavailable — using the default message path", {
          messageId: boundMessageId,
        });
      }
    }

    const shown = await client.showScriptureMessage(
      content.reference,
      content.text,
      outputTemplateFor(output, kind),
    );
    return shown ? null : "ProPresenter rejected the message trigger";
  }

  // ─── Stage layer: the pastor's confidence screen ───────────────────────────

  /**
   * Plain text to every stage screen whose layout includes a Message field —
   * that in-PP setup step is the operator's, and there is no API to check it, so
   * a "successful" push here only means PP accepted the call.
   */
  private async pushStage(
    output: OverlayOutput,
    kind: OverlayContentKind,
    content: PushContent,
  ): Promise<string | null> {
    // Unlike the messages layer, PP does no token substitution for a stage
    // message — we render the template ourselves, through the shared renderer.
    const ok = await proPresenterService.rawClient.setStageMessage(
      renderOverlayTemplate(outputTemplateFor(output, kind), content),
    );
    return ok ? null : "ProPresenter rejected the stage message";
  }

  // ─── Presentation layer: in-app rendered NDI slide ─────────────────────────

  /**
   * Draws the slide on this output's own surface — a Kairo screen window or an
   * NDI feed — with this output's own theme (a projector can be full-frame
   * while the NDI feed is a lower third). The theme comes off the output being
   * pushed, not the "live" preview lookup, so per-content-kind overrides hold.
   * Lyric slides never own a background: the dock goes under them so a
   * leftover scripture image cannot replace the loop the operator just pushed.
   *
   * The primary NDI feed then soft-cuts ProPresenter to its video input. The
   * themed frame goes out even when no input is bound — otherwise a missing
   * binding silently falls through to library / message and PP shows
   * unstyled text instead of the operator's theme.
   */
  private async pushRendered(
    output: OverlayOutput,
    kind: OverlayContentKind,
    content: PushContent,
  ): Promise<string | null> {
    const surface = surfaceManager.surfaceFor(output);
    if (!surface) {
      return output.kind === "screen" ? surfaceManager.screenState(output.id).reason : "NDI sender unavailable";
    }
    const theme = withLiveBackground(outputThemeFor(output, kind), kind === "lyrics", output.show.backgrounds);
    const shown = await surface.showSlide(output.id, content.reference, content.text, theme, content.coloredLines);
    if (!shown) return output.kind === "screen" ? "Screen window is not available" : "NDI sender unavailable";
    await this.cutToVideoInput(output, "Slide");
    return null;
  }




  /**
   * Rendered outputs that can take a push right now, each with its surface.
   * With `show`, only the ones whose content filter allows that kind.
   */
  private liveSurfaceTargets(show?: keyof OutputShowFilter): SurfaceTarget[] {
    return surfaceManager.liveTargets(show);
  }


  /**
   * A Kairo screen, or an NDI feed that something other than ProPresenter
   * takes, is live — so PP being down does not stop a push. An NDI output
   * bound to a PP video input does not count: its frame only reaches the room
   * through PP, and queueing is what replays the verse once PP is back.
   */
  private hasPpIndependentOutput(): boolean {
    const outputs = normalizeOverlaySettings(store.get("overlay")).outputs;
    const { ndiVideoInputId } = normalizeResourceBindings(store.get("propresenterResources"));
    return this.liveSurfaceTargets().some(
      ({ output }) => !ndiRoutedThroughPropresenter(output, outputs, ndiVideoInputId),
    );
  }


  /**
   * PP video input binding: persist uuid, name-match only as discovery.
   * A stored uuid is used as-is so a push does not wait on `/v1/video_inputs`
   * (that list timed out on Wi-Fi and skipped the trigger). Discovery still
   * lists inputs when nothing is bound. Never hard-fails a push over discovery
   * — returns null if neither resolves.
   */
  private async ensureVideoInputBinding(output: OverlayOutput): Promise<string | null> {
    const bindings = normalizeResourceBindings(store.get("propresenterResources"));
    const durableId = bindings.ndiVideoInputId;
    // Discovery talks to PP. With PP down those calls only burn the push's
    // latency before failing, and the NDI frame has already gone out regardless.
    if (!ppConnected()) {
      return durableId || output.ppVideoInputUuid || null;
    }
    const client = proPresenterService.rawClient;
    let inputs: Awaited<ReturnType<typeof client.getVideoInputs>> | null = null;

    if (durableId) {
      const memo = this.confirmedVideoInput;
      if (memo && memo.uuid === durableId && Date.now() - memo.at < VIDEO_INPUT_MEMO_MS) {
        return memo.uuid;
      }
      inputs = await client.getVideoInputs();
      const confirmed = chooseNdiVideoInputId(durableId, "", inputs);
      if (confirmed) {
        this.confirmedVideoInput = { uuid: confirmed, at: Date.now() };
        return confirmed;
      }
      this.confirmedVideoInput = null;
      log.warn("[Orchestrator] Bound NDI video input is unavailable — checking existing output binding", {
        uuid: durableId,
        output: output.name,
      });
    }

    if (output.ppVideoInputUuid) return output.ppVideoInputUuid;

    inputs ??= await client.getVideoInputs();
    const discovered = inputs.find((i) => isOwnedNdiName(i.name));
    if (discovered) {
      // `stored` is already normalized and the patch is a uuid straight from PP,
      // so a second normalize pass here would only re-clamp ~10 themes for nothing.
      const stored = normalizeOverlaySettings(store.get("overlay"));
      store.set("overlay", {
        ...stored,
        outputs: stored.outputs.map((o) =>
          o.id === output.id ? { ...o, ppVideoInputUuid: discovered.uuid } : o,
        ),
      });
      log.info("[Orchestrator] NDI video input discovered and persisted", {
        uuid: discovered.uuid,
        name: discovered.name,
        output: output.id,
      });
      return discovered.uuid;
    }

    return null;
  }

  /**
   * Projects one imported document page onto every rendered output — each
   * Kairo screen, and the NDI feed when it is available (contain-fit image).
   * Paint first, then soft-trigger ProPresenter onto the NDI video input when a
   * binding exists. A missing binding must not block the push — the frame is
   * already on the NDI source for anything already taking it.
   */
  async presentDocumentPage(mediaPath: string): Promise<boolean> {
    const targets = this.liveSurfaceTargets("documents");
    if (targets.length === 0) {
      throw new Error("Enable a screen or NDI output in Settings before projecting documents.");
    }
    this.cancelOverlayAutoClear();
    this.notePpLayerFor(targets);

    const shown = await Promise.all(
      targets.map(async ({ output, surface }) => {
        // Page turn inside a deck that is already on screen: swap the image and
        // stop there. The slow parts of a first push — rebuilding the slide,
        // the paint-settle wait and re-triggering the same ProPresenter video
        // input — are all redundant once the deck is live, and they are what
        // makes a clicker feel late. The surface knows whether it is showing
        // this output's deck; otherwise this falls through to the full push.
        if (await surface.swapDocumentPage(output.id, mediaPath)) return true;

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
        });
        // No blind settle wait here: showDocument already returned on the
        // captured frame, so the page is on the NDI wire before ProPresenter
        // is asked to show it.
        if (ok && output.kind === "ndi") await this.cutToVideoInput(output, "Document page");
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
      targets.map((target) => this.showLiveBackgroundOn(target, `Background "${live.name}"`, true)),
    );
    if (shown.some(Boolean)) this.notePpLayerFor(targets);
    return shown.some(Boolean);
  }

  /**
   * Kairo's own surfaces are always cleared; ProPresenter only needs clearing
   * on the layers something was sent to. The primary NDI feed is on PP's
   * presentation layer (PP was cut to its video input).
   */
  private notePpLayerFor(targets: readonly SurfaceTarget[]): void {
    if (targets.some(({ output }) => surfaceManager.isPrimaryNdi(output.id))) this.activeLayers.add("presentation");
  }

  /**
   * Puts the dock background up on one surface, text-free, and cuts PP to it
   * when that surface is the primary NDI feed. `swap` first tries swapping the
   * background under whatever is already painted.
   */
  private async showLiveBackgroundOn(
    { output, surface }: SurfaceTarget,
    what: string,
    swap: boolean,
  ): Promise<boolean> {
    const theme = withLiveBackground(outputThemeFor(output, "scripture"), true);
    const swapped = swap && (await surface.setBackground(theme.background));
    if (!swapped && !(await surface.showSlide(output.id, "", "", theme))) return false;
    await this.cutToVideoInput(output, what);
    return true;
  }

  /** Soft-cuts ProPresenter to the NDI video input. Never throws, never fails a push. */
  private async cutToVideoInput(output: OverlayOutput, what: string): Promise<void> {
    // Extra NDI feeds (livestream, recording) have no ProPresenter input to
    // cut to — only the primary sender is bound there.
    if (!surfaceManager.isPrimaryNdi(output.id)) return;
    // Let at least one 'paint' reach the NDI frame buffer first, or PP may cut
    // to a stale (blank) frame for one repeat-loop tick.
    await new Promise((resolve) => setTimeout(resolve, NDI_PAINT_SETTLE_MS));
    try {
      const uuid = await this.ensureVideoInputBinding(output);
      if (uuid && ppConnected()) {
        await proPresenterService.rawClient.triggerVideoInput(uuid);
      } else if (!uuid) {
        log.warn(`[Orchestrator] ${what} on NDI without a bound ProPresenter video input`, {
          output: output.name,
        });
      }
    } catch (err) {
      log.warn(`[Orchestrator] Could not trigger ProPresenter onto ${what.toLowerCase()}`, {
        output: output.name,
        error: (err as Error).message,
      });
    }
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
    const results = await this.dispatchScripture(sample);
    return results.some((r) => r.ok);
  }


  // ─── Health ────────────────────────────────────────────────────────────────

  private initHealth(): void {
    const services: ServiceName[] = ["audio", "stt", "detector", "propresenter", "output"];
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

  /**
   * Splits one push's results into the two health lines (D8): `output` says
   * whether the slide reached the screens; `propresenter` only reflects the
   * PP link and the outputs that go through it. A Kairo-screens-only setup is
   * never marked red because ProPresenter is not running.
   */
  private recordDispatchHealth(results: readonly OverlayDispatchResult[], ppOffline: boolean): void {
    const usesPropresenter = ppEnabled() && setupUsesPropresenter(
      normalizeOverlaySettings(store.get("overlay")),
      normalizeResourceBindings(store.get("propresenterResources")).ndiVideoInputId,
    );
    const health = dispatchHealth(results, { ppOffline, usesPropresenter });
    this.updateHealth("output", health.output.status, health.output.lastError);
    this.updateHealth("propresenter", health.propresenter.status, health.propresenter.lastError);
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

  /**
   * Removes verse / lyric / message text and leaves the dock background running.
   * Used by Clear text, Backspace, and the verse auto-clear timer.
   *
   * ProPresenter calls only run while it is connected — offline they can only
   * time out — so an offline Clear succeeds once Kairo's own surfaces are clear.
   */
  async clearText(): Promise<boolean> {
    this.cancelOverlayAutoClear();
    const client = proPresenterService.rawClient;
    const connected = ppConnected();

    const layers = this.activeLayers.size > 0
      ? [...this.activeLayers]
      : [...OVERLAY_LAYERS];

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
        await this.showLiveBackgroundOn(target, "Background", false);
      }),
    );

    const results: boolean[] = [];
    if (connected) {
      for (const layer of layers) {
        if (layer === "messages") {
          const clearedMessage = await client.clearScriptureMessage();
          const clearedLayer = await client.clearMessages();
          results.push(clearedMessage && clearedLayer);
        } else if (layer === "stage") {
          results.push(await client.clearStageMessage());
        }
      }
    }

    return results.every(Boolean);
  }

  /**
   * Clear is layer-aware: it takes down every layer this app most recently
   * pushed to, which under fan-out can be several at once.
   *   screen       → every Kairo screen blanked
   *   presentation → NDI surface blanked + NDI frame reset, AND
   *                  GET /v1/clear/layer/slide (library slide). Video input stays.
   *   messages     → clearScriptureMessage + clearMessages
   *   stage        → DELETE /v1/stage/message
   * PP calls are skipped while it is disconnected. Also drops the media-dock
   * live item so the operator preview matches the blank program. Header CLEAR
   * and IPC OUTPUT.CLEAR_ALL use this.
   */
  async clearOverlay(): Promise<boolean> {
    this.cancelOverlayAutoClear();
    const client = proPresenterService.rawClient;
    const connected = ppConnected();

    const layers = this.activeLayers.size > 0
      ? [...this.activeLayers]
      : [...OVERLAY_LAYERS];

    // Kairo's own screens and feeds: local and cheap, so always.
    await Promise.all(surfaceManager.allSurfaces().map((surface) => surface.clear()));

    const results: boolean[] = [];
    for (const layer of layers) {
      if (!connected) {
        continue;
      } else if (layer === "presentation") {
        // The NDI frame is ours to blank (above), but the PP video-input
        // selection is operator-owned state. Keep it selected so the next
        // frame is visible without the operator clicking the input again.
        results.push(await client.clearAll({ clearVideoInput: false }));
      } else if (layer === "messages") {
        const clearedMessage = await client.clearScriptureMessage();
        const clearedLayer = await client.clearMessages();
        results.push(clearedMessage && clearedLayer);
      } else {
        results.push(await client.clearStageMessage());
      }
    }

    mediaService.setLiveItem(null);
    // Clear All takes the message, props, logo and camera down too.
    programService.clearProgram();
    this.activeLayers.clear();
    return results.every(Boolean);
  }

  private scheduleOverlayAutoClear(autoClearSec: number): void {
    this.cancelOverlayAutoClear();
    if (autoClearSec > 0) {
      this.overlayClearTimer = setTimeout(() => {
        this.overlayClearTimer = null;
        this.clearText().catch((err) => {
          log.error("[Orchestrator] Overlay auto-clear failed", (err as Error).message);
        });
      }, autoClearSec * 1_000);
    }
  }

  private cancelOverlayAutoClear(): void {
    if (this.overlayClearTimer) {
      clearTimeout(this.overlayClearTimer);
      this.overlayClearTimer = null;
    }
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

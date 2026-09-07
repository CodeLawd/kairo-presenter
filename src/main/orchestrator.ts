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
  findNdiOutput,
  getDispatchPlan,
  layerOfKind,
  outputTemplateFor,
  outputThemeFor,
  OVERLAY_LAYERS,
} from "@shared/overlay-outputs";
import { formatOverlayReference, formatOverlayVerseText, renderOverlayTemplate } from "@shared/overlay-content";
import { ScriptureDetector } from "./services/scripture/detector";
import { subscribeExplicitScriptureDetection } from "./services/scripture/live-detection-wiring";
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
import { resilienceManager } from "./services/resilience";
import { ndiService } from "./services/ndi";
import { mediaService } from "./services/media";
import { themeOwnsBackground, themeWithLiveMedia } from "@shared/media-playback";
import { overlayWindow } from "./services/ndi/overlay-window";
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
function withLiveBackground(theme: OverlayTheme, force = false): OverlayTheme {
  const live = mediaService.getLiveItem();
  if (!live) return theme;
  // A theme that configures its own background outranks the dock: pushing
  // scripture over a running song must show the scripture look, not the song's
  // motion loop. Lyric themes are forced transparent, so they still take it.
  // `force` is the dock's own "present this background" action, which is the
  // one case where the staged file IS the content.
  if (!force && themeOwnsBackground(theme)) return theme;
  return themeWithLiveMedia(theme, live, mediaService.getPlayback(live.id));
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

/** Milliseconds to let the offscreen overlay window paint at least once before triggering the PP video input (D — NDI push sequence). */
const NDI_PAINT_SETTLE_MS = 150;

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

  /** Single pending auto-clear timer for the scripture overlay (one at a time). */
  private overlayClearTimer: NodeJS.Timeout | null = null;

  /** D2 — mechanism-aware clear semantics. Set on EVERY successful present (including library). */
  /**
   * Which PP layers currently hold content this app pushed. Replaces phase 2's
   * single `lastOverlayMechanism` — with fan-out, several layers can be live at
   * once and `clearOverlay` has to take down every one of them.
   */
  private activeLayers = new Set<OverlayLayer>();

  private session: Session | null = null;

  private bufferAnalyzeListener: ((ctx: string, _ts: number) => void) | null = null;
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

    // Create ScriptureDetector. It is built even without an LLM key so the local
    // regex path and the live-playlist match still drive the Operator; only the
    // buffer → LLM wiring below is gated on the key.
    this.detector = new ScriptureDetector({
      provider: config.llmProvider,
      apiKey: config.llmApiKey,
      model: config.scriptureModel,
    });
    this.detector.setPlanIndexProvider(() => livePlanService.getIndex());
    this.detector.on("planProgress", (reference, itemId) => livePlanService.observe(reference, itemId));

    this.detector.on("detection", (refs) => {
      this.handleDetection(refs).catch((err) =>
        log.error("[Orchestrator] handleDetection error", (err as Error).message),
      );
    });

    this.detector.on("requestSuccess", () => {
      resilienceManager.handleClaudeSuccess();
    });

    this.detector.on("stats", (stats: DetectorStats) => {
      if (this.session) {
        this.session.detectorCalls = stats.totalCalls;
        this.session.avgDetectorLatencyMs = stats.averageLatencyMs;
      }
    });

    this.detector.on("error", (err: Error) => {
      log.error("[Orchestrator] Detector error", err.message);
      this.updateHealth("detector", "error", err.message);
      this.emitStatus();
      resilienceManager.handleClaudeError(err);
    });

    if (config.llmApiKey) this.updateHealth("detector", "ok");

    // Configure STT
    sttService.configure(config.sttProvider, config.sttApiKey, config.sttLanguage);

    // Wire buffer → detector. Only the LLM analysis needs an API key; the local
    // explicit + playlist paths run either way.
    if (config.llmApiKey) {
      this.bufferAnalyzeListener = (ctx: string, _ts: number) => {
        this.detector!.analyze(ctx);
      };
      sttService.buffer.on("analyzeReady", this.bufferAnalyzeListener);
    }
    this.explicitDetectionCleanup = subscribeExplicitScriptureDetection(
      sttService,
      this.detector,
    );

    // Start STT (connects Deepgram WebSocket)
    try {
      await sttService.start();
      this.updateHealth("stt", "ok");
    } catch (err) {
      const msg = (err as Error).message;
      log.error("[Orchestrator] STT start failed", msg);
      this.updateHealth("stt", "error", msg);
    }

    // Create renderer-fed PCM stream and attach to Deepgram.
    // The renderer will start getUserMedia and push chunks via audio:pcmChunk IPC.
    try {
      const pcmStream = audioService.createRendererStream();
      sttService.deepgram.attachStream(pcmStream);
      this.updateHealth("audio", "ok");
    } catch (err) {
      const msg = (err as Error).message;
      log.error("[Orchestrator] Audio stream setup failed", msg);
      this.updateHealth("audio", "error", msg);
    }

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

    // Detach buffer → detector wiring
    if (this.bufferAnalyzeListener) {
      sttService.buffer.off("analyzeReady", this.bufferAnalyzeListener);
      this.bufferAnalyzeListener = null;
    }
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

  // ─── Detection handler ─────────────────────────────────────────────────────

  private async handleDetection(refs: ScriptureReference[]): Promise<void> {
    if (!this.cfg || !this.running) return;
    const detectionSession = this.session;

    for (const ref of refs) {
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
      let verses: ScriptureVerse[] = planEntries.map((entry) => entry.verse);

      if (verses.length === 0) {
        try {
          const end = ref.verseEnd != null ? `-${ref.verseEnd}` : "";
          const results = await scriptureService.search(
            `${ref.book} ${ref.chapter}:${ref.verseStart}${end}`,
            translation,
            store.get("stt").bibleApiKey,
          );
          verses = results.flatMap((result) => result.verses);
        } catch (err) {
          log.warn("[Orchestrator] Bible lookup error", {
            book: ref.book,
            err: (err as Error).message,
          });
        }
      }

      // A lookup can finish after stop or after another service has started.
      if (!this.running || this.session !== detectionSession) return;

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
        if (this.session) this.session.totalDetections++;

        // Publish through scriptureService so existing IPC/renderer pipeline works
        scriptureService.receiveSuggestion(suggestion);

        if (
          this.cfg.autoMode &&
          verseIndex === 0 &&
          verseItems.length === 1 &&
          canAutoPresentScriptureReference(ref) &&
          ref.confidence >= (this.cfg.confidenceThreshold ?? 0.7)
        ) {
          this.scheduleAutoPresent(suggestion);
        }
      }

      this.updateHealth("detector", "ok");
    }

    this.emitStatus();
  }

  // ─── Auto-present countdown ────────────────────────────────────────────────

  private scheduleAutoPresent(
    suggestion: ScriptureSuggestion,
    staggerIndex = 0,
  ): void {
    const baseDelayMs = (this.cfg?.autoPresentDelaySec ?? 3) * 1_000;
    // Stagger multi-verse detections so each verse presents in sequence
    const delayMs = baseDelayMs + staggerIndex * baseDelayMs;
    const expiresAt = Date.now() + delayMs;

    const timer = setTimeout(async () => {
      this.autoTimers.delete(suggestion.id);
      this.pendingSuggestions.delete(suggestion.id);
      await this.presentScripture(suggestion).catch((err) =>
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
      delaySec: this.cfg?.autoPresentDelaySec ?? 3,
    });
  }

  private cancelAutoPresent(suggestionId: string): void {
    const timer = this.autoTimers.get(suggestionId);
    if (timer) {
      clearTimeout(timer);
      this.autoTimers.delete(suggestionId);
    }
  }

  async presentScriptureDirectly(suggestion: ScriptureSuggestion): Promise<void> {
    await this.presentScripture(suggestion);
  }

  // ─── ProPresenter presentation ─────────────────────────────────────────────

  private async presentScripture(suggestion: ScriptureSuggestion): Promise<void> {
    suggestion = singleVerseSuggestion(suggestion);
    const ppStatus = proPresenterService.getStatus();
    if (ppStatus.state !== "connected") {
      log.warn("[Orchestrator] PP not connected — queueing scripture projection", {
        ref: suggestion.reference,
      });
      resilienceManager.queueProjection(suggestion);
      this.updateHealth("propresenter", "error", "ProPresenter disconnected");
      this.emitStatus();
      return;
    }

    const results = await this.dispatchScripture(suggestion);
    const failed = results.filter((r) => !r.ok);

    if (!results.some((r) => r.ok)) {
      const msg = results.length === 0
        ? `No overlay outputs are enabled — cannot present "${suggestion.reference}"`
        : `Failed to present "${suggestion.reference}" on any output`;
      this.updateHealth("propresenter", "error", msg);
      this.emitStatus();
      throw new Error(msg);
    }

    livePlanService.observe(suggestion.reference, suggestion.planItemId);
    if (this.session) this.session.totalPresentations++;
    // Partial success is still on screen somewhere, so it is degraded, not an
    // error — but the operator needs to know which screen missed out.
    if (failed.length > 0) {
      this.updateHealth(
        "propresenter",
        "degraded",
        `Output failed: ${failed.map((f) => `${f.name} (${f.reason ?? "unknown"})`).join("; ")}`,
      );
    } else {
      this.updateHealth("propresenter", "ok");
    }
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
  ): Promise<void> {
    const ppStatus = proPresenterService.getStatus();
    if (ppStatus.state !== "connected") {
      throw new Error("ProPresenter is not connected. Connect in Settings → ProPresenter first.");
    }
    if (!text.trim()) throw new Error("Slide is empty — nothing to push.");

    const results = await this.dispatchContent({ reference, text, coloredLines }, "lyrics", null);
    const failed = results.filter((r) => !r.ok);

    if (!results.some((r) => r.ok)) {
      const msg = results.length === 0
        ? "No overlay outputs are enabled — cannot push this slide"
        : `Failed to push "${reference}" on any output`;
      this.updateHealth("propresenter", "error", msg);
      this.emitStatus();
      throw new Error(msg);
    }

    if (this.session) this.session.totalPresentations++;
    if (failed.length > 0) {
      this.updateHealth(
        "propresenter",
        "degraded",
        `Output failed: ${failed.map((f) => `${f.name} (${f.reason ?? "unknown"})`).join("; ")}`,
      );
    } else {
      this.updateHealth("propresenter", "ok");
    }
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
  ): Promise<OverlayDispatchResult[]> {
    suggestion = singleVerseSuggestion(suggestion);
    const overlay = normalizeOverlaySettings(store.get("overlay"));

    // The verse text depends only on the suggestion and the global content
    // settings, never on the destination — format it once for every output.
    const text = formatOverlayVerseText(suggestion.verses, {
      showVerseNumbers: overlay.showVerseNumbers,
      maxVerses: overlay.maxVerses,
    });
    if (!text) {
      log.warn("[Orchestrator] No verse text available — nothing to push", {
        ref: suggestion.reference,
        translation: suggestion.translation,
      });
      return [];
    }
    const content: PushContent = {
      reference: formatOverlayReference(
        suggestion.reference,
        suggestion.translation,
        overlay.showTranslation,
      ),
      text,
    };

    return this.dispatchContent(content, "scripture", suggestion);
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
    const plan = getDispatchPlan(overlay.outputs);

    // A fresh present is starting — any auto-clear timer left over from a
    // *different* prior push must not fire later and clear this one.
    this.cancelOverlayAutoClear();

    // A Look is whole-system state: triggering several in a row would just
    // leave the last one standing, so fire exactly the first one configured.
    const lookId = firstLookId(plan.groups);
    if (lookId) {
      const ok = await proPresenterService.rawClient.triggerLook(lookId);
      if (!ok) log.warn("[Orchestrator] Look trigger failed — pushing anyway", { lookId });
    }

    // Groups land on different PP layers, so they run concurrently.
    const grouped = await Promise.all(
      plan.groups.map((group) => this.runInOrder(group.outputs, kind, suggestion, content)),
    );
    const results = grouped.flat();

    if (!results.some((r) => r.ok)) {
      results.push(...(await this.runInOrder(plan.fallbacks, kind, suggestion, content)));
    }

    if (results.some((r) => r.ok)) this.scheduleOverlayAutoClear(overlay.autoClearSec);
    return results;
  }

  /** Runs outputs in order and stops at the first success. */
  private async runInOrder(
    outputs: readonly OverlayOutput[],
    kind: OverlayContentKind,
    suggestion: ScriptureSuggestion | null,
    content: PushContent,
  ): Promise<OverlayDispatchResult[]> {
    const results: OverlayDispatchResult[] = [];
    for (const output of outputs) {
      const result = await this.pushToOutput(output, kind, suggestion, content);
      results.push(result);
      if (result.ok) break;
    }
    return results;
  }

  /**
   * Routes one output to the push path for its kind, and on success records the
   * layer it claimed. Never throws — a failing destination must not take the
   * other destinations down with it.
   */
  private async pushToOutput(
    output: OverlayOutput,
    kind: OverlayContentKind,
    suggestion: ScriptureSuggestion | null,
    content: PushContent,
  ): Promise<OverlayDispatchResult> {
    const layer = layerOfKind(output.kind);
    const base = { outputId: output.id, name: output.name, kind: output.kind, layer };

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
          reason = await this.pushOverlayNdi(output, kind, content);
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
        this.activeLayers.add(layer);
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

      const presentation = await client.createPresentation(
        `Scripture — ${suggestion.reference}`,
        [{
          label: suggestion.reference,
          notes: "scripture",
          lines: [suggestion.reference, ...suggestion.verses.map((verse) => verse.text)],
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
   * Pushes `suggestion` through the in-app-rendered NDI overlay: render the
   * styled slide in the offscreen overlay window using the same theme the
   * verse cards preview, give it one paint cycle to land in the NDI frame
   * buffer, then trigger the bound PP video input when one exists.
   *
   * The themed frame is sent even when no video input is bound — otherwise a
   * missing binding silently falls through to library/message and ProPresenter
   * shows unstyled text instead of the operator's theme.
   */
  private async pushOverlayNdi(
    output: OverlayOutput,
    kind: OverlayContentKind,
    content: PushContent,
  ): Promise<string | null> {
    if (!ndiService.getStatus().available) return "NDI sender unavailable";

    // The theme comes off the output being pushed, not off the "live" lookup —
    // that one answers a preview question and would ignore this output's own
    // per-content-kind override. Lyric slides never own a background: force
    // the dock under them so a leftover scripture image cannot replace the
    // loop the operator just pushed.
    const theme = withLiveBackground(outputThemeFor(output, kind), kind === "lyrics");

    await overlayWindow.showScripture(
      output.id,
      content.reference,
      content.text,
      theme,
      content.coloredLines,
    );
    // Let at least one 'paint' land in NdiService's frame buffer before
    // triggering PP onto the video input — otherwise PP may cut to a stale
    // (blank) frame for one repeat-loop tick.
    await new Promise((resolve) => setTimeout(resolve, NDI_PAINT_SETTLE_MS));

    const uuid = await this.ensureVideoInputBinding(output);
    if (!uuid) {
      log.warn("[Orchestrator] Themed NDI frame sent without a bound ProPresenter video input", {
        output: output.name,
      });
      return null;
    }

    const triggered = await proPresenterService.rawClient.triggerVideoInput(uuid);
    if (!triggered) {
      log.warn("[Orchestrator] Video-input trigger rejected — themed NDI frame is still on the source", {
        output: output.name,
        uuid,
      });
    }
    return null;
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
    const client = proPresenterService.rawClient;
    let inputs: Awaited<ReturnType<typeof client.getVideoInputs>> | null = null;

    if (durableId) {
      inputs = await client.getVideoInputs();
      const confirmed = chooseNdiVideoInputId(durableId, "", inputs);
      if (confirmed) return confirmed;
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
   * Projects one imported document page onto the NDI overlay (contain-fit image).
   * Matches media/scripture: paint first, then soft-trigger ProPresenter onto the
   * video input when a binding exists. A missing binding must not block the push —
   * the frame is already on the NDI source for anything already taking it.
   */
  async presentDocumentPage(mediaPath: string): Promise<boolean> {
    if (!ndiService.getStatus().available) throw new Error("NDI output is unavailable on this machine.");
    const overlay = normalizeOverlaySettings(store.get("overlay"));
    const ndi =
      overlay.outputs.find((output) => output.kind === "ndi" && output.enabled) ??
      findNdiOutput(overlay.outputs);
    if (!ndi || !ndi.enabled) throw new Error("Enable an NDI output in Settings before projecting documents.");
    this.cancelOverlayAutoClear();
    this.activeLayers.add("presentation");
    const theme = outputThemeFor(ndi, "scripture");
    const shown = await overlayWindow.showDocument(ndi.id, {
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
    if (!shown) return false;
    await new Promise((resolve) => setTimeout(resolve, NDI_PAINT_SETTLE_MS));

    try {
      const uuid = await this.ensureVideoInputBinding(ndi);
      if (uuid) {
        await proPresenterService.rawClient.triggerVideoInput(uuid);
      } else {
        log.warn("[Orchestrator] Document page on NDI without a bound ProPresenter video input", {
          output: ndi.name,
        });
      }
    } catch (err) {
      log.warn("[Orchestrator] Could not trigger ProPresenter onto the document page", {
        output: ndi.name,
        error: (err as Error).message,
      });
    }
    mediaService.setLiveItem(null);
    return true;
  }

  async presentLiveBackground(): Promise<boolean> {
    const live = mediaService.getLiveItem();
    if (!live) return false;
    if (!ndiService.getStatus().available) return false;

    const overlay = normalizeOverlaySettings(store.get("overlay"));
    const ndi =
      overlay.outputs.find((output) => output.kind === "ndi" && output.enabled) ??
      findNdiOutput(overlay.outputs);
    if (!ndi) return false;

    const theme = withLiveBackground(outputThemeFor(ndi, "scripture"), true);
    const swapped = await overlayWindow.setBackground(theme.background);
    if (!swapped) {
      const shown = await overlayWindow.showScripture(ndi.id, "", "", theme);
      if (!shown) return false;
    }

    await new Promise((resolve) => setTimeout(resolve, NDI_PAINT_SETTLE_MS));

    try {
      const uuid = await this.ensureVideoInputBinding(ndi);
      if (uuid) {
        await proPresenterService.rawClient.triggerVideoInput(uuid);
      } else {
        log.warn("[Orchestrator] Background on NDI without a bound ProPresenter video input", {
          name: live.name,
        });
      }
    } catch (err) {
      log.warn("[Orchestrator] Could not trigger ProPresenter onto the background", {
        name: live.name,
        error: (err as Error).message,
      });
    }
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
    const results = await this.dispatchScripture(sample);
    return results.some((r) => r.ok);
  }


  // ─── Health ────────────────────────────────────────────────────────────────

  private initHealth(): void {
    const services: ServiceName[] = ["audio", "stt", "detector", "propresenter"];
    for (const service of services) {
      this.health.set(service, {
        service,
        status: "ok",
        lastUpdated: Date.now(),
      });
    }
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
   */
  async clearText(): Promise<boolean> {
    this.cancelOverlayAutoClear();
    const client = proPresenterService.rawClient;

    const layers = this.activeLayers.size > 0
      ? [...this.activeLayers]
      : [...OVERLAY_LAYERS];

    const results: boolean[] = [];
    for (const layer of layers) {
      if (layer === "presentation") {
        const stripped = await overlayWindow.clearText();
        if (!stripped) {
          const keptBackground = await this.presentLiveBackground();
          if (!keptBackground && !mediaService.getLiveItem()) {
            await overlayWindow.clear();
          }
        }
        results.push(true);
      } else if (layer === "messages") {
        const clearedMessage = await client.clearScriptureMessage();
        const clearedLayer = await client.clearMessages();
        results.push(clearedMessage && clearedLayer);
      } else {
        results.push(await client.clearStageMessage());
      }
    }

    return results.every(Boolean);
  }

  /**
   * Clear is layer-aware: it takes down every PP layer this app most recently
   * pushed to, which under fan-out can be several at once.
   *   presentation → overlay window blanked + NDI frame reset, AND
   *                  GET /v1/clear/layer/slide (library slide). Video input stays.
   *   messages     → clearScriptureMessage + clearMessages
   *   stage        → DELETE /v1/stage/message
   * Also drops the media-dock live item so the operator preview matches the
   * blank program. Header CLEAR and IPC CLEAR_OVERLAY use this.
   */
  async clearOverlay(): Promise<boolean> {
    this.cancelOverlayAutoClear();
    const client = proPresenterService.rawClient;

    const layers = this.activeLayers.size > 0
      ? [...this.activeLayers]
      : [...OVERLAY_LAYERS];

    const results: boolean[] = [];
    for (const layer of layers) {
      if (layer === "presentation") {
        await overlayWindow.clear();
        // The NDI frame is ours to blank, but the PP video-input selection is
        // operator-owned state. Keep it selected so the next frame is visible
        // without requiring the operator to click the input again.
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

      if (this.cfg.llmApiKey) {
        this.detector = new ScriptureDetector({
          provider: this.cfg.llmProvider,
          apiKey: this.cfg.llmApiKey,
          model: this.cfg.scriptureModel,
        });
        this.detector.setPlanIndexProvider(() => livePlanService.getIndex());
        this.detector.on("planProgress", (reference, itemId) => livePlanService.observe(reference, itemId));

        this.detector.on("detection", (refs) => {
          this.handleDetection(refs).catch((err) =>
            log.error("[Orchestrator] handleDetection error on recovery", (err as Error).message)
          );
        });
        this.detector.on("requestSuccess", () => {
          resilienceManager.handleClaudeSuccess();
        });

        this.detector.on("stats", (stats: DetectorStats) => {
          if (this.session) {
            this.session.detectorCalls = stats.totalCalls;
            this.session.avgDetectorLatencyMs = stats.averageLatencyMs;
          }
        });

        this.detector.on("error", (err: Error) => {
          log.error("[Orchestrator] Detector recovery error", err.message);
          this.updateHealth("detector", "error", err.message);
          this.emitStatus();
          resilienceManager.handleClaudeError(err);
        });

        if (this.bufferAnalyzeListener) {
          sttService.buffer.off("analyzeReady", this.bufferAnalyzeListener);
        }
        this.bufferAnalyzeListener = (ctx: string) => {
          this.detector!.analyze(ctx);
        };
        sttService.buffer.on("analyzeReady", this.bufferAnalyzeListener);
        this.explicitDetectionCleanup?.();
        this.explicitDetectionCleanup = subscribeExplicitScriptureDetection(
          sttService,
          this.detector,
        );
      }

      sttService.configure(this.cfg.sttProvider, this.cfg.sttApiKey, this.cfg.sttLanguage);

      try {
        await sttService.start();
        this.updateHealth("stt", "ok");
      } catch (err) {
        log.error("[Orchestrator] STT start failed on recovery", (err as Error).message);
        this.updateHealth("stt", "error", (err as Error).message);
      }

      try {
        await audioService.startCapture(this.cfg.audioDeviceId);
        const pcmStream = audioService.getPCMStream();
        if (pcmStream) {
          sttService.deepgram.attachStream(pcmStream);
        }
        this.updateHealth("audio", "ok");
      } catch (err) {
        log.error("[Orchestrator] Audio capture start failed on recovery", (err as Error).message);
        this.updateHealth("audio", "error", (err as Error).message);
      }
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

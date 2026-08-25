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
} from "@shared/ipc";
import { normalizeOverlaySettings } from "@shared/overlay-defaults";
import { getOverlayDispatchOrder } from "@shared/overlay-dispatch";
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
import { overlayWindow } from "./services/ndi/overlay-window";
import { store } from "./db";

/** D2 — which mechanism last successfully showed the scripture overlay. Drives mode-aware clear semantics. */
type OverlayMechanism = "library" | "ndi" | "message" | null;

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
  private lastOverlayMechanism: OverlayMechanism = null;

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
    if (!this.cfg) return;

    for (const ref of refs) {
      // Live sermon playlist first: its verses are already resolved, in the
      // translation the preacher chose, so a hit skips the Bible lookup
      // entirely. A miss — or a range the playlist only partly covers — falls
      // through to the normal path untouched, so off-plan verses still detect.
      const planEntries = matchPlanReference(livePlanService.getIndex(), ref);
      const planEntry = planEntries[0] ?? null;
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

    const mechanism = await this.dispatchScripture(suggestion);
    if (!mechanism) {
      const msg = `Failed to present "${suggestion.reference}" via any overlay mechanism`;
      this.updateHealth("propresenter", "error", msg);
      this.emitStatus();
      throw new Error(msg);
    }

    if (this.session) this.session.totalPresentations++;
    this.updateHealth("propresenter", "ok");
    log.info("[Orchestrator] Scripture presented", {
      ref: suggestion.reference,
      mechanism,
    });
    this.emitStatus();
  }

  // ─── Mode dispatch (D1 truth table) ────────────────────────────────────────

  /**
   * Implements D1's output-precedence truth table exactly:
   *   auto    → library match, then NDI (if ready), then message overlay
   *   ndi     → NDI only (library NEVER searched); message overlay + health
   *             warning as its sole fallback
   *   message → library match, then message overlay (NDI never used)
   *
   * Shared by the real detection flow (`presentScripture`) and the manual
   * "Send test verse" button (`testOverlay`) so both exercise whichever
   * mechanism the current mode selects, per one code path. Sets
   * `lastOverlayMechanism` (D2) on every success. Returns the mechanism that
   * succeeded, or `null` if every applicable path failed.
   */
  private async dispatchScripture(suggestion: ScriptureSuggestion): Promise<OverlayMechanism> {
    const overlay = normalizeOverlaySettings(store.get("overlay"));
    const mode = overlay.mode;

    // A fresh present is starting — any auto-clear timer left over from a
    // *different* prior push must not fire later and clear this one's mechanism.
    this.cancelOverlayAutoClear();

    for (const mechanism of getOverlayDispatchOrder(mode)) {
      if (mechanism === "ndi") {
        if (await this.pushScriptureOverlayNdi(suggestion, overlay)) {
          this.lastOverlayMechanism = "ndi";
          return "ndi";
        }
        if (mode === "ndi") {
          log.warn("[Orchestrator] NDI not ready in ndi mode — falling back to message overlay", {
            ref: suggestion.reference,
          });
          this.updateHealth("propresenter", "degraded", "NDI not ready — using message overlay fallback");
        }
        continue;
      }

      if (mechanism === "library") {
        const match = await proPresenterService.rawClient.searchLibraries(suggestion.reference);
        if (!match) continue;
        const ok = await proPresenterService.rawClient.triggerLibraryPresentation(
          match.libraryId,
          match.presentationName,
        );
        if (ok) {
          this.lastOverlayMechanism = "library";
          log.info("[Orchestrator] Scripture presented (library)", {
            ref: suggestion.reference,
            library: match.libraryId,
            presentation: match.presentationName,
          });
          return "library";
        }
        log.warn("[Orchestrator] Library trigger failed — falling back", {
          ref: suggestion.reference,
        });
        continue;
      }

      if (await this.pushScriptureOverlay(suggestion, overlay)) {
        this.lastOverlayMechanism = "message";
        return "message";
      }
    }

    return null;
  }

  // ─── Scripture overlay (messages layer) ────────────────────────────────────

  /**
   * Formats and pushes `suggestion` through the messages-layer overlay path,
   * honoring the user's overlay settings (template, translation suffix, verse
   * numbers, verse cap). Schedules the auto-clear timer on success.
   */
  private async pushScriptureOverlay(
    suggestion: ScriptureSuggestion,
    overlay: AppSettings["overlay"],
  ): Promise<boolean> {
    const text = this.formatMessageText(suggestion, overlay);
    if (!text) {
      log.warn("[Orchestrator] No verse text available for overlay push", {
        ref: suggestion.reference,
        translation: suggestion.translation,
      });
      return false;
    }

    const reference = overlay.showTranslation
      ? `${suggestion.reference} (${suggestion.translation})`
      : suggestion.reference;

    const shown = await proPresenterService.rawClient.showScriptureMessage(
      reference,
      text,
      overlay.template,
    );
    if (shown) this.scheduleOverlayAutoClear(overlay.autoClearSec);
    return shown;
  }

  // ─── Scripture overlay (NDI, phase 2) ──────────────────────────────────────

  /**
   * Pushes `suggestion` through the in-app-rendered NDI overlay: ensure a PP
   * video-input binding exists (D7), render the styled slide in the offscreen
   * overlay window, give it one paint cycle to land in the NDI frame buffer,
   * then trigger the bound PP video input (M0's unverified endpoint — see
   * `ProPresenterClient.triggerVideoInput`). Returns false (never throws) on
   * any failure so callers can fall back per the D1 truth table.
   */
  private async pushScriptureOverlayNdi(
    suggestion: ScriptureSuggestion,
    overlay: AppSettings["overlay"],
  ): Promise<boolean> {
    if (!ndiService.getStatus().available) return false;

    const uuid = await this.ensureVideoInputBinding(overlay);
    if (!uuid) {
      log.warn("[Orchestrator] No PP video input bound for NDI — cannot push", {
        ref: suggestion.reference,
      });
      return false;
    }

    const text = this.formatMessageText(suggestion, overlay);
    if (!text) {
      log.warn("[Orchestrator] No verse text available for NDI overlay push", {
        ref: suggestion.reference,
        translation: suggestion.translation,
      });
      return false;
    }

    const reference = overlay.showTranslation
      ? `${suggestion.reference} (${suggestion.translation})`
      : suggestion.reference;

    try {
      await overlayWindow.showScripture(reference, text, overlay.theme);
      // Let at least one 'paint' land in NdiService's frame buffer before
      // triggering PP onto the video input — otherwise PP may cut to a stale
      // (blank) frame for one repeat-loop tick.
      await new Promise((resolve) => setTimeout(resolve, NDI_PAINT_SETTLE_MS));

      const triggered = await proPresenterService.rawClient.triggerVideoInput(uuid);
      if (!triggered) {
        log.warn("[Orchestrator] PP video-input trigger failed", { uuid, ref: suggestion.reference });
        return false;
      }

      this.scheduleOverlayAutoClear(overlay.autoClearSec);
      return true;
    } catch (err) {
      log.error("[Orchestrator] NDI overlay push failed", (err as Error).message);
      return false;
    }
  }

  /**
   * D7 — PP video input binding: persist uuid, name-match only as discovery.
   * If `overlay.ppVideoInputUuid` is set and still present in PP's
   * `/v1/video_inputs` list, use it. Else find by name containing
   * "ProAutomate"; if found, persist its uuid. Never hard-fails a push over
   * discovery — returns null (NDI not ready) if neither resolves.
   */
  private async ensureVideoInputBinding(overlay: AppSettings["overlay"]): Promise<string | null> {
    const inputs = await proPresenterService.rawClient.getVideoInputs();

    if (overlay.ppVideoInputUuid) {
      const bound = inputs.find((i) => i.uuid === overlay.ppVideoInputUuid);
      if (bound) return bound.uuid;
    }

    const discovered = inputs.find((i) => i.name.includes("ProAutomate"));
    if (discovered) {
      const next = normalizeOverlaySettings({ ...overlay, ppVideoInputUuid: discovered.uuid });
      store.set("overlay", next);
      log.info("[Orchestrator] NDI video input discovered and persisted", {
        uuid: discovered.uuid,
        name: discovered.name,
      });
      return discovered.uuid;
    }

    return null;
  }

  /**
   * Pushes a sample John 3:16 (KJV) overlay through whichever mechanism the
   * current `overlay.mode` selects — used by the Settings/Theme "Send test
   * verse" buttons. Shares `dispatchScripture` with the real detection flow so
   * both exercise identical mode-dispatch logic.
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
    const mechanism = await this.dispatchScripture(sample);
    return mechanism !== null;
  }

  /**
   * D2 — clear semantics are mechanism-aware, keyed on `lastOverlayMechanism`:
   *   library → GET /v1/clear/layer/presentation
   *   ndi     → overlay window blanked + NDI frame reset, AND the same
   *             presentation-layer clear (removes the triggered video input)
   *   message → clearScriptureMessage + clearMessages (phase-1 behavior)
   *   null/unknown (e.g. after app restart) → clear all three; idempotent and cheap.
   * Used by Settings/Theme "Clear" buttons, IPC CLEAR_OVERLAY, and the
   * auto-clear timer.
   */
  async clearOverlay(): Promise<boolean> {
    this.cancelOverlayAutoClear();
    const client = proPresenterService.rawClient;

    switch (this.lastOverlayMechanism) {
      case "library":
        return client.clearAll();

      case "ndi": {
        await overlayWindow.clear();
        return client.clearAll();
      }

      case "message": {
        const clearedMessage = await client.clearScriptureMessage();
        const clearedLayer = await client.clearMessages();
        return clearedMessage && clearedLayer;
      }

      case null:
      default: {
        await overlayWindow.clear();
        const results = await Promise.all([
          client.clearAll(),
          client.clearMessages(),
          client.clearScriptureMessage(),
        ]);
        return results.every(Boolean);
      }
    }
  }

  private scheduleOverlayAutoClear(autoClearSec: number): void {
    this.cancelOverlayAutoClear();
    if (autoClearSec > 0) {
      this.overlayClearTimer = setTimeout(() => {
        this.overlayClearTimer = null;
        this.clearOverlay().catch((err) => {
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

  // ─── Message text formatting ───────────────────────────────────────────────

  private formatMessageText(
    suggestion: ScriptureSuggestion,
    overlay: AppSettings["overlay"],
  ): string | null {
    let verses = suggestion.verses;
    if (verses.length === 0) return null;

    let truncated = false;
    if (overlay.maxVerses > 0 && verses.length > overlay.maxVerses) {
      verses = verses.slice(0, overlay.maxVerses);
      truncated = true;
    }

    const showNumbers = overlay.showVerseNumbers && verses.length > 1;
    const lines = verses.map((v) => (showNumbers ? `${v.verse} ${v.text}` : v.text));
    if (truncated && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
    }
    return lines.join("\n");
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

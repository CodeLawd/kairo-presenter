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
import { ScriptureDetector } from "./services/scripture/detector";
import type { DetectorStats, ScriptureReference } from "./services/scripture/detector";
import { BibleDatabase } from "./services/scripture/bible-db";
import { audioService } from "./services/audio";
import { sttService } from "./services/stt";
import { proPresenterService } from "./services/propresenter";
import { scriptureService } from "./services/scripture";
import { resilienceManager } from "./services/resilience";
import { store } from "./db";

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

  private session: Session | null = null;

  private bufferAnalyzeListener: ((ctx: string, _ts: number) => void) | null = null;

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

    // Create ScriptureDetector
    if (config.llmApiKey) {
      this.detector = new ScriptureDetector({
        provider: config.llmProvider,
        apiKey: config.llmApiKey,
        model: config.scriptureModel,
      });

      this.detector.on("detection", (refs) => {
        resilienceManager.handleClaudeSuccess();
        this.handleDetection(refs).catch((err) =>
          log.error("[Orchestrator] handleDetection error", (err as Error).message),
        );
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

      this.updateHealth("detector", "ok");
    }

    // Configure STT
    sttService.configure(config.sttProvider, config.sttApiKey, config.sttLanguage);

    // Wire buffer → detector
    if (this.detector) {
      this.bufferAnalyzeListener = (ctx: string, _ts: number) => {
        this.detector!.analyze(ctx);
      };
      sttService.buffer.on("analyzeReady", this.bufferAnalyzeListener);
    }

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

  dismissAuto(suggestionId: string): void {
    this.cancelAutoPresent(suggestionId);
    log.info("[Orchestrator] Auto-present dismissed by user", { suggestionId });
  }

  // ─── Detection handler ─────────────────────────────────────────────────────

  private async handleDetection(refs: ScriptureReference[]): Promise<void> {
    if (!this.cfg) return;

    for (const ref of refs) {
      const translation = this.cfg.scriptureTranslation;
      let verses: ScriptureVerse[] = [];

      if (this.db) {
        try {
          if (ref.verseEnd != null) {
            verses = this.db
              .getVerseRange(
                translation,
                ref.book,
                ref.chapter,
                ref.verseStart,
                ref.verseEnd,
              )
              .map((v) => ({
                book: v.bookName,
                chapter: v.chapter,
                verse: v.verse,
                text: v.text,
              }));
          } else {
            const v = this.db.getVerse(
              translation,
              ref.book,
              ref.chapter,
              ref.verseStart,
            );
            if (v) {
              verses = [
                {
                  book: v.bookName,
                  chapter: v.chapter,
                  verse: v.verse,
                  text: v.text,
                },
              ];
            }
          }
        } catch (err) {
          log.warn("[Orchestrator] Bible lookup error", {
            book: ref.book,
            err: (err as Error).message,
          });
        }
      }

      const reference = buildReferenceString(ref);
      const suggestion: ScriptureSuggestion = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        reference,
        verses,
        translation,
        confidence: ref.confidence,
        source: "auto",
        triggerText: ref.sourceText,
      };

      this.pendingSuggestions.set(suggestion.id, suggestion);
      if (this.session) this.session.totalDetections++;

      // Publish through scriptureService so existing IPC/renderer pipeline works
      scriptureService.receiveSuggestion(suggestion);

      if (
        this.cfg.autoMode &&
        ref.confidence >= (this.cfg.confidenceThreshold ?? 0.7)
      ) {
        this.scheduleAutoPresent(suggestion);
      }

      this.updateHealth("detector", "ok");
    }

    this.emitStatus();
  }

  // ─── Auto-present countdown ────────────────────────────────────────────────

  private scheduleAutoPresent(suggestion: ScriptureSuggestion): void {
    const delayMs = (this.cfg?.autoPresentDelaySec ?? 3) * 1_000;
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

    // Path A: a presentation named after the reference already exists in a
    // PP library (churches with pre-built scripture decks) — trigger it.
    const match = await proPresenterService.rawClient.searchLibraries(suggestion.reference);
    if (match) {
      const ok = await proPresenterService.rawClient.triggerLibraryPresentation(
        match.libraryId,
        match.presentationName,
      );
      if (ok) {
        if (this.session) this.session.totalPresentations++;
        this.updateHealth("propresenter", "ok");
        log.info("[Orchestrator] Scripture presented (library)", {
          ref: suggestion.reference,
          library: match.libraryId,
          presentation: match.presentationName,
        });
        this.emitStatus();
        return;
      }
      log.warn("[Orchestrator] Library trigger failed — falling back to message push", {
        ref: suggestion.reference,
      });
    }

    // Path B: push verse text via the messages layer. PP's API cannot create
    // presentations, but it can trigger a message template with token values.
    const shown = await this.pushScriptureOverlay(suggestion);
    if (!shown) {
      const msg = `Failed to push "${suggestion.reference}" to ProPresenter messages layer`;
      this.updateHealth("propresenter", "error", msg);
      this.emitStatus();
      throw new Error(msg);
    }

    if (this.session) this.session.totalPresentations++;
    this.updateHealth("propresenter", "ok");
    log.info("[Orchestrator] Scripture presented (message overlay)", {
      ref: suggestion.reference,
    });
    this.emitStatus();
  }

  // ─── Scripture overlay (messages layer) ────────────────────────────────────

  /**
   * Formats and pushes `suggestion` through the messages-layer overlay path,
   * honoring the user's overlay settings (template, translation suffix, verse
   * numbers, verse cap). Schedules the auto-clear timer on success. Shared by
   * the real detection flow and the Settings "Send test verse" button so
   * formatting logic lives in exactly one place.
   */
  private async pushScriptureOverlay(suggestion: ScriptureSuggestion): Promise<boolean> {
    const overlay = store.get("overlay");
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

  /** Pushes a sample John 3:16 (KJV) overlay using current overlay settings — used by Settings "Send test verse". */
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
    return this.pushScriptureOverlay(sample);
  }

  /** Clears the scripture message and the whole messages layer — used by Settings "Clear" and IPC CLEAR_OVERLAY. */
  async clearOverlay(): Promise<boolean> {
    this.cancelOverlayAutoClear();
    const client = proPresenterService.rawClient;
    const clearedMessage = await client.clearScriptureMessage();
    const clearedLayer = await client.clearMessages();
    return clearedMessage && clearedLayer;
  }

  private scheduleOverlayAutoClear(autoClearSec: number): void {
    this.cancelOverlayAutoClear();
    if (autoClearSec > 0) {
      this.overlayClearTimer = setTimeout(() => {
        this.overlayClearTimer = null;
        proPresenterService.rawClient.clearScriptureMessage().catch((err) => {
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

        this.detector.on("detection", (refs) => {
          resilienceManager.handleClaudeSuccess();
          this.handleDetection(refs).catch((err) =>
            log.error("[Orchestrator] handleDetection error on recovery", (err as Error).message)
          );
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildReferenceString(ref: ScriptureReference): string {
  const base = `${ref.book} ${ref.chapter}:${ref.verseStart}`;
  return ref.verseEnd != null ? `${base}-${ref.verseEnd}` : base;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const orchestrator = new Orchestrator();

// Break circular dep: inject orchestrator into resilienceManager instead of lazy-require
resilienceManager.setOrchestrator(orchestrator);

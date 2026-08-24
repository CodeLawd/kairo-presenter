import { ipcMain, BrowserWindow, systemPreferences, dialog } from "electron";
import type { OpenDialogOptions } from "electron";
import log from "electron-log/main";
import type { AppSettings, OrchestratorConfig, ResilienceStatus } from "@shared/ipc";
import { IPC } from "@shared/ipc";
import { normalizeOverlaySettings } from "@shared/overlay-defaults";
import { store } from "../db";
import { proPresenterService } from "../services/propresenter";
import { audioService } from "../services/audio";
import { sttService } from "../services/stt";
import { scriptureService } from "../services/scripture";
import { extractScriptureReferences, readSermonDocument, sermonPlanStore } from "../services/scripture/sermon-plans";
import path from "path";
import { lyricsService } from "../services/lyrics";
import { orchestrator } from "../orchestrator";
import { resilienceManager } from "../services/resilience";
import { ndiService } from "../services/ndi";
import { allowPickedOverlayMedia } from "../services/ndi/media-allowlist";

// ─── Broadcast helper ─────────────────────────────────────────────────────────

function broadcast<T>(channel: string, data: T): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

// ─── ProPresenter handlers ────────────────────────────────────────────────────

function registerProPresenterHandlers(): void {
  ipcMain.handle(IPC.PROPRESENTER.CONNECT, async (_event, options) => {
    const { host, port, password } = options as {
      host: string;
      port: number;
      password: string;
    };
    await proPresenterService.connect({
      host,
      port,
      password,
    });
    log.info("ProPresenter connect requested", { host, port });
  });

  ipcMain.handle(IPC.PROPRESENTER.DISCONNECT, async () => {
    await proPresenterService.disconnect();
  });

  ipcMain.handle(IPC.PROPRESENTER.GET_STATUS, () => {
    return proPresenterService.getStatus();
  });

  ipcMain.handle(
    IPC.PROPRESENTER.TRIGGER_SLIDE,
    async (_event, slideId: string) => {
      await proPresenterService.triggerSlide(slideId);
      log.info("Slide triggered", { slideId });
    },
  );

  ipcMain.handle(IPC.PROPRESENTER.CLEAR_ALL, async () => {
    await proPresenterService.clearAll();
  });

  ipcMain.handle(IPC.PROPRESENTER.GET_LIBRARY, async () => {
    return proPresenterService.getLibrary();
  });

  ipcMain.handle(IPC.PROPRESENTER.GET_PLAYLISTS, async () => {
    return proPresenterService.getPlaylists();
  });

  ipcMain.handle(IPC.PROPRESENTER.TEST_OVERLAY, async () => {
    return orchestrator.testOverlay();
  });

  ipcMain.handle(IPC.PROPRESENTER.CLEAR_OVERLAY, async () => {
    return orchestrator.clearOverlay();
  });
}

// ─── Audio handlers ───────────────────────────────────────────────────────────

function registerAudioHandlers(): void {
  ipcMain.handle(IPC.AUDIO.GET_DEVICES, async () => {
    return audioService.getDevices();
  });

  // Renderer calls this when orchestrator starts — creates the PassThrough stream
  // that Deepgram will consume. The renderer then streams PCM via audio:pcmChunk.
  ipcMain.handle(IPC.AUDIO.START_CAPTURE, async () => {
    audioService.createRendererStream();
  });

  ipcMain.handle(IPC.AUDIO.STOP_CAPTURE, () => {
    audioService.stopCapture();
  });

  // One-way: renderer sends raw Int16 PCM chunks here
  ipcMain.on(IPC.AUDIO.PCM_CHUNK, (_event, buffer: ArrayBuffer) => {
    audioService.feedPCMChunk(Buffer.from(buffer))
  })
}

// ─── Scripture handlers ───────────────────────────────────────────────────────

function registerScriptureHandlers(): void {
  ipcMain.handle(IPC.SCRIPTURE.REGISTER, (_event, suggestion) => {
    scriptureService.receiveSuggestion(suggestion);
  });

  ipcMain.handle(
    IPC.SCRIPTURE.APPROVE,
    async (_event, suggestionId: string) => {
      await orchestrator.approveSuggestion(suggestionId);
    },
  );

  ipcMain.handle(IPC.SCRIPTURE.DISMISS, (_event, suggestionId: string) => {
    orchestrator.dismissSuggestion(suggestionId);
  });

  ipcMain.handle(IPC.SCRIPTURE.SEARCH, async (_event, query: string, translation?: AppSettings['scripture']['defaultTranslation']) => {
    return scriptureService.search(query, translation, store.get('stt').bibleApiKey);
  });

  ipcMain.handle(IPC.SCRIPTURE.GET_TRANSLATIONS, async () => {
    return scriptureService.getTranslationOptions(store.get('stt').bibleApiKey);
  });

  ipcMain.handle(IPC.SCRIPTURE.IMPORT_SERMON_NOTES, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Sermon notes', extensions: ['docx', 'pdf', 'txt', 'md', 'rtf'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const text = await readSermonDocument(filePath);
    const defaultTranslation = store.get('scripture').defaultTranslation;
    return {
      title: path.basename(filePath, path.extname(filePath)),
      sourceFileName: path.basename(filePath),
      items: extractScriptureReferences(text, defaultTranslation),
    };
  });

  ipcMain.handle(IPC.SCRIPTURE.LIST_SERMON_PLANS, () => sermonPlanStore.list());
  ipcMain.handle(IPC.SCRIPTURE.SAVE_SERMON_PLAN, (_event, plan) => sermonPlanStore.save(plan));
  ipcMain.handle(IPC.SCRIPTURE.DELETE_SERMON_PLAN, (_event, planId: string) => sermonPlanStore.delete(planId));

  ipcMain.handle(
    IPC.SCRIPTURE.SET_TRANSLATION,
    async (_event, translation: string) => {
      scriptureService.setDefaultTranslation(translation);
      await store.set("scripture", {
        ...store.get("scripture"),
        defaultTranslation: translation,
      });
    },
  );

  ipcMain.handle(
    IPC.SCRIPTURE.SET_AUTO_MODE,
    async (_event, enabled: boolean) => {
      scriptureService.setAutoMode(enabled);
      await store.set("scripture", {
        ...store.get("scripture"),
        autoMode: enabled,
      });
    },
  );

  ipcMain.handle(
    IPC.SCRIPTURE.SET_CONFIDENCE,
    async (_event, threshold: number) => {
      scriptureService.setConfidenceThreshold(threshold);
      await store.set("scripture", {
        ...store.get("scripture"),
        confidenceThreshold: threshold,
      });
    },
  );
}

// ─── Transcription handlers ───────────────────────────────────────────────────

function registerTranscriptionHandlers(): void {
  ipcMain.handle(IPC.TRANSCRIPTION.GET_HISTORY, () => {
    return sttService.getHistory();
  });

  ipcMain.handle(IPC.TRANSCRIPTION.CLEAR_HISTORY, () => {
    sttService.clearHistory();
  });
}

// ─── Orchestrator handlers ────────────────────────────────────────────────────

function registerOrchestratorHandlers(): void {
  ipcMain.handle(IPC.ORCHESTRATOR.START, async (_event, config: OrchestratorConfig) => {
    await orchestrator.start(config);
  });

  ipcMain.handle(IPC.ORCHESTRATOR.STOP, async () => {
    await orchestrator.stop();
  });

  ipcMain.handle(IPC.ORCHESTRATOR.GET_STATUS, () => {
    return orchestrator.getStatus();
  });

  ipcMain.handle(IPC.ORCHESTRATOR.GET_STATS, () => {
    return orchestrator.getStats();
  });

  ipcMain.handle(IPC.ORCHESTRATOR.APPROVE, async (_event, suggestionId: string) => {
    await orchestrator.approveSuggestion(suggestionId);
  });

  ipcMain.handle(IPC.ORCHESTRATOR.DISMISS, (_event, suggestionId: string) => {
    orchestrator.dismissSuggestion(suggestionId);
  });

  ipcMain.handle(IPC.ORCHESTRATOR.DISMISS_AUTO, (_event, suggestionId: string) => {
    orchestrator.dismissAuto(suggestionId);
  });
}

// ─── Lyrics handlers ──────────────────────────────────────────────────────────

function registerLyricsHandlers(): void {
  ipcMain.handle(IPC.LYRICS.SEARCH, async (_event, query: string) => {
    return lyricsService.search(query);
  });

  ipcMain.handle(IPC.LYRICS.IMPORT, async (_event, source) => {
    return lyricsService.importSong(source);
  });

  ipcMain.handle(IPC.LYRICS.GET_LIBRARY, () => {
    return lyricsService.getLibrary();
  });

  ipcMain.handle(IPC.LYRICS.GET_SONG, (_event, id: string) => {
    return lyricsService.getSong(id);
  });

  ipcMain.handle(IPC.LYRICS.UPDATE, (_event, id: string, song) => {
    return lyricsService.updateSong(id, song);
  });

  ipcMain.handle(IPC.LYRICS.DELETE, (_event, id: string) => {
    return lyricsService.deleteSong(id);
  });

  ipcMain.handle(IPC.LYRICS.TOGGLE_FAVORITE, (_event, id: string) => {
    return lyricsService.toggleFavorite(id);
  });

  ipcMain.handle(IPC.LYRICS.SEND_TO_PP, async (_event, songId: string, options) => {
    await lyricsService.sendToProPresenter(songId, options);
  });

  ipcMain.handle(
    IPC.LYRICS.ADD_TO_PLAYLIST,
    async (_event, songId: string, playlistId: string) => {
      lyricsService.addToPlaylist(songId, playlistId);
    },
  );
}

// ─── Resilience handlers ──────────────────────────────────────────────────────

function registerResilienceHandlers(): void {
  ipcMain.handle(IPC.RESILIENCE.GET_STATUS, () => {
    return resilienceManager.getStatus();
  });

  ipcMain.handle(IPC.RESILIENCE.RESTORE, async () => {
    await resilienceManager.restoreSession();
  });

  ipcMain.handle(IPC.RESILIENCE.DISCARD, async () => {
    await resilienceManager.discardSession();
  });
}

// ─── NDI handlers ──────────────────────────────────────────────────────────────

function registerNdiHandlers(): void {
  ipcMain.handle(IPC.NDI.GET_STATUS, async () => {
    const ndiStatus = ndiService.getStatus();
    const overlay = normalizeOverlaySettings(store.get("overlay"));

    let ppInputConfigured = false;
    if (proPresenterService.getStatus().state === "connected") {
      const inputs = await proPresenterService.rawClient.getVideoInputs();
      ppInputConfigured = overlay.ppVideoInputUuid
        ? inputs.some((i) => i.uuid === overlay.ppVideoInputUuid)
        : inputs.some((i) => i.name.includes("ProAutomate"));
    }

    return { ...ndiStatus, ppInputConfigured };
  });

  ipcMain.handle(IPC.NDI.GET_VIDEO_INPUTS, async () => {
    if (proPresenterService.getStatus().state !== "connected") return [];
    return proPresenterService.rawClient.getVideoInputs();
  });

  ipcMain.handle(IPC.NDI.PICK_OVERLAY_MEDIA, async (_event, kind: "image" | "video") => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const filters =
      kind === "video"
        ? [{ name: "Videos", extensions: ["mp4", "mov", "m4v", "webm"] }]
        : [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }];
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openFile"], filters })
      : await dialog.showOpenDialog({ properties: ["openFile"], filters });
    if (result.canceled || result.filePaths.length === 0) return null;
    allowPickedOverlayMedia(result.filePaths[0]);
    return result.filePaths[0];
  });
}

// ─── Settings handlers ────────────────────────────────────────────────────────

function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS.GET, (_event, key: keyof AppSettings) => {
    if (key === "overlay") return normalizeOverlaySettings(store.get("overlay"));
    return store.get(key);
  });

  ipcMain.handle(
    IPC.SETTINGS.SET,
    (_event, key: keyof AppSettings, value: AppSettings[typeof key]) => {
      if (key === "overlay") {
        // D3 belt-and-braces: electron-store's `set` wholesale-replaces the
        // `overlay` object (no deep-merge). A renderer page that only edits a
        // slice of it (e.g. the Theme editor writing `theme`/`mode` without the
        // phase-1 template fields, or vice versa) must not blow away the rest —
        // merge with what's already stored, then normalize/clamp before persisting.
        const merged = normalizeOverlaySettings({
          ...store.get("overlay"),
          ...(value as Partial<AppSettings["overlay"]>),
        });
        store.set("overlay", merged);
      } else {
        store.set(key, value);
      }
      log.debug("Setting updated", { key });
    },
  );

  ipcMain.handle(IPC.SETTINGS.GET_ALL, () => {
    return { ...store.store, overlay: normalizeOverlaySettings(store.get("overlay")) };
  });
}

// ─── Push event wiring ────────────────────────────────────────────────────────
// Services emit events → broadcast pushes them to all renderer windows.

function wireEventBroadcasting(): void {
  proPresenterService.onStatusChange((status) => {
    broadcast(IPC.PROPRESENTER.STATUS_CHANGE, status);
  });

  sttService.onTranscript((result) => {
    broadcast(IPC.TRANSCRIPTION.TRANSCRIPT, result);
  });

  sttService.onInterim((result) => {
    broadcast(IPC.TRANSCRIPTION.INTERIM, result);
  });

  scriptureService.onSuggestion((suggestion) => {
    broadcast(IPC.SCRIPTURE.SUGGESTION, suggestion);
  });

  orchestrator.onStatus((status) => {
    broadcast(IPC.ORCHESTRATOR.STATUS, status);
  });

  orchestrator.onPendingAuto((pending) => {
    broadcast(IPC.ORCHESTRATOR.PENDING_AUTO, pending);
  });

  resilienceManager.onStatusChange((status: ResilienceStatus) => {
    broadcast(IPC.RESILIENCE.STATUS_CHANGE, status);
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function registerIpcHandlers(): void {
  registerProPresenterHandlers();
  registerAudioHandlers();
  registerScriptureHandlers();
  registerTranscriptionHandlers();
  registerOrchestratorHandlers();
  registerLyricsHandlers();
  registerSettingsHandlers();
  registerResilienceHandlers();
  registerNdiHandlers();
  wireEventBroadcasting();
  log.info("All IPC handlers registered");
}

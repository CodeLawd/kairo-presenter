import { DOCUMENTS } from "@shared/documents";
import { writeFile } from "fs/promises";
import { normalizePresentationSettings, PROGRAM } from "@shared/program";
import { SONG_USAGE, songUsageCsv } from "@shared/song-usage";
import { programService } from "../services/output/program-service";
import { songUsageService } from "../services/song-usage";
import { TRANSFER, type TransferCommitRequest, type TransferExportRequest } from "@shared/kairo-bundle";
import { transferService } from "../services/transfer";
import { documentsService } from "../services/documents";
import { ipcMain, BrowserWindow, clipboard, dialog, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import log from "electron-log/main";
import type {
  AppSettings,
  MediaPlayback,
  NdiOutputStatus,
  DevicePairingState,
  OnboardingState,
  OnboardingStepId,
  SessionSnapshot,
  SignInInput,
  SignUpInput,
  OrchestratorConfig,
  ResilienceStatus,
} from "@shared/ipc";
import { IPC } from "@shared/ipc";
import { normalizeResourceBindings } from "@shared/propresenter-resources";
import type {
  PPResourceBindings,
  PPResourceKind,
} from "@shared/propresenter-resources";
import { normalizeOverlaySettings } from "@shared/overlay-defaults";
import { findNdiOutput, outputRequiresPropresenter, surfaceOutputs } from "@shared/overlay-outputs";
import { propresenterEnabled } from "@shared/pp-connect-gate";
import { normalizeThemeLibrary } from "@shared/theme-library";
import {
  LYRICS_SECRET_KEYS,
  STT_SECRET_KEYS,
  mergeSecretSection,
  redactSettingsSecrets,
  secretsConfiguredFromSettings,
} from "@shared/cloud/org-secrets";
import type { SettingsSecretClearKey, SettingsWithSecretsStatus } from "@shared/ipc";
import { store } from "../db";
import { proPresenterService } from "../services/propresenter";
import { proPresenterResources } from "../services/propresenter/resources";
import { audioService } from "../services/audio";
import { sttService } from "../services/stt";
import { scriptureService } from "../services/scripture";
import { analyzeScriptureReferences, readSermonDocument, sermonPlanStore } from "../services/scripture/sermon-plans";
import { livePlanService } from "../services/scripture/live-plan";
import { scriptureTrace } from "../services/scripture/trace";
import { serviceRecords, sermonUploader } from '../services/service-records';
import { SERVICE_CHANNEL, SERVICE_CHANGED, type ServiceCommand } from '@shared/service-records';
import { normalizeDocumentsSettings } from '@shared/documents';
import { SETLIST_CHANGED, SETLIST_CHANNEL, type SetlistCommand } from '@shared/setlist';
import { setlistService } from '../services/setlist';
import { LIBRARIES_CHANGED, LIBRARIES_CHANNEL, type LibrariesCommand } from '@shared/libraries';
import { librariesService } from '../services/libraries';
import { PASSAGES_CHANGED, PASSAGES_CHANNEL, type PassagesCommand } from '@shared/passages';
import { passagesService } from '../services/passages';
import { getDownloadManager, hasDownloadManager } from "../services/scripture/offline-bibles";
import path from "path";
import { lyricsService } from "../services/lyrics";
import { workspaceService } from "../services/workspace";
import { buildSlides } from "@shared/lyrics-slides";
import { normalizeGlossColor } from "@shared/lyrics-style";
import { orchestrator } from "../orchestrator";
import { resilienceManager } from "../services/resilience";
import { updaterService } from "../services/updater";
import { ndiService } from "../services/ndi";
import { mediaService, MEDIA_FILE_EXTENSIONS } from "../services/media";
import { tracksService } from "../services/tracks";
import { TRACK_FILE_EXTENSIONS } from "@shared/tracks";
import { surfaceManager } from "../services/output/surface-manager";
import { dialogParentWindow } from "../main-window";
import { allowPickedOverlayMedia } from "../services/ndi/media-allowlist";
import { runBootstrap } from "../bootstrap";
import { onboardingService } from "../services/cloud/onboarding";
import { cloudSession } from "../services/cloud/session";

// ─── Broadcast helper ─────────────────────────────────────────────────────────

/** Replace a handler so `--watch` reloads cannot leave a channel unregistered. */
function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

function broadcast<T>(channel: string, data: T): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

// ─── .kairo transfer handlers ─────────────────────────────────────────────────

/** Files opened from Finder/Explorer before the window could show them. */
const pendingKairoOpens: string[] = [];
let kairoOpenTarget: Electron.WebContents | null = null;

async function flushKairoOpens(): Promise<void> {
  const target = kairoOpenTarget;
  if (!target || target.isDestroyed()) return;
  while (pendingKairoOpens.length > 0) {
    const filePath = pendingKairoOpens.shift()!;
    try {
      target.send(TRANSFER.OPENED, await transferService.previewFile(filePath));
    } catch (err) {
      target.send(TRANSFER.OPENED, {
        error: (err as Error).message,
        fileName: path.basename(filePath),
      });
    }
  }
}

/** Queue `.kairo` files opened from outside the app for the review screen. */
export function openKairoFiles(filePaths: string[]): void {
  pendingKairoOpens.push(...filePaths);
  void flushKairoOpens();
}

function registerTransferHandlers(): void {
  handle(TRANSFER.EXPORT, (_event, request: TransferExportRequest) =>
    transferService.export(request),
  );
  handle(TRANSFER.PICK_AND_PREVIEW, () => transferService.pickAndPreview());
  handle(TRANSFER.COMMIT, (_event, request: TransferCommitRequest) =>
    transferService.commit(request),
  );
  handle(TRANSFER.DISCARD, (_event, token: string) => transferService.discard(token));
  ipcMain.removeAllListeners(TRANSFER.READY);
  ipcMain.on(TRANSFER.READY, (event) => {
    kairoOpenTarget = event.sender;
    void flushKairoOpens();
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

  ipcMain.handle(IPC.PROPRESENTER.GET_LOOKS, async () => {
    if (proPresenterService.getStatus().state !== "connected") return [];
    return proPresenterService.rawClient.getLooks();
  });

  ipcMain.handle(IPC.PROPRESENTER.GET_RESOURCE_CATALOGUE, async (_event, options?: { refresh?: boolean }) => {
    if (proPresenterService.getStatus().state !== "connected") {
      return { refreshedAt: Date.now(), resources: [], warnings: [] };
    }
    return proPresenterResources.getCatalogue({ refresh: options?.refresh === true });
  });

  ipcMain.handle(
    IPC.PROPRESENTER.GET_RESOURCE_DETAILS,
    async (_event, kind: PPResourceKind, id: string) => {
      if (proPresenterService.getStatus().state !== "connected") return null;
      return proPresenterResources.getDetails(kind, id);
    },
  );

  ipcMain.handle(
    IPC.PROPRESENTER.GET_RESOURCE_PREVIEW,
    async (_event, kind: PPResourceKind, id: string, childId?: string) => {
      if (proPresenterService.getStatus().state !== "connected") return null;
      return proPresenterResources.getPreview(kind, id, childId);
    },
  );

  ipcMain.handle(
    IPC.PROPRESENTER.SET_RESOURCE_BINDINGS,
    (_event, bindings: PPResourceBindings) => {
      store.set("propresenterResources", normalizeResourceBindings(bindings));
      orchestrator.forgetVideoInputBinding();
      return store.get("propresenterResources");
    },
  );
}

// ─── Audio handlers ───────────────────────────────────────────────────────────

function registerAudioHandlers(): void {
  // The relay stream is created by the orchestrator (attachAudioStream), not by
  // the renderer. The renderer only pushes PCM via audio:pcmChunk.
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

  ipcMain.handle(IPC.SCRIPTURE.PRESENT_DIRECTLY, async (_event, suggestion) => {
    await orchestrator.presentScriptureDirectly(suggestion);
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

  ipcMain.handle(IPC.SCRIPTURE.GET_TRANSLATIONS, async (_event, apiKey?: string) => {
    return scriptureService.getTranslationOptions(
      apiKey ?? store.get('stt').bibleApiKey,
      apiKey !== undefined,
    );
  });

  ipcMain.handle(IPC.SCRIPTURE.IMPORT_SERMON_NOTES, async () => {
    const win = dialogParentWindow();
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Sermon notes', extensions: ['docx', 'pdf', 'txt', 'md', 'rtf'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const { text, html } = await readSermonDocument(filePath);
    const defaultTranslation = store.get('scripture').defaultTranslation;
    const analysis = analyzeScriptureReferences(text, defaultTranslation);
    return {
      title: path.basename(filePath, path.extname(filePath)),
      sourceFileName: path.basename(filePath),
      text,
      html,
      ...analysis,
    };
  });

  ipcMain.handle(IPC.SCRIPTURE.SCAN_SERMON_NOTES, (_event, text: string) => {
    return analyzeScriptureReferences(text, store.get('scripture').defaultTranslation);
  });

  ipcMain.handle(IPC.SCRIPTURE.LIST_SERMON_PLANS, () => sermonPlanStore.list());

  // Every playlist edit in the Scripture tab funnels through save/delete, so
  // refreshing here is all that keeps the live index from going stale.
  ipcMain.handle(IPC.SCRIPTURE.SAVE_SERMON_PLAN, (_event, plan) => {
    const saved = sermonPlanStore.save(plan);
    livePlanService.refresh(saved.id);
    return saved;
  });

  ipcMain.handle(IPC.SCRIPTURE.DELETE_SERMON_PLAN, (_event, planId: string) => {
    sermonPlanStore.delete(planId);
    livePlanService.handleDeleted(planId);
  });

  ipcMain.handle(IPC.SCRIPTURE.RECENT_TRACES, (_event, limit?: number) =>
    scriptureTrace.recentWithMetrics(limit),
  );

  // `on`, not `handle`: the renderer reports a paint and carries on. Making it
  // await a reply would add latency to the very thing being measured.
  ipcMain.on(IPC.SCRIPTURE.MARK_RENDERED, (_event, correlationId: string) => {
    scriptureTrace.mark(correlationId, "suggestionRenderedAt");
  });

  ipcMain.handle(IPC.SCRIPTURE.GET_LIVE_PLAN, () => livePlanService.getState());

  ipcMain.handle(
    IPC.SCRIPTURE.SET_LIVE_PLAN,
    (_event, planId: string | null) => livePlanService.setPlan(planId),
  );

  ipcMain.handle(
    IPC.SCRIPTURE.SET_AUTO_MODE,
    async (_event, enabled: boolean) => {
      scriptureService.setAutoMode(enabled);
      orchestrator.setAutoMode(enabled);
      await store.set("scripture", {
        ...store.get("scripture"),
        autoMode: enabled,
      });
    },
  );

  // ── Offline API.Bible cache ────────────────────────────────────────────────
  // Every id crossing this boundary is validated against the list the saved key
  // is authorized for; the renderer never sees the key, cache path, or ciphertext.

  ipcMain.handle(IPC.SCRIPTURE.LIST_OFFLINE_TRANSLATIONS, async () =>
    hasDownloadManager() ? await getDownloadManager().listOfflineTranslations() : [],
  );

  // Resolves once the download has *started*; chapter-by-chapter progress is
  // pushed, so the renderer stays responsive (and can pause) while it runs.
  ipcMain.handle(IPC.SCRIPTURE.DOWNLOAD_TRANSLATION, async (_event, bibleId: string) => {
    await scriptureService.ensureAuthorizedBibleId(bibleId, store.get("stt").bibleApiKey);
    await getDownloadManager().startDownloadInBackground(bibleId);
  });

  ipcMain.handle(IPC.SCRIPTURE.PAUSE_TRANSLATION_DOWNLOAD, (_event, bibleId: string) => {
    getDownloadManager().pauseDownload(bibleId);
  });

  ipcMain.handle(IPC.SCRIPTURE.REFRESH_OFFLINE_TRANSLATION, async (_event, bibleId: string) => {
    await scriptureService.ensureAuthorizedBibleId(bibleId, store.get("stt").bibleApiKey);
    await getDownloadManager().refreshInBackground(bibleId);
  });

  // Removal must keep working after access is revoked, so it validates against
  // what is cached rather than against the live authorization list.
  ipcMain.handle(IPC.SCRIPTURE.REMOVE_OFFLINE_TRANSLATION, (_event, bibleId: string) => {
    const manager = getDownloadManager();
    const known = manager.hasCachedTranslation(bibleId);
    if (!known) throw new Error("That Bible has no cached content to remove.");
    manager.removeTranslation(bibleId);
  });

  ipcMain.handle(
    IPC.SCRIPTURE.SET_CONFIDENCE,
    async (_event, threshold: number) => {
      scriptureService.setConfidenceThreshold(threshold);
      orchestrator.setConfidenceThreshold(threshold);
      await store.set("scripture", {
        ...store.get("scripture"),
        confidenceThreshold: threshold,
      });
    },
  );

  // ── Optional local Bible packs (any single-translation SQLite pack) ────
  // Filesystem and database access stay here in the main process. The
  // renderer never sees the pack path: with no argument the native picker
  // runs here and only the typed install result crosses the bridge.

  ipcMain.handle(IPC.SCRIPTURE.GET_LOCAL_BIBLE_PACK_STATUS, (_event, translation: string) => {
    if (typeof translation !== "string" || !translation.trim()) {
      throw new Error("A translation id is required.");
    }
    return scriptureService.getLocalBiblePackStatus(translation.trim());
  });

  ipcMain.handle(IPC.SCRIPTURE.INSTALL_LOCAL_BIBLE_PACK, async () => {
    const win = dialogParentWindow();
    const options: OpenDialogOptions = {
      title: "Install local Bible pack",
      properties: ["openFile"],
      filters: [{ name: "Bible packs", extensions: ["db", "sqlite", "sqlite3"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return scriptureService.installLocalBiblePack(result.filePaths[0]);
  });

  ipcMain.handle(IPC.SCRIPTURE.DOWNLOAD_LOCAL_BIBLE_TRANSLATION, async (_event, translation: string) => {
    if (typeof translation !== "string" || !translation.trim()) {
      throw new Error("A translation id is required.");
    }
    return scriptureService.downloadLocalBibleTranslation(translation.trim());
  });

  ipcMain.handle(IPC.SCRIPTURE.REMOVE_LOCAL_BIBLE_TRANSLATION, (_event, translation: string) => {
    if (typeof translation !== "string" || !translation.trim()) {
      throw new Error("A translation id is required.");
    }
    return scriptureService.removeLocalBibleTranslation(translation.trim());
  });

  ipcMain.handle(IPC.SCRIPTURE.LIST_INSTALLED_LOCAL_BIBLE_PACKS, () =>
    scriptureService.listInstalledLocalBiblePacks(),
  );
}

// ─── Transcription handlers ───────────────────────────────────────────────────

function registerTranscriptionHandlers(): void {
  serviceRecords.init();
  serviceRecords.onChanged(snapshot => broadcast(SERVICE_CHANGED, snapshot));
  // Anything still waiting when the app last closed goes out now.
  sermonUploader.start();
  let changingService = false;
  handle(SERVICE_CHANNEL, async (_event, command: ServiceCommand) => {
    if (command.action === 'list') return serviceRecords.snapshot();
    if (changingService) throw new Error('Service is updating. Please try again.');
    changingService = true;
    try {
      if (command.action === 'start') {
        // No dialog first: the operator hits record, the service opens unnamed
        // and is named when they end it. The live plan selection is theirs and
        // is left alone here.
        serviceRecords.create();
        sttService.clearHistory();
      } else if (command.action === 'end') {
        const plan = command.planId ? sermonPlanStore.get(command.planId) : null;
        if (command.planId && !plan) throw new Error('Selected notes are unavailable.');
        await orchestrator.stop();
        serviceRecords.end({ title: command.title, speaker: command.speaker, note: plan });
      } else if (command.action === 'discard') {
        await orchestrator.stop();
        serviceRecords.discard();
        sttService.clearHistory();
      } else if (command.action === 'nugget') {
        serviceRecords.nugget(command.text, command.sourceIds);
      } else if (command.action === 'analyze') {
        serviceRecords.retryAnalysis(command.serviceId);
      } else if (command.action === 'removeNugget') {
        serviceRecords.removeNugget(command.serviceId, command.nuggetId);
      } else if (command.action === 'upload') {
        // Only re-queues — the upload itself runs outside this mutex so a slow
        // network can never block another service command.
        serviceRecords.requeueUpload(command.serviceId);
      } else throw new Error('Unknown service command.');
      return serviceRecords.snapshot();
    } finally { changingService = false; }
  });
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
    if (!serviceRecords.active()) throw new Error('Create a service in Operator before starting transcription.');
    // Renderer settings are redacted — fill secret fields from the local store.
    const stt = store.get("stt");
    const hydrated: OrchestratorConfig = {
      ...config,
      sttApiKey: config.sttApiKey?.trim() || stt.apiKey,
      llmApiKey:
        config.llmApiKey?.trim() ||
        (config.llmProvider === "deepseek" ? stt.deepseekApiKey : stt.anthropicApiKey),
      sttProvider:
        config.sttProvider !== "none"
          ? config.sttProvider
          : stt.apiKey
            ? "deepgram"
            : stt.provider,
    };
    await orchestrator.start(hydrated);
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

// ─── Workspace handlers ───────────────────────────────────────────────────────

function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC.WORKSPACE.GET, () => workspaceService.ensure());

  ipcMain.handle(IPC.WORKSPACE.CHOOSE_FOLDER, async (_event, options?: { move?: boolean }) => {
    const current = await workspaceService.ensure();
    const result = await dialog.showOpenDialog({
      title: "Choose where Kairo keeps songs and media",
      defaultPath: current.root,
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Use this folder",
    });
    if (result.canceled || result.filePaths.length === 0) return current;

    const info = await workspaceService.setRoot(result.filePaths[0], { move: options?.move });
    // Both libraries read from the new location: songs from the folder, the
    // dock from whatever media.folder now points at.
    lyricsService.syncFromFolder();
    await mediaService.scan();
    return info;
  });

  ipcMain.handle(IPC.WORKSPACE.REVEAL, () => workspaceService.reveal());
  ipcMain.handle(IPC.WORKSPACE.REVEAL_SONGS, () => workspaceService.revealSongs());

  ipcMain.handle(IPC.WORKSPACE.RESYNC_SONGS, async () => {
    await workspaceService.ensure();
    return lyricsService.syncFromFolder();
  });

  ipcMain.handle(IPC.WORKSPACE.MEDIA_MIGRATION, () => workspaceService.mediaMigration());

  ipcMain.handle(IPC.WORKSPACE.ADOPT_MEDIA, async (_event, options?: { move?: boolean }) => {
    const folder = await workspaceService.adoptMediaFolder({ move: options?.move });
    return mediaService.setFolder(folder);
  });
}

// ─── Lyrics handlers ──────────────────────────────────────────────────────────

function registerLyricsHandlers(): void {
  ipcMain.handle(IPC.LYRICS.SEARCH, async (_event, query: string) => {
    return lyricsService.search(query);
  });

  ipcMain.handle(IPC.LYRICS.SEARCH_ONLINE, async (_event, query: string) => {
    return lyricsService.searchOnline(query);
  });

  ipcMain.handle(
    IPC.LYRICS.PREVIEW_ONLINE,
    async (
      _event,
      source: { provider: import("@shared/ipc").LyricsProvider; url: string; title: string; artist: string },
    ) => {
      return lyricsService.previewOnline(source);
    },
  );

  ipcMain.handle(IPC.LYRICS.IMPORT, async (_event, source) => {
    return lyricsService.importSong(source);
  });

  ipcMain.handle(IPC.LYRICS.PREVIEW_FILE, (_event, source) => {
    return lyricsService.previewImport(source);
  });

  ipcMain.handle(IPC.LYRICS.READ_CLIPBOARD, () => {
    return clipboard.readText();
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

  librariesService.onChanged((state) => broadcast(LIBRARIES_CHANGED, state));
  passagesService.onChanged((passages) => broadcast(PASSAGES_CHANGED, passages));
  handle(PASSAGES_CHANNEL, (_event, command: PassagesCommand) => {
    return passagesService.apply(command);
  });

  handle(LIBRARIES_CHANNEL, (_event, command: LibrariesCommand) => {
    return librariesService.apply(command);
  });

  setlistService.onChanged((setlist) => broadcast(SETLIST_CHANGED, setlist));
  handle(SETLIST_CHANNEL, (_event, command: SetlistCommand) => {
    return setlistService.apply(command);
  });

  ipcMain.handle(IPC.LYRICS.DELETE, (_event, id: string) => {
    const result = lyricsService.deleteSong(id);
    // A deleted song must not linger in the service order as a dead row, nor
    // keep a library assignment pointing at nothing.
    setlistService.forgetSong(id);
    librariesService.forgetItem('songs', id);
    return result;
  });

  ipcMain.handle(IPC.LYRICS.TOGGLE_FAVORITE, (_event, id: string) => {
    return lyricsService.toggleFavorite(id);
  });

  ipcMain.handle(IPC.LYRICS.SEND_TO_PP, async (_event, songId: string, options) => {
    await lyricsService.sendToProPresenter(songId, options);
  });

  ipcMain.handle(IPC.LYRICS.PUSH_SLIDE, async (_event, songId: string, slideIndex: number) => {
    const song = lyricsService.getSong(songId);
    if (!song) throw new Error(`Song not found: ${songId}`);

    // Same builder the library grid renders from, so `slideIndex` lines up with
    // the tile the operator clicked.
    const slides = buildSlides(song, {
      glossColor: normalizeGlossColor(store.get("lyrics").glossColor),
    });
    const slide = slides[slideIndex];
    if (!slide) throw new Error(`Slide ${slideIndex + 1} not found in "${song.title}"`);

    const following = slides[slideIndex + 1];
    await orchestrator.presentLyricSlide(
      `${song.title} — ${slide.sectionLabel}`,
      slide.lines.join("\n"),
      slide.lines.map((text, index) => ({ text, color: slide.lineColors?.[index] })),
      following
        ? { reference: `${song.title} — ${following.sectionLabel}`, text: following.lines.join("\n") }
        : null,
    );
    // After the push: a slide that failed to go up was not sung from Kairo.
    songUsageService.record(song);
  });

  ipcMain.handle(
    IPC.LYRICS.ADD_TO_PLAYLIST,
    async (_event, songId: string, playlistId: string) => {
      lyricsService.addToPlaylist(songId, playlistId);
    },
  );

  ipcMain.handle(
    IPC.LYRICS.TRANSLATE,
    async (
      _event,
      sections: import("@shared/ipc").LyricsSongSection[],
      options?: {
        target?: string;
        sourceLanguage?: string;
        title?: string;
        artist?: string;
      },
    ) => {
      const lyrics = store.get("lyrics");
      const stt = store.get("stt");
      const provider = stt.llmProvider === "deepseek" ? "deepseek" : "anthropic";
      const llmKey =
        provider === "deepseek" ? stt.deepseekApiKey?.trim() : stt.anthropicApiKey?.trim();
      const { translateSections } = await import("../services/lyrics/translate");
      return translateSections(sections, {
        apiKey: lyrics.googleTranslateApiKey ?? "",
        braveApiKey: lyrics.braveApiKey,
        target: options?.target ?? "en",
        sourceLanguage: options?.sourceLanguage ?? "auto",
        title: options?.title,
        artist: options?.artist,
        llm: llmKey ? { provider, apiKey: llmKey } : null,
      });
    },
  );
}

// ─── Update handlers ──────────────────────────────────────────────────────────

function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.UPDATES.GET_STATUS, () => updaterService.getStatus());
  ipcMain.handle(IPC.UPDATES.CHECK, () => updaterService.check());
  ipcMain.handle(IPC.UPDATES.DOWNLOAD, () => updaterService.download());
  ipcMain.handle(IPC.UPDATES.INSTALL, () => {
    updaterService.install();
  });

  updaterService.onChange((status) => broadcast(IPC.UPDATES.STATUS, status));
}

// ─── Resilience handlers ──────────────────────────────────────────────────────

function registerResilienceHandlers(): void {
  ipcMain.handle(IPC.RESILIENCE.GET_STATUS, () => {
    return resilienceManager.getStatus();
  });

  ipcMain.handle(IPC.RESILIENCE.RESTORE, async () => {
    if (!serviceRecords.active()) throw new Error('Create or resume a service before restoring transcription.');
    await resilienceManager.restoreSession();
  });

  ipcMain.handle(IPC.RESILIENCE.DISCARD, async () => {
    await resilienceManager.discardSession();
  });
}

// ─── Document handlers ────────────────────────────────────────────────────────

function registerDocumentHandlers(): void {
  handle(DOCUMENTS.LIST, () => documentsService.list());
  handle(DOCUMENTS.CAPABILITIES, () => documentsService.capabilities());
  handle(DOCUMENTS.PREPARE, (event, kind) => documentsService.prepare(kind, (document) => {
    if (!event.sender.isDestroyed()) event.sender.send(DOCUMENTS.PREPARING, document);
  }));
  handle(DOCUMENTS.SAVE_PAGE, (_event, id, page, png) => documentsService.savePage(id, page, png));
  handle(DOCUMENTS.FINISH, (_event, id) => documentsService.finish(id));
  handle(DOCUMENTS.CANCEL, (_event, id) => documentsService.cancel(id));
  handle(DOCUMENTS.RENAME, (_event, id, name) => documentsService.rename(id, name));
  handle(DOCUMENTS.REMOVE, (_event, id) => {
    librariesService.forgetItem('documents', id);
    return documentsService.remove(id);
  });
  handle(DOCUMENTS.PUSH, async (_event, id, page) => {
    const slide = await documentsService.slide(id, page);
    const applied = await orchestrator.presentDocumentPage(slide.path, slide);
    mediaService.setLiveItem(null);
    programService.setSlide({ reference: `Page ${page + 1}`, text: "" });
    // Decode the next page while the room reads this one. Never awaited: a
    // missing next page (end of deck) must not slow or fail this push.
    if (applied) {
      void documentsService
        .page(id, page + 1)
        .then((next) => surfaceManager.preloadDocumentPage(next))
        .catch(() => undefined);
    }
    return { applied };
  });
  handle(DOCUMENTS.PLAYBACK, async (_event, id, page) => {
    const states = await Promise.all(surfaceManager.allSurfaces().map((surface) => surface.documentPlayback().catch(() => null)));
    return states.find((state) => state !== null && state.id === id && state.page === page) ?? null;
  });
  handle(DOCUMENTS.CONTROL, async (_event, id, page, video, command) => {
    if (typeof id !== 'string' || !Number.isInteger(page) || !Number.isInteger(video) || video < 0 ||
      !command || !['play', 'pause', 'restart', 'seek'].includes(command.action) ||
      (command.action === 'seek' && !Number.isFinite(command.seconds))) throw new Error('Invalid document video command.');
    const results = await Promise.all(surfaceManager.allSurfaces().map((surface) => surface.controlDocumentVideo(id, page, video, command)));
    if (!results.some(Boolean)) throw new Error('Push this slide before playing its video.');
  });
}

/**
 * Why a background reached no screen, in the operator's words: the first
 * screen that should have taken it and what is wrong with it.
 */
function backgroundTargetProblem(): string {
  // Outputs a background could land on — lobby screens play their own playlist.
  const outputs = surfaceOutputs(normalizeOverlaySettings(store.get("overlay")).outputs).filter(
    (o) => o.show.backgrounds,
  );
  if (outputs.length === 0) return "No screen is on";
  const screen = outputs.find((o) => o.kind === "screen");
  if (screen) return `${screen.name}: ${surfaceManager.screenState(screen.id).reason}`;
  return "The NDI feed is not available";
}

function registerMediaHandlers(): void {
  handle(IPC.MEDIA.IMPORT_FILES, async (_event, kind: "image" | "video") => {
    if (kind !== "image" && kind !== "video") throw new Error("Unsupported media type.");
    if (!mediaService.getLibrary().folder) {
      const folder = await dialog.showOpenDialog({ title: "Choose a backgrounds folder for imported files", properties: ["openDirectory", "createDirectory"] });
      if (folder.canceled || !folder.filePaths[0]) return mediaService.getLibrary();
      await mediaService.setFolder(folder.filePaths[0]);
    }
    const result = await dialog.showOpenDialog({
      title: kind === "image" ? "Import images" : "Import videos",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: kind === "image" ? "Images" : "Videos", extensions: kind === "image" ? ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"] : ["mp4", "webm", "m4v", "mov", "ogv"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return mediaService.getLibrary();
    return mediaService.importIntoPlaylist(null, result.filePaths);
  });
  ipcMain.handle(IPC.MEDIA.GET_LIBRARY, () => mediaService.getLibrary());

  ipcMain.handle(IPC.MEDIA.RESCAN, () => mediaService.scan());

  ipcMain.handle(IPC.MEDIA.CREATE_FOLDER, (_event, name: string) =>
    mediaService.createFolder(name),
  );

  ipcMain.handle(IPC.MEDIA.CHOOSE_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose your backgrounds folder",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Use this folder",
    });
    if (result.canceled || result.filePaths.length === 0) return mediaService.getLibrary();
    return mediaService.setFolder(result.filePaths[0]);
  });

  /**
   * Clicking a background IS the push. The overlay is painted immediately and
   * ProPresenter is cut to the bound NDI video input.
   */
  ipcMain.handle(IPC.MEDIA.PUSH, async (_event, itemId: string) => {
    const item = mediaService.getItem(itemId);
    if (!item) throw new Error("That background is no longer in the folder.");

    mediaService.setLiveItem(item.id);
    const applied = await orchestrator.presentLiveBackground();

    log.info("[Media] Background pushed", { name: item.name, applied });
    return applied ? { applied } : { applied, reason: backgroundTargetProblem() };
  });

  ipcMain.handle(IPC.MEDIA.CLEAR, async () => {
    mediaService.setLiveItem(null);
    await surfaceManager.setBackground({
      ...normalizeOverlaySettings(store.get("overlay")).theme.background,
      type: "transparent",
      mediaPath: "",
    });
    return mediaService.getLibrary();
  });

  ipcMain.handle(IPC.MEDIA.CREATE_PLAYLIST, (_event, name: string) =>
    mediaService.createPlaylist(name),
  );
  ipcMain.handle(IPC.MEDIA.RENAME_PLAYLIST, (_event, id: string, name: string) =>
    mediaService.renamePlaylist(id, name),
  );
  ipcMain.handle(IPC.MEDIA.DELETE_PLAYLIST, (_event, id: string) =>
    mediaService.deletePlaylist(id),
  );
  ipcMain.handle(IPC.MEDIA.SET_PLAYLIST_ITEMS, (_event, id: string, itemIds: string[]) =>
    mediaService.setPlaylistItems(id, itemIds),
  );
  ipcMain.handle(IPC.MEDIA.SET_ITEM_ORDER, (_event, itemIds: string[]) =>
    mediaService.setItemOrder(itemIds),
  );
  ipcMain.handle(IPC.MEDIA.DELETE_ITEM, async (_event, itemId: string) => {
    const live = mediaService.getLiveItem();
    const library = await mediaService.deleteItem(itemId);
    // A background that was on screen must come down with the file — otherwise
    // the NDI frame keeps showing a path that no longer exists.
    if (live?.id === itemId) {
      await surfaceManager.setBackground({
        ...normalizeOverlaySettings(store.get("overlay")).theme.background,
        type: "transparent",
        mediaPath: "",
      });
    }
    return library;
  });
  ipcMain.handle(IPC.MEDIA.RENAME_ITEM, (_event, itemId: string, name: string) =>
    mediaService.renameItem(itemId, name),
  );
  ipcMain.handle(IPC.MEDIA.REVEAL_ITEM, (_event, itemId: string) => {
    mediaService.revealItem(itemId);
  });
  ipcMain.handle(IPC.MEDIA.COPY_ITEMS, (_event, itemIds: string[]) => {
    mediaService.copyItems(itemIds);
  });
  ipcMain.handle(IPC.MEDIA.CUT_ITEMS, (_event, itemIds: string[], fromPlaylistId?: string) => {
    mediaService.cutItems(itemIds, fromPlaylistId);
  });
  ipcMain.handle(IPC.MEDIA.PASTE_ITEMS, (_event, playlistId?: string) =>
    mediaService.pasteItems(playlistId),
  );
  ipcMain.handle(IPC.MEDIA.CLIPBOARD_HAS_FILES, () => mediaService.clipboardHasFiles());

  ipcMain.handle(IPC.MEDIA.ADD_MEDIA_TO_PLAYLIST, async (_event, playlistId: string) => {
    const win = dialogParentWindow();
    const options: OpenDialogOptions = {
      title: "Add backgrounds",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Backgrounds", extensions: [...MEDIA_FILE_EXTENSIONS] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return mediaService.getLibrary();
    return mediaService.importIntoPlaylist(playlistId, result.filePaths);
  });

  ipcMain.handle(IPC.MEDIA.SET_PLAYBACK, async (_event, itemId: string, patch: Partial<MediaPlayback>) => {
    const library = await mediaService.setPlayback(itemId, patch);
    const live = mediaService.getLiveItem();
    if (live?.id === itemId) {
      await surfaceManager.patchBackgroundPlayback(mediaService.getPlayback(itemId));
    }
    return library;
  });

  ipcMain.handle(IPC.MEDIA.SET_PAUSED, async (_event, paused: boolean) => {
    const library = mediaService.setLivePaused(!!paused);
    await surfaceManager.setVideoPaused(library.livePaused);
    return library;
  });

  ipcMain.handle(IPC.MEDIA.SEEK, async (_event, seconds: number) => {
    const live = mediaService.getLiveItem();
    if (!live || live.kind !== "video") return;
    await surfaceManager.seekVideo(Number(seconds));
  });
}

function registerTracksHandlers(): void {
  tracksService.onChange((library) => broadcast(IPC.TRACKS.LIBRARY, library));

  handle(IPC.TRACKS.GET_LIBRARY, () => tracksService.getLibrary());
  handle(IPC.TRACKS.RESCAN, () => tracksService.scan());
  handle(IPC.TRACKS.CHOOSE_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose your audio folder",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Use this folder",
    });
    if (result.canceled || result.filePaths.length === 0) return tracksService.getLibrary();
    return tracksService.setFolder(result.filePaths[0]);
  });
  handle(IPC.TRACKS.IMPORT_FILES, async () => {
    try {
      await tracksService.ensureFolder();
    } catch {
      const folder = await dialog.showOpenDialog({
        title: "Choose a folder for audio files",
        properties: ["openDirectory", "createDirectory"],
      });
      if (folder.canceled || !folder.filePaths[0]) return tracksService.getLibrary();
      await tracksService.setFolder(folder.filePaths[0]);
    }
    const result = await dialog.showOpenDialog({
      title: "Import audio",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio", extensions: [...TRACK_FILE_EXTENSIONS] }],
    });
    if (result.canceled || result.filePaths.length === 0) return tracksService.getLibrary();
    return tracksService.importFiles(result.filePaths);
  });
  handle(IPC.TRACKS.PLAY, (_event, itemId: string) => tracksService.play(itemId));
  handle(IPC.TRACKS.SET_PAUSED, (_event, paused: boolean) => tracksService.setPaused(!!paused));
  handle(IPC.TRACKS.STOP, () => tracksService.stop());
}

function registerProgramHandlers(): void {
  programService.onChange((state) => broadcast(PROGRAM.STATE, state));

  handle(PROGRAM.GET_STATE, () => programService.getState());
  handle(PROGRAM.SHOW_MESSAGE, (_event, text: string) => programService.showMessage(String(text ?? "")));
  handle(PROGRAM.CLEAR_MESSAGE, () => programService.clearMessage());
  handle(PROGRAM.SET_STAGE_MESSAGE, (_event, text: string | null) =>
    programService.setStageMessage(typeof text === "string" ? text : null),
  );
  handle(PROGRAM.SET_PROP, (_event, id: string, on: boolean) => programService.setProp(String(id), !!on));
  handle(PROGRAM.CLEAR_PROPS, () => programService.clearProps());
  handle(PROGRAM.SET_LOGO, (_event, on: boolean) => programService.setLogo(!!on));
  handle(PROGRAM.SET_CAMERA, (_event, label: string | null, audioLabel?: string | null) =>
    programService.setCamera(
      typeof label === "string" ? label : null,
      typeof audioLabel === "string" ? audioLabel : null,
    ),
  );
  // Program sound from an NDI surface's page (src/preload/program.ts). A
  // fire-and-forget stream — ~47 blocks a second per feed — so `on`, not `handle`.
  ipcMain.removeAllListeners(PROGRAM.NDI_AUDIO);
  ipcMain.on(PROGRAM.NDI_AUDIO, (event, block) => {
    if (!block || typeof block !== "object") return;
    surfaceManager.handleNdiAudio(event.sender.id, block);
  });
  handle(PROGRAM.NDI_AUDIO_SUPPORTED, () => surfaceManager.ndiAudioSupported());
  handle(PROGRAM.TIMER_SET, (_event, seconds: number) => programService.setTimer(Number(seconds) || 0));
  handle(PROGRAM.TIMER_START, () => programService.startTimer());
  handle(PROGRAM.TIMER_PAUSE, () => programService.pauseTimer());
  handle(PROGRAM.TIMER_RESET, () => programService.resetTimer());
  handle(PROGRAM.SET_ON_SCREENS, (_event, layer: unknown, on: unknown) =>
    programService.setOnScreens(layer === 'clock' ? 'clock' : 'countdown', on === true),
  );
  handle(PROGRAM.STAGE_STATUS, () => surfaceManager.stageStatus());
  surfaceManager.onStageStatus((status) => broadcast(PROGRAM.STAGE_STATUS_CHANGED, status));
  handle(PROGRAM.PICK_IMAGE, async () => {
    const win = dialogParentWindow();
    const options: OpenDialogOptions = {
      title: "Choose an image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    // Servable at once for the preview; saved into `presentation` it stays servable.
    allowPickedOverlayMedia(result.filePaths[0]);
    return result.filePaths[0];
  });
}

function registerSongUsageHandlers(): void {
  const range = (from: unknown, to: unknown): [number, number] => [
    Number.isFinite(Number(from)) ? Number(from) : 0,
    Number.isFinite(Number(to)) ? Number(to) : Date.now(),
  ];
  handle(SONG_USAGE.LIST, (_event, from: number, to: number) => songUsageService.list(...range(from, to)));
  handle(SONG_USAGE.CLEAR, (_event, before: number) => songUsageService.clearBefore(Number(before) || 0));
  handle(SONG_USAGE.EXPORT, async (_event, from: number, to: number) => {
    const entries = songUsageService.list(...range(from, to));
    const win = dialogParentWindow();
    const options = {
      title: "Export song usage",
      defaultPath: `song-usage-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, songUsageCsv(entries), "utf8");
    return result.filePath;
  });
}

function registerOutputHandlers(): void {
  handle(IPC.OUTPUT.SEND_TEST, () => orchestrator.testOverlay());
  handle(IPC.OUTPUT.CLEAR_TEXT, () => orchestrator.clearText());
  handle(IPC.OUTPUT.CLEAR_ALL, () => orchestrator.clearOverlay());
}

function registerDisplayHandlers(): void {
  ipcMain.handle(IPC.DISPLAYS.LIST, () => surfaceManager.listDisplays());
  ipcMain.handle(IPC.DISPLAYS.IDENTIFY, () => surfaceManager.identify());
  surfaceManager.onChange((displays) => broadcast(IPC.DISPLAYS.CHANGED, displays));
  // A re-matched display id was written behind the renderer's back — resend
  // settings so its next overlay write does not put the old id back.
  surfaceManager.onStoreWrite(() => broadcastSettingsChanged());
}

function registerNdiHandlers(): void {
  ipcMain.handle(IPC.NDI.GET_STATUS, async () => {
    const ndiStatus = ndiService.getStatus();
    const overlay = normalizeOverlaySettings(store.get("overlay"));
    // With the integration off, ProPresenter simply is not part of the answer.
    const ppOn = propresenterEnabled({ propresenter: store.get("propresenter") });
    const connected = ppOn && proPresenterService.getStatus().state === "connected";
    const ndiOutput = findNdiOutput(overlay.outputs);

    // Trust a stored uuid. Hitting /v1/video_inputs on this 4s poll saturates the
    // same Wi-Fi NDI is using and was aborting the PP control connection.
    const ppInputConfigured = connected && !!ndiOutput?.ppVideoInputUuid;

    // Per-output readiness, so the Outputs UI can say WHICH destination is not
    // going to fire rather than just "NDI unavailable".
    const outputs: NdiOutputStatus[] = overlay.outputs
      .filter((o) => o.enabled)
      .map((o) => {
        // Kairo screens never depend on ProPresenter — their state is the display's.
        if (o.kind === "screen") return { id: o.id, ...surfaceManager.screenState(o.id) };
        if (outputRequiresPropresenter(o.kind)) {
          if (!ppOn) return { id: o.id, ready: false, reason: "ProPresenter integration is off" };
          return connected ? { id: o.id, ready: true } : { id: o.id, ready: false, reason: "Waiting for ProPresenter" };
        }
        if (!ndiStatus.available) {
          return { id: o.id, ready: false, reason: "NDI sender unavailable" };
        }
        // Extra NDI feeds go to livestream / recording receivers, never to PP.
        if (!surfaceManager.isPrimaryNdi(o.id)) return { id: o.id, ready: true };
        // The frame goes out either way; switching ProPresenter to it is an
        // optional extra, so none of this makes the feed "not ready".
        return { id: o.id, ready: true };
      });

    return { ...ndiStatus, ppInputConfigured, outputs };
  });

  ipcMain.handle(IPC.NDI.GET_VIDEO_INPUTS, async () => {
    if (proPresenterService.getStatus().state !== "connected") return [];
    return proPresenterService.rawClient.getVideoInputs();
  });

  ipcMain.handle(IPC.NDI.PICK_OVERLAY_MEDIA, async (_event, kind: "image" | "video") => {
    const win = dialogParentWindow();
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

function settingsForRenderer(): SettingsWithSecretsStatus {
  const raw: AppSettings = {
    ...store.store,
    overlay: normalizeOverlaySettings(store.get("overlay")),
    presentation: normalizePresentationSettings(store.get("presentation")),
    themeLibrary: normalizeThemeLibrary(
      store.get("themeLibrary"),
      store.get("overlay").theme,
    ),
  };
  return {
    ...redactSettingsSecrets(raw),
    secretsConfigured: secretsConfiguredFromSettings(raw),
  };
}

function broadcastSettingsChanged(): void {
  broadcast(IPC.SETTINGS.CHANGED, settingsForRenderer());
}

function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS.GET, (_event, key: keyof AppSettings) => {
    if (key === "overlay") return normalizeOverlaySettings(store.get("overlay"));
    if (key === "themeLibrary") {
      return normalizeThemeLibrary(store.get("themeLibrary"), store.get("overlay").theme);
    }
    if (key === "stt" || key === "lyrics") {
      return settingsForRenderer()[key];
    }
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
        // Enabling, disabling or re-pointing a screen output opens, closes or
        // moves its window right away.
        void surfaceManager.reconcile(merged.outputs);
      } else if (key === "themeLibrary") {
        store.set(
          "themeLibrary",
          normalizeThemeLibrary(value, store.get("overlay").theme),
        );
      } else if (key === "stt") {
        const incoming = value as AppSettings["stt"] & { clearKeys?: SettingsSecretClearKey[] };
        const merged = mergeSecretSection(
          store.get("stt"),
          incoming,
          STT_SECRET_KEYS,
        );
        store.set("stt", merged);
        broadcastSettingsChanged();
        void cloudSession.pushOrgSecrets(incoming.clearKeys ?? []);
      } else if (key === "lyrics") {
        const incoming = value as AppSettings["lyrics"] & { clearKeys?: SettingsSecretClearKey[] };
        const merged = mergeSecretSection(
          store.get("lyrics"),
          incoming,
          LYRICS_SECRET_KEYS,
        );
        store.set("lyrics", merged);
        broadcastSettingsChanged();
        void cloudSession.pushOrgSecrets(incoming.clearKeys ?? []);
      } else if (key === "documents") {
        store.set("documents", normalizeDocumentsSettings(value));
      } else if (key === "presentation") {
        store.set("presentation", normalizePresentationSettings(value));
        programService.pruneProps();
        // Transition, audio, message style, props and stage displays all live
        // in the program windows — re-apply and open / close stage windows.
        void surfaceManager.reconcile();
      } else {
        store.set(key, value);
        // Switching the integration off means Kairo stops talking to
        // ProPresenter at once — no lingering link, no reconnect attempts.
        if (key === "propresenter" && !propresenterEnabled({ propresenter: value as AppSettings["propresenter"] })) {
          void proPresenterService.disconnect().catch(() => undefined);
        }
        if (key === "church") {
          const church = value as AppSettings["church"];
          void cloudSession.syncOrgProfile({
            name: church.name,
            timezone: church.timezone,
            serviceTimes: church.serviceTimes,
          });
        }
      }
      if (key === "scripture") {
        const scripture = value as AppSettings["scripture"];
        scriptureService.setDefaultTranslation(scripture.defaultTranslation);
        scriptureService.setAutoMode(scripture.autoMode);
        scriptureService.setConfidenceThreshold(scripture.confidenceThreshold);
        orchestrator.setScriptureTranslation(scripture.defaultTranslation);
        orchestrator.setAutoMode(scripture.autoMode);
        orchestrator.setConfidenceThreshold(scripture.confidenceThreshold);
      }
      log.debug("Setting updated", { key });
    },
  );

  ipcMain.handle(IPC.SETTINGS.GET_ALL, () => settingsForRenderer());

  ipcMain.handle(
    IPC.SETTINGS.TEST_API_KEY,
    async (_event, kind: "deepgram" | "anthropic" | "bible" | "brave", draft?: string) => {
      const stt = store.get("stt");
      const key =
        (typeof draft === "string" && draft.trim()) ||
        (kind === "deepgram"
          ? stt.apiKey
          : kind === "anthropic"
            ? stt.anthropicApiKey
            : kind === "brave"
              ? store.get("lyrics").braveApiKey
              : stt.bibleApiKey);

      if (!key) return { ok: false, message: "No key entered" };

      if (kind === "brave") {
        try {
          const res = await fetch(
            "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
            { headers: { "X-Subscription-Token": key, Accept: "application/json" } },
          );
          if (res.ok) return { ok: true, message: "Key valid" };
          // Brave answers a bad token with 422 and its own error code — not 401 —
          // so an untested key can sit in Settings looking configured while
          // every web-tier search silently falls back.
          const body = (await res.json().catch(() => null)) as
            | { error?: { code?: string; detail?: string } }
            | null;
          const code = body?.error?.code;
          if (code === "SUBSCRIPTION_TOKEN_INVALID" || res.status === 401 || res.status === 403) {
            return { ok: false, message: "Invalid key — Brave rejected it" };
          }
          if (code === "RATE_LIMITED" || res.status === 429) {
            return { ok: true, message: "Key valid (rate limited right now)" };
          }
          return { ok: false, message: body?.error?.detail ?? `HTTP ${res.status}` };
        } catch {
          return { ok: false, message: "Could not reach Brave Search" };
        }
      }

      if (kind === "deepgram") {
        try {
          const res = await fetch("https://api.deepgram.com/v1/projects", {
            headers: { Authorization: `Token ${key}` },
          });
          if (res.ok) return { ok: true, message: "Key valid" };
          if (res.status === 401) return { ok: false, message: "Unauthorized — invalid key" };
          return { ok: false, message: `HTTP ${res.status}` };
        } catch {
          const valid = key.length >= 20 && !/\s/.test(key);
          return {
            ok: valid,
            message: valid ? "Format valid (network check blocked)" : "Key format invalid",
          };
        }
      }

      if (kind === "anthropic") {
        if (!key.startsWith("sk-ant-") || key.length < 30) {
          return { ok: false, message: "Must start with sk-ant-" };
        }
        try {
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          });
          if (res.ok || res.status === 200) return { ok: true, message: "Key valid" };
          if (res.status === 401) return { ok: false, message: "Unauthorized — check key" };
          return { ok: true, message: `Accepted (HTTP ${res.status})` };
        } catch {
          return { ok: true, message: "Format valid (network check blocked)" };
        }
      }

      try {
        const translations = await scriptureService.getTranslationOptions(key, true);
        const available = translations.filter(
          (item: { available: boolean }) => item.available,
        );
        return { ok: true, message: `${available.length} translations available` };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Unable to validate key",
        };
      }
    },
  );
}

// ─── Push event wiring ────────────────────────────────────────────────────────
// Services emit events → broadcast pushes them to all renderer windows.

function wireEventBroadcasting(): void {
  proPresenterService.onStatusChange((status) => {
    broadcast(IPC.PROPRESENTER.STATUS_CHANGE, status);
  });

  sttService.onTranscript((result) => {
    serviceRecords.transcript(result);
    broadcast(IPC.TRANSCRIPTION.TRANSCRIPT, result);
  });

  sttService.onInterim((result) => {
    broadcast(IPC.TRANSCRIPTION.INTERIM, result);
  });

  livePlanService.onChange((state) => {
    const note = state.planId ? sermonPlanStore.get(state.planId) : null;
    if (note) serviceRecords.attach(note);
    broadcast(IPC.SCRIPTURE.LIVE_PLAN_CHANGED, state);
  });

  // One library push covers a rescan, a playlist edit and a background going
  // live — every dock in every window stays in step without polling.
  mediaService.onChange((library) => {
    broadcast(IPC.MEDIA.LIBRARY, library);
  });

  scriptureService.onSuggestion((suggestion) => {
    serviceRecords.scripture(suggestion);
    broadcast(IPC.SCRIPTURE.SUGGESTION, suggestion);
  });

  if (hasDownloadManager()) {
    getDownloadManager().onProgress((progress) => {
      broadcast(IPC.SCRIPTURE.OFFLINE_DOWNLOAD_PROGRESS, progress);
    });
  }

  orchestrator.onStatus((status) => {
    serviceRecords.setRunning(status.running);
    broadcast(IPC.ORCHESTRATOR.STATUS, status);
  });

  orchestrator.onPendingAuto((pending) => {
    broadcast(IPC.ORCHESTRATOR.PENDING_AUTO, pending);
  });

  resilienceManager.onStatusChange((status: ResilienceStatus) => {
    broadcast(IPC.RESILIENCE.STATUS_CHANGE, status);
  });

  onboardingService.onStateChange((state: OnboardingState) => {
    broadcast(IPC.ONBOARDING.STATE, state);
  });

  cloudSession.onSessionChange((session: SessionSnapshot) => {
    broadcast(IPC.ACCOUNT.SESSION_CHANGED, session);
  });

  cloudSession.onPairingChange((state: DevicePairingState) => {
    broadcast(IPC.ACCOUNT.PAIRING_CHANGED, state);
  });

  cloudSession.onSecretsChanged(() => {
    broadcastSettingsChanged();
  });
}

// ─── Onboarding handlers ──────────────────────────────────────────────────────

function registerOnboardingHandlers(): void {
  ipcMain.handle(IPC.ONBOARDING.GET_STATE, async () => onboardingService.getState());
  ipcMain.handle(IPC.ONBOARDING.COMPLETE_STEP, async (_e, step: OnboardingStepId) =>
    onboardingService.completeStep(step),
  );
  ipcMain.handle(IPC.ONBOARDING.SKIP_STEP, async (_e, step: OnboardingStepId) =>
    onboardingService.skipStep(step),
  );
  ipcMain.handle(IPC.ONBOARDING.SET_CURRENT, async (_e, step: OnboardingStepId) =>
    onboardingService.setCurrentStep(step),
  );
  ipcMain.handle(IPC.ONBOARDING.FINISH, async () => onboardingService.finish());
  ipcMain.handle(IPC.ONBOARDING.RESET, async () => onboardingService.reset());
}

// ─── Account handlers ─────────────────────────────────────────────────────────

/**
 * Every mutating call resolves to `{ ok, data, error }` rather than rejecting.
 *
 * A rejected `invoke` reaches the renderer as an opaque "Error invoking remote
 * method" string, which is useless in a form. Returning the failure keeps the
 * operator-facing message intact all the way to the field it belongs under.
 */
function registerAccountHandlers(): void {
  ipcMain.handle(IPC.ACCOUNT.GET_SESSION, async () => cloudSession.getSession());

  ipcMain.handle(IPC.ACCOUNT.SIGN_UP, async (_e, input: SignUpInput) =>
    cloudResult(() => cloudSession.signUp(input)),
  );
  ipcMain.handle(IPC.ACCOUNT.SIGN_IN, async (_e, input: SignInInput) =>
    cloudResult(() => cloudSession.signIn(input)),
  );
  ipcMain.handle(IPC.ACCOUNT.SIGN_OUT, async () => cloudSession.signOut());
  ipcMain.handle(IPC.ACCOUNT.REQUEST_PASSWORD_RESET, async (_e, email: string) =>
    cloudResult(async () => {
      await cloudSession.requestPasswordReset(email);
      return null;
    }),
  );

  ipcMain.handle(IPC.ACCOUNT.RESEND_VERIFICATION, async () =>
    cloudResult(async () => {
      await cloudSession.resendVerification();
      return null;
    }),
  );

  ipcMain.handle(IPC.ACCOUNT.VERIFY_EMAIL_CODE, async (_e, code: string) =>
    cloudResult(() => cloudSession.verifyEmailCode(code)),
  );

  ipcMain.handle(IPC.ACCOUNT.START_DEVICE_PAIRING, async () => cloudSession.startPairing());
  ipcMain.handle(IPC.ACCOUNT.CANCEL_DEVICE_PAIRING, async () => cloudSession.cancelPairing());
  ipcMain.handle(IPC.ACCOUNT.GET_DEVICE_PAIRING, async () => cloudSession.getPairing());

  ipcMain.handle(IPC.ACCOUNT.OPEN_WEB, async (_e, path?: string) => {
    // Build-time, same reasoning as the API URL — see cloud/session.ts.
    const base = import.meta.env.MAIN_VITE_WEB_URL || "http://localhost:3001";
    await shell.openExternal(`${base}${path ?? ""}`);
  });

  ipcMain.handle(IPC.ACCOUNT.SYNC_ORG_SECRETS, async () => {
    await cloudSession.pullOrgSecrets();
  });
}

async function cloudResult<T>(run: () => Promise<T>): Promise<{
  ok: boolean;
  data: T | null;
  error: string | null;
}> {
  try {
    return { ok: true, data: await run(), error: null };
  } catch (error) {
    const message = (error as { message?: string }).message ?? "Something went wrong.";
    return { ok: false, data: null, error: message };
  }
}

// ─── Startup bootstrap ────────────────────────────────────────────────────────

function registerAppHandlers(): void {
  // One round trip for everything the first render needs. Only local resources
  // are awaited — API.Bible authorization, audio devices, NDI, and the
  // ProPresenter connection hydrate in the background afterwards.
  ipcMain.handle(IPC.APP.BOOTSTRAP, async (event) => {
    const sender = event.sender;
    const snapshot = await runBootstrap(
      {
        settings: async () => settingsForRenderer(),
        orchestrator: async () => orchestrator.getStatus(),
        propresenter: async () => proPresenterService.getStatus(),
        transcription: async () => sttService.getHistory(),
        // Cached/local availability only: passing no key keeps this off the network.
        translations: () => scriptureService.getTranslationOptions(),
        sermonPlans: async () => sermonPlanStore.list(),
        livePlan: async () => livePlanService.getState(),
        lyrics: async () => lyricsService.getLibrary(),
        // Disk read, like every other resource here. The moment anything in
        // this map touches the network, launch time becomes internet-dependent.
        onboarding: async () => onboardingService.getState(),
        // Reads the encrypted token vault on disk. The API call that validates
        // that token happens later, in the background.
        account: async () => cloudSession.getSession(),
      },
      {
        onProgress: (progress) => {
          if (!sender.isDestroyed()) sender.send(IPC.APP.BOOTSTRAP_PROGRESS, progress);
        },
      },
    );
    if (snapshot.errors.length > 0) {
      log.warn("[Bootstrap] Completed with failures", snapshot.errors);
    } else {
      log.info("[Bootstrap] Completed");
    }
    return snapshot;
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function registerIpcHandlers(): void {
  // Restore the persisted reference playlist before any transcript can arrive.
  livePlanService.init();
  // Derive wizard progress for an install that predates it, before the first
  // bootstrap can read the state.
  onboardingService.migrateExistingInstall();
  registerAppHandlers();
  registerProPresenterHandlers();
  registerAudioHandlers();
  registerScriptureHandlers();
  registerTranscriptionHandlers();
  registerOrchestratorHandlers();
  registerWorkspaceHandlers();
  registerLyricsHandlers();
  registerSettingsHandlers();
  registerResilienceHandlers();
  registerUpdateHandlers();
  registerNdiHandlers();
  registerDisplayHandlers();
  registerOutputHandlers();
  registerProgramHandlers();
  registerSongUsageHandlers();
  registerDocumentHandlers();
  registerMediaHandlers();
  registerTracksHandlers();
  registerOnboardingHandlers();
  registerAccountHandlers();
  registerTransferHandlers();
  // Index the backgrounds folder without holding up startup — the dock renders
  // empty and fills in when the scan lands.
  // Restores a stored sign-in and starts the quiet refresh loop. Never awaited:
  // the account is not allowed to delay startup by so much as a frame.
  cloudSession.start();
  void mediaService.scan().catch((err) => {
    log.warn("[Media] Initial scan failed", (err as Error).message);
  });
  void tracksService.scan().catch((err) => {
    log.warn("[Tracks] Initial scan failed", (err as Error).message);
  });
  wireEventBroadcasting();
  log.info("All IPC handlers registered");
}

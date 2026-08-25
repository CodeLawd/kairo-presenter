import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppBootstrapSnapshot,
  ApiBibleDownloadProgress,
  BootstrapProgress,
  ProAutomateAPI,
  ConnectOptions,
  ProPresenterStatus,
  ProPresenterLibrary,
  ProPresenterPlaylist,
  AudioDevice,
  AudioLevel,
  AudioError,
  ScriptureSuggestion,
  ScriptureResult,
  ScriptureTranslation,
  TranscriptResult,
  InterimResult,
  LivePlanState,
  LyricsSong,
  LyricsImportSource,
  LyricsOnlineResult,
  LyricsOnlinePreview,
  LyricsSongSection,
  SongPresentOptions,
  AppSettings,
  OrchestratorConfig,
  OrchestratorStatus,
  SessionStats,
  PendingAutoPresent,
  ResilienceStatus,
  NdiStatus,
  PPVideoInputInfo,
  Unsubscribe,
} from '@shared/ipc'
import { IPC } from '@shared/ipc'

/**
 * Creates a type-safe subscription to a push channel.
 * Returns an unsubscribe fn — callers MUST invoke it on unmount to avoid leaks.
 */
function subscribe<T>(channel: string, callback: (data: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// ─── propresenter ─────────────────────────────────────────────────────────────

const propresenter: ProAutomateAPI['propresenter'] = {
  connect(options: ConnectOptions): Promise<void> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.CONNECT, options)
  },

  disconnect(): Promise<void> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.DISCONNECT)
  },

  getStatus(): Promise<ProPresenterStatus> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_STATUS)
  },

  triggerSlide(slideId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.TRIGGER_SLIDE, slideId)
  },

  clearAll(): Promise<void> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.CLEAR_ALL)
  },

  getLibrary(): Promise<ProPresenterLibrary> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_LIBRARY)
  },

  getPlaylists(): Promise<ProPresenterPlaylist[]> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_PLAYLISTS)
  },

  testOverlay(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.TEST_OVERLAY)
  },

  clearOverlay(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.CLEAR_OVERLAY)
  },

  onStatusChange(callback: (status: ProPresenterStatus) => void): Unsubscribe {
    return subscribe<ProPresenterStatus>(IPC.PROPRESENTER.STATUS_CHANGE, callback)
  },
}

// ─── audio ────────────────────────────────────────────────────────────────────

const audio: ProAutomateAPI['audio'] = {
  getDevices(): Promise<AudioDevice[]> {
    return ipcRenderer.invoke(IPC.AUDIO.GET_DEVICES)
  },

  startCapture(deviceId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.AUDIO.START_CAPTURE, deviceId)
  },

  stopCapture(): Promise<void> {
    return ipcRenderer.invoke(IPC.AUDIO.STOP_CAPTURE)
  },

  sendPCMChunk(buffer: ArrayBuffer): void {
    ipcRenderer.send(IPC.AUDIO.PCM_CHUNK, buffer)
  },

  onLevel(callback: (level: AudioLevel) => void): Unsubscribe {
    return subscribe<AudioLevel>(IPC.AUDIO.LEVEL, callback)
  },

  onError(callback: (error: AudioError) => void): Unsubscribe {
    return subscribe<AudioError>(IPC.AUDIO.ERROR, callback)
  },
}

// ─── app ──────────────────────────────────────────────────────────────────────

const appApi: ProAutomateAPI['app'] = {
  bootstrap(): Promise<AppBootstrapSnapshot> {
    return ipcRenderer.invoke(IPC.APP.BOOTSTRAP)
  },

  onBootstrapProgress(callback: (progress: BootstrapProgress) => void): Unsubscribe {
    return subscribe<BootstrapProgress>(IPC.APP.BOOTSTRAP_PROGRESS, callback)
  },
}

// ─── scripture ────────────────────────────────────────────────────────────────

const scripture: ProAutomateAPI['scripture'] = {
  onSuggestion(callback: (suggestion: ScriptureSuggestion) => void): Unsubscribe {
    return subscribe<ScriptureSuggestion>(IPC.SCRIPTURE.SUGGESTION, callback)
  },

  approve(suggestionId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.APPROVE, suggestionId)
  },

  dismiss(suggestionId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.DISMISS, suggestionId)
  },

  register(suggestion): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.REGISTER, suggestion)
  },

  search(query: string, translation?: ScriptureTranslation): Promise<ScriptureResult[]> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SEARCH, query, translation)
  },

  getTranslations(apiKey?: string) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.GET_TRANSLATIONS, apiKey)
  },

  setTranslation(translation: ScriptureTranslation): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_TRANSLATION, translation)
  },

  importSermonNotes() {
    return ipcRenderer.invoke(IPC.SCRIPTURE.IMPORT_SERMON_NOTES)
  },

  listSermonPlans() {
    return ipcRenderer.invoke(IPC.SCRIPTURE.LIST_SERMON_PLANS)
  },

  saveSermonPlan(plan) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SAVE_SERMON_PLAN, plan)
  },

  deleteSermonPlan(planId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.DELETE_SERMON_PLAN, planId)
  },

  getLivePlan() {
    return ipcRenderer.invoke(IPC.SCRIPTURE.GET_LIVE_PLAN)
  },

  setLivePlan(planId: string | null) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_LIVE_PLAN, planId)
  },

  onLivePlanChange(callback: (state: LivePlanState) => void): Unsubscribe {
    return subscribe<LivePlanState>(IPC.SCRIPTURE.LIVE_PLAN_CHANGED, callback)
  },

  setAutoMode(enabled: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_AUTO_MODE, enabled)
  },

  setConfidenceThreshold(threshold: number): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_CONFIDENCE, threshold)
  },

  listOfflineTranslations() {
    return ipcRenderer.invoke(IPC.SCRIPTURE.LIST_OFFLINE_TRANSLATIONS)
  },

  downloadTranslation(bibleId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.DOWNLOAD_TRANSLATION, bibleId)
  },

  pauseTranslationDownload(bibleId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.PAUSE_TRANSLATION_DOWNLOAD, bibleId)
  },

  refreshOfflineTranslation(bibleId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.REFRESH_OFFLINE_TRANSLATION, bibleId)
  },

  removeOfflineTranslation(bibleId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.REMOVE_OFFLINE_TRANSLATION, bibleId)
  },

  onOfflineDownloadProgress(callback: (value: ApiBibleDownloadProgress) => void): Unsubscribe {
    return subscribe<ApiBibleDownloadProgress>(IPC.SCRIPTURE.OFFLINE_DOWNLOAD_PROGRESS, callback)
  },
}

// ─── transcription ────────────────────────────────────────────────────────────

const transcription: ProAutomateAPI['transcription'] = {
  onTranscript(callback: (result: TranscriptResult) => void): Unsubscribe {
    return subscribe<TranscriptResult>(IPC.TRANSCRIPTION.TRANSCRIPT, callback)
  },

  onInterim(callback: (result: InterimResult) => void): Unsubscribe {
    return subscribe<InterimResult>(IPC.TRANSCRIPTION.INTERIM, callback)
  },

  getHistory(): Promise<TranscriptResult[]> {
    return ipcRenderer.invoke(IPC.TRANSCRIPTION.GET_HISTORY)
  },

  clearHistory(): Promise<void> {
    return ipcRenderer.invoke(IPC.TRANSCRIPTION.CLEAR_HISTORY)
  },
}

// ─── lyrics ───────────────────────────────────────────────────────────────────

const lyrics: ProAutomateAPI['lyrics'] = {
  search(query: string): Promise<LyricsSong[]> {
    return ipcRenderer.invoke(IPC.LYRICS.SEARCH, query)
  },

  searchOnline(query: string): Promise<LyricsOnlineResult[]> {
    return ipcRenderer.invoke(IPC.LYRICS.SEARCH_ONLINE, query)
  },

  previewOnline(source: {
    provider: import('@shared/ipc').LyricsProvider
    url: string
    title: string
    artist: string
  }): Promise<LyricsOnlinePreview> {
    return ipcRenderer.invoke(IPC.LYRICS.PREVIEW_ONLINE, source)
  },

  import(source: LyricsImportSource): Promise<LyricsSong> {
    return ipcRenderer.invoke(IPC.LYRICS.IMPORT, source)
  },

  getLibrary(): Promise<LyricsSong[]> {
    return ipcRenderer.invoke(IPC.LYRICS.GET_LIBRARY)
  },

  getSong(id: string): Promise<LyricsSong | null> {
    return ipcRenderer.invoke(IPC.LYRICS.GET_SONG, id)
  },

  update(id: string, song: LyricsSong): Promise<LyricsSong | null> {
    return ipcRenderer.invoke(IPC.LYRICS.UPDATE, id, song)
  },

  delete(id: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC.LYRICS.DELETE, id)
  },

  toggleFavorite(id: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC.LYRICS.TOGGLE_FAVORITE, id)
  },

  sendToProPresenter(songId: string, options?: SongPresentOptions): Promise<void> {
    return ipcRenderer.invoke(IPC.LYRICS.SEND_TO_PP, songId, options)
  },

  addToPlaylist(songId: string, playlistId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.LYRICS.ADD_TO_PLAYLIST, songId, playlistId)
  },

  translateSections(
    sections: LyricsSongSection[],
    options?: {
      target?: string
      sourceLanguage?: string
      title?: string
      artist?: string
    }
  ): Promise<LyricsSongSection[]> {
    return ipcRenderer.invoke(IPC.LYRICS.TRANSLATE, sections, options)
  },
}

// ─── settings ─────────────────────────────────────────────────────────────────

const settings: ProAutomateAPI['settings'] = {
  get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    return ipcRenderer.invoke(IPC.SETTINGS.GET, key)
  },

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K] | Partial<AppSettings[K]>): Promise<void> {
    return ipcRenderer.invoke(IPC.SETTINGS.SET, key, value)
  },

  getAll(): Promise<AppSettings> {
    return ipcRenderer.invoke(IPC.SETTINGS.GET_ALL)
  },
}

// ─── orchestrator ─────────────────────────────────────────────────────────────

const orchestrator: ProAutomateAPI['orchestrator'] = {
  start(config: OrchestratorConfig): Promise<void> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.START, config)
  },

  stop(): Promise<void> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.STOP)
  },

  getStatus(): Promise<OrchestratorStatus> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.GET_STATUS)
  },

  getStats(): Promise<SessionStats | null> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.GET_STATS)
  },

  approveSuggestion(suggestionId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.APPROVE, suggestionId)
  },

  dismissSuggestion(suggestionId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.DISMISS, suggestionId)
  },

  dismissAuto(suggestionId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.ORCHESTRATOR.DISMISS_AUTO, suggestionId)
  },

  onStatus(callback: (status: OrchestratorStatus) => void): Unsubscribe {
    return subscribe<OrchestratorStatus>(IPC.ORCHESTRATOR.STATUS, callback)
  },

  onPendingAuto(callback: (pending: PendingAutoPresent) => void): Unsubscribe {
    return subscribe<PendingAutoPresent>(IPC.ORCHESTRATOR.PENDING_AUTO, callback)
  },
}

// ─── resilience ─────────────────────────────────────────────────────────────

const resilience: ProAutomateAPI['resilience'] = {
  getStatus(): Promise<ResilienceStatus> {
    return ipcRenderer.invoke(IPC.RESILIENCE.GET_STATUS)
  },

  restoreSession(): Promise<void> {
    return ipcRenderer.invoke(IPC.RESILIENCE.RESTORE)
  },

  discardSession(): Promise<void> {
    return ipcRenderer.invoke(IPC.RESILIENCE.DISCARD)
  },

  onStatusChange(callback: (status: ResilienceStatus) => void): Unsubscribe {
    return subscribe<ResilienceStatus>(IPC.RESILIENCE.STATUS_CHANGE, callback)
  },
}

// ─── ndi ──────────────────────────────────────────────────────────────────────

const ndi: ProAutomateAPI['ndi'] = {
  getStatus(): Promise<NdiStatus> {
    return ipcRenderer.invoke(IPC.NDI.GET_STATUS)
  },

  getVideoInputs(): Promise<PPVideoInputInfo[]> {
    return ipcRenderer.invoke(IPC.NDI.GET_VIDEO_INPUTS)
  },

  pickOverlayMedia(kind: 'image' | 'video'): Promise<string | null> {
    return ipcRenderer.invoke(IPC.NDI.PICK_OVERLAY_MEDIA, kind)
  },
}

// ─── Expose ───────────────────────────────────────────────────────────────────

const api: ProAutomateAPI = { app: appApi, propresenter, audio, scripture, transcription, lyrics, settings, orchestrator, resilience, ndi }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] contextBridge error:', error)
  }
} else {
  // @ts-ignore (non-context-isolated fallback for dev)
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

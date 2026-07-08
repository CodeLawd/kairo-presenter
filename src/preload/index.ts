import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
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
  LyricsSong,
  LyricsImportSource,
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

  search(query: string): Promise<ScriptureResult[]> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SEARCH, query)
  },

  setTranslation(translation: ScriptureTranslation): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_TRANSLATION, translation)
  },

  setAutoMode(enabled: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_AUTO_MODE, enabled)
  },

  setConfidenceThreshold(threshold: number): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SET_CONFIDENCE, threshold)
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
}

// ─── settings ─────────────────────────────────────────────────────────────────

const settings: ProAutomateAPI['settings'] = {
  get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    return ipcRenderer.invoke(IPC.SETTINGS.GET, key)
  },

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
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
}

// ─── Expose ───────────────────────────────────────────────────────────────────

const api: ProAutomateAPI = { propresenter, audio, scripture, transcription, lyrics, settings, orchestrator, resilience, ndi }

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

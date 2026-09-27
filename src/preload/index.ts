import { DOCUMENTS } from '@shared/documents'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  MediaLibrary,
  TracksLibrary,
  AppBootstrapSnapshot,
  ApiBibleDownloadProgress,
  BootstrapProgress,
  ProAutomateAPI,
  ConnectOptions,
  ProPresenterStatus,
  ProPresenterLibrary,
  ProPresenterPlaylist,
  AudioLevel,
  AudioError,
  ScriptureSuggestion,
  ScriptureResult,
  ScriptureTranslation,
  TranscriptResult,
  InterimResult,
  LivePlanState,
  LyricsImportPreview,
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
  PPLook,
  Unsubscribe,
} from '@shared/ipc'
import type {
  PPResourceBindings,
  PPResourceCatalogue,
  PPResourceKind,
  PPResourcePreview,
} from '@shared/propresenter-resources'
import { IPC } from '@shared/ipc'
import { SETLIST_CHANGED, SETLIST_CHANNEL } from '@shared/setlist'
import { TRANSFER } from '@shared/kairo-bundle'
import { LIBRARIES_CHANGED, LIBRARIES_CHANNEL } from '@shared/libraries'
import { PASSAGES_CHANGED, PASSAGES_CHANNEL } from '@shared/passages'

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

  clearText(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.CLEAR_TEXT)
  },

  clearOverlay(): Promise<boolean> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.CLEAR_OVERLAY)
  },

  getLooks(): Promise<PPLook[]> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_LOOKS)
  },

  getResourceCatalogue(options?: { refresh?: boolean }): Promise<PPResourceCatalogue> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_RESOURCE_CATALOGUE, options)
  },

  getResourceDetails(kind: PPResourceKind, id: string): Promise<Record<string, unknown> | null> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_RESOURCE_DETAILS, kind, id)
  },

  getResourcePreview(kind: PPResourceKind, id: string, childId?: string): Promise<PPResourcePreview> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.GET_RESOURCE_PREVIEW, kind, id, childId)
  },

  setResourceBindings(bindings: PPResourceBindings): Promise<PPResourceBindings> {
    return ipcRenderer.invoke(IPC.PROPRESENTER.SET_RESOURCE_BINDINGS, bindings)
  },

  onStatusChange(callback: (status: ProPresenterStatus) => void): Unsubscribe {
    return subscribe<ProPresenterStatus>(IPC.PROPRESENTER.STATUS_CHANGE, callback)
  },
}

// ─── audio ────────────────────────────────────────────────────────────────────

const audio: ProAutomateAPI['audio'] = {
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
  onImportRequested(callback) {
    const unsubscribe = subscribe(IPC.APP.IMPORT_REQUESTED, callback)
    ipcRenderer.send(IPC.APP.IMPORT_READY)
    return unsubscribe
  },
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

  presentDirectly(suggestion): Promise<void> {
    return ipcRenderer.invoke(IPC.SCRIPTURE.PRESENT_DIRECTLY, suggestion)
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

  scanSermonNotes(text: string) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.SCAN_SERMON_NOTES, text)
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

  recentTraces(limit?: number) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.RECENT_TRACES, limit)
  },

  markRendered(correlationId: string) {
    ipcRenderer.send(IPC.SCRIPTURE.MARK_RENDERED, correlationId)
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

  installLocalBiblePack() {
    return ipcRenderer.invoke(IPC.SCRIPTURE.INSTALL_LOCAL_BIBLE_PACK)
  },

  downloadLocalBibleTranslation(translation: string) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.DOWNLOAD_LOCAL_BIBLE_TRANSLATION, translation)
  },

  getLocalBiblePackStatus(translation: string) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.GET_LOCAL_BIBLE_PACK_STATUS, translation)
  },

  removeLocalBibleTranslation(translation: string) {
    return ipcRenderer.invoke(IPC.SCRIPTURE.REMOVE_LOCAL_BIBLE_TRANSLATION, translation)
  },

  listInstalledLocalBiblePacks() {
    return ipcRenderer.invoke(IPC.SCRIPTURE.LIST_INSTALLED_LOCAL_BIBLE_PACKS)
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

// ─── workspace ────────────────────────────────────────────────────────────────

const workspace: ProAutomateAPI['workspace'] = {
  get() {
    return ipcRenderer.invoke(IPC.WORKSPACE.GET)
  },
  chooseFolder(options) {
    return ipcRenderer.invoke(IPC.WORKSPACE.CHOOSE_FOLDER, options)
  },
  reveal() {
    return ipcRenderer.invoke(IPC.WORKSPACE.REVEAL)
  },
  revealSongs() {
    return ipcRenderer.invoke(IPC.WORKSPACE.REVEAL_SONGS)
  },
  resyncSongs() {
    return ipcRenderer.invoke(IPC.WORKSPACE.RESYNC_SONGS)
  },
  mediaMigration() {
    return ipcRenderer.invoke(IPC.WORKSPACE.MEDIA_MIGRATION)
  },
  adoptMedia(options) {
    return ipcRenderer.invoke(IPC.WORKSPACE.ADOPT_MEDIA, options)
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
  previewFile(source: LyricsImportSource): Promise<LyricsImportPreview> {
    return ipcRenderer.invoke(IPC.LYRICS.PREVIEW_FILE, source)
  },

  readClipboard() {
    return ipcRenderer.invoke(IPC.LYRICS.READ_CLIPBOARD)
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

  pushSlide(songId: string, slideIndex: number): Promise<void> {
    return ipcRenderer.invoke(IPC.LYRICS.PUSH_SLIDE, songId, slideIndex)
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

  set<K extends keyof AppSettings>(
    key: K,
    value: import('@shared/ipc').SettingsSectionPatch<K>,
  ): Promise<void> {
    return ipcRenderer.invoke(IPC.SETTINGS.SET, key, value)
  },

  getAll(): Promise<import('@shared/ipc').SettingsWithSecretsStatus> {
    return ipcRenderer.invoke(IPC.SETTINGS.GET_ALL)
  },

  testApiKey(
    kind: 'deepgram' | 'anthropic' | 'bible' | 'brave',
    draft?: string,
  ): Promise<{ ok: boolean; message: string }> {
    return ipcRenderer.invoke(IPC.SETTINGS.TEST_API_KEY, kind, draft)
  },

  onChanged(
    callback: (settings: import('@shared/ipc').SettingsWithSecretsStatus) => void,
  ): Unsubscribe {
    return subscribe(IPC.SETTINGS.CHANGED, callback)
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

const media: ProAutomateAPI['media'] = {
  importFiles: (kind) => ipcRenderer.invoke(IPC.MEDIA.IMPORT_FILES, kind),
  getLibrary() {
    return ipcRenderer.invoke(IPC.MEDIA.GET_LIBRARY)
  },
  chooseFolder() {
    return ipcRenderer.invoke(IPC.MEDIA.CHOOSE_FOLDER)
  },
  rescan() {
    return ipcRenderer.invoke(IPC.MEDIA.RESCAN)
  },
  createFolder(name: string) {
    return ipcRenderer.invoke(IPC.MEDIA.CREATE_FOLDER, name)
  },
  push(itemId: string) {
    return ipcRenderer.invoke(IPC.MEDIA.PUSH, itemId)
  },
  clear() {
    return ipcRenderer.invoke(IPC.MEDIA.CLEAR)
  },
  createPlaylist(name: string) {
    return ipcRenderer.invoke(IPC.MEDIA.CREATE_PLAYLIST, name)
  },
  renamePlaylist(id: string, name: string) {
    return ipcRenderer.invoke(IPC.MEDIA.RENAME_PLAYLIST, id, name)
  },
  deletePlaylist(id: string) {
    return ipcRenderer.invoke(IPC.MEDIA.DELETE_PLAYLIST, id)
  },
  setPlaylistItems(id: string, itemIds: string[]) {
    return ipcRenderer.invoke(IPC.MEDIA.SET_PLAYLIST_ITEMS, id, itemIds)
  },
  setItemOrder(itemIds: string[]) {
    return ipcRenderer.invoke(IPC.MEDIA.SET_ITEM_ORDER, itemIds)
  },
  deleteItem(itemId: string) {
    return ipcRenderer.invoke(IPC.MEDIA.DELETE_ITEM, itemId)
  },
  renameItem(itemId: string, name: string) {
    return ipcRenderer.invoke(IPC.MEDIA.RENAME_ITEM, itemId, name)
  },
  revealItem(itemId: string) {
    return ipcRenderer.invoke(IPC.MEDIA.REVEAL_ITEM, itemId)
  },
  copyItems(itemIds: string[]) {
    return ipcRenderer.invoke(IPC.MEDIA.COPY_ITEMS, itemIds)
  },
  cutItems(itemIds: string[], fromPlaylistId?: string) {
    return ipcRenderer.invoke(IPC.MEDIA.CUT_ITEMS, itemIds, fromPlaylistId)
  },
  pasteItems(playlistId?: string) {
    return ipcRenderer.invoke(IPC.MEDIA.PASTE_ITEMS, playlistId)
  },
  clipboardHasFiles() {
    return ipcRenderer.invoke(IPC.MEDIA.CLIPBOARD_HAS_FILES)
  },
  addMediaToPlaylist(playlistId: string) {
    return ipcRenderer.invoke(IPC.MEDIA.ADD_MEDIA_TO_PLAYLIST, playlistId)
  },
  setPlayback(itemId, playback) {
    return ipcRenderer.invoke(IPC.MEDIA.SET_PLAYBACK, itemId, playback)
  },
  setPaused(paused) {
    return ipcRenderer.invoke(IPC.MEDIA.SET_PAUSED, paused)
  },
  seek(seconds) {
    return ipcRenderer.invoke(IPC.MEDIA.SEEK, seconds)
  },
  onLibraryChange(callback) {
    const listener = (_e: unknown, library: MediaLibrary): void => callback(library)
    ipcRenderer.on(IPC.MEDIA.LIBRARY, listener)
    return () => ipcRenderer.removeListener(IPC.MEDIA.LIBRARY, listener)
  },
}

const tracks: ProAutomateAPI['tracks'] = {
  getLibrary() {
    return ipcRenderer.invoke(IPC.TRACKS.GET_LIBRARY)
  },
  rescan() {
    return ipcRenderer.invoke(IPC.TRACKS.RESCAN)
  },
  chooseFolder() {
    return ipcRenderer.invoke(IPC.TRACKS.CHOOSE_FOLDER)
  },
  importFiles() {
    return ipcRenderer.invoke(IPC.TRACKS.IMPORT_FILES)
  },
  play(itemId) {
    return ipcRenderer.invoke(IPC.TRACKS.PLAY, itemId)
  },
  setPaused(paused) {
    return ipcRenderer.invoke(IPC.TRACKS.SET_PAUSED, paused)
  },
  stop() {
    return ipcRenderer.invoke(IPC.TRACKS.STOP)
  },
  onLibraryChange(callback) {
    const listener = (_e: unknown, library: TracksLibrary): void => callback(library)
    ipcRenderer.on(IPC.TRACKS.LIBRARY, listener)
    return () => ipcRenderer.removeListener(IPC.TRACKS.LIBRARY, listener)
  },
}

const onboarding: ProAutomateAPI['onboarding'] = {
  getState() {
    return ipcRenderer.invoke(IPC.ONBOARDING.GET_STATE)
  },
  completeStep(step) {
    return ipcRenderer.invoke(IPC.ONBOARDING.COMPLETE_STEP, step)
  },
  skipStep(step) {
    return ipcRenderer.invoke(IPC.ONBOARDING.SKIP_STEP, step)
  },
  setCurrentStep(step) {
    return ipcRenderer.invoke(IPC.ONBOARDING.SET_CURRENT, step)
  },
  finish() {
    return ipcRenderer.invoke(IPC.ONBOARDING.FINISH)
  },
  reset() {
    return ipcRenderer.invoke(IPC.ONBOARDING.RESET)
  },
  onStateChange(callback) {
    return subscribe(IPC.ONBOARDING.STATE, callback)
  },
}

const account: ProAutomateAPI['account'] = {
  getSession() {
    return ipcRenderer.invoke(IPC.ACCOUNT.GET_SESSION)
  },
  signUp(input) {
    return ipcRenderer.invoke(IPC.ACCOUNT.SIGN_UP, input)
  },
  signIn(input) {
    return ipcRenderer.invoke(IPC.ACCOUNT.SIGN_IN, input)
  },
  signOut() {
    return ipcRenderer.invoke(IPC.ACCOUNT.SIGN_OUT)
  },
  requestPasswordReset(email) {
    return ipcRenderer.invoke(IPC.ACCOUNT.REQUEST_PASSWORD_RESET, email)
  },
  resendVerification() {
    return ipcRenderer.invoke(IPC.ACCOUNT.RESEND_VERIFICATION)
  },
  verifyEmailCode(code) {
    return ipcRenderer.invoke(IPC.ACCOUNT.VERIFY_EMAIL_CODE, code)
  },
  startDevicePairing() {
    return ipcRenderer.invoke(IPC.ACCOUNT.START_DEVICE_PAIRING)
  },
  cancelDevicePairing() {
    return ipcRenderer.invoke(IPC.ACCOUNT.CANCEL_DEVICE_PAIRING)
  },
  getDevicePairing() {
    return ipcRenderer.invoke(IPC.ACCOUNT.GET_DEVICE_PAIRING)
  },
  openWeb(path) {
    return ipcRenderer.invoke(IPC.ACCOUNT.OPEN_WEB, path)
  },
  syncOrgSecrets() {
    return ipcRenderer.invoke(IPC.ACCOUNT.SYNC_ORG_SECRETS)
  },
  onSessionChange(callback) {
    return subscribe(IPC.ACCOUNT.SESSION_CHANGED, callback)
  },
  onPairingChange(callback) {
    return subscribe(IPC.ACCOUNT.PAIRING_CHANGED, callback)
  },
}

const documents: ProAutomateAPI['documents'] = {
  list: () => ipcRenderer.invoke(DOCUMENTS.LIST),
  capabilities: () => ipcRenderer.invoke(DOCUMENTS.CAPABILITIES),
  prepare: (kind) => ipcRenderer.invoke(DOCUMENTS.PREPARE, kind),
  savePage: (id, page, png) => ipcRenderer.invoke(DOCUMENTS.SAVE_PAGE, id, page, png),
  finish: (id) => ipcRenderer.invoke(DOCUMENTS.FINISH, id),
  cancel: (id) => ipcRenderer.invoke(DOCUMENTS.CANCEL, id),
  rename: (id, name) => ipcRenderer.invoke(DOCUMENTS.RENAME, id, name),
  remove: (id) => ipcRenderer.invoke(DOCUMENTS.REMOVE, id),
  push: (id, page) => ipcRenderer.invoke(DOCUMENTS.PUSH, id, page),
}

const updates: ProAutomateAPI['updates'] = {
  getStatus: () => ipcRenderer.invoke(IPC.UPDATES.GET_STATUS),
  check: () => ipcRenderer.invoke(IPC.UPDATES.CHECK),
  download: () => ipcRenderer.invoke(IPC.UPDATES.DOWNLOAD),
  install: () => ipcRenderer.invoke(IPC.UPDATES.INSTALL),
  onStatus: (callback) => subscribe(IPC.UPDATES.STATUS, callback),
}

const services: ProAutomateAPI['services'] = {
  command: (command) => ipcRenderer.invoke('services:command', command),
  onChanged: (callback) => subscribe('services:changed', callback),
}
const setlist: ProAutomateAPI['setlist'] = {
  command: (command) => ipcRenderer.invoke(SETLIST_CHANNEL, command),
  onChanged: (callback) => subscribe(SETLIST_CHANGED, callback),
}

const libraries: ProAutomateAPI['libraries'] = {
  command: (command) => ipcRenderer.invoke(LIBRARIES_CHANNEL, command),
  onChanged: (callback) => subscribe(LIBRARIES_CHANGED, callback),
}

const passages: ProAutomateAPI['passages'] = {
  command: (command) => ipcRenderer.invoke(PASSAGES_CHANNEL, command),
  onChanged: (callback) => subscribe(PASSAGES_CHANGED, callback),
}

const transfer: ProAutomateAPI['transfer'] = {
  export: (request) => ipcRenderer.invoke(TRANSFER.EXPORT, request),
  pickAndPreview: () => ipcRenderer.invoke(TRANSFER.PICK_AND_PREVIEW),
  commit: (request) => ipcRenderer.invoke(TRANSFER.COMMIT, request),
  discard: (token) => ipcRenderer.invoke(TRANSFER.DISCARD, token),
  ready: () => ipcRenderer.send(TRANSFER.READY),
  onOpened: (callback) => subscribe(TRANSFER.OPENED, callback),
}

const api: ProAutomateAPI = { transfer, passages, libraries, setlist, services, documents, app: appApi, propresenter, audio, scripture, transcription, workspace, lyrics, settings, orchestrator, resilience, ndi, media, tracks, onboarding, account, updates }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] contextBridge error:', error)
  }
} else {
  // @ts-expect-error (non-context-isolated fallback for dev)
  window.electron = electronAPI
  // @ts-expect-error (window.api has no DOM type; assigned by the bridge contract)
  window.api = api
}

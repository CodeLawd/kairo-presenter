import { create } from 'zustand'
import type { ProPresenterStatus, ProPresenterConnectionState, AudioLevel } from '@shared/ipc'
import type { LiveOutputPayload } from '@shared/live-output'
import { normalizeOperatorPanelWidth, OPERATOR_PANEL_DEFAULTS } from '@shared/operator-layout'

const RAIL_WIDTH_KEY = 'operator-preview-width'

// The store is also imported by node tests, where localStorage does not exist.
function readStoredRailWidth(): number {
  if (typeof localStorage === 'undefined') return OPERATOR_PANEL_DEFAULTS.right
  return normalizeOperatorPanelWidth(
    'right',
    localStorage.getItem(RAIL_WIDTH_KEY),
    OPERATOR_PANEL_DEFAULTS.right,
  )
}

// ─── State shape ──────────────────────────────────────────────────────────────

interface AppState {
  // ── ProPresenter ──────────────────────────────────────────────────────────
  ppState: ProPresenterConnectionState
  ppVersion: string | null
  ppActivePresentationName: string | null
  ppActiveSlideIndex: number | null
  ppActivePlaylistName: string | null

  // ── Audio ─────────────────────────────────────────────────────────────────
  audioDeviceName: string | null
  audioCapturing: boolean
  audioError: string | null
  audioLevel: AudioLevel | null
  captureDeviceId: string

  // ── Transcription ─────────────────────────────────────────────────────────
  isTranscribing: boolean
  transcriptWordCount: number
  transcriptRecentLines: string[]
  transcriptLatencyMs: number | null

  // ── Scripture / Claude ────────────────────────────────────────────────────
  claudeStatus: 'ready' | 'processing' | 'error'
  lastDetectedScripture: string | null
  scriptureDetectionCount: number
  scriptureProjectedCount: number
  autoModeEnabled: boolean
  confidenceThreshold: number
  /** Last opened sermon playlist — restored when returning to Scripture. */
  scriptureActivePlanId: string | null
  /** Last focused/live playlist item id within that plan. */
  scriptureActiveItemId: string | null
  /** Card index within that item (0 for single-verse rows). */
  scriptureActiveCardInRow: number
  /** How the item was highlighted when leaving. */
  scriptureHighlightMode: 'none' | 'focus' | 'live'
  /** Reference currently on ProAutomate output — drives the header LIVE badge. */
  liveOutputLabel: string | null
  /** Last text sent to ProPresenter, shared by the Operator, Scripture and Lyrics tabs. */
  liveOutputPreview: LiveOutputPayload | null
  /** Bumps when PP output is cleared so Scripture can drop Live badges. */
  scriptureOutputClearToken: number
  /** Last opened song in the Lyrics library — restored when returning to the tab. */
  lyricsSelectedSongId: string | null
  lyricsFilter: 'all' | 'favorites' | 'recent'
  lyricsSortBy: 'title' | 'artist' | 'recent' | 'added'
  /** Which output the Operator's live-output panel is previewing. */
  operatorPreviewOutputId: string | null
  /** Width of the shared live output rail, kept in the store so every screen
      showing the rail resizes together — Operator stays mounted across
      navigation, so a per-screen state would drift out of sync. */
  liveRailWidth: number
  /** Last selected theme in the Theme editor — restored when returning to the tab. */
  themeSelectedId: string | null
  themeSelectedName: string

  // ── Session ───────────────────────────────────────────────────────────────
  sessionStartTime: number

  // ── Legacy (kept for backward compat) ────────────────────────────────────
  proPresenterConnected: boolean
  currentSlide: string | null
  transcriptionText: string

  // ── Setters ───────────────────────────────────────────────────────────────
  setPPStatus: (status: ProPresenterStatus) => void
  setPPVersion: (version: string | null) => void
  setAudioDeviceName: (name: string | null) => void
  setAudioCapturing: (capturing: boolean) => void
  setAudioError: (err: string | null) => void
  setAudioLevel: (level: AudioLevel | null) => void
  setCaptureDeviceId: (id: string) => void
  setIsTranscribing: (active: boolean) => void
  addTranscriptLine: (line: string, latencyMs?: number) => void
  setClaudeStatus: (status: 'ready' | 'processing' | 'error') => void
  addScriptureDetection: (reference: string) => void
  incrementScriptureProjected: () => void
  setAutoMode: (enabled: boolean, threshold: number) => void
  setScriptureActivePlanId: (id: string | null) => void
  setScriptureViewState: (state: {
    planId?: string | null
    itemId?: string | null
    cardInRow?: number
    mode?: 'none' | 'focus' | 'live'
  }) => void
  clearScriptureViewState: () => void
  markLiveOutput: (label: string) => void
  setLiveOutputPreview: (payload: LiveOutputPayload | null) => void
  clearScriptureLiveOutput: () => void
  setLyricsViewState: (state: {
    selectedSongId?: string | null
    filter?: 'all' | 'favorites' | 'recent'
    sortBy?: 'title' | 'artist' | 'recent' | 'added'
  }) => void
  setOperatorPreviewOutputId: (id: string | null) => void
  setLiveRailWidth: (width: number) => void
  setThemeViewState: (state: {
    selectedId?: string | null
    selectedName?: string
  }) => void

  // ── Legacy setters ────────────────────────────────────────────────────────
  setProPresenterConnected: (connected: boolean) => void
  setCurrentSlide: (slide: string | null) => void
  appendTranscription: (text: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  // ── ProPresenter ──────────────────────────────────────────────────────────
  ppState: 'disconnected',
  ppVersion: null,
  ppActivePresentationName: null,
  ppActiveSlideIndex: null,
  ppActivePlaylistName: null,

  // ── Audio ─────────────────────────────────────────────────────────────────
  audioDeviceName: null,
  audioCapturing: false,
  audioError: null,
  audioLevel: null,
  captureDeviceId: '',

  // ── Transcription ─────────────────────────────────────────────────────────
  isTranscribing: false,
  transcriptWordCount: 0,
  transcriptRecentLines: [],
  transcriptLatencyMs: null,

  // ── Scripture / Claude ────────────────────────────────────────────────────
  claudeStatus: 'ready',
  lastDetectedScripture: null,
  scriptureDetectionCount: 0,
  scriptureProjectedCount: 0,
  autoModeEnabled: false,
  confidenceThreshold: 0.7,
  scriptureActivePlanId: null,
  scriptureActiveItemId: null,
  scriptureActiveCardInRow: 0,
  scriptureHighlightMode: 'none',
  liveOutputLabel: null,
  liveOutputPreview: null,
  scriptureOutputClearToken: 0,
  lyricsSelectedSongId: null,
  lyricsFilter: 'all',
  lyricsSortBy: 'title',
  operatorPreviewOutputId: null,
  liveRailWidth: readStoredRailWidth(),
  themeSelectedId: null,
  themeSelectedName: '',

  // ── Session ───────────────────────────────────────────────────────────────
  sessionStartTime: Date.now(),

  // ── Legacy ────────────────────────────────────────────────────────────────
  proPresenterConnected: false,
  currentSlide: null,
  transcriptionText: '',

  // ── Setters ───────────────────────────────────────────────────────────────

  setPPStatus: (status) =>
    set({
      ppState: status.state,
      proPresenterConnected: status.state === 'connected',
      ppVersion: status.version,
      ppActivePresentationName: status.activePresentationName,
      ppActivePlaylistName: status.activePlaylistName,
      ppActiveSlideIndex: status.activeSlideId
        ? parseInt(status.activeSlideId.split(':')[1] ?? '0', 10)
        : null,
    }),

  setPPVersion: (version) => set({ ppVersion: version }),

  setAudioDeviceName: (name) => set({ audioDeviceName: name }),
  setAudioCapturing: (capturing) => set({ audioCapturing: capturing }),
  setAudioError: (err) => set({ audioError: err }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setCaptureDeviceId: (id) => set({ captureDeviceId: id }),

  setIsTranscribing: (active) => set({ isTranscribing: active }),

  addTranscriptLine: (line, latencyMs) =>
    set((state) => {
      const words = line.trim().split(/\s+/).filter(Boolean).length
      const prev = state.transcriptRecentLines
      const updated = [...prev, line].slice(-3)
      return {
        transcriptWordCount: state.transcriptWordCount + words,
        transcriptRecentLines: updated,
        transcriptLatencyMs: latencyMs ?? state.transcriptLatencyMs,
        transcriptionText: state.transcriptionText
          ? `${state.transcriptionText} ${line}`
          : line,
      }
    }),

  setClaudeStatus: (status) => set({ claudeStatus: status }),

  addScriptureDetection: (reference) =>
    set((state) => ({
      lastDetectedScripture: reference,
      scriptureDetectionCount: state.scriptureDetectionCount + 1,
    })),

  incrementScriptureProjected: () =>
    set((state) => ({ scriptureProjectedCount: state.scriptureProjectedCount + 1 })),

  setAutoMode: (enabled, threshold) =>
    set({ autoModeEnabled: enabled, confidenceThreshold: threshold }),

  setScriptureActivePlanId: (id) => set({ scriptureActivePlanId: id }),

  setScriptureViewState: (state) =>
    set((current) => ({
      scriptureActivePlanId:
        state.planId !== undefined ? state.planId : current.scriptureActivePlanId,
      scriptureActiveItemId:
        state.itemId !== undefined ? state.itemId : current.scriptureActiveItemId,
      scriptureActiveCardInRow:
        state.cardInRow !== undefined
          ? state.cardInRow
          : current.scriptureActiveCardInRow,
      scriptureHighlightMode:
        state.mode !== undefined ? state.mode : current.scriptureHighlightMode,
    })),

  clearScriptureViewState: () =>
    set({
      scriptureActivePlanId: null,
      scriptureActiveItemId: null,
      scriptureActiveCardInRow: 0,
      scriptureHighlightMode: 'none',
      liveOutputLabel: null,
      liveOutputPreview: null,
    }),

  markLiveOutput: (label) =>
    set({
      liveOutputLabel: label.trim() || null,
      scriptureHighlightMode: 'live',
    }),

  setLiveOutputPreview: (payload) =>
    set({
      liveOutputPreview: payload,
      liveOutputLabel: payload?.reference.trim() || null,
    }),

  clearScriptureLiveOutput: () =>
    set((state) => ({
      scriptureOutputClearToken: state.scriptureOutputClearToken + 1,
      liveOutputLabel: null,
      liveOutputPreview: null,
      scriptureHighlightMode:
        state.scriptureHighlightMode === 'live' ? 'focus' : state.scriptureHighlightMode,
    })),

  setLyricsViewState: (state) =>
    set((current) => ({
      lyricsSelectedSongId:
        state.selectedSongId !== undefined
          ? state.selectedSongId
          : current.lyricsSelectedSongId,
      lyricsFilter: state.filter !== undefined ? state.filter : current.lyricsFilter,
      lyricsSortBy: state.sortBy !== undefined ? state.sortBy : current.lyricsSortBy,
    })),

  setOperatorPreviewOutputId: (id) => set({ operatorPreviewOutputId: id }),
  setLiveRailWidth: (width) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RAIL_WIDTH_KEY, String(width))
    }
    set({ liveRailWidth: width })
  },

  setThemeViewState: (state) =>
    set((current) => ({
      themeSelectedId:
        state.selectedId !== undefined ? state.selectedId : current.themeSelectedId,
      themeSelectedName:
        state.selectedName !== undefined ? state.selectedName : current.themeSelectedName,
    })),

  // ── Legacy ────────────────────────────────────────────────────────────────

  setProPresenterConnected: (connected) => set({ proPresenterConnected: connected }),

  setCurrentSlide: (slide) => set({ currentSlide: slide }),

  appendTranscription: (text) =>
    set((state) => ({
      transcriptionText: state.transcriptionText
        ? `${state.transcriptionText} ${text}`
        : text,
    })),
}))

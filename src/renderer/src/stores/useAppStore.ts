import { create } from 'zustand'
import type { ProPresenterStatus, ProPresenterConnectionState, AudioLevel } from '@shared/ipc'

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
  /** Bumps when PP output is cleared so Scripture can drop Live badges. */
  scriptureOutputClearToken: number

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
  clearScriptureLiveOutput: () => void

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
  scriptureOutputClearToken: 0,

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
    }),

  clearScriptureLiveOutput: () =>
    set((state) => ({
      scriptureOutputClearToken: state.scriptureOutputClearToken + 1,
      scriptureHighlightMode:
        state.scriptureHighlightMode === 'live' ? 'focus' : state.scriptureHighlightMode,
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

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

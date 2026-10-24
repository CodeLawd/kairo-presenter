import { DEFAULT_OVERLAY_SETTINGS } from '@shared/overlay-defaults'
import type { SettingsWithSecretsStatus } from '@shared/ipc'
import { DEFAULT_TRANSLATION_ID } from '@shared/bible-translations'
import { DEFAULT_DOCUMENTS_SETTINGS } from '@shared/documents'
import { DEFAULT_PRESENTATION_SETTINGS } from '@shared/program'
import { DEFAULT_CAPTURE_SETTINGS } from '@shared/capture'
import { DEFAULT_WEB_SETTINGS } from '@shared/web'

/** Neutral settings used until the real ones arrive from the main process. */
export const DEFAULT_SETTINGS: SettingsWithSecretsStatus = {
  audio: { deviceId: '' },
  stt: { provider: 'none', apiKey: '', anthropicApiKey: '', deepseekApiKey: '', llmProvider: 'anthropic', llmModel: '', bibleApiKey: '', language: 'en-US' },
  scripture: {
    defaultTranslation: DEFAULT_TRANSLATION_ID,
    showVerseNumbers: true,
    autoMode: false,
    confidenceThreshold: 0.7,
    autoPresentDelaySec: 1,
    debounceInterval: 8,
    contextWindowSize: 90,
    offlineDownloadBibleIds: [],
  },
  lyrics: { braveApiKey: '', googleTranslateApiKey: '', glossColor: '#AABED7' },
  display: { theme: 'dark', fontSize: 16, transcriptionFontSize: 18 },
  overlay: DEFAULT_OVERLAY_SETTINGS,
  themeLibrary: [],
  workspace: { folder: '' },
  media: { folder: '', playlists: [] },
  tracks: { folder: '' },
  church: { name: '', timezone: '', role: '', serviceTimes: [] },
  documents: { ...DEFAULT_DOCUMENTS_SETTINGS },
  presentation: DEFAULT_PRESENTATION_SETTINGS,
  usage: { shareStats: true, sendCrashReports: true },
  themeDefaults: {},
  capture: DEFAULT_CAPTURE_SETTINGS,
  web: DEFAULT_WEB_SETTINGS,
  secretsConfigured: {
    deepgram: false,
    anthropic: false,
    deepseek: false,
    bible: false,
    brave: false,
    googleTranslate: false,
  },
}

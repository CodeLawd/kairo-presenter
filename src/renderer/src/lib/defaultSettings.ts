import { DEFAULT_OVERLAY_SETTINGS } from '@shared/overlay-defaults'
import type { SettingsWithSecretsStatus } from '@shared/ipc'
import { EMPTY_PP_RESOURCE_BINDINGS } from '@shared/propresenter-resources'
import { DEFAULT_TRANSLATION_ID } from '@shared/bible-translations'
import { DEFAULT_DOCUMENTS_SETTINGS } from '@shared/documents'
import { DEFAULT_PRESENTATION_SETTINGS } from '@shared/program'

/** Neutral settings used until the real ones arrive from the main process. */
export const DEFAULT_SETTINGS: SettingsWithSecretsStatus = {
  // Matches src/main/db/index.ts: no host until ProPresenter is set up (optional).
  propresenter: { host: '', port: 57563, password: '' },
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
  propresenterResources: { ...EMPTY_PP_RESOURCE_BINDINGS },
  presentation: DEFAULT_PRESENTATION_SETTINGS,
  secretsConfigured: {
    deepgram: false,
    anthropic: false,
    deepseek: false,
    bible: false,
    brave: false,
    googleTranslate: false,
  },
}

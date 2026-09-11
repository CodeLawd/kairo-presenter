import { DEFAULT_OVERLAY_SETTINGS } from '@shared/overlay-defaults'
import type { SettingsWithSecretsStatus } from '@shared/ipc'
import { EMPTY_PP_RESOURCE_BINDINGS } from '@shared/propresenter-resources'

/** Neutral settings used until the real ones arrive from the main process. */
export const DEFAULT_SETTINGS: SettingsWithSecretsStatus = {
  propresenter: { host: 'localhost', port: 50000, password: '' },
  audio: { deviceId: '' },
  stt: { provider: 'none', apiKey: '', anthropicApiKey: '', deepseekApiKey: '', llmProvider: 'anthropic', llmModel: '', bibleApiKey: '', language: 'en-US' },
  scripture: {
    defaultTranslation: 'NKJV',
    showVerseNumbers: true,
    autoMode: false,
    confidenceThreshold: 0.7,
    autoPresentDelaySec: 1,
    debounceInterval: 8,
    contextWindowSize: 90,
    offlineDownloadBibleIds: [],
  },
  lyrics: { braveApiKey: '', googleTranslateApiKey: '', glossColor: '#D4A017' },
  display: { theme: 'dark', fontSize: 16, transcriptionFontSize: 18 },
  overlay: DEFAULT_OVERLAY_SETTINGS,
  themeLibrary: [],
  media: { folder: '', playlists: [] },
  tracks: { folder: '' },
  church: { name: '', timezone: '', role: '', serviceTimes: [] },
  propresenterResources: { ...EMPTY_PP_RESOURCE_BINDINGS },
  secretsConfigured: {
    deepgram: false,
    anthropic: false,
    deepseek: false,
    bible: false,
    brave: false,
    googleTranslate: false,
  },
}

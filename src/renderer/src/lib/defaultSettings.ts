import { DEFAULT_OVERLAY_SETTINGS } from '@shared/overlay-defaults'
import type { AppSettings } from '@shared/ipc'

/** Neutral settings used until the real ones arrive from the main process. */
export const DEFAULT_SETTINGS: AppSettings = {
  propresenter: { host: 'localhost', port: 50000, password: '' },
  audio: { deviceId: '' },
  stt: { provider: 'none', apiKey: '', anthropicApiKey: '', deepseekApiKey: '', llmProvider: 'anthropic', bibleApiKey: '', language: 'en-US' },
  scripture: {
    defaultTranslation: 'NKJV',
    showVerseNumbers: true,
    autoMode: false,
    confidenceThreshold: 0.7,
    debounceInterval: 8,
    contextWindowSize: 90,
    offlineDownloadBibleIds: [],
  },
  lyrics: { braveApiKey: '', googleTranslateApiKey: '', glossColor: '#D4A017' },
  display: { theme: 'dark', fontSize: 16, transcriptionFontSize: 18 },
  overlay: DEFAULT_OVERLAY_SETTINGS,
  themeLibrary: [],
}

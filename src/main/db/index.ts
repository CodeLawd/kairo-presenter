import Store from 'electron-store'
import log from 'electron-log/main'
import type { AppSettings } from '@shared/ipc'

export type { AppSettings }

const defaults: AppSettings = {
  propresenter: {
    host: '192.168.1.164',
    port: 57563,
    password: '',
  },
  audio: {
    deviceId: '',
  },
  stt: {
    provider: 'none',
    apiKey: '',
    anthropicApiKey: '',
    deepseekApiKey: '',
    llmProvider: 'anthropic',
    bibleApiKey: '',
    language: 'en-US',
  },
  scripture: {
    defaultTranslation: 'ESV',
    showVerseNumbers: true,
    autoMode: false,
    confidenceThreshold: 0.7,
    debounceInterval: 8,
    contextWindowSize: 90,
  },
  display: {
    theme: 'dark',
    fontSize: 16,
    transcriptionFontSize: 18,
  },
  overlay: {
    template: '{Reference}\n{Text}',
    showTranslation: true,
    showVerseNumbers: true,
    maxVerses: 0,
    autoClearSec: 0,
  },
}

export const store = new Store<AppSettings>({
  name: 'proautomate-settings',
  defaults,
})

export function initDatabase(): void {
  log.info('electron-store initialized', { path: store.path })
}

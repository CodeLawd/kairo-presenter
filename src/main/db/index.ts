import Store from 'electron-store'
import log from 'electron-log/main'
import type { AppSettings } from '@shared/ipc'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'

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
  overlay: DEFAULT_OVERLAY_SETTINGS,
}

export const store = new Store<AppSettings>({
  name: 'proautomate-settings',
  defaults,
})

// D3 migration — electron-store shallow-Object.assign's `defaults` at startup;
// it does NOT deep-merge. A pre-phase-2 user's stored `overlay` (no `mode` /
// `theme` / `ppVideoInputUuid`) wholesale-replaces the default, so
// `store.get('overlay').mode` would come back `undefined` forever without this
// one-time write-back. Heals the on-disk shape on every launch (a no-op once
// already normalized).
store.set('overlay', normalizeOverlaySettings(store.get('overlay')))

export function initDatabase(): void {
  log.info('electron-store initialized', { path: store.path })
}

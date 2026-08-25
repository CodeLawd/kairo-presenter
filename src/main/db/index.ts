import Store from 'electron-store'
import log from 'electron-log/main'
import type { AppSettings } from '@shared/ipc'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'
import { normalizeThemeLibrary } from '@shared/theme-library'

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
    defaultTranslation: 'NKJV',
    showVerseNumbers: true,
    autoMode: false,
    confidenceThreshold: 0.7,
    debounceInterval: 8,
    contextWindowSize: 90,
    offlineDownloadBibleIds: [],
  },
  lyrics: {
    braveApiKey: '',
    googleTranslateApiKey: '',
    glossColor: '#D4A017',
  },
  display: {
    theme: 'dark',
    fontSize: 16,
    transcriptionFontSize: 18,
  },
  overlay: DEFAULT_OVERLAY_SETTINGS,
  themeLibrary: [],
}

export const store = new Store<AppSettings>({
  name: 'proautomate-settings',
  defaults,
})

const migrations = new Store<{ nkjvDefaultV1: boolean; customThemeLibraryV1: boolean }>({
  name: 'proautomate-migrations',
  defaults: { nkjvDefaultV1: false, customThemeLibraryV1: false },
})

// Product decision: NKJV is the default. Apply once for existing installs whose
// electron-store file predates the new default, then preserve future user choices.
if (!migrations.get('nkjvDefaultV1')) {
  store.set('scripture', { ...store.get('scripture'), defaultTranslation: 'NKJV' })
  migrations.set('nkjvDefaultV1', true)
}

// Same shallow-merge caveat as `overlay` below: a stored `scripture` object
// written before the offline cache shipped has no `offlineDownloadBibleIds`,
// so heal the shape on every launch (a no-op once present).
{
  const scripture = store.get('scripture')
  if (!Array.isArray(scripture.offlineDownloadBibleIds)) {
    store.set('scripture', { ...scripture, offlineDownloadBibleIds: [] })
  }
}

{
  const lyrics = store.get('lyrics')
  const next = { ...lyrics }
  let dirty = false
  if (typeof lyrics.googleTranslateApiKey !== 'string') {
    next.googleTranslateApiKey = ''
    dirty = true
  }
  if (typeof lyrics.glossColor !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(lyrics.glossColor.trim())) {
    next.glossColor = '#D4A017'
    dirty = true
  }
  if (dirty) store.set('lyrics', next)
}

// D3 migration — electron-store shallow-Object.assign's `defaults` at startup;
// it does NOT deep-merge. A pre-phase-2 user's stored `overlay` (no `mode` /
// `theme` / `ppVideoInputUuid`) wholesale-replaces the default, so
// `store.get('overlay').mode` would come back `undefined` forever without this
// one-time write-back. Heals the on-disk shape on every launch (a no-op once
// already normalized).
store.set('overlay', normalizeOverlaySettings(store.get('overlay')))
if (!migrations.get('customThemeLibraryV1')) {
  store.set('themeLibrary', normalizeThemeLibrary(undefined, store.get('overlay').theme))
  migrations.set('customThemeLibraryV1', true)
} else {
  store.set('themeLibrary', normalizeThemeLibrary(store.get('themeLibrary'), store.get('overlay').theme))
}

export function initDatabase(): void {
  log.info('electron-store initialized', { path: store.path })
}

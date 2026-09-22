import Store from 'electron-store'
import log from 'electron-log/main'
import type { AppSettings } from '@shared/ipc'
import { DEFAULT_TRANSLATION_ID } from '@shared/bible-translations'
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } from '@shared/overlay-defaults'
import { normalizeThemeLibrary } from '@shared/theme-library'
import { EMPTY_PP_RESOURCE_BINDINGS, normalizeResourceBindings } from '@shared/propresenter-resources'
import { DEFAULT_DOCUMENTS_SETTINGS } from '@shared/documents'

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
    llmModel: '',
    bibleApiKey: '',
    language: 'en-US',
  },
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
  workspace: {
    folder: '',
  },
  media: {
    folder: '',
    playlists: [],
  },
  tracks: {
    folder: '',
  },
  church: {
    name: '',
    timezone: '',
    role: '',
    serviceTimes: [],
  },
  documents: { ...DEFAULT_DOCUMENTS_SETTINGS },
  propresenterResources: { ...EMPTY_PP_RESOURCE_BINDINGS },
}

export const store = new Store<AppSettings>({
  name: 'proautomate-settings',
  defaults,
})

export const migrations = new Store<{
  nkjvDefaultV1: boolean
  customThemeLibraryV1: boolean
  cloudOnboardingV1: boolean
  /** Songs that predate the Songs folder have been exported into it. */
  songsFolderExportV1: boolean
}>({
  name: 'proautomate-migrations',
  defaults: {
    nkjvDefaultV1: false,
    customThemeLibraryV1: false,
    cloudOnboardingV1: false,
    songsFolderExportV1: false,
  },
})

// Product decision: NKJV is the default. Apply once for existing installs whose
// electron-store file predates the new default, then preserve future user choices.
if (!migrations.get('nkjvDefaultV1')) {
  store.set('scripture', { ...store.get('scripture'), defaultTranslation: DEFAULT_TRANSLATION_ID })
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

// Same shallow-merge caveat: a store written before the workspace folder
// shipped has no `workspace` key, so heal it on every launch (a no-op once
// present). '' keeps the machine on the default Documents location.
{
  const workspace = store.get('workspace') as AppSettings['workspace'] | undefined
  if (!workspace || typeof workspace.folder !== 'string') {
    store.set('workspace', { folder: '' })
  }
}

// Same shallow-merge caveat: a store written before the onboarding wizard
// shipped has no `church` key at all, so heal it on every launch (a no-op once
// present).
{
  const church = store.get('church') as AppSettings['church'] | undefined
  if (!church || typeof church.name !== 'string' || !Array.isArray(church.serviceTimes)) {
    store.set('church', {
      name: typeof church?.name === 'string' ? church.name : '',
      timezone: typeof church?.timezone === 'string' ? church.timezone : '',
      role: typeof church?.role === 'string' ? church.role : '',
      serviceTimes: Array.isArray(church?.serviceTimes) ? church.serviceTimes : [],
    })
  }
}

// Resource bindings are the only durable part of the ProPresenter catalogue.
// electron-store shallow-merges defaults, so heal the complete object on every
// launch while leaving catalogue metadata and preview bytes in memory only.
store.set('propresenterResources', normalizeResourceBindings(store.get('propresenterResources')))

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

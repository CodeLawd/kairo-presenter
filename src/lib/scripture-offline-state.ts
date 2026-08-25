import type { ScriptureTranslationOption } from './ipc'

/**
 * User-facing states for cached API.Bible content. Shared by the main process
 * (which raises them) and the renderer (which explains them) so the wording
 * operators are trained on never drifts between the two.
 */
export const API_CACHE_MESSAGES = {
  notAvailableOffline: 'This passage is not available offline.',
  refreshRequired: 'This Bible must be refreshed before it can be used offline.',
  accessRevoked: 'Your API.Bible account no longer has access to this translation.',
  offlineDownloadNotPermitted:
    'Offline download for this translation has not been licensed for this app.',
} as const

export type ScriptureCacheNoticeKind =
  | 'offline-missing'
  | 'refresh-required'
  | 'access-revoked'
  | 'download-not-licensed'

export interface ScriptureCacheNotice {
  kind: ScriptureCacheNoticeKind
  message: string
  hint: string
}

const NOTICES: Record<string, ScriptureCacheNotice> = {
  [API_CACHE_MESSAGES.notAvailableOffline]: {
    kind: 'offline-missing',
    message: API_CACHE_MESSAGES.notAvailableOffline,
    hint: 'Restore the internet connection, or download this Bible for offline use in Settings → Scripture.',
  },
  [API_CACHE_MESSAGES.refreshRequired]: {
    kind: 'refresh-required',
    message: API_CACHE_MESSAGES.refreshRequired,
    hint: 'Cached API.Bible text expires after 30 days. Reconnect and refresh it in Settings → Scripture → Offline Bibles.',
  },
  [API_CACHE_MESSAGES.accessRevoked]: {
    kind: 'access-revoked',
    message: API_CACHE_MESSAGES.accessRevoked,
    hint: 'Check the translations enabled for your key at API.Bible, or choose another translation.',
  },
  [API_CACHE_MESSAGES.offlineDownloadNotPermitted]: {
    kind: 'download-not-licensed',
    message: API_CACHE_MESSAGES.offlineDownloadNotPermitted,
    hint: 'Confirm the API.Bible plan and publisher licence before enabling whole-Bible download.',
  },
}

/** Returns a cache notice only for states the operator must act on. */
export function getScriptureCacheNotice(error: unknown): ScriptureCacheNotice | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return NOTICES[message] ?? null
}

export const API_BIBLE_ATTRIBUTION = {
  label: 'Scripture provided by API.Bible',
  url: 'https://scripture.api.bible',
} as const

/** API-derived passages carry their provider attribution; bundled ones do not. */
export function shouldShowApiBibleAttribution(option?: ScriptureTranslationOption): boolean {
  return option?.access === 'api'
}

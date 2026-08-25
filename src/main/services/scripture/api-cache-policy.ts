/**
 * API.Bible licensing requires cached content to be refreshed at least every
 * 30 days. Anything at or past that boundary must not be served.
 */
export const API_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000

export type ApiCacheFreshness = 'fresh' | 'stale'

export function getApiCacheFreshness(fetchedAt: number, now = Date.now()): ApiCacheFreshness {
  return now - fetchedAt < API_CACHE_MAX_AGE_MS ? 'fresh' : 'stale'
}

/** Instant at which a verse fetched at `fetchedAt` may no longer be displayed. */
export function getApiCacheExpiry(fetchedAt: number): number {
  return fetchedAt + API_CACHE_MAX_AGE_MS
}

// Message wording lives in the shared module so the renderer can explain it.
export { API_CACHE_MESSAGES } from '@shared/scripture-offline-state'

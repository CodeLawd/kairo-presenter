import test from 'node:test'
import assert from 'node:assert/strict'
import { API_CACHE_MESSAGES } from '../src/main/services/scripture/api-cache-policy'
import {
  API_BIBLE_ATTRIBUTION,
  getScriptureCacheNotice,
  shouldShowApiBibleAttribution,
} from '../src/lib/scripture-offline-state'

test('a fresh cached result shows scripture normally with no cache notice', () => {
  assert.equal(getScriptureCacheNotice(null), null)
  assert.equal(getScriptureCacheNotice(new Error('No results. Try a reference like “John 3:16”.')), null)
})

test('a network failure with no cached copy reports that the passage is unavailable offline', () => {
  const notice = getScriptureCacheNotice(new Error(API_CACHE_MESSAGES.notAvailableOffline))
  assert.equal(notice!.kind, 'offline-missing')
  assert.equal(notice!.message, 'This passage is not available offline.')
  assert.match(notice!.hint, /connection/i)
})

test('an expired cache with no network reports that the Bible must be refreshed', () => {
  const notice = getScriptureCacheNotice(new Error(API_CACHE_MESSAGES.refreshRequired))
  assert.equal(notice!.kind, 'refresh-required')
  assert.equal(notice!.message, 'This Bible must be refreshed before it can be used offline.')
  assert.match(notice!.hint, /Settings/)
})

test('revoked access reports the account no longer has the translation', () => {
  const notice = getScriptureCacheNotice(new Error(API_CACHE_MESSAGES.accessRevoked))
  assert.equal(notice!.kind, 'access-revoked')
  assert.equal(notice!.message, 'Your API.Bible account no longer has access to this translation.')
})

test('the notice keeps the original wording for other failures', () => {
  const notice = getScriptureCacheNotice(new Error('Search failed'))
  assert.equal(notice, null)
})

test('attribution appears only for API-derived translations', () => {
  const api = { id: 'NKJV', name: 'New King James Version', access: 'api', available: true, requiresApiKey: true } as const
  const local = { id: 'KJV', name: 'King James Version', access: 'local', available: true, requiresApiKey: false } as const
  assert.equal(shouldShowApiBibleAttribution(api), true)
  assert.equal(shouldShowApiBibleAttribution(local), false)
  assert.equal(shouldShowApiBibleAttribution(undefined), false)
  assert.equal(API_BIBLE_ATTRIBUTION.url, 'https://scripture.api.bible')
})

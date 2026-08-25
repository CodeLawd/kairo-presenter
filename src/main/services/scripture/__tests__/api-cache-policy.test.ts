import test from 'node:test'
import assert from 'node:assert/strict'
import { API_CACHE_MAX_AGE_MS, getApiCacheFreshness } from '../api-cache-policy'

test('API cache is fresh before the 30-day boundary', () => {
  const now = Date.UTC(2026, 7, 25)
  assert.equal(getApiCacheFreshness(now - API_CACHE_MAX_AGE_MS + 1, now), 'fresh')
})

test('API cache is stale at the 30-day boundary', () => {
  const now = Date.UTC(2026, 7, 25)
  assert.equal(getApiCacheFreshness(now - API_CACHE_MAX_AGE_MS, now), 'stale')
})

test('API cache is stale beyond the 30-day boundary', () => {
  const now = Date.UTC(2026, 7, 25)
  assert.equal(getApiCacheFreshness(now - API_CACHE_MAX_AGE_MS - 60_000, now), 'stale')
})

test('the max age is exactly 30 days', () => {
  assert.equal(API_CACHE_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000)
})

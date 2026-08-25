import test from 'node:test'
import assert from 'node:assert/strict'
import type { ApiBibleOfflineTranslation } from '../src/lib/ipc'
import {
  getOfflineBibleActions,
  getOfflineBibleStatusLabel,
  formatOfflineBibleExpiry,
  getOfflineBibleProgressPercent,
  mergeOfflineDownloadProgress,
} from '../src/renderer/src/components/settings/offline-bible-view-model'

const NOW = Date.UTC(2026, 7, 25)

function row(overrides: Partial<ApiBibleOfflineTranslation> = {}): ApiBibleOfflineTranslation {
  return {
    bibleId: 'nkjv-01',
    translation: 'NKJV',
    name: 'New King James Version',
    copyright: '© Thomas Nelson',
    status: 'downloaded',
    cachedChapters: 1189,
    totalChapters: 1189,
    cachedVerses: 31102,
    fetchedAt: NOW,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    offlineDownloadEnabled: true,
    ...overrides,
  }
}

test('a fresh downloaded Bible can only be removed', () => {
  assert.deepEqual(getOfflineBibleActions(row()), ['remove'])
})

test('a stale Bible must be refreshed before removal is the only other option', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'stale' })), ['refresh', 'remove'])
})

test('a download in flight can only be paused', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'downloading' })), ['pause'])
})

test('a paused download can resume or be removed', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'paused' })), ['resume', 'remove'])
})

test('a partial download can resume or be removed', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'partial' })), ['resume', 'remove'])
})

test('a revoked Bible can only be removed', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'unavailable' })), ['remove'])
})

test('a failed download can be retried or removed', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'failed' })), ['retry', 'remove'])
})

test('an undownloaded Bible offers download only when offline rights are confirmed', () => {
  assert.deepEqual(getOfflineBibleActions(row({ status: 'not-downloaded', cachedVerses: 0 })), ['download'])
  assert.deepEqual(
    getOfflineBibleActions(row({ status: 'not-downloaded', cachedVerses: 0, offlineDownloadEnabled: false })),
    [],
  )
})

test('download is never offered for a licence that was not confirmed', () => {
  for (const status of ['not-downloaded', 'paused', 'partial'] as const) {
    assert.ok(
      !getOfflineBibleActions(row({ status, offlineDownloadEnabled: false })).some((a) =>
        a === 'download' || a === 'resume' || a === 'retry',
      ),
    )
  }
})

test('status labels explain what the operator must do', () => {
  assert.equal(getOfflineBibleStatusLabel(row()), 'Downloaded')
  assert.equal(getOfflineBibleStatusLabel(row({ status: 'stale' })), 'Refresh required')
  assert.equal(getOfflineBibleStatusLabel(row({ status: 'unavailable' })), 'No longer licensed')
  assert.equal(
    getOfflineBibleStatusLabel(row({ status: 'downloading', cachedChapters: 100, totalChapters: 1189 })),
    'Downloading 100 of 1189 chapters',
  )
})

test('progress percent is bounded and zero without a known total', () => {
  assert.equal(getOfflineBibleProgressPercent(row({ cachedChapters: 594, totalChapters: 1188 })), 50)
  assert.equal(getOfflineBibleProgressPercent(row({ cachedChapters: 5, totalChapters: 0 })), 0)
  assert.equal(getOfflineBibleProgressPercent(row({ cachedChapters: 2000, totalChapters: 1189 })), 100)
})

test('expiry reads as a date, or as an instruction once expired', () => {
  assert.equal(formatOfflineBibleExpiry(row({ expiresAt: null }), NOW), '')
  assert.equal(formatOfflineBibleExpiry(row({ expiresAt: NOW - 1 }), NOW), 'Expired')
  assert.match(formatOfflineBibleExpiry(row({ expiresAt: NOW + 86_400_000 }), NOW), /^Expires /)
})

test('progress events merge into the matching row only', () => {
  const rows = [row(), row({ bibleId: 'nlt-01', translation: 'NLT', status: 'not-downloaded' })]
  const merged = mergeOfflineDownloadProgress(rows, {
    bibleId: 'nlt-01',
    status: 'downloading',
    completedChapters: 10,
    totalChapters: 1189,
    cachedVerses: 200,
  })

  assert.equal(merged[0].status, 'downloaded')
  assert.equal(merged[1].status, 'downloading')
  assert.equal(merged[1].cachedChapters, 10)
  assert.equal(merged[1].cachedVerses, 200)
})

test('a removal progress event drops nothing but resets the row', () => {
  const merged = mergeOfflineDownloadProgress([row()], {
    bibleId: 'nkjv-01',
    status: 'not-downloaded',
    completedChapters: 0,
    totalChapters: 0,
    cachedVerses: 0,
  })
  assert.equal(merged[0].status, 'not-downloaded')
  assert.equal(merged[0].cachedVerses, 0)
  assert.equal(merged[0].expiresAt, null)
})

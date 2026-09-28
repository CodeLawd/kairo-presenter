import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_OFFLINE_BIBLE_IDS_ENV_VAR,
  OFFLINE_BIBLE_IDS_ENV_VAR,
  isOfflineDownloadPermitted,
  resolveOfflineDownloadBibleIds,
} from '../offline-download-policy'

test('the stored allowlist provisions offline rights', () => {
  assert.deepEqual(resolveOfflineDownloadBibleIds(['nkjv-01'], {}), ['nkjv-01'])
})

test('a deployment environment variable can provision ids without editing settings', () => {
  const ids = resolveOfflineDownloadBibleIds([], {
    [OFFLINE_BIBLE_IDS_ENV_VAR]: 'nlt-01, niv-01',
  })
  assert.deepEqual(ids, ['nlt-01', 'niv-01'])
})

test('both sources are merged and de-duplicated', () => {
  const ids = resolveOfflineDownloadBibleIds(['nkjv-01', 'nlt-01'], {
    [OFFLINE_BIBLE_IDS_ENV_VAR]: 'nlt-01,niv-01',
  })
  assert.deepEqual(ids, ['nkjv-01', 'nlt-01', 'niv-01'])
})

test('blank and malformed entries are ignored', () => {
  assert.deepEqual(
    resolveOfflineDownloadBibleIds(undefined, { [OFFLINE_BIBLE_IDS_ENV_VAR]: ' , ,\tnkjv-01 ,' }),
    ['nkjv-01'],
  )
  assert.deepEqual(resolveOfflineDownloadBibleIds(undefined, {}), [])
})

test('an allowlisted Bible may be downloaded', () => {
  assert.equal(isOfflineDownloadPermitted('nkjv-01', ['nkjv-01'], '© Thomas Nelson'), true)
  assert.equal(isOfflineDownloadPermitted('nkjv-01', [], '© Thomas Nelson'), false)
})

test('public-domain translations need no licence approval', () => {
  assert.equal(isOfflineDownloadPermitted('kjv-01', [], 'PUBLIC DOMAIN'), true)
  assert.equal(isOfflineDownloadPermitted('kjv-01', [], 'This work is in the public domain.'), true)
})

test('an unknown copyright is treated as copyrighted', () => {
  assert.equal(isOfflineDownloadPermitted('unknown-01', [], ''), false)
  assert.equal(isOfflineDownloadPermitted('unknown-01', [], 'All rights reserved'), false)
})

test('the pre-rename environment variable is still honoured', () => {
  assert.deepEqual(
    resolveOfflineDownloadBibleIds(['kjv-01'], {
      [OFFLINE_BIBLE_IDS_ENV_VAR]: 'nlt-01',
      [LEGACY_OFFLINE_BIBLE_IDS_ENV_VAR]: 'niv-01, nlt-01',
    }),
    ['kjv-01', 'nlt-01', 'niv-01'],
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DOCUMENTS_SETTINGS,
  normalizeDocumentsSettings,
  SLIDESHOW_MAX_SEC,
  SLIDESHOW_MIN_SEC,
} from '../src/lib/documents'

test('slideshow settings fall back to the defaults when the store is empty', () => {
  assert.deepEqual(normalizeDocumentsSettings(undefined), DEFAULT_DOCUMENTS_SETTINGS)
  assert.deepEqual(normalizeDocumentsSettings({}), DEFAULT_DOCUMENTS_SETTINGS)
})

test('an unusable interval can never reach the timer', () => {
  assert.equal(normalizeDocumentsSettings({ slideshowSec: 0 }).slideshowSec, SLIDESHOW_MIN_SEC)
  assert.equal(normalizeDocumentsSettings({ slideshowSec: -30 }).slideshowSec, SLIDESHOW_MIN_SEC)
  assert.equal(normalizeDocumentsSettings({ slideshowSec: 99_999 }).slideshowSec, SLIDESHOW_MAX_SEC)
  assert.equal(normalizeDocumentsSettings({ slideshowSec: 7.6 }).slideshowSec, 8)
  assert.equal(
    normalizeDocumentsSettings({ slideshowSec: 'soon' as unknown as number }).slideshowSec,
    DEFAULT_DOCUMENTS_SETTINGS.slideshowSec,
  )
})

test('loop and auto-start survive a round trip and keep false values', () => {
  const saved = normalizeDocumentsSettings({ slideshowSec: 45, slideshowLoop: false, slideshowAutoStart: true })
  assert.deepEqual(saved, { slideshowSec: 45, slideshowLoop: false, slideshowAutoStart: true })
  assert.deepEqual(normalizeDocumentsSettings(saved), saved)
})

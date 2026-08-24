import assert from 'node:assert/strict'
import test from 'node:test'
import * as ipc from '../src/lib/ipc'

const plan = {
  id: 'sermon-1',
  title: 'Sunday sermon',
  sourceFileName: 'notes.docx',
  items: [],
  createdAt: 100,
  updatedAt: 100,
}

test('a completed sermon review remains complete after persistence and reload', () => {
  assert.equal(typeof ipc.completeSermonPlanReview, 'function')
  assert.equal(typeof ipc.sermonPlanNeedsReview, 'function')

  const completed = ipc.completeSermonPlanReview(plan, 500)
  const reloaded = JSON.parse(JSON.stringify(completed))

  assert.equal(completed.reviewedAt, 500)
  assert.equal(ipc.sermonPlanNeedsReview(reloaded), false)
})

test('a newly imported sermon plan still requires review', () => {
  assert.equal(typeof ipc.sermonPlanNeedsReview, 'function')
  assert.equal(ipc.sermonPlanNeedsReview(plan), true)
})

test('a searched scripture is appended to an already completed playlist', () => {
  assert.equal(typeof ipc.appendScriptureResultToPlan, 'function')

  const savedPlan = { ...plan, reviewedAt: 400 }
  const updated = ipc.appendScriptureResultToPlan(savedPlan, {
    reference: 'John 3:16',
    translation: 'KJV',
    verses: [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world.' }],
  }, 'manual-john-316', 600)

  assert.equal(updated.items.length, 1)
  assert.deepEqual(updated.items[0], {
    id: 'manual-john-316',
    reference: 'John 3:16',
    translation: 'KJV',
    verses: [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world.' }],
    available: true,
  })
  assert.equal(updated.reviewedAt, 400)
  assert.equal(updated.updatedAt, 600)
})

const orderedPlan = {
  ...plan,
  reviewedAt: 400,
  items: [
    { id: 'a', reference: 'John 1:1', translation: 'KJV' as const, verses: [], available: true },
    { id: 'b', reference: 'John 1:2', translation: 'KJV' as const, verses: [], available: true },
    { id: 'c', reference: 'John 1:3', translation: 'KJV' as const, verses: [], available: true },
  ],
}

test('a scripture reference can be removed from a saved playlist', () => {
  assert.equal(typeof ipc.removeSermonPlanItem, 'function')

  const updated = ipc.removeSermonPlanItem(orderedPlan, 'b', 700)

  assert.deepEqual(updated.items.map((item) => item.id), ['a', 'c'])
  assert.equal(updated.reviewedAt, 400)
  assert.equal(updated.updatedAt, 700)
})

test('saved playlist references can be reordered before or after another reference', () => {
  assert.equal(typeof ipc.reorderSermonPlanItem, 'function')

  const movedAfter = ipc.reorderSermonPlanItem(orderedPlan, 'a', 'c', 'after', 800)
  assert.deepEqual(movedAfter.items.map((item) => item.id), ['b', 'c', 'a'])

  const movedBefore = ipc.reorderSermonPlanItem(orderedPlan, 'c', 'a', 'before', 900)
  assert.deepEqual(movedBefore.items.map((item) => item.id), ['c', 'a', 'b'])
  assert.equal(movedBefore.updatedAt, 900)
})

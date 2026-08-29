import assert from 'node:assert/strict'
import test from 'node:test'

import { planMediaImport, uniqueFileName } from '../src/main/services/media'

test('a free name is left alone', () => {
  assert.equal(uniqueFileName('loop.mp4', new Set(['still.png'])), 'loop.mp4')
})

test('a collision gets a numeric suffix', () => {
  assert.equal(uniqueFileName('loop.mp4', new Set(['loop.mp4'])), 'loop 1.mp4')
  assert.equal(uniqueFileName('loop.mp4', new Set(['loop.mp4', 'loop 1.mp4'])), 'loop 2.mp4')
})

test('collision check is case-insensitive', () => {
  assert.equal(uniqueFileName('Loop.mp4', new Set(['loop.mp4'])), 'Loop 1.mp4')
})

test('files already in the media folder are reused, not copied', () => {
  const plan = planMediaImport(
    '/media/backgrounds/Motion/loop.mp4',
    '/media/backgrounds',
    new Set(),
  )
  assert.equal(plan.action, 'reuse')
  if (plan.action === 'reuse') {
    assert.equal(plan.absPath, '/media/backgrounds/Motion/loop.mp4')
  }
})

test('files outside the media folder are copied in', () => {
  const plan = planMediaImport('/Downloads/sunset.mp4', '/media/backgrounds', new Set(['sunset.mp4']))
  assert.equal(plan.action, 'copy')
  if (plan.action === 'copy') {
    assert.equal(plan.from, '/Downloads/sunset.mp4')
    assert.equal(plan.destName, 'sunset 1.mp4')
  }
})

test('unsupported types are skipped', () => {
  assert.equal(planMediaImport('/Downloads/notes.pdf', '/media/backgrounds', new Set()).action, 'skip')
})

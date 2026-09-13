import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { planMediaImport, planMediaPaste, uniqueFileName } from '../src/main/services/media'

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
  // Fixtures are built with path.join/resolve so they are native on every OS:
  // planMediaImport resolves its inputs, which turns a POSIX literal into a
  // drive-relative path on Windows and breaks the comparison.
  const root = path.resolve('media', 'backgrounds')
  const inside = path.join(root, 'Motion', 'loop.mp4')
  const plan = planMediaImport(inside, root, new Set())
  assert.equal(plan.action, 'reuse')
  if (plan.action === 'reuse') {
    assert.equal(plan.absPath, path.resolve(inside))
  }
})

test('files outside the media folder are copied in', () => {
  const root = path.resolve('media', 'backgrounds')
  const outside = path.resolve('Downloads', 'sunset.mp4')
  const plan = planMediaImport(outside, root, new Set(['sunset.mp4']))
  assert.equal(plan.action, 'copy')
  if (plan.action === 'copy') {
    assert.equal(plan.from, outside)
    assert.equal(plan.destName, 'sunset 1.mp4')
  }
})

test('unsupported types are skipped', () => {
  const root = path.resolve('media', 'backgrounds')
  assert.equal(planMediaImport(path.resolve('Downloads', 'notes.pdf'), root, new Set()).action, 'skip')
})

test('paste duplicates a file already in the library', () => {
  const root = path.resolve('media', 'backgrounds')
  const source = path.join(root, 'loop.mp4')
  const plan = planMediaPaste(source, root, new Set(['loop.mp4']))
  assert.equal(plan.action, 'copy')
  if (plan.action === 'copy') {
    assert.equal(plan.from, path.resolve(source))
    assert.equal(plan.destName, 'loop 1.mp4')
  }
})

test('paste copies an external file under a free name', () => {
  const root = path.resolve('media', 'backgrounds')
  const plan = planMediaPaste(path.resolve('Downloads', 'sunset.mp4'), root, new Set())
  assert.equal(plan.action, 'copy')
  if (plan.action === 'copy') {
    assert.equal(plan.destName, 'sunset.mp4')
  }
})

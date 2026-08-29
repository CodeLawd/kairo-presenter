import assert from 'node:assert/strict'
import test from 'node:test'

import { isInsideRoot } from '../src/main/services/media'

// The `pa-media://` protocol serves anything under the backgrounds folder, so
// this predicate is the whole boundary between "a background" and "any file on
// the machine". These are the ways a prefix test leaks.

test('files inside the root are served', () => {
  assert.equal(isInsideRoot('/media/backgrounds/loop.mp4', '/media/backgrounds'), true)
  assert.equal(isInsideRoot('/media/backgrounds/motion/loop.mp4', '/media/backgrounds'), true)
})

test('the root itself is inside the root', () => {
  assert.equal(isInsideRoot('/media/backgrounds', '/media/backgrounds'), true)
})

test('a sibling directory sharing the prefix is rejected', () => {
  // Plain `startsWith(root)` would serve this — the separator check is why it does not.
  assert.equal(isInsideRoot('/media/backgrounds-private/secrets.mp4', '/media/backgrounds'), false)
  assert.equal(isInsideRoot('/media/backgroundsX', '/media/backgrounds'), false)
})

test('traversal out of the root is rejected', () => {
  assert.equal(isInsideRoot('/media/backgrounds/../../etc/passwd', '/media/backgrounds'), false)
  assert.equal(isInsideRoot('/etc/passwd', '/media/backgrounds'), false)
})

test('a parent of the root is not inside it', () => {
  assert.equal(isInsideRoot('/media', '/media/backgrounds'), false)
})

test('unnormalized paths are resolved before comparing', () => {
  assert.equal(isInsideRoot('/media/backgrounds/./motion/loop.mp4', '/media/backgrounds'), true)
  assert.equal(isInsideRoot('/media/backgrounds/motion/../loop.mp4', '/media/backgrounds'), true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { MIN_PROP_OBJECT_SIZE, applyPropGesture, type PropGesture } from '../src/lib/prop-geometry'

const origin = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }
const move: PropGesture = { kind: 'move', objectId: 'o', startX: 0, startY: 0, origin }
const resize = (corner: 'nw' | 'ne' | 'sw' | 'se'): PropGesture => ({ kind: 'resize', objectId: 'o', corner, startX: 0, startY: 0, origin })
const near = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

test('moving keeps the size and follows the pointer', () => {
  const box = applyPropGesture(move, 0.1, -0.05)
  near(box.x, 0.5)
  near(box.y, 0.35)
  assert.equal(box.w, 0.2)
  assert.equal(box.h, 0.2)
})

test('moving stops at every edge of the frame', () => {
  assert.deepEqual(applyPropGesture(move, -5, -5), { ...origin, x: 0, y: 0 })
  const far = applyPropGesture(move, 5, 5)
  near(far.x, 0.8)
  near(far.y, 0.8)
})

test('dragging the bottom-right corner grows the box from its top-left', () => {
  const box = applyPropGesture(resize('se'), 0.1, 0.05)
  assert.equal(box.x, 0.4)
  assert.equal(box.y, 0.4)
  near(box.w, 0.3)
  near(box.h, 0.25)
})

test('dragging the top-left corner keeps the bottom-right corner still', () => {
  const box = applyPropGesture(resize('nw'), -0.1, -0.1)
  near(box.x, 0.3)
  near(box.y, 0.3)
  near(box.x + box.w, 0.6)
  near(box.y + box.h, 0.6)
})

test('a resize never turns the box inside out', () => {
  const shrunk = applyPropGesture(resize('se'), -1, -1)
  near(shrunk.w, MIN_PROP_OBJECT_SIZE)
  near(shrunk.h, MIN_PROP_OBJECT_SIZE)
  const pushed = applyPropGesture(resize('nw'), 1, 1)
  near(pushed.w, MIN_PROP_OBJECT_SIZE)
  near(pushed.x + pushed.w, 0.6)
})

test('a resize stops at the frame edge', () => {
  const box = applyPropGesture(resize('se'), 5, 5)
  near(box.x + box.w, 1)
  near(box.y + box.h, 1)
  const other = applyPropGesture(resize('nw'), -5, -5)
  assert.equal(other.x, 0)
  assert.equal(other.y, 0)
})

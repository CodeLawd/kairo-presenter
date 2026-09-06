import assert from 'node:assert/strict'
import test from 'node:test'

import { applyItemOrder, reorderIds } from '../src/lib/media-order'

test('reorderIds moves an item before another', () => {
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
})

test('reorderIds moves an item after another', () => {
  assert.deepEqual(reorderIds(['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'c', 'a'])
})

test('reorderIds is a no-op when the ids match or are unknown', () => {
  assert.deepEqual(reorderIds(['a', 'b'], 'a', 'a', 'after'), ['a', 'b'])
  assert.deepEqual(reorderIds(['a', 'b'], 'z', 'a', 'before'), ['a', 'b'])
  assert.deepEqual(reorderIds(['a', 'b'], 'a', 'z', 'after'), ['a', 'b'])
})

test('applyItemOrder keeps the saved sequence and appends newcomers', () => {
  const items = [
    { id: 'new' },
    { id: 'b' },
    { id: 'a' },
  ]
  assert.deepEqual(applyItemOrder(items, ['a', 'b', 'gone']), [
    { id: 'a' },
    { id: 'b' },
    { id: 'new' },
  ])
})

test('applyItemOrder with no saved order leaves scan order alone', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(applyItemOrder(items, []), items)
})

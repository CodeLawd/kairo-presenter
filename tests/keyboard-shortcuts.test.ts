import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindingsFor, commandForShortcut, shortcutFromEvent } from '../src/lib/keyboard-shortcuts'

test('existing bindings remain defaults and can be replaced or disabled', () => {
  assert.equal(commandForShortcut('Space'), 'approve')
  assert.equal(commandForShortcut('Enter'), 'approve')
  assert.equal(commandForShortcut('Space', { approve: ['Mod+p'] }), undefined)
  assert.equal(commandForShortcut('Mod+p', { approve: ['Mod+p'] }), 'approve')
  assert.equal(commandForShortcut('Delete', { clear: [] }), undefined)
  assert.deepEqual(bindingsFor('clear', JSON.parse(JSON.stringify({ clear: [] }))), [])
})
test('captures modifiers exactly and normalizes Mac and Windows primary modifiers', () => {
  const event = { key: 'P', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }
  assert.equal(shortcutFromEvent(event), 'Mod+Shift+p')
  assert.equal(shortcutFromEvent({ ...event, metaKey: false, ctrlKey: true }), 'Mod+Shift+p')
  assert.equal(commandForShortcut('Shift+Enter'), undefined)
  assert.equal(shortcutFromEvent({ ...event, key: 'Shift' }), null)
})
test('detects collisions against defaults and custom assignments', () => {
  assert.equal(commandForShortcut('Mod+f', { approve: [] }), 'search')
  assert.equal(commandForShortcut('Mod+p', { approve: [], clear: ['Mod+p'] }), 'clear')
  assert.equal(commandForShortcut('Mod+f', { search: [] }), undefined)
})

test('a presentation clicker drives previous and next out of the box', () => {
  const press = (key: string): string | null =>
    shortcutFromEvent({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })
  assert.equal(commandForShortcut(press('PageDown')!), 'next')
  assert.equal(commandForShortcut(press('PageUp')!), 'previous')
  assert.equal(commandForShortcut(press('ArrowRight')!), 'next')
  // Remapping still wins: a clicker key is a default, not a hard wire.
  assert.equal(commandForShortcut('PageDown', { next: ['ArrowRight'] }), undefined)
})

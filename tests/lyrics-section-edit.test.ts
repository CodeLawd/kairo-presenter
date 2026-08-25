import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultLabelForType,
  expandJammedLines,
  splitSectionAtCursor,
  splitTextAtCursor,
} from '../src/lib/lyrics-section-edit'

test('splitTextAtCursor starts the new block on the cursor line', () => {
  assert.deepEqual(splitTextAtCursor('A\nB\nC', 3), { before: 'A', after: 'B\nC' })
})

test('splitTextAtCursor at start leaves before empty', () => {
  assert.deepEqual(splitTextAtCursor('A\nB', 0), { before: '', after: 'A\nB' })
})

test('expandJammedLines splits double-spaced phrases', () => {
  assert.equal(
    expandJammedLines('Ide na lolu le  Ide noku daji\n\nPower!'),
    'Ide na lolu le\nIde noku daji\n\nPower!'
  )
})

test('splitSectionAtCursor inserts a typed section after the cursor line', () => {
  let n = 0
  const sections = [
    { _key: 'a', type: 'chorus' as const, label: 'Chorus', linesText: 'Line one\nLine two\nLine three' },
  ]
  const next = splitSectionAtCursor(sections, 0, 9, () => `k${++n}`, 'bridge')
  assert.ok(next)
  assert.equal(next.length, 2)
  assert.equal(next[0].linesText, 'Line one')
  assert.equal(next[1].type, 'bridge')
  assert.equal(next[1].label, 'Bridge')
  assert.equal(next[1].linesText, 'Line two\nLine three')
})

test('splitSectionAtCursor returns null when nothing follows the cursor', () => {
  const sections = [
    { _key: 'a', type: 'verse' as const, label: 'Verse', linesText: 'Only line' },
  ]
  assert.equal(splitSectionAtCursor(sections, 0, 9, () => 'x'), null)
})

test('defaultLabelForType numbers repeats', () => {
  assert.equal(defaultLabelForType('verse', 1), 'Verse')
  assert.equal(defaultLabelForType('verse', 2), 'Verse 2')
})

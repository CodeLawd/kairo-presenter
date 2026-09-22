import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultLabelForType,
  parseMarkedSections,
  sectionTypeFromLabel,
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

// ─── parseMarkedSections ──────────────────────────────────────────────────────
// The import preview shows a song as editable marked-up text; what is typed
// there has to become sections again, the same way a pasted song does.

test('marked text becomes sections, labels and all', () => {
  const sections = parseMarkedSections('[Verse 1]\nLine one\nLine two\n\n[Chorus]\nSing it')
  assert.deepEqual(sections, [
    { type: 'verse', label: 'Verse 1', lines: ['Line one', 'Line two'] },
    { type: 'chorus', label: 'Chorus', lines: ['Sing it'] },
  ])
})

test('lyrics before the first marker are kept as a verse, not dropped', () => {
  const sections = parseMarkedSections('Straight into the song\n\n[Chorus]\nSing it')
  assert.equal(sections.length, 2)
  assert.equal(sections[0].type, 'verse')
  assert.deepEqual(sections[0].lines, ['Straight into the song'])
})

test('blank lines inside a section survive — they are the slide breaks', () => {
  const sections = parseMarkedSections('[Verse 1]\nOne\n\nTwo')
  assert.deepEqual(sections[0].lines, ['One', '', 'Two'])
})

test('an ordinal does not change the section type', () => {
  assert.equal(sectionTypeFromLabel('Pre-Chorus 2'), 'pre-chorus')
  assert.equal(sectionTypeFromLabel('Chorus'), 'chorus')
  assert.equal(sectionTypeFromLabel('Something Else'), 'verse')
})

test('empty text produces no sections', () => {
  assert.deepEqual(parseMarkedSections(''), [])
})

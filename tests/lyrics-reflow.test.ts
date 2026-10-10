import assert from 'node:assert/strict'
import test from 'node:test'
import { nextSectionLabel, parseReflow, reflowHeaderLabel } from '../src/lib/lyrics-reflow'

test('blank lines split slides; each slide knows the line it starts on', () => {
  const [verse] = parseReflow('[Verse 1]\nOne\nTwo\n\n\n\nThree\n')
  assert.deepEqual(verse.slides, [
    { startLine: 1, lines: ['One', 'Two'] },
    { startLine: 6, lines: ['Three'] },
  ])
  // Runs of blank lines store as one break.
  assert.equal(verse.linesText, 'One\nTwo\n\nThree')
})

test('lyrics before any header become the first verse; type follows the label', () => {
  const sections = parseReflow('Opening line\n\n[Pre-Chorus]\nRising\n[Bridge 2]\nTurn')
  assert.deepEqual(sections.map((s) => [s.label, s.type, s.headerLine]), [
    ['Verse 1', 'verse', null],
    ['Pre-Chorus', 'pre-chorus', 2],
    ['Bridge 2', 'bridge', 4],
  ])
})

test('an empty header is still a section', () => {
  const sections = parseReflow('[Chorus]\n\n[Verse 2]\nWords')
  assert.equal(sections[0].label, 'Chorus')
  assert.deepEqual(sections[0].slides, [])
})

test('only a whole line in brackets is a header', () => {
  assert.equal(reflowHeaderLabel('  [Chorus]  '), 'Chorus')
  assert.equal(reflowHeaderLabel('[Chorus'), null)
  assert.equal(reflowHeaderLabel('Sing [loud] now'), null)
})

test('the next free label: verses numbered, the rest bare first', () => {
  const sections = parseReflow('[Verse 1]\nA\n\n[Chorus]\nB')
  assert.equal(nextSectionLabel(sections, 'verse'), 'Verse 2')
  assert.equal(nextSectionLabel(sections, 'chorus'), 'Chorus 2')
  assert.equal(nextSectionLabel(sections, 'bridge'), 'Bridge')
})

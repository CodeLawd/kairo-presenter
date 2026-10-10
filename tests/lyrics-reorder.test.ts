import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labelLyricSlides, moveLyricSlide, reorderLyricSlide } from '../src/lib/lyrics-reorder'
import { buildSlides } from '../src/lib/lyrics-slides'
import type { LyricsSong, LyricsSongSection } from '../src/lib/ipc'
const sections: LyricsSongSection[] = [
  { type: 'verse', label: 'Verse 1', lines: ['First', '', 'Second'], lineColors: ['#FF0000', null, '#00FF00'] },
  { type: 'chorus', label: 'Chorus', lines: ['Third'] },
]
const slideTexts = (value: LyricsSongSection[]) => buildSlides({ sections: value } as LyricsSong).map(slide => slide.lines.join(' '))
test('moves slides in either direction across sections without changing source', () => {
  const result = reorderLyricSlide(sections, 0, 2)
  assert.deepEqual(slideTexts(result), ['Second', 'Third', 'First'])
  assert.equal(result[2].label, 'Verse 1')
  assert.equal(result[2].lineColors?.[0], '#FF0000')
  assert.deepEqual(slideTexts(reorderLyricSlide(sections, 2, 0)), ['Third', 'First', 'Second'])
  assert.deepEqual(slideTexts(sections), ['First', 'Second', 'Third'])
})
test('reorders within a section and preserves blank slide boundaries', () => {
  const result = reorderLyricSlide(sections, 0, 1)
  assert.deepEqual(result[0].lines, ['Second', '', 'First'])
  assert.deepEqual(result[0].lineColors, ['#00FF00', null, '#FF0000'])
})
test('invalid and unchanged moves leave sections untouched', () => {
  assert.equal(reorderLyricSlide(sections, 1, 1), sections)
  assert.equal(reorderLyricSlide(sections, -1, 0), sections)
  assert.equal(reorderLyricSlide(sections, 0, 10), sections)
})

test('labelling slides splits a section and keeps order and colours', () => {
  const long: LyricsSongSection[] = [
    { type: 'verse', label: 'Verse 1', lines: ['A', '', 'B', '', 'C', '', 'D'], lineColors: [null, null, '#FF0000', null, null, null, null] },
  ]
  const result = labelLyricSlides(long, [1, 2], { type: 'chorus', label: 'Chorus' })
  assert.deepEqual(result.map(section => section.label), ['Verse 1', 'Chorus', 'Verse 1'])
  assert.deepEqual(result[1].lines, ['B', '', 'C'])
  assert.equal(result[1].type, 'chorus')
  assert.equal(result[1].lineColors?.[0], '#FF0000')
  assert.deepEqual(slideTexts(result), ['A', 'B', 'C', 'D'])
})
test('labelled slides merge into a neighbouring section with the same label', () => {
  const result = labelLyricSlides(sections, [1], { type: 'chorus', label: 'Chorus' })
  assert.deepEqual(result.map(section => section.label), ['Verse 1', 'Chorus'])
  assert.deepEqual(result[1].lines, ['Second', '', 'Third'])
})
test('labelling nothing valid leaves sections untouched', () => {
  assert.equal(labelLyricSlides(sections, [9], { type: 'bridge', label: 'Bridge' }), sections)
})

test('a slide moved into another section joins it, with no fragments left behind', () => {
  const song: LyricsSongSection[] = [
    { type: 'chorus', label: 'Chorus', lines: ['C1', '', 'C2'] },
    { type: 'verse', label: 'Verse 2', lines: ['V1', '', 'V2', '', 'V3'] },
  ]
  // V1 dropped after C2: it becomes chorus, and Verse 2 stays one section.
  const result = moveLyricSlide(song, 2, 1, 'after')
  assert.deepEqual(result.map(section => section.label), ['Chorus', 'Verse 2'])
  assert.deepEqual(result[0].lines, ['C1', '', 'C2', '', 'V1'])
  assert.deepEqual(result[1].lines, ['V2', '', 'V3'])
})
test('moving heals sections already split into same-label fragments', () => {
  const fragmented: LyricsSongSection[] = [
    { type: 'verse', label: 'Verse 2', lines: ['A'] },
    { type: 'verse', label: 'Verse 2', lines: ['B'] },
    { type: 'verse', label: 'Verse 2', lines: ['C'] },
  ]
  const result = moveLyricSlide(fragmented, 0, 2, 'after')
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].lines, ['B', '', 'C', '', 'A'])
})
test('dropping a slide beside itself in the same section changes nothing', () => {
  assert.equal(moveLyricSlide(sections, 0, 0, 'after'), sections)
  assert.equal(moveLyricSlide(sections, 0, 9, 'after'), sections)
})

test('deleting slides removes just those slides and rejoins the rest', async () => {
  const { deleteLyricSlides } = await import('../src/lib/lyrics-reorder')
  const sections = [
    { type: 'verse' as const, label: 'Verse 1', lines: ['a1', '', 'a2', '', 'a3'] },
    { type: 'chorus' as const, label: 'Chorus', lines: ['c1'], hotkey: 'C' },
    { type: 'verse' as const, label: 'Verse 1', lines: ['b1'] },
  ]
  // Slide 1 is "a2": the verse keeps a1 and a3.
  const oneGone = deleteLyricSlides(sections, [1])
  assert.deepEqual(oneGone.map((s) => s.lines), [['a1', '', 'a3'], ['c1'], ['b1']])
  // Deleting the whole chorus (slide 3) joins the two Verse 1 neighbours.
  const chorusGone = deleteLyricSlides(sections, [3])
  assert.deepEqual(chorusGone.map((s) => [s.label, s.lines]), [['Verse 1', ['a1', '', 'a2', '', 'a3', '', 'b1']]])
  // Out-of-range indexes change nothing.
  assert.equal(deleteLyricSlides(sections, [99]), sections)
})

test('quick edit replaces one slide, keeping colours on unchanged lines', async () => {
  const { lyricSlideLines, replaceLyricSlide } = await import('../src/lib/lyrics-reorder')
  const song = [
    { type: 'verse' as const, label: 'Verse 1', lines: ['One', 'Two', '', 'Three'], lineColors: ['#FF0000', null, null, '#00FF00'] },
  ]
  assert.deepEqual(lyricSlideLines(song, 0), ['One', 'Two'])
  assert.equal(lyricSlideLines(song, 5), null)
  const edited = replaceLyricSlide(song, 0, ['One', 'Two changed  ', ''])
  assert.deepEqual(edited[0].lines, ['One', 'Two changed', '', 'Three'])
  assert.deepEqual(edited[0].lineColors, ['#FF0000', null, null, '#00FF00'])
  // Emptying a slide is not a delete: nothing changes.
  assert.equal(replaceLyricSlide(song, 0, ['  ', '']), song)
})

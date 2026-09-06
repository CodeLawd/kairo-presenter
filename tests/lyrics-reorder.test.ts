import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reorderLyricSlide } from '../src/lib/lyrics-reorder'
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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LyricsSong, LyricsSongSection } from '../src/lib/ipc'
import {
  autoAssignHotkeys,
  hotkeyFromEvent,
  normalizeHotkey,
  sectionForHotkey,
  setSectionHotkey,
} from '../src/lib/lyrics-hotkeys'
import { parseSongFile, serializeSongFile } from '../src/lib/workspace'
import { labelLyricSlides } from '../src/lib/lyrics-reorder'

const section = (type: LyricsSongSection['type'], label: string, hotkey?: string): LyricsSongSection => ({
  type,
  label,
  lines: [`${label} line one`, '', `${label} line two`],
  ...(hotkey ? { hotkey } : {}),
})

test('only single letters and digits are hotkeys, stored upper-case', () => {
  assert.equal(normalizeHotkey('c'), 'C')
  assert.equal(normalizeHotkey(' 3 '), '3')
  assert.equal(normalizeHotkey('CC'), undefined)
  assert.equal(normalizeHotkey('!'), undefined)
  assert.equal(normalizeHotkey(7), undefined)
  assert.equal(hotkeyFromEvent('a'), 'A')
  assert.equal(hotkeyFromEvent('ArrowLeft'), null)
  assert.equal(hotkeyFromEvent(' '), null)
})

test('auto-assign follows ProPresenter: verses by number, C for chorus, B for bridge', () => {
  const sections = autoAssignHotkeys([
    section('verse', 'Verse 1'),
    section('chorus', 'Chorus'),
    section('verse', 'Verse 2'),
    section('chorus', 'Chorus 2'),
    section('bridge', 'Bridge'),
    section('tag', 'Tag', 'X'),
  ])
  assert.deepEqual(sections.map((s) => s.hotkey), ['1', 'C', '2', undefined, 'B', 'X'])
})

test('auto-assign never steals a key already chosen by hand', () => {
  const sections = autoAssignHotkeys([section('verse', 'Verse 1', 'C'), section('chorus', 'Chorus')])
  assert.deepEqual(sections.map((s) => s.hotkey), ['C', undefined])
})

test('giving a key to one section takes it off the other', () => {
  const sections = setSectionHotkey([section('verse', 'Verse 1', 'A'), section('chorus', 'Chorus')], 1, 'a')
  assert.deepEqual(sections.map((s) => s.hotkey), [undefined, 'A'])
  assert.equal(sectionForHotkey(sections, 'A'), 1)
  assert.equal(sectionForHotkey(sections, 'Z'), -1)
  const cleared = setSectionHotkey(sections, 1, '')
  assert.deepEqual(cleared.map((s) => s.hotkey), [undefined, undefined])
})

test('hotkeys survive the song file on disk', () => {
  const song: LyricsSong = {
    id: 'song-1',
    title: 'Another in the Fire',
    artist: '',
    sections: [section('verse', 'Verse 1', 'A'), section('chorus', 'Chorus', 'c'), section('bridge', 'Bridge')],
    createdAt: 1,
    updatedAt: 1,
  }
  const back = parseSongFile(serializeSongFile(song), 'song-1')
  assert.deepEqual(back?.sections.map((s) => s.hotkey), ['A', 'C', undefined])
})

test('splitting a section by relabelling keeps its hotkey on one half only', () => {
  const sections = [section('verse', 'Verse 1', 'A')]
  // Move the second slide of Verse 1 into a new Verse 2.
  const relabelled = labelLyricSlides(sections, [1], { type: 'verse', label: 'Verse 2' })
  assert.equal(relabelled.filter((s) => s.hotkey === 'A').length, 1)
})

test('hotkeys survive the SQLite section format, and plain sections stay plain', async () => {
  const { parseSectionLines, serializeSectionLines } = await import('../src/lib/lyrics-section-json')
  assert.equal(serializeSectionLines(['a', 'b']), '["a","b"]')
  const stored = serializeSectionLines(['a', 'b'], undefined, 'c')
  assert.deepEqual(parseSectionLines(stored), { lines: ['a', 'b'], lineColors: undefined, hotkey: 'C' })
  const colored = parseSectionLines(serializeSectionLines(['a'], ['#ff0000'], '2'))
  assert.deepEqual(colored, { lines: ['a'], lineColors: ['#ff0000'], hotkey: '2' })
  // Rows written before hotkeys existed read back unchanged.
  assert.deepEqual(parseSectionLines('["x"]'), { lines: ['x'] })
})

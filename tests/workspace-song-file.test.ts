import assert from 'node:assert/strict'
import test from 'node:test'

import type { LyricsSong } from '../src/lib/ipc'
import {
  isInsideFolder,
  isSongFileName,
  parseSongFile,
  serializeSongFile,
  slugifyTitle,
  songFileName,
  songIdFromFileName,
} from '../src/lib/workspace'

const SONG: LyricsSong = {
  id: 'song-1712-ab12',
  title: 'Way Maker',
  artist: 'Sinach',
  copyright: '\u00a9 2015 Integrity',
  ccliNumber: '7115744',
  isFavorite: true,
  source: 'genius',
  sections: [
    { type: 'verse', label: 'Verse 1', lines: ['You are here', 'Moving in our midst'] },
    { type: 'chorus', label: 'Chorus', lines: ['Way maker'], lineColors: ['#D4A017'] },
  ],
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
}

test('a song survives a write/read round trip', () => {
  const back = parseSongFile(serializeSongFile(SONG), 'ignored')
  assert.deepEqual(back, SONG)
})

test('the file name carries a readable title and the id', () => {
  const name = songFileName(SONG)
  assert.equal(name, 'Way-Maker__song-1712-ab12.song.json')
  assert.equal(songIdFromFileName(name), SONG.id)
  assert.equal(isSongFileName(name), true)
})

test('titles that are bad file names still produce one', () => {
  assert.equal(slugifyTitle('Oh Come / All Ye Faithful'), 'Oh-Come-All-Ye-Faithful')
  assert.equal(slugifyTitle('\u00c8s\u00e9 \u00e8s\u00e9'), 'Ese-ese')
  assert.equal(slugifyTitle('\u7956\u56fd'), 'song')
})

test('an id containing the separator still round trips', () => {
  const name = songFileName({ id: 'song_42__x', title: 'Grace' })
  assert.equal(name, 'Grace__song_42__x.song.json')
  assert.equal(songIdFromFileName(name), 'song_42__x')
})

test('non-song files in the folder are ignored', () => {
  assert.equal(isSongFileName('notes.txt'), false)
  assert.equal(isSongFileName('.DS_Store'), false)
  assert.equal(isSongFileName('.hidden.song.json'), false)
})

test('a hand-edited file missing fields still loads', () => {
  const raw = JSON.stringify({ title: 'Untitled Hymn', sections: [{ lines: ['One line'] }] })
  const song = parseSongFile(raw, 'song-from-name')
  assert.ok(song)
  assert.equal(song.id, 'song-from-name')
  assert.equal(song.title, 'Untitled Hymn')
  assert.equal(song.sections[0].type, 'verse')
  assert.equal(song.isFavorite, false)
})

test('a corrupt file, or unrelated JSON in the folder, is skipped', () => {
  assert.equal(parseSongFile('{ not json', 'id'), null)
  assert.equal(parseSongFile('[]', 'id'), null)
  assert.equal(parseSongFile('"a string"', 'id'), null)
  // Someone's playlist export sitting in Songs/ must not become a song.
  assert.equal(parseSongFile(JSON.stringify({ name: 'Sunday', items: [] }), 'id'), null)
})

test('a file with no usable id at all is rejected', () => {
  assert.equal(parseSongFile(JSON.stringify({ title: 'X', sections: [] }), ''), null)
})

test('line colors are dropped when every override is empty', () => {
  const plain: LyricsSong = {
    ...SONG,
    sections: [{ type: 'verse', label: 'Verse 1', lines: ['A'], lineColors: [null] }],
  }
  const back = parseSongFile(serializeSongFile(plain), 'x')
  assert.ok(back)
  assert.equal('lineColors' in back.sections[0], false)
})

test('isInsideFolder distinguishes nesting from a shared prefix', () => {
  assert.equal(isInsideFolder('/Users/a/Kairo Presenter/Songs', '/Users/a/Kairo Presenter'), true)
  assert.equal(isInsideFolder('/Users/a/Kairo Presenter', '/Users/a/Kairo Presenter'), true)
  assert.equal(isInsideFolder('/Users/a/Kairo Presenter 2', '/Users/a/Kairo Presenter'), false)
  assert.equal(isInsideFolder('/Users/a', '/Users/a/Kairo Presenter'), false)
  assert.equal(isInsideFolder('/Users/a/anything', ''), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { lyricsService } from '../src/main/services/lyrics'

// A folder of hand-made song files has no metadata block. The file name is the
// only title anyone wrote down, and a library of "Untitled" cannot be searched.

test('the file name titles a song file with no header', () => {
  const song = lyricsService.parseUSR('Gbemi fo\nMa mi\n', "Balogun N'ile.txt")
  assert.equal(song.title, "Balogun N'ile")
})

test('a header still wins over the file name', () => {
  const song = lyricsService.parseUSR('Title=Way Maker\nAuthor=Sinach\n\n[V1]\nYou are here\n', 'export.usr')
  assert.equal(song.title, 'Way Maker')
  assert.equal(song.artist, 'Sinach')
})

test('a colon header is read too, the way people actually type it', () => {
  const song = lyricsService.parseUSR('Title: Gbemi fo gbemi fo\n\nGbemi fo\nMa mi\n', 'Untitled 3.txt')
  assert.equal(song.title, 'Gbemi fo gbemi fo')
  // The header line must not survive into the lyrics.
  assert.deepEqual(song.sections[0].lines.slice(0, 2), ['Gbemi fo', 'Ma mi'])
})

test('a lyric line with a colon is sung, not read as metadata', () => {
  const song = lyricsService.parseUSR('Chorus: sing it loud\nAgain and again\n', 'Praise.txt')
  assert.equal(song.title, 'Praise')
  assert.equal(song.sections[0].lines[0], 'Chorus: sing it loud')
})

test('without a header or a file name it is Untitled, as before', () => {
  assert.equal(lyricsService.parseUSR('Gbemi fo\nMa mi\n').title, 'Untitled')
})

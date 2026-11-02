import assert from 'node:assert/strict'
import test from 'node:test'

import { isTrackExtension, siblingAudioFolder, trackFileName } from '../src/lib/tracks'

test('audio lives next to the backgrounds folder, not inside it', () => {
  assert.equal(
    siblingAudioFolder('/Users/codelawd/Documents/Kairo Presenter/Media'),
    '/Users/codelawd/Documents/Kairo Presenter/Audio',
  )
})

test('only house-audio extensions are accepted', () => {
  assert.equal(isTrackExtension('mp3'), true)
  assert.equal(isTrackExtension('.wav'), true)
  assert.equal(isTrackExtension('mp4'), false)
})

test('a renamed track keeps its extension and loses path characters', () => {
  assert.equal(trackFileName('  My Song  ', 'mp3'), 'My Song')
  // A pasted file name must not double the extension.
  assert.equal(trackFileName('My Song.MP3', 'mp3'), 'My Song')
  // Separators and the characters Windows forbids become spaces.
  assert.equal(trackFileName('a/b\\c:d*e?f"g<h>i|j', 'wav'), 'a b c d e f g h i j')
  // A trailing dot or space is illegal on Windows and invisible in Finder.
  assert.equal(trackFileName('Song.', 'mp3'), 'Song')
  assert.equal(trackFileName('Song   ', 'mp3'), 'Song')
  assert.equal(trackFileName('...', 'mp3'), '')
})

test('a renamed track is capped at 120 characters', () => {
  assert.equal(trackFileName('x'.repeat(300), 'mp3').length, 120)
})

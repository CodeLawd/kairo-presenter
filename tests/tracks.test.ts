import assert from 'node:assert/strict'
import test from 'node:test'

import { isTrackExtension, siblingAudioFolder } from '../src/lib/tracks'

test('audio lives next to the backgrounds folder, not inside it', () => {
  assert.equal(
    siblingAudioFolder('/Users/codelawd/Documents/ProAutomate/Media'),
    '/Users/codelawd/Documents/ProAutomate/Audio',
  )
})

test('only house-audio extensions are accepted', () => {
  assert.equal(isTrackExtension('mp3'), true)
  assert.equal(isTrackExtension('.wav'), true)
  assert.equal(isTrackExtension('mp4'), false)
})

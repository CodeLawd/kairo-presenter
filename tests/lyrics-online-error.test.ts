import assert from 'node:assert/strict'
import test from 'node:test'

import { extractLyricLines } from '../src/main/services/lyrics/normalize'
import { formatOnlineLyricsError } from '../src/lib/lyrics-online-error'

test('extractLyricLines skips section markers and blank lines', () => {
  const lines = extractLyricLines(`[Verse 1]\nHello world\n\n[Chorus]\nSing it out\n`)
  assert.deepEqual(lines, ['Hello world', 'Sing it out'])
})

test('extractLyricLines returns empty for header-only text', () => {
  assert.deepEqual(extractLyricLines('[Instrumental]\n[Interlude]\n'), [])
})

test('formatOnlineLyricsError strips Electron IPC wrapper', () => {
  const msg = formatOnlineLyricsError(
    new Error(
      "Error invoking remote method 'lyrics:previewOnline': Error: Lyrics were fetched but no sections could be parsed."
    )
  )
  assert.equal(msg, "This page didn't return usable lyrics.")
})

test('formatOnlineLyricsError maps empty-page errors', () => {
  assert.equal(
    formatOnlineLyricsError(new Error('No lyric text was found on this page.')),
    "This page didn't return usable lyrics."
  )
})

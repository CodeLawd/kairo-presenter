import test from 'node:test'
import assert from 'node:assert/strict'
import type { LyricsSong } from '../src/lib/ipc'
import type { LyricSlide } from '../src/lib/lyrics-slides'
import { buildLyricsLiveOutputPayload } from '../src/lib/live-output'

const song: LyricsSong = {
  id: 'song-1',
  title: 'Great Is Thy Faithfulness',
  artist: 'Hymn',
  sections: [],
  createdAt: 1,
  updatedAt: 1,
}

test('lyrics live payload names the song and exact slide text', () => {
  const slide: LyricSlide = {
    sectionLabel: 'Verse 1',
    lines: ['Great is Thy faithfulness', 'Morning by morning new mercies I see'],
  }

  assert.deepEqual(buildLyricsLiveOutputPayload(song, slide), {
    kind: 'lyrics',
    reference: 'Great Is Thy Faithfulness · Verse 1',
    text: 'Great is Thy faithfulness\nMorning by morning new mercies I see',
    lineColors: undefined,
  })
})

test('lyrics live payload keeps gloss colors', () => {
  const slide: LyricSlide = {
    sectionLabel: 'Chorus',
    lines: ['Aka Aka ya', '(The arm of the Lord)'],
    lineColors: [undefined, '#D4A017'],
  }
  const payload = buildLyricsLiveOutputPayload(song, slide)
  assert.deepEqual(payload.lineColors, [undefined, '#D4A017'])
})

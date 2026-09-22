import assert from 'node:assert/strict'
import test from 'node:test'

import type { LyricsSong } from '../src/lib/ipc'
import {
  containment,
  describeDuplicate,
  findDuplicate,
  songKey,
} from '../src/lib/lyrics-duplicate'

function song(over: Partial<LyricsSong> = {}): LyricsSong {
  return {
    id: 'song-1',
    title: 'Placeholder Song',
    artist: 'Placeholder Artist',
    sections: [
      {
        type: 'verse',
        label: 'Verse 1',
        lines: ['First line here', 'Second line here', 'Third line here', 'Fourth line here'],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

// A folder of hand-made song sheets carries the same song several times, saved
// under different names and re-typed with different punctuation.

test('the same title and artist is a duplicate whatever the casing', () => {
  const match = findDuplicate(song({ id: 'new', title: 'WAY MAKER', artist: 'sinach' }), [
    song({ id: 'old', title: 'Way Maker', artist: 'Sinach' }),
  ])
  assert.equal(match?.songId, 'old')
  assert.equal(match?.reason, 'title-artist')
})

test('a "(Live)" suffix or a featured credit does not make it a different song', () => {
  assert.equal(songKey('Way Maker (Live)', 'Sinach'), songKey('Way Maker', 'Sinach'))
  assert.equal(songKey('Way Maker', 'Sinach feat. Someone'), songKey('Way Maker', 'Sinach'))
})

test('the same lyrics under a different title are caught', () => {
  // The everyday case in a hand-made folder: one copy titled after the file,
  // the other after the first line.
  const lines = ['Ide mi ja', 'Halleluyah mo ti de Zion', 'Ide mi ma ja o', 'We call him Jehovah']
  const existing = song({ id: 'old', title: 'Ide mi ja', artist: '' })
  existing.sections = [{ type: 'verse', label: 'Verse 1', lines }]
  const incoming = song({ id: 'new', title: 'Untitled 4', artist: '' })
  incoming.sections = [{ type: 'verse', label: 'Verse 1', lines: [...lines, 'Iron breaker'] }]

  const match = findDuplicate(incoming, [existing])
  assert.equal(match?.songId, 'old')
  assert.equal(match?.reason, 'lyrics')
})

test('punctuation and diacritics do not hide a lyric match', () => {
  const a = song({ id: 'old', title: 'A', artist: '' })
  a.sections = [{ type: 'verse', label: 'Verse 1', lines: ['Ese! Ese! Ese o', 'Modupe o', 'Baba mi', 'Olorun mi'] }]
  const b = song({ id: 'new', title: 'B', artist: '' })
  b.sections = [{ type: 'verse', label: 'Verse 1', lines: ['Èsé, èsé, èsé o', 'Modupe o', 'Baba mi', 'Olorun mi'] }]
  assert.equal(findDuplicate(b, [a])?.reason, 'lyrics')
})

test('a CCLI number settles it before anything else is considered', () => {
  const match = findDuplicate(
    song({ id: 'new', title: 'Completely Different Name', artist: 'Someone Else', ccliNumber: '7115744' }),
    [song({ id: 'old', ccliNumber: '7115744' })],
  )
  assert.equal(match?.reason, 'ccli')
})

test('two different songs are not duplicates', () => {
  const other = song({ id: 'old', title: 'Another Song', artist: 'Another Artist' })
  other.sections = [{ type: 'verse', label: 'Verse 1', lines: ['Nothing', 'In', 'Common', 'Here'] }]
  assert.equal(findDuplicate(song({ id: 'new', title: 'Way Maker', artist: 'Sinach' }), [other]), null)
})

test('a short chorus is matched on title only, never on its handful of lines', () => {
  // Two-line choruses share lines with half the library; matching on them
  // would collapse songs that merely repeat "Hallelujah".
  const a = song({ id: 'old', title: 'Chorus A', artist: '' })
  a.sections = [{ type: 'chorus', label: 'Chorus', lines: ['Hallelujah', 'Amen'] }]
  const b = song({ id: 'new', title: 'Chorus B', artist: '' })
  b.sections = [{ type: 'chorus', label: 'Chorus', lines: ['Hallelujah', 'Amen'] }]
  assert.equal(findDuplicate(b, [a]), null)
})

test('an empty library has no duplicates in it', () => {
  assert.equal(findDuplicate(song(), []), null)
})

test('containment measures the smaller set against the larger', () => {
  assert.equal(containment(new Set(['a', 'b']), new Set(['a', 'b', 'c', 'd'])), 1)
  assert.equal(containment(new Set(['a', 'x']), new Set(['a', 'b'])), 0.5)
  assert.equal(containment(new Set(), new Set(['a'])), 0)
})

test('the badge says which signal matched', () => {
  assert.match(
    describeDuplicate({ songId: 'x', title: 'Way Maker', artist: 'Sinach', reason: 'lyrics' }),
    /Same lyrics as "Way Maker" by Sinach/,
  )
  assert.match(
    describeDuplicate({ songId: 'x', title: 'Ide mi ja', artist: '', reason: 'title-artist' }),
    /Same title and artist as "Ide mi ja"$/,
  )
})

test('two songs both called "Untitled" are not the same song', () => {
  // A file with no heading and a generic name parses to a placeholder title.
  // Matching on it would collapse every untitled sheet in the folder into one.
  const a = song({ id: 'old', title: 'Untitled', artist: '' })
  a.sections = [{ type: 'verse', label: 'Verse 1', lines: ['One', 'Two', 'Three', 'Four'] }]
  const b = song({ id: 'new', title: 'Untitled 3', artist: '' })
  b.sections = [{ type: 'verse', label: 'Verse 1', lines: ['Five', 'Six', 'Seven', 'Eight'] }]
  assert.equal(findDuplicate(b, [a]), null)
})

test('placeholder titles still match on their lyrics', () => {
  const lines = ['One line', 'Two line', 'Three line', 'Four line']
  const a = song({ id: 'old', title: 'Untitled', artist: '' })
  a.sections = [{ type: 'verse', label: 'Verse 1', lines }]
  const b = song({ id: 'new', title: 'Untitled 3', artist: '' })
  b.sections = [{ type: 'verse', label: 'Verse 1', lines }]
  assert.equal(findDuplicate(b, [a])?.reason, 'lyrics')
})

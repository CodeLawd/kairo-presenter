import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isNewSongUse,
  normalizeSongUsageEntries,
  SONG_USAGE_DEDUPE_MS,
  songUsageBetween,
  songUsageCsv,
  summarizeSongUsage,
  type SongUsageEntry,
} from '../src/lib/song-usage'

const entry = (songId: string, at: number, extra: Partial<SongUsageEntry> = {}): SongUsageEntry => ({
  songId,
  title: songId.toUpperCase(),
  artist: '',
  ccliNumber: '',
  copyright: '',
  at,
  ...extra,
})

test('a song pushed again in the same service is not a second use', () => {
  const entries = [entry('a', 1000)]
  assert.equal(isNewSongUse(entries, 'a', 1000 + SONG_USAGE_DEDUPE_MS - 1), false)
  assert.equal(isNewSongUse(entries, 'a', 1000 + SONG_USAGE_DEDUPE_MS), true)
  assert.equal(isNewSongUse(entries, 'b', 1001), true)
})

test('the date filter is half-open and sorted', () => {
  const entries = [entry('b', 30), entry('a', 10), entry('c', 50)]
  assert.deepEqual(songUsageBetween(entries, 10, 50).map((e) => e.songId), ['a', 'b'])
})

test('the summary counts uses and keeps the newest CCLI number', () => {
  const rows = summarizeSongUsage([
    entry('a', 1),
    entry('b', 2),
    entry('a', 3, { ccliNumber: '12345' }),
  ])
  assert.equal(rows[0].songId, 'a')
  assert.equal(rows[0].uses, 2)
  assert.equal(rows[0].ccliNumber, '12345')
})

test('CSV quotes commas and neutralises spreadsheet formulas', () => {
  const csv = songUsageCsv([entry('a', Date.UTC(2026, 8, 27, 12), { title: 'Holy, Holy', artist: '=HYPERLINK("x")' })])
  const [header, row] = csv.trim().split('\r\n')
  assert.equal(header, 'Date,Title,Artist,CCLI Song #,Copyright')
  assert.ok(row.includes('"Holy, Holy"'))
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`))
})

test('stored entries that are not usage records are dropped', () => {
  const entries = normalizeSongUsageEntries([entry('a', 1), { songId: 5 }, null, { songId: 'b', at: 'x' }])
  assert.equal(entries.length, 1)
})

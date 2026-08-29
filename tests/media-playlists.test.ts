import assert from 'node:assert/strict'
import test from 'node:test'

import { repairPlaylistItemIds } from '../src/main/services/media'
import type { MediaPlaylist } from '../src/lib/ipc'

function playlist(itemIds: string[]): MediaPlaylist {
  return { id: 'pl-1', name: 'Sunday set', itemIds, createdAt: 1 }
}

test('entries that still resolve are left alone', () => {
  const { playlists, healed } = repairPlaylistItemIds(
    [playlist(['Motion/loop.mp4', 'Stills/warm.png'])],
    ['Motion/loop.mp4', 'Stills/warm.png'],
  )

  assert.equal(healed, 0)
  assert.deepEqual(playlists[0].itemIds, ['Motion/loop.mp4', 'Stills/warm.png'])
})

test('a file moved to another folder is re-pointed', () => {
  const { playlists, healed } = repairPlaylistItemIds(
    [playlist(['Motion/loop.mp4'])],
    ['Stills/loop.mp4'],
  )

  assert.equal(healed, 1)
  assert.deepEqual(playlists[0].itemIds, ['Stills/loop.mp4'])
})

test('an ambiguous basename is never guessed', () => {
  // Two candidates means picking one would be a coin flip that silently changes
  // what goes on screen — better to report it missing.
  const { playlists, healed } = repairPlaylistItemIds(
    [playlist(['Motion/loop.mp4'])],
    ['Stills/loop.mp4', 'Christmas/loop.mp4'],
  )

  assert.equal(healed, 0)
  assert.deepEqual(playlists[0].itemIds, ['Motion/loop.mp4'])
})

test('a genuinely missing entry is kept, not dropped', () => {
  const { playlists, healed } = repairPlaylistItemIds(
    [playlist(['Motion/gone.mp4', 'Stills/warm.png'])],
    ['Stills/warm.png'],
  )

  assert.equal(healed, 0)
  // Kept so the dock can say "1 item is no longer in the folder".
  assert.deepEqual(playlists[0].itemIds, ['Motion/gone.mp4', 'Stills/warm.png'])
})

test('a renamed file is reported missing rather than re-pointed', () => {
  // The basename changed too, so there is nothing to match on.
  const { playlists, healed } = repairPlaylistItemIds(
    [playlist(['Motion/loop.mp4'])],
    ['Motion/loop-v2.mp4'],
  )

  assert.equal(healed, 0)
  assert.deepEqual(playlists[0].itemIds, ['Motion/loop.mp4'])
})

test('repair is idempotent — a healed manifest does not heal again', () => {
  const known = ['Stills/loop.mp4']
  const first = repairPlaylistItemIds([playlist(['Motion/loop.mp4'])], known)
  const second = repairPlaylistItemIds(first.playlists, known)

  assert.equal(first.healed, 1)
  assert.equal(second.healed, 0)
})

test('multiple playlists are repaired independently', () => {
  const { playlists, healed } = repairPlaylistItemIds(
    [
      { id: 'a', name: 'A', itemIds: ['Motion/loop.mp4'], createdAt: 1 },
      { id: 'b', name: 'B', itemIds: ['Motion/loop.mp4', 'gone.png'], createdAt: 1 },
    ],
    ['Stills/loop.mp4'],
  )

  assert.equal(healed, 2)
  assert.deepEqual(playlists[0].itemIds, ['Stills/loop.mp4'])
  assert.deepEqual(playlists[1].itemIds, ['Stills/loop.mp4', 'gone.png'])
})

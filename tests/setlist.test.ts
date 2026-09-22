import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETLIST_NAME,
  migrateSetlistState,
  normalizeSetlistName,
  prunedSetlist,
  SETLIST_MAX,
  withoutSong,
  withSong,
} from '../src/lib/setlist'

test('songs append in the order they are added', () => {
  let list: string[] = []
  list = withSong(list, 'a')
  list = withSong(list, 'b')
  list = withSong(list, 'c')
  assert.deepEqual(list, ['a', 'b', 'c'])
})

test('a song dropped at an index lands there and shifts the rest', () => {
  assert.deepEqual(withSong(['a', 'b', 'c'], 'd', 1), ['a', 'd', 'b', 'c'])
  assert.deepEqual(withSong(['a', 'b', 'c'], 'd', 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(withSong(['a', 'b', 'c'], 'd', 99), ['a', 'b', 'c', 'd'])
})

test('re-adding a listed song moves it instead of duplicating it', () => {
  assert.deepEqual(withSong(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b'])
  assert.deepEqual(withSong(['a', 'b', 'c'], 'a'), ['b', 'c', 'a'])
})

test('the cap only blocks growth, never an existing reorder', () => {
  const full = Array.from({ length: SETLIST_MAX }, (_, index) => `song-${index}`)
  assert.equal(withSong(full, 'one-more').length, SETLIST_MAX)
  assert.equal(withSong(full, 'song-5', 0)[0], 'song-5')
})

test('removal and pruning keep the surviving order', () => {
  assert.deepEqual(withoutSong(['a', 'b', 'c'], 'b'), ['a', 'c'])
  assert.deepEqual(prunedSetlist(['a', 'gone', 'c'], ['c', 'a']), ['a', 'c'])
})

test('setlist names are cleaned and never empty', () => {
  assert.equal(normalizeSetlistName('  Youth   night \n'), 'Youth night')
  assert.equal(normalizeSetlistName(''), DEFAULT_SETLIST_NAME)
  assert.equal(normalizeSetlistName('x'.repeat(200)).length, 80)
  assert.equal(normalizeSetlistName('', 'Carry over'), 'Carry over')
})

test('a store written before setlists had names keeps its songs', () => {
  const migrated = migrateSetlistState({ songIds: ['a', 'b'], updatedAt: 7 })
  assert.equal(migrated.lists.length, 1)
  assert.deepEqual(migrated.lists[0].songIds, ['a', 'b'])
  assert.equal(migrated.lists[0].name, DEFAULT_SETLIST_NAME)
  assert.equal(migrated.activeId, migrated.lists[0].id)
})

test('an unknown active id falls back to the first list, and an empty store stays empty', () => {
  const state = migrateSetlistState({
    lists: [{ id: 'one', name: 'Morning', songIds: ['a'], createdAt: 1, updatedAt: 1 }],
    activeId: 'deleted',
  })
  assert.equal(state.activeId, 'one')
  assert.deepEqual(migrateSetlistState(undefined), { lists: [], activeId: null })
  assert.deepEqual(migrateSetlistState({ songIds: [] }), { lists: [], activeId: null })
})

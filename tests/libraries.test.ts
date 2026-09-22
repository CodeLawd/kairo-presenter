import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LIBRARY_ID,
  emptyLibraryState,
  itemsInLibrary,
  libraryCounts,
  libraryOf,
  normalizeLibraryName,
  normalizeLibraryState,
  withAssignment,
  withoutItem,
  withoutLibrary,
  type LibraryState,
} from '../src/lib/libraries'

const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const state = (): LibraryState => ({
  libraries: [
    { id: 'l1', name: 'Christmas', createdAt: 1, updatedAt: 1 },
    { id: 'l2', name: 'Youth', createdAt: 2, updatedAt: 2 },
  ],
  assignments: { a: 'l1', b: 'l2' },
})

test('an unassigned item belongs to the default library', () => {
  assert.equal(libraryOf(state(), 'c'), DEFAULT_LIBRARY_ID)
  assert.equal(libraryOf(state(), 'a'), 'l1')
  assert.equal(libraryOf(emptyLibraryState(), 'anything'), DEFAULT_LIBRARY_ID)
})

test('the default library shows everything; a named one shows only its own', () => {
  assert.deepEqual(itemsInLibrary(state(), songs, DEFAULT_LIBRARY_ID), songs)
  assert.deepEqual(itemsInLibrary(state(), songs, 'l1').map((s) => s.id), ['a'])
  assert.deepEqual(itemsInLibrary(state(), songs, 'empty'), [])
})

test('counts cover every library, including empty ones', () => {
  assert.deepEqual(libraryCounts(state(), songs), { [DEFAULT_LIBRARY_ID]: 3, l1: 1, l2: 1 })
})

test('assigning moves an item, and assigning to the default clears the entry', () => {
  const moved = withAssignment(state(), ['c'], 'l1')
  assert.deepEqual(itemsInLibrary(moved, songs, 'l1').map((s) => s.id), ['a', 'c'])
  const home = withAssignment(moved, ['a', 'c'], DEFAULT_LIBRARY_ID)
  assert.deepEqual(home.assignments, { b: 'l2' })
})

test('deleting a library returns its items to the default, never deleting them', () => {
  const after = withoutLibrary(state(), 'l1')
  assert.deepEqual(after.libraries.map((l) => l.id), ['l2'])
  assert.equal(libraryOf(after, 'a'), DEFAULT_LIBRARY_ID)
  assert.deepEqual(itemsInLibrary(after, songs, DEFAULT_LIBRARY_ID), songs)
})

test('a deleted item leaves no assignment behind', () => {
  assert.deepEqual(withoutItem(state(), 'a').assignments, { b: 'l2' })
  assert.deepEqual(withoutItem(state(), 'unknown').assignments, state().assignments)
})

test('stored state is repaired on read', () => {
  const repaired = normalizeLibraryState({
    libraries: [
      { id: 'l1', name: '  Christmas   Eve ', createdAt: 1, updatedAt: 1 },
      { id: DEFAULT_LIBRARY_ID, name: 'Impostor', createdAt: 1, updatedAt: 1 },
      { name: 'No id' },
    ],
    assignments: { a: 'l1', b: 'deleted-library' },
  })
  assert.deepEqual(repaired.libraries.map((l) => l.name), ['Christmas Eve'])
  assert.deepEqual(repaired.assignments, { a: 'l1' })
  assert.deepEqual(normalizeLibraryState(undefined), emptyLibraryState())
})

test('library names are cleaned and never empty', () => {
  assert.equal(normalizeLibraryName('  Carols  2026 '), 'Carols 2026')
  assert.equal(normalizeLibraryName(''), 'New library')
  assert.equal(normalizeLibraryName('x'.repeat(200)).length, 80)
})

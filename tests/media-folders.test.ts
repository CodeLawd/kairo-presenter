import assert from 'node:assert/strict'
import test from 'node:test'

import { listMediaFolders } from '../src/main/services/media'

test('an empty subfolder is still listed', () => {
  const folders = listMediaFolders('Backgrounds', ['Motion', 'Stills'], new Map())

  assert.deepEqual(
    folders.map((folder) => ({ id: folder.id, count: folder.count })),
    [
      { id: 'Motion', count: 0 },
      { id: 'Stills', count: 0 },
    ],
  )
})

test('file counts attach to the matching shelf', () => {
  const folders = listMediaFolders(
    'Backgrounds',
    ['Motion', 'Stills'],
    new Map([
      ['', 2],
      ['Motion', 4],
    ]),
  )

  assert.equal(folders[0]?.id, '')
  assert.equal(folders[0]?.name, 'Backgrounds')
  assert.equal(folders[0]?.count, 2)
  assert.equal(folders.find((folder) => folder.id === 'Motion')?.count, 4)
  assert.equal(folders.find((folder) => folder.id === 'Stills')?.count, 0)
})

test('a folder that only exists as a file count is still listed', () => {
  // Scan used to build folders from file counts alone — keep that path working
  // for the root, which is never in `subdirectoryNames`.
  const folders = listMediaFolders('Backgrounds', [], new Map([['', 3]]))

  assert.deepEqual(folders, [{ id: '', name: 'Backgrounds', count: 3 }])
})

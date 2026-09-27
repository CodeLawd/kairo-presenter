import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DOCUMENTS, documentsErrorMessage, normalizeDocumentName, POWERPOINT_NEEDS_CONVERTER } from '../src/lib/documents'
import { IMPORT_OPTIONS, isImportKind } from '../src/lib/import-menu'

const ROOT = path.resolve(__dirname, '..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('import kinds are the document, media, sermon, lyrics and .kairo pickers', () => {
  assert.deepEqual(IMPORT_OPTIONS.map((option) => option.kind), [
    'pdf',
    'powerpoint',
    'image',
    'video',
    'audio',
    'sermon',
    'lyrics',
    'kairo',
  ])
  assert.equal(isImportKind('pdf'), true)
  assert.equal(isImportKind('document'), false)
})

test('File > Import is built from IMPORT_OPTIONS', () => {
  const main = read('src/main/index.ts')
  assert.match(main, /label: 'File'/)
  assert.match(main, /label: 'Import'/)
  assert.match(main, /submenu: importMenuTemplate\(\)/)
  assert.match(main, /IMPORT_OPTIONS/)
  assert.match(main, /requestMenuImport\(option\.kind\)/)
})

test('the renderer routes a menu import to the matching workspace', () => {
  const app = read('src/renderer/src/App.tsx')
  assert.match(app, /window\.api\.app\.onImportRequested/)
  assert.match(app, /setRoute\(option\.route\)/)
  assert.match(app, /requestImport\(kind\)/)
})

test('documents list is registered on the same channel the page invokes', () => {
  assert.equal(DOCUMENTS.LIST, 'documents:list')
  assert.equal(DOCUMENTS.CAPABILITIES, 'documents:capabilities')
  const handlers = read('src/main/ipc/index.ts')
  assert.match(handlers, /registerDocumentHandlers\(\)/)
  assert.match(handlers, /DOCUMENTS\.LIST/)
  assert.match(handlers, /DOCUMENTS\.CAPABILITIES/)
  assert.match(read('src/preload/index.ts'), /list: \(\) => ipcRenderer\.invoke\(DOCUMENTS\.LIST\)/)
  assert.match(read('src/preload/index.ts'), /capabilities: \(\) => ipcRenderer\.invoke\(DOCUMENTS\.CAPABILITIES\)/)
  assert.match(read('src/renderer/src/components/documents/Documents.tsx'), /window\.api\.documents\.list\(\)/)
  assert.match(read('src/renderer/src/components/documents/Documents.tsx'), />\s*Import\s*</)
})

test('document errors drop Electron\'s invoke wrapper', () => {
  assert.equal(
    documentsErrorMessage(new Error("Error invoking remote method 'documents:prepare': Error: " + POWERPOINT_NEEDS_CONVERTER)),
    POWERPOINT_NEEDS_CONVERTER,
  )
})

test('document rename is validated and wired through IPC', () => {
  const channels = DOCUMENTS
  assert.equal(normalizeDocumentName('  Sunday slides  '), 'Sunday slides')
  assert.throws(() => normalizeDocumentName('   '), /Enter a name/)
  assert.throws(() => normalizeDocumentName('a/b'), /slashes/)
  assert.equal(channels.RENAME, 'documents:rename')
  assert.match(read('src/main/ipc/index.ts'), /DOCUMENTS\.RENAME/)
  assert.match(read('src/preload/index.ts'), /rename: \(id, name\) => ipcRenderer\.invoke\(DOCUMENTS\.RENAME/)
  assert.match(read('src/renderer/src/components/documents/Documents.tsx'), /onContextMenu/)
  assert.match(read('src/renderer/src/components/documents/Documents.tsx'), /Rename/)
  assert.match(read('src/renderer/src/components/documents/Documents.tsx'), /onClick=\{\(\) => void push\(index\)\}/)
})

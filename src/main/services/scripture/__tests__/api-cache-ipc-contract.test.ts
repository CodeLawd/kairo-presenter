import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { IPC } from '../../../../lib/ipc'

const ROOT = path.resolve(__dirname, '../../../../..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const OPERATIONS = [
  ['LIST_OFFLINE_TRANSLATIONS', 'listOfflineTranslations'],
  ['DOWNLOAD_TRANSLATION', 'downloadTranslation'],
  ['PAUSE_TRANSLATION_DOWNLOAD', 'pauseTranslationDownload'],
  ['REFRESH_OFFLINE_TRANSLATION', 'refreshOfflineTranslation'],
  ['REMOVE_OFFLINE_TRANSLATION', 'removeOfflineTranslation'],
  ['OFFLINE_DOWNLOAD_PROGRESS', 'onOfflineDownloadProgress'],
] as const

test('every offline-cache operation has an IPC channel', () => {
  for (const [constant] of OPERATIONS) {
    const channel = (IPC.SCRIPTURE as Record<string, string>)[constant]
    assert.ok(channel, `IPC.SCRIPTURE.${constant} is missing`)
    assert.match(channel, /^scripture:/)
  }
})

test('ScriptureAPI declares every offline-cache operation', () => {
  const source = read('src/lib/ipc.ts')
  const api = source.slice(source.indexOf('export interface ScriptureAPI'))
  for (const [, method] of OPERATIONS) {
    assert.ok(api.includes(`${method}:`), `ScriptureAPI.${method} is missing`)
  }
  assert.match(api, /onOfflineDownloadProgress: \(callback: \(value: ApiBibleDownloadProgress\) => void\) => Unsubscribe/)
})

test('the preload bridges every offline-cache operation', () => {
  const preload = read('src/preload/index.ts')
  for (const [constant] of OPERATIONS) {
    assert.ok(preload.includes(`IPC.SCRIPTURE.${constant}`), `preload does not use ${constant}`)
  }
})

test('the main process handles every offline-cache invoke channel', () => {
  const handlers = read('src/main/ipc/index.ts')
  for (const [constant] of OPERATIONS.filter(([c]) => c !== 'OFFLINE_DOWNLOAD_PROGRESS')) {
    assert.ok(handlers.includes(`IPC.SCRIPTURE.${constant}`), `no handler for ${constant}`)
  }
})

test('progress is pushed from main rather than polled by the renderer', () => {
  const preload = read('src/preload/index.ts')
  assert.match(preload, /subscribe<ApiBibleDownloadProgress>\(IPC\.SCRIPTURE\.OFFLINE_DOWNLOAD_PROGRESS/)
  assert.ok(read('src/main/ipc/index.ts').includes('broadcast(IPC.SCRIPTURE.OFFLINE_DOWNLOAD_PROGRESS'))
})

test('the preload never exposes cache internals to the renderer', () => {
  const preload = read('src/preload/index.ts')
  for (const forbidden of ['api-bible-cache.db', 'api-bible-cache.key', 'safeStorage', 'ApiBibleCache', 'bibleApiKey']) {
    assert.ok(!preload.includes(forbidden), `preload leaks ${forbidden}`)
  }
})

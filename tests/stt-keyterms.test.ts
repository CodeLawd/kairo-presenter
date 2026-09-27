import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import log from 'electron-log/main'
log.transports.file.level = false
log.transports.console.level = false

import { DeepgramSTTService } from '../src/main/services/stt/deepgram'
import { MAX_KEYTERMS, scriptureKeyterms } from '../src/main/services/stt/keyterms'

test('boosts hard book names for English transcription', () => {
  const terms = scriptureKeyterms('en-US')
  for (const name of ['Habakkuk', 'Philippians', 'Ecclesiastes', 'Thessalonians']) {
    assert.ok(terms.includes(name), `${name} should be boosted`)
  }
  assert.ok(terms.length <= MAX_KEYTERMS)
  assert.deepEqual(scriptureKeyterms('en'), terms)
})

test('puts live playlist books first, by name, without duplicates', () => {
  const terms = scriptureKeyterms('en-GB', ['John', '1 Corinthians', 'Habakkuk', 'John'])
  assert.deepEqual(terms.slice(0, 3), ['John', 'Corinthians', 'Habakkuk'])
  assert.equal(terms.filter((term) => term === 'Corinthians').length, 1)
  assert.equal(terms.filter((term) => term === 'Habakkuk').length, 1)
})

test('stays within the recommended keyterm count however large the playlist', () => {
  const playlist = Array.from({ length: 80 }, (_, i) => `Book${i}`)
  assert.equal(scriptureKeyterms('en-US', playlist).length, MAX_KEYTERMS)
})

test('other transcription languages get no English book names', () => {
  assert.deepEqual(scriptureKeyterms('fr'), [])
  assert.deepEqual(scriptureKeyterms('es-419', ['Romans']), [])
  assert.deepEqual(scriptureKeyterms('multi'), [])
})

test('Deepgram receives keyterms as query params, and only when there are some', async () => {
  const calls: Array<Record<string, unknown>> = []
  const socket = {
    readyState: 1, on() {}, connect() {}, close() {},
    sendCloseStream() {}, sendKeepAlive() {}, sendMedia() {},
  }
  const client = { listen: { v1: { connect: async (args: Record<string, unknown>) => { calls.push(args); return socket } } } }
  const service = new DeepgramSTTService()
  // configure() builds a real client; swap in the recorder after each call.
  const configure = (language: string, keyterms: string[]): void => {
    service.configure('test', language, keyterms)
    Object.assign(service, { client })
  }
  try {
    configure('en-US', ['Habakkuk', 'Song of Solomon'])
    await service.connect()
    service.disconnect()

    configure('fr', [])
    await service.connect()
  } finally { service.disconnect() }

  assert.equal(calls[0].keyterm, undefined, 'the typed field would JSON-encode the array')
  assert.deepEqual(calls[0].queryParams, { no_delay: true, keyterm: ['Habakkuk', 'Song of Solomon'] })
  assert.deepEqual(calls[1].queryParams, { no_delay: true })
})

test('the SDK sends one keyterm parameter per term', () => {
  // Deepgram silently ignores a JSON array; this guards an SDK upgrade changing
  // how queryParams arrays are encoded. Absolute path: qs is not a public export.
  const require = createRequire(import.meta.url)
  const { toQueryString } = require(resolve('node_modules/@deepgram/sdk/dist/cjs/core/url/qs.js')) as {
    toQueryString: (params: Record<string, unknown>, options: { arrayFormat: string }) => string
  }
  const query = toQueryString({ keyterm: ['Habakkuk', 'Song of Solomon'] }, { arrayFormat: 'repeat' })
  assert.equal(query, 'keyterm=Habakkuk&keyterm=Song%20of%20Solomon')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SecureStore, type KeyProtector } from '../secure-store'

/** Stands in for the OS keychain — reversible, and inspectable by the test. */
function fakeProtector(available = true): KeyProtector {
  return {
    isAvailable: () => available,
    protect: (key) => Buffer.concat([Buffer.from('WRAPPED:'), key]),
    unprotect: (blob) => blob.subarray('WRAPPED:'.length),
  }
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pa-secure-'))
}

test('a stored credential round-trips', () => {
  const dir = tempDir()
  const store = new SecureStore(dir, fakeProtector())

  assert.equal(store.write('token', 'refresh-token-value'), true)
  assert.equal(store.read('token'), 'refresh-token-value')
})

test('the token is never written to disk in the clear', () => {
  const dir = tempDir()
  new SecureStore(dir, fakeProtector()).write('token', 'super-secret-refresh-token')

  for (const file of fs.readdirSync(dir)) {
    const contents = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.equal(
      contents.includes('super-secret-refresh-token'),
      false,
      `${file} contains the plaintext token`,
    )
  }
})

test('with no OS encryption it degrades instead of throwing', () => {
  const dir = tempDir()
  const store = new SecureStore(dir, fakeProtector(false))

  // Fail OPEN: a machine without a keychain still runs, it just cannot remember
  // the sign-in. Refusing to launch would take a church off the air.
  assert.equal(store.available, false)
  assert.equal(store.write('token', 'value'), false)
  assert.equal(store.read('token'), null)
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('a missing credential reads as null, not an error', () => {
  assert.equal(new SecureStore(tempDir(), fakeProtector()).read('token'), null)
})

test('a tampered blob is discarded rather than crashing the app', () => {
  const dir = tempDir()
  const store = new SecureStore(dir, fakeProtector())
  store.write('token', 'value')

  const file = path.join(dir, 'token.enc')
  const blob = JSON.parse(fs.readFileSync(file, 'utf8'))
  blob.ciphertext = Buffer.from('tampered').toString('base64')
  fs.writeFileSync(file, JSON.stringify(blob))

  assert.equal(store.read('token'), null)
  // And the unusable file is cleaned up, so it cannot fail again next launch.
  assert.equal(fs.existsSync(file), false)
})

test('clearing removes the credential', () => {
  const dir = tempDir()
  const store = new SecureStore(dir, fakeProtector())
  store.write('token', 'value')
  store.clear('token')
  assert.equal(store.read('token'), null)
})

test('a second store instance can read what the first wrote', () => {
  const dir = tempDir()
  new SecureStore(dir, fakeProtector()).write('token', 'persisted')
  // Restarting the app must not lose the sign-in.
  assert.equal(new SecureStore(dir, fakeProtector()).read('token'), 'persisted')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiCacheCrypto } from '../api-cache-crypto'

const KEY = Buffer.alloc(32, 7)

test('encrypts and decrypts verse text', () => {
  const crypto = ApiCacheCrypto.forTesting(KEY)
  const encrypted = crypto.encrypt('For God so loved the world')
  assert.notEqual(encrypted.ciphertext, 'For God so loved the world')
  assert.equal(crypto.decrypt(encrypted), 'For God so loved the world')
})

test('never stores plaintext in any serialized field', () => {
  const crypto = ApiCacheCrypto.forTesting(KEY)
  const encrypted = crypto.encrypt('Scripture text')
  const serialized = `${encrypted.ciphertext}${encrypted.iv}${encrypted.authTag}`
  assert.ok(!Buffer.from(serialized, 'utf8').includes('Scripture text'))
  assert.ok(!Buffer.from(encrypted.ciphertext, 'base64').toString('utf8').includes('Scripture'))
})

test('uses a unique IV per encryption', () => {
  const crypto = ApiCacheCrypto.forTesting(KEY)
  const a = crypto.encrypt('same text')
  const b = crypto.encrypt('same text')
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.ciphertext, b.ciphertext)
})

test('rejects modified ciphertext', () => {
  const crypto = ApiCacheCrypto.forTesting(KEY)
  const encrypted = crypto.encrypt('Scripture')
  assert.throws(() => crypto.decrypt({ ...encrypted, ciphertext: `${encrypted.ciphertext}AA` }))
})

test('rejects a mismatched auth tag', () => {
  const crypto = ApiCacheCrypto.forTesting(KEY)
  const encrypted = crypto.encrypt('Scripture')
  const tag = Buffer.from(encrypted.authTag, 'base64')
  tag[0] ^= 0xff
  assert.throws(() => crypto.decrypt({ ...encrypted, authTag: tag.toString('base64') }))
})

test('rejects a key from a different cache', () => {
  const encrypted = ApiCacheCrypto.forTesting(KEY).encrypt('Scripture')
  const other = ApiCacheCrypto.forTesting(Buffer.alloc(32, 9))
  assert.throws(() => other.decrypt(encrypted))
})

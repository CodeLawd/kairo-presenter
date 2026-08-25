import test from 'node:test'
import assert from 'node:assert/strict'
import { ScriptureService } from '../index'
import { ApiBibleClient, type ApiBibleTransport } from '../api-bible-client'

/** Each key is authorized for a different set of Bibles. */
function clientFor(apiKey: string): ApiBibleClient {
  const catalogs: Record<string, Array<{ id: string; abbreviationLocal: string }>> = {
    'key-one': [
      { id: 'nkjv-under-key-one', abbreviationLocal: 'NKJV' },
      { id: 'nlt-under-key-one', abbreviationLocal: 'NLT' },
    ],
    'key-two': [{ id: 'nlt-under-key-two', abbreviationLocal: 'NLT' }],
  }
  const transport: ApiBibleTransport = {
    async get() {
      return { data: { data: catalogs[apiKey] ?? [] } }
    },
  }
  return new ApiBibleClient(apiKey, transport)
}

function service(): ScriptureService {
  const instance = new ScriptureService()
  instance.setClientFactoryForTesting(clientFor)
  return instance
}

test('a Bible id from the previous key is not reused after the key changes', async () => {
  const scripture = service()
  assert.equal(await scripture.resolveBibleId('NLT', 'key-one'), 'nlt-under-key-one')

  assert.equal(await scripture.resolveBibleId('NLT', 'key-two'), 'nlt-under-key-two')
})

test('a translation the new key cannot reach is rejected rather than resolved from the old list', async () => {
  const scripture = service()
  await scripture.resolveBibleId('NKJV', 'key-one')

  await assert.rejects(() => scripture.resolveBibleId('NKJV', 'key-two'), {
    message: 'NKJV is not authorized for this API.Bible key.',
  })
})

test('authorization checks do not accept ids left over from the previous key', async () => {
  const scripture = service()
  await scripture.resolveBibleId('NKJV', 'key-one')
  assert.equal(scripture.isAuthorizedBibleId('nkjv-under-key-one'), true)

  await assert.rejects(() => scripture.ensureAuthorizedBibleId('nkjv-under-key-one', 'key-two'), {
    message: 'That Bible is not authorized for this API.Bible key.',
  })
  assert.equal(scripture.isAuthorizedBibleId('nkjv-under-key-one'), false)
})

test('translations authorized under the current key still resolve without a reload', async () => {
  const scripture = service()
  await scripture.resolveBibleId('NLT', 'key-one')
  assert.equal(scripture.isAuthorizedBibleId('nlt-under-key-one'), true)
  assert.equal(await scripture.resolveBibleId('NLT', 'key-one'), 'nlt-under-key-one')
})

test('an empty key clears everything the previous key authorized', async () => {
  const scripture = service()
  await scripture.resolveBibleId('NKJV', 'key-one')

  await assert.rejects(() => scripture.resolveBibleId('NKJV', ''))
  assert.equal(scripture.isAuthorizedBibleId('nkjv-under-key-one'), false)
})

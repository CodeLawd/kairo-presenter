import test from 'node:test'
import assert from 'node:assert/strict'
import { ScriptureService } from '../index'
import { ApiBibleClient, type ApiBibleTransport } from '../api-bible-client'

/** Each key is authorized for a different set of Bibles. */
function clientFor(apiKey: string): ApiBibleClient {
  const catalogs: Record<string, Array<{ id: string; abbreviationLocal: string; name?: string }>> = {
    'key-one': [
      { id: 'nkjv-under-key-one', abbreviationLocal: 'NKJV' },
      { id: 'nlt-under-key-one', abbreviationLocal: 'NLT' },
    ],
    'key-two': [{ id: 'nlt-under-key-two', abbreviationLocal: 'NLT' }],
    'key-mixed': [
      { id: 'kjv-bundled-text', abbreviationLocal: 'KJV', name: 'King James Version' },
      { id: 'niv-text', abbreviationLocal: 'NIV', name: 'New International Version' },
      { id: 'xyz-text', abbreviationLocal: 'XYZ', name: 'Xyz Simple Translation' },
    ],
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

test('the offline-cache list skips bundled locals and unknown API.Bible texts', async () => {
  const scripture = service()
  const list = await scripture.listAuthorizedTranslations('key-mixed')
  const ids = list.map((entry) => entry.translation)
  assert.ok(!ids.includes('KJV'), 'bundled KJV already ships offline')
  assert.ok(ids.includes('NIV'))
  assert.ok(!ids.includes('XYZ'), 'editions outside the product catalog stay off the cache list')
})

test('the Scripture picker lists the product catalog, not extra API.Bible texts', async () => {
  const scripture = service()
  const options = await scripture.getTranslationOptions('key-mixed')
  const ids = options.map((option) => option.id)
  assert.ok(ids.includes('NIV'))
  assert.ok(ids.includes('KJV'))
  assert.ok(!ids.includes('XYZ'))
  assert.equal(options.find((option) => option.id === 'NIV')?.available, true)
})

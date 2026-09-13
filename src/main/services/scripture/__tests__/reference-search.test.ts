import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveReferenceLookup } from '../reference-search'

test('an API-backed default bypasses local Bibles and uses API.Bible', async () => {
  const calls: string[] = []
  const results = await resolveReferenceLookup({
    requested: 'NIV',
    localIds: ['KJV', 'WEB'],
    lookupLocal: async (translation) => {
      calls.push(`local:${translation}`)
      return translation === 'KJV' ? [{ text: 'KJV' }] : []
    },
    lookupApi: async () => {
      calls.push('api')
      return [{ translation: 'NIV', text: 'NIV' }]
    },
    toLocalResult: (verses, translation) => ({ translation, text: verses[0]!.text }),
  })

  assert.deepEqual(calls, ['api'])
  assert.deepEqual(results, [{ translation: 'NIV', text: 'NIV' }])
})

test('uses the local copy when the requested translation is already seeded', async () => {
  const calls: string[] = []
  const results = await resolveReferenceLookup({
    requested: 'KJV',
    localIds: ['KJV', 'WEB'],
    lookupLocal: async (translation) => {
      calls.push(`local:${translation}`)
      return translation === 'KJV' ? [{ text: 'KJV' }] : []
    },
    lookupApi: async () => {
      calls.push('api')
      return [{ translation: 'NIV', text: 'NIV' }]
    },
    toLocalResult: (verses, translation) => ({ translation, text: verses[0]!.text }),
  })

  assert.deepEqual(calls, ['local:KJV'])
  assert.deepEqual(results, [{ translation: 'KJV', text: 'KJV' }])
})

test('does not substitute another local Bible when the default API translation fails', async () => {
  const calls: string[] = []
  await assert.rejects(() => resolveReferenceLookup({
    requested: 'NIV',
    localIds: ['KJV'],
    lookupLocal: async (translation) => {
      calls.push(`local:${translation}`)
      return translation === 'KJV' ? [{ text: 'KJV' }] : []
    },
    lookupApi: async () => {
      calls.push('api')
      throw new Error('NIV is not authorized for this API.Bible key.')
    },
    toLocalResult: (verses, translation) => ({ translation, text: verses[0]!.text }),
  }), /NIV is not authorized/)

  assert.deepEqual(calls, ['api'])
})

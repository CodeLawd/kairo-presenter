import assert from 'node:assert/strict'
import test from 'node:test'
import type { ScriptureTranslation } from '../../../../lib/ipc'
import { lookupDetectedScripture } from '../detection-lookup'

test('explicit detections use reference search so API-only translations can resolve', async () => {
  const queries: Array<[string, string, string]> = []
  const verses = [{ book: 'Isaiah', chapter: 49, verse: 14, text: 'But Zion said' }]
  const service = {
    async search(query: string, translation: ScriptureTranslation = 'KJV', apiKey = '') {
      queries.push([query, translation, apiKey])
      return [{ reference: query, translation, verses }]
    },
  }

  const result = await lookupDetectedScripture(
    service,
    { book: 'Isaiah', chapter: 49, verseStart: 14, verseEnd: 26 },
    'NKJV',
    'api-key',
  )

  assert.deepEqual(queries, [['Isaiah 49:14-26', 'NKJV', 'api-key']])
  assert.deepEqual(result, verses)
})

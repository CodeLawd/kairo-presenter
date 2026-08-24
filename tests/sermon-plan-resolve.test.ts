import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveSermonPlanItem,
  translationFallbackOrder,
} from '../src/lib/sermon-plan-resolve'
import type { ScriptureResult, SermonScriptureItem } from '../src/lib/ipc'

test('fallback order prefers requested then operator default then local', () => {
  assert.deepEqual(
    translationFallbackOrder('NLT', 'KJV', [
      { id: 'NLT', name: 'NLT', access: 'api', available: false, requiresApiKey: true },
      { id: 'KJV', name: 'KJV', access: 'local', available: true, requiresApiKey: false },
      { id: 'BSB', name: 'BSB', access: 'local', available: true, requiresApiKey: false },
    ]),
    ['NLT', 'KJV', 'BSB', 'WEB', 'ASV', 'OEB'],
  )
})

test('resolves multi-verse API translation by falling back to a local Bible', async () => {
  const item: SermonScriptureItem = {
    id: 'phil-4-6-7',
    reference: 'Philippians 4:6–7',
    translation: 'NLT',
    verses: [],
    available: false,
    error: 'NLT text is unavailable',
  }

  const search = async (
    query: string,
    translation: string,
  ): Promise<ScriptureResult[]> => {
    if (translation === 'NLT') return []
    if (translation === 'KJV' && query.includes('Philippians')) {
      return [{
        reference: 'Philippians 4:6–7',
        translation: 'KJV',
        verses: [
          { book: 'Philippians', chapter: 4, verse: 6, text: 'Be careful for nothing…' },
          { book: 'Philippians', chapter: 4, verse: 7, text: 'And the peace of God…' },
        ],
      }]
    }
    return []
  }

  const resolved = await resolveSermonPlanItem(item, 'KJV', search, [
    { id: 'KJV', name: 'KJV', access: 'local', available: true, requiresApiKey: false },
  ])

  assert.equal(resolved.available, true)
  assert.equal(resolved.translation, 'KJV')
  assert.equal(resolved.verses.length, 2)
  assert.match(resolved.error ?? '', /NLT unavailable/)
})

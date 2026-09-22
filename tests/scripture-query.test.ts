import test from 'node:test'
import assert from 'node:assert/strict'
import {
  combineScriptureResults,
  expandScriptureResult,
  getAdjacentVerseQueries,
  getBookCompletion,
  getBookCompletions,
  isLikelyPhraseQuery,
  normalizeScriptureQuery,
  reloadPassagesInTranslation,
  resolveSubmittedScriptureQuery,
  shouldLiveSuggestScriptureQuery,
} from '../src/lib/scripture-query'
import type { ScriptureResult } from '../src/lib/ipc'

test('normalizes a space-separated abbreviated range', () => {
  assert.equal(normalizeScriptureQuery('jos 1 5 9'), 'Joshua 1:5–9')
})

test('normalizes incomplete book names through one general prefix resolver', () => {
  assert.equal(normalizeScriptureQuery('josh 1'), 'Joshua 1')
  assert.equal(normalizeScriptureQuery('joshu 1:9'), 'Joshua 1:9')
  assert.equal(normalizeScriptureQuery('genes 1:1'), 'Genesis 1:1')
  assert.equal(normalizeScriptureQuery('philipp 4:6'), 'Philippians 4:6')
})

test('prefers an exact standard abbreviation over longer prefix candidates', () => {
  assert.equal(normalizeScriptureQuery('ez 1'), 'Ezra 1')
  assert.equal(normalizeScriptureQuery('ezek 1'), 'Ezekiel 1')
})

test('normalizes chapter-only references to the whole chapter', () => {
  assert.equal(normalizeScriptureQuery('Psalms 23'), 'Psalms 23')
  assert.equal(normalizeScriptureQuery('ps 23'), 'Psalms 23')
  assert.equal(normalizeScriptureQuery('psa 23'), 'Psalms 23')
  assert.equal(normalizeScriptureQuery('pss 23'), 'Psalms 23')
  assert.equal(normalizeScriptureQuery('psalm 23:1'), 'Psalms 23:1')
})
test('normalizes conventional references without changing their meaning', () => {
  assert.equal(normalizeScriptureQuery('John 3:16-18'), 'John 3:16–18')
  assert.equal(normalizeScriptureQuery('rom 8 28'), 'Romans 8:28')
})

test('normalizes numbered books and their compact abbreviations', () => {
  assert.equal(normalizeScriptureQuery('1 cor 13 4 7'), '1 Corinthians 13:4–7')
  assert.equal(normalizeScriptureQuery('2tim 1 7'), '2 Timothy 1:7')
})

test('offers a canonical book completion and preserves a numeric suffix', () => {
  assert.deepEqual(getBookCompletion('josh'), {
    value: 'Joshua ',
    book: 'Joshua',
    typedBook: 'josh',
  })
  assert.deepEqual(getBookCompletion('rom 8'), {
    value: 'Romans 8',
    book: 'Romans',
    typedBook: 'rom',
  })
})

test('does not offer ambiguous or already complete book names', () => {
  assert.equal(getBookCompletion('jo'), null)
  assert.equal(getBookCompletion('Joshua'), null)
})

test('offers every matching book for an ambiguous prefix and preserves its suffix', () => {
  assert.deepEqual(
    getBookCompletions('jo 1 2').map((completion) => completion.value),
    ['Job 1 2', 'Joel 1 2', 'John 1 2', 'Jonah 1 2', 'Joshua 1 2'],
  )
})

test('exact short abbreviations suppress unrelated prefix matches', () => {
  assert.deepEqual(
    getBookCompletions('ez 1').map((completion) => completion.value),
    ['Ezra 1'],
  )
})

test('classifies remembered verse words but not references as phrase queries', () => {
  assert.equal(isLikelyPhraseQuery('for God so loved'), true)
  assert.equal(isLikelyPhraseQuery('jos 1 5 9'), false)
  assert.equal(isLikelyPhraseQuery('John'), false)
  assert.equal(isLikelyPhraseQuery('12 4 8'), false)
})

test('live-suggests phrases and numeric references while typing', () => {
  assert.equal(shouldLiveSuggestScriptureQuery('love is patient'), true)
  assert.equal(shouldLiveSuggestScriptureQuery('John 3:16'), true)
  assert.equal(shouldLiveSuggestScriptureQuery('rom 8'), true)
  assert.equal(shouldLiveSuggestScriptureQuery('Jo'), false)
  assert.equal(shouldLiveSuggestScriptureQuery('John'), false)
})

test('returns the normalized value that Enter must submit immediately', () => {
  assert.equal(resolveSubmittedScriptureQuery('Ezek 1 2 3'), 'Ezekiel 1:2–3')
})

test('Enter applies a pending book completion before searching', () => {
  assert.equal(resolveSubmittedScriptureQuery('psa 23'), 'Psalms 23')
  assert.equal(resolveSubmittedScriptureQuery('josh 1 9'), 'Joshua 1:9')
  // Phrases and unknown books pass through to keyword search untouched.
  assert.equal(resolveSubmittedScriptureQuery('for God so loved'), 'for God so loved')
  assert.equal(resolveSubmittedScriptureQuery('love 123'), 'love 123')
})

test('expands a passage into independently sendable verse results', () => {
  const passage: ScriptureResult = {
    reference: 'Ezekiel 1:2–3',
    translation: 'KJV',
    verses: [
      { book: 'Ezekiel', chapter: 1, verse: 2, text: 'Two' },
      { book: 'Ezekiel', chapter: 1, verse: 3, text: 'Three' },
    ],
  }
  assert.deepEqual(expandScriptureResult(passage).map((result) => result.reference), [
    'Ezekiel 1:2',
    'Ezekiel 1:3',
  ])
})

test('builds next and previous queries from the loaded queue edges', () => {
  const loaded: ScriptureResult[] = [
    { reference: 'Joshua 1:8', translation: 'KJV', verses: [{ book: 'Joshua', chapter: 1, verse: 8, text: 'Eight' }] },
    { reference: 'Joshua 1:9', translation: 'KJV', verses: [{ book: 'Joshua', chapter: 1, verse: 9, text: 'Nine' }] },
  ]
  assert.deepEqual(getAdjacentVerseQueries(loaded, 'next'), ['Joshua 1:10', 'Joshua 2:1'])
  assert.deepEqual(getAdjacentVerseQueries(loaded, 'previous'), ['Joshua 1:7'])
})

test('uses a capped chapter range when navigating before verse one', () => {
  const loaded: ScriptureResult[] = [
    { reference: 'Joshua 2:1', translation: 'KJV', verses: [{ book: 'Joshua', chapter: 2, verse: 1, text: 'One' }] },
  ]
  assert.deepEqual(getAdjacentVerseQueries(loaded, 'previous'), ['Joshua 1:1–176'])
})

test('combines loaded verses into one same-chapter passage result', () => {
  const loaded: ScriptureResult[] = [
    { reference: 'Psalms 1:2', translation: 'KJV', verses: [{ book: 'Psalms', chapter: 1, verse: 2, text: 'Two' }] },
    { reference: 'Psalms 1:9', translation: 'KJV', verses: [{ book: 'Psalms', chapter: 1, verse: 9, text: 'Nine' }] },
  ]
  const passage = combineScriptureResults(loaded)
  assert.equal(passage?.reference, 'Psalms 1:2–9')
  assert.deepEqual(passage?.verses.map((verse) => verse.verse), [2, 9])
})

test('reloads loaded passages in a new translation and keeps misses', async () => {
  const passages: ScriptureResult[] = [
    {
      reference: 'John 3:16',
      translation: 'KJV',
      verses: [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved' }],
    },
    {
      reference: 'Romans 8:28',
      translation: 'KJV',
      verses: [{ book: 'Romans', chapter: 8, verse: 28, text: 'And we know' }],
    },
  ]
  const { results, unavailable } = await reloadPassagesInTranslation(
    passages,
    'NIV',
    async (query, translation) => {
      if (query !== 'John 3:16') return []
      return [
        {
          reference: 'John 3:16',
          translation,
          verses: [{ book: 'John', chapter: 3, verse: 16, text: 'For God so loved NIV' }],
        },
      ]
    },
  )
  assert.equal(results[0]?.translation, 'NIV')
  assert.equal(results[0]?.verses[0]?.text, 'For God so loved NIV')
  assert.equal(results[1]?.translation, 'KJV')
  assert.deepEqual(unavailable, ['Romans 8:28'])
})

test('reloads an expanded range by its combined reference', async () => {
  const passage: ScriptureResult = {
    reference: 'John 3:16–17',
    translation: 'KJV',
    verses: [
      { book: 'John', chapter: 3, verse: 16, text: 'Sixteen KJV' },
      { book: 'John', chapter: 3, verse: 17, text: 'Seventeen KJV' },
    ],
  }
  const queried: string[] = []
  const { results, unavailable } = await reloadPassagesInTranslation(
    [passage],
    'ESV',
    async (query, translation) => {
      queried.push(query)
      return [
        {
          reference: query,
          translation,
          verses: [
            { book: 'John', chapter: 3, verse: 16, text: 'Sixteen ESV' },
            { book: 'John', chapter: 3, verse: 17, text: 'Seventeen ESV' },
          ],
        },
      ]
    },
  )
  assert.deepEqual(queried, ['John 3:16–17'])
  assert.equal(results[0]?.translation, 'ESV')
  assert.equal(results[0]?.verses[1]?.text, 'Seventeen ESV')
  assert.deepEqual(unavailable, [])
})

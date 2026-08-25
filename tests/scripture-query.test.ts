import test from 'node:test'
import assert from 'node:assert/strict'
import {
  combineScriptureResults,
  expandScriptureResult,
  getAdjacentVerseQueries,
  getBookCompletion,
  isLikelyPhraseQuery,
  normalizeScriptureQuery,
  resolveSubmittedScriptureQuery,
  shouldLiveSuggestScriptureQuery,
} from '../src/lib/scripture-query'
import type { ScriptureResult } from '../src/lib/ipc'

test('normalizes a space-separated abbreviated range', () => {
  assert.equal(normalizeScriptureQuery('jos 1 5 9'), 'Joshua 1:5–9')
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

test('uses a chapter range fallback when navigating before verse one', () => {
  const loaded: ScriptureResult[] = [
    { reference: 'Joshua 2:1', translation: 'KJV', verses: [{ book: 'Joshua', chapter: 2, verse: 1, text: 'One' }] },
  ]
  assert.deepEqual(getAdjacentVerseQueries(loaded, 'previous'), ['Joshua 1:1–999'])
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

test('combines a cross-chapter queue into one passage result', () => {
  const loaded: ScriptureResult[] = [
    { reference: 'Psalms 1:6', translation: 'KJV', verses: [{ book: 'Psalms', chapter: 1, verse: 6, text: 'Six' }] },
    { reference: 'Psalms 2:3', translation: 'KJV', verses: [{ book: 'Psalms', chapter: 2, verse: 3, text: 'Three' }] },
  ]
  assert.equal(combineScriptureResults(loaded)?.reference, 'Psalms 1:6–2:3')
})

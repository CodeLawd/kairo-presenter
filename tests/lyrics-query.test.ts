import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSongQuery, queryVariants } from '../src/lib/lyrics-query'

// LRCLIB's free-text search matches ONE metadata field, so "<title> by
// <artist>" returns nothing at all from it and Genius scores it as a lyric
// phrase. Splitting the query is what makes a song typed the way people speak
// findable at all.

test('"title by artist" splits into one confident pair', () => {
  const parts = parseSongQuery('blessed be the name of the lord by dunsin oyekan')
  assert.deepEqual(parts.pairs, [
    { title: 'blessed be the name of the lord', artist: 'dunsin oyekan' },
  ])
  assert.deepEqual(parts.titles, ['blessed be the name of the lord'])
})

test('a dashed query yields both orders, because playlists and lyric sites disagree', () => {
  const parts = parseSongQuery('Sinach - Way Maker')
  assert.deepEqual(parts.pairs, [
    { title: 'Way Maker', artist: 'Sinach' },
    { title: 'Sinach', artist: 'Way Maker' },
  ])
})

test('colon and pipe separators split the same way', () => {
  assert.equal(parseSongQuery('Nathaniel Bassey | Ese').pairs.length, 2)
  assert.equal(parseSongQuery('Nathaniel Bassey: Ese').pairs.length, 2)
})

test('"lyrics" and other noise words are stripped from the parts', () => {
  const parts = parseSongQuery('imole de lyrics by dunsin oyekan')
  assert.deepEqual(parts.pairs, [{ title: 'imole de', artist: 'dunsin oyekan' }])
})

test('a plain title is left whole — nothing to split', () => {
  const parts = parseSongQuery('blessed be the name of the lord')
  assert.deepEqual(parts.pairs, [])
  assert.equal(parts.full, 'blessed be the name of the lord')
})

test('a lyric line containing the word "by" is not mistaken for a credit', () => {
  // Two halves must both survive cleaning; "stand by me by the drifters" does
  // split, but a line that only ends in "by" cannot.
  const parts = parseSongQuery('led by the spirit of')
  assert.deepEqual(parts.pairs, [{ title: 'led', artist: 'the spirit of' }])
  assert.equal(parseSongQuery('carried by').pairs.length, 0)
})

test('variants search what was typed first, then the title alone', () => {
  const variants = queryVariants('way maker by sinach')
  assert.equal(variants[0], 'way maker by sinach')
  assert.ok(variants.includes('way maker'))
})

test('a short compound title is also tried as one token', () => {
  // African titles are often catalogued collapsed: "ami oluwa" as "Amioluwa".
  assert.ok(queryVariants('ami oluwa').includes('amioluwa'))
  // A long query would only waste a request.
  assert.ok(!queryVariants('blessed be the name of the lord').some((v) => v.includes('blessedbe')))
})

test('variants never repeat a query', () => {
  const variants = queryVariants('Ese - Ese')
  assert.equal(new Set(variants.map((v) => v.toLowerCase())).size, variants.length)
})

test('an empty query produces no variants', () => {
  assert.deepEqual(queryVariants('   '), [])
})

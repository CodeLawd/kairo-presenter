import assert from 'node:assert/strict'
import test from 'node:test'
import { matchExplicitScriptures } from '../detector'

const refs = (text: string): string[] =>
  matchExplicitScriptures(text).map((r) => `${r.book} ${r.chapter}:${r.verseStart}`)

test('a comma after the book still reads as a citation when chapter and verse follow', () => {
  assert.deepEqual(refs('Zephaniah, three sixteen.'), ['Zephaniah 3:16'])
  assert.deepEqual(refs('John, three sixteen'), ['John 3:16'])
  assert.deepEqual(refs('Romans, 8, 28'), ['Romans 8:28'])
  // Without a verse after it, a comma after a name is just prose.
  assert.deepEqual(refs('Mark, 2 of us went.'), [])
})

test('"sixty" heard for "sixteen" becomes the verse that exists', () => {
  assert.deepEqual(refs('Zephaniah three sixty.'), ['Zephaniah 3:16'])
  assert.deepEqual(refs('Genesis 1 sixty'), ['Genesis 1:16'])
  // A "-ty" verse that exists is never rewritten.
  assert.deepEqual(refs('Psalm 119 thirty'), ['Psalms 119:30'])
  assert.deepEqual(refs('Psalm 119:60'), ['Psalms 119:60'])
})

test('a verse past the end of its chapter is still not invented', () => {
  // Ezra 3 has 13 verses.
  assert.deepEqual(refs('Ezra three seventeen.'), [])
  assert.deepEqual(refs('Ezra three eleven.'), ['Ezra 3:11'])
})

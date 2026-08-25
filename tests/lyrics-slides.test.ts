import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyImportSlideBreaks,
  insertSlideBreaks,
  preserveSlideBreaks,
  splitIntoSlideChunks,
  wrapLine,
} from '../src/lib/lyrics-slides'

test('wrapLine keeps a short line intact', () => {
  assert.deepEqual(wrapLine('Hello world', 40), ['Hello world'])
})

test('wrapLine splits on word boundaries', () => {
  assert.deepEqual(wrapLine('one two three four', 9), ['one two', 'three', 'four'])
})

test('preserveSlideBreaks keeps a single blank as a slide break', () => {
  assert.deepEqual(
    preserveSlideBreaks(['A', '', 'B', 'C']),
    ['A', '', 'B', 'C']
  )
})

test('preserveSlideBreaks drops leading and trailing blanks', () => {
  assert.deepEqual(preserveSlideBreaks(['', 'A', 'B', '']), ['A', 'B'])
})

test('preserveSlideBreaks collapses consecutive blanks', () => {
  assert.deepEqual(preserveSlideBreaks(['A', '', '', 'B']), ['A', '', 'B'])
})

test('insertSlideBreaks groups lines into pairs', () => {
  assert.equal(
    insertSlideBreaks('A\nB\nC\nD', 2),
    'A\nB\n\nC\nD'
  )
})

test('insertSlideBreaks can put every line on its own slide', () => {
  assert.equal(insertSlideBreaks('A\nB\nC', 1), 'A\n\nB\n\nC')
})

test('insertSlideBreaks replaces existing blank lines first', () => {
  assert.equal(insertSlideBreaks('A\n\nB\nC\nD', 2), 'A\nB\n\nC\nD')
})

test('applyImportSlideBreaks couplets a flat section', () => {
  assert.deepEqual(
    applyImportSlideBreaks(['A', 'B', 'C', 'D']),
    ['A', 'B', '', 'C', 'D']
  )
})

test('applyImportSlideBreaks keeps author-supplied breaks', () => {
  assert.deepEqual(
    applyImportSlideBreaks(['A', '', 'B', 'C', 'D']),
    ['A', '', 'B', 'C', 'D']
  )
})

test('splitIntoSlideChunks follows blank lines only — never auto-chunks', () => {
  assert.deepEqual(
    splitIntoSlideChunks(['A', 'B', 'C', 'D'], 40),
    [['A', 'B', 'C', 'D']]
  )
})

test('splitIntoSlideChunks treats a blank line as the slide boundary', () => {
  assert.deepEqual(
    splitIntoSlideChunks(['A', 'B', '', 'C', 'D'], 40),
    [['A', 'B'], ['C', 'D']]
  )
})

test('a single line between breaks is its own slide', () => {
  assert.deepEqual(
    splitIntoSlideChunks(['A', '', 'B', 'C'], 40),
    [['A'], ['B', 'C']]
  )
})

test('soft-wrap stays inside one slide', () => {
  assert.deepEqual(
    splitIntoSlideChunks(['one two three four'], 9),
    [['one two', 'three', 'four']]
  )
})

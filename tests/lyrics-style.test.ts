import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_GLOSS_COLOR,
  normalizeGlossColor,
  resolveLyricLineColor,
} from '../src/lib/lyrics-style'
import { splitIntoColoredSlideChunks } from '../src/lib/lyrics-slides'

test('resolveLyricLineColor colors gloss lines with settings color', () => {
  assert.equal(
    resolveLyricLineColor('(The arm of the Lord)', '#D4A017'),
    '#D4A017'
  )
  assert.equal(resolveLyricLineColor('Aka aka ya', '#D4A017'), undefined)
})

test('resolveLyricLineColor prefers manual override', () => {
  assert.equal(
    resolveLyricLineColor('Aka aka ya', '#D4A017', '#FF0000'),
    '#FF0000'
  )
})

test('normalizeGlossColor falls back to default', () => {
  assert.equal(normalizeGlossColor(''), DEFAULT_GLOSS_COLOR)
  assert.equal(normalizeGlossColor('#abc'), '#AABBCC')
})

test('splitIntoColoredSlideChunks keeps gloss color through wrap', () => {
  const chunks = splitIntoColoredSlideChunks(
    ['Aka aka ya', '(The arm of the Lord)'],
    undefined,
    '#D4A017'
  )
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0][0].color, undefined)
  assert.equal(chunks[0][1].color, '#D4A017')
})

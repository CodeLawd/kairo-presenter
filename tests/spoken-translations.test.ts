import assert from 'node:assert/strict'
import test from 'node:test'
import { findSpokenTranslations } from '../src/lib/spoken-translations'

test('hears abbreviations written in capitals or spelled out letter by letter', () => {
  assert.deepEqual(findSpokenTranslations('John 3:16 in the NLT'), ['NLT'])
  assert.deepEqual(findSpokenTranslations('read it in the n l t please'), ['NLT'])
  assert.deepEqual(findSpokenTranslations('the N.I.V. puts it this way'), ['NIV'])
  assert.deepEqual(findSpokenTranslations('in the N-K-J-V'), ['NKJV'])
})

test('hears full and short translation names', () => {
  assert.deepEqual(findSpokenTranslations('the New Living Translation says'), ['NLT'])
  assert.deepEqual(findSpokenTranslations('from the New International Version'), ['NIV'])
  assert.deepEqual(findSpokenTranslations('in the King James it says'), ['KJV'])
  assert.deepEqual(findSpokenTranslations('the English Standard Version renders it'), ['ESV'])
})

test('a longer name wins over the shorter one inside it', () => {
  assert.deepEqual(findSpokenTranslations('in the New King James Version'), ['NKJV'])
  assert.deepEqual(findSpokenTranslations('the New American Standard Bible'), ['NASB'])
})

test('keeps several translations in the order they were named', () => {
  assert.deepEqual(findSpokenTranslations('let us read it in the NLT and the NIV'), ['NLT', 'NIV'])
  assert.deepEqual(findSpokenTranslations('NIV, NLT and then the NIV again'), ['NIV', 'NLT'])
})

test('ignores ordinary words that happen to share a translation name', () => {
  assert.deepEqual(findSpokenTranslations('the message today is about grace'), [])
  assert.deepEqual(findSpokenTranslations('his voice was amplified across the hall'), [])
  assert.deepEqual(findSpokenTranslations('we stream on the web every Sunday'), [])
  assert.deepEqual(findSpokenTranslations('the passion of Christ'), [])
})

test('hears the everyday-word translations only in unmistakable forms', () => {
  assert.deepEqual(findSpokenTranslations('in the Message Bible it reads'), ['MSG'])
  assert.deepEqual(findSpokenTranslations('the Amplified says'), ['AMPC'])
  assert.deepEqual(findSpokenTranslations('the Passion Translation puts it'), ['TPT'])
})

test('hears lower-case abbreviations a transcript may produce', () => {
  assert.deepEqual(findSpokenTranslations('john 3:16 in the niv'), ['NIV'])
  assert.deepEqual(findSpokenTranslations('the nkjv says'), ['NKJV'])
  assert.deepEqual(findSpokenTranslations('read the esv and the kjv'), ['ESV', 'KJV'])
})

test('hears a translation named before or after the passage, with punctuation around it', () => {
  assert.deepEqual(findSpokenTranslations('The NLT, in John 3:16, says'), ['NLT'])
  assert.deepEqual(findSpokenTranslations('John 3:16 (NIV)'), ['NIV'])
  assert.deepEqual(findSpokenTranslations('John 3:16 — New Living Translation.'), ['NLT'])
})

test('tells King James and New King James apart when both are named', () => {
  assert.deepEqual(findSpokenTranslations('the King James and the New King James'), ['KJV', 'NKJV'])
  assert.deepEqual(findSpokenTranslations('in the KJV and the NKJV'), ['KJV', 'NKJV'])
})

test('does not read abbreviation letters inside ordinary words', () => {
  assert.deepEqual(findSpokenTranslations('nltd and kjvx are not translations'), [])
  assert.deepEqual(findSpokenTranslations('we serve the new living God'), [])
  assert.deepEqual(findSpokenTranslations('a new international partnership'), [])
})

test('an empty or translation-free line returns nothing', () => {
  assert.deepEqual(findSpokenTranslations(''), [])
  assert.deepEqual(findSpokenTranslations('For God so loved the world'), [])
})

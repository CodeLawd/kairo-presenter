import assert from 'node:assert/strict'
import test from 'node:test'
import { parseScriptureReference } from '../reference'

test('parses scripture ranges using hyphen, en dash, or em dash', () => {
  assert.deepEqual(parseScriptureReference('Genesis 21:1–2'), {
    book: 'Genesis', chapter: 21, verseStart: 1, verseEnd: 2,
  })
  assert.equal(parseScriptureReference('Proverbs 3:5-6')?.verseEnd, 6)
  assert.equal(parseScriptureReference('Romans 8:28—30')?.verseEnd, 30)
})

test('parses relaxed space-separated scripture shorthand', () => {
  assert.deepEqual(parseScriptureReference('jos 1 5 9'), {
    book: 'Joshua', chapter: 1, verseStart: 5, verseEnd: 9,
  })
})

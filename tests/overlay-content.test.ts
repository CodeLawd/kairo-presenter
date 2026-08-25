import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatCardReference,
  formatOverlayReference,
  formatOverlayVerseText,
} from '../src/lib/overlay-content'

test('formats overlay reference with optional translation suffix', () => {
  assert.equal(formatOverlayReference('John 3:16', 'KJV', true), 'John 3:16 (KJV)')
  assert.equal(formatOverlayReference('John 3:16', 'KJV', false), 'John 3:16')
})

test('formats a card reference without repeating its translation badge', () => {
  assert.equal(formatCardReference('Romans 8:10'), 'Romans 8:10')
})

test('formats overlay verse text with numbers and maxVerses truncation', () => {
  const verses = [
    { book: 'Psalms', chapter: 1, verse: 2, text: 'Two' },
    { book: 'Psalms', chapter: 1, verse: 3, text: 'Three' },
    { book: 'Psalms', chapter: 1, verse: 4, text: 'Four' },
  ]

  assert.equal(
    formatOverlayVerseText(verses, { showVerseNumbers: true }),
    '2 Two\n3 Three\n4 Four',
  )
  assert.equal(
    formatOverlayVerseText(verses, { showVerseNumbers: false, maxVerses: 2 }),
    'Two\nThree…',
  )
  assert.equal(formatOverlayVerseText([], { showVerseNumbers: true }), null)
})

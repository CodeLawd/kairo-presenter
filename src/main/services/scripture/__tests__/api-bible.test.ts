import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApiBibleIdMap, parseApiBiblePassageContent } from '../api-bible'

test('maps API.Bible translations by their local abbreviation', () => {
  const ids = buildApiBibleIdMap([
    { id: 'de4e12af7f28f599-01', abbreviation: 'engKJV', abbreviationLocal: 'KJV' },
    { id: 'abcd-01', abbreviation: 'engNKJV', abbreviationLocal: 'NKJV' },
  ])

  assert.equal(ids.get('KJV'), 'de4e12af7f28f599-01')
  assert.equal(ids.get('NKJV'), 'abcd-01')
})

test('falls back to the API abbreviation when no local abbreviation is present', () => {
  const ids = buildApiBibleIdMap([
    { id: 'web-01', abbreviation: 'WEB' },
  ])

  assert.equal(ids.get('WEB'), 'web-01')
})

test('splits structured API.Bible passage content into individual verses', () => {
  const verses = parseApiBiblePassageContent([
    {
      name: 'para',
      type: 'tag',
      items: [
        { name: 'verse', type: 'tag', attrs: { number: '1', sid: 'JOS 1:1' }, items: [{ type: 'text', text: '1' }] },
        { type: 'text', text: ' After the death of Moses ', attrs: { verseId: 'JOS.1.1' } },
        { name: 'verse', type: 'tag', attrs: { number: '2', sid: 'JOS 1:2' }, items: [{ type: 'text', text: '2' }] },
        { type: 'text', text: ' Moses my servant is dead. ', attrs: { verseId: 'JOS.1.2' } },
      ],
    },
  ], 'Joshua')

  assert.deepEqual(verses, [
    { book: 'Joshua', chapter: 1, verse: 1, text: 'After the death of Moses' },
    { book: 'Joshua', chapter: 1, verse: 2, text: 'Moses my servant is dead.' },
  ])
})

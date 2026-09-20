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

test('strips the eng language prefix so licensed Bibles match catalog ids', () => {
  const ids = buildApiBibleIdMap([
    { id: 'niv-01', abbreviation: 'engNIV' },
    { id: 'nlt-01', abbreviation: 'engNLT' },
    { id: 'esv-01', abbreviation: 'engESV' },
  ])

  assert.equal(ids.get('NIV'), 'niv-01')
  assert.equal(ids.get('NLT'), 'nlt-01')
  assert.equal(ids.get('ESV'), 'esv-01')
})

test('maps common API.Bible aliases and display names onto catalog ids', () => {
  const ids = buildApiBibleIdMap([
    { id: 'msg-01', abbreviation: 'engMSG', abbreviationLocal: 'The Message', name: 'The Message' },
    { id: 'amp-01', abbreviation: 'AMP', abbreviationLocal: 'AMP' },
    { id: 'nasb-01', abbreviation: 'engNASB2020', abbreviationLocal: 'NASB2020' },
    { id: 'tpt-01', name: 'The Passion Translation', nameLocal: 'The Passion Translation' },
    { id: 'csb-01', abbreviationLocal: 'CSB' },
  ])

  assert.equal(ids.get('MSG'), 'msg-01')
  assert.equal(ids.get('AMPC'), 'amp-01')
  assert.equal(ids.get('NASB'), 'nasb-01')
  assert.equal(ids.get('TPT'), 'tpt-01')
  assert.equal(ids.get('CSB'), 'csb-01')
})

test('prefers a US NIV over an Anglicised alias when both are authorized', () => {
  const ids = buildApiBibleIdMap([
    { id: 'niv-uk', abbreviation: 'engNIVUK', abbreviationLocal: 'NIVUK' },
    { id: 'niv-us', abbreviation: 'engNIV', abbreviationLocal: 'NIV' },
  ])

  assert.equal(ids.get('NIV'), 'niv-us')
})

test('ignores audio Bibles when mapping text translations', () => {
  const ids = buildApiBibleIdMap([
    { id: 'niv-audio', abbreviationLocal: 'NIV', type: 'audio' },
    { id: 'niv-text', abbreviationLocal: 'NIV', type: 'text' },
  ])

  assert.equal(ids.get('NIV'), 'niv-text')
})

test('maps official API.Bible ids even when the abbreviation is unhelpful', () => {
  const ids = buildApiBibleIdMap([
    { id: '78a9f6124f344018-01', abbreviation: 'NIV11' },
  ])

  assert.equal(ids.get('NIV'), '78a9f6124f344018-01')
})

test('a NASB-authorized key never produces an ASV entry from the shared name words', () => {
  const ids = buildApiBibleIdMap([
    { id: 'nasb-01', abbreviationLocal: 'NASB', name: 'New American Standard Bible' },
  ])

  assert.equal(ids.get('NASB'), 'nasb-01')
  assert.equal(ids.has('ASV'), false)
})

test('a Bible that matches the registry by name gains no duplicate dynamic entry', () => {
  const ids = buildApiBibleIdMap([
    { id: 'engkjv-01', abbreviationLocal: 'ENGKJV', name: 'King James Version' },
  ])

  assert.equal(ids.get('KJV'), 'engkjv-01')
  assert.equal(ids.has('ENGKJV'), false)
})

test('an unknown English Bible is discovered under its own abbreviation', () => {
  const ids = buildApiBibleIdMap([
    { id: 'xyz-01', abbreviationLocal: 'XYZ', name: 'Xyz Simple Translation' },
  ])

  assert.equal(ids.get('XYZ'), 'xyz-01')
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

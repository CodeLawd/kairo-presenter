import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizedReferenceLabel } from '../src/lib/sermon-notes-review'

test('shows the canonical reference beside shorthand in the document', () => {
  assert.equal(normalizedReferenceLabel({
    start: 0,
    end: 6,
    text: 'ps 2 3',
    reference: 'Psalms 2:3',
    translations: ['NKJV'],
  }), 'Psalms 2:3')
})

test('does not repeat a reference already written canonically', () => {
  assert.equal(normalizedReferenceLabel({
    start: 0,
    end: 14,
    text: 'Mark 4:2 NLT',
    reference: 'Mark 4:2',
    translations: ['NLT'],
  }), null)
})

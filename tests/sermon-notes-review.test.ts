import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchema, getText, getTextSerializersFromSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  mapTextRangeToPos,
  normalizedReferenceLabel,
  plainTextToEditorHtml,
  SERMON_NOTES_BLOCK_SEPARATOR,
} from '../src/lib/sermon-notes-review'

const schema = getSchema([StarterKit])
const textSerializers = getTextSerializersFromSchema(schema)

function tipTapText(doc: ReturnType<typeof schema.node>): string {
  return getText(doc, {
    blockSeparator: SERMON_NOTES_BLOCK_SEPARATOR,
    textSerializers,
  })
}

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

test('plainTextToEditorHtml keeps repeated spaces through HTML escaping', () => {
  const html = plainTextToEditorHtml('ABEL  Genesis 4:3-5\nNOAH')
  assert.match(html, /ABEL&nbsp;&nbsp;Genesis 4:3-5/)
  assert.match(html, /<p>NOAH<\/p>/)
})

test('mapTextRangeToPos highlights the exact reference across many paragraphs', () => {
  const lines = [
    'STS BIBLICAL EXAMPLES',
    '',
    'INTRODUCTION',
    '#3 FATHER ABRAHAM Genesis 14:18-20 and Genesis 28:20-22',
    '#4 DAVID 1 Samuel 17:48-51',
    'FOUR OTHER PEOPLE WHO HONORED GOD',
    'E Esther 2:5-11; Esth 4:14',
    'Hebrews 7:1-7',
  ]
  const doc = schema.node('doc', null, lines.map((line) => (
    schema.node('paragraph', null, line ? [schema.text(line)] : [])
  )))
  const text = tipTapText(doc)

  for (const ref of [
    'Genesis 14:18-20',
    'Genesis 28:20-22',
    '1 Samuel 17:48-51',
    'Esther 2:5-11',
    'Hebrews 7:1-7',
  ]) {
    const start = text.indexOf(ref)
    const end = start + ref.length
    const range = mapTextRangeToPos(doc, start, end, SERMON_NOTES_BLOCK_SEPARATOR)
    assert.ok(range, `expected a range for ${ref}`)
    assert.equal(doc.textBetween(range.from, range.to), ref)
  }
})

test('mapTextRangeToPos matches TipTap getText offsets inside lists', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Intro Genesis 1:1')]),
    schema.node('orderedList', null, [
      schema.node('listItem', null, [
        schema.node('paragraph', null, [schema.text('First John 3:16')]),
      ]),
      schema.node('listItem', null, [
        schema.node('paragraph', null, [schema.text('Second Romans 8:28')]),
      ]),
    ]),
  ])
  const text = tipTapText(doc)

  for (const ref of ['Genesis 1:1', 'John 3:16', 'Romans 8:28']) {
    const start = text.indexOf(ref)
    const range = mapTextRangeToPos(doc, start, start + ref.length, SERMON_NOTES_BLOCK_SEPARATOR)
    assert.ok(range, `expected a range for ${ref}`)
    assert.equal(doc.textBetween(range.from, range.to), ref)
  }
})

test('naive offset+1 drifts on multi-paragraph docs (documents the bug we fixed)', () => {
  const text = 'Intro\nRead Genesis 5:28-29 next'
  const doc = schema.node('doc', null, text.split('\n').map((line) => (
    schema.node('paragraph', null, line ? [schema.text(line)] : [])
  )))
  const start = text.indexOf('Genesis 5:28-29')
  const end = start + 'Genesis 5:28-29'.length
  const naive = doc.textBetween(start + 1, end + 1)
  assert.notEqual(naive, 'Genesis 5:28-29')
  const range = mapTextRangeToPos(doc, start, end)!
  assert.equal(doc.textBetween(range.from, range.to), 'Genesis 5:28-29')
})

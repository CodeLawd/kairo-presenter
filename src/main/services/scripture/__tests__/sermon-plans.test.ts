import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { analyzeScriptureReferences, extractScriptureReferences, readSermonDocument } from '../sermon-plans'
import {
  appendScriptureResultToPlan,
  appendScriptureResultsToPlan,
  expandSermonPlanItems,
  extendSermonPlanItemWithAdjacent,
  insertScriptureResultInPlan,
} from '../../../../lib/ipc'
import type { ScriptureResult, SermonPlan } from '../../../../lib/ipc'

test('extracts ordered references with translation before or after the passage', () => {
  const items = extractScriptureReferences(
    'Opening: TPT John 1:3. Then Romans 1:2 KJV and finally Psalm 23:1.',
    'NKJV',
  )

  assert.deepEqual(items.map(({ reference, translation }) => ({ reference, translation })), [
    { reference: 'John 1:3', translation: 'TPT' },
    { reference: 'Romans 1:2', translation: 'KJV' },
    { reference: 'Psalms 23:1', translation: 'NKJV' },
  ])
})

test('normalizes long translation names and verse ranges', () => {
  const items = extractScriptureReferences(
    'Amplified Classic Romans 8:28-30; John 3:16 The Passion Translation',
    'NKJV',
  )

  assert.equal(items[0]?.translation, 'AMPC')
  assert.equal(items[0]?.reference, 'Romans 8:28–30')
  assert.equal(items[1]?.translation, 'TPT')
})

test('extracts compact book abbreviations and references whose colon is omitted', () => {
  const items = extractScriptureReferences('ps 12:2; 2sam 33 4', 'NKJV')

  assert.deepEqual(items.map(({ reference, translation }) => ({ reference, translation })), [
    { reference: 'Psalms 12:2', translation: 'NKJV' },
    { reference: '2 Samuel 33:4', translation: 'NKJV' },
  ])
})

test('creates one playlist item per trailing translation', () => {
  const items = extractScriptureReferences('Mark 4:2 NLT, TPT, MSG', 'NKJV')

  assert.deepEqual(items.map(({ reference, translation }) => ({ reference, translation })), [
    { reference: 'Mark 4:2', translation: 'NLT' },
    { reference: 'Mark 4:2', translation: 'TPT' },
    { reference: 'Mark 4:2', translation: 'MSG' },
  ])
})

test('returns source spans for every detected reference in editable notes', () => {
  const analysis = analyzeScriptureReferences('Intro\nRead Ps 12:2, then Mark 4:2 NLT, TPT.\nClose', 'NKJV')

  assert.deepEqual(analysis.matches, [
    {
      start: 11,
      end: 18,
      text: 'Ps 12:2',
      reference: 'Psalms 12:2',
      translations: ['NKJV'],
    },
    {
      start: 25,
      end: 42,
      text: 'Mark 4:2 NLT, TPT',
      reference: 'Mark 4:2',
      translations: ['NLT', 'TPT'],
    },
  ])
  assert.deepEqual(analysis.items.map(({ reference, translation }) => ({ reference, translation })), [
    { reference: 'Psalms 12:2', translation: 'NKJV' },
    { reference: 'Mark 4:2', translation: 'NLT' },
    { reference: 'Mark 4:2', translation: 'TPT' },
  ])
})

test('adds each loaded verse to a playlist as its own row', () => {
  const plan: SermonPlan = {
    id: 'plan-1', title: 'Sunday', sourceFileName: 'manual', items: [], createdAt: 1, updatedAt: 1,
  }
  const verses: ScriptureResult[] = [
    {
      reference: 'Joshua 1:8', translation: 'KJV',
      verses: [{ book: 'Joshua', chapter: 1, verse: 8, text: 'Eight' }],
    },
    {
      reference: 'Joshua 1:9', translation: 'KJV',
      verses: [{ book: 'Joshua', chapter: 1, verse: 9, text: 'Nine' }],
    },
  ]

  const updated = appendScriptureResultsToPlan(plan, verses, 'batch-1', 42)

  assert.equal(updated.items.length, 2)
  assert.equal(updated.items[0]?.reference, 'Joshua 1:8')
  assert.equal(updated.items[0]?.verses.length, 1)
  assert.equal(updated.items[1]?.reference, 'Joshua 1:9')
  assert.equal(updated.updatedAt, 42)
})

test('expands a multi-verse playlist row into one item per verse', () => {
  const items = expandSermonPlanItems([{
    id: 'passage-8-9',
    reference: 'Joshua 1:8–9',
    translation: 'KJV',
    verses: [
      { book: 'Joshua', chapter: 1, verse: 8, text: 'Eight' },
      { book: 'Joshua', chapter: 1, verse: 9, text: 'Nine' },
    ],
    available: true,
  }])

  assert.equal(items.length, 2)
  assert.equal(items[0]?.reference, 'Joshua 1:8')
  assert.equal(items[1]?.reference, 'Joshua 1:9')
})

test('appendScriptureResultToPlan still adds a single result row', () => {
  const plan: SermonPlan = {
    id: 'plan-1', title: 'Sunday', sourceFileName: 'manual', items: [], createdAt: 1, updatedAt: 1,
  }
  const passage: ScriptureResult = {
    reference: 'Joshua 1:8', translation: 'KJV',
    verses: [{ book: 'Joshua', chapter: 1, verse: 8, text: 'Eight' }],
  }

  const updated = appendScriptureResultToPlan(plan, passage, 'passage-8', 42)

  assert.equal(updated.items.length, 1)
  assert.equal(updated.items[0]?.reference, 'Joshua 1:8')
  assert.equal(updated.updatedAt, 42)
})

test('insertScriptureResultInPlan inserts after the selected playlist item', () => {
  const plan: SermonPlan = {
    id: 'plan-1',
    title: 'Sunday',
    sourceFileName: 'manual',
    createdAt: 1,
    updatedAt: 1,
    items: [
      {
        id: 'a',
        reference: 'Isaiah 40:31',
        translation: 'KJV',
        verses: [{ book: 'Isaiah', chapter: 40, verse: 31, text: 'A' }],
        available: true,
      },
      {
        id: 'b',
        reference: 'James 1:2',
        translation: 'KJV',
        verses: [{ book: 'James', chapter: 1, verse: 2, text: 'B' }],
        available: true,
      },
    ],
  }
  const next: ScriptureResult = {
    reference: 'Isaiah 40:32',
    translation: 'KJV',
    verses: [{ book: 'Isaiah', chapter: 40, verse: 32, text: 'Next' }],
  }

  const updated = insertScriptureResultInPlan(plan, next, 'c', 'a', 'after', 99)

  assert.deepEqual(
    updated.items.map((item) => item.id),
    ['a', 'c', 'b'],
  )
  assert.equal(updated.items[1]?.reference, 'Isaiah 40:32')
  assert.equal(updated.updatedAt, 99)
})

test('extends a playlist item in place when previous/next stays on the same passage', () => {
  const plan: SermonPlan = {
    id: 'plan-1',
    title: 'Sunday',
    sourceFileName: 'manual',
    items: [
      {
        id: 'a',
        reference: 'John 1:1',
        translation: 'KJV',
        verses: [{ book: 'John', chapter: 1, verse: 1, text: 'In the beginning' }],
        available: true,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  }
  const next: ScriptureResult = {
    reference: 'John 1:2',
    translation: 'KJV',
    verses: [{ book: 'John', chapter: 1, verse: 2, text: 'The same was' }],
  }

  const updated = extendSermonPlanItemWithAdjacent(plan, 'a', next, 'next', 50)

  assert.equal(updated.items.length, 1)
  assert.equal(updated.items[0]?.reference, 'John 1:1–2')
  assert.equal(updated.items[0]?.verses.length, 2)
  assert.equal(updated.updatedAt, 50)
})

test('reads an RTF sermon document as plain text so verse ranges survive', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-sermon-'))
  const file = path.join(dir, 'notes.rtf')
  await fs.writeFile(
    file,
    "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2907\n{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}\n{\\*\\expandedcolortbl;;}\n" +
      "\\f0\\fs24 \\cf0 TOPIC - Kingdom Family\\\n1. Luke 11:1\\'962\\\n2. Deuteronomy 10:14\\\n3. 2 Corinthians 10:3\\'966}",
  )
  try {
    const { text } = await readSermonDocument(file)
    assert.ok(!text.includes('\\'), 'no RTF markup left in the text')
    assert.deepEqual(extractScriptureReferences(text, 'NKJV').map((item) => item.reference), [
      'Luke 11:1–2',
      'Deuteronomy 10:14',
      '2 Corinthians 10:3–6',
    ])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('reads verses listed after a comma as more verses of the same chapter', () => {
  const items = extractScriptureReferences(
    'Peter was a fisherman (Matthew 4:18–20; Acts 2:14, 41). Also John 3:16, 18-21, 4:1.',
    'NKJV',
  )

  assert.deepEqual(items.map((item) => item.reference), [
    'Matthew 4:18–20',
    'Acts 2:14',
    'Acts 2:41',
    'John 3:16',
    'John 3:18–21',
    'John 4:1',
  ])
})

test('reads chapter:verse after a semicolon as the same book', () => {
  const items = extractScriptureReferences('Read John 3:16; 4:1-2 tonight. Moses doubted (Exodus 3:10–12; 4:10–12).', 'NKJV')

  assert.deepEqual(items.map((item) => item.reference), [
    'John 3:16',
    'John 4:1–2',
    'Exodus 3:10–12',
    'Exodus 4:10–12',
  ])
})

test('does not swallow the next book or plain numbers as continuations', () => {
  const items = extractScriptureReferences(
    'Romans 8:28, 2 Corinthians 5:17; 1 Peter 1:15. Psalm 23:1; 3 people prayed.',
    'NKJV',
  )

  assert.deepEqual(items.map((item) => item.reference), [
    'Romans 8:28',
    '2 Corinthians 5:17',
    '1 Peter 1:15',
    'Psalms 23:1',
  ])
})

test('marks the continuation verse itself, labelled with its full reference', () => {
  const analysis = analyzeScriptureReferences('(Acts 2:14, 41)', 'NKJV')

  assert.deepEqual(
    analysis.matches.map(({ start, end, text, reference }) => ({ start, end, text, reference })),
    [
      { start: 1, end: 10, text: 'Acts 2:14', reference: 'Acts 2:14' },
      { start: 12, end: 14, text: '41', reference: 'Acts 2:41' },
    ],
  )
})

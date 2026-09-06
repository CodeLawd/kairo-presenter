import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeScriptureReferences, extractScriptureReferences } from '../sermon-plans'
import {
  appendScriptureResultToPlan,
  appendScriptureResultsToPlan,
  expandSermonPlanItems,
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSermonSummary } from '../website/src/lib/sermon-summary'

test('converts a stored legacy recap into the compact summary shape', () => {
  const summary = normalizeSermonSummary({
    headline: 'Grace That Bears Fruit',
    overview: 'Grace calls believers to respond with faithful obedience.',
    mainPoints: [
      {
        title: 'Grace has a purpose',
        detail: 'Receiving grace should change how a believer lives.',
        subPoints: ['This legacy field is deliberately not rendered.'],
      },
    ],
    keyQuotes: ['Grace can be frustrated.'],
    takeaways: ['Respond to grace with obedience.'],
    scriptures: [{ reference: 'Galatians 2:21', note: 'The central warning.' }],
  })

  assert.equal(summary.bigIdea, 'Grace calls believers to respond with faithful obedience.')
  assert.deepEqual(summary.keyPoints, [
    {
      title: 'Grace has a purpose',
      explanation: 'Receiving grace should change how a believer lives.',
    },
  ])
  assert.deepEqual(summary.memorableQuotes, ['Grace can be frustrated.'])
  assert.deepEqual(summary.keyScriptures, [
    { reference: 'Galatians 2:21', connection: 'The central warning.' },
  ])
})

test('supplies safe defaults for an incomplete summary payload', () => {
  const summary = normalizeSermonSummary({ headline: 'A saved recap' })

  assert.equal(summary.headline, 'A saved recap')
  assert.equal(summary.bigIdea, '')
  assert.deepEqual(summary.keyPoints, [])
  assert.deepEqual(summary.memorableQuotes, [])
  assert.deepEqual(summary.takeaways, [])
  assert.deepEqual(summary.keyScriptures, [])
  assert.equal(summary.callToAction, undefined)
})

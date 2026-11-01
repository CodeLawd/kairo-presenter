import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeAudienceQuestions,
  normalizeAudienceText,
  setAudienceQuestionState,
  sortAudienceQuestions,
  type AudienceQuestion,
} from '../src/lib/audience'

const question = (id: string, overrides: Partial<AudienceQuestion> = {}): AudienceQuestion => ({
  id: `kairo:${id}`, sourceId: 'kairo', text: 'Why?', author: null,
  votes: 0, state: 'review', createdAt: 100, ...overrides,
})

test('question text trims whitespace, rejects empty input and caps Unicode characters', () => {
  assert.equal(normalizeAudienceText('  How can\n we help?  '), 'How can\n we help?')
  assert.equal(normalizeAudienceText(' \n '), null)
  assert.equal(normalizeAudienceText(undefined), null)
  assert.equal(normalizeAudienceText(42), null)
  assert.equal(normalizeAudienceText('😀'.repeat(281)), '😀'.repeat(280))
})

test('sorting uses votes or newest, breaks ties consistently and leaves the queue alone', () => {
  const queue = [question('c'), question('b', { votes: 3, createdAt: 200 }), question('a', { votes: 3, createdAt: 200 })]
  assert.deepEqual(sortAudienceQuestions(queue, 'votes').map(q => q.id), ['kairo:a', 'kairo:b', 'kairo:c'])
  assert.deepEqual(sortAudienceQuestions([question('old', { votes: 9 }), question('new', { createdAt: 300 })], 'newest').map(q => q.id), ['kairo:new', 'kairo:old'])
  assert.equal(queue[0].id, 'kairo:c')
})

test('source refresh updates content and votes but preserves local moderation and missing questions', () => {
  const queue = [question('a', { state: 'hidden' }), question('b', { state: 'answered' }), question('c', { state: 'approved' })]
  const merged = mergeAudienceQuestions(queue, [question('a', { votes: 5, state: 'approved' }), question('b'), question('c'), question('d', { state: 'approved' })])
  assert.deepEqual(merged.map(q => q.state), ['hidden', 'answered', 'approved', 'review'])
  assert.equal(merged[0].votes, 5)
  assert.equal(queue[0].votes, 0)
  assert.equal(mergeAudienceQuestions(queue, [question('d')]).length, 4)
})

test('source namespaces stay separate and duplicate updates produce one question', () => {
  const result = mergeAudienceQuestions([question('a')], [question('a', { id: 'slido:a', sourceId: 'slido' }), question('b'), question('b', { votes: 2 })])
  assert.deepEqual(result.map(q => q.id), ['kairo:a', 'slido:a', 'kairo:b'])
  assert.equal(result[2].votes, 2)
})

test('moderation supports approve, answer, hide and restore without mutating the source queue', () => {
  const queue = [question('a'), question('b')]
  let result = setAudienceQuestionState(queue, 'kairo:a', 'approved')
  assert.equal(result[0].state, 'approved')
  result = setAudienceQuestionState(result, 'kairo:a', 'answered')
  assert.equal(result[0].state, 'answered')
  result = setAudienceQuestionState(result, 'kairo:a', 'hidden')
  assert.equal(result[0].state, 'hidden')
  result = setAudienceQuestionState(result, 'kairo:a', 'review')
  assert.equal(result[0].state, 'review')
  assert.equal(queue[0].state, 'review')
  assert.equal(result[1], queue[1])
  assert.deepEqual(setAudienceQuestionState(queue, 'missing', 'approved'), queue)
})

import { DEFAULT_PRESENTATION_SETTINGS, EMPTY_PROGRAM_STATE, normalizePresentationSettings, normalizeShowFilter, programLayersFor, renderQuestionHTML } from '../src/lib/program'

test('question layer escapes content, stays independent and respects its Look', () => {
  const state = { ...EMPTY_PROGRAM_STATE, question: { text: '<script>hello</script>\nWhy?', author: '<img>' } }
  const layers = programLayersFor({ show: normalizeShowFilter({}) }, state, DEFAULT_PRESENTATION_SETTINGS)
  assert.match(layers.question, /&lt;script&gt;/)
  assert.match(layers.question, /&lt;img&gt;/)
  assert.doesNotMatch(layers.question, /<script>/)
  assert.equal(layers.message, '')
  assert.equal(programLayersFor({ show: normalizeShowFilter({ question: false }) }, state, DEFAULT_PRESENTATION_SETTINGS).question, '')
  assert.equal(renderQuestionHTML(null, DEFAULT_PRESENTATION_SETTINGS.question), '')
})

test('question style normalizes independently from message style', () => {
  const settings = normalizePresentationSettings({ question: { fontSizePx: 9999, color: 'red;}evil', position: 'sideways' } })
  assert.equal(settings.question.fontSizePx, 100)
  assert.equal(settings.question.color, '#ffffff')
  assert.equal(settings.question.position, 'center')
  assert.deepEqual(settings.message, DEFAULT_PRESENTATION_SETTINGS.message)
})

import { slidoReadStale } from '../src/main/services/audience/sources/slido-health'

test('Slido stops claiming live after 30 seconds without parsed questions', () => {
  assert.equal(slidoReadStale(null, 100_000), false)
  assert.equal(slidoReadStale(1000, 30_999), false)
  assert.equal(slidoReadStale(1000, 31_000), true)
  assert.equal(slidoReadStale(30_000, 31_000), false)
})

import { parseSlidoEvent } from '../src/lib/audience'
import { normalizeAudienceRoomSettings } from '../src/lib/audience-protocol'

test('Slido input accepts a code, a #code or a pasted link', () => {
  for (const input of ['9374525', '#9374525', ' #9374525 ', 'slido.com/9374525', 'https://www.slido.com/9374525', 'sli.do/9374525', 'app.sli.do/#9374525']) {
    assert.deepEqual(parseSlidoEvent(input), { code: '9374525' }, input)
  }
  assert.deepEqual(parseSlidoEvent('https://app.sli.do/event/rywgZWDhcJNU5bDHDmq1GL/live/questions'), { eventId: 'rywgZWDhcJNU5bDHDmq1GL' })
  for (const input of ['', 'https://example.com/9374525', 'not a code!', 'javascript:alert(1)']) assert.equal(parseSlidoEvent(input), null, input)
})

test('merge modes: review, trusted (Slido skip approval) and authoritative (engagement)', () => {
  const approved = question('kairo:1', { state: 'approved' })
  const hidden = question('kairo:1', { state: 'hidden' })
  assert.equal(mergeAudienceQuestions([], [approved])[0].state, 'review')
  assert.equal(mergeAudienceQuestions([], [approved], 'trusted')[0].state, 'approved')
  assert.equal(mergeAudienceQuestions([hidden], [approved], 'trusted')[0].state, 'hidden', 'a hidden Slido question stays hidden')
  assert.equal(mergeAudienceQuestions([hidden], [approved], 'authoritative')[0].state, 'approved', 'a moderator on the website approved it')
})

test('room settings fall back to open questions, list on, names optional', () => {
  assert.deepEqual(normalizeAudienceRoomSettings(undefined), { review: false, showQuestions: true, names: 'optional' })
  assert.deepEqual(normalizeAudienceRoomSettings({ review: 'no', showQuestions: false, names: 'required' }), { review: false, showQuestions: false, names: 'optional' })
  assert.deepEqual(normalizeAudienceRoomSettings({ review: false, names: 'off' }), { review: false, showQuestions: true, names: 'off' })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAudienceEvent, AUDIENCE_MAX_SNAPSHOT_BYTES } from '../src/lib/audience-protocol'

test('room protocol rejects malformed, oversized and invalid moderation events', () => {
  for (const input of ['null', '[]', '{', '{}', 'x'.repeat(2049), '{"type":"state","id":"a","state":"live","requestId":"1"}', '{"type":"ask","text":"hello","requestId":""}']) assert.equal(parseAudienceEvent(input), null)
  assert.deepEqual(parseAudienceEvent('{"type":"ask","text":"Why?","requestId":"retry-1"}'), { type: 'ask', text: 'Why?', requestId: 'retry-1', author: undefined })
})

test('vote request IDs and toggle state survive parsing so rejections can be reconciled', () => {
  assert.deepEqual(parseAudienceEvent('{"type":"vote","id":"kairo:q","requestId":"vote-1"}'), { type: 'vote', id: 'kairo:q', requestId: 'vote-1' })
  assert.deepEqual(parseAudienceEvent('{"type":"vote","id":"kairo:q","voted":false,"requestId":"vote-2"}'), { type: 'vote', id: 'kairo:q', voted: false, requestId: 'vote-2' })
  assert.equal(parseAudienceEvent('{"type":"vote","id":"kairo:q","voted":"no","requestId":"vote-3"}'), null)
})


test('the desktop receive budget fits a full room of maximum-length questions', () => {
  const question = { id: 'kairo:12345678-1234-1234-1234-123456789abc', sourceId: 'kairo', text: '\u0000'.repeat(280), author: '\u0000'.repeat(80), votes: 1_000_000, state: 'review', createdAt: 1793532000000 }
  const snapshot = JSON.stringify({ type: 'snapshot', questions: Array.from({ length: 5000 }, () => question), title: 'x'.repeat(100), orgName: 'x'.repeat(100), joined: 1000, ended: false, voted: [] })
  assert.ok(Buffer.byteLength(snapshot) < AUDIENCE_MAX_SNAPSHOT_BYTES)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engagementDeadline, normalizeEngagementInput, normalizePoll } from '../src/lib/engage'

test('lasting engagement closes after inactivity or end grace, never after one day', () => {
  assert.equal(engagementDeadline({ lastActivityAt: 100, endsAt: null }), 2592000100)
  assert.equal(engagementDeadline({ lastActivityAt: 100, endsAt: 200 }), 86400200)
})
test('engagement dates reject reversed and invalid windows', () => {
  assert.throws(() => normalizeEngagementInput({ title: 'Sunday', startsAt: 200, endsAt: 100 }))
  assert.throws(() => normalizeEngagementInput({ title: 'Sunday', endsAt: 'tomorrow' }))
  assert.deepEqual(normalizeEngagementInput({ title: ' Sunday ' }), { name: 'Sunday', startsAt: null, endsAt: null, status: 'open' })
})
test('poll editor rejects ambiguous options and produces stable option identifiers', () => {
  assert.throws(() => normalizePoll({ title: 'Choose', options: ['yes','yes'] }))
  const poll = normalizePoll({ title: ' Choose ', options: ['Yes', 'No'], multiple: false })
  assert.equal(poll.title, 'Choose')
  assert.deepEqual(poll.options.map(o => o.text), ['Yes', 'No'])
  assert.equal(new Set(poll.options.map(o => o.id)).size, 2)
  assert.equal(poll.state, 'draft')
})

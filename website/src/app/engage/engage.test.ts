import assert from 'node:assert/strict'
import test from 'node:test'
import type { Reply } from '../../../../src/lib/engage'
import { parseModeratorInvite, orphanReplies, pollPercent } from './view-model'

test('invitation parsing accepts only a join code and 32-byte token', () => {
  const token = 'a'.repeat(64)
  assert.deepEqual(parseModeratorInvite(`ABC234.${token}`), { code: 'ABC234', token })
  for (const value of ['ABC234', `ABC234.${token}/other`, `ABC234.${'a'.repeat(63)}`, `INVALID.${token}`]) assert.equal(parseModeratorInvite(value), null)
})
test('replies whose question is absent remain visible to their recipient', () => {
  const reply = (id: string, questionId: string): Reply => ({ id, questionId, text: '', by: 'Team', audience: 'asker', at: 0 })
  const replies = [reply('one', 'visible'), reply('two', 'private')]
  assert.deepEqual(orphanReplies(replies, [{ id: 'visible' }]).map(item => item.id), ['two'])
})
test('poll results are calculated per voter, including multiple choices and zero votes', () => {
  assert.equal(pollPercent(2, 4), 50)
  assert.equal(pollPercent(0, 0), 0)
  assert.equal(pollPercent(9, 4), 100)
})

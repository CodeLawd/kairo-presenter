import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQuitConfirmation } from '../src/main/quit-confirmation'

test('quit waits for a response, deduplicates requests, and cancel allows retry', () => {
  let prompts = 0
  const confirmation = createQuitConfirmation(() => { prompts++ })
  assert.equal(confirmation.confirm(), false)
  assert.equal(confirmation.confirm(), false)
  assert.equal(prompts, 1)
  assert.equal(confirmation.pending(), true)
  assert.equal(confirmation.respond(false), false)
  assert.equal(confirmation.pending(), false)
  assert.equal(confirmation.confirm(), false)
  assert.equal(prompts, 2)
  assert.equal(confirmation.respond(true), true)
  assert.equal(confirmation.confirm(), true)
  assert.equal(prompts, 2)
})

test('unsolicited approval cannot bypass confirmation', () => {
  const confirmation = createQuitConfirmation(() => {})
  assert.equal(confirmation.respond(true), false)
  assert.equal(confirmation.confirm(), false)
})

test('update installation bypasses confirmation', () => {
  const confirmation = createQuitConfirmation(() => { throw new Error('unexpected prompt') })
  confirmation.allow()
  assert.equal(confirmation.confirm(), true)
})

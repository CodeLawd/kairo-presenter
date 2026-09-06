import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_POLL_INTERVAL_SEC,
  USER_CODE_ALPHABET,
  formatUserCode,
  isTerminalOutcome,
  isValidUserCode,
  nextPollDelaySec,
  normalizeUserCode,
  userCodeFromBytes,
} from '../src/lib/cloud/device-code'

test('a code is read off one screen and typed into another, so ambiguity is removed', () => {
  for (const confusable of ['O', '0', 'I', '1', 'S', '5', 'A', 'E', 'U']) {
    assert.equal(USER_CODE_ALPHABET.includes(confusable), false, confusable)
  }
})

test('codes are generated from the caller supplied randomness, in range', () => {
  const code = userCodeFromBytes([0, 1, 2, 3])
  assert.equal(code, 'PROA-BCDF')
  assert.equal(isValidUserCode(code), true)
})

test('byte values beyond the alphabet wrap rather than produce blanks', () => {
  const code = userCodeFromBytes([255, 254, 253, 252])
  assert.equal(isValidUserCode(code), true)
})

test('what a person actually types is accepted', () => {
  for (const typed of ['proa-7k2x', 'PROA 7K2X', '7K2X', 'proa7k2x', ' PROA-7K2X ']) {
    assert.equal(normalizeUserCode(typed), 'PROA-7K2X', typed)
  }
})

test('a code carrying an excluded character is rejected', () => {
  assert.equal(isValidUserCode('PROA-7K2O'), false)
})

test('a wrong-length code is rejected, never truncated into a different valid one', () => {
  assert.equal(isValidUserCode('PROA-7K2'), false)
  // The dangerous case: one extra character used to slice back to 'PROA-7K2X'
  // and would have paired somebody else's machine.
  assert.equal(isValidUserCode('PROA-7K2XX'), false)
})

test('formatting is idempotent — a formatted code survives a second pass', () => {
  assert.equal(formatUserCode(formatUserCode('7K2X')), 'PROA-7K2X')
})

test('slow_down backs off for good and never exceeds the ceiling', () => {
  let delay = DEVICE_POLL_INTERVAL_SEC
  const seen: number[] = []
  for (let i = 0; i < 10; i++) {
    delay = nextPollDelaySec('slow_down', delay)
    seen.push(delay)
  }
  assert.equal(seen[0], 10)
  assert.equal(seen.at(-1), 30, 'poll interval must be capped')
  // A pending poll keeps the interval it was told to use.
  assert.equal(nextPollDelaySec('pending', 15), 15)
})

test('only a settled answer stops the poll loop', () => {
  assert.equal(isTerminalOutcome('pending'), false)
  assert.equal(isTerminalOutcome('slow_down'), false)
  for (const outcome of ['approved', 'denied', 'expired'] as const) {
    assert.equal(isTerminalOutcome(outcome), true, outcome)
  }
})

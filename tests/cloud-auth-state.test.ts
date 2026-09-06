import assert from 'node:assert/strict'
import test from 'node:test'

import type { SessionSnapshot } from '../src/lib/cloud/contracts'
import {
  MIN_PASSWORD_LENGTH,
  canEnterApp,
  createSingleFlight,
  describeSessionState,
  isSignedIn,
  needsEmailConfirmation,
  shouldOfferAccountGate,
  validateSignUp,
} from '../src/lib/cloud/auth-state'

test('a signup action can only run once while its first request is pending', async () => {
  const flight = createSingleFlight()
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  let calls = 0
  const submit = (): Promise<void> =>
    flight.run(async () => {
      calls += 1
      await pending
    })

  const first = submit()
  const duplicate = submit()

  assert.equal(calls, 1)
  assert.equal(duplicate, first)
  finish()
  await first

  await submit()
  assert.equal(calls, 2)
})

const SIGNED_OUT: SessionSnapshot = {
  state: 'signed-out',
  user: null,
  org: null,
  orgs: [],
  lastSyncedAt: null,
}

const SIGNED_IN: SessionSnapshot = {
  state: 'active',
  user: { id: 'u1', email: 'operator@grace.test', name: 'Joshua', emailVerified: true },
  org: { id: 'o1', name: 'Grace Chapel', role: 'owner' },
  orgs: [{ id: 'o1', name: 'Grace Chapel', role: 'owner' }],
  lastSyncedAt: 1_000,
}

test('the gate stands in front of every signed-out operator', () => {
  assert.equal(shouldOfferAccountGate(SIGNED_OUT), true)
  assert.equal(shouldOfferAccountGate(SIGNED_IN), false)
  assert.equal(isSignedIn(SIGNED_OUT), false)
  assert.equal(isSignedIn(SIGNED_IN), true)
  assert.equal(canEnterApp(SIGNED_OUT), false)
  assert.equal(canEnterApp(SIGNED_IN), true)
})

test('a stale session is still signed in — the gate stays down', () => {
  const stale = { ...SIGNED_IN, state: 'stale' as const }
  assert.equal(shouldOfferAccountGate(stale), false)
  assert.equal(isSignedIn(stale), true)
  assert.equal(canEnterApp(stale), true)
})

test('an unverified account stays on the gate until the email code is entered', () => {
  const unverified: SessionSnapshot = {
    ...SIGNED_IN,
    user: { ...SIGNED_IN.user!, emailVerified: false },
  }
  assert.equal(isSignedIn(unverified), true)
  assert.equal(needsEmailConfirmation(unverified), true)
  assert.equal(canEnterApp(unverified), false)
  assert.equal(shouldOfferAccountGate(unverified), true)
})

test('a stale session reads as offline, never as an error', () => {
  const stale = describeSessionState({ ...SIGNED_IN, state: 'stale' })
  assert.equal(stale.label, 'Offline')
  assert.equal(stale.tone, 'warn')
  // Crucially it does not read as signed out — nothing has been lost.
  assert.match(stale.detail, /Signed in/)
  assert.match(stale.detail, /Nothing is interrupted/)
})

test('a signed-in chip names the church, not the product', () => {
  const active = describeSessionState(SIGNED_IN)
  assert.equal(active.label, 'Grace Chapel')
  assert.equal(active.tone, 'good')
})

test('signed out tells the operator they need an account', () => {
  const out = describeSessionState(SIGNED_OUT)
  assert.equal(out.tone, 'neutral')
  assert.match(out.detail, /Sign in/)
})

test('sign-up validation matches what the API will accept', () => {
  assert.equal(
    validateSignUp({
      name: 'Joshua',
      churchName: 'Grace Chapel',
      email: 'a@b.co',
      password: 'x'.repeat(MIN_PASSWORD_LENGTH),
    }),
    null,
  )
  assert.match(validateSignUp({ name: ' ', churchName: 'Grace', email: 'a@b.co', password: 'x'.repeat(12) })!, /name/i)
  assert.match(validateSignUp({ name: 'J', churchName: ' ', email: 'a@b.co', password: 'x'.repeat(12) })!, /church/i)
  assert.match(validateSignUp({ name: 'J', churchName: 'Grace', email: 'not-an-email', password: 'x'.repeat(12) })!, /email/i)
  assert.match(validateSignUp({ name: 'J', churchName: 'Grace', email: 'a@b.co', password: 'short' })!, /10 characters/)
})

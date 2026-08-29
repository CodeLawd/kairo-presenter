import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PP_CONNECT_SUCCESS_HOLD_MS,
  ppLaunchOutcomeFromStatus,
  shouldOfferPpConnectGate,
} from '../src/lib/pp-connect-gate'

test('the gate stays hidden until the silent launch handshake finishes', () => {
  assert.equal(
    shouldOfferPpConnectGate({ sessionResolved: false, launch: 'pending' }),
    false,
  )
})

test('a live ProPresenter on open never shows the connect modal', () => {
  assert.equal(
    shouldOfferPpConnectGate({ sessionResolved: false, launch: 'connected' }),
    false,
  )
})

test('the gate only appears when the launch handshake cannot reach PP', () => {
  assert.equal(
    shouldOfferPpConnectGate({ sessionResolved: false, launch: 'unavailable' }),
    true,
  )
})

test('skipping or finishing the gate hides it for the rest of the session', () => {
  assert.equal(
    shouldOfferPpConnectGate({ sessionResolved: true, launch: 'unavailable' }),
    false,
  )
})

test('a connected status from the silent handshake skips the modal', () => {
  assert.equal(ppLaunchOutcomeFromStatus('connected'), 'connected')
})

test('any other status after the silent handshake is treated as unavailable', () => {
  assert.equal(ppLaunchOutcomeFromStatus('disconnected'), 'unavailable')
  assert.equal(ppLaunchOutcomeFromStatus('error'), 'unavailable')
  assert.equal(ppLaunchOutcomeFromStatus('connecting'), 'unavailable')
})

test('success holds long enough to read the checkmark', () => {
  assert.ok(PP_CONNECT_SUCCESS_HOLD_MS >= 800)
})

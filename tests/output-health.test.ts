import assert from 'node:assert/strict'
import test from 'node:test'
import type { OverlayDispatchResult, OverlayOutputKind } from '../src/lib/ipc'
import { dispatchHealth } from '../src/lib/output-health'

function result(kind: OverlayOutputKind, ok: boolean, reason?: string): OverlayDispatchResult {
  return { outputId: kind, name: kind, kind, ok, ...(reason ? { reason } : {}) }
}

test('successful standalone destinations report healthy output', () => {
  assert.deepEqual(dispatchHealth([result('screen', true), result('ndi', true), result('device', true)]), { output: { status: 'ok' } })
})

test('partial fan-out failure is degraded and identifies the failed destination', () => {
  const health = dispatchHealth([result('screen', true), result('device', false, 'Device disconnected')])
  assert.equal(health.output.status, 'degraded')
  assert.match(health.output.lastError!, /device \(Device disconnected\)/)
})

test('all destinations failing produces an output error', () => {
  const health = dispatchHealth([result('screen', false, 'Display not connected'), result('ndi', false)])
  assert.equal(health.output.status, 'error')
  assert.match(health.output.lastError!, /screen \(Display not connected\); ndi \(unknown\)/)
})

test('an empty dispatch reports no enabled outputs', () => {
  assert.deepEqual(dispatchHealth([]), { output: { status: 'error', lastError: 'No outputs are enabled' } })
})

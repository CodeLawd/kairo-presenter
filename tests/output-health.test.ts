import assert from 'node:assert/strict'
import test from 'node:test'

import type { OverlayDispatchResult, OverlayOutputKind } from '../src/lib/ipc'
import { dispatchHealth } from '../src/lib/output-health'
import { layerOfKind } from '../src/lib/overlay-outputs'

function result(kind: OverlayOutputKind, ok: boolean, reason?: string): OverlayDispatchResult {
  return { outputId: kind, name: kind, kind, layer: layerOfKind(kind), ok, ...(reason ? { reason } : {}) }
}

test('a screen-only push with ProPresenter offline is healthy on both lines', () => {
  const health = dispatchHealth([result('screen', true)], { ppOffline: true, usesPropresenter: false })
  assert.equal(health.output.status, 'ok')
  assert.equal(health.propresenter.status, 'ok')
})

test('PP outputs failing fast while offline: output degraded, PP red only when the setup uses it', () => {
  const results = [result('screen', true), result('stage', false, 'ProPresenter is not connected')]
  const health = dispatchHealth(results, { ppOffline: true, usesPropresenter: true })
  assert.equal(health.output.status, 'degraded')
  assert.match(health.output.lastError!, /stage \(ProPresenter is not connected\)/)
  assert.equal(health.propresenter.status, 'error')
})

test('nothing reached a screen is an output error', () => {
  const health = dispatchHealth([result('screen', false, 'Display not connected')], {
    ppOffline: false,
    usesPropresenter: false,
  })
  assert.equal(health.output.status, 'error')
  assert.equal(health.propresenter.status, 'ok')
  assert.equal(dispatchHealth([], { ppOffline: false, usesPropresenter: true }).output.status, 'error')
})

test('a screen failure never marks ProPresenter degraded', () => {
  const health = dispatchHealth([result('screen', false, 'Display not connected'), result('library', true)], {
    ppOffline: false,
    usesPropresenter: true,
  })
  assert.equal(health.output.status, 'degraded')
  assert.equal(health.propresenter.status, 'ok')
})

test('a rejected PP output while connected degrades ProPresenter', () => {
  const health = dispatchHealth([result('ndi', true), result('message', false, 'rejected')], {
    ppOffline: false,
    usesPropresenter: true,
  })
  assert.equal(health.propresenter.status, 'degraded')
})

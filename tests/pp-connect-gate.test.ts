import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ndiRoutedThroughPropresenter,
  ppLaunchOutcomeFromStatus,
  propresenterEnabled,
  setupUsesPropresenter,
} from '../src/lib/pp-connect-gate'
import { makeOverlayOutput } from '../src/lib/overlay-defaults'
import type { OverlayOutput } from '../src/lib/ipc'

test('a connected status from the silent launch probe reads as connected', () => {
  assert.equal(ppLaunchOutcomeFromStatus('connected'), 'connected')
})

test('any other status after the silent launch probe reads as unavailable', () => {
  assert.equal(ppLaunchOutcomeFromStatus('disconnected'), 'unavailable')
  assert.equal(ppLaunchOutcomeFromStatus('error'), 'unavailable')
  assert.equal(ppLaunchOutcomeFromStatus('connecting'), 'unavailable')
})

// ─── Does this setup use ProPresenter at all? ─────────────────────────────────

function outputs(...list: Array<{ kind: OverlayOutput['kind']; enabled?: boolean; ppVideoInputUuid?: string }>) {
  return {
    outputs: list.map((o, i) =>
      makeOverlayOutput(`o${i}`, o.kind, { enabled: o.enabled ?? true, ppVideoInputUuid: o.ppVideoInputUuid ?? '' }),
    ),
  }
}

test('a Kairo-screens-only setup does not use ProPresenter', () => {
  assert.equal(setupUsesPropresenter(outputs({ kind: 'screen' })), false)
})

test('an NDI output uses ProPresenter only once it is bound to a PP video input', () => {
  assert.equal(setupUsesPropresenter(outputs({ kind: 'ndi' })), false)
  assert.equal(setupUsesPropresenter(outputs({ kind: 'ndi', ppVideoInputUuid: 'uuid-1' })), true)
})

test('an NDI output bound only through the resources step still uses ProPresenter', () => {
  // The orchestrator prefers propresenterResources.ndiVideoInputId over the
  // per-output uuid, so a setup bound that way must connect PP at launch.
  assert.equal(setupUsesPropresenter(outputs({ kind: 'ndi' }), 'uuid-from-resources'), true)
  assert.equal(setupUsesPropresenter(outputs({ kind: 'ndi', enabled: false }), 'uuid-from-resources'), false)
  // A resource binding says nothing about a screen.
  assert.equal(setupUsesPropresenter(outputs({ kind: 'screen' }), 'uuid-from-resources'), false)
})

test('only the primary NDI output with a PP video input is routed through ProPresenter', () => {
  const list = outputs({ kind: 'ndi' }, { kind: 'ndi' }, { kind: 'screen' }).outputs
  const [primary, extra, screen] = list
  assert.equal(ndiRoutedThroughPropresenter(primary, list), false)
  assert.equal(ndiRoutedThroughPropresenter(primary, list, 'uuid-1'), true)
  assert.equal(ndiRoutedThroughPropresenter({ ...primary, ppVideoInputUuid: 'uuid-2' }, list), true)
  // Extra feeds never reach PP, bound or not.
  assert.equal(ndiRoutedThroughPropresenter({ ...extra, ppVideoInputUuid: 'uuid-3' }, list, 'uuid-1'), false)
  assert.equal(ndiRoutedThroughPropresenter(screen, list, 'uuid-1'), false)
})

test('any enabled library, message or stage output uses ProPresenter', () => {
  assert.equal(setupUsesPropresenter(outputs({ kind: 'screen' }, { kind: 'message' })), true)
  assert.equal(setupUsesPropresenter(outputs({ kind: 'screen' }, { kind: 'stage', enabled: false })), false)
})

// ─── The integration switch ───────────────────────────────────────────────────

test('ProPresenter is off unless the operator switched it on', () => {
  assert.equal(propresenterEnabled({ propresenter: { host: 'localhost', port: 1, password: '' } as never }), false)
  assert.equal(propresenterEnabled({ propresenter: { enabled: false } }), false)
  assert.equal(propresenterEnabled({ propresenter: { enabled: true } }), true)
  assert.equal(propresenterEnabled({}), false)
})

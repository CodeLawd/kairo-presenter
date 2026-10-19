import { it } from 'node:test'
import assert from 'node:assert/strict'
import { makeOverlayOutput, normalizeOverlaySettings } from '../src/lib/overlay-defaults'
import { getDispatchPlan, surfaceOutputs, primaryRenderedOutput } from '../src/lib/overlay-outputs'

it('retains device bindings and routes them independently of ProPresenter', () => {
  const outputs = normalizeOverlaySettings({ outputs: [{ id: 'card', kind: 'device', enabled: true,
    devicePortId: 'fake:1', devicePortLabel: 'Test card · SDI 1', deviceModeId: 'fake:mode', deviceKeyFill: true }] }).outputs
  const device = outputs.find((output) => output.id === 'card')!
  assert.equal(device.kind, 'device')
  assert.equal(device.devicePortId, 'fake:1')
  assert.equal(device.deviceKeyFill, true)
  assert.deepEqual(getDispatchPlan([device]).rendered.map((output) => output.id), ['card'])
  assert.equal(primaryRenderedOutput([device])?.id, 'card')
})

it('device playlist outputs ignore service pushes while disabled outputs stay excluded', () => {
  const device = makeOverlayOutput('card', 'device', { enabled: true })
  assert.equal(surfaceOutputs([device]).length, 1)
  assert.equal(surfaceOutputs([{ ...device, source: 'playlist' }]).length, 0)
  assert.equal(getDispatchPlan([{ ...device, source: 'playlist' }]).rendered.length, 0)
  assert.equal(surfaceOutputs([{ ...device, enabled: false }]).length, 0)
  const saved = normalizeOverlaySettings({ outputs: [{ ...device, source: 'playlist', playlistId: 'lobby' }] })
  assert.equal(saved.outputs[0].source, 'playlist')
  assert.equal(saved.outputs[0].playlistId, 'lobby')
})

it('clears device-only fields on other output kinds', () => {
  const saved = normalizeOverlaySettings({ outputs: [{ id: 'ndi', kind: 'ndi', devicePortId: 'old', deviceKeyFill: true }] })
  assert.equal(saved.outputs[0].devicePortId, '')
  assert.equal(saved.outputs[0].deviceKeyFill, false)
})

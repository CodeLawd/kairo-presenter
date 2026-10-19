import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retireProPresenterSettings } from '../src/lib/pp-retirement'
import { makeOverlayOutput, normalizeOverlaySettings } from '../src/lib/overlay-defaults'

test('mixed upgrade removes PP destinations and bindings while preserving Kairo outputs', () => {
  const screen = { ...makeOverlayOutput('room', 'screen', { enabled: true, displayId: 24 }), lookId: 'look' }
  const ndi = { ...makeOverlayOutput('stream', 'ndi', { enabled: true }), ppVideoInputUuid: 'input' }
  const settings = { propresenter: { enabled: true, password: 'secret' }, propresenterResources: { lookId: 'look' }, overlay: { outputs: [screen, { id: 'old', kind: 'message', enabled: true }, ndi], ppVideoInputUuid: 'old', mode: 'auto' } }
  const result = retireProPresenterSettings(settings)
  assert.equal('propresenter' in result, false)
  assert.equal('propresenterResources' in result, false)
  assert.deepEqual(result.overlay.outputs.map(o => o.id), ['room', 'stream'])
  assert.equal(result.overlay.outputs[0].displayId, 24)
  assert.equal('lookId' in result.overlay.outputs[0], false)
  assert.equal('ppVideoInputUuid' in result.overlay.outputs[1], false)
  assert.equal('mode' in result.overlay, false)
  assert.deepEqual(settings.overlay.outputs[0], screen)
})

test('PP-only upgrade never enables an arbitrary output', () => {
  const result = retireProPresenterSettings({ overlay: { outputs: [{ id: 'old', kind: 'library', enabled: true }] } })
  const outputs = normalizeOverlaySettings(result.overlay).outputs
  // The retired output is gone; Audience falls back to its default Main Screen.
  assert.equal(outputs.some((o) => o.id === 'old'), false)
  assert.deepEqual(outputs.map((o) => [o.kind, o.name]), [['screen', 'Main Screen']])
})

test('repeated migration removes obsolete notice state and preserves imported content', () => {
  const result = retireProPresenterSettings({ retirementNotice: false, songs: [{ source: 'propresenter', text: 'Saved song' }], overlay: { outputs: [] } })
  assert.equal('retirementNotice' in result, false)
  assert.deepEqual(retireProPresenterSettings(result), result)
  assert.deepEqual(result.songs, [{ source: 'propresenter', text: 'Saved song' }])
})

test('normalization drops retired and unknown output kinds on imported settings', () => {
  const result = normalizeOverlaySettings({ outputs: [{ id: 'one', kind: 'message', enabled: true }, { id: 'two', kind: 'unknown', enabled: true }, makeOverlayOutput('ndi', 'ndi')] })
  assert.deepEqual(result.outputs.map(o => o.kind), ['ndi'])
})

test('legacy message-only stores do not become an enabled NDI feed', () => {
  const result = normalizeOverlaySettings({ mode: 'message' })
  assert.equal(result.outputs.some(o => o.enabled), false)
})

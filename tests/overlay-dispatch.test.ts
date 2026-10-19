import assert from 'node:assert/strict'
import test from 'node:test'
import { makeOverlayOutput } from '../src/lib/overlay-defaults'
import { followsProgram, getDispatchPlan, outputDestinationLabel, surfaceOutputs } from '../src/lib/overlay-outputs'

test('screens, devices and every NDI feed receive independent program pushes', () => {
  const outputs = [
    makeOverlayOutput('projector', 'screen', { enabled: true }),
    makeOverlayOutput('card', 'device', { enabled: true }),
    makeOverlayOutput('main', 'ndi', { enabled: true }),
    makeOverlayOutput('stream', 'ndi', { enabled: true }),
    makeOverlayOutput('off', 'screen', { enabled: false }),
  ]
  assert.deepEqual(getDispatchPlan(outputs).rendered.map(o => o.id), ['projector', 'card', 'main', 'stream'])
  assert.deepEqual(surfaceOutputs(outputs).map(o => o.id), ['projector', 'card', 'main', 'stream'])
  assert.deepEqual(getDispatchPlan([]), { rendered: [], fallbacks: [] })
})

test('content filters apply independently to normal and fallback outputs', () => {
  const outputs = [
    makeOverlayOutput('screen', 'screen', { enabled: true, show: { ...makeOverlayOutput('defaults', 'screen').show, lyrics: false } }),
    makeOverlayOutput('feed', 'ndi', { enabled: true }),
    makeOverlayOutput('fallback-off', 'device', { enabled: true, fallbackOnly: true, show: { ...makeOverlayOutput('defaults', 'screen').show, lyrics: false } }),
    makeOverlayOutput('fallback', 'ndi', { enabled: true, fallbackOnly: true }),
  ]
  const plan = getDispatchPlan(outputs, o => o.show.lyrics)
  assert.deepEqual(plan.rendered.map(o => o.id), ['feed'])
  assert.deepEqual(plan.fallbacks.map(o => o.id), ['fallback'])
})

test('fallbacks are held back and ordered; disabled and playlist destinations are excluded', () => {
  const outputs = [
    makeOverlayOutput('late', 'ndi', { enabled: true, fallbackOnly: true, order: 9 }),
    makeOverlayOutput('early', 'screen', { enabled: true, fallbackOnly: true, order: 1 }),
    makeOverlayOutput('off', 'ndi', { enabled: false, fallbackOnly: true }),
    makeOverlayOutput('lobby', 'screen', { enabled: true, source: 'playlist', fallbackOnly: true }),
    makeOverlayOutput('card', 'device', { enabled: true, source: 'playlist' }),
  ]
  assert.deepEqual(getDispatchPlan(outputs).rendered, [])
  assert.deepEqual(getDispatchPlan(outputs).fallbacks.map(o => o.id), ['early', 'late'])
  assert.deepEqual(surfaceOutputs(outputs).map(o => o.id), ['late', 'early'])
  assert.equal(followsProgram(outputs[3]), false)
  assert.equal(followsProgram(outputs[4]), false)
})

test('destination labels describe standalone destinations', () => {
  assert.equal(outputDestinationLabel('screen'), 'Kairo screen')
  assert.equal(outputDestinationLabel('device'), 'Video card')
  assert.equal(outputDestinationLabel('ndi'), 'NDI feed')
})

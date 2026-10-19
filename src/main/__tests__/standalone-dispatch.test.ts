import test from 'node:test'
import assert from 'node:assert/strict'
import { makeOverlayOutput } from '@shared/overlay-defaults'
import { dispatchToOutputs } from '../services/output/dispatch'

function output(kind: 'screen' | 'device' | 'ndi', id: string) {
  return { ...makeOverlayOutput(id, kind), id, enabled: true }
}

test('scripture reaches screens, devices and NDI immediately without a connection gate', async () => {
  const destinations = [output('screen', 'screen'), output('device', 'device'), output('ndi', 'ndi')]
  const seen: string[] = []
  const results = await dispatchToOutputs(destinations, 'scripture', async (destination) => {
    seen.push(destination.id)
    return null
  })
  assert.deepEqual(seen, ['screen', 'device', 'ndi'])
  assert.equal(results.filter((result) => result.ok).length, 3)
})

test('lyrics respect content filters and independent playlist screens', async () => {
  const hidden = output('ndi', 'filtered')
  hidden.show = { ...hidden.show, lyrics: false }
  const lobby = { ...output('screen', 'lobby'), source: 'playlist' as const }
  const seen: string[] = []
  await dispatchToOutputs([hidden, lobby, output('screen', 'program')], 'lyrics', async (destination) => {
    seen.push(destination.id)
    return null
  })
  assert.deepEqual(seen, ['program'])
})

test('a failed destination does not prevent others and fallback runs only when needed', async () => {
  const fallback = { ...output('ndi', 'fallback'), fallbackOnly: true }
  const results = await dispatchToOutputs([output('screen', 'screen'), output('device', 'device'), fallback], 'scripture', async (destination) => {
    if (destination.id === 'screen') throw new Error('Screen disconnected')
    return null
  })
  assert.deepEqual(results.map((result) => [result.outputId, result.ok]), [['screen', false], ['device', true]])
  const recovered = await dispatchToOutputs([output('screen', 'screen'), fallback], 'scripture', async (destination) => destination.id === 'screen' ? 'Screen disconnected' : null)
  assert.deepEqual(recovered.map((result) => [result.outputId, result.ok]), [['screen', false], ['fallback', true]])
})

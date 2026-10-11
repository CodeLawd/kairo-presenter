import { it } from 'node:test'
import assert from 'node:assert/strict'
import { loadVideoDeviceProvider } from '../provider-loader'
import { FakeVideoDeviceProvider } from './fake-provider'

it('loads an available provider only on a supported tuple', () => {
  const provider = new FakeVideoDeviceProvider()
  const registration = { name: 'fake', tuples: ['darwin:arm64'], load: () => provider }
  assert.deepEqual(loadVideoDeviceProvider(registration, 'darwin', 'arm64'), { ok: true, provider })
  let loaded = false
  const result = loadVideoDeviceProvider({ ...registration, load: () => { loaded = true; return provider } }, 'linux', 'x64')
  assert.equal(result.ok, false)
  assert.equal(loaded, false)
  if (!result.ok) assert.equal(result.code, 'unsupported-tuple')
})

it('returns a driver reason without exposing an unusable provider', () => {
  const provider = new FakeVideoDeviceProvider()
  provider.availability = { available: false, reason: 'Driver missing' }
  assert.deepEqual(loadVideoDeviceProvider({ name: 'fake', tuples: ['darwin:arm64'], load: () => provider }, 'darwin', 'arm64'),
    { ok: false, providerName: 'fake', code: 'runtime-unavailable', reason: 'Driver missing' })
})

it('contains module load and status exceptions', () => {
  for (const load of [
    () => { throw new Error('dlopen failed') },
    () => { const provider = new FakeVideoDeviceProvider(); provider.status = () => { throw new Error('status failed') }; return provider },
  ]) {
    const result = loadVideoDeviceProvider({ name: 'fake', tuples: ['darwin:arm64'], load }, 'darwin', 'arm64')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'load-failed')
  }
})

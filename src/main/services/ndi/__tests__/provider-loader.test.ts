import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadNdiProvider,
  isSupportedTuple,
  type RequireFn,
} from '../provider-loader'
import { createGrandioseMacProvider, createGrandiProvider } from '../provider'

function requireStub(modules: Record<string, unknown>): RequireFn {
  return (id: string) => {
    if (id in modules) return modules[id]
    throw new Error(`Cannot find module '${id}'`)
  }
}

const grandioseNative = {
  version: () => 'NDI SDK 5.5.2-test',
  send: async () => ({ video: async () => {} }),
}

const grandiNative = {
  version: () => 'NDI SDK 6-test',
  send: async () => ({ video: async () => {} }),
  find: async () => ({ wait: async () => {}, sources: () => [], destroy: () => {} }),
}

describe('ndi provider-loader', () => {
  it('supports the four release tuples', () => {
    assert.equal(isSupportedTuple('darwin', 'arm64'), true)
    assert.equal(isSupportedTuple('darwin', 'x64'), true)
    assert.equal(isSupportedTuple('win32', 'x64'), true)
    assert.equal(isSupportedTuple('linux', 'x64'), true)
  })

  it('rejects unsupported tuples without throwing', () => {
    for (const [platform, arch] of [
      ['win32', 'arm64'],
      ['linux', 'arm64'],
      ['darwin', 'ia32'],
    ] as const) {
      const result = loadNdiProvider(platform, arch, requireStub({}))
      assert.equal(result.ok, false)
    }
  })

  it('prefers grandi over grandiose-mac', () => {
    const result = loadNdiProvider(
      'darwin',
      'arm64',
      requireStub({ '@grandi/darwin-arm64': grandiNative, 'grandiose-mac': grandioseNative }),
    )
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.adapter, 'grandi')
  })

  it('loads the platform prebuild directly instead of the incompatible ESM wrapper', () => {
    const requested: string[] = []
    const result = loadNdiProvider('win32', 'x64', (id) => {
      requested.push(id)
      if (id === '@grandi/win32-x64') return grandiNative
      throw new Error(`unexpected ${id}`)
    })
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.adapter, 'grandi')
    assert.equal(requested[0], '@grandi/win32-x64')
  })

  it('falls back to grandiose-mac when grandi is absent', () => {
    const result = loadNdiProvider('darwin', 'arm64', requireStub({ 'grandiose-mac': grandioseNative }))
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.adapter, 'grandiose-mac')
  })

  it('returns unavailable when no binding loads', () => {
    const result = loadNdiProvider('linux', 'x64', requireStub({}))
    assert.equal(result.ok, false)
  })

  it('returns unavailable when native require throws', () => {
    const throwing: RequireFn = () => {
      throw new Error('dlopen failed')
    }
    const result = loadNdiProvider('win32', 'x64', throwing)
    assert.equal(result.ok, false)
  })

  it('grandiose-mac adapter maps send/version', async () => {
    const provider = createGrandioseMacProvider(grandioseNative)
    assert.equal(provider.name, 'grandiose-mac')
    assert.equal(provider.version(), 'NDI SDK 5.5.2-test')
    const sender = await provider.createSender({ name: 'test' })
    await sender.sendVideo({
      xres: 2, yres: 2, frameRateN: 30000, frameRateD: 1001,
      pictureAspectRatio: 1, frameFormatType: 1, lineStrideBytes: 8,
      data: Buffer.alloc(16), fourCC: 1095911234,
    })
  })

  it('grandi adapter maps version/find', async () => {
    const provider = createGrandiProvider(grandiNative)
    assert.equal(provider.name, 'grandi')
    assert.equal(provider.version(), 'NDI SDK 6-test')
    assert.deepEqual(await provider.findSources?.(1), [])
  })
})

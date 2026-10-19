import assert from 'node:assert/strict'
import test from 'node:test'
import { SyphonChannel, loadSyphon, type SyphonAddon, type SyphonLoad } from '../src/main/services/syphon'

type Handle = Parameters<SyphonAddon['close']>[0]

/** A stand-in addon that records what the channel asks of it. */
function fakeAddon(options: { busy?: boolean; failOpen?: boolean; throwOnPublish?: boolean } = {}) {
  const calls: string[] = []
  let pendingDone: ((error: Error | null) => void) | null = null
  const addon: SyphonAddon = {
    available: () => ({ ok: true }),
    open: ({ name }) => {
      calls.push(`open ${name}`)
      if (options.failOpen) throw new Error('open: Syphon server could not start')
      return {} as Handle
    },
    publish: (_server, _handle, done) => {
      calls.push('publish')
      if (options.throwOnPublish) throw new Error('publish: IOSurface is not BGRA')
      if (options.busy) return false
      pendingDone = done
      return true
    },
    publishPixels: (_server, bgra, width, height) => {
      calls.push(`pixels ${width}x${height} ${bgra.every((b) => b === 0) ? 'clear' : 'image'}`)
      return true
    },
    close: () => { calls.push('close') },
    stats: () => ({ published: 0, skipped: 0, failed: 0, hasClients: false }),
  }
  const load = (): SyphonLoad => ({ ok: true, addon })
  return { load, calls, finish: () => pendingDone?.(null) }
}

function texture() {
  let released = 0
  return { textureInfo: { sharedTextureHandle: Buffer.alloc(8) }, release: () => { released++ }, released: () => released }
}

test('the server starts on the first frame, once, under the output name', () => {
  const fake = fakeAddon()
  const channel = new SyphonChannel('Kairo Lower Third', fake.load)
  channel.publish(texture())
  fake.finish()
  channel.publish(texture())
  assert.deepEqual(fake.calls.filter((c) => c.startsWith('open')), ['open Kairo Lower Third'])
})

test('a published texture is released only once the GPU copy is done', () => {
  const fake = fakeAddon()
  const channel = new SyphonChannel('Kairo', fake.load)
  const t = texture()
  channel.publish(t)
  assert.equal(t.released(), 0, 'held while the copy runs')
  fake.finish()
  assert.equal(t.released(), 1)
})

test('a frame dropped while busy, or one that fails, is released at once', () => {
  const busy = fakeAddon({ busy: true })
  const t1 = texture()
  new SyphonChannel('Kairo', busy.load).publish(t1)
  assert.equal(t1.released(), 1)

  const broken = fakeAddon({ throwOnPublish: true })
  const t2 = texture()
  new SyphonChannel('Kairo', broken.load).publish(t2)
  assert.equal(t2.released(), 1)
})

test('when Syphon is unavailable, frames are released and the reason is reported', () => {
  const channel = new SyphonChannel('Kairo', () => ({ ok: false, reason: 'Syphon is only available on a Mac' }))
  const t = texture()
  channel.publish(t)
  assert.equal(t.released(), 1)
  assert.deepEqual(channel.getStatus(), { available: false, reason: 'Syphon is only available on a Mac' })
})

test('a server that fails to start says why, and frames are still released', () => {
  const fake = fakeAddon({ failOpen: true })
  const channel = new SyphonChannel('Kairo', fake.load)
  const t = texture()
  channel.publish(t)
  assert.equal(t.released(), 1)
  assert.deepEqual(channel.getStatus(), { available: false, reason: 'open: Syphon server could not start' })
})

test('clearing publishes a transparent frame, but never starts a server just to clear it', () => {
  const fake = fakeAddon()
  const channel = new SyphonChannel('Kairo', fake.load)
  channel.clearFrame(4, 2)
  assert.deepEqual(fake.calls, [], 'nothing to clear before the first frame')
  channel.publishPixels(Buffer.alloc(32, 255), 4, 2)
  channel.clearFrame(4, 2)
  assert.deepEqual(fake.calls, ['open Kairo', 'pixels 4x2 image', 'pixels 4x2 clear'])
})

test('stopping closes the server once; a later frame starts a fresh one', () => {
  const fake = fakeAddon()
  const channel = new SyphonChannel('Kairo', fake.load)
  channel.publishPixels(Buffer.alloc(8), 1, 2)
  channel.stop()
  channel.stop()
  channel.publishPixels(Buffer.alloc(8), 1, 2)
  assert.deepEqual(fake.calls.filter((c) => c === 'close' || c.startsWith('open')), ['open Kairo', 'close', 'open Kairo'])
})

test('Syphon is only offered on a Mac, and a missing addon is a reason, not a crash', () => {
  assert.deepEqual(loadSyphon(() => ({}), 'win32', []), { ok: false, reason: 'Syphon is only available on a Mac' })
  const missing = loadSyphon(() => { throw new Error('Cannot find module') }, 'darwin', ['/nowhere/syphon.node'])
  assert.equal(missing.ok, false)
  assert.match(missing.ok ? '' : missing.reason, /Syphon addon not loaded/)
})

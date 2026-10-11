import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { addonCandidates, loadGpuFrames, type GpuFramesAddon, type GpuFramesLoad } from '../index'
import { GpuCapture } from '../../output/gpu-capture'
import { DeckLinkProvider } from '../../video-devices/providers/decklink'
import { NdiService } from '../../ndi'
import type { NdiVideoFrame } from '../../ndi/provider'

type Done = (error: Error | null, result?: Buffer | { slot: number; sequence: number }) => void

/** An addon double: `convert` parks callbacks so tests decide when the GPU "finishes". */
function fakeAddon(opts: { slots?: number; throwOnConvert?: boolean } = {}) {
  const pending: Done[] = []
  const calls = { open: [] as unknown[], close: 0, rings: [] as string[], closedRings: 0 }
  const addon = {
    available: () => ({ ok: true, device: 'Fake GPU' }),
    open: (options: unknown) => { calls.open.push(options); return {} },
    convert: (_c: unknown, _h: Buffer, done: Done) => {
      if (opts.throwOnConvert) throw new Error('IOSurface is not BGRA')
      if (pending.length >= (opts.slots ?? 3)) return false
      pending.push(done)
      return true
    },
    close: () => { calls.close++ },
    stats: () => ({ converted: 0, skipped: 0, failed: 0, inFlight: pending.length }),
    createRing: (name: string) => { calls.rings.push(name); return {} },
    closeRing: () => { calls.closedRings++ },
  } as unknown as GpuFramesAddon
  return { addon, pending, calls, load: { ok: true, addon, device: 'Fake GPU' } as GpuFramesLoad }
}

function texture() {
  const t = { released: 0, textureInfo: { sharedTextureHandle: Buffer.alloc(8) }, release: () => { t.released++ } }
  return t
}

describe('gpu-frames loader', () => {
  it('stays on the CPU path off macOS, when disabled, or when the addon is missing', () => {
    assert.match((loadGpuFrames(() => ({}), 'win32') as { reason: string }).reason, /macOS-only/)
    assert.match((loadGpuFrames(() => ({}), 'darwin', { KAIRO_GPU_CAPTURE: '0' }) as { reason: string }).reason, /disabled/)
    const missing = loadGpuFrames(() => { throw new Error('Cannot find module') }, 'darwin', {}, ['/nope/gpu_frames.node'])
    assert.equal(missing.ok, false)
    assert.match((missing as { reason: string }).reason, /\/nope\/gpu_frames\.node: Cannot find module/)
  })

  it('reports a GPU the addon cannot use instead of loading it', () => {
    const result = loadGpuFrames(() => ({ available: () => ({ ok: false, reason: 'No Metal device' }) }), 'darwin', {}, ['/x.node'])
    assert.deepEqual(result, { ok: false, reason: 'No Metal device' })
  })

  it('looks in packaged resources before the dev build', () => {
    // join(), so the expectations use the separator of the OS running the tests.
    assert.deepEqual(addonCandidates('/App/Resources', '/repo'), [
      join('/App/Resources', 'gpu-frames', 'gpu_frames.node'),
      join('/repo', 'native', 'gpu-frames', 'build', 'gpu_frames.node'),
    ])
  })
})

describe('GpuCapture', () => {
  it('releases every texture: after the GPU, at once when busy, and when convert throws', () => {
    const { load, pending } = fakeAddon({ slots: 1 })
    const delivered: Buffer[] = []
    const opened = GpuCapture.create(load, { kind: 'ndi', deliver: (frame) => delivered.push(frame) }, () => assert.fail('no fallback'))
    assert.ok('capture' in opened)
    const first = texture(), second = texture()
    opened.capture.handle(first)
    assert.equal(first.released, 0, 'held only while the GPU uses it')
    opened.capture.handle(second)
    assert.equal(second.released, 1, 'busy converter: dropped and released now, never queued')
    pending.shift()!(null, Buffer.alloc(1920 * 1080 * 3))
    assert.equal(first.released, 1)
    assert.equal(delivered.length, 1)
    opened.capture.close()
  })

  it('opens NDI as 1080p UYVA and cards at the ring raster', () => {
    const { load, calls } = fakeAddon()
    const ndi = GpuCapture.create(load, { kind: 'ndi', deliver: () => {} }, () => {})
    const ring = { name: '/kgf.1.1', width: 1280, height: 720, handle: { ring: true }, close: () => {} } as never
    const card = GpuCapture.create(load, { kind: 'ring', ring }, () => {})
    assert.deepEqual(calls.open[0], { width: 1920, height: 1080, alpha: true })
    assert.deepEqual(calls.open[1], { width: 1280, height: 720, ring: { ring: true } })
    for (const c of [ndi, card]) if ('capture' in c) c.capture.close()
  })

  it('falls back once on the first error, and keeps releasing textures afterwards', () => {
    const { load, pending } = fakeAddon()
    const reasons: string[] = []
    const opened = GpuCapture.create(load, { kind: 'ndi', deliver: () => {} }, (reason) => reasons.push(reason))
    assert.ok('capture' in opened)
    const a = texture(), b = texture(), c = texture()
    opened.capture.handle(a)
    opened.capture.handle(b)
    pending.shift()!(new Error('GPU conversion failed: timeout'))
    pending.shift()!(new Error('again'))
    assert.deepEqual(reasons, ['GPU conversion failed: timeout'])
    opened.capture.handle(c)
    assert.deepEqual([a.released, b.released, c.released], [1, 1, 1])
  })

  it('an addon that throws on convert falls back and still releases', () => {
    const { load } = fakeAddon({ throwOnConvert: true })
    const reasons: string[] = []
    const opened = GpuCapture.create(load, { kind: 'ndi', deliver: () => {} }, (reason) => reasons.push(reason))
    assert.ok('capture' in opened)
    const t = texture()
    opened.capture.handle(t)
    assert.equal(t.released, 1)
    assert.deepEqual(reasons, ['IOSurface is not BGRA'])
  })

  it('explains why the CPU path is used', () => {
    assert.deepEqual(GpuCapture.create({ ok: false, reason: 'no addon' }, { kind: 'ndi', deliver: () => {} }, () => {}), { reason: 'no addon' })
    assert.deepEqual(GpuCapture.create(fakeAddon().load, null, () => {}), { reason: 'sink has no GPU frame path' })
  })
})

describe('DeckLink GPU frame ring', () => {
  const port = {
    id: 'decklink:1:0', provider: 'decklink', deviceName: 'Duo 2', portName: 'SDI 1', supportsKeyFill: false, unavailableReason: null,
    modes: [{ id: 'decklink:1', label: '720p50', width: 1280, height: 720, frameRateN: 50, frameRateD: 1, interlaced: false }],
  }
  function provider(load: GpuFramesLoad, ringStatus: unknown) {
    const opened: unknown[] = []
    let closed = 0
    const p = new DeckLinkProvider('/helper', '/worker.js', '/runtime', () => load, (async (_path: string, data: unknown) => {
      opened.push(data)
      return { ringStatus, setFrame: () => {}, close: async () => { closed++ } }
    }) as never)
    ;(p as unknown as { ports: unknown[] }).ports = [port]
    return { p, opened, closed: () => closed }
  }

  it('starts the helper on a ring at the mode raster and exposes it once attached', async () => {
    const { load, calls } = fakeAddon()
    const { p, opened, closed } = provider(load, { ok: true })
    const sink = await p.openOutput('decklink:1:0', 'decklink:1', { keyFill: false })
    assert.match((opened[0] as { ringName: string }).ringName, /^\/kgf\.\d+\.\d+$/)
    assert.equal(sink.frameRing?.width, 1280)
    assert.equal(sink.frameRing?.height, 720)
    await sink.close()
    assert.equal(closed(), 1)
    assert.equal(calls.closedRings, 1, 'ring unlinked after the helper stops')
  })

  it('drops the ring and keeps CPU frames when the helper cannot attach it', async () => {
    const { load, calls } = fakeAddon()
    const { p } = provider(load, { ok: false, reason: 'Frame ring raster does not match the output mode' })
    const sink = await p.openOutput('decklink:1:0', 'decklink:1', { keyFill: false })
    assert.equal(sink.frameRing, undefined)
    assert.equal(calls.closedRings, 1)
  })

  it('offers no ring without the addon', async () => {
    const { p, opened } = provider({ ok: false, reason: 'macOS-only' }, null)
    const sink = await p.openOutput('decklink:1:0', 'decklink:1', { keyFill: false })
    assert.equal((opened[0] as { ringName?: string }).ringName, undefined)
    assert.equal(sink.frameRing, undefined)
  })
})

describe('NDI UYVA frames', () => {
  it('sends GPU frames as UYVA with a UYVY-plane stride, and CPU frames as BGRA', async () => {
    const sent: NdiVideoFrame[] = []
    const svc = new NdiService({ ok: true, adapter: 'grandi', provider: {
      name: 'fake', version: () => '1',
      createSender: async () => ({ sendVideo: async (frame: NdiVideoFrame) => { sent.push(frame) } }),
    } })
    try {
      await svc.start()
      svc.updateConvertedFrame(Buffer.alloc(1920 * 1080 * 3), 1920, 1080)
      await new Promise((r) => setTimeout(r, 5))
      assert.equal(sent.at(-1)!.fourCC, 1096178005)
      assert.equal(sent.at(-1)!.lineStrideBytes, 1920 * 2)
      svc.updateFrame(Buffer.alloc(1920 * 1080 * 4), 1920, 1080)
      await new Promise((r) => setTimeout(r, 5))
      assert.equal(sent.at(-1)!.fourCC, 1095911234)
      assert.equal(sent.at(-1)!.lineStrideBytes, 1920 * 4)
      // A wrong-sized buffer is ignored, never sent as UYVA.
      const before = sent.length
      svc.updateConvertedFrame(Buffer.alloc(10), 1920, 1080)
      await new Promise((r) => setTimeout(r, 5))
      assert.ok(sent.slice(before).every((frame) => frame.fourCC === 1095911234))
    } finally { await svc.stop() }
  })
})

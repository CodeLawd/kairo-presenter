import { it } from 'node:test'
import assert from 'node:assert/strict'
import { VideoDeviceService } from '../index'
import { FakeVideoDeviceProvider, fakePort } from './fake-provider'

const output = { id: 'card', enabled: true, devicePortId: fakePort.id,
  deviceModeId: 'fake:1080p', deviceKeyFill: false }
function setup(): { provider: FakeVideoDeviceProvider; service: VideoDeviceService } {
  const provider = new FakeVideoDeviceProvider()
  provider.ports = [structuredClone(fakePort)]
  return { provider, service: new VideoDeviceService([provider], 0) }
}

it('exposes the provider frame ring through the managed sink', async () => {
  const { provider, service } = setup()
  const ring = { name: '/test', width: 1920, height: 1080, handle: {}, close: () => {} }
  provider.openOutput = async () => ({ frameRing: ring as never, setFrame: () => {}, close: async () => {} })
  try {
    await service.reconcile([output])
    assert.equal(service.sinkFor(output.id)?.frameRing, ring)
  } finally { await service.close() }
})

it('counts valid captured frames and keeps snapshot diagnostics isolated', async () => {
  const { service } = setup()
  await service.reconcile([output])
  const sink = service.sinkFor(output.id)!
  sink.setFrame(Buffer.alloc(4), 1, 1)
  sink.setFrame(Buffer.alloc(4), 1, 1)
  assert.throws(() => sink.setFrame(Buffer.alloc(3), 1, 1))
  const snapshot = service.snapshot()
  assert.equal(snapshot.outputs.card.diagnostics?.capturedFrames, 2)
  snapshot.outputs.card.diagnostics!.capturedFrames = 100
  assert.equal(service.snapshot().outputs.card.diagnostics?.capturedFrames, 2)
  await service.close()
})

it('opens once, forwards valid frames and rejects malformed frames', async () => {
  const { provider, service } = setup()
  await service.reconcile([output])
  const sink = service.sinkFor(output.id)!
  assert.equal(service.outputStatus(output.id).ready, true)
  sink.setFrame(Buffer.from([1, 2, 3, 255]), 1, 1)
  assert.deepEqual([...provider.frames[0]], [1, 2, 3, 255])
  assert.throws(() => sink.setFrame(Buffer.alloc(3), 1, 1), /frame/i)
  assert.throws(() => sink.setFrame(Buffer.alloc(4), 0, 1), /frame/i)
  await service.reconcile([output])
  assert.equal(service.sinkFor(output.id), sink)
  assert.equal(provider.opens, 1)
  await service.close()
  await service.close()
  assert.equal(provider.closes, 1)
})

it('disconnect closes the sink and reconnect opens it again', async () => {
  const { provider, service } = setup()
  await service.reconcile([output])
  const stale = service.sinkFor(output.id)!
  provider.ports = []
  await service.refresh()
  assert.equal(service.outputStatus(output.id).reason, 'Device disconnected')
  assert.equal(provider.closes, 1)
  stale.setFrame(Buffer.alloc(4), 1, 1)
  assert.equal(provider.frames.length, 0)
  provider.ports = [fakePort]
  await service.refresh()
  assert.equal(service.outputStatus(output.id).ready, true)
  assert.equal(provider.opens, 2)
  await service.close()
})

it('rejects busy ports, unsupported modes and unsupported key/fill', async () => {
  const { provider, service } = setup()
  provider.ports = [{ ...fakePort, unavailableReason: 'In use by another app' }]
  await service.reconcile([output])
  assert.equal(service.outputStatus(output.id).reason, 'In use by another app')
  provider.ports = [fakePort]
  await service.reconcile([{ ...output, deviceModeId: 'missing' }])
  assert.equal(service.outputStatus(output.id).ready, false)
  await service.reconcile([{ ...output, deviceKeyFill: true }])
  assert.equal(service.outputStatus(output.id).ready, false)
  assert.equal(provider.opens, 0)
  await service.close()
})

it('prevents duplicate acquisitions and releases removed outputs', async () => {
  const { provider, service } = setup()
  await service.reconcile([output, { ...output, id: 'other' }])
  assert.equal(service.outputStatus('other').ready, false)
  assert.equal(provider.opens, 1)
  await service.reconcile([])
  assert.equal(provider.closes, 1)
  assert.equal(service.sinkFor(output.id), null)
  await service.close()
})

it('contains provider errors and retries acquisition', async () => {
  const { provider, service } = setup()
  provider.openError = new Error('In use by another app')
  await service.reconcile([output])
  assert.equal(service.outputStatus(output.id).reason, 'In use by another app')
  provider.openError = null
  await service.refresh()
  assert.equal(service.outputStatus(output.id).ready, true)
  provider.enumerationError = new Error('Driver lost')
  await service.refresh()
  assert.equal(service.outputStatus(output.id).reason, 'Driver lost')
  assert.equal(provider.closes, 1)
  await service.close()
})

it('shutdown closes an acquisition still in flight and prevents further opens', async () => {
  const { provider, service } = setup()
  let release!: () => void
  provider.beforeOpen = () => new Promise<void>((resolve) => { release = resolve })
  const pending = service.reconcile([output])
  while (!release) await new Promise<void>((resolve) => setImmediate(resolve))
  const closing = service.close()
  release()
  await Promise.all([pending, closing])
  assert.equal(service.sinkFor(output.id), null)
  assert.equal(provider.closes, 1)
  await service.reconcile([output])
  assert.equal(provider.opens, 1)
})

it('hotplug is debounced and emits a recovered snapshot', async () => {
  const { provider, service } = setup()
  await service.reconcile([output])
  const notified = new Promise<void>((resolve) => {
    service.onChanged(() => { if (!service.outputStatus(output.id).ready) resolve() })
  })
  provider.ports = []
  provider.changed()
  provider.changed()
  await notified
  assert.equal(provider.closes, 1)
  await service.close()
})

it('one failing provider does not disable another provider', async () => {
  const healthy = new FakeVideoDeviceProvider()
  healthy.ports = [fakePort]
  const broken = { name: 'broken', status: () => { throw new Error('Driver failed') },
    listPorts: async () => [], openOutput: async () => { throw new Error('Unavailable') } }
  const service = new VideoDeviceService([broken, healthy])
  await service.reconcile([output])
  assert.equal(service.outputStatus(output.id).ready, true)
  assert.equal(service.snapshot().providers[0].available, false)
  await service.close()
})

it('mode changes close the old acquisition before reopening', async () => {
  const { provider, service } = setup()
  provider.ports = [{ ...fakePort, modes: [...fakePort.modes, { ...fakePort.modes[0], id: 'fake:other' }] }]
  await service.reconcile([output])
  const stale = service.sinkFor(output.id)!
  await service.reconcile([{ ...output, deviceModeId: 'fake:other' }])
  assert.equal(provider.closes, 1)
  assert.equal(provider.opens, 2)
  stale.setFrame(Buffer.alloc(4), 1, 1)
  assert.equal(provider.frames.length, 0)
  await service.close()
})

it('duplicate sink close releases hardware once and removes readiness', async () => {
  const { provider, service } = setup()
  let calls = 0
  provider.openOutput = async () => ({ setFrame: () => {}, close: async () => { calls++ } })
  await service.reconcile([output])
  const sink = service.sinkFor(output.id)!
  await sink.close()
  assert.equal(service.outputStatus(output.id).ready, false)
  assert.equal(service.sinkFor(output.id), null)
  await sink.close()
  await service.close()
  assert.equal(calls, 1)
})

it('releases all changed bindings before opening swapped ports', async () => {
  const { provider, service } = setup()
  const second = { ...fakePort, id: 'fake:1:1', portName: 'SDI 2' }
  provider.ports = [fakePort, second]
  const occupied = new Set<string>()
  provider.openOutput = async (id: string) => {
    if (occupied.has(id)) throw new Error('Port busy')
    occupied.add(id)
    return { setFrame: () => {}, close: async () => { occupied.delete(id) } }
  }
  await service.reconcile([output, { ...output, id: 'other', devicePortId: second.id }])
  await service.reconcile([{ ...output, devicePortId: second.id }, { ...output, id: 'other' }])
  assert.equal(service.outputStatus(output.id).ready, true)
  assert.equal(service.outputStatus('other').ready, true)
  await service.close()
})

it('frame delivery failure closes the output, reports failure and retries only on refresh', async () => {
  const { provider, service } = setup()
  provider.openOutput = async () => {
    provider.opens++
    return { setFrame: () => { throw new Error('Playback failed') }, close: async () => { provider.closes++ } }
  }
  await service.reconcile([output])
  service.sinkFor(output.id)!.setFrame(Buffer.alloc(4), 1, 1)
  await service.reconcile([output])
  assert.equal(service.outputStatus(output.id).ready, false)
  assert.equal(service.outputStatus(output.id).reason, 'Playback failed')
  assert.equal(provider.closes, 1)
  assert.equal(provider.opens, 1)
  await service.refresh()
  assert.equal(provider.opens, 2)
  assert.equal(service.outputStatus(output.id).ready, true)
  await service.close()
})

it('an output live on a port keeps it when another output is re-pointed at it', async () => {
  const { provider, service } = setup()
  const second = { ...fakePort, id: 'fake:1:1', portName: 'SDI 2' }
  provider.ports = [fakePort, second]
  const occupied = new Set<string>()
  provider.openOutput = async (id: string) => {
    if (occupied.has(id)) throw new Error('Port busy')
    occupied.add(id)
    return { setFrame: () => {}, close: async () => { occupied.delete(id) } }
  }
  const other = { ...output, id: 'other', devicePortId: second.id }
  // `other` is listed first, so list order alone would hand it the port.
  await service.reconcile([other, output])
  const live = service.sinkFor(output.id)
  await service.reconcile([{ ...other, devicePortId: fakePort.id }, output])
  assert.equal(service.sinkFor(output.id), live)
  assert.equal(service.outputStatus(output.id).ready, true)
  assert.equal(service.outputStatus('other').reason, 'Port assigned to another output')
  await service.close()
})

it('a port reported busy because Kairo holds it stays live', async () => {
  const { provider, service } = setup()
  await service.reconcile([output])
  provider.ports = [{ ...fakePort, unavailableReason: 'In use' }]
  await service.refresh()
  assert.equal(service.outputStatus(output.id).ready, true)
  assert.equal(provider.closes, 0)
  await service.reconcile([output, { ...output, id: 'other' }])
  assert.equal(service.outputStatus('other').reason, 'Port assigned to another output')
  assert.equal(provider.closes, 0)
  await service.close()
})

it('steady-state reconciles reuse the cached ports', async () => {
  const { provider, service } = setup()
  let scans = 0
  const list = provider.listPorts.bind(provider)
  provider.listPorts = async () => { scans++; return list() }
  await service.reconcile([output])
  await service.reconcile([output])
  await service.reconcile([output])
  assert.equal(scans, 1)
  await service.refresh()
  assert.equal(scans, 2)
  await service.close()
})

it('reports whether hardware is held', async () => {
  const { service } = setup()
  assert.equal(service.holdsHardware(), false)
  await service.reconcile([output])
  assert.equal(service.holdsHardware(), true)
  await service.close()
  assert.equal(service.holdsHardware(), false)
})

it('asynchronous native failures revoke readiness and close the output', async () => {
  let report: ((error: Error) => void) | undefined
  let closes = 0
  const provider = new FakeVideoDeviceProvider()
  provider.ports = [fakePort]
  provider.openOutput = async () => ({
    setFrame: () => {},
    onError: (listener: (error: Error) => void) => { report = listener; return () => { report = undefined } },
    close: async () => { closes++ },
  })
  const service = new VideoDeviceService([provider])
  await service.reconcile([output])
  report!(new Error('DeckLink helper exited (SIGSEGV)'))
  await service.reconcile([output])
  assert.equal(service.outputStatus(output.id).ready, false)
  assert.match(service.outputStatus(output.id).reason, /SIGSEGV/)
  assert.equal(closes, 1)
  assert.equal(report, undefined)
  await service.close()
})

it('cleans up a sink whose error subscription throws', async () => {
  const provider = new FakeVideoDeviceProvider()
  provider.ports = [fakePort]
  let closes = 0
  provider.openOutput = async () => ({ setFrame: () => {}, close: async () => { closes++ }, onError: () => { throw new Error('Broken subscription') } })
  const service = new VideoDeviceService([provider])
  await service.reconcile([output])
  assert.equal(service.outputStatus(output.id).ready, false)
  assert.equal(service.sinkFor(output.id), null)
  assert.equal(closes, 1)
  await service.close()
})

it('exposes the selected hardware frame rate and refreshes it when modes change', async () => {
  const { provider, service } = setup()
  provider.ports[0].modes.push({ ...fakePort.modes[0], id: 'fake:1080i50', frameRateN: 25000, frameRateD: 1000, interlaced: true })
  try {
    await service.reconcile([output])
    assert.equal(service.sinkFor(output.id)?.frameRate, 30000 / 1001)
    await service.reconcile([{ ...output, deviceModeId: 'fake:1080i50' }])
    assert.equal(service.sinkFor(output.id)?.frameRate, 25)
  } finally { await service.close() }
})

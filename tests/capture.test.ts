import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureFileName,
  captureFrameSize,
  captureSourceFor,
  DEFAULT_CAPTURE_SETTINGS,
  formatCaptureElapsed,
  gigabytesPerHour,
  normalizeCaptureSettings,
  type CaptureSettings,
} from '../src/lib/capture'
import type { OverlayOutput } from '../src/lib/ipc'
import { makeProjectorOutput } from '../src/lib/overlay-defaults'
import { CaptureService, MIN_FREE_TO_START, type CaptureDeps, type RecorderAddon } from '../src/main/services/capture/recorder'
import type { FrameTap } from '../src/main/services/output/program-surface'

type Handle = ReturnType<RecorderAddon['open']>

const screen: OverlayOutput = { ...makeProjectorOutput(0), id: 'main', name: 'Main Screen', enabled: true }
const syphon: OverlayOutput = { ...makeProjectorOutput(1), id: 'lt', kind: 'syphon', name: 'Lower Third', enabled: true }

/** A stand-in addon and app that record what the service asks of them. */
function rig(options: {
  settings?: Partial<CaptureSettings>
  outputs?: OverlayOutput[]
  aspect?: number | null
  free?: number | null
  mic?: boolean
  inputs?: { id: string; name: string }[]
  openError?: string
  busy?: boolean
} = {}) {
  const calls: string[] = []
  const taps = new Map<string, FrameTap>()
  let stats = { frames: 0, late: 0, skipped: 0, failed: 0, audioBuffers: 0, seconds: 0 } as ReturnType<RecorderAddon['stats']>
  let pushDone: ((error: Error | null) => void) | null = null
  let opened: Parameters<RecorderAddon['open']>[0] | null = null
  const addon: RecorderAddon = {
    available: () => ({ ok: true }),
    audioInputs: () => options.inputs ?? [{ id: 'desk', name: 'Sound desk' }],
    open: (o) => {
      calls.push('open')
      if (options.openError) throw new Error(`open: ${options.openError}`)
      opened = o
      return {} as Handle
    },
    pushTexture: (_r, _h, done) => {
      calls.push('texture')
      if (options.busy) return false
      pushDone = done
      return true
    },
    pushPixels: (_r, _b, w, h) => { calls.push(`pixels ${w}x${h}`); return true },
    stop: (_r, done) => { calls.push('stop'); setImmediate(() => done(null, { path: opened!.path, frames: 1, seconds: 1 })) },
    stats: () => stats,
  }
  const deps: CaptureDeps = {
    load: () => ({ ok: true, addon }),
    settings: () => ({ ...DEFAULT_CAPTURE_SETTINGS, ...options.settings }),
    outputs: () => options.outputs ?? [screen, syphon],
    attach: (id, tap) => {
      calls.push(tap ? `attach ${id}` : `detach ${id}`)
      if (tap) taps.set(id, tap)
      else taps.delete(id)
    },
    sourceAspect: () => (options.aspect === undefined ? 16 / 9 : options.aspect),
    defaultFolder: () => '/Movies/Kairo',
    ensureFolder: async (folder) => { calls.push(`mkdir ${folder}`) },
    freeBytes: async () => (options.free === undefined ? 100 * 1024 ** 3 : options.free),
    microphoneAccess: async () => options.mic ?? true,
    now: () => new Date(2026, 9, 20, 10, 30, 5).getTime(),
  }
  const service = new CaptureService(deps)
  return {
    service, calls, taps, addon,
    opened: () => opened,
    setStats: (next: Partial<typeof stats>) => { stats = { ...stats, ...next } },
    finishPush: () => pushDone?.(null),
  }
}

function texture() {
  let released = 0
  return { textureInfo: { sharedTextureHandle: Buffer.alloc(8) }, release: () => { released++ }, released: () => released }
}

test('settings normalize to safe values', () => {
  assert.deepEqual(normalizeCaptureSettings(undefined), DEFAULT_CAPTURE_SETTINGS)
  const odd = normalizeCaptureSettings({ codec: 'vp9', resolution: '4k', frameRate: 29.97, bitrateMbps: 900, folder: 3 })
  assert.equal(odd.codec, 'h264')
  assert.equal(odd.resolution, '1080p')
  assert.equal(odd.frameRate, 30)
  assert.equal(odd.bitrateMbps, 100)
  assert.equal(odd.folder, '')
  assert.equal(normalizeCaptureSettings({ frameRate: '60', codec: 'prores4444' }).frameRate, 60)
})

test('the source is the chosen output, else the first audience screen', () => {
  const settings = { ...DEFAULT_CAPTURE_SETTINGS }
  assert.equal(captureSourceFor(settings, [syphon, screen])?.id, 'main')
  assert.equal(captureSourceFor({ ...settings, sourceOutputId: 'lt' }, [syphon, screen])?.id, 'lt')
  assert.equal(captureSourceFor({ ...settings, sourceOutputId: 'gone' }, [syphon, screen])?.id, 'main')
  assert.equal(captureSourceFor(settings, [syphon])?.id, 'lt')
  assert.equal(captureSourceFor(settings, []), null)
})

test('frame size keeps the source shape with even sides', () => {
  assert.deepEqual(captureFrameSize('1080p', 16 / 9), { width: 1920, height: 1080 })
  assert.deepEqual(captureFrameSize('720p', 16 / 9), { width: 1280, height: 720 })
  assert.deepEqual(captureFrameSize('1080p', 16 / 10), { width: 1920, height: 1200 })
  assert.deepEqual(captureFrameSize('1080p', Number.NaN), { width: 1920, height: 1080 })
  assert.equal(captureFrameSize('1080p', 4 / 3).height % 2, 0)
})

test('file names sort by time and drop characters filesystems refuse', () => {
  assert.equal(captureFileName('Kairo', 'Main: Screen/1', new Date(2026, 9, 20, 9, 5, 3)), 'Kairo Main Screen1 2026-10-20 09.05.03.mov')
})

test('elapsed time and disk estimates read sensibly', () => {
  assert.equal(formatCaptureElapsed(65_000), '1:05')
  assert.equal(formatCaptureElapsed(3_723_000), '1:02:03')
  assert.equal(gigabytesPerHour({ ...DEFAULT_CAPTURE_SETTINGS, bitrateMbps: 12 }), 5.4)
  assert.ok(gigabytesPerHour({ ...DEFAULT_CAPTURE_SETTINGS, codec: 'prores422' }) > 60)
})

test('start records the source at its shape into the folder, and stop finishes the file', async () => {
  const r = rig({ settings: { resolution: '720p', frameRate: 25, bitrateMbps: 6 } })
  const started = await r.service.start()
  assert.equal(started.recording, true)
  assert.equal(started.sourceName, 'Main Screen')
  assert.equal(started.path, '/Movies/Kairo/Kairo Main Screen 2026-10-20 10.30.05.mov')
  assert.deepEqual(
    { ...r.opened(), path: undefined },
    { path: undefined, width: 1280, height: 720, fps: 25, codec: 'h264', bitrate: 6_000_000, audioDeviceId: '' },
  )
  assert.deepEqual(r.calls, ['mkdir /Movies/Kairo', 'open', 'attach main'])
  assert.equal(r.taps.get('main')?.fps, 25)

  const stopped = await r.service.stop()
  assert.equal(stopped.recording, false)
  assert.equal(stopped.error, null)
  assert.equal(stopped.path, started.path, 'the finished file is still offered')
  assert.deepEqual(r.calls.slice(-2), ['detach main', 'stop'])
})

test('two Start presses make one recording', async () => {
  const r = rig()
  await Promise.all([r.service.start(), r.service.start()])
  assert.equal(r.calls.filter((c) => c === 'open').length, 1)
  await r.service.stop()
})

test('frames reach the recorder and every texture goes back', async () => {
  const r = rig()
  await r.service.start()
  const tap = r.taps.get('main')!
  const t = texture()
  tap.texture(t)
  assert.equal(t.released(), 0, 'held while the GPU copies')
  r.finishPush()
  assert.equal(t.released(), 1)
  tap.pixels(Buffer.alloc(16), 2, 2)
  assert.ok(r.calls.includes('pixels 2x2'))
  await r.service.stop()
  const late = texture()
  tap.texture(late)
  assert.equal(late.released(), 1, 'a tap left over after stop releases at once')
})

test('a busy recorder drops the frame and releases it', async () => {
  const r = rig({ busy: true })
  await r.service.start()
  const t = texture()
  r.taps.get('main')!.texture(t)
  assert.equal(t.released(), 1)
  await r.service.stop()
})

test('start refuses, with a reason, when it cannot record', async () => {
  const cases: [Parameters<typeof rig>[0], RegExp][] = [
    [{ outputs: [] }, /Add a screen/],
    [{ outputs: [{ ...screen, enabled: false }] }, /Main Screen is off/],
    [{ aspect: null }, /isn’t showing/],
    [{ free: MIN_FREE_TO_START - 1 }, /free on that disk/],
    [{ settings: { audioDeviceId: 'desk' }, mic: false }, /allowed to record sound/],
    [{ settings: { audioDeviceId: 'usb', audioDeviceName: 'USB mixer' } }, /USB mixer isn’t connected/],
    [{ openError: 'this Mac cannot encode that codec at that size' }, /cannot encode/],
  ]
  for (const [options, reason] of cases) {
    const r = rig(options)
    const status = await r.service.start()
    assert.equal(status.recording, false)
    assert.match(status.error ?? '', reason)
    assert.equal(r.taps.size, 0)
  }
})

test('a writer failure stops the recording and says why', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const r = rig()
  const seen: string[] = []
  r.service.onStatus((s) => { if (s.error) seen.push(s.error) })
  await r.service.start()
  r.setStats({ error: 'The disk is full' })
  t.mock.timers.tick(1000)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(r.service.recording, false)
  assert.match(seen.at(-1) ?? '', /The disk is full/)
  assert.ok(r.calls.includes('detach main'))
})

test('a struggling encoder or a vanished source warns without stopping', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const r = rig()
  await r.service.start()
  r.setStats({ late: 30 })
  t.mock.timers.tick(1000)
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(r.service.status().warning ?? '', /struggling/)
  t.mock.timers.tick(1000)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(r.service.status().warning, null, 'clears once it keeps up')
  assert.equal(r.service.recording, true)
  await r.service.stop()
})

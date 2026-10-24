import { it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Module, { createRequire } from 'node:module'
import { DEFAULT_OVERLAY_THEME } from '../../../../lib/overlay-defaults'

class WindowDouble extends EventEmitter {
  static windows: WindowDouble[] = []
  static duringLoad: ((win: WindowDouble) => void) | null = null
  destroyed = false
  commands: string[] = []
  rates: number[] = []
  /** The frame subscription a display window's recording tap holds. */
  frames: ((image: unknown) => void) | null = null
  invalidated = 0
  webContents = Object.assign(new EventEmitter(), {
    id: 1,
    setFrameRate: (rate: number) => { this.rates.push(rate) },
    executeJavaScript: async (command: string) => { this.commands.push(command); return true },
    invalidate: () => { this.invalidated++ },
    beginFrameSubscription: (_onlyDirty: boolean, callback: (image: unknown) => void) => { this.frames = callback },
    endFrameSubscription: () => { this.frames = null },
  })
  constructor(readonly options: Record<string, unknown>) { super(); WindowDouble.windows.push(this) }
  isDestroyed(): boolean { return this.destroyed }
  getContentSize(): number[] { return [1920, 1200] }
  setBounds(): void {}
  setAlwaysOnTop(): void {}
  setVisibleOnAllWorkspaces(): void {}
  setFullScreen(): void {}
  showInactive(): void {}
  destroy(): void { this.destroyed = true }
  async loadFile(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve))
    WindowDouble.duringLoad?.(this)
  }
}

// Replace only native Electron windows and the build-time asset import. The
// real ProgramSurface and ManagedWindow lifecycle still execute in these tests.
let primaryScale = 1
const moduleLoader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = moduleLoader._load
moduleLoader._load = function (id, ...args) {
  if (id === 'electron') return { BrowserWindow: WindowDouble, screen: { getPrimaryDisplay: () => ({ scaleFactor: primaryScale }) } }
  if (id.endsWith('.html?asset')) return 'overlay.html'
  if (id === 'electron-log/main') return { info: () => {}, warn: () => {}, error: () => {} }
  return originalLoad.call(this, id, ...args)
}
const requireSurface = createRequire(__filename)
const { ProgramSurface } = requireSurface('../../output/program-surface') as typeof import('../../output/program-surface')
moduleLoader._load = originalLoad

it('device sink replacement preserves and repaints the current slide after replug', async () => {
  const sink = { setFrame: () => {}, close: async () => {} }
  const surface = new ProgramSurface('Card', { kind: 'device', sink })
  await surface.showSlide('card', 'John 3:16', 'Current slide', DEFAULT_OVERLAY_THEME)
  const original = WindowDouble.windows.at(-1)!
  surface.close()
  assert.equal(surface.available(), false)
  await surface.retargetDevice({ ...sink })
  const restored = WindowDouble.windows.at(-1)!
  assert.notEqual(restored, original)
  assert.equal(original.destroyed, true)
  assert.ok(restored.commands.some((command) => command.includes('Current slide')))
  assert.equal(surface.available(), true)
  surface.destroy()
})

it('device capture delivers pixels to the sink and retains safe Electron settings', async () => {
  let received: Buffer | null = null
  const surface = new ProgramSurface('Card', { kind: 'device', sink: {
    setFrame: (frame, width, height) => { received = frame; assert.equal(width, 1920); assert.equal(height, 1080) },
    close: async () => {},
  } })
  await surface.restore()
  const win = WindowDouble.windows.at(-1)!
  const frame = Buffer.alloc(1920 * 1080 * 4, 255)
  win.webContents.emit('paint', {}, {}, { getSize: () => ({ width: 1920, height: 1080 }), getBitmap: () => frame })
  assert.equal(received, frame)
  assert.deepEqual((win.options.webPreferences as Record<string, unknown>).nodeIntegration, false)
  assert.deepEqual((win.options.webPreferences as Record<string, unknown>).contextIsolation, true)
  assert.deepEqual((win.options.webPreferences as Record<string, unknown>).offscreen, true)
  surface.destroy()
})

it('offscreen capture on a Retina primary display paints at 1920×1080, not 2×', async () => {
  primaryScale = 2
  try {
    const surface = new ProgramSurface('Card', { kind: 'device', sink: { setFrame: () => {}, close: async () => {} } })
    await surface.restore()
    const win = WindowDouble.windows.at(-1)!
    assert.equal(win.options.width, 960)
    assert.equal(win.options.height, 540)
    assert.equal((win.options.webPreferences as Record<string, unknown>).zoomFactor, 0.5)
    surface.destroy()
  } finally {
    primaryScale = 1
  }
})

for (const [rate, expected] of [[25, 25], [50, 50], [60000 / 1001, 60]]) {
  it(`captures device output at its selected ${rate} fps mode, including video and fades`, async () => {
    const surface = new ProgramSurface('Card', { kind: 'device', sink: {
      frameRate: rate, setFrame: () => {}, close: async () => {},
    } })
    try {
      await surface.restore()
      const win = WindowDouble.windows.at(-1)!
      assert.equal(win.rates.at(-1), expected)
      await surface.showSlide('card', '', '', {
        ...DEFAULT_OVERLAY_THEME,
        background: { ...DEFAULT_OVERLAY_THEME.background, type: 'video', mediaPath: '/video.mp4' },
      })
      assert.equal(win.rates.at(-1), expected)
      await surface.configure({ transitionMs: 50, audio: { enabled: false, volume: 1, outputLabel: '' }, cameraAudible: false, ndiAudio: false })
      await surface.clearText()
      assert.equal(win.rates.at(-1), expected)
    } finally { surface.destroy() }
  })
}

it('changing device modes updates capture rate while preserving the slide', async () => {
  const sink = { frameRate: 25, setFrame: () => {}, close: async () => {} }
  const surface = new ProgramSurface('Card', { kind: 'device', sink })
  try {
    await surface.showSlide('card', 'John 3:16', 'Keep this slide', DEFAULT_OVERLAY_THEME)
    await surface.retargetDevice({ ...sink, frameRate: 50 })
    const win = WindowDouble.windows.at(-1)!
    assert.equal(win.rates.at(-1), 50)
    assert.ok(win.commands.some((command) => command.includes('Keep this slide')))
  } finally { surface.destroy() }
})

it('test patterns cover the selected output without replacing its live slide', async () => {
  const surface = new ProgramSurface('Card', { kind:'device', sink:{frameRate:25,setFrame:()=>{},close:async()=>{}} })
  try {
    await surface.showSlide('card','John 1:3','Keep current verse',DEFAULT_OVERLAY_THEME)
    const win=WindowDouble.windows.at(-1)!
    assert.equal(await surface.setTestPattern('motion'),true)
    assert.equal(surface.testPattern,'motion')
    assert.ok(win.commands.at(-1)?.includes('kairo-diagnostic-pattern'))
    assert.equal(await surface.setTestPattern(null),true)
    assert.equal(surface.testPattern,null)
    await surface.retargetDevice({frameRate:50,setFrame:()=>{},close:async()=>{}})
    assert.ok(WindowDouble.windows.at(-1)!.commands.some((command)=>command.includes('Keep current verse')))
  } finally {surface.destroy()}
})

// ─── GPU capture (plan 008) ───────────────────────────────────────────────────

function gpuDouble(opts: { fail?: boolean } = {}) {
  const converts: Array<(error: Error | null, result?: Buffer) => void> = []
  const addon = {
    available: () => ({ ok: true }),
    open: () => ({}),
    convert: (_c: unknown, _h: Buffer, done: (error: Error | null, result?: Buffer) => void) => {
      if (opts.fail) throw new Error('could not wrap IOSurface')
      converts.push(done); return true
    },
    close: () => {}, stats: () => ({ converted: 0, skipped: 0, failed: 0, inFlight: 0 }),
    createRing: () => ({}), closeRing: () => {},
  }
  return { converts, load: () => ({ ok: true as const, addon: addon as never, device: 'Fake GPU' }) }
}

const sharedTexture = () => {
  const t = { released: 0, textureInfo: { sharedTextureHandle: Buffer.alloc(8) }, release: () => { t.released++ } }
  return t
}

it('a GPU failure during initial load rebuilds on CPU and delivers the current slide', async () => {
  const gpu = gpuDouble({ fail: true })
  const ring = { name: '/kgf.startup', width: 1920, height: 1080, handle: {}, close: () => {} }
  let delivered = 0
  const surface = new ProgramSurface('Card', { kind: 'device', sink: {
    frameRing: ring as never, setFrame: () => { delivered++ }, close: async () => {},
  } }, gpu.load)
  const t = sharedTexture()
  let firstWindow: WindowDouble | null = null
  WindowDouble.duringLoad = (win) => {
    WindowDouble.duringLoad = null
    firstWindow = win
    win.webContents.emit('paint', { texture: t }, {}, { getSize: () => ({ width: 0, height: 0 }) })
  }
  try {
    await surface.showSlide('card', 'John 3:16', 'Keep this verse', DEFAULT_OVERLAY_THEME)
    // Recovery runs independently of the original creation request.
    for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve))
    const cpuWindow = WindowDouble.windows.at(-1)!
    assert.notEqual(cpuWindow, firstWindow)
    assert.equal(firstWindow!.destroyed, true)
    assert.equal(cpuWindow.destroyed, false)
    assert.equal((cpuWindow.options.webPreferences as Record<string, unknown>).offscreen, true)
    assert.ok(cpuWindow.commands.some((command) => command.includes('Keep this verse')))
    assert.equal(t.released, 1)
    cpuWindow.webContents.emit('paint', {}, {}, { getSize: () => ({ width: 1920, height: 1080 }), getBitmap: () => Buffer.alloc(1920 * 1080 * 4) })
    assert.equal(delivered, 1)
  } finally {
    WindowDouble.duringLoad = null
    surface.destroy()
  }
})

it('a card with a frame ring captures shared textures and never reads the bitmap', async () => {
  const gpu = gpuDouble()
  const ring = { name: '/kgf.1.1', width: 1920, height: 1080, handle: {}, close: () => {} }
  const surface = new ProgramSurface('Card', { kind: 'device', sink: {
    frameRing: ring as never,
    setFrame: () => assert.fail('CPU path used while GPU capture is on'),
    close: async () => {},
  } }, gpu.load)
  try {
    await surface.restore()
    const win = WindowDouble.windows.at(-1)!
    assert.deepEqual((win.options.webPreferences as Record<string, unknown>).offscreen, { useSharedTexture: true })
    const t = sharedTexture()
    win.webContents.emit('paint', { texture: t }, {}, { getSize: () => ({ width: 0, height: 0 }), getBitmap: () => assert.fail('bitmap read') })
    assert.equal(gpu.converts.length, 1)
    gpu.converts[0](null, undefined)
    assert.equal(t.released, 1)
  } finally { surface.destroy() }
})

it('a card without a ring keeps the CPU path even when the addon loads', async () => {
  const gpu = gpuDouble()
  const surface = new ProgramSurface('Card', { kind: 'device', sink: { setFrame: () => {}, close: async () => {} } }, gpu.load)
  try {
    await surface.restore()
    assert.equal((WindowDouble.windows.at(-1)!.options.webPreferences as Record<string, unknown>).offscreen, true)
  } finally { surface.destroy() }
})

it('a GPU failure rebuilds the surface on the CPU path and keeps the slide', async () => {
  const gpu = gpuDouble({ fail: true })
  let cpuFrames = 0
  const ring = { name: '/kgf.1.2', width: 1920, height: 1080, handle: {}, close: () => {} }
  const surface = new ProgramSurface('Card', { kind: 'device', sink: {
    frameRing: ring as never, setFrame: () => { cpuFrames++ }, close: async () => {},
  } }, gpu.load)
  try {
    await surface.showSlide('card', 'John 3:16', 'Still on screen', DEFAULT_OVERLAY_THEME)
    const gpuWindow = WindowDouble.windows.at(-1)!
    const t = sharedTexture()
    gpuWindow.webContents.emit('paint', { texture: t }, {}, { getSize: () => ({ width: 0, height: 0 }), getBitmap: () => Buffer.alloc(0) })
    assert.equal(t.released, 1, 'texture released even though conversion threw')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const cpuWindow = WindowDouble.windows.at(-1)!
    assert.notEqual(cpuWindow, gpuWindow)
    assert.equal(gpuWindow.destroyed, true)
    assert.equal((cpuWindow.options.webPreferences as Record<string, unknown>).offscreen, true)
    assert.ok(cpuWindow.commands.some((command) => command.includes('Still on screen')))
    cpuWindow.webContents.emit('paint', {}, {}, { getSize: () => ({ width: 1920, height: 1080 }), getBitmap: () => Buffer.alloc(1920 * 1080 * 4) })
    assert.equal(cpuFrames, 1)
  } finally { surface.destroy() }
})

function tapDouble(fps = 30) {
  const textures: Array<{ release: () => void }> = []
  const pixels: string[] = []
  return {
    textures, pixels,
    tap: {
      fps,
      texture: (texture: { release: () => void }) => { textures.push(texture) },
      pixels: (bgra: Buffer, width: number, height: number) => { pixels.push(`${width}x${height} ${bgra.length}`) },
    },
  }
}

it('a recording tap shares each GPU frame with the sink; Chromium gets it back once both are done', async () => {
  const gpu = gpuDouble()
  const ring = { name: '/kgf.tap', width: 1920, height: 1080, handle: {}, close: () => {} }
  const surface = new ProgramSurface('Card', { kind: 'device', sink: { frameRing: ring as never, setFrame: () => {}, close: async () => {} } }, gpu.load)
  try {
    await surface.restore()
    const win = WindowDouble.windows.at(-1)!
    const rec = tapDouble(60)
    surface.setTap(rec.tap)
    assert.equal(win.rates.at(-1), 60, 'paints at the recording rate while recording')
    assert.equal(win.invalidated, 1, 'a still page is repainted so the recording has its first frame')
    const t = sharedTexture()
    win.webContents.emit('paint', { texture: t }, {}, { getSize: () => ({ width: 0, height: 0 }) })
    assert.equal(rec.textures.length, 1)
    gpu.converts[0](null, undefined)
    assert.equal(t.released, 0, 'still held by the recording')
    rec.textures[0].release()
    rec.textures[0].release()
    assert.equal(t.released, 1, 'released exactly once')
    surface.setTap(null)
    assert.equal(win.rates.at(-1), 10, 'back to the idle rate')
    const after = sharedTexture()
    win.webContents.emit('paint', { texture: after }, {}, { getSize: () => ({ width: 0, height: 0 }) })
    gpu.converts[1](null, undefined)
    assert.equal(after.released, 1, 'without a tap the sink alone releases it')
    assert.equal(rec.textures.length, 1)
  } finally { surface.destroy() }
})

it('a recording tap gets CPU frames too, and the sink still gets its own', async () => {
  let delivered = 0
  const surface = new ProgramSurface('Card', { kind: 'device', sink: { setFrame: () => { delivered++ }, close: async () => {} } })
  try {
    await surface.restore()
    const win = WindowDouble.windows.at(-1)!
    const rec = tapDouble()
    surface.setTap(rec.tap)
    win.webContents.emit('paint', {}, {}, { getSize: () => ({ width: 1920, height: 1080 }), getBitmap: () => Buffer.alloc(1920 * 1080 * 4) })
    assert.equal(delivered, 1)
    assert.deepEqual(rec.pixels, [`1920x1080 ${1920 * 1080 * 4}`])
  } finally { surface.destroy() }
})

it('a display window is recorded through a frame subscription, at device pixels, throttled to the recording rate', async () => {
  const surface = new ProgramSurface('Main Screen', {
    kind: 'display', bounds: { x: 0, y: 0, width: 1920, height: 1200 }, rehearsal: false, frameHeight: 1200,
  })
  try {
    await surface.restore()
    const win = WindowDouble.windows.at(-1)!
    assert.equal(surface.frameAspect(), 1920 / 1200, 'records at the window’s shape')
    const rec = tapDouble(30)
    surface.setTap(rec.tap)
    assert.ok(win.frames, 'subscribed')
    // A Retina display: 960×600 points, 1920×1200 pixels.
    const image = { getSize: () => ({ width: 960, height: 600 }), toBitmap: () => Buffer.alloc(1920 * 1200 * 4) }
    win.frames!(image)
    win.frames!(image)
    assert.deepEqual(rec.pixels, [`1920x1200 ${1920 * 1200 * 4}`], 'the second frame, too soon after, is skipped')
    surface.setTap(null)
    assert.equal(win.frames, null, 'unsubscribed when the recording stops')
  } finally { surface.destroy() }
})

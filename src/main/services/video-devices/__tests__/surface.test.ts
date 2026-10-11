import { it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Module, { createRequire } from 'node:module'
import { DEFAULT_OVERLAY_THEME } from '../../../../lib/overlay-defaults'

class WindowDouble extends EventEmitter {
  static windows: WindowDouble[] = []
  destroyed = false
  commands: string[] = []
  rates: number[] = []
  webContents = Object.assign(new EventEmitter(), {
    id: 1,
    setFrameRate: (rate: number) => { this.rates.push(rate) },
    executeJavaScript: async (command: string) => { this.commands.push(command); return true },
  })
  constructor(readonly options: Record<string, unknown>) { super(); WindowDouble.windows.push(this) }
  isDestroyed(): boolean { return this.destroyed }
  destroy(): void { this.destroyed = true }
  async loadFile(): Promise<void> {}
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

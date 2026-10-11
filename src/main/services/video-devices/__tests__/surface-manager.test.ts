import { it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Module, { createRequire } from 'node:module'
import { makeOverlayOutput } from '../../../../lib/overlay-defaults'
import { DEFAULT_PRESENTATION_SETTINGS } from '../../../../lib/program'
import { VideoDeviceService } from '../index'
import { FakeVideoDeviceProvider, fakePort } from './fake-provider'

class WindowDouble extends EventEmitter {
  static windows: WindowDouble[] = []
  destroyed = false
  commands: string[] = []
  webContents = Object.assign(new EventEmitter(), {
    setFrameRate: () => {},
    executeJavaScript: async (command: string) => { this.commands.push(command); return true },
  })
  constructor() { super(); WindowDouble.windows.push(this) }
  isDestroyed(): boolean { return this.destroyed }
  destroy(): void { this.destroyed = true }
  async loadFile(): Promise<void> {}
}
const provider = new FakeVideoDeviceProvider()
provider.ports = [fakePort]
const service = new VideoDeviceService([provider])
const output = makeOverlayOutput('card', 'device', { enabled: true, devicePortId: fakePort.id, deviceModeId: fakePort.modes[0].id })
const moduleLoader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = moduleLoader._load
moduleLoader._load = function (id, ...args) {
  if (id === 'electron') return { BrowserWindow: WindowDouble,
    screen: Object.assign(new EventEmitter(), { getPrimaryDisplay: () => ({ id: 0 }), getAllDisplays: () => [] }),
    powerSaveBlocker: { start: () => 1, isStarted: () => true, stop: () => {} } }
  if (id.endsWith('.html?asset')) return 'overlay.html'
  if (id === 'electron-log/main') return { info: () => {}, warn: () => {}, error: () => {} }
  if (id === '../../db') return { store: { get: (key: string) => key === 'overlay' ? { outputs: [output] } : DEFAULT_PRESENTATION_SETTINGS } }
  if (id === '../../main-window') return { getMainWindow: () => null }
  if (id === '../video-devices') return { videoDeviceService: service }
  if (id === '../ndi') return { ndiService: { audioSupported: false } }
  if (id === './lobby-player') return { LobbyPlayer: class {} }
  return originalLoad.call(this, id, ...args)
}
const requireManager = createRequire(__filename)
const { surfaceManager } = requireManager('../../output/surface-manager') as typeof import('../../output/surface-manager')
moduleLoader._load = originalLoad

it('manager retains current content across disconnect and excludes filtered content', async () => {
  surfaceManager.init()
  await surfaceManager.reconcile([output])
  const original = surfaceManager.surfaceFor(output)!
  await original.showSlide(output.id, 'John 3:16', 'Current content', output.theme)
  assert.equal(surfaceManager.liveTargets('scripture', [{ ...output, show: { ...output.show, scripture: false } }]).length, 0)
  provider.ports = []
  await service.refresh()
  await surfaceManager.reconcile([output])
  assert.equal(surfaceManager.surfaceFor(output), null)
  provider.ports = [fakePort]
  await service.refresh()
  await surfaceManager.reconcile([output])
  assert.equal(surfaceManager.surfaceFor(output), original)
  assert.ok(WindowDouble.windows.at(-1)!.commands.some((command) => command.includes('Current content')))
  await surfaceManager.destroyAll()
})

import { it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { deckLinkEnabled, deckLinkHelperPath, deckLinkWorkerPath } from '../providers/decklink/paths'

it('card outputs are on in every macOS build unless explicitly turned off', () => {
  assert.equal(deckLinkEnabled('darwin', {}), true)
  assert.equal(deckLinkEnabled('darwin', { KAIRO_ENABLE_DECKLINK: '1' }), true)
  assert.equal(deckLinkEnabled('darwin', { KAIRO_ENABLE_DECKLINK: '0' }), false)
  assert.equal(deckLinkEnabled('win32', {}), false)
  assert.equal(deckLinkEnabled('linux', {}), false)
})

it('uses the bundled helper when packaged and the local build in development', () => {
  // join(), so the expectations use the separator of the OS running the tests.
  const resources = join('/App', 'Kairo.app', 'Contents', 'Resources')
  const bundled = join(resources, 'decklink', 'decklink-helper')
  const dev = join('/repo', 'native', 'decklink', 'build', 'decklink-helper')
  assert.equal(deckLinkHelperPath(resources, '/repo', (path) => path === bundled), bundled)
  assert.equal(deckLinkHelperPath(join('/electron', 'Resources'), '/repo', (path) => path === dev), dev)
  // Neither exists: the dev path, so the provider reports the helper as missing.
  assert.equal(deckLinkHelperPath(undefined, '/repo', () => false), dev)
})

it('loads the playback worker from app.asar.unpacked when packaged', () => {
  const dir = join('/App', 'Resources', 'app.asar', 'out', 'main')
  assert.equal(deckLinkWorkerPath(dir, () => true), join('/App', 'Resources', 'app.asar.unpacked', 'out', 'main', 'decklink-playback-worker.js'))
  assert.equal(deckLinkWorkerPath(dir, () => false), join(dir, 'decklink-playback-worker.js'))
  const dev = join('/repo', 'out', 'main')
  assert.equal(deckLinkWorkerPath(dev, () => true), join(dev, 'decklink-playback-worker.js'))
})

import { it } from 'node:test'
import assert from 'node:assert/strict'
import { deckLinkEnabled, deckLinkHelperPath, deckLinkWorkerPath } from '../providers/decklink/paths'

it('card outputs are on in every macOS build unless explicitly turned off', () => {
  assert.equal(deckLinkEnabled('darwin', {}), true)
  assert.equal(deckLinkEnabled('darwin', { KAIRO_ENABLE_DECKLINK: '1' }), true)
  assert.equal(deckLinkEnabled('darwin', { KAIRO_ENABLE_DECKLINK: '0' }), false)
  assert.equal(deckLinkEnabled('win32', {}), false)
  assert.equal(deckLinkEnabled('linux', {}), false)
})

it('uses the bundled helper when packaged and the local build in development', () => {
  const bundled = '/App/Kairo.app/Contents/Resources/decklink/decklink-helper'
  assert.equal(deckLinkHelperPath('/App/Kairo.app/Contents/Resources', '/repo', (path) => path === bundled), bundled)
  assert.equal(deckLinkHelperPath('/electron/Resources', '/repo', (path) => path.startsWith('/repo')), '/repo/native/decklink/build/decklink-helper')
  // Neither exists: the dev path, so the provider reports the helper as missing.
  assert.equal(deckLinkHelperPath(undefined, '/repo', () => false), '/repo/native/decklink/build/decklink-helper')
})

it('loads the playback worker from app.asar.unpacked when packaged', () => {
  const dir = '/App/Kairo.app/Contents/Resources/app.asar/out/main'
  assert.equal(deckLinkWorkerPath(dir, () => true), '/App/Kairo.app/Contents/Resources/app.asar.unpacked/out/main/decklink-playback-worker.js')
  assert.equal(deckLinkWorkerPath(dir, () => false), `${dir}/decklink-playback-worker.js`)
  assert.equal(deckLinkWorkerPath('/repo/out/main', () => true), '/repo/out/main/decklink-playback-worker.js')
})

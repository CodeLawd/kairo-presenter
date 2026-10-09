import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import Module from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Bundle the real main-process service, replacing only Electron and local storage.
// This keeps these tests away from the operator's settings, OS keychain and browser.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-pairing-test-'))
const output = buildSync({
  entryPoints: ['src/main/services/cloud/session.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
  define: { 'import.meta.env.MAIN_VITE_API_URL': '"http://localhost:3000"' },
  external: ['electron', 'electron-log/main', '@main/db', './secure-store', './api-client'],
}).outputFiles[0].text
const OriginalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load
const availableStore = { available: true, read: () => null, write: () => true, clear: () => {} }
let requestHandler: (url: string, body: { deviceCode?: string }) => Promise<unknown>
class FakeApi {
  request(_method: string, url: string, body: unknown) {
    return requestHandler(url, body as { deviceCode?: string })
  }
  setAccessToken() {}
}
const mod = new Module(path.join(temp, 'session.cjs')) as Module & { _compile(code: string, name: string): void }
;(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (name, ...args) {
  if (name === 'electron') return { app: { getPath: () => temp, getVersion: () => '1', getName: () => 'Kairo' }, shell: { openExternal: async () => {} } }
  if (name === 'electron-log/main') return { warn() {}, info() {} }
  if (name === '@main/db') return { store: { get: () => ({ name: 'Church' }), set() {} } }
  if (name === './secure-store') return { createSecureStore: () => availableStore }
  if (name === './api-client') return { CloudApiClient: FakeApi, toApiError: (error: Error) => ({ message: error.message }) }
  return OriginalLoad.call(this, name, ...args)
}
try { mod._compile(output, path.join(temp, 'session.cjs')) } finally { (Module as unknown as { _load: typeof OriginalLoad })._load = OriginalLoad }
const { CloudSessionService } = mod.exports

const started = (id: string) => ({ deviceCode: id, userCode: `PROA-${id}`, verificationUri: `https://kairo.test/activate?userCode=PROA-${id}`, interval: 0.005, expiresIn: 600 })
const pause = () => new Promise((resolve) => setTimeout(resolve, 25))

test('cancel then restart never lets the old pairing poll change the new request', async () => {
  const service = new CloudSessionService(availableStore)
  let run = 0
  requestHandler = async (url, body) => {
    if (url.endsWith('/start')) return started(String(++run))
    return body.deviceCode === '1' ? { state: 'expired' } : { state: 'pending' }
  }
  await service.startPairing()
  service.cancelPairing()
  await service.startPairing()
  await pause()
  assert.equal(service.getPairing().status, 'waiting')
  assert.equal(service.getPairing().userCode, 'PROA-2')
  service.stop()
})

test('cancelling a pending start prevents a late response from reopening pairing', async () => {
  const service = new CloudSessionService(availableStore)
  let resolveStart!: (value: unknown) => void
  requestHandler = () => new Promise((resolve) => { resolveStart = resolve })
  const opening = service.startPairing()
  service.cancelPairing()
  resolveStart(started('late'))
  await opening
  assert.equal(service.getPairing().status, 'idle')
  service.stop()
})

test('a cancelled in-flight approval cannot sign in over a newer request', async () => {
  const service = new CloudSessionService(availableStore)
  let run = 0
  let resolveOldPoll!: (value: unknown) => void
  requestHandler = async (url, body) => {
    if (url.endsWith('/start')) return started(String(++run))
    if (body.deviceCode === '1') return new Promise((resolve) => { resolveOldPoll = resolve })
    return { state: 'pending' }
  }
  await service.startPairing()
  await pause()
  service.cancelPairing()
  await service.startPairing()
  resolveOldPoll({ state: 'approved', accessToken: 'old-access', refreshToken: 'old-refresh', user: { id: 'old', email: 'old@example.test', name: 'Old account', emailVerified: false }, org: { id: 'old-church', name: 'Old church', role: 'owner' } })
  await pause()
  assert.equal(service.getSession().state, 'signed-out')
  assert.equal(service.getPairing().userCode, 'PROA-2')
  assert.equal(service.getPairing().status, 'waiting')
  service.stop()
})

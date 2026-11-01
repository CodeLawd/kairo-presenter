/** Real local Worker + HTTP account-server boundary; no credentials or cloud deployment. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { CloudApiClient } from '../src/main/services/cloud/api-client.ts'
import { audienceApiBaseUrl } from '../src/lib/audience-connection.ts'
const require = createRequire(resolve('server/package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
const { build } = require('esbuild')
const dir = await mkdtemp(join(tmpdir(), 'kairo-audience-local-'))
let mf
let ws
const authPaths = []
const account = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/v1/ping') { response.end('{"ok":true}'); return }
  if (request.url === '/v1/audience/rooms') { response.statusCode = 404; response.end('{"message":"Cannot POST /v1/audience/rooms"}'); return }
  if (request.headers.authorization !== 'Bearer test-device') { response.statusCode = 401; response.end('{}'); return }
  authPaths.push(request.url)
  response.end(JSON.stringify(request.url === '/v1/licensing' ? { activated: true, lease: { claims: { orgId: 'test-org' } } } : { name: 'Test church' }))
})
try {
  await new Promise(resolve => account.listen(0, '127.0.0.1', resolve))
  const apiBase = `http://127.0.0.1:${account.address().port}`
  const scriptPath = join(dir, 'worker.mjs')
  await build({ entryPoints: [resolve('server/cloudflare/audience-local.ts')], bundle: true, outfile: scriptPath, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'audience-local-test', modulesRoot: dir, modules: true, scriptPath, compatibilityDate: '2026-10-24', durableObjects: { AUDIENCE_ROOM: { className: 'AudienceRoom', useSQLite: true } }, bindings: { LOCAL_API_URL: apiBase, WEB_ORIGIN: 'http://localhost:3001', PUBLIC_WEB_URL: 'http://localhost:3001' } }))
  const workerBase = String(await mf.ready).replace(/\/$/, '')
  const client = new CloudApiClient(apiBase, async () => null)
  client.setAccessToken('test-device')
  await assert.rejects(client.request('post', '/v1/audience/rooms', { title: 'Test' }), error => error.status === 404)
  const roomBase = audienceApiBaseUrl(apiBase, workerBase)
  const room = await client.request('post', `${roomBase}/v1/audience/rooms`, { title: 'Local room' })
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(room.url, `http://localhost:3001/q/${room.code}`)
  assert.deepEqual(authPaths, ['/v1/licensing', '/v1/orgs/test-org'])
  assert.deepEqual(await client.request('get', '/v1/ping'), { ok: true }, 'ordinary account requests keep their original base')
  const response = await mf.dispatchFetch(`${workerBase}/v1/audience/rooms/${room.code}/ws?role=operator`, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${room.operatorToken}` } })
  assert.equal(response.status, 101)
  ws = response.webSocket
  const events = []
  ws.addEventListener('message', event => events.push(JSON.parse(event.data)))
  ws.accept()
  const wait = async predicate => {
    const deadline = Date.now() + 10_000
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for socket snapshot'); await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  await wait(() => events.some(event => event.type === 'snapshot'))
  ws.send(JSON.stringify({type:'snapshot'}))
  await wait(() => events.filter(event => event.type === 'snapshot').length >= 2)
  assert.equal(authPaths.length, 2, 'socket messages never call the account server')
  console.log('PASS: original Nest route reproduces 404; authenticated room creation reaches real local Worker; account base unchanged; sockets stay off Nest.')
} finally {
  ws?.close()
  await mf?.dispose()
  await new Promise(resolve => account.close(resolve))
  await rm(dir, {recursive:true,force:true})
}

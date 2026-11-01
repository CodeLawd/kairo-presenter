#!/usr/bin/env node
/** Real workerd + SQLite + hibernating WebSockets. No deployed service or secrets.
 * bun run test:audience-room            — functional checks
 * bun run test:audience-room -- --load  — 300 participants for 10 minutes
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
const require = createRequire(resolve('server/package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
const { build } = require('esbuild')
const dir = await mkdtemp(join(tmpdir(), 'kairo-audience-'))
const load = process.argv.includes('--load')
const serve = process.argv.includes('--serve')
const duration = load ? 600_000 : 0
const total = load ? 300 : 4
let mf
let proxy
let proxySockets
let reconnectService
const clients = []
const bundle = join(dir, 'worker.mjs')
try {
  await build({ stdin: {
    contents: `import { audienceRoutes } from './server/cloudflare/audience-routes';
      export { AudienceRoom } from './server/cloudflare/audience-room';
      let calls = 0;
      export default { async fetch(request, env) {
        if (new URL(request.url).pathname === '/calls') return Response.json(calls);
        return await audienceRoutes(request, env, async request => {
          calls++;
          return Response.json(new URL(request.url).pathname === '/v1/licensing'
            ? { activated: request.headers.get('Authorization') === 'Bearer device', lease: { claims: { orgId: 'org' } } }
            : { name: 'Test church' });
        }) || new Response('Not found', {status:404});
      }};`, resolveDir: process.cwd(), sourcefile: 'audience-test-worker.ts',
  }, outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  mf = new Miniflare(convertV4MiniflareOptions({ port: serve ? 8789 : 0, name: 'audience-test', modulesRoot: dir, modules: true, scriptPath: bundle, compatibilityDate: '2026-10-24', durableObjects: { AUDIENCE_ROOM: { className: 'AudienceRoom', useSQLite: true } }, bindings: { WEB_ORIGIN: serve ? 'http://localhost:3008' : 'https://kairopresenter.com', PUBLIC_WEB_URL: serve ? 'http://localhost:3008' : 'https://kairopresenter.com' } }))
  await mf.ready
  const request = (path, init) => mf.dispatchFetch(`http://localhost${path}`, init)
  assert.equal((await request('/v1/audience/rooms', {method:'POST', body:'{}'})).status, 401)
  assert.equal((await request('/v1/audience/rooms', {method:'POST', headers:{Authorization:'Bearer bad'}, body:JSON.stringify({title:'Test'})})).status, 403)
  const created = await request('/v1/audience/rooms', { method: 'POST', headers: { Authorization: 'Bearer device' }, body: JSON.stringify({ title: 'Questions from the room', settings: { review: true } }) })
  assert.equal(created.status, 201)
  const room = await created.json()
  const path = `/v1/audience/rooms/${room.code}`
  assert.equal((await request(`${path}/ws?role=operator`, {headers:{Upgrade:'websocket'}})).status, 403)
  assert.equal((await request(`${path}/session`, {headers:{Origin:'https://evil.example'}})).status, 403)
  const preflight = await request(`${path}/session`, { method:'OPTIONS', headers:{Origin:serve ? 'http://localhost:3008' : 'https://kairopresenter.com'} })
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), 'true')
  const connect = async (operator = false, cookie = '') => {
    const events = []
    if (!operator && !cookie) {
      const response = await request(`${path}/session`)
      cookie = response.headers.get('Set-Cookie').split(';')[0]
    }
    const response = await request(`${path}/ws?role=${operator ? 'operator' : 'audience'}`, { headers: { Upgrade: 'websocket', ...(operator ? { Authorization: `Bearer ${room.operatorToken}` } : { Cookie: cookie }) } })
    assert.equal(response.status, 101)
    const ws = response.webSocket
    ws.addEventListener('message', e => events.push(e.data === 'pong' ? {type:'pong'} : JSON.parse(e.data)))
    ws.accept()
    const client = { ws, events, cookie }
    clients.push(client)
    return client
  }
  const wait = async predicate => {
    const deadline = Date.now() + 20_000
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for room event'); await delay(10) }
  }
  const operator = await connect(true)
  const audience = await Promise.all(Array.from({ length: total }, () => connect()))
  await wait(() => audience.every(c => c.events.some(e => e.type === 'snapshot')))
  audience[0].ws.send('ping')
  await wait(() => audience[0].events.some(e => e.type === 'pong' || e.type === 'error'))
  assert.ok(audience[0].events.some(e => e.type === 'pong'), 'phone liveness pings receive a hibernation-safe auto-response')
  // Privacy, idempotence and per-participant rate limits survive reconnects.
  audience[0].ws.send(JSON.stringify({type:'ask',text:'Private until approved',requestId:'first'}))
  await wait(() => operator.events.some(e => e.type === 'question'))
  const first = operator.events.find(e => e.type === 'question').question
  assert.equal(audience[1].events.some(e => e.type === 'question'), false)
  audience[0].ws.send(JSON.stringify({type:'ask',text:'Private until approved',requestId:'first'}))
  audience[0].ws.send(JSON.stringify({type:'ask',text:'Too soon',requestId:'second'}))
  await wait(() => audience[0].events.some(e => e.type === 'error'))
  audience[1].ws.send(JSON.stringify({type:'state',id:first.id,state:'approved',requestId:'hack'}))
  await wait(() => audience[1].events.some(e => e.type === 'error'))
  assert.equal(audience[1].events.some(e => e.type === 'question'), false)
  operator.ws.send(JSON.stringify({type:'state',id:first.id,state:'approved',requestId:'approve-first'}))
  await wait(() => audience.every(c => c.events.some(e => e.type === 'question' && e.question.id === first.id)))
  for (const c of audience) {
    c.ws.send(JSON.stringify({type:'vote',id:first.id}))
    c.ws.send(JSON.stringify({type:'vote',id:first.id}))
  }
  await wait(() => operator.events.some(e => e.type === 'question' && e.question.votes === total))
  const reconnected = await connect(false, audience[0].cookie)
  await wait(() => reconnected.events.some(e => e.type === 'snapshot'))
  const snapshot = reconnected.events.find(e => e.type === 'snapshot')
  assert.equal(snapshot.questions[0].votes, total)
  assert.deepEqual(snapshot.voted, [first.id])
  reconnected.ws.send(JSON.stringify({type:'ask',text:'Reconnect cannot bypass the limit',requestId:'reconnect'}))
  await wait(() => reconnected.events.some(e => e.type === 'error'))
  reconnected.ws.close()
  // Exercise the same desktop merge rules against every delivered update.
  const { mergeAudienceQuestions } = await import('../src/lib/audience.ts')
  let queue = []
  let consumed = 0
  let sent = 0
  const apply = () => {
    for (const e of operator.events.slice(consumed)) {
      if (e.type === 'question') queue = mergeAudienceQuestions(queue, [e.question])
      if (e.type === 'snapshot') queue = mergeAudienceQuestions(queue, e.questions)
    }
    consumed = operator.events.length
  }
  const started = Date.now()
  let round = 0
  while (Date.now() - started < duration) {
    // Rotate askers so all 300 ask, without retaining millions of client events.
    const askers = Math.min(30, audience.length - 1)
    for (let j = 0; j < askers; j++) {
      const i = 1 + (round * askers + j) % (audience.length - 1)
      audience[i].ws.send(JSON.stringify({type:'ask',text:`Round ${round}, participant ${i}`,requestId:`r-${round}-${i}`}))
      sent++
    }
    await wait(() => operator.events.filter(e => e.type === 'question' && e.question.state === 'review').length >= sent + 1)
    apply()
    const pending = queue.filter(q => q.state === 'review' && q.id !== first.id)
    for (const q of pending) {
      operator.ws.send(JSON.stringify({type:'state',id:q.id,state:'approved',requestId:`approve-${q.id.slice(6)}`}))
      // Match the operator's local moderation action.
      queue = queue.map(row => row.id === q.id ? {...row,state:'approved'} : row)
    }
    await wait(() => pending.every(q => operator.events.some(e => e.type === 'question' && e.question.id === q.id && e.question.state === 'approved')))
    for (let i = 0; i < audience.length; i++) {
      const q = pending[i % pending.length]
      if (q) audience[i].ws.send(JSON.stringify({type:'vote',id:q.id}))
    }
    const snapshotDeadline = Date.now() + 20_000
    while (operator.events.filter(e => e.type === 'snapshot').at(-1)?.questions.reduce((sum,q) => sum + q.votes, 0) !== total * (round + 2)) {
      if (Date.now() > snapshotDeadline) throw new Error('Vote totals did not converge')
      operator.ws.send(JSON.stringify({type:'snapshot'}))
      await delay(250)
    }
    apply()
    for (const c of audience) c.events.length = 0
    console.log(`Load round ${++round}: ${queue.length} questions, ${audience.length} participants, ${Math.round((Date.now() - started) / 1000)}s`)
    // Stay within one question/20s and 30 votes/minute per participant.
    if (Date.now() - started < duration) await delay(Math.min(21_000, Math.max(0, duration - (Date.now() - started))))
  }
  operator.ws.send(JSON.stringify({type:'snapshot'}))
  await delay(300)
  apply()
  const final = operator.events.filter(e => e.type === 'snapshot').at(-1)
  if (load) {
    assert.equal(final.questions.length, sent + 1)
    const ordered = rows => [...rows].sort((a,b) => a.id.localeCompare(b.id)).map(q => ({id:q.id,text:q.text,votes:q.votes,state:q.state}))
    queue = queue.map(q => q.id === first.id ? {...q,state:'approved'} : q)
    assert.deepEqual(ordered(queue), ordered(final.questions))
    assert.equal(final.questions.reduce((sum,q) => sum + q.votes, 0), total * (round + 1))
  }
  if (!load && !serve) {
    const submitters = await Promise.all(Array.from({length: 31}, () => connect()))
    for (let i = 0; i < submitters.length; i++) submitters[i].ws.send(JSON.stringify({type:'ask',text:`Vote budget question ${i}`,requestId:`budget-question-${i}`}))
    await wait(() => operator.events.filter(e => e.type === 'question' && e.question.text.startsWith('Vote budget question')).length === 31)
    const budgetQuestions = operator.events.filter(e => e.type === 'question' && e.question.text.startsWith('Vote budget question')).map(e => e.question)
    for (let i = 0; i < budgetQuestions.length; i++) operator.ws.send(JSON.stringify({type:'state',id:budgetQuestions[i].id,state:'approved',requestId:`budget-approve-${i}`}))
    await wait(() => budgetQuestions.every(q => audience[0].events.some(e => e.type === 'question' && e.question.id === q.id)))
    for (let i = 0; i < budgetQuestions.length; i++) audience[0].ws.send(JSON.stringify({type:'vote',id:budgetQuestions[i].id,requestId:`budget-vote-${i}`}))
    await wait(() => audience[0].events.some(e => e.type === 'error' && e.requestId === 'budget-vote-29'))
    assert.equal(audience[0].events.filter(e => e.type === 'ack' && e.requestId.startsWith('budget-vote-')).length, 29)
    assert.match(audience[0].events.find(e => e.type === 'error' && e.requestId === 'budget-vote-29').message, /wait/)
    console.log('PASS: 30 votes/minute enforced with correlated rejections.')
  }
  if (process.argv.includes('--reconnect')) {
    const { WebSocket, WebSocketServer } = await import('ws')
    const { KairoAudienceSource } = await import('../src/main/services/audience/sources/kairo.ts')
    const { AudienceService } = await import('../src/main/services/audience/service.ts')
    let offline = false
    const upstreams = new Set()
    proxySockets = new WebSocketServer({ noServer: true })
    proxy = createServer()
    proxy.on('upgrade', (req, socket, head) => {
      if (offline) { socket.destroy(); return }
      proxySockets.handleUpgrade(req, socket, head, downstream => {
        const target = new URL(req.url, localOrigin)
        target.host = localOrigin.host
        target.protocol = 'ws:'
        const upstream = new WebSocket(target, { headers: { Authorization: req.headers.authorization || '' } })
        upstreams.add(upstream)
        const queued = []
        downstream.on('message', data => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString()); else queued.push(data.toString()) })
        upstream.on('open', () => { for (const message of queued) upstream.send(message) })
        upstream.on('message', data => { if (downstream.readyState === WebSocket.OPEN) downstream.send(data.toString()) })
        upstream.on('error', () => downstream.terminate())
        downstream.on('error', () => upstream.terminate())
        downstream.on('close', () => upstream.terminate())
        upstream.on('close', () => { upstreams.delete(upstream); downstream.close() })
      })
    })
    const localOrigin = new URL(String(await mf.ready))
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const source = new KairoAudienceSource(`http://127.0.0.1:${proxy.address().port}`, async () => room)
    reconnectService = new AudienceService({ showQuestion() {}, clearQuestion() {} })
    await reconnectService.start(source)
    await wait(() => reconnectService.getState().sources.some(s => s.state === 'live'))
    await reconnectService.moderate(first.id, 'approved')
    const before = reconnectService.getState().questions.length
    offline = true
    for (const ws of proxySockets.clients) ws.terminate()
    for (const ws of upstreams) ws.terminate()
    await reconnectService.moderate(first.id, 'hidden')
    audience[1].ws.send(JSON.stringify({type:'ask',text:'Asked while the desktop is offline',requestId:'offline-question'}))
    const extra = await connect()
    extra.ws.send(JSON.stringify({type:'vote',id:first.id}))
    console.log('Desktop network proxy disconnected for 60 seconds; queue retained.')
    await delay(60_000)
    assert.equal(reconnectService.getState().questions.length, before)
    offline = false
    await wait(() => reconnectService.getState().sources.some(s => s.state === 'live'))
    await wait(() => reconnectService.getState().questions.some(q => q.text === 'Asked while the desktop is offline'))
    await wait(() => operator.events.some(e => e.type === 'question' && e.question.id === first.id && e.question.state === 'hidden'))
    const recovered = reconnectService.getState().questions.find(q => q.id === first.id)
    assert.equal(recovered.state, 'hidden')
    assert.equal(recovered.votes, total + 1)
    console.log('PASS: desktop caught up after 60 seconds offline; pending moderation replayed; votes and queue retained.')
  }
  if (serve) {
    await writeFile('/tmp/kairo-audience-preview.json', JSON.stringify({ code: room.code, url: room.url, api: String(await mf.ready) }))
    console.log(`Local phone preview: ${room.url}`)
    // Keep the test room and sockets alive until this preview process is stopped.
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
    process.exitCode = 0
    // Continue through normal end/cleanup after a signal.
  }
  // Hidden content must disappear for audience snapshots, and end must close entry.
  operator.ws.send(JSON.stringify({type:'state',id:first.id,state:'hidden',requestId:'hide-first'}))
  await wait(() => audience[0].events.some(e => e.type === 'state' && e.id === first.id && e.state === 'hidden'))
  if (reconnectService) await reconnectService.stop('kairo')
  else operator.ws.send(JSON.stringify({type:'end',requestId:'end'}))
  await wait(() => operator.events.some(e => e.type === 'ended'))
  assert.equal((await request(`${path}/session`)).status, 410)
  assert.equal(await (await request('/calls')).json(), 3, 'container verifier only runs at creation, never per message')
  await writeFile(resolve('/tmp/kairo-audience-room-result.json'), JSON.stringify({participants:total,durationMs:Date.now()-started,questions:final.questions.length,passed:true},null,2))
  console.log(`PASS: real SQLite/WebSocket room; ${total} participants; ${round} load rounds; moderation, privacy, votes, retry, cookie and end checks passed.`)
} finally {
  for (const client of clients) try { client.ws.close() } catch {}
  for (const ws of proxySockets?.clients || []) ws.terminate()
  await new Promise(resolve => proxy ? proxy.close(resolve) : resolve())
  await mf?.dispose()
  await rm(dir, { recursive: true, force: true })
}

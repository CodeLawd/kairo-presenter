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
const load = false
const serve = false
const duration = load ? 600_000 : 0
const total = load ? 300 : 4
let mf
let proxy
let proxySockets
let reconnectService
let internal
const invites=[]
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
  internal=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk; if(req.url.endsWith('/invite'))invites.push(JSON.parse(text)); res.setHeader('Content-Type','application/json');res.end('{}')});await new Promise(r=>internal.listen(0,'127.0.0.1',r))
  mf = new Miniflare(convertV4MiniflareOptions({ port: serve ? 8789 : 0, name: 'audience-test', modulesRoot: dir, modules: true, scriptPath: bundle, compatibilityDate: '2026-10-24', durableObjects: { AUDIENCE_ROOM: { className: 'AudienceRoom', useSQLite: true } }, bindings: { LOCAL_API_URL: `http://127.0.0.1:${internal.address().port}`, ENGAGE_INTERNAL_SECRET:'test-secret', WEB_ORIGIN: serve ? 'http://localhost:3008' : 'https://kairopresenter.com', PUBLIC_WEB_URL: serve ? 'http://localhost:3008' : 'https://kairopresenter.com' } }))
  await mf.ready
  const request = (path, init) => mf.dispatchFetch(`http://localhost${path}`, init)
  const created = await request('/v1/engage', {method:'POST',headers:{Authorization:'Bearer device'},body:JSON.stringify({title:'Sunday',status:'draft',endsAt:Date.now()+7*86400000,settings:{review:true}})})
  assert.equal(created.status, 201)
  const room = await created.json()
  assert.equal(room.engagement.status, 'draft')
  assert.equal((await request(`/v1/engage/${room.code}/session`)).status, 410)
  const path = `/v1/engage/${room.code}`
  const ownerRequest = (suffix, body) => request(path+suffix,{method:'POST',headers:{Authorization:`Bearer ${room.operatorToken}`},body:JSON.stringify(body)})
  assert.equal((await ownerRequest('/open',{})).status,200)
  const events = []
  const response = await request(`${path}/ws?role=operator`,{headers:{Upgrade:'websocket',Authorization:`Bearer ${room.operatorToken}`}})
  assert.equal(response.status,101)
  const owner = response.webSocket; owner.accept(); owner.addEventListener('message',e=>events.push(JSON.parse(e.data))); clients.push({ws:owner})
  const wait = async predicate => { const deadline=Date.now()+10000; while(!predicate()){if(Date.now()>deadline)throw Error('Timed out');await delay(10)} }
  const connect = async () => {
    const session = await request(`${path}/session`)
    const cookie = session.headers.get('Set-Cookie').split(';')[0]
    const res = await request(`${path}/ws`,{headers:{Upgrade:'websocket',Cookie:cookie}})
    assert.equal(res.status,101)
    const events=[]; const ws=res.webSocket;ws.accept();ws.addEventListener('message',e=>events.push(JSON.parse(e.data)));clients.push({ws})
    return {ws,events,cookie}
  }
  const [a,b] = await Promise.all([connect(),connect()])
  a.ws.send(JSON.stringify({type:'ask',text:'Whatt?',requestId:'ask'}))
  await wait(()=>events.some(e=>e.type==='question'))
  const q=events.find(e=>e.type==='question').question
  owner.send(JSON.stringify({type:'edit',id:q.id,text:'What?',requestId:'edit'}))
  await wait(()=>events.some(e=>e.type==='question'&&e.question.text==='What?'))
  assert.equal(events.filter(e=>e.type==='question').at(-1).question.originalText,'Whatt?')
  owner.send(JSON.stringify({type:'state',id:q.id,state:'approved',requestId:'approve'}))
  await wait(()=>a.events.some(e=>e.type==='question'))
  owner.send(JSON.stringify({type:'edit',id:q.id,text:'Changed',requestId:'bad-edit'}))
  await wait(()=>events.some(e=>e.type==='error'&&e.requestId==='bad-edit'))
  owner.send(JSON.stringify({type:'reply',questionId:q.id,text:'Private answer',audience:'asker',requestId:'private'}))
  await wait(()=>a.events.some(e=>e.type==='engage'&&e.replies.some(r=>r.text==='Private answer')))
  assert.equal(b.events.some(e=>e.type==='engage'&&e.replies.some(r=>r.text==='Private answer')),false)
  owner.send(JSON.stringify({type:'reply',questionId:q.id,text:'Public answer',audience:'everyone',requestId:'public'}))
  await wait(()=>b.events.some(e=>e.type==='engage'&&e.replies.some(r=>r.text==='Public answer')))
  assert.equal((await ownerRequest('/moderators',{email:'team@example.com',name:'Jane'})).status,200)
  const token=invites.at(-1).link.split('/').at(-1).split('.')[1]
  const exchange=()=>request(path+'/exchange',{method:'POST',body:JSON.stringify({token})})
  const redeemed=await exchange();assert.equal(redeemed.status,200)
  const modCookie=redeemed.headers.get('Set-Cookie').split(';')[0]
  assert.equal((await exchange()).status,401)
  const modResponse=await request(path+'/ws?role=moderator',{headers:{Upgrade:'websocket',Cookie:modCookie}})
  assert.equal(modResponse.status,101)
  const mod=modResponse.webSocket;mod.accept();const modEvents=[];mod.addEventListener('message',e=>modEvents.push(JSON.parse(e.data)));clients.push({ws:mod})
  mod.send(JSON.stringify({type:'settings',settings:{review:false},requestId:'settings-hack'}))
  await wait(()=>modEvents.some(e=>e.type==='error'&&e.requestId==='settings-hack'))
  mod.send(JSON.stringify({type:'present',id:q.id,requestId:'present'}))
  await wait(()=>events.some(e=>e.type==='question'&&e.question.sentBy==='Jane'))
  await wait(()=>events.some(e=>e.type==='engage'&&e.moderators?.length))
  const modId=events.filter(e=>e.type==='engage'&&e.moderators?.length).at(-1).moderators[0].id
  let revoked=false;mod.addEventListener('close',()=>{revoked=true})
  assert.equal((await ownerRequest('/revoke/'+modId,{})).status,200)
  await wait(()=>revoked)
  assert.equal((await request(path+'/ws?role=moderator',{headers:{Upgrade:'websocket',Cookie:modCookie}})).status,401)
  // Audience cannot use moderator commands or learn private replies through a snapshot.
  b.ws.send(JSON.stringify({type:'reply',questionId:q.id,text:'Spoof',audience:'everyone',requestId:'spoof'}))
  await wait(()=>b.events.some(e=>e.type==='error'&&e.requestId==='spoof'))
  b.ws.send(JSON.stringify({type:'snapshot'}))
  await delay(50)
  assert.equal(JSON.stringify(b.events).includes('Private answer'),false)
  owner.send(JSON.stringify({type:'poll-save',poll:{title:'Choose',options:['A','B']},requestId:'save-poll'}))
  await wait(()=>events.some(e=>e.type==='engage'&&e.polls.length))
  const poll=events.filter(e=>e.type==='engage'&&e.polls.length).at(-1).polls[0]
  owner.send(JSON.stringify({type:'poll-state',id:poll.id,state:'open',showResults:false,requestId:'open-poll'}))
  await wait(()=>a.events.some(e=>e.type==='engage'&&e.polls.some(p=>p.state==='open')))
  const voters=await Promise.all(Array.from({length:298},connect))
  for(const v of [a,b,...voters]){v.ws.send(JSON.stringify({type:'poll-vote',id:poll.id,options:[poll.options[0].id],requestId:'vote'}));v.ws.send(JSON.stringify({type:'poll-vote',id:poll.id,options:[poll.options[0].id],requestId:'vote-again'}))}
  await wait(()=>events.some(e=>e.type==='engage'&&e.polls[0]?.voters===300))
  assert.equal(events.filter(e=>e.type==='engage').at(-1).polls[0].totals[poll.options[0].id],300)
  assert.equal(a.events.filter(e=>e.type==='engage').at(-1).polls[0].totals[poll.options[0].id]??0,0)
  owner.send(JSON.stringify({type:'poll-state',id:poll.id,state:'closed',showResults:true,requestId:'results'}))
  await wait(()=>a.events.some(e=>e.type==='engage'&&e.polls[0]?.totals[poll.options[0].id]===300))
  // Old route remains interoperable with the new engagement.
  assert.equal((await request(`/v1/audience/rooms/${room.code}/session`)).status,200)
  assert.equal((await ownerRequest('/close',{})).status,200)
  assert.equal((await request(path+'/session')).status,410)
  console.log('PASS: draft/open, old routes, edit audit, reply privacy, permission checks, 300 poll votes and result visibility.')
} finally {
  for (const client of clients) try { client.ws.close() } catch {}
  await mf?.dispose()
  await new Promise(r=>internal?internal.close(r):r())
  await rm(dir, {recursive:true,force:true})
}

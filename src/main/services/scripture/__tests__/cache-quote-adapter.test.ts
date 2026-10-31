import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ApiBibleCache } from '../api-bible-cache'
import { ApiCacheCrypto } from '../api-cache-crypto'
import { API_CACHE_MAX_AGE_MS } from '../api-cache-policy'
const now=Date.UTC(2026,9,31)
const text='Distinctive downloaded wording shines through this extraordinary passage today'
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'kairo-cache-quote-'))
 const file=join(dir,'cache.db');const cache=ApiBibleCache.open(file,ApiCacheCrypto.forTesting(Buffer.alloc(32,7)))
 cache.upsertTranslation({bibleId:'licensed',translation:'TPT',name:'Passion',copyright:'copyright'})
 const put=(fetchedAt=now)=>cache.putPassage('licensed',{bookId:43,bookName:'John',verses:[{book:'John',chapter:3,verse:16,text}],fetchedAt})
 return {cache,file,put,close(){cache.close();rmSync(dir,{recursive:true,force:true})}}
}
test('bounded cache export decrypts only eligible rows and keeps disk encrypted',()=>{
 const f=fixture();try{
  f.put();const batch=f.cache.readQuoteBatch(0,1,now)
  assert.equal(batch.rows.length,1);assert.equal(batch.rows[0].text,text)
  assert.equal(batch.rows[0].cacheSource.bibleId,'licensed')
  assert.equal(f.cache.isQuoteSourceEligible(batch.rows[0].cacheSource,now),true)
  assert.equal(f.cache.isQuoteSourceEligible(batch.rows[0].cacheSource,now+API_CACHE_MAX_AGE_MS),false)
  assert.equal(readFileSync(f.file).includes(Buffer.from(text)),false)
 }finally{f.close()}
})
test('refresh, revocation and removal emit corpus changes and invalidate source eligibility',()=>{
 const f=fixture();try{
  let changes=0;const stop=f.cache.onQuoteCorpusChange(()=>changes++)
  f.put();const first=f.cache.readQuoteBatch(0,100,now).rows[0]
  f.put(now+1);assert.equal(f.cache.isQuoteSourceEligible(first.cacheSource,now+1),false)
  const refreshed=f.cache.readQuoteBatch(0,100,now+1).rows[0]
  f.cache.markUnavailable('licensed','revoked')
  assert.equal(f.cache.isQuoteSourceEligible(refreshed.cacheSource,now+1),false)
  assert.equal(f.cache.readQuoteBatch(0,100,now+1).rows.length,0)
  f.cache.removeTranslation('licensed');assert.ok(changes>=4);stop()
 }finally{f.close()}
})
test('expired downloaded rows are never exported to recognition',()=>{
 const f=fixture();try{f.put(now-API_CACHE_MAX_AGE_MS);assert.equal(f.cache.readQuoteBatch(0,128,now).rows.length,0)}finally{f.close()}
})
test('downloaded wording is searchable only in a committed in-memory corpus and expires exactly',async()=>{
 const { CacheQuoteIndex }=await import('../cache-quote-index')
 const index=new CacheQuoteIndex()
 try {
  index.begin(1)
  index.append(1,[{book:'John',chapter:3,verse:16,text,translation:'TPT',cacheSource:{bibleId:'licensed',bookId:43,chapter:3,verse:16,fetchedAt:now,expiresAt:now+100}}])
  assert.deepEqual(index.search(text,now),[])
  index.commit(1)
  assert.equal(index.search(text,now).length,1)
  assert.equal(index.search(text,now)[0].cacheSource?.bibleId,'licensed')
  assert.equal(index.search(text,now+100).length,0)
  index.begin(2)
  index.append(1,[{book:'John',chapter:3,verse:16,text,cacheSource:{bibleId:'licensed',bookId:43,chapter:3,verse:16,fetchedAt:now,expiresAt:now+100}}])
  index.commit(1)
  assert.deepEqual(index.search(text,now),[])
 }finally{index.close()}
})

test('a crashed worker reloads eligible downloaded text without a cache mutation',async()=>{
 const {EventEmitter}=await import('node:events')
 const {QuoteWorkerClient}=await import('../quote-worker-client')
 const {ScriptureService}=await import('../index')
 const {matchGlobalQuote}=await import('../global-quote')
 const {ScriptureDetector}=await import('../detector')
 const workers: FakeWorker[]=[]
 class FakeWorker extends EventEmitter {
  rows: import('../api-bible-cache').CachedQuoteVerse[]=[]
  ready=false
  constructor(){super();queueMicrotask(()=>this.emit('message',{ready:true}))}
  postMessage(message:{type?:string;version?:number;rows?:import('../api-bible-cache').CachedQuoteVerse[];chunkId?:number;id?:number;text?:string}){
   if(message.type==='cache-begin'){this.rows=[];this.ready=false}
   else if(message.type==='cache-append'){
    this.rows.push(...message.rows!);queueMicrotask(()=>this.emit('message',{cacheAck:message.chunkId}))
   }else if(message.type==='cache-commit')this.ready=true
   else queueMicrotask(()=>this.emit('message',{id:message.id,matches:this.ready?matchGlobalQuote(message.text!,this.rows):[]}))
  }
  async terminate(){return 0}
 }
 const f=fixture();const service=new ScriptureService()
 const make=()=>{
  const fake=new FakeWorker();workers.push(fake)
  return fake as unknown as import('node:worker_threads').Worker
 }
 const clientFactory=(dbPath:string)=>new QuoteWorkerClient(dbPath,'unused',make)
 Object.assign(service,{quoteWorkerFactory:clientFactory})
 // Install the same production failure/rebuild listener used when opening the local corpus.
 const internals=service as unknown as {createQuoteWorker:(path:string)=>InstanceType<typeof QuoteWorkerClient>;quoteWorker:InstanceType<typeof QuoteWorkerClient>}
 internals.quoteWorker=internals.createQuoteWorker('unused')
 const wait=()=>new Promise(resolve=>setTimeout(resolve,190))
 const detector=new ScriptureDetector({apiKey:''})
 try {
  f.put();service.attachApiCache(f.cache);await wait()
  const initial=await service.searchGeneralQuote(text)
  assert.equal(initial.length,1)
  let invalidations=0;service.onGeneralQuoteCorpusChange(()=>invalidations++)
  workers[0].emit('error',new Error('simulated native worker crash'))
  await wait()
  assert.ok(workers.length>=2)
  const restored=await service.searchGeneralQuote(text)
  assert.equal(restored.length,1)
  // A crash loses only the worker's copy; cards already on the operator's screen stay valid.
  assert.equal(invalidations,0)
  detector.setGeneralQuoteProvider(value=>service.searchGeneralQuote(value))
  detector.setGeneralQuoteEligibilityProvider(ref=>service.isGeneralQuoteEligible(ref),fn=>service.onGeneralQuoteCorpusChange(fn))
  const refs:import('../detector').ScriptureReference[]=[];const retracted:string[]=[]
  detector.on('detection',found=>refs.push(...found));detector.on('quoteRetracted',key=>retracted.push(key))
  await detector.analyzeGeneralQuote(text,false,'licensed-evidence')
  assert.equal(refs.length,1);assert.equal(detector.isGeneralQuoteCurrent(refs[0]),true)
  // Caching another chapter (a lookup or a background download) adds text; it must not clear cards.
  f.cache.putPassage('licensed',{bookId:45,bookName:'Romans',verses:[{book:'Romans',chapter:8,verse:28,text:'All things work together for good'}],fetchedAt:now})
  assert.deepEqual(retracted,[]);assert.equal(detector.isGeneralQuoteCurrent(refs[0]),true)
  f.cache.markUnavailable('licensed','Access revoked while output lookup is pending')
  assert.equal(detector.isGeneralQuoteCurrent(refs[0]),false)
  assert.deepEqual(retracted,['licensed-evidence'])
 }finally{detector.destroy();service.closeQuoteWorker();f.close()}
})

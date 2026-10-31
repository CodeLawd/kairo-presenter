import assert from 'node:assert/strict'
import test from 'node:test'
import { ScriptureDetector, canAutoPresentScriptureReference, type ScriptureReference } from '../detector'
import { subscribeExplicitScriptureDetection } from '../live-detection-wiring'
import type { TranscriptResult, InterimResult } from '../../../../lib/ipc'
const quote = { book:'Luke',chapter:6,verse:38,text:'Give and it shall be given unto you good measure pressed down',score:8,ambiguous:false }
function harness() {
 let final!: (r:TranscriptResult)=>void, interim!: (r:InterimResult)=>void
 let sequence=0
 const detector=new ScriptureDetector({apiKey:''})
 const emitted:ScriptureReference[]=[];detector.on('detection',r=>emitted.push(...r))
 const stop=subscribeExplicitScriptureDetection({onTranscript:f=>{final=f},offTranscript(){},onInterim:f=>{interim=f},offInterim(){}},detector)
 return {detector,emitted,send:(text:string)=>final({text,id:`final-${sequence++}`,isFinal:true,words:[],timestamp:Date.now(),duration:1}), interim:(text:string)=>interim({text,stability:0.9,timestamp:Date.now()}),close:()=>{stop();detector.destroy()}}
}
const tick=()=>new Promise(r=>setTimeout(r,0))
test('a general local quotation publishes before AI and cannot auto-present',async()=>{
 const h=harness();let ai=0;h.detector.analyze=()=>{ai++}
 h.detector.setGeneralQuoteProvider(async()=>[quote])
 h.send(quote.text);await tick()
 assert.equal(ai,0);assert.equal(h.emitted.length,1);assert.equal(h.emitted[0].suggestionOnly,true)
 assert.equal(canAutoPresentScriptureReference(h.emitted[0]),false);h.close()
})
test('damaged citation recovery tries general local matching before AI',async()=>{
 const h=harness();let local=0,ai=0;h.detector.analyze=()=>{ai++}
 h.detector.setGeneralQuoteProvider(async()=>{local++;return [quote]})
 h.send('Psalm 1one512-thirteen says give and it shall be given unto you');await tick()
 assert.equal(local,1);assert.equal(ai,0);h.close()
})
test('a revised transcript invalidates older worker results',async()=>{
 const h=harness();let finish!:(r:typeof quote[])=>void
 h.detector.setGeneralQuoteProvider(()=>new Promise(resolve=>{finish=resolve}))
 h.send(quote.text);h.send('Romans 8:28');finish([quote]);await tick()
 assert.equal(h.emitted.some(r=>r.book==='Luke'),false);h.close()
})
test('worker failure preserves AI fallback and cleanup suppresses late fallback',async()=>{
 const h=harness();let ai=0;h.detector.analyze=()=>{ai++}
 h.detector.setGeneralQuoteProvider(async()=>{throw new Error('worker unavailable')})
 h.send(quote.text);await tick();assert.equal(ai,1)
 h.send(quote.text);h.close();await tick();assert.equal(ai,1)
})
test('provisional quotations need changed evidence and retract on corrected speech',async()=>{
 const detector=new ScriptureDetector({apiKey:''});const emitted:ScriptureReference[]=[];const retracted:string[]=[]
 detector.on('detection',refs=>emitted.push(...refs));detector.on('quoteRetracted',key=>retracted.push(key))
 detector.setGeneralQuoteProvider(async text=>text.includes('give')?[quote]:[])
 await detector.analyzeGeneralQuote('give and it shall be given unto you good measure',true,'audio:0')
 assert.equal(emitted.length,0)
 await detector.analyzeGeneralQuote('give and it shall be given unto you good measure pressed down',true,'audio:0')
 assert.equal(emitted.length,1);assert.equal(emitted[0].provisional,true)
 await detector.analyzeGeneralQuote('ordinary announcements',true,'audio:0')
 assert.deepEqual(retracted,['audio:0']);detector.destroy()
})
test('old rolling quotation does not resurrect when fresh speech is unrelated',async()=>{
 const h=harness();h.detector.setGeneralQuoteProvider(async()=>[quote])
 h.send(quote.text);await tick();assert.equal(h.emitted.length,1)
 h.detector.release({book:'Luke',chapter:6,verseStart:38})
 h.send('We have some announcements for the team');await tick()
 assert.equal(h.emitted.length,1)
 h.send(quote.text);await tick();assert.equal(h.emitted.length,2);h.close()
})
test('ambiguous candidates do not consume authoritative last-passage state',async()=>{
 const h=harness();h.detector.setGeneralQuoteProvider(async()=>[{...quote,ambiguous:true}])
 h.send(quote.text);await tick()
 assert.equal(h.detector.requestTranslations('Switch to KJV'),false);h.close()
})
test('a reconnect at the same audio offset is fresh evidence and drops old rolling context',async()=>{
 let final!:(r:TranscriptResult)=>void
 const detector=new ScriptureDetector({apiKey:''})
 detector.setGeneralQuoteProvider(async()=>[quote])
 const found:ScriptureReference[]=[];detector.on('detection',refs=>found.push(...refs))
 const stop=subscribeExplicitScriptureDetection({onTranscript:f=>{final=f},offTranscript(){},onInterim(){},offInterim(){}},detector)
 const send=(text:string,epoch:number)=>final({text,audioEpoch:epoch,audioStart:0,id:'same-offset',isFinal:true,timestamp:Date.now(),words:[],duration:1})
 try{
  send(quote.text,1);await tick();assert.equal(found.length,1)
  detector.release({book:'Luke',chapter:6,verseStart:38})
  send(quote.text,2);await tick();assert.equal(found.length,2)
  assert.notEqual(found[0].quoteEvidence,found[1].quoteEvidence)
 }finally{stop();detector.destroy()}
})
test('continued speech does not discard a finalized quotation still being searched',async()=>{
 const h=harness();let ai=0;h.detector.analyze=()=>{ai++}
 let finish!:(r:typeof quote[])=>void
 h.detector.setGeneralQuoteProvider(text=>text===quote.text?new Promise(resolve=>{finish=resolve}):Promise.resolve([]))
 h.send(quote.text);h.interim('and the preacher keeps talking');finish([quote]);await tick();await tick()
 assert.equal(h.emitted.filter(r=>r.book==='Luke').length,1);assert.equal(ai,0);h.close()
})
test('continued speech keeps the AI fallback for a finalized segment with no local match',async()=>{
 const h=harness();let ai=0;h.detector.analyze=()=>{ai++}
 let finish!:(r:typeof quote[])=>void
 h.detector.setGeneralQuoteProvider(text=>text.startsWith('Jesus said')?new Promise(resolve=>{finish=resolve}):Promise.resolve([]))
 h.send('Jesus said the widow gave more than all of them');h.interim('and the preacher keeps talking');finish([]);await tick();await tick()
 assert.equal(ai,1);h.close()
})
test('a mid-sentence quotation stays current while the preacher keeps talking', async () => {
 const detector=new ScriptureDetector({apiKey:''});const emitted:ScriptureReference[]=[]
 detector.on('detection',refs=>emitted.push(...refs))
 detector.setGeneralQuoteProvider(async()=>[quote])
 await detector.analyzeGeneralQuote('give and it shall be given unto you good measure',true,'audio:0')
 await detector.analyzeGeneralQuote('give and it shall be given unto you good measure pressed down',true,'audio:0')
 assert.equal(emitted.length,1)
 // The next partial lands while the card is still being looked up: same quotation, more words.
 detector.invalidateProvisionalQuote()
 await detector.analyzeGeneralQuote('give and it shall be given unto you good measure pressed down shaken together',true,'audio:0')
 assert.equal(detector.isGeneralQuoteCurrent(emitted[0]),true)
 detector.destroy()
})
test('a quotation spoken in short pieces resolves locally once the pieces add up', async () => {
 const h=harness();let ai=0;h.detector.analyze=()=>{ai++}
 h.detector.setGeneralQuoteProvider(async text=>text.includes('measure')?[quote]:[])
 h.send('Give and it shall be given unto you');await tick();await tick()
 h.send('Good measure.');await tick();await tick()
 assert.equal(h.emitted.filter(r=>r.book==='Luke').length,1)
 assert.equal(ai,1);h.close()
})
test('ordinary speech nothing local could place does not spend an AI request', async () => {
 const h=harness();let ai=0;h.detector.analyze=()=>{ai++}
 h.detector.setGeneralQuoteProvider(async()=>[])
 h.send('Our youth camp registration closes on Friday so sign up at the welcome desk');await tick();await tick()
 assert.equal(ai,0);h.close()
})
test('a quotation cut into tiny pieces still resolves once they add up', async () => {
 const h=harness();h.detector.analyze=()=>{}
 const john={book:'1 John',chapter:4,verse:4,text:'Ye are of God, little children, and have overcome them: because greater is he that is in you, than he that is in the world.',score:7,ambiguous:false}
 h.detector.setGeneralQuoteProvider(async text=>text.includes('Greater')&&text.includes('world')?[john]:[])
 for(const piece of ['Greater is he that is','in you than he that','in the world.']){h.send(piece);await tick();await tick()}
 assert.equal(h.emitted.filter(r=>r.book==='1 John').length,1);h.close()
})

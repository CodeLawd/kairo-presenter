import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateReplayCase, percentile, recordedEventsToReplay, summarizeReplay } from '../src/main/services/scripture/replay-report'
test('percentiles are absent when there are no samples',()=>{ assert.equal(percentile([],0.95),null); assert.equal(percentile([1,4,2,3],0.5),2) })
test('revisions replace the interim rather than append it',async()=>{
 const seen:string[]=[]
 await evaluateReplayCase({id:'revisions',split:'held-out',category:'negative',expected:[],events:[{atMs:0,type:'interim',text:'Love'},{atMs:100,type:'interim',text:'Love not'},{atMs:200,type:'final',text:'Love not the world'}]},text=>{seen.push(text);return []})
 assert.deepEqual(seen,['Love','Love not','Love not the world'])
})
test('misses and wrong references do not disappear into latency statistics',async()=>{
 const rows=[await evaluateReplayCase({id:'miss',split:'held-out',category:'exact',expected:['John 3:16'],evidenceAtMs:10,events:[{atMs:20,type:'final',text:'quote'}]},()=>[]),await evaluateReplayCase({id:'negative',split:'held-out',category:'negative',expected:[],events:[{atMs:20,type:'final',text:'talk'}]},()=>[{book:'John',chapter:3,verse:16,text:'text',score:8,ambiguous:false}])]
 const report=summarizeReplay(rows)
 assert.equal(report.missedCases,1);assert.equal(report.wrongPassageCases,1);assert.equal(report.falsePositiveNegativeCases,1)
 assert.equal(report.annotatedReplayEvidenceToFirstMatchMs.p95,null);assert.equal(report.audioToScreenMs,null)
})
test('recorded gaps and time reversals fail explicitly',async()=>{
 assert.throws(()=>recordedEventsToReplay([{type:'gap',count:3}]),/Incomplete/)
 await assert.rejects(evaluateReplayCase({id:'reversed',split:'held-out',category:'negative',expected:[],events:[{atMs:20,type:'final',text:'one'},{atMs:10,type:'final',text:'two'}]},()=>[]),/Non-monotonic/)
})
test('provider reconnect epoch permits offset reset and clears old rolling speech',async()=>{
 const seen:string[]=[]
 const events=recordedEventsToReplay([
  {type:'final',result:{id:'a',text:'old connection',words:[],isFinal:true,duration:1,timestamp:100,audioStart:20,audioEpoch:1}},
  {type:'final',result:{id:'b',text:'new connection',words:[],isFinal:true,duration:1,timestamp:200,audioStart:0,audioEpoch:2}},
 ])
 await evaluateReplayCase({id:'reconnect',split:'held-out',category:'negative',expected:[],events},text=>{seen.push(text);return []})
 assert.deepEqual(seen,['old connection','new connection'])
})
test('offset reversal inside one provider connection is still rejected',async()=>{
 await assert.rejects(evaluateReplayCase({id:'same-connection',split:'held-out',category:'negative',expected:[],events:[{atMs:0,type:'final',text:'one',audioStart:20,audioEpoch:1},{atMs:100,type:'final',text:'two',audioStart:0,audioEpoch:1}]},()=>[]),/Reordered audio/)
})

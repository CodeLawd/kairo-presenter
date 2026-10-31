import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTranscriptRecorder, replayTranscriptEvents } from '../transcript-recording'
test('opt-in local recording replays partial revisions and finals with original offsets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kairo-replay-'));const file=join(dir,'events.jsonl')
 try {
  assert.equal(createTranscriptRecorder(),null)
  const recorder=createTranscriptRecorder(file)!
  recorder.record('interim',{text:'Love not',stability:0.8,timestamp:100,audioStart:0})
  recorder.record('interim',{text:'Love not the world',stability:0.9,timestamp:200,audioStart:0})
  recorder.record('final',{text:'Love not the world',id:'f1',isFinal:true,timestamp:300,audioStart:0,words:[],duration:1})
  await recorder.close()
  const events=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  const actual:string[]=[]
  replayTranscriptEvents(events,{interim:r=>actual.push(`${r.timestamp}:${r.text}`),final:r=>actual.push(`${r.timestamp}:${r.audioStart}:${r.text}`)})
  assert.deepEqual(actual,['100:Love not','200:Love not the world','300:0:Love not the world'])
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('a replay refuses to hide events dropped by diagnostic backpressure',()=>{
 assert.throws(()=>replayTranscriptEvents([{type:'gap',count:2}],{interim(){},final(){}}),/Incomplete transcript recording/)
})

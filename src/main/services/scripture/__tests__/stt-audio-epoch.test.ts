import assert from 'node:assert/strict'
import test from 'node:test'
import { DeepgramSTTService } from '../../stt/deepgram'
import type { InterimResult, TranscriptResult } from '../../../../lib/ipc'
test('STT stamps interim and final offsets with provider connection generation',()=>{
 const service=new DeepgramSTTService()
 const interims:InterimResult[]=[],finals:TranscriptResult[]=[]
 service.on('interim',r=>interims.push(r));service.on('final',r=>finals.push(r))
 const internal=service as unknown as {connectionGeneration:number;handleResults:(message:unknown)=>void}
 internal.connectionGeneration=12
 internal.handleResults({start:0,duration:1,channel:{alternatives:[{transcript:'Next verse'}]}})
 internal.handleResults({start:0,duration:1,is_final:true,channel:{alternatives:[{transcript:'Next verse'}]}})
 internal.connectionGeneration=13
 internal.handleResults({start:0,duration:1,is_final:true,channel:{alternatives:[{transcript:'Next verse'}]}})
 assert.equal(interims[0].audioEpoch,12);assert.deepEqual(finals.map(r=>r.audioEpoch),[12,13]);assert.deepEqual(finals.map(r=>r.audioStart),[0,0])
})

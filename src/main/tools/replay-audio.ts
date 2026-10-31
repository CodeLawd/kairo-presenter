/** Developer-only audio replay entry. Never imported by the application entry. */
import { app } from 'electron'
import fs from 'node:fs'
import log from 'electron-log/main'
import { Readable } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'
import { createTranscriptRecorder } from '../services/scripture/transcript-recording'

async function main(): Promise<void> {
 log.transports.console.level = false
 const args = process.argv.slice(2)
 const option=(name:string):string|undefined=>{const index=args.indexOf(name);return index<0?undefined:args[index+1]}
 if(args.includes('--help')||!args.includes('--transcribe')) {
  console.log('Usage: bun run replay:audio --transcribe --input audio.pcm --out events.jsonl\nExplicit --transcribe consent required: consumes your existing managed transcription allowance. Input must be raw signed16-bit little-endian PCM,16000Hz,mono. Output is exclusive0600 JSONL. No credentials are accepted or printed. Sign in and activate Kairo first. Quit the normal app before running this diagnostic.');return
 }
 const input=option('--input'),output=option('--out')
 if(!input||!output)throw new Error('--input and --out are required')
 const stat=fs.statSync(input)
 if(!stat.isFile()||stat.size===0||stat.size%2!==0||stat.size>32000*60*30)throw new Error('Expected nonempty 16-bit PCM file,at most30minutes')
 if(fs.existsSync(output))throw new Error('Output already exists; choose another path')
 // Match normal Kairo identity; use its existing secure session,never copy/export credentials.
 app.setName('Kairo')
 await app.whenReady()
 const {cloudSession}=await import('../services/cloud/session')
 const {licensing}=await import('../services/cloud/licensing')
 const {DeepgramSTTService}=await import('../services/stt/deepgram')
 let releaseWork: Promise<void> | undefined
 const service=new DeepgramSTTService({
  transcription: () => licensing.transcription(),
  renewTranscription: id => licensing.renewTranscription(id),
  releaseTranscription: id => { releaseWork = licensing.releaseTranscription(id); return releaseWork },
 })
 const recorder=createTranscriptRecorder(output)!
 let source:Readable|undefined
 try {
  cloudSession.start()
  for(let i=0;i<100&&cloudSession.getSession().state!=='active';i++)await wait(100)
  if(cloudSession.getSession().state!=='active')throw new Error('No ready Kairo session; sign in through the normal app first')
  licensing.start()
  await licensing.refresh()
  service.configure('', 'en', [])
  service.on('interim',event=>recorder.record('interim',event))
  service.on('final',event=>recorder.record('final',event))
  let connectionError:Error|undefined
  service.on('error',error=>{connectionError=error})
  await service.connect()
  if(connectionError)throw connectionError
  const startedAt=Date.now()
  source=Readable.from((async function*(){
   const file=fs.createReadStream(input,{highWaterMark:640})
   let sent=0
   for await(const chunk of file){
    if(connectionError)throw connectionError
    const delay=startedAt+sent/32-Date.now();if(delay>0)await wait(delay)
    sent+=(chunk as Buffer).length;yield chunk
   }
   // Real silence frames let the provider endpoint the last spoken segment.
   for(let i=0;i<150;i++) {
    if(connectionError)throw connectionError
    const delay=startedAt+sent/32-Date.now();if(delay>0)await wait(delay)
    sent+=640;yield Buffer.alloc(640)
   }
  })())
  service.attachStream(source)
  await new Promise<void>((resolve,reject)=>{source!.once('end',resolve);source!.once('error',reject)})
  await wait(3000)
  if(connectionError)throw connectionError
  console.log(JSON.stringify({recording:output,inputDurationMs:stat.size/32,captureStartedAt:startedAt,sampleRate:16000,channels:1,format:'s16le',audioToScreenMs:null}))
 } finally {
  source?.destroy();service.disconnect();await releaseWork?.catch(()=>undefined);await recorder.close();cloudSession.stop()
 }
}
void main().then(()=>app.quit()).catch(()=>{console.error('Audio replay failed. Verify the input format and your Kairo sign-in/licence. No provider credentials were printed.');app.exit(1)})

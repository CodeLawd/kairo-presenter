import {readFile,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
const require=createRequire(import.meta.url)
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const binRoot=path.dirname(require.resolve(`@remotion/compositor-${process.platform}-${process.arch}`))
const env={...process.env,...(process.platform==='darwin'?{DYLD_LIBRARY_PATH:binRoot}:{})}
const manifest=JSON.parse(await readFile(path.join(root,'out/animatic/manifest.json'),'utf8'))
const report=[]
for(const film of manifest){
 const file=path.join(root,`out/animatic/${film.name}-animatic.mp4`)
 const result=spawnSync(path.join(binRoot,'ffprobe'),['-v','error','-show_streams','-show_format','-of','json',file],{env,encoding:'utf8'})
 if(result.status!==0)throw new Error(result.stderr)
 const meta=JSON.parse(result.stdout)
 const video=meta.streams.find(s=>s.codec_type==='video')
 if(video.width!==film.width||video.height!==film.height||video.avg_frame_rate!==`${film.fps}/1`||Number(video.nb_frames)!==film.frames)throw new Error(`${film.name}: incorrect video metadata`)
 const duration=Number(meta.format.duration)
 if(Math.abs(duration-film.seconds)>.02)throw new Error(`${film.name}: incorrect duration`)
 const cues=JSON.parse(await readFile(path.join(root,`src/data/${film.name}-captions.json`),'utf8'))
 let last=0
 for(const cue of cues){
  if(cue.startMs<last||cue.endMs<=cue.startMs||cue.endMs>duration*1000)throw new Error(`${film.name}: invalid caption ${cue.text}`)
  last=cue.endMs
 }
 const decode=spawnSync(path.join(binRoot,'ffmpeg'),['-v','error','-i',file,'-c:v','rawvideo','-f','null','-'],{env,encoding:'utf8'})
 if(decode.status!==0)throw new Error(`${film.name}: decode failed: ${decode.stderr}`)
 const captionWarnings=cues.filter(c=>c.text.split(/\s+/).length>6).map(c=>({text:c.text,issue:'Scratch cue exceeds six words; shorten before final export'}))
 report.push({film:film.name,width:video.width,height:video.height,fps:film.fps,frames:Number(video.nb_frames),duration,captions:cues.length,captionWarnings,audioTracks:meta.streams.filter(s=>s.codec_type==='audio').length,decode:'passed',visualReview:'sampled PNGs; final frame-by-frame review pending'})
 console.log(`${film.name}: metadata, caption timing and full decode passed`)
}
await writeFile(path.join(root,'out/animatic/verification.json'),JSON.stringify(report,null,2)+'\n')

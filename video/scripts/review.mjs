import http from 'node:http'
import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../out/animatic')
const types={'.html':'text/html; charset=utf-8','.mp4':'video/mp4','.png':'image/png','.srt':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json'}
http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return}
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html'
  if(!/^[a-zA-Z0-9.-]+$/.test(name)){res.writeHead(404).end();return}
  const file=path.join(root,name);const info=await stat(file)
  if(!info.isFile()){res.writeHead(404).end();return}
  const headers={'Content-Type':types[path.extname(name)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'}
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
  if(range){
   const start=Number(range[1]);const end=range[2]?Math.min(Number(range[2]),info.size-1):info.size-1
   if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return}
   res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1})
   if(req.method==='HEAD')res.end();else createReadStream(file,{start,end}).pipe(res)
  }else{
   res.writeHead(200,{...headers,'Content-Length':info.size})
   if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res)
  }
 }catch{res.writeHead(404).end('Not found')}
}).listen(3010,'127.0.0.1',()=>console.log('Kairo film review: http://127.0.0.1:3010'))

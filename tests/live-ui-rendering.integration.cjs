// Run with: node_modules/.bin/electron tests/live-ui-rendering.integration.cjs
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-live-render-'))
app.setPath('userData', path.join(dir, 'profile'))
let win
const timer = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
 fs.writeFileSync(path.join(dir,'fixture.tsx'), `
 import React,{Profiler} from 'react';import {createRoot} from 'react-dom/client';
 import UpdatePill from '${path.resolve('src/renderer/src/components/layout/UpdatePill.tsx')}';
 import {useAppStore} from '${path.resolve('src/renderer/src/stores/useAppStore.ts')}';
 window.api={updates:{getStatus:async()=>({state:'available',version:'1.2.3'}),onStatus:()=>()=>{},download:async()=>{},install:async()=>{}}};
 window.commits=0;window.store=useAppStore;
 createRoot(document.getElementById('root')).render(<Profiler id="header" onRender={()=>window.commits++}><UpdatePill/></Profiler>);
 `)
 buildSync({entryPoints:[path.join(dir,'fixture.tsx')],outfile:path.join(dir,'fixture.js'),bundle:true,platform:'browser',jsx:'automatic',nodePaths:[path.resolve('node_modules')],alias:{'@':path.resolve('src/renderer/src'),'@shared':path.resolve('src/lib')},define:{'process.env.NODE_ENV':'"development"'}})
 fs.writeFileSync(path.join(dir,'index.html'),'<html><body><div id="root"></div><script src="fixture.js"></script></body></html>')
 win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}})
 await win.loadFile(path.join(dir,'index.html'))
 const result=await win.webContents.executeJavaScript(`(async()=>{
 const settle=()=>new Promise(r=>setTimeout(r,30));await settle();
 const before=window.commits;
 for(let i=0;i<12;i++){window.store.setState({audioLevel:{rms:i/12,clipping:false},transcriptWordCount:i});await settle();}
 const after=window.commits;
 window.store.setState({isTranscribing:true});await settle();
 return {before,after,live:window.commits};})()`)
 assert.equal(result.after,result.before,'audio and transcript telemetry must not repaint update controls')
 assert.ok(result.live>result.after,'live session state still updates controls')
 console.log('PASS: 12 telemetry updates cause zero header commits; live session changes still render.',result)
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{clearTimeout(timer);win?.destroy();fs.rmSync(dir,{recursive:true,force:true});app.exit(process.exitCode||0)})

// Run with: electron tests/video-driver-notice.integration.cjs
// Isolated driver-message UI; no driver, real hardware or browser launch.
const { app, BrowserWindow, ipcMain } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-driver-notice-'))
app.setPath('userData', dir)
let win, downloads = 0
const errors = []
ipcMain.handle('test:downloads', () => { downloads++ })
const timer = setTimeout(() => app.exit(1), 20000)
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('api',{videoDevices:{openDriverDownloads:()=>ipcRenderer.invoke('test:downloads')}});`)
  fs.writeFileSync(path.join(dir, 'fixture.tsx'), `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoDeviceFields} from '${path.resolve('src/renderer/src/components/screens/VideoDeviceFields.tsx')}';
    import {makeOverlayOutput} from '${path.resolve('src/lib/overlay-defaults.ts')}';
    function Fixture() {
      const [driver,setDriver]=useState({state:'compatibility',message:'Desktop Video 15.3.1 detected. Kairo is using compatibility mode.'});
      window.setDriver=setDriver;
      return <VideoDeviceFields output={makeOverlayOutput('card','device')} onChange={()=>{}} snapshot={{ports:[],outputs:{},providers:[{name:'decklink',available:driver.state==='current'||driver.state==='compatibility',driver}]}}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `)
  buildSync({ entryPoints: [path.join(dir, 'fixture.tsx')], outfile: path.join(dir, 'fixture.js'), bundle: true,
    platform: 'browser', jsx: 'automatic', nodePaths: [path.resolve('node_modules')],
    alias: { '@': path.resolve('src/renderer/src'), '@shared': path.resolve('src/lib') }, define: { 'process.env.NODE_ENV': '"production"' } })
  const assets = path.resolve('out/renderer/assets')
  const css = fs.readdirSync(assets).find((name) => name.startsWith('index-') && name.endsWith('.css'))
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><title>Video driver guidance</title><link rel="stylesheet" href="${pathToFileURL(path.join(assets, css))}"></head><body class="bg-surface" style="padding:32px"><h1 style="color:white;margin-bottom:24px">Video card hardware</h1><div id="root" style="max-width:560px"></div><script src="fixture.js"></script></body></html>`)
  win = new BrowserWindow({show:false,width:850,height:650,webPreferences:{preload:path.join(dir,'preload.cjs'),nodeIntegration:false,contextIsolation:true}})
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadFile(path.join(dir,'index.html'))
  const run = (code) => win.webContents.executeJavaScript(`(async()=>{await new Promise(r=>setTimeout(r,100));${code}})()`)
  assert.match(await run(`return document.body.innerText;`), /15\.3\.1.*compatibility mode/)
  assert.equal(await run(`return [...document.querySelectorAll('button')].some(x=>x.textContent==='Open download page');`), false)
  await run(`window.setDriver({state:'unsupported',message:'Desktop Video 14.4 is too old. Update Blackmagic Desktop Video to 15.3.1 or later, then restart the Mac.'});`)
  await run(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Open download page').click();`)
  assert.equal(downloads,1)
  fs.writeFileSync('/private/tmp/kairo-video-driver-notice.png',(await win.webContents.capturePage()).toPNG())
  await run(`window.setDriver({state:'missing',message:'Install Blackmagic Desktop Video to use this card, then restart the Mac.'});`)
  assert.match(await run(`return document.body.innerText;`), /Install Blackmagic Desktop Video/)
  await run(`window.setDriver({state:'current',message:'Desktop Video 16.4 detected.'});`)
  assert.equal(await run(`return [...document.querySelectorAll('button')].some(x=>x.textContent==='Open download page');`),false)
  assert.deepEqual(errors,[])
  console.log('PASS: compatibility is informational; unsupported/missing drivers offer downloads; button reaches the bridge; current empty inventory has no update prompt.')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{clearTimeout(timer);win?.destroy();fs.rmSync(dir,{recursive:true,force:true});app.exit(process.exitCode||0)})

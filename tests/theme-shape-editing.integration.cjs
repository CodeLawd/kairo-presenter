// Run with: electron tests/theme-shape-editing.integration.cjs
// Isolated theme UI + persistence. Does not open live presentation outputs.
const { app, BrowserWindow, ipcMain } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-shape-editing-'))
app.setPath('userData', dir)
const file = path.join(dir, 'settings.json')
let win
const errors = []
ipcMain.handle('test:read', () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
ipcMain.handle('test:write', (_, key, value) => {
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  current[key] = Array.isArray(value) ? value : { ...current[key], ...value }
  fs.writeFileSync(file, JSON.stringify(current))
})
const timer = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(dir,'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('api',{settings:{getAll:()=>ipcRenderer.invoke('test:read'),get:async key=>(await ipcRenderer.invoke('test:read'))?.[key],set:(key,value)=>ipcRenderer.invoke('test:write',key,value)}});`)
  fs.writeFileSync(path.join(dir,'fixture.tsx'), `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import ThemeEditor from '${path.resolve('src/renderer/src/components/theme/ThemeEditor.tsx')}';
    import {useBootstrapStore} from '${path.resolve('src/renderer/src/bootstrap/useBootstrapStore.ts')}';
    import {DEFAULT_SETTINGS} from '${path.resolve('src/renderer/src/lib/defaultSettings.ts')}';
    import {createCustomTheme} from '${path.resolve('src/lib/theme-library.ts')}';
    (async()=>{const saved=await window.api.settings.getAll();const settings={...DEFAULT_SETTINGS,...saved};
      if(!saved){settings.themeLibrary=[createCustomTheme('Sunday',DEFAULT_SETTINGS.overlay.theme,'scripture',1,'sunday')];await window.api.settings.set('themeLibrary',settings.themeLibrary);await window.api.settings.set('overlay',settings.overlay);}
      useBootstrapStore.getState().setSettings(settings);createRoot(document.getElementById('root')).render(<ThemeEditor/>);
    })();
  `)
  buildSync({entryPoints:[path.join(dir,'fixture.tsx')],outfile:path.join(dir,'fixture.js'),bundle:true,platform:'browser',jsx:'automatic',nodePaths:[path.resolve('node_modules')],alias:{'@':path.resolve('src/renderer/src'),'@shared':path.resolve('src/lib')},loader:{'.png':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}})
  const assets=path.resolve('out/renderer/assets'), css=fs.readdirSync(assets).find(x=>x.startsWith('index-')&&x.endsWith('.css'))
  fs.writeFileSync(path.join(dir,'index.html'),`<html><head><title>Theme shape editing</title><link rel="stylesheet" href="${pathToFileURL(path.join(assets,css))}"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="fixture.js"></script></body></html>`)
  win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload:path.join(dir,'preload.cjs'),nodeIntegration:false,contextIsolation:true}})
  win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
  await win.loadFile(path.join(dir,'index.html'))
  const run=code=>win.webContents.executeJavaScript(`(async()=>{const wait=()=>new Promise(r=>setTimeout(r,120));await wait();${code}})()`)
  await run(`for(let i=0;i<25&&!document.querySelector('[aria-label="Theme name"]');i++)await wait();[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Add Element')).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));await wait();document.querySelector('[role="menuitem"][aria-label="Right arrow"]').click();`)
  assert.match(await run(`return document.body.innerText;`), /Edit shape/)
  await run(`document.querySelector('[aria-label="Flip horizontal"]').click();await wait();document.querySelector('[aria-label="Flip vertical"]').click();await wait();document.querySelector('[aria-label="Align right to slide"]').click();await new Promise(r=>setTimeout(r,650));document.querySelector('[aria-label="Align bottom to slide"]').click();await new Promise(r=>setTimeout(r,650));`)
  const readShape=()=>JSON.parse(fs.readFileSync(file,'utf8')).themeLibrary[0].theme.elements[0]
  let shape=readShape()
  assert.equal(shape.flipX,true);assert.equal(shape.flipY,true)
  assert.equal(shape.box.xPct+shape.box.widthPct,100);assert.equal(shape.box.yPct+shape.box.heightPct,100)
  fs.writeFileSync('/private/tmp/kairo-shape-editing.png',(await win.webContents.capturePage()).toPNG())
  await run(`document.querySelector('[aria-label="Undo"]').click();await new Promise(r=>setTimeout(r,650));`)
  assert.notEqual(readShape().box.yPct+readShape().box.heightPct,100)
  await run(`document.querySelector('[aria-label="Redo"]').click();await new Promise(r=>setTimeout(r,650));[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Theme settings')).click();`)
  assert.ok(await run(`return Boolean(document.querySelector('[aria-label="Edit right arrow"]'));`),'Element must be reachable without opening Layout')
  await run(`document.querySelector('[aria-label="Edit right arrow"]').click();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Flip horizontal"]').getAttribute('aria-pressed');`),'true')
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()})
  await run(`for(let i=0;i<25&&!document.querySelector('[aria-label="Edit right arrow"]');i++)await wait();document.querySelector('[aria-label="Edit right arrow"]').click();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Flip vertical"]').getAttribute('aria-pressed');`),'true')
  shape=readShape();assert.equal(shape.box.yPct+shape.box.heightPct,100)
  assert.deepEqual(errors,[])
  console.log('PASS: add/select shape, flip both axes, align, undo/redo, discover from any tab, and reload persisted edits.')
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearTimeout(timer);win?.destroy();fs.rmSync(dir,{recursive:true,force:true});app.exit(process.exitCode||0)})

// Run with: node_modules/.bin/electron tests/theme-picker.integration.cjs
// Isolated picker UI; never changes real settings or opens presentation outputs.
const { app, BrowserWindow, ipcMain } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-theme-picker-'))
app.setPath('userData', path.join(dir, 'profile'))
let win
let settings = {}
let failSave = false
const timer = setTimeout(() => { console.error('Theme picker test timed out'); app.exit(1) }, 30000)
app.whenReady().then(async () => {
  ipcMain.handle('test:write', (_, key, value) => {
    if (failSave) throw new Error('Simulated save failure')
    settings[key] = value
  })
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('api',{settings:{set:(key,value)=>ipcRenderer.invoke('test:write',key,value)}});`)
  fs.writeFileSync(path.join(dir, 'fixture.tsx'), `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ThemePicker} from '${path.resolve('src/renderer/src/components/layout/ThemePicker.tsx')}';
    import {useBootstrapStore} from '${path.resolve('src/renderer/src/bootstrap/useBootstrapStore.ts')}';
    import {DEFAULT_SETTINGS} from '${path.resolve('src/renderer/src/lib/defaultSettings.ts')}';
    import {createCustomTheme} from '${path.resolve('src/lib/theme-library.ts')}';
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.overlay.outputs=[{...settings.overlay.outputs[0],id:'pastor',name:'Pastor screen'},{...structuredClone(settings.overlay.outputs[0]),id:'lower',name:'Lower third',kind:'ndi'}];
    settings.themeLibrary=[createCustomTheme('Sunday Scripture',settings.overlay.theme,'scripture',1,'sunday'),createCustomTheme('Sunday Lyrics',settings.overlay.theme,'lyrics',1,'lyrics')];
    useBootstrapStore.getState().setSettings(settings);
    class Boundary extends React.Component {state={error:''};static getDerivedStateFromError(error){return {error:error.message}};render(){return this.state.error?<div role="alert">{this.state.error}</div>:this.props.children}}
    createRoot(document.getElementById('root')).render(<Boundary><ThemePicker currentRoute="scripture"/></Boundary>);
  `)
  buildSync({entryPoints:[path.join(dir,'fixture.tsx')],outfile:path.join(dir,'fixture.js'),bundle:true,platform:'browser',jsx:'automatic',nodePaths:[path.resolve('node_modules')],alias:{'@':path.resolve('src/renderer/src'),'@shared':path.resolve('src/lib')},define:{'process.env.NODE_ENV':'"production"'}})
  fs.writeFileSync(path.join(dir,'index.html'), '<html><body><div id="root"></div><script src="fixture.js"></script></body></html>')
  win = new BrowserWindow({show:false,width:1000,height:700,webPreferences:{preload:path.join(dir,'preload.cjs'),nodeIntegration:false,contextIsolation:true}})
  await win.loadFile(path.join(dir,'index.html'))
  const run = code => win.webContents.executeJavaScript(`(async()=>{const wait=()=>new Promise(r=>setTimeout(r,100));await wait();${code}})()`)
  await run(`document.querySelector('[aria-label="Screen Themes"]').click();await wait();`)
  assert.equal(await run(`return !!document.querySelector('[role="dialog"][aria-label="Screen Themes"]');`), true, 'Opening Themes must render the picker without crashing')
  assert.equal(await run(`return !!document.querySelector('[aria-label="Apply Sunday Scripture"]');`), true)
  await run(`document.querySelector('[aria-label="Apply Sunday Scripture"]').click();await wait();`)
  assert.equal(settings.overlay.outputs[0].themeId, 'sunday')
  assert.equal(settings.overlay.outputs[1].themeId, null, 'Scripture pick must leave the lower third unchanged')
  assert.equal(settings.themeDefaults, undefined, 'Per-screen picks must not change defaults')
  await run(`[...document.querySelectorAll('[role="radio"]')].find(x=>x.textContent==='Lyrics').click();await wait();document.querySelector('[aria-label="Apply Sunday Lyrics"]').click();await wait();`)
  assert.equal(settings.overlay.outputs[0].lyrics.themeId, 'lyrics')
  assert.equal(settings.overlay.outputs[0].themeId, 'sunday', 'Lyrics selection must preserve scripture theme')
  assert.equal(settings.overlay.outputs[1].lyrics, null, 'Pastor lyrics pick must leave the lower third unchanged')
  await run(`document.querySelector('[aria-label="Theme screen"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',ctrlKey:false}));await wait();`)
  assert.equal(await run(`return !!document.querySelector('[role="listbox"]');`), true, 'Screen selector opens inside the theme picker')
  await run(`[...document.querySelectorAll('[role="option"]')].find(x=>x.textContent.includes('Lower third')).click();await wait();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Apply Sunday Lyrics"]').getAttribute('aria-pressed');`), 'false', 'Checkmark follows the selected screen')
  await run(`document.querySelector('[aria-label="Apply Sunday Lyrics"]').click();await wait();`)
  assert.equal(settings.overlay.outputs[1].lyrics.themeId, 'lyrics')
  assert.equal(settings.overlay.outputs[1].themeId, null, 'Lower third scripture remains unchanged')
  assert.equal(settings.overlay.outputs[0].themeId, 'sunday')
  assert.equal(settings.overlay.outputs[0].lyrics.themeId, 'lyrics')
  failSave = true
  await run(`document.querySelector('[aria-label="Apply Sunday Lyrics"]').click();await wait();`)
  assert.match(await run(`return document.querySelector('[role="alert"]').textContent;`), /could not be applied/)
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();`)
  assert.equal(await run(`return !!document.querySelector('[role="dialog"]');`), false)
  console.log('PASS: open picker, select Scripture/Lyrics, persist each kind per screen without changing other outputs or defaults, report save failure, close with Escape.')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(timer); win?.destroy(); fs.rmSync(dir,{recursive:true,force:true}); app.exit(process.exitCode || 0)
})

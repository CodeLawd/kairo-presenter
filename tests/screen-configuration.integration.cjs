// Isolated renderer + disk round-trip. No real screens, settings or hardware.
const { app, BrowserWindow, ipcMain } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-screen-ui-'))
app.setPath('userData', dir)
let win
const errors = []
const timer = setTimeout(() => { console.error('Screen test timed out'); app.exit(1) }, 30000)
const file = path.join(dir, 'settings.json')
ipcMain.handle('test:read', () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
ipcMain.handle('test:write', (_, key, patch) => {
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  current[key] = Array.isArray(patch) ? patch : { ...current[key], ...patch }
  fs.writeFileSync(file, JSON.stringify(current))
})
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `
    const { contextBridge, ipcRenderer } = require('electron');
    const idle = () => () => {};
    const status = { available: false, sending: false, ppInputConfigured: false, outputs: [] };
    const devices = { ports: [{id:'decklink:123:3',provider:'decklink',deviceName:'Duo 2',portName:'Duo 2 (4)',supportsKeyFill:false,unavailableReason:null,modes:[{id:'decklink:25',label:'1080p25',width:1920,height:1080,frameRateN:25,frameRateD:1,interlaced:false}]}],providers:[{name:'decklink',available:true}],outputs:{} };
    contextBridge.exposeInMainWorld('api', {
      settings: { getAll: () => ipcRenderer.invoke('test:read'), get: async key => (await ipcRenderer.invoke('test:read'))?.[key], set: (key,value) => ipcRenderer.invoke('test:write',key,value) },
      displays: {list: async () => [], onChanged: idle},
      ndi: {getStatus: async () => status, getVideoInputs: async () => []},
      media: {getLibrary: async () => ({playlists:[]}), onLibraryChange: idle},
      videoDevices: {status: async () => devices, onChanged: idle},
      program: {stageStatus: async () => [], onStageStatus: idle},
      propresenter: {getLooks: async () => []}
    });
  `)
  fs.writeFileSync(path.join(dir, 'fixture.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import ScreenConfiguration from '${path.resolve('src/renderer/src/components/screens/ScreenConfiguration.tsx')}';
    import ThemeEditor from '${path.resolve('src/renderer/src/components/theme/ThemeEditor.tsx')}';
    import { useBootstrapStore } from '${path.resolve('src/renderer/src/bootstrap/useBootstrapStore.ts')}';
    import { DEFAULT_SETTINGS } from '${path.resolve('src/renderer/src/lib/defaultSettings.ts')}';
    import { makeOverlayOutput } from '${path.resolve('src/lib/overlay-defaults.ts')}';
    import { assignThemeToOutput, createCustomTheme } from '${path.resolve('src/lib/theme-library.ts')}';
    (async () => {
      const theme = createCustomTheme('Sunday',DEFAULT_SETTINGS.overlay.theme,'scripture',1,'sunday');
      const initial = { ...DEFAULT_SETTINGS, themeLibrary:[theme], overlay:{...DEFAULT_SETTINGS.overlay, outputs:[assignThemeToOutput(makeOverlayOutput('screen-a','screen',{name:'Screen A'}),theme),makeOverlayOutput('screen-b','screen',{name:'Screen B'})]} };
      const saved = await window.api.settings.getAll();
      const settings = saved ? {...initial,...saved} : initial;
      if (!saved) await window.api.settings.set('overlay',settings.overlay);
      useBootstrapStore.getState().setSettings(settings);
      window.confirm = () => true;
      createRoot(document.getElementById('root')).render(<><div style={{display:'none'}}><ThemeEditor /></div><ScreenConfiguration initialSelect="screen-a" onClose={() => {}} /></>);
    })();
  `)
  buildSync({ entryPoints: [path.join(dir, 'fixture.tsx')], outfile: path.join(dir, 'fixture.js'), bundle: true,
    platform: 'browser', jsx: 'automatic', nodePaths: [path.resolve('node_modules')],
    alias: { '@': path.resolve('src/renderer/src'), '@shared': path.resolve('src/lib') },
    loader: { '.png': 'dataurl', '.jpg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } })
  const assets = path.resolve('out/renderer/assets')
  const css = fs.readdirSync(assets).find((name) => name.startsWith('index-') && name.endsWith('.css'))
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><title>Screen configuration regression</title><link rel="stylesheet" href="${pathToFileURL(path.join(assets, css))}"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="fixture.js"></script></body></html>`)
  win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(dir, 'preload.cjs'), nodeIntegration: false, contextIsolation: true } })
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message) })
  await win.loadFile(path.join(dir, 'index.html'))
  const run = (code) => win.webContents.executeJavaScript(`(async () => { const wait = () => new Promise(r => setTimeout(r,100)); await wait(); ${code} })()`)
  await run(`for(let i=0;i<30&&!document.querySelector('nav');i++) await wait();`)
  assert.ok(await run(`return Boolean(document.querySelector('nav'));`), await run(`return JSON.stringify({text:document.body.innerText,errors:${JSON.stringify(errors)}});`))
  await run(`document.querySelector('[aria-label="Add to Audience"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); await wait();`)
  assert.ok(await run(`return [...document.querySelectorAll('[role="menuitem"]')].some(x=>x.textContent==='Video card');`), await run(`return document.body.innerText;`))
  await run(`[...document.querySelectorAll('[role="menuitem"]')].find(x=>x.textContent==='Video card').click(); await wait();`)
  await run(`const port=document.querySelector('select[id$="-port"]'); port.value='decklink:123:3'; port.dispatchEvent(new Event('change',{bubbles:true})); await wait();`)
  await run(`const input=document.querySelector('[aria-label="Theme name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Sunday edited'); input.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,600));`)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  const card = saved.overlay.outputs.find((o) => o.kind === 'device')
  assert.ok(card, 'Theme save must keep the newly added video card')
  assert.equal(card.devicePortId, 'decklink:123:3')
  assert.equal(card.deviceModeId, 'decklink:25')
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
  await run(`await wait();`)
  assert.ok(await run(`return document.querySelector('nav').textContent.includes('Video card');`), 'Video card must survive renderer restart')
  await run(`const button=[...document.querySelectorAll('nav button')].find(x=>x.textContent.includes('Screen B')); button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:250,button:2})); await wait();`)
  assert.ok(await run(`return [...document.querySelectorAll('[role="menuitem"]')].some(x=>x.textContent==='Delete');`))
  fs.writeFileSync('/private/tmp/kairo-screen-delete.png', (await win.webContents.capturePage()).toPNG())
  await run(`[...document.querySelectorAll('[role="menuitem"]')].find(x=>x.textContent==='Delete').click(); await wait();`)
  const deleted = JSON.parse(fs.readFileSync(file, 'utf8')).overlay.outputs
  assert.ok(deleted.some((o) => o.id === 'screen-a'), 'Right-click must not delete the selected screen')
  assert.ok(!deleted.some((o) => o.id === 'screen-b'), 'Right-click deletes its target')
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
  await run(`await wait();`)
  assert.equal(await run(`return document.querySelector('nav').textContent.includes('Screen B');`), false)
  assert.deepEqual(errors, [])
  console.log('PASS: video-card binding survives theme save and restart; right-click deletes its target and stays deleted after restart.')
}).catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(timer); win?.destroy(); fs.rmSync(dir, { recursive: true, force: true }); app.exit(process.exitCode || 0)
})

// Run with: node_modules/.bin/electron tests/theme-text-size.integration.cjs
// Exercises the text inspector in isolation; never changes live outputs.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-text-size-'))
app.setPath('userData', path.join(dir, 'profile'))
let win
const timer = setTimeout(() => app.exit(1), 30000)
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(dir, 'fixture.tsx'), `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ThemeTypePanel} from '${path.resolve('src/renderer/src/components/theme/ThemeTypePanel.tsx')}';
    import {DEFAULT_OVERLAY_THEME} from '${path.resolve('src/lib/overlay-defaults.ts')}';
    function Fixture(){const [theme,setTheme]=useState({...structuredClone(DEFAULT_OVERLAY_THEME),layout:{...DEFAULT_OVERLAY_THEME.layout,autoFitText:true}});const [layer,setLayer]=useState('verse');const [kind,setKind]=useState('lyrics');return <><button onClick={()=>setKind('scripture')}>Test Scripture</button><ThemeTypePanel theme={theme} contentKind={kind} selectedLayer={layer} onSelectLayer={setLayer} onUpdateLayer={(id,partial)=>setTheme(current=>({...current,[id]:{...current[id],...partial}}))} onUpdateReferenceMeta={partial=>setTheme(current=>({...current,reference:{...current.reference,...partial}}))} onAutoFitChange={autoFitText=>setTheme(current=>({...current,layout:{...current.layout,autoFitText}}))}/></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `)
  buildSync({entryPoints:[path.join(dir,'fixture.tsx')],outfile:path.join(dir,'fixture.js'),bundle:true,platform:'browser',jsx:'automatic',nodePaths:[path.resolve('node_modules')],alias:{'@':path.resolve('src/renderer/src'),'@shared':path.resolve('src/lib')},define:{'process.env.NODE_ENV':'"production"'}})
  fs.writeFileSync(path.join(dir,'index.html'), '<html><body><div id="root"></div><script src="fixture.js"></script></body></html>')
  win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}})
  await win.loadFile(path.join(dir,'index.html'))
  const run=code=>win.webContents.executeJavaScript(`(async()=>{await new Promise(r=>setTimeout(r,100));${code}})()`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').disabled;`),false,'Lyrics size is editable while fit to box is on')
  await run(`const el=document.querySelector('[aria-label="Size"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'73');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').value;`),'73','Custom size is retained')
  assert.equal(await run(`return document.querySelector('[aria-label="Scaling"]').value;`),'none','Editing size turns off automatic fitting')
  await run(`[...document.querySelectorAll('button')].find(el=>el.textContent==='Test Scripture').click();const el=document.querySelector('[aria-label="Scaling"]');el.value='fit';el.dispatchEvent(new Event('change',{bubbles:true}));`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').disabled;`),false,'Scripture size is editable while fitting')
  await run(`const el=document.querySelector('[aria-label="Size"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'91');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').value;`),'91')
  assert.equal(await run(`return document.querySelector('[aria-label="Scaling"]').value;`),'none')
  console.log('PASS: custom lyric and scripture sizes switch automatic fitting to manual sizing.')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{clearTimeout(timer);win?.destroy();fs.rmSync(dir,{recursive:true,force:true});app.exit(process.exitCode||0)})

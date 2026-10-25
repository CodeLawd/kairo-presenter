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
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').disabled;`),true,'Lyrics size stays visible while automatic')
  assert.match(await run(`const el=document.querySelector('[aria-label="Size"]');return document.getElementById(el.getAttribute('aria-describedby')).textContent;`), /Size is automatic/)
  await run(`document.querySelector('[aria-label="Fit to box"]').click();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').disabled;`),false)
  await run(`const el=document.querySelector('[aria-label="Size"]');el.value='72';el.dispatchEvent(new Event('change',{bubbles:true}));`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').value;`),'72')
  await run(`document.querySelector('[aria-label="Fit to box"]').click();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').disabled;`),true)
  await run(`document.querySelector('[aria-label="Fit to box"]').click();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').value;`),'72','Manual size survives toggling automatic sizing')
  await run(`[...document.querySelectorAll('button')].find(el=>el.textContent==='Test Scripture').click();document.querySelector('[aria-label="Fit to box"]').click();`)
  assert.equal(await run(`return document.querySelector('[aria-label="Size"]').disabled;`),true,'Scripture uses the same sizing controls')
  console.log('PASS: visible automatic size with accessible hint, manual size editing, retained size after toggling, shared Scripture behavior.')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{clearTimeout(timer);win?.destroy();fs.rmSync(dir,{recursive:true,force:true});app.exit(process.exitCode||0)})

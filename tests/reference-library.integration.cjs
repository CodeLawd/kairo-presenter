// Isolated visual and interaction check; never connects to presentation outputs.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-reference-ui-'))
app.setPath('userData', dir)
let win
const timer = setTimeout(() => app.exit(1), 20000)
app.whenReady().then(async () => {
  fs.writeFileSync(path.join(dir, 'fixture.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ReferenceLibrary } from '${path.resolve('src/renderer/src/components/operator/ReferenceLibrary.tsx')}';
    const refs = ['Acts 4:8–12', 'Acts 10:17–33', 'Genesis 4:8–12', '1 John 3:10–15', 'Genesis 4:16–17', 'Jonah 1:1–3', 'Jonah 2:1–2', 'Job 21:7–18', 'Job 27:11–23', 'Psalms 73:1–28', 'Proverbs 10:22'];
    createRoot(document.getElementById('root')).render(<ReferenceLibrary detected={[]} listening={true} planTitle="Biblical examples of men & churches who honor God" passages={refs.map((reference, i) => ({ id: String(i), reference, live: i === 1, heard: i === 0, fromSermon: i === 0, expectedReference: i === 2 ? 'Genesis 4:8' : undefined, present: () => { window.presented = reference; } }))} />);
  `)
  buildSync({ entryPoints: [path.join(dir, 'fixture.tsx')], outfile: path.join(dir, 'fixture.js'), bundle: true, platform: 'browser', jsx: 'automatic', nodePaths: [path.resolve('node_modules')], alias: { '@': path.resolve('src/renderer/src') }, define: { 'process.env.NODE_ENV': '"production"' } })
  const assets = path.resolve('out/renderer/assets')
  const css = fs.readdirSync(assets).find(x => x.startsWith('index-') && x.endsWith('.css'))
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><link rel="stylesheet" href="${pathToFileURL(path.join(assets, css))}"></head><body style="margin:0;background:#141312;padding:24px"><div style="color:#aaa;font:13px sans-serif;margin-bottom:16px">Detected content</div><div id="root" style="height:390px;border:1px solid #ffffff15;border-radius:8px;overflow:hidden"></div><script src="./fixture.js"></script></body></html>`)
  win = new BrowserWindow({ show: false, width: 1000, height: 490, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await win.loadFile(path.join(dir, 'index.html'))
  await win.webContents.executeJavaScript('document.fonts.ready')
  const initial = await win.webContents.executeJavaScript(`({active: document.querySelector('[aria-pressed="true"]').textContent, rows: document.querySelectorAll('li').length, overflow: document.documentElement.scrollWidth > innerWidth})`)
  assert.ok(initial.active.includes('Sermon passages'))
  assert.equal(initial.rows, 11)
  assert.equal(initial.overflow, false)
  const labels = await win.webContents.executeJavaScript('document.body.textContent')
  assert.ok(labels.includes('From sermon'))
  assert.ok(labels.includes('Next · Genesis 4:8'))
  fs.writeFileSync('/tmp/kairo-reference-library.png', (await win.webContents.capturePage()).toPNG())
  const filtered = await win.webContents.executeJavaScript(`(async () => {
    const input = document.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'John 3');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    const rows = document.querySelectorAll('li');
    rows[0].querySelector('button').click();
    return { count: rows.length, presented: window.presented };
  })()`)
  assert.equal(filtered.count, 1)
  assert.equal(filtered.presented, '1 John 3:10–15')
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Passage source"] button').click()`)
  await new Promise(r => setTimeout(r, 50))
  const empty = await win.webContents.executeJavaScript(`document.body.textContent`)
  assert.ok(empty.includes('Listening for scripture'))
  console.log('PASS: sermon default, search, present callback, detected empty state, and visual capture.')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0) })

// Run with: npx electron tests/documents.integration.cjs
// Uses an isolated userData folder; never touches the operator's library.
const { app, BrowserWindow, dialog, ipcMain, protocol, net } = require('electron')
const { buildSync } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let temporary
let win
let failed = false
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{ scheme: 'pa-media', privileges: { stream: true } }])
app.whenReady().then(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-documents-test-')))
  app.setPath('userData', temporary)
  protocol.handle('pa-media', request => {
    const requested = decodeURIComponent(request.url.slice('pa-media://media/'.length));
    if (!requested.startsWith(temporary + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(requested).href);
  })
  buildSync({ entryPoints: [path.resolve('src/main/services/documents/index.ts')], outfile: path.join(temporary, 'service.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], alias: { '@shared': path.resolve('src/lib') } })
  const { documentsService: service } = require(path.join(temporary, 'service.cjs'))
  win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  const fixture = path.join(temporary, 'fixture.pdf')
  await win.loadURL('data:text/html,<h1>Document import test</h1><p>Page one</p><div style="break-before:page"><h1>Page two</h1></div>')
  await fs.writeFile(fixture, await win.webContents.printToPDF({ printBackground: true }))
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
  assert.deepEqual(await service.list(), [])
  const prepared = await service.prepare()
  assert.ok(prepared)
  const html = path.join(temporary, 'render.html')
  await fs.writeFile(html, '<html><body></body></html>')
  await win.loadFile(html)
  const library = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.mjs')).href
  const worker = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href
  const pages = await win.webContents.executeJavaScript(`(async () => {
    const { getDocument, GlobalWorkerOptions } = await import(${JSON.stringify(library)});
    GlobalWorkerOptions.workerSrc = ${JSON.stringify(worker)};
    const pdf = await getDocument({ data: new Uint8Array(${JSON.stringify([...prepared.data])}), isEvalSupported: false }).promise;
    const images = [];
    for(let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({scale: 1});
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
      images.push(canvas.toDataURL('image/png').split(',')[1]);
    }
    await pdf.destroy();
    return images;
  })()`)
  assert.equal(pages.length, 2)
  await assert.rejects(service.savePage(prepared.id, -1, Buffer.from(pages[0], 'base64')))
  await assert.rejects(service.savePage(prepared.id, 1, Buffer.from(pages[0], 'base64')))
  for (let i = 0; i < pages.length; i++) await service.savePage(prepared.id, i, Buffer.from(pages[i], 'base64'))
  const documents = await service.finish(prepared.id)
  assert.equal(documents.length, 1)
  assert.equal(documents[0].pages.length, 2)
  assert.equal(documents[0].name, 'fixture')
  assert.ok((await fs.stat(await service.page(prepared.id, 1))).size > 100)
  await assert.rejects(service.page(prepared.id, 2))
  await assert.rejects(service.page('../outside', 0))
  assert.equal((await service.list()).length, 1)
  const canceled = await service.prepare()
  await service.cancel(canceled.id)
  assert.equal((await service.list()).length, 1)
  await service.remove(prepared.id)
  assert.deepEqual(await service.list(), [])
  assert.ok((await fs.stat(fixture)).size > 0)
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  assert.equal(await service.prepare(), null)
  if (process.env.KAIRO_TEST_PPTX) {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.KAIRO_TEST_PPTX] })
    const powerpoint = await service.prepare()
    assert.equal(Buffer.from(powerpoint.data).subarray(0, 5).toString(), '%PDF-')
    await service.cancel(powerpoint.id)
    console.log('PASS: PowerPoint to PDF conversion through an installed converter.')
  }
  // Exercise the actual Documents component and compiled preload in Chromium.
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const uiRoot = path.join(temporary, 'ui')
  await fs.mkdir(uiRoot)
  await fs.writeFile(path.join(uiRoot, 'index.html'), (await fs.readFile('src/renderer/index.html', 'utf8')).replace('/src/main.tsx', '/entry.tsx'))
  await fs.writeFile(path.join(uiRoot, 'entry.tsx'), `import React from ${JSON.stringify(path.resolve('node_modules/react/index.js'))};
    import { createRoot } from ${JSON.stringify(path.resolve('node_modules/react-dom/client.js'))};
    import { requestImport } from ${JSON.stringify(path.resolve('src/renderer/src/hooks/useImportRequest.ts'))};
    window.testImport=()=>requestImport('pdf');
    import { clearLiveText, clearLiveAll } from ${JSON.stringify(path.resolve('src/renderer/src/lib/clear-live-output.ts'))};
    window.testClearText=clearLiveText;window.testClearAll=clearLiveAll;
    import Documents from ${JSON.stringify(path.resolve('src/renderer/src/components/documents/Documents.tsx'))};
    import ${JSON.stringify(path.resolve('src/renderer/src/index.css'))};
    createRoot(document.getElementById('root')).render(<Documents />);`)
  await build({ configFile: false, root: uiRoot, base: './', plugins: [react()], resolve: { alias: { '@shared': path.resolve('src/lib'), '@': path.resolve('src/renderer/src'), react: path.resolve('node_modules/react'), 'react-dom': path.resolve('node_modules/react-dom') } }, css: { postcss: path.resolve('.') }, build: { outDir: path.join(uiRoot, 'dist'), emptyOutDir: true }, logLevel: 'error' })
  let releaseSave
  let saveGate = new Promise(resolve => { releaseSave = resolve })
  let failPrepare = false
  for (const [name, method] of Object.entries({ list: 'list', prepare: 'prepare', savePage: 'savePage', finish: 'finish', cancel: 'cancel', remove: 'remove' })) {
    ipcMain.handle(`documents:${name}`, async (event, ...args) => {
      if (name === 'prepare' && failPrepare) throw new Error('Test file could not be opened. Choose another file.')
      if (name === 'savePage') await saveGate
      if (name === 'prepare') return service.prepare(args[0], document => event.sender.send('documents:preparing', document))
      return service[method](...args)
    })
  }
  ipcMain.handle('output:clearText',()=>undefined)
  ipcMain.handle('output:clearAll',()=>undefined)
  ipcMain.handle('media:getLibrary', () => ({folder:'',folders:[],items:[],playlists:[],playback:{},liveItemId:null,livePaused:false,error:null}))
  ipcMain.handle('media:clipboardHasFiles', () => false)
  ipcMain.handle('program:getState', () => ({message:null,stageMessage:null,activePropIds:[],logo:false,camera:null,cameraAudio:null,timer:{durationSec:300,endsAt:null,remainingSec:300},countdownOnScreens:false,clockOnScreens:false,current:null,next:null}))
  const pushes = []
  ipcMain.handle('documents:push', (_event, id, page) => { pushes.push({ id, page }); return { applied: false } })
  let resolvePicker
  dialog.showOpenDialog = () => new Promise(resolve => { resolvePicker = resolve })
  win.destroy()
  win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { preload: path.resolve('out/preload/index.js'), sandbox: false, nodeIntegration: false, contextIsolation: true } })
  win.webContents.on('console-message', (_event, level, message) => console.log('Renderer:', level, message))
  win.webContents.on('preload-error', (_event, _path, error) => console.error('Preload:', error))
  await win.loadFile(path.join(uiRoot, 'dist/index.html'))
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Import document'));
      if (button) { clearInterval(timer); button.click(); resolve(); }
      else if(Date.now() - start > 10000) { clearInterval(timer); reject(new Error('Documents did not mount')); }
    }, 50);
  })`)
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(await win.webContents.executeJavaScript('!!document.querySelector("dialog[open]")'), false)
  resolvePicker({ canceled: true, filePaths: [] })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await win.webContents.executeJavaScript('!!document.querySelector("dialog[open]")'), false)
  await win.webContents.executeJavaScript('window.testImport()')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await win.webContents.executeJavaScript('!!document.querySelector("dialog[open]")'), false)
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
  resolvePicker({ canceled: false, filePaths: [fixture] })
  const until = async (expression) => win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve()}else if(Date.now()-start>10000){clearInterval(timer);reject(new Error(document.body.textContent))}},30)})`)
  await until('!!document.querySelector("dialog[open] [role=progressbar][aria-valuenow]")')
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("dialog").contains(document.activeElement)'), true)
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("dialog").textContent.includes("Maximum 100 MB")'),true)
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await fs.writeFile('/tmp/kairo-document-import-modal.png',(await win.webContents.capturePage()).toPNG())
  win.setSize(420,600)
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await win.webContents.executeJavaScript('(()=>{const r=document.querySelector("dialog").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.height<=innerHeight})()'),true)
  win.setSize(1400,1000)
  releaseSave()
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (document.querySelector('img[alt="fixture, page 1"]')) { clearInterval(timer); resolve(); }
      else if(Date.now() - start > 15000) { clearInterval(timer); reject(new Error(document.body.textContent)); }
    }, 50);
  })`)
  assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('img[alt=\"fixture, page 1\"]')"), true)
  await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Push next page').click()")
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(pushes[0].page, 1)
  assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('img[alt=\"fixture, page 2\"]')"), true)
  assert.equal(await win.webContents.executeJavaScript("document.body.textContent.includes('Preview only')"), true)
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('img[alt=\"fixture, page 2\"]').length"), 2)
  assert.equal(await win.webContents.executeJavaScript('[...document.images].every(image => image.complete && image.naturalWidth > 0)'), true)
  await win.webContents.executeJavaScript('window.testClearText()')
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('img[alt=\"fixture, page 2\"]').length"),2)
  await win.webContents.executeJavaScript('window.testClearAll()')
  await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('img[alt=\"fixture, page 2\"]').length"),1)
  await fs.writeFile('/tmp/kairo-documents-preview.png', (await win.webContents.capturePage()).toPNG())
  saveGate = new Promise(resolve => { releaseSave = resolve })
  await win.webContents.executeJavaScript('window.testImport()')
  await until('!!document.querySelector("dialog[open] [role=progressbar][aria-valuenow]")')
  await win.webContents.executeJavaScript('[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Cancel import").click()')
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("dialog").textContent.includes("Canceling")'),true)
  releaseSave()
  await until('!document.querySelector("dialog[open]")')
  assert.equal((await service.list()).length,1)
  failPrepare = true
  await win.webContents.executeJavaScript('window.testImport()')
  await until('!!document.querySelector("dialog[open]") && document.querySelector("dialog").textContent.includes("Couldn’t import")')
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("dialog").textContent.includes("Choose file again")'),true)
  failPrepare = false
  await win.webContents.executeJavaScript('[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Choose file again").click()')
  await until('!document.querySelector("dialog[open]")')
  assert.equal((await service.list()).length,2)
  console.log('PASS: import modal progress, keyboard focus, cancellation cleanup, error and retry')
  console.log('PASS: Documents UI import, previews, Next projection request, and compiled preload. NDI hardware is not exercised.')
  console.log('PASS: PDF rendering, page ordering, persistence, path validation, cancellation, removal, original preservation.')
}).catch(error => {
  console.error(error)
  failed = true
}).finally(async () => {
  win?.destroy()
  if (temporary) await fs.rm(temporary, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})

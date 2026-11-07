// Real Chromium decoding + program shell, with isolated data and no external receiver.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const JSZip = require('jszip')
const windows = []
let temporary
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{scheme:'pa-media',privileges:{stream:true}}])
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = (win, code) => win.webContents.executeJavaScript(code)
async function until(win, predicate, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await evaluate(win, predicate)) return
    await wait(50)
  }
  throw new Error('Timed out: ' + predicate)
}
// MediaRecorder emits live WebM without a Duration element. Give the dock
// fixture a finite duration in the same timecode units as its recorded frames.
function withWebmDuration(bytes, milliseconds) {
  const data = Buffer.from(bytes)
  const info = Buffer.from([0x15, 0x49, 0xa9, 0x66])
  const offset = data.indexOf(info) + info.length
  assert.ok(offset >= info.length)
  const size = data[offset] & 0x7f
  assert.ok(data[offset] & 0x80)
  const duration = Buffer.alloc(11)
  duration.set([0x44, 0x89, 0x88])
  duration.writeDoubleBE(milliseconds, 3)
  assert.ok(size + duration.length < 127)
  data[offset] = 0x80 | (size + duration.length)
  const end = offset + 1 + size
  return Buffer.concat([data.subarray(0, end), duration, data.subarray(end)])
}

app.whenReady().then(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-document-video-')))
  app.setPath('userData', temporary)
  protocol.handle('pa-media',request => {
    const file=decodeURIComponent(request.url.slice('pa-media://media/'.length));
    if(!file.startsWith(temporary+path.sep))return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).href);
  })
  const recorder = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } })
  windows.push(recorder)
  await recorder.loadURL('data:text/html,<canvas width="160" height="90"></canvas>')
  // Generate an actual playable WebM, so this test does not rely on ffmpeg or network fixtures.
  const bytes = await evaluate(recorder, `(async () => {
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(20);
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain(); gain.gain.value=0.1;
    const destination = audio.createMediaStreamDestination();
    tone.connect(gain); gain.connect(destination); tone.start(); await audio.resume();
    stream.addTrack(destination.stream.getAudioTracks()[0]);
    const chunks = [];
    const recorder = new MediaRecorder(stream, {mimeType:'video/webm;codecs=vp8,opus'});
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = event => chunks.push(event.data);
    recorder.start();
    for (let i=0;i<35;i++) {
      context.fillStyle = i%2 ? '#00ffff' : '#ff0000'; context.fillRect(0,0,160,90);
      await new Promise(resolve => setTimeout(resolve,50));
    }
    recorder.stop(); await done; stream.getTracks().forEach(track => track.stop()); tone.stop(); await audio.close();
    return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
  })()`)
  const media = path.join(temporary, 'clip.webm')
  await fs.writeFile(media, Buffer.from(bytes))
  const image = path.join(temporary, 'page.png')
  // Capture the canvas as the slide poster.
  const poster = await evaluate(recorder, `document.querySelector('canvas').toDataURL('image/png').split(',')[1]`)
  await fs.writeFile(image, Buffer.from(poster, 'base64'))
  const shells = []
  for (let i=0;i<2;i++) {
    const win = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } })
    windows.push(win); shells.push(win)
    await win.loadFile(path.resolve('src/main/services/output/overlay.html'))
    await evaluate(win, `window.__setContent('<div class="pa-bg"><img style="width:100%;height:100%;object-fit:contain" src="${pathToFileURL(image).href}"></div>',true); window.__markDocument()`)
    await evaluate(win, `window.audioPeak=0; window.kairoProgram={sendAudio(frame){for(const value of frame.data)window.audioPeak=Math.max(window.audioPeak,Math.abs(value));}}; window.__configure({audio:{enabled:${i === 0},volume:0.35},ndiAudio:true})`);
    const slide = { id: 'deck', page: 1, width: 1000, height: 500, videos: [{ file: pathToFileURL(media).href, start: 0, end: 1.2, box: {x:0.1,y:0.1,width:0.4,height:0.4} }] }
    await evaluate(win, `window.__setDocumentVideos(${JSON.stringify(slide)})`)
    await until(win, 'window.__documentPlayback().videos[0].duration > 0')
    const state = await evaluate(win, 'window.__documentPlayback()')
    assert.equal(state.id, 'deck'); assert.equal(state.videos[0].paused, true)
    assert.equal(state.videos[0].error, null)
    const routing = await evaluate(win, `routed.get(document.querySelector('[data-document-videos] video')).speaker.gain.value`);
    assert.ok(Math.abs(routing-(i === 0 ? 0.35 : 0))<0.001);
    // Verify speaker selection, then silence test playback while still exercising NDI audio.
    await evaluate(win, 'window.__configure({audio:{enabled:false,volume:0.35},ndiAudio:true})')
    const box = await evaluate(win, `(() => { const c=document.querySelector('[data-document-videos]');return {top:c.style.top,height:c.style.height}; })()`)
    assert.deepEqual(box, {top:'60px',height:'960px'})
  }
  await Promise.all(shells.map(win => evaluate(win, 'window.__controlDocumentVideo(0,{action:"play"})')))
  await until(shells[0], 'window.__documentPlayback().videos[0].currentTime > 0.2')
  for (const win of shells) await until(win, 'window.audioPeak > 0.01')
  await Promise.all(shells.map(win => evaluate(win, 'window.__controlDocumentVideo(0,{action:"pause"})')))
  for (const win of shells) {
    const state = await evaluate(win, 'window.__documentPlayback().videos[0]')
    assert.equal(state.paused, true); assert.ok(state.currentTime > 0)
    await evaluate(win, 'window.__controlDocumentVideo(0,{action:"seek",seconds:0.6})')
    assert.equal(await evaluate(win, `document.querySelector('[data-document-videos] video').style.visibility`),'visible')
    assert.ok(Math.abs((await evaluate(win, 'window.__documentPlayback().videos[0].currentTime'))-0.6) < 0.05)
    await evaluate(win, 'window.__controlDocumentVideo(0,{action:"restart"})')
    await until(win, 'window.__documentPlayback().videos[0].ended && window.__documentPlayback().videos[0].paused')
    assert.equal((await evaluate(win, 'window.__documentPlayback().videos[0]')).paused, true)
    await evaluate(win, `window.__swapDocumentPage(${JSON.stringify(pathToFileURL(image).href)})`)
    assert.equal(await evaluate(win, 'window.__documentPlayback()'), null)
    assert.equal(await evaluate(win, 'document.querySelectorAll("[data-document-videos] video").length'), 0)
  }
  // Media Dock timing uses the real program shell and Chromium player.
  const program = shells[0]
  const clipMarkup = (cue, loop = false) => `<div class="pa-bg"><video src="${pathToFileURL(media).href}" muted data-media-start="0.3" data-media-end="1.1" data-media-rate="1.5" data-media-cue="${cue}" ${loop ? 'loop' : ''}></video></div>`
  const cueClip = (cue, loop) => evaluate(program, `window.__setContent(${JSON.stringify(clipMarkup(cue, loop))}, true)`)
  const liveVideo = 'document.querySelector(".pa-bg video")'
  await cueClip(1)
  await until(program, `${liveVideo}.currentTime >= 0.3 && !${liveVideo}.paused`)
  assert.equal(await evaluate(program, `${liveVideo}.playbackRate`), 1.5)
  await evaluate(program, `window.previousClip = ${liveVideo}`)
  await cueClip(1)
  assert.equal(await evaluate(program, `window.previousClip === ${liveVideo}`), true)
  await until(program, 'window.__videoEnded()')
  assert.ok(Math.abs(await evaluate(program, `${liveVideo}.currentTime`) - 1.1) < 0.03)

  await cueClip(2, true)
  assert.equal(await evaluate(program, `window.previousClip === ${liveVideo}`), false)
  await until(program, `${liveVideo}.currentTime > 0.8`)
  await until(program, `${liveVideo}.currentTime < 0.6 && !${liveVideo}.paused`)
  await evaluate(program, 'window.__setVideoPaused(true); window.__seekVideo(0)')
  assert.ok(Math.abs(await evaluate(program, `${liveVideo}.currentTime`) - 0.3) < 0.03)
  const posterMarkup = `<div class="pa-bg"><img src="${pathToFileURL(image).href}"></div>`
  await evaluate(program, `window.__setContent(${JSON.stringify(posterMarkup)}, true)`)

  // An invalid codec/file must be reported without making the deck unusable.
  await evaluate(shells[0], `window.__setDocumentVideos({id:'bad',page:0,width:1920,height:1080,videos:[{file:${JSON.stringify(pathToFileURL(image).href)},start:0,box:{x:0,y:0,width:1,height:1}}]})`)
  await until(shells[0], '!!window.__documentPlayback().videos[0].error')
  await evaluate(shells[0], 'window.__setContent("")')
  assert.equal(await evaluate(shells[0], 'window.__documentPlayback()'), null)

  // Full import persists media alongside page images; old PDF decks stay compatible.
  await build({entryPoints:[path.resolve('src/main/services/documents/index.ts')], outfile:path.join(temporary,'service.cjs'), bundle:true, platform:'node', format:'cjs', external:['electron'], alias:{'@shared':path.resolve('src/lib')}, plugins:[{name:'builtin-only',setup(builder){builder.onLoad({filter:/services\/documents\/converters\.ts$/},()=>({contents:'export async function detectPowerpointConverters(){return []}; export async function convertPowerPointToPdf(){throw new Error("No native converter")}',loader:'ts'}))}}]})
  const {documentsService: service} = require(path.join(temporary,'service.cjs'))
  const {dialog} = require('electron')
  const zip = new JSZip()
  zip.file('ppt/presentation.xml','<p:presentation><p:sldSz cx="1000" cy="500"/><p:sldIdLst><p:sldId r:id="s1"/><p:sldId r:id="s2"/></p:sldIdLst></p:presentation>')
  zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="s1" Target="slides/slide1.xml"/><Relationship Id="s2" Target="slides/slide2.xml"/></Relationships>')
  zip.file('ppt/slides/slide1.xml','<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>')
  zip.file('ppt/slides/slide2.xml','<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:nvPr><a:videoFile r:link="v"/><p14:media r:embed="v"/></p:nvPr></p:nvPicPr><p:spPr><a:xfrm><a:off x="100" y="50"/><a:ext cx="400" cy="200"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>')
  zip.file('ppt/slides/_rels/slide2.xml.rels','<Relationships><Relationship Id="v" Target="../media/clip.webm"/></Relationships>')
  zip.file('ppt/media/clip.webm',Buffer.from(bytes))
  const deckPath = path.join(temporary,'fixture.pptx')
  await fs.writeFile(deckPath,await zip.generateAsync({type:'nodebuffer'}))
  dialog.showOpenDialog = async () => ({canceled:false,filePaths:[deckPath]})
  const prepared = await service.prepare('powerpoint')
  assert.ok(prepared); assert.equal(Buffer.from(prepared.data).subarray(0,5).toString(),'%PDF-')
  const rendererHtml=path.join(temporary,'pdf-render.html')
  await fs.writeFile(rendererHtml,'<html><body></body></html>')
  await recorder.loadFile(rendererHtml)
  const pdfModule=pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.mjs')).href
  const pdfWorker=pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href
  const rendered=await evaluate(recorder,`(async()=>{
    const {getDocument,GlobalWorkerOptions}=await import(${JSON.stringify(pdfModule)});
    GlobalWorkerOptions.workerSrc=${JSON.stringify(pdfWorker)};
    const pdf=await getDocument({data:new Uint8Array(${JSON.stringify([...prepared.data])}),isEvalSupported:false}).promise;
    const result=[];
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);const original=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(1920/original.width,1080/original.height)});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      result.push({ratio:original.width/original.height,image:canvas.toDataURL('image/png').split(',')[1]});
    }
    await pdf.destroy();return result;
  })()`)
  assert.equal(rendered.length,2)
  assert.ok(Math.abs(rendered[0].ratio-2)<0.01)
  for(const [page,value] of rendered.entries())await service.savePage(prepared.id,page,Buffer.from(value.image,'base64'))
  const documents = await service.finish(prepared.id)
  const dir=path.join(temporary,'documents',prepared.id)
  assert.equal((await service.slide(prepared.id,0)).videos.length,0)
  assert.equal((await service.slide(prepared.id,1)).videos[0].file,path.join(dir,'media','clip.webm'))
  assert.equal(documents[0].videos[1].length,1)
  assert.deepEqual(await fs.readFile(path.join(dir,'media','clip.webm')),Buffer.from(bytes))
  // Exercise Documents and the compiled preload against the actual program shells.
  const {build: buildUi} = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const uiRoot=path.join(temporary,'ui')
  await fs.mkdir(uiRoot)
  await fs.writeFile(path.join(uiRoot,'index.html'),(await fs.readFile('src/renderer/index.html','utf8')).replace('/src/main.tsx','/entry.tsx'))
  await fs.writeFile(path.join(uiRoot,'entry.tsx'),`import React from ${JSON.stringify(path.resolve('node_modules/react/index.js'))};
    import {createRoot} from ${JSON.stringify(path.resolve('node_modules/react-dom/client.js'))};
    import MediaDock from ${JSON.stringify(path.resolve('src/renderer/src/components/media/MediaDock.tsx'))};
    import {useMediaDockStore} from ${JSON.stringify(path.resolve('src/renderer/src/stores/useMediaDockStore.ts'))};
    import Documents from ${JSON.stringify(path.resolve('src/renderer/src/components/documents/Documents.tsx'))};
    import ${JSON.stringify(path.resolve('src/renderer/src/index.css'))};
    const dock = location.search.includes('dock');
    if (dock) useMediaDockStore.getState().setOpen(true);
    createRoot(document.getElementById('root')).render(dock ? <MediaDock/> : <Documents/>);`)
  await buildUi({configFile:false,root:uiRoot,base:'./',plugins:[react()],resolve:{alias:{'@shared':path.resolve('src/lib'),'@':path.resolve('src/renderer/src'),react:path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom')}},css:{postcss:path.resolve('.')},build:{outDir:path.join(uiRoot,'dist'),emptyOutDir:true},logLevel:'error'})
  ipcMain.handle('documents:list',()=>service.list())
  ipcMain.handle('settings:set',()=>undefined)
  const dockMedia = path.join(temporary, 'inspection.webm')
  await fs.writeFile(dockMedia, withWebmDuration(bytes, 1700))
  const dockClip = { id: 'clip.webm', name: 'Inspection clip', path: dockMedia, kind: 'video', ext: 'webm', folder: '', sizeBytes: bytes.length }
  const dockImage = { id: 'poster.png', name: 'Inspection still', path: image, kind: 'image', ext: 'png', folder: '', sizeBytes: 500 }
  const library = { folder: temporary, folders: [], items: [dockClip, dockImage], playlists: [], playback: {}, liveItemId: null, livePaused: false, error: null }
  let savedSettings
  ipcMain.handle('media:getLibrary', () => library)
  ipcMain.handle('media:setPlayback', (_event, id, playback, nextCue) => {
    savedSettings = { id, playback, nextCue }
    library.playback[id] = playback
    return library
  })
  ipcMain.handle('media:clipboardHasFiles',()=>false)
  ipcMain.handle('program:getState',()=>({message:null,stageMessage:null,activePropIds:[],logo:false,camera:null,cameraAudio:null,timer:{durationSec:300,endsAt:null,remainingSec:300},countdownOnScreens:false,clockOnScreens:false,current:null,next:null}))
  let connected=true
  ipcMain.handle('documents:push',async(_event,id,page)=>{
    if (!connected) return {applied:false}
    const slide=await service.slide(id,page)
    for(const win of shells){
      await evaluate(win,`window.__setContent('<div class="pa-bg"><img style="width:100%;height:100%;object-fit:contain" src="${pathToFileURL(slide.path).href}"></div>',true);window.__markDocument()`)
      const payload={...slide,videos:slide.videos.map(clip=>({...clip,file:pathToFileURL(clip.file).href}))}
      await evaluate(win,`window.__setDocumentVideos(${JSON.stringify(payload)})`)
    }
    return {applied:true}
  })
  ipcMain.handle('documents:playback',async(_event,id,page)=>{
    const state=await evaluate(shells[0],'window.__documentPlayback()')
    return state?.id===id && state.page===page?state:null
  })
  const commands=[]
  ipcMain.handle('documents:control',async(_event,id,page,index,command)=>{
    commands.push({id,page,index,command})
    await Promise.all(shells.map(win=>evaluate(win,`window.__controlDocumentVideo(${index},${JSON.stringify(command)})`)))
  })
  const ui=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload:path.resolve('out/preload/index.js'),sandbox:false,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}})
  windows.push(ui)
  await ui.loadFile(path.join(uiRoot,'dist','index.html'))
  await until(ui,`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('fixture'))`)
  await evaluate(ui,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('fixture')).click()`)
  await until(ui,`!!document.querySelector('button[aria-label="Push next page"]')`)
  await evaluate(ui,`document.querySelector('button[aria-label="Push next page"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  await evaluate(ui,`document.querySelector('[data-document-transport] button[aria-label="Play"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Pause"]')`)
  await until(ui,`document.querySelector('section video').currentTime > 0.1`)
  assert.deepEqual(commands[0],{id:prepared.id,page:1,index:0,command:{action:'play'}})
  assert.equal(await evaluate(ui,'document.querySelector("section video").muted'),true)
  await fs.writeFile('/tmp/kairo-document-video-preview.png',(await ui.webContents.capturePage()).toPNG())
  await evaluate(ui,`document.querySelector('[data-document-transport] button[aria-label="Pause"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  // Slider seeks program output, not just the muted monitor.
  await evaluate(ui,`(()=>{const slider=document.querySelector('[data-document-transport] input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(slider,'0.7');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until(shells[0],'window.__documentPlayback().videos[0].currentTime > 0.6')
  await evaluate(ui,`document.querySelector('button[aria-label="Push previous page"]').click()`)
  await until(ui,`!document.querySelector('[data-document-transport]')`)
  assert.equal(await evaluate(shells[0],'window.__documentPlayback().videos.length'),0)
  // A two-second slideshow dwell must not skip a manually paused video.
  await evaluate(ui,`document.querySelector('button[aria-label="Push next page"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  await evaluate(ui,`document.querySelector('button[aria-label="Slideshow settings"]').click()`)
  await until(ui,`!!document.querySelector('[role="dialog"][aria-label="Slideshow settings"] input[type="number"]')`)
  await evaluate(ui,`(()=>{const input=document.querySelector('[role="dialog"][aria-label="Slideshow settings"] input[type="number"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('button[aria-label="Slideshow settings"]').click();})()`)
  await evaluate(ui,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Slideshow').click()`)
  await wait(2300)
  assert.equal(await evaluate(ui,`!!document.querySelector('img[alt="fixture, page 2"]')`),true)
  await evaluate(ui,`document.querySelector('[data-document-transport] button[aria-label="Play"]').click()`)
  await until(ui,`!!document.querySelector('img[alt="fixture, page 1"]')`)
  await evaluate(ui,`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-pressed')==='true' && b.title==='Stop the slideshow').click()`)
  // A video error stops slideshow mode and keeps the operator on the affected slide.
  await evaluate(ui,`document.querySelector('button[aria-label="Push next page"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  const failedSlide={id:prepared.id,page:1,width:1000,height:500,videos:[{file:pathToFileURL(image).href,start:0,box:{x:0,y:0,width:1,height:1}}]}
  await evaluate(shells[0],`window.__setDocumentVideos(${JSON.stringify(failedSlide)})`)
  await until(ui,`!!document.querySelector('[data-document-transport] [role="alert"]')`)
  await evaluate(ui,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Slideshow').click()`)
  await until(ui,`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Slideshow' && b.getAttribute('aria-pressed')==='false')`)
  assert.equal(await evaluate(ui,`!!document.querySelector('img[alt="fixture, page 2"]')`),true)
  connected=false
  await evaluate(ui,`document.querySelector('button[aria-label="Push previous page"]').click()`)
  await until(ui,`!!document.querySelector('img[alt="fixture, page 1"]')`)
  await evaluate(ui,`document.querySelector('button[aria-label="Push next page"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  await evaluate(ui,`document.querySelector('[data-document-transport] button[aria-label="Play"]').click()`)
  await until(ui,`document.querySelector('section video').currentTime > 0.2`)
  assert.equal(await evaluate(ui,'document.querySelector("section video").muted'),false)
  await evaluate(ui,`document.querySelector('[data-document-transport] button[aria-label="Pause"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  await evaluate(ui,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Push').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  await evaluate(ui,`document.querySelector('button[aria-label="Push previous page"]').click()`)
  await until(ui,`!!document.querySelector('img[alt="fixture, page 1"]')`)
  await evaluate(ui,`document.querySelector('button[aria-label="Push next page"]').click()`)
  await until(ui,`!!document.querySelector('[data-document-transport] button[aria-label="Play"]')`)
  assert.equal(await evaluate(ui,'document.querySelector("section video").paused'),true)
  assert.equal(await evaluate(ui,`document.body.textContent.includes('Preview only')`),true)
  await ui.loadFile(path.join(uiRoot, 'dist', 'index.html'), { query: { dock: '1' } })
  const toggleSidebar = 'button[aria-controls="media-dock-sidebar"]'
  await until(ui, `document.querySelector('${toggleSidebar}')?.getAttribute('aria-expanded') === 'true'`)
  const sidebarWidth = await evaluate(ui, 'document.getElementById("media-dock-sidebar").offsetWidth')
  assert.ok(sidebarWidth > 0)
  await evaluate(ui, `document.querySelector('${toggleSidebar}').click()`)
  await until(ui, `document.querySelector('${toggleSidebar}').getAttribute('aria-expanded') === 'false'`)
  assert.equal(await evaluate(ui, 'document.getElementById("media-dock-sidebar").offsetWidth'), 0)
  assert.equal(await evaluate(ui, 'localStorage.getItem("kairo.mediaDock.sidebarHidden")'), 'true')
  await ui.reload()
  await until(ui, `document.querySelector('${toggleSidebar}')?.getAttribute('aria-expanded') === 'false'`)
  await evaluate(ui, `document.querySelector('${toggleSidebar}').click()`)
  await until(ui, `document.querySelector('${toggleSidebar}').getAttribute('aria-expanded') === 'true'`)
  assert.equal(await evaluate(ui, 'document.getElementById("media-dock-sidebar").offsetWidth'), sidebarWidth)
  console.log('PASS: Media Dock sidebar hides, persists across reload, and restores its width')
  async function inspect(name) {
    const card = JSON.stringify(`[aria-label="Push ${name} to screen"]`)
    await until(ui, `!!document.querySelector(${card})`)
    await evaluate(ui, `document.querySelector(${card}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:40,clientY:40}))`)
    await evaluate(ui, `[...document.querySelectorAll('[role="menuitem"]')].find(node=>node.textContent.trim()==='Inspect').click()`)
    await until(ui, `!!document.querySelector('dialog[open]')`)
  }

  await inspect('Inspection clip')
  assert.equal(await evaluate(ui, `document.querySelector('dialog video').muted`), true)
  await until(ui, `!document.querySelector('[aria-label="Trim start"]').disabled`)
  await evaluate(ui, `(() => {
    for (const [name, time] of [['Trim start', 0.3], ['Trim end', 1.1]]) {
      const handle = document.querySelector('[aria-label="' + name + '"]');
      const track = handle.parentElement.getBoundingClientRect();
      const bounds = handle.getBoundingClientRect();
      const offset = name === 'Trim start' ? bounds.width / 2 : -bounds.width / 2;
      const origin = (bounds.left + bounds.right) / 2;
      handle.setPointerCapture = () => {};
      handle.hasPointerCapture = () => true;
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, clientX: origin }));
      const clientX = track.left + track.width * time / 1.7 - offset;
      handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, isPrimary: true, clientX }));
    }
  })()`)
  assert.deepEqual(await evaluate(ui, `['video-in-point', 'video-out-point'].map(id => document.getElementById(id).value)`), ['0.3', '1.1'])
  await evaluate(ui, `(() => {
    const speed = document.querySelector('fieldset input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(speed, '1.5');
    speed.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('dialog input[type="checkbox"]').click();
    document.querySelector('dialog button[type="submit"]').click();
  })()`)
  await until(ui, `!document.querySelector('dialog[open]')`)
  assert.deepEqual(savedSettings, {
    id: dockClip.id, nextCue: true,
    playback: { brightness: 1, contrast: 1, saturation: 1, fit: null, startSeconds: 0.3, endSeconds: 1.1, rate: 1.5, loop: true },
  })

  await inspect('Inspection still')
  await until(ui, `document.querySelector('dialog img').naturalWidth > 0`)
  assert.equal(await evaluate(ui, `!!document.querySelector('dialog [aria-label="Trim start"]')`), false)
  await evaluate(ui, `(() => {
    const select = document.querySelector('dialog select');
    select.value = 'cover';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const brightness = document.querySelector('dialog input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(brightness, '0.65');
    brightness.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  assert.deepEqual(await evaluate(ui, `[document.querySelector('dialog img').style.objectFit, document.querySelector('dialog img').style.filter]`), ['cover', 'brightness(0.65)'])
  await evaluate(ui, `document.querySelector('dialog button[type="submit"]').click()`)
  await until(ui, `!document.querySelector('dialog[open]')`)
  assert.deepEqual(savedSettings, { id: dockImage.id, nextCue: true, playback: { brightness: 0.65, contrast: 1, saturation: 1, fit: 'cover' } })
  console.log('PASS: Media Inspector video trim handles, image color preview, scaling, and next-cue saves')
  console.log('PASS: no-output navigation and local embedded video playback')
  console.log('PASS: Slideshow waits on paused video, advances after completion, and stops on codec errors')
  console.log('PASS: Documents UI, compiled preload, embedded-video controls, muted monitor, slider seeking, slide navigation')
  console.log('PASS: real video decoding, manual playback, pause, seek, restart, trim end, two outputs, audio routing and nonzero NDI samples, page-change cleanup, unsupported codecs, persisted document media')
}).catch(error => {console.error(error);process.exitCode=1}).finally(async () => {
  for (const win of windows) if (!win.isDestroyed()) win.destroy()
  if (temporary) await fs.rm(temporary,{recursive:true,force:true})
  app.exit(process.exitCode || 0)
})

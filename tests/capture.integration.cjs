// Capture end to end in real Electron (macOS): Chromium's own frames are
// recorded to movie files and read back.
//   · an offscreen window with shared textures (NDI / Syphon / video card outputs)
//   · a visible window through a frame subscription (audience screens)
// Run: npm run build:gpu-frames && npm run build:recorder && electron tests/capture.integration.cjs
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const recorder = require(resolve(__dirname, '../native/recorder/build/recorder.node'))
const dir = mkdtempSync(join(tmpdir(), 'kairo-capture-'))
const page = (colour) => `data:text/html,<body style="margin:0;background:${colour}"></body>`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stop = (rec) => new Promise((ok, fail) => recorder.stop(rec, (e, result) => (e ? fail(e) : ok(result))))
const failures = []
const check = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`); if (!ok) failures.push(message) }

function average(bgra) {
  const sum = [0, 0, 0, 0]
  for (let i = 0; i < bgra.length; i += 4) for (let c = 0; c < 4; c++) sum[c] += bgra[i + c]
  return sum.map((s) => Math.round(s / (bgra.length / 4)))
}

app.whenReady().then(async () => {
  // Offscreen, shared textures — as ProgramSurface builds NDI / Syphon windows.
  const offscreenFile = join(dir, 'offscreen.mov')
  const offscreenRec = recorder.open({ path: offscreenFile, width: 1280, height: 720, fps: 30, codec: 'h264', bitrate: 4e6 })
  let textures = 0
  const offscreen = new BrowserWindow({
    width: 640, height: 360, show: false, frame: false,
    webPreferences: { offscreen: { useSharedTexture: true }, backgroundThrottling: false },
  })
  offscreen.webContents.setFrameRate(30)
  offscreen.webContents.on('paint', (event) => {
    const texture = event.texture
    if (!texture) return
    textures++
    let started = false
    try {
      started = recorder.pushTexture(offscreenRec, texture.textureInfo.sharedTextureHandle, () => texture.release())
    } finally {
      if (!started) texture.release()
    }
  })
  await offscreen.loadURL(page('rgb(255,0,0)'))

  // Visible window, frame subscription — as an audience screen is recorded.
  const visibleFile = join(dir, 'visible.mov')
  const visibleRec = recorder.open({ path: visibleFile, width: 1280, height: 800, fps: 30, codec: 'prores422' })
  let frames = 0
  let frameSize = ''
  const visible = new BrowserWindow({ x: 40, y: 40, width: 320, height: 200, show: false, frame: false, focusable: false })
  await visible.loadURL(page('rgb(0,0,255)'))
  visible.showInactive()
  visible.webContents.beginFrameSubscription(false, (image) => {
    const bitmap = image.toBitmap()
    const size = image.getSize()
    const scale = Math.sqrt(bitmap.length / 4 / (size.width * size.height)) || 1
    frameSize = `${size.width}x${size.height} @${scale}`
    frames++
    recorder.pushPixels(visibleRec, bitmap, Math.round(size.width * scale), Math.round(size.height * scale))
  })
  visible.webContents.invalidate()

  await wait(1500)
  visible.webContents.endFrameSubscription()
  const [offscreenResult, visibleResult] = await Promise.all([stop(offscreenRec), stop(visibleRec)])

  const a = recorder.probe(offscreenFile)
  const [ab, ag, ar] = average(a.lastFrame)
  check(textures > 0, `offscreen window handed over ${textures} shared textures`)
  check(a.codec === 'avc1' && a.width === 1280 && a.height === 720, `offscreen recording is H.264 1280×720 (${a.codec} ${a.width}×${a.height})`)
  check(ar > 200 && ag < 40 && ab < 40, `offscreen recording is red, scaled from 640×360 (${ar}, ${ag}, ${ab})`)
  check(a.frames >= 35, `offscreen recording holds ${a.frames} frames over ${offscreenResult.seconds.toFixed(2)}s`)

  const b = recorder.probe(visibleFile)
  const [bb, bg, br] = average(b.lastFrame)
  check(frames > 0, `visible window delivered ${frames} subscribed frames (${frameSize})`)
  check(b.codec === 'apcn', `visible recording is ProRes 422 (${b.codec})`)
  check(bb > 200 && bg < 40 && br < 40, `visible recording is blue (${br}, ${bg}, ${bb})`)
  check(b.frames >= 35, `visible recording holds ${b.frames} frames over ${visibleResult.seconds.toFixed(2)}s`)

  offscreen.destroy()
  visible.destroy()
  rmSync(dir, { recursive: true, force: true })
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
  app.exit(failures.length ? 1 : 0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

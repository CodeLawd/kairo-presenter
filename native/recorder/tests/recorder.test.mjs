// recorder end-to-end tests. macOS only.
// Frames go in as Chromium hands them over (an IOSurface, made here by the
// gpu-frames test helper) or as a bitmap, a real movie file is written, and
// AVFoundation reads it back the way QuickTime or an editor would.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const mac = process.platform === 'darwin'
const recorderPath = resolve('native/recorder/build/recorder.node')
const gpuPath = resolve('native/gpu-frames/build/gpu_frames.node')
const skip = !mac
  ? 'macOS only'
  : !existsSync(recorderPath) ? 'run `npm run build:recorder` first'
  : !existsSync(gpuPath) ? 'run `npm run build:gpu-frames` first (test surfaces)'
  : false
const require = createRequire(import.meta.url)
const recorder = skip ? null : require(recorderPath)
const gpu = skip ? null : require(gpuPath)
const dir = skip ? '' : mkdtempSync(join(tmpdir(), 'kairo-recorder-'))
test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

const W = 320, H = 180

/** A solid BGRA frame. */
function solid(width, height, [b, g, r, a]) {
  const bgra = Buffer.alloc(width * height * 4)
  for (let i = 0; i < bgra.length; i += 4) bgra.set([b, g, r, a], i)
  return bgra
}

/** The average of each channel over a BGRA frame. */
function average(bgra) {
  const sum = [0, 0, 0, 0]
  for (let i = 0; i < bgra.length; i += 4) for (let c = 0; c < 4; c++) sum[c] += bgra[i + c]
  return sum.map((s) => s / (bgra.length / 4))
}

function pushTexture(rec, handle) {
  return new Promise((resolvePromise, reject) => {
    const started = recorder.pushTexture(rec, handle, (error) => (error ? reject(error) : resolvePromise(true)))
    if (!started) resolvePromise(false)
  })
}

function stop(rec) {
  return new Promise((resolvePromise, reject) => {
    recorder.stop(rec, (error, result) => (error ? reject(error) : resolvePromise(result)))
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function open(name, options = {}) {
  const path = join(dir, name)
  return { path, rec: recorder.open({ path, width: W, height: H, fps: 30, codec: 'h264', bitrate: 2_000_000, ...options }) }
}

test('the addon is available on this Mac', { skip }, () => {
  assert.deepEqual(recorder.available(), { ok: true })
  assert.ok(Array.isArray(recorder.audioInputs()))
})

test('a GPU frame is recorded to an H.264 movie at its colour', { skip }, async () => {
  const { path, rec } = open('h264.mov')
  assert.equal(await pushTexture(rec, gpu.createTestSurface(solid(W, H, [0, 0, 255, 255]), W, H)), true)
  await wait(1000)
  const result = await stop(rec)
  assert.equal(result.path, path)
  assert.ok(result.seconds >= 0.9 && result.seconds < 1.5, `ran ${result.seconds}s`)
  const seen = recorder.probe(path)
  assert.equal(seen.codec, 'avc1')
  assert.equal(seen.width, W)
  assert.equal(seen.height, H)
  assert.ok(Math.abs(seen.seconds - result.seconds) < 0.15, `movie is ${seen.seconds}s for ${result.seconds}s of recording`)
  assert.ok(seen.frames >= 26 && seen.frames <= 40, `${seen.frames} frames for about a second at 30fps`)
  assert.equal(seen.audio, false)
  const [b, g, r] = average(seen.lastFrame)
  assert.ok(r > 200 && g < 40 && b < 40, `the frame is red (${r}, ${g}, ${b})`)
})

test('a slide that sits still is still recorded at the full frame rate', { skip }, async () => {
  const { path, rec } = open('still.mov')
  recorder.pushPixels(rec, solid(W, H, [255, 0, 0, 255]), W, H)
  await wait(1500)
  await stop(rec)
  const seen = recorder.probe(path)
  assert.ok(seen.frames >= 40 && seen.frames <= 55, `${seen.frames} frames for 1.5s at 30fps`)
  const [b, g, r] = average(seen.lastFrame)
  assert.ok(b > 200 && g < 40 && r < 40, `the one pushed frame holds to the end (${r}, ${g}, ${b})`)
})

test('frames of another size are scaled to the recording, on the GPU and the CPU', { skip }, async () => {
  const gpuRun = open('scaled-gpu.mov')
  assert.equal(await pushTexture(gpuRun.rec, gpu.createTestSurface(solid(W * 2, H * 2, [0, 255, 0, 255]), W * 2, H * 2)), true)
  await wait(300)
  await stop(gpuRun.rec)
  const cpuRun = open('scaled-cpu.mov')
  assert.equal(recorder.pushPixels(cpuRun.rec, solid(W * 2, H * 2, [0, 255, 0, 255]), W * 2, H * 2), true)
  await wait(300)
  await stop(cpuRun.rec)
  for (const path of [gpuRun.path, cpuRun.path]) {
    const seen = recorder.probe(path)
    assert.equal(seen.width, W)
    assert.equal(seen.height, H)
    assert.ok(seen.frames > 0)
  }
  const [b, g, r] = average(recorder.probe(cpuRun.path).lastFrame)
  assert.ok(g > 200 && r < 40 && b < 40, `CPU-scaled frame keeps its colour (${r}, ${g}, ${b})`)
})

test('ProRes 4444 keeps transparency for keying', { skip }, async () => {
  const { path, rec } = open('alpha.mov', { codec: 'prores4444' })
  // Half-transparent red, premultiplied as Chromium paints it.
  recorder.pushPixels(rec, solid(W, H, [0, 0, 128, 128]), W, H)
  await wait(300)
  await stop(rec)
  const seen = recorder.probe(path)
  assert.equal(seen.codec, 'ap4h')
  const [b, g, r, a] = average(seen.lastFrame)
  assert.ok(Math.abs(a - 128) < 6, `alpha survives (${a})`)
  assert.ok(r > 100 && g < 20 && b < 20, `colour survives (${r}, ${g}, ${b})`)
})

test('HEVC and ProRes 422 encode', { skip }, async () => {
  for (const [codec, fourcc] of [['hevc', 'hvc1'], ['prores422', 'apcn']]) {
    const { path, rec } = open(`${codec}.mov`, { codec })
    recorder.pushPixels(rec, solid(W, H, [40, 80, 120, 255]), W, H)
    await wait(200)
    await stop(rec)
    assert.equal(recorder.probe(path).codec, fourcc)
    assert.ok(statSync(path).size > 0)
  }
})

test('a frame that arrives during a GPU copy is dropped, not queued', { skip }, async () => {
  const { rec } = open('busy.mov')
  const handle = gpu.createTestSurface(solid(W, H, [1, 2, 3, 255]), W, H)
  const first = pushTexture(rec, handle)
  const second = await pushTexture(rec, handle)
  assert.equal(await first, true)
  assert.equal(second, false)
  assert.equal(recorder.stats(rec).skipped, 1)
  await stop(rec)
})

test('a stopped recorder takes no more frames and cannot stop twice', { skip }, async () => {
  const { rec } = open('stopped.mov')
  const result = await stop(rec)
  assert.ok(result.frames >= 1, 'even an instant stop writes the first frame')
  assert.throws(() => recorder.pushPixels(rec, solid(W, H, [0, 0, 0, 255]), W, H), /stopped/)
  assert.throws(() => recorder.stop(rec, () => {}), /already stopped/)
})

test('bad options are refused before a file is made', { skip }, () => {
  assert.throws(() => recorder.open({ path: join(dir, 'x.mov'), codec: 'vp9' }), /unknown codec/)
  assert.throws(() => recorder.open({ path: join(dir, 'x.mov'), width: 321, height: 180 }), /unsupported size/)
  assert.throws(() => recorder.open({ path: join(dir, 'x.mov'), audioDeviceId: 'no-such-device' }), /not connected/)
  assert.throws(() => recorder.open({}), /path is required/)
})

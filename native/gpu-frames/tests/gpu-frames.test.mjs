// gpu-frames golden and behaviour tests (plan 008, Step 2/3). macOS only.
// The reference is the DeckLink helper's own CPU conversion (native/decklink/uyvy.h).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const mac = process.platform === 'darwin'
const addonPath = resolve('native/gpu-frames/build/gpu_frames.node')
const skip = !mac ? 'macOS only' : !existsSync(addonPath) ? 'run `npm run build:gpu-frames` first' : false
const gpu = skip ? null : createRequire(import.meta.url)(addonPath)
const dir = mkdtempSync(join(tmpdir(), 'kairo-gpu-frames-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

function compile(source, name) {
  const binary = join(dir, name)
  const build = spawnSync('xcrun', ['clang++', '-std=c++17', '-O2', resolve(source), '-o', binary], { encoding: 'utf8' })
  assert.equal(build.status, 0, build.stderr)
  return binary
}

let reference
function cpu(bgra, sw, sh, dw, dh) {
  reference ??= compile('native/gpu-frames/tests/uyvy-reference.cpp', 'uyvy-reference')
  const run = spawnSync(reference, [sw, sh, dw, dh].map(String), { input: bgra, maxBuffer: 64 * 1024 * 1024 })
  assert.equal(run.status, 0, run.stderr?.toString())
  return run.stdout
}

/** Premultiplied BGRA, as Chromium paints it: colour never exceeds alpha. */
function gradient(w, h) {
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const a = (x * 7 + y * 3) % 256
    out[i] = Math.min(a, (x * 255 / w) | 0)
    out[i + 1] = Math.min(a, (y * 255 / h) | 0)
    out[i + 2] = Math.min(a, ((x + y) * 13) % 256)
    out[i + 3] = a
  }
  return out
}

const pixels = (...bgra) => Buffer.from(bgra.flat())

test('ring seqlock: torn reads, in-progress slots, wrap-around', { skip: !mac && 'macOS only' }, () => {
  const run = spawnSync(compile('native/gpu-frames/tests/ring-test.cpp', 'ring-test'), [], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), 'ok')
})

test('shader matches the helper self-test vectors byte for byte', { skip }, () => {
  const black = pixels([0, 0, 0, 255], [0, 0, 0, 255])
  const white = pixels([255, 255, 255, 255], [255, 255, 255, 255])
  const red = pixels([0, 0, 255, 255], [0, 0, 255, 255])
  assert.deepEqual([...gpu.convertPixels(black, 2, 1, 2, 1, false)], [128, 16, 128, 16])
  const r = gpu.convertPixels(red, 2, 1, 2, 1, false)
  assert.deepEqual([r[0], r[1], r[2]], [102, 63, 240])
  const wh = gpu.convertPixels(white, 2, 1, 2, 1, false)
  assert.equal(wh[1], 235); assert.equal(wh[3], 235)
  for (const vector of [black, white, red]) assert.deepEqual(gpu.convertPixels(vector, 2, 1, 2, 1, false), cpu(vector, 2, 1, 2, 1))
})

test('1080p premultiplied gradient matches the CPU path exactly, including scaling to 720p', { skip }, () => {
  const src = gradient(1920, 1080)
  assert.ok(gpu.convertPixels(src, 1920, 1080, 1920, 1080, false).equals(cpu(src, 1920, 1080, 1920, 1080)))
  assert.ok(gpu.convertPixels(src, 1920, 1080, 1280, 720, false).equals(cpu(src, 1920, 1080, 1280, 720)))
  // A 2× (Retina) paint scaled down, as when a display change outruns the window rebuild.
  const retina = gradient(3840, 2160)
  assert.ok(gpu.convertPixels(retina, 3840, 2160, 1920, 1080, false).equals(cpu(retina, 3840, 2160, 1920, 1080)))
})

test('UYVA carries the source alpha after the UYVY plane', { skip }, () => {
  const src = gradient(64, 4)
  const out = gpu.convertPixels(src, 64, 4, 64, 4, true)
  assert.equal(out.length, 64 * 4 * 3)
  assert.ok(out.subarray(0, 64 * 4 * 2).equals(cpu(src, 64, 4, 64, 4)))
  for (let i = 0; i < 64 * 4; i++) assert.equal(out[64 * 4 * 2 + i], src[i * 4 + 3])
})

test('IOSurface → ring: the published slot holds the converted frame', { skip }, async () => {
  const src = gradient(1920, 1080)
  const ring = gpu.createRing(`/kgf.t${process.pid % 100000}`, 1920, 1080)
  const converter = gpu.open({ width: 1920, height: 1080, ring })
  const surface = gpu.createTestSurface(src, 1920, 1080)
  try {
    const result = await new Promise((done, fail) => {
      const started = gpu.convert(converter, surface, (err, value) => err ? fail(err) : done(value))
      assert.equal(started, true)
    })
    assert.equal(result.sequence, 1)
    const state = gpu.readRing(ring)
    assert.equal(state.published, 1)
    assert.ok(state.seqs.every((seq) => seq % 2 === 0), 'no slot left mid-write')
    assert.ok(state.frame.equals(cpu(src, 1920, 1080, 1920, 1080)))
  } finally {
    gpu.close(converter)
    gpu.closeRing(ring)
    gpu.releaseTestSurface(surface)
  }
})

test('a busy converter drops the frame instead of queueing it, and stays within budget', { skip }, async () => {
  const converter = gpu.open({ width: 1920, height: 1080, alpha: true })
  const surface = gpu.createTestSurface(gradient(1920, 1080), 1920, 1080)
  try {
    // Three slots: a burst beyond that is refused immediately.
    const burst = []
    const accepted = []
    for (let i = 0; i < 6; i++) {
      accepted.push(gpu.convert(converter, surface, (err, frame) => burst.push(err ?? frame.length)))
    }
    assert.deepEqual(accepted, [true, true, true, false, false, false])
    await new Promise((done) => { const t = setInterval(() => { if (burst.length === 3) { clearInterval(t); done() } }, 2) })
    assert.deepEqual(burst, [1920 * 1080 * 3, 1920 * 1080 * 3, 1920 * 1080 * 3])
    assert.equal(gpu.stats(converter).skipped, 3)

    // Latency: submit → result on the JS thread, one frame at a time.
    const times = []
    for (let i = 0; i < 120; i++) {
      const start = process.hrtime.bigint()
      await new Promise((done, fail) => { gpu.convert(converter, surface, (err) => err ? fail(err) : done()) })
      times.push(Number(process.hrtime.bigint() - start) / 1e6)
    }
    times.sort((a, b) => a - b)
    const p50 = times[Math.floor(times.length * 0.5)], p99 = times[Math.floor(times.length * 0.99)]
    console.log(`gpu-frames 1080p UYVA convert+readback: p50 ${p50.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms`)
    assert.ok(p99 < 33, `p99 ${p99.toFixed(2)} ms is over a 30 fps frame`)
  } finally {
    gpu.close(converter)
    gpu.releaseTestSurface(surface)
  }
})

test('closing a ring under a live converter drops frames instead of failing', { skip }, async () => {
  const ring = gpu.createRing(`/kgf.c${process.pid % 100000}`, 1280, 720)
  const converter = gpu.open({ width: 1280, height: 720, ring })
  const surface = gpu.createTestSurface(gradient(1920, 1080), 1920, 1080)
  try {
    const pending = new Promise((done, fail) => { assert.equal(gpu.convert(converter, surface, (err) => err ? fail(err) : done()), true) })
    gpu.closeRing(ring) // mid-flight: the mapping must survive until the GPU is done
    await pending
    assert.equal(gpu.convert(converter, surface, () => assert.fail('dropped frames get no callback')), false)
  } finally {
    gpu.close(converter)
    gpu.releaseTestSurface(surface)
  }
})

// syphon end-to-end tests. macOS only.
// A frame goes in as Chromium hands it over (an IOSurface, made here by the
// gpu-frames test helper), is published, and is read back by a Syphon client
// the way OBS or Resolume would see it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const mac = process.platform === 'darwin'
const syphonPath = resolve('native/syphon/build/syphon.node')
const gpuPath = resolve('native/gpu-frames/build/gpu_frames.node')
const skip = !mac
  ? 'macOS only'
  : !existsSync(syphonPath) ? 'run `npm run build:syphon` first'
  : !existsSync(gpuPath) ? 'run `npm run build:gpu-frames` first (test surfaces)'
  : false
const require = createRequire(import.meta.url)
const syphon = skip ? null : require(syphonPath)
const gpu = skip ? null : require(gpuPath)

/** A BGRA frame: left half opaque red, right half half-transparent blue, one green pixel at (1,1). */
function frame(width, height) {
  const bgra = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (x < width / 2) bgra.set([0, 0, 255, 255], i)
      else bgra.set([128, 0, 0, 128], i) // premultiplied blue at half alpha
    }
  }
  bgra.set([0, 255, 0, 255], (1 * width + 1) * 4)
  return bgra
}

/** Publishes one frame and resolves once the GPU copy is done. */
function publish(server, handle) {
  return new Promise((resolvePromise, reject) => {
    const started = syphon.publish(server, handle, (error) => (error ? reject(error) : resolvePromise(true)))
    if (!started) resolvePromise(false)
  })
}

test('the addon is available on this Mac', { skip }, () => {
  assert.deepEqual(syphon.available(), { ok: true })
})

test('a published frame reaches a Syphon client pixel for pixel, alpha included', { skip }, async () => {
  const width = 64, height = 36
  const bgra = frame(width, height)
  const handle = gpu.createTestSurface(bgra, width, height)
  const server = syphon.open({ name: 'Kairo test' })
  try {
    assert.equal(await publish(server, handle), true)
    const seen = syphon.readLatest(server, 3000)
    assert.ok(seen, 'the client received a frame')
    assert.equal(seen.width, width)
    assert.equal(seen.height, height)
    assert.ok(seen.bgra.equals(bgra), 'every pixel, including transparency, arrives unchanged')
    assert.equal(syphon.stats(server).published, 1)
  } finally {
    syphon.close(server)
    gpu.releaseTestSurface(handle)
  }
})

test('a frame sent while the previous one is still copying is dropped, not queued', { skip }, async () => {
  const handle = gpu.createTestSurface(frame(1920, 1080), 1920, 1080)
  const server = syphon.open({ name: 'Kairo busy test' })
  try {
    const results = []
    const copies = []
    for (let i = 0; i < 5; i++) {
      copies.push(new Promise((done) => {
        const started = syphon.publish(server, handle, () => done())
        results.push(started)
        if (!started) done()
      }))
    }
    await Promise.all(copies)
    assert.equal(results[0], true)
    const stats = syphon.stats(server)
    assert.equal(stats.published + stats.skipped, 5)
    assert.ok(stats.skipped >= 1, 'back-to-back frames are dropped while one is in flight')
  } finally {
    syphon.close(server)
    gpu.releaseTestSurface(handle)
  }
})

test('a closed server refuses frames instead of crashing', { skip }, () => {
  const handle = gpu.createTestSurface(frame(16, 16), 16, 16)
  const server = syphon.open({ name: 'Kairo closed test' })
  syphon.close(server)
  try {
    assert.throws(() => syphon.publish(server, handle, () => {}), /closed/)
  } finally {
    gpu.releaseTestSurface(handle)
  }
})

test('a size change between frames is followed', { skip }, async () => {
  const server = syphon.open({ name: 'Kairo resize test' })
  const small = gpu.createTestSurface(frame(32, 18), 32, 18)
  const large = gpu.createTestSurface(frame(64, 36), 64, 36)
  try {
    await publish(server, small)
    assert.equal(syphon.readLatest(server, 3000)?.width, 32)
    await publish(server, large)
    assert.equal(syphon.readLatest(server, 3000)?.width, 64)
  } finally {
    syphon.close(server)
    gpu.releaseTestSurface(small)
    gpu.releaseTestSurface(large)
  }
})

test('pixels from the CPU capture path are published as they are', { skip }, () => {
  const width = 40, height = 20
  const bgra = frame(width, height)
  const server = syphon.open({ name: 'Kairo pixels test' })
  try {
    assert.equal(syphon.publishPixels(server, bgra, width, height), true)
    const seen = syphon.readLatest(server, 3000)
    assert.ok(seen?.bgra.equals(bgra), 'every pixel arrives unchanged')
    assert.throws(() => syphon.publishPixels(server, Buffer.alloc(10), width, height), /width × height/)
  } finally {
    syphon.close(server)
  }
})

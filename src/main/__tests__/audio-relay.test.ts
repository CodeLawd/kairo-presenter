import test from 'node:test'
import assert from 'node:assert/strict'
import { audioService, MAX_QUEUED_BYTES } from '../services/audio'

// 100ms of 16kHz mono PCM16, matching what the AudioWorklet posts per message.
const CHUNK_BYTES = 1600 * 2

function chunk(): Buffer {
  return Buffer.alloc(CHUNK_BYTES)
}

/** A PassThrough buffers on both sides; either alone understates what is held. */
function queuedBytes(): number {
  const stream = audioService.getPCMStream()
  return stream ? stream.writableLength + stream.readableLength : 0
}

test('feedPCMChunk is a no-op before a stream exists', () => {
  audioService.destroyRendererStream()
  assert.equal(audioService.getPCMStream(), null)
  audioService.feedPCMChunk(chunk()) // must not throw
  assert.equal(audioService.getPCMStream(), null)
})

test('a flowing consumer receives every chunk and nothing queues', async () => {
  const stream = audioService.createRendererStream()
  const received: Buffer[] = []
  stream.on('data', (buf: Buffer) => received.push(buf))

  for (let i = 0; i < 100; i++) audioService.feedPCMChunk(chunk())
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(received.length, 100)
  assert.equal(
    received.reduce((sum, buf) => sum + buf.length, 0),
    100 * CHUNK_BYTES,
  )
  assert.equal(queuedBytes(), 0)
  audioService.destroyRendererStream()
})

test('a detached consumer cannot grow the queue past the 5s cap', () => {
  // No 'data' listener: this is the Deepgram-detached case that previously grew
  // the main-process buffer without bound.
  audioService.createRendererStream()

  // Feed 60s of audio into a queue that may hold 5s.
  for (let i = 0; i < 600; i++) audioService.feedPCMChunk(chunk())

  assert.ok(
    queuedBytes() <= MAX_QUEUED_BYTES,
    `queue grew to ${queuedBytes()} bytes, cap is ${MAX_QUEUED_BYTES}`,
  )
  audioService.destroyRendererStream()
})

test('dropping is newest-first: the queue keeps the audio it accepted first', () => {
  audioService.createRendererStream()

  const accepted: number[] = []
  for (let i = 0; i < 600; i++) {
    const before = queuedBytes()
    audioService.feedPCMChunk(chunk())
    if (queuedBytes() > before) accepted.push(i)
  }

  // Acceptance stops once the cap is reached and never resumes while stalled,
  // so the retained chunks are a contiguous run from the start of the stall.
  assert.ok(accepted.length > 0)
  assert.deepEqual(accepted, Array.from({ length: accepted.length }, (_, i) => i))
  assert.ok(accepted.length < 600, 'expected some chunks to be dropped')
  audioService.destroyRendererStream()
})

test('a stalled queue drains and resumes accepting once a consumer attaches', async () => {
  const stream = audioService.createRendererStream()
  for (let i = 0; i < 600; i++) audioService.feedPCMChunk(chunk())
  assert.ok(queuedBytes() > 0)

  const received: Buffer[] = []
  stream.on('data', (buf: Buffer) => received.push(buf))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(queuedBytes(), 0)
  assert.ok(received.length > 0, 'queued audio should reach a late consumer')

  const before = received.length
  audioService.feedPCMChunk(chunk())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(received.length, before + 1)
  audioService.destroyRendererStream()
})

test('createRendererStream replaces the previous stream', () => {
  const first = audioService.createRendererStream()
  const second = audioService.createRendererStream()

  assert.notEqual(first, second)
  assert.equal(first.destroyed, true)
  assert.equal(audioService.getPCMStream(), second)

  // Writes after replacement land on the new stream only.
  audioService.feedPCMChunk(chunk())
  assert.equal(queuedBytes(), CHUNK_BYTES)
  audioService.destroyRendererStream()
})

test('stopCapture clears the stream so a stale one is never reattached', async () => {
  audioService.createRendererStream()
  await audioService.stopCapture()
  assert.equal(audioService.getPCMStream(), null)
})

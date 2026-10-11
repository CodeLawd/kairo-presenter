import { it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { openWorkerPlayback, type PlaybackWorkerLike } from '../providers/decklink/worker-sink'
import type { PlaybackWorkerCommand, PlaybackWorkerEvent } from '../providers/decklink/worker-protocol'

class WorkerDouble extends EventEmitter implements PlaybackWorkerLike {
  sent: PlaybackWorkerCommand[] = []
  transfers: ArrayBuffer[][] = []
  terminated = false
  postMessage(command: PlaybackWorkerCommand, transfer: ArrayBuffer[] = []): void {
    this.sent.push(command)
    this.transfers.push(transfer)
    if (command.type === 'close') queueMicrotask(() => this.reply({ type: 'closed' }))
  }
  reply(event: PlaybackWorkerEvent): void { this.emit('message', event) }
  async terminate(): Promise<number> { this.terminated = true; this.emit('exit', 1); return 1 }
}

const data = { helperPath: '/helper', portId: 'decklink:1:0', modeId: 'decklink:1' }
async function open(): Promise<{ worker: WorkerDouble; sink: Awaited<ReturnType<typeof openWorkerPlayback>> }> {
  const worker = new WorkerDouble()
  const pending = openWorkerPlayback('/worker.js', data, () => worker)
  worker.reply({ type: 'started' })
  return { worker, sink: await pending }
}
const frames = (worker: WorkerDouble) =>
  worker.sent.filter((command): command is Extract<PlaybackWorkerCommand, { type: 'frame' }> => command.type === 'frame')

it('forwards diagnostic samples without exposing mutable worker state', async () => {
  const { worker, sink } = await open()
  assert.equal(sink.diagnostics?.(), null)
  worker.reply({ type: 'stats', diagnostics: { completed: 40, late: 2, dropped: 1, repeated: 4, received: 45, outputFps: 25 } })
  const sample = sink.diagnostics?.()
  assert.equal(sample?.late, 2)
  sample!.late = 99
  assert.equal(sink.diagnostics?.()?.late, 2)
  await sink.close()
})

it('copies the frame and transfers the copy to the worker', async () => {
  const { worker, sink } = await open()
  const frame = Buffer.alloc(8, 42)
  sink.setFrame(frame, 2, 1)
  frame.fill(0)
  const [sent] = frames(worker)
  assert.equal(new Uint8Array(sent.data)[0], 42)
  assert.equal(worker.transfers[0][0], sent.data)
  assert.throws(() => sink.setFrame(Buffer.alloc(1), 2, 1), /Invalid/)
  await sink.close()
})

it('keeps one frame in flight and only the newest waiting frame', async () => {
  const { worker, sink } = await open()
  sink.setFrame(Buffer.alloc(4, 1), 1, 1)
  sink.setFrame(Buffer.alloc(4, 2), 1, 1)
  sink.setFrame(Buffer.alloc(4, 3), 1, 1)
  assert.equal(frames(worker).length, 1)
  worker.reply({ type: 'ack' })
  assert.deepEqual(frames(worker).map((f) => new Uint8Array(f.data)[0]), [1, 3])
  worker.reply({ type: 'ack' })
  assert.equal(frames(worker).length, 2)
  await sink.close()
})

it('reports worker errors and refuses later frames', async () => {
  const { worker, sink } = await open()
  let reported: Error | null = null
  sink.onError?.((error) => { reported = error })
  worker.reply({ type: 'error', reason: 'DeckLink playback failed' })
  assert.match(String(reported), /playback failed/)
  assert.throws(() => sink.setFrame(Buffer.alloc(4), 1, 1), /playback failed/)
  await sink.close()
})

it('startup failure rejects and terminates the worker', async () => {
  const worker = new WorkerDouble()
  const pending = openWorkerPlayback('/worker.js', data, () => worker)
  worker.reply({ type: 'error', reason: 'In use by another app' })
  await assert.rejects(pending, /In use/)
  assert.equal(worker.terminated, true)
})

it('close asks the worker to release the port and is idempotent', async () => {
  const { worker, sink } = await open()
  await Promise.all([sink.close(), sink.close()])
  assert.equal(worker.sent.filter((command) => command.type === 'close').length, 1)
  assert.throws(() => sink.setFrame(Buffer.alloc(4), 1, 1), /closed/)
})

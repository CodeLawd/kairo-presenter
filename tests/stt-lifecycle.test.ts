import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import log from 'electron-log/main'
log.transports.file.level = false
log.transports.console.level = false

import { DeepgramSTTService } from '../src/main/services/stt/deepgram'

class Socket {
  readyState = 1
  closed = false
  handlers: Record<string, (...args: unknown[]) => void> = {}
  on(event: string, cb: (...args: unknown[]) => void) { this.handlers[event] = cb }
  connect() {}
  close() { this.closed = true }
  sendCloseStream() {}
  sendKeepAlive() {}
  sendMedia() {}
}
function setup(connect: () => Promise<Socket>) {
  const service = new DeepgramSTTService()
  service.configure('test')
  Object.assign(service, { client: { listen: { v1: { connect } } } })
  return service
}
test('stopping during connection setup closes the late socket', async () => {
  let resolve!: (socket: Socket) => void
  const service = setup(() => new Promise((r) => { resolve = r }))
  const connecting = service.connect()
  service.disconnect()
  const socket = new Socket()
  resolve(socket)
  await connecting
  assert.equal(socket.closed, true)
  assert.equal(service.isConnected(), false)
})
test('old connection events cannot disconnect or transcribe into a new session', async () => {
  const sockets = [new Socket(), new Socket()]
  let i = 0
  const service = setup(async () => sockets[i++])
  try {
    await service.connect()
    service.disconnect()
    await service.connect()
    let finals = 0
    service.on('final', () => { finals++ })
    sockets[0].handlers.message({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'stale' }] } })
    sockets[0].handlers.close()
    assert.equal(finals, 0)
    assert.equal(service.isConnected(), true)
  } finally { service.disconnect() }
})
test('replacing an audio stream removes its end and error handlers', () => {
  const service = new DeepgramSTTService()
  const first = new PassThrough()
  const second = new PassThrough()
  service.attachStream(first)
  service.attachStream(second)
  assert.equal(first.listenerCount('end'), 0)
  assert.equal(first.listenerCount('error'), 0)
  service.detachStream()
  first.destroy()
  second.destroy()
})

test('a failed media send is retained for reconnect instead of silently discarded', async () => {
  const socket = new Socket()
  socket.sendMedia = () => { throw new Error('socket closed during send') }
  const service = setup(async () => socket)
  const stream = new PassThrough()
  try {
    await service.connect()
    service.attachStream(stream)
    stream.write(Buffer.from([1, 2, 3, 4]))
    assert.equal((service as unknown as { audioBufferBytes: number }).audioBufferBytes, 4)
    assert.equal(service.isConnected(), false)
  } finally { service.disconnect(); stream.destroy() }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createPlaybackSink } from '../../../src/main/services/video-devices/providers/decklink/client'
function processDouble() {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & { packets: Buffer[]; stdout: PassThrough; stderr: PassThrough }
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.packets = [] as Buffer[]
  child.stdin = new Writable({ write(chunk, _encoding, done) { child.packets.push(Buffer.from(chunk)); done() } })
  child.stdin.on('finish', () => child.emit('exit', 0, null))
  child.kill = () => { child.emit('exit', null, 'SIGTERM'); return true }
  return child
}
test('copies frame ownership and writes a bounded binary packet', async () => {
  const child=processDouble()
  const pending=createPlaybackSink(child)
  child.stdout.write('{"event":"started"}\n')
  const sink=await pending
  const frame=Buffer.alloc(8, 42)
  sink.setFrame(frame, 2, 1); frame.fill(0)
  assert.equal(child.packets[0].readUInt32LE(0), 2)
  assert.equal(child.packets[0].readUInt32LE(4), 1)
  assert.equal(child.packets[0].readUInt32LE(8), 8)
  assert.equal(child.packets[0][12], 42)
  assert.throws(() => sink.setFrame(Buffer.alloc(1), 2, 1), /Invalid/)
  await sink.close(); await sink.close()
})
test('native crash is reported asynchronously and blocks later frames', async () => {
  const child=processDouble(); const pending=createPlaybackSink(child)
  child.stdout.write('{"event":"started"}\n'); const sink=await pending
  let reason=''; sink.onError((error: Error) => { reason=error.message })
  child.emit('exit', null, 'SIGSEGV')
  assert.match(reason, /SIGSEGV/)
  assert.throws(() => sink.setFrame(Buffer.alloc(4), 1, 1), /SIGSEGV/)
  await sink.close()
})
test('busy errors preserve the native explanation before ready', async () => {
  const child=processDouble(); const pending=createPlaybackSink(child)
  child.stderr.write('Enable video output: In use by another app (ProPresenter?)\n')
  child.emit('exit', 1, null)
  await assert.rejects(pending, /In use by another app/)
})
test('playback callback failures reach subscribers', async () => {
  const child=processDouble(); const pending=createPlaybackSink(child)
  child.stdout.write('{"event":"started"}\n'); const sink=await pending
  let failed=false; sink.onError(() => { failed=true })
  child.stdout.write('{"event":"error","reason":"Device disconnected"}\n')
  assert.equal(failed,true); await sink.close()
})
test('backpressure retains only the newest unsent immutable frame', async () => {
  const child=processDouble()
  child.stdin.write=(packet: Buffer) => { child.packets.push(Buffer.from(packet)); return false }
  const pending=createPlaybackSink(child); child.stdout.write('{"event":"started"}\n'); const sink=await pending
  sink.setFrame(Buffer.alloc(4,1),1,1)
  sink.setFrame(Buffer.alloc(4,2),1,1)
  const newest=Buffer.alloc(4,3); sink.setFrame(newest,1,1); newest.fill(0)
  assert.equal(child.packets.length,1)
  child.stdin.emit('drain')
  assert.equal(child.packets.length,2)
  assert.equal(child.packets[1][12],3)
  await sink.close()
})
test('hung startup is terminated and rejected', async () => {
  const child=processDouble()
  await assert.rejects(createPlaybackSink(child, 10), /timed out/)
})
test('startup timeout force-terminates a helper that ignores SIGTERM', async () => {
  const child=processDouble(), signals: string[]=[]
  child.kill=(signal='SIGTERM') => { signals.push(signal); if(signal==='SIGKILL') child.emit('exit',null,signal); return true }
  await assert.rejects(createPlaybackSink(child,10,10),/timed out/)
  await new Promise((done)=>setTimeout(done,25))
  assert.deepEqual(signals,['SIGTERM','SIGKILL'])
})
test('reports hardware playback samples without treating them as failures', async () => {
  const child=processDouble(); const pending=createPlaybackSink(child)
  child.stdout.write('{"event":"started"}\n'); const sink=await pending
  child.stdout.write('{"event":"stats","completed":100,"late":2,"dropped":1,"repeated":4,"received":98,"outputFps":25}\n')
  assert.deepEqual(sink.diagnostics?.(), { completed:100, late:2, dropped:1, repeated:4, received:98, outputFps:25 })
  child.stdout.write('{"event":"stats","completed":-1}\n')
  assert.equal(sink.diagnostics?.()?.completed,100)
  await sink.close()
})

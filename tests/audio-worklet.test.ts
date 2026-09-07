import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function processor() {
  const messages: { pcm: ArrayBuffer; rms: number; peak: number }[] = []
  let Processor!: new () => { process(inputs: Float32Array[][]): boolean }
  runInNewContext(readFileSync('src/renderer/public/audio/pcm-capture.worklet.js', 'utf8'), {
    sampleRate: 16000,
    AudioWorkletProcessor: class {
      port = { postMessage(message: typeof messages[number], transfer: ArrayBuffer[]) {
        assert.equal(transfer[0], message.pcm)
        messages.push(structuredClone(message, { transfer }))
      } }
    },
    registerProcessor(name: string, implementation: typeof Processor) {
      assert.equal(name, 'kairo-pcm-capture')
      Processor = implementation
    },
  })
  return { instance: new Processor(), messages }
}
test('worklet batches exactly 512 samples across arbitrary render blocks without losing samples', () => {
  const { instance, messages } = processor()
  instance.process([[new Float32Array(300).fill(0.5)]])
  assert.equal(messages.length, 0)
  instance.process([[new Float32Array(724).fill(-0.5)]])
  assert.equal(messages.length, 2)
  const samples = messages.flatMap((m) => Array.from(new Int16Array(m.pcm)))
  assert.deepEqual(samples, [...Array(300).fill(16383), ...Array(724).fill(-16384)])
  assert.equal(messages[0].rms, 0.5)
  assert.equal(messages[0].peak, 0.5)
})
test('worklet clamps clipping and stays alive without input', () => {
  const { instance, messages } = processor()
  assert.equal(instance.process([]), true)
  assert.equal(messages.length, 0)
  instance.process([[Float32Array.from({ length: 512 }, (_, i) => i % 2 ? -2 : 2)]])
  assert.deepEqual(Array.from(new Int16Array(messages[0].pcm)).slice(0, 2), [32767, -32768])
  assert.equal(messages[0].peak, 1)
})

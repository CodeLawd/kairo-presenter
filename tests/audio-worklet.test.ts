import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const WORKLET_PATH = path.join(
  process.cwd(),
  'src/renderer/public/audio/pcm-capture.worklet.js',
)

interface PcmMessage { pcm: ArrayBuffer }
interface MeterMessage { rms: number; peak: number }
type Posted = PcmMessage | MeterMessage

interface Harness {
  /** Feeds `frames` of 128 samples, advancing the clock like a real render quantum. */
  render: (frames: number, value: number) => void
  /** Feeds one block of any length, as a host with a different quantum would. */
  renderBlock: (block: Float32Array) => void
  /** Calls process() with no input channel, as a disconnected source does. */
  processEmpty: () => boolean
  pcm: () => Int16Array[]
  meters: () => MeterMessage[]
  /** True only if every PCM post listed its own buffer in the transfer list. */
  allPcmTransferred: () => boolean
}

/**
 * Loads the real worklet file under stubbed AudioWorklet globals so the batching
 * and metering logic is exercised as shipped, not reimplemented here.
 */
function loadWorklet(sampleRate = 16000): Harness {
  const source = fs.readFileSync(WORKLET_PATH, 'utf8')
  const posted: Posted[] = []
  let allTransferred = true
  let currentTime = 0

  class AudioWorkletProcessor {
    port = {
      postMessage: (message: Posted, transfer?: ArrayBuffer[]) => {
        if ('pcm' in message) {
          // Identity, not deepEqual: the buffer is built inside the vm realm.
          allTransferred &&= transfer?.length === 1 && transfer[0] === message.pcm
          // Copy before the real transfer list would neuter the buffer.
          posted.push({ pcm: message.pcm.slice(0) })
        } else {
          posted.push({ ...message })
        }
      },
    }
  }

  let Registered: (new () => { process: (inputs: Float32Array[][]) => boolean }) | null = null
  const context = vm.createContext({
    AudioWorkletProcessor,
    registerProcessor: (name: string, ctor: never) => {
      assert.equal(name, 'kairo-pcm-capture')
      Registered = ctor
    },
    get sampleRate() { return sampleRate },
    get currentTime() { return currentTime },
  })
  vm.runInContext(source, context)
  assert.ok(Registered, 'worklet did not register a processor')

  const processor = new Registered()

  return {
    render(frames, value) {
      // 128 samples is the Web Audio render quantum.
      for (let i = 0; i < frames; i++) this.renderBlock(new Float32Array(128).fill(value))
    },
    renderBlock(block) {
      processor.process([[block]])
      currentTime += block.length / sampleRate
    },
    processEmpty: () => processor.process([]),
    pcm: () => posted.filter((m): m is PcmMessage => 'pcm' in m).map((m) => new Int16Array(m.pcm)),
    meters: () => posted.filter((m): m is MeterMessage => !('pcm' in m)),
    allPcmTransferred: () => allTransferred,
  }
}

test('refuses to run when the context is not 16kHz', () => {
  assert.throws(() => loadWorklet(48000), /16kHz/)
})

test('emits 1600-sample (100ms) PCM chunks', () => {
  const w = loadWorklet()
  // 1600 samples = 12.5 render quanta, so 25 quanta is exactly two chunks,
  // neither of which lands on a quantum boundary.
  w.render(25, 1)

  const chunks = w.pcm()
  assert.equal(chunks.length, 2)
  for (const chunk of chunks) {
    assert.equal(chunk.length, 1600, '1600 samples @16kHz = 100ms')
    assert.equal(chunk.byteLength, 3200, 'Int16 = 2 bytes/sample')
    assert.ok(chunk.every((s) => s === 32767), 'full-scale +1.0 maps to 32767')
  }
  assert.ok(w.allPcmTransferred(), 'PCM must be transferred, not structured-cloned')
})

test('a chunk is emitted only once full — no short flushes', () => {
  const w = loadWorklet()
  w.render(12, 0) // 1536 samples: one sample short of a chunk
  assert.equal(w.pcm().length, 0)

  w.render(1, 0) // 1664 samples: crosses the boundary
  assert.equal(w.pcm().length, 1)
})

test('converts float samples to signed 16-bit little-endian', () => {
  const w = loadWorklet()
  w.render(13, -1)
  const [chunk] = w.pcm()
  assert.ok(chunk.every((s) => s === -32768), 'full-scale -1.0 maps to -32768')

  const silent = loadWorklet()
  silent.render(13, 0)
  assert.ok(silent.pcm()[0].every((s) => s === 0))
})

test('clamps out-of-range and non-finite samples instead of wrapping', () => {
  const w = loadWorklet()
  w.render(13, 4)
  assert.ok(w.pcm()[0].every((s) => s === 32767), 'over-range clamps to +full scale')

  const nan = loadWorklet()
  nan.render(13, NaN)
  assert.ok(nan.pcm()[0].every((s) => s === 0), 'NaN becomes silence, not garbage')
})

test('meter updates at ~10Hz independently of the PCM chunk boundary', () => {
  const w = loadWorklet()
  // 1 second of audio.
  w.render(125, 0.5)

  const meters = w.meters()
  // ~10 per second; allow a quantum of slack at the edges.
  assert.ok(meters.length >= 9 && meters.length <= 11, `got ${meters.length} meter updates`)
  for (const meter of meters) {
    assert.ok(Math.abs(meter.rms - 0.5) < 0.01, `rms ${meter.rms}`)
    assert.ok(Math.abs(meter.peak - 0.5) < 0.01, `peak ${meter.peak}`)
  }
})

test('meter reports levels before the first PCM chunk is ready', () => {
  const w = loadWorklet()
  w.render(1, 0.25) // 128 samples: far short of a 1600-sample chunk

  assert.equal(w.pcm().length, 0)
  assert.equal(w.meters().length, 1, 'levels must not wait on a 100ms chunk')
})

test('meter accumulators reset each interval so peaks do not latch', () => {
  const w = loadWorklet()
  w.render(13, 1)  // ~104ms loud
  w.render(40, 0)  // ~320ms silence: several whole intervals see nothing but zeros
  const meters = w.meters()

  assert.ok(meters.some((m) => m.peak === 1), 'loud audio must register')
  // The meter spanning the loud→silent boundary still carries the loud peak;
  // every interval after it must read silent, with no latched peak or RMS.
  const last = meters[meters.length - 1]
  assert.equal(last.peak, 0, 'peak must not latch across intervals')
  assert.equal(last.rms, 0, 'rms must not latch across intervals')
})

// ─── Arbitrary block sizes ────────────────────────────────────────────────────
// The worklet must not assume a 128-sample render quantum: batching is defined
// purely by CHUNK_SAMPLES, so odd block sizes must still produce exact chunks.

test('batches exactly 1600 samples across arbitrary render blocks without losing samples', () => {
  const w = loadWorklet()
  w.renderBlock(new Float32Array(900).fill(0.5))
  assert.equal(w.pcm().length, 0, '900 samples is short of a chunk')

  w.renderBlock(new Float32Array(2300).fill(-0.5))
  assert.equal(w.pcm().length, 2, '3200 samples = exactly two chunks')

  const samples = w.pcm().flatMap((chunk) => Array.from(chunk))
  assert.deepEqual(
    samples,
    [...Array(900).fill(16383), ...Array(2300).fill(-16384)],
    'every sample must survive the block/chunk boundary mismatch, in order',
  )
})

test('a block larger than one chunk emits every whole chunk it contains', () => {
  const w = loadWorklet()
  w.renderBlock(new Float32Array(5000).fill(0.25))
  assert.equal(w.pcm().length, 3, '5000 samples yields 3 chunks, 200 held over')
})

test('stays alive and silent when the input is missing', () => {
  const w = loadWorklet()
  assert.equal(w.processEmpty(), true, 'a missing input must not end the processor')
  assert.equal(w.pcm().length + w.meters().length, 0, 'nothing may be posted')
})

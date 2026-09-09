/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentTime */
// Served as a separate module so the app's script-src 'self' policy stays intact.

// 1600 samples @ 16kHz = 100ms per PCM chunk (10 IPC messages/sec).
const CHUNK_SAMPLES = 1600
// Meter stays at ~10Hz regardless of chunk size, so levels never lag the UI.
const METER_INTERVAL_S = 0.1

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    if (sampleRate !== 16000) throw new Error('Capture requires 16kHz audio')
    this.samples = new Int16Array(CHUNK_SAMPLES)
    this.offset = 0
    // Meter accumulators are independent of the PCM chunk boundary.
    this.meterSum = 0
    this.meterCount = 0
    this.meterPeak = 0
    this.nextMeterAt = 0
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true
    for (let i = 0; i < input.length; i++) {
      const sample = Number.isFinite(input[i]) ? Math.max(-1, Math.min(1, input[i])) : 0
      this.samples[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767
      this.meterSum += sample * sample
      this.meterPeak = Math.max(this.meterPeak, Math.abs(sample))
      if (this.offset === CHUNK_SAMPLES) {
        const pcm = this.samples.buffer
        this.port.postMessage({ pcm }, [pcm])
        this.samples = new Int16Array(CHUNK_SAMPLES)
        this.offset = 0
      }
    }
    this.meterCount += input.length
    // The meter runs on its own clock so a 100ms chunk never gates level updates.
    if (currentTime >= this.nextMeterAt) {
      this.nextMeterAt = currentTime + METER_INTERVAL_S
      this.port.postMessage({
        rms: this.meterCount > 0 ? Math.sqrt(this.meterSum / this.meterCount) : 0,
        peak: this.meterPeak,
      })
      this.meterSum = 0
      this.meterCount = 0
      this.meterPeak = 0
    }
    // Outputs are left silent: microphone audio must never play through speakers.
    return true
  }
}
registerProcessor('kairo-pcm-capture', PcmCaptureProcessor)

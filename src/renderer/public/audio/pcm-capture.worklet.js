/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Served as a separate module so the app's script-src 'self' policy stays intact.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    if (sampleRate !== 16000) throw new Error('Capture requires 16kHz audio')
    this.samples = new Int16Array(512) // 32ms, independent of render quantum size
    this.offset = 0
    this.sum = 0
    this.peak = 0
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true
    for (let i = 0; i < input.length; i++) {
      const sample = Number.isFinite(input[i]) ? Math.max(-1, Math.min(1, input[i])) : 0
      this.samples[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767
      this.sum += sample * sample
      this.peak = Math.max(this.peak, Math.abs(sample))
      if (this.offset === this.samples.length) {
        const pcm = this.samples.buffer
        this.port.postMessage({ pcm, rms: Math.sqrt(this.sum / this.offset), peak: this.peak }, [pcm])
        this.samples = new Int16Array(512)
        this.offset = 0
        this.sum = 0
        this.peak = 0
      }
    }
    // Outputs are left silent: microphone audio must never play through speakers.
    return true
  }
}
registerProcessor('kairo-pcm-capture', PcmCaptureProcessor)

import type { AudioLevel } from '@shared/ipc'

interface CaptureOptions {
  deviceId: string
  workletUrl: string
  onPCM: (pcm: ArrayBuffer) => void
  onLevel: (level: AudioLevel) => void
  onError: (error: Error) => void
}

/** Each effect owns its resources, including while asynchronous setup is pending. */
export function createAudioCapture(options: CaptureOptions): { ready: Promise<boolean>; stop: () => void } {
  let stopped = false
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: AudioWorkletNode | undefined

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (processor) {
      processor.port.onmessage = null
      processor.onprocessorerror = null
      processor.port.close()
      processor.disconnect()
    }
    source?.disconnect()
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }
  const fail = (error: unknown): void => {
    if (stopped) return
    stop()
    options.onError(error instanceof Error ? error : new Error(String(error)))
  }

  const ready = (async () => {
    try {
      const constraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      }
      if (options.deviceId && options.deviceId !== 'default') {
        constraints.deviceId = { exact: options.deviceId }
      }
      let acquired: MediaStream
      try {
        acquired = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      } catch (error) {
        // The device vanished between selection and capture — unplugged, or a
        // saved id that predates renderer-side enumeration. `exact` rejects, so
        // retry on the default input rather than failing the whole session.
        const name = (error as Error)?.name
        const recoverable =
          constraints.deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')
        if (!recoverable) throw error
        console.warn(
          `[capture] Audio device "${options.deviceId}" is unavailable; using the system default.`,
        )
        delete constraints.deviceId
        acquired = await navigator.mediaDevices.getUserMedia({ audio: constraints })
      }
      if (stopped) { acquired.getTracks().forEach((track) => track.stop()); return false }
      stream = acquired
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => fail(new Error('Audio input disconnected'))
      })
      context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
      if (context.sampleRate !== 16000) throw new Error('Audio input could not initialize at 16kHz')
      await context.audioWorklet.addModule(options.workletUrl)
      if (stopped) return false
      processor = new AudioWorkletNode(context, 'kairo-pcm-capture', {
        numberOfInputs: 1, numberOfOutputs: 1,
        channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      })
      // The worklet posts two independent message shapes: a 100ms PCM chunk
      // (transferred) and a ~10Hz meter update. Neither gates the other.
      processor.port.onmessage = (
        event: MessageEvent<{ pcm: ArrayBuffer } | { rms: number; peak: number }>,
      ) => {
        if (stopped) return
        const data = event.data
        if ('pcm' in data) {
          options.onPCM(data.pcm)
          return
        }
        const { rms, peak } = data
        options.onLevel({ rms, peak, clipping: peak > 0.99, timestamp: Date.now() })
      }
      processor.onprocessorerror = () => fail(new Error('Audio capture processor failed'))
      source = context.createMediaStreamSource(stream)
      source.connect(processor)
      processor.connect(context.destination)
      await context.resume()
      return !stopped
    } catch (error) {
      fail(error)
      throw error
    }
  })()
  return { ready, stop }
}

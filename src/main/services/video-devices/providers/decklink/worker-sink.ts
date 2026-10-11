import { Worker } from 'node:worker_threads'
import type { VideoOutputSink } from '../../provider'
import type { PlaybackWorkerCommand, PlaybackWorkerData, PlaybackWorkerEvent, RingStatus } from './worker-protocol'

/** The slice of `Worker` this sink uses — tests pass a double. */
export interface PlaybackWorkerLike {
  postMessage(command: PlaybackWorkerCommand, transfer?: ArrayBuffer[]): void
  on(event: 'message', listener: (event: PlaybackWorkerEvent) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

const STARTUP_TIMEOUT_MS = 10_000
const CLOSE_TIMEOUT_MS = 5_000

/**
 * Main-thread side of DeckLink playback. The only per-frame main-thread work is
 * one copy into a transferable buffer; the pipe to the helper lives in a worker.
 * At most one frame is in flight — while the worker is busy, only the newest
 * waiting frame is kept, so a slow pipe drops frames instead of queueing them.
 */
export function openWorkerPlayback(
  workerPath: string,
  data: PlaybackWorkerData,
  createWorker: (path: string, data: PlaybackWorkerData) => PlaybackWorkerLike =
    (path, workerData) => new Worker(path, { workerData }),
): Promise<VideoOutputSink & { ringStatus: RingStatus }> {
  const worker = createWorker(workerPath, data)
  return new Promise((resolve, reject) => {
    let started = false, closed = false, exited = false
    let failure: Error | null = null
    let hardware: import('../../../../../lib/video-devices').VideoPlaybackDiagnostics | null = null
    let inFlight = false
    let waiting: Extract<PlaybackWorkerCommand, { type: 'frame' }> | null = null
    let closing: Promise<void> | null = null
    let closeDone: (() => void) | null = null
    const listeners = new Set<(error: Error) => void>()

    const send = (frame: Extract<PlaybackWorkerCommand, { type: 'frame' }>): void => {
      inFlight = true
      worker.postMessage(frame, [frame.data])
    }
    const fail = (error: Error): void => {
      if (failure || closed) return
      failure = error
      waiting = null
      clearTimeout(timer)
      if (!started) { reject(error); void worker.terminate(); return }
      for (const listener of listeners) {
        try { listener(error) } catch { /* Isolate subscribers. */ }
      }
    }
    const timer = setTimeout(() => fail(new Error('DeckLink helper startup timed out')), STARTUP_TIMEOUT_MS)

    const sink: VideoOutputSink & { ringStatus: RingStatus } = {
      ringStatus: null,
      diagnostics: () => hardware ? { ...hardware } : null,
      setFrame(frame, width, height) {
        if (failure) throw failure
        if (closed) throw new Error('DeckLink output closed')
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
          frame.length !== width * height * 4) {
          throw new Error('Invalid BGRA frame dimensions or byte length')
        }
        // Callers may reuse their buffer, so retain a copy — transferred, not cloned, to the worker.
        const copy = new ArrayBuffer(frame.length)
        new Uint8Array(copy).set(frame)
        const command = { type: 'frame' as const, width, height, data: copy }
        if (inFlight) waiting = command
        else send(command)
      },
      onError(listener) {
        listeners.add(listener)
        if (failure) listener(failure)
        return () => { listeners.delete(listener) }
      },
      close() {
        if (closing) return closing
        closed = true
        waiting = null
        listeners.clear()
        clearTimeout(timer)
        closing = new Promise<void>((done) => {
          if (exited) { done(); return }
          const force = setTimeout(() => { void worker.terminate() }, CLOSE_TIMEOUT_MS)
          // The helper has released the port; end the worker even if a handle lingers.
          closeDone = () => { closeDone = null; clearTimeout(force); void worker.terminate(); done() }
          worker.postMessage({ type: 'close' })
        })
        return closing
      },
    }

    worker.on('message', (event) => {
      if (event.type === 'started' && !started && !failure) {
        started = true
        sink.ringStatus = event.ring ?? null
        clearTimeout(timer)
        resolve(sink)
      } else if (event.type === 'stats') {
        hardware = event.diagnostics
      } else if (event.type === 'ack') {
        inFlight = false
        const next = waiting
        waiting = null
        if (next && !closed && !failure) send(next)
      } else if (event.type === 'error') {
        fail(new Error(event.reason))
      } else if (event.type === 'closed') {
        closeDone?.()
      }
    })
    worker.on('error', fail)
    worker.on('exit', () => {
      exited = true
      closeDone?.()
      fail(new Error('DeckLink playback worker exited'))
    })
  })
}

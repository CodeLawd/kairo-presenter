import type { VideoPlaybackDiagnostics } from '../../../../../lib/video-devices'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export interface PlaybackSink {
  diagnostics(): VideoPlaybackDiagnostics | null
  setFrame(frame: Buffer, width: number, height: number): void
  onError(listener: (error: Error) => void): () => void
  close(): Promise<void>
}
/** Prototype transport. SDK work and frame repeat always stay in the helper. */
export function createPlaybackSink(child: ChildProcessWithoutNullStreams, timeoutMs = 10000, cleanupMs = 4000): Promise<PlaybackSink> {
  return new Promise((resolve, reject) => {
    let ready = false, closing = false, exited = false, waitingDrain = false
    let failure: Error | null = null, newest: Buffer | null = null
    let hardware: VideoPlaybackDiagnostics | null = null
    let lines = '', diagnostics = '', closingPromise: Promise<void> | null = null
    const listeners = new Set<(error: Error) => void>()
    const fail = (error: Error): void => {
      if (closing || failure) return
      failure = error; newest = null; clearTimeout(timer)
      if (!ready) reject(error)
      for (const listener of listeners) { try { listener(error) } catch { /* Isolate subscribers. */ } }
      if (!exited) {
        const killTimer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, cleanupMs)
        child.once('exit', () => clearTimeout(killTimer))
        child.kill()
      }
    }
    const timer = setTimeout(() => fail(new Error('DeckLink helper startup timed out')), timeoutMs)
    const write = (packet: Buffer): void => {
      waitingDrain = !child.stdin.write(packet)
    }
    child.stdin.on('drain', () => {
      waitingDrain = false
      if (!closing && !failure && newest) { const packet = newest; newest = null; write(packet) }
    })
    child.stdin.on('error', fail)
    child.on('error', fail)
    child.stderr.on('data', (data: Buffer) => { diagnostics = (diagnostics + data.toString()).slice(-4096) })
    child.on('exit', (code, signal) => {
      exited = true; clearTimeout(timer)
      fail(new Error(diagnostics.trim() || `DeckLink helper exited (${signal || code})`))
    })
    const sink: PlaybackSink = {
      diagnostics: () => hardware ? { ...hardware } : null,
      setFrame(frame, width, height) {
        if (failure) throw failure
        if (closing || exited) throw new Error('DeckLink output closed')
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 2160 || frame.length !== width * height * 4) throw new Error('Invalid BGRA frame dimensions or byte length')
        // Copy now, even if the pipe is backed up. Keep at most one unsent frame.
        const packet = Buffer.allocUnsafe(12 + frame.length)
        packet.writeUInt32LE(width, 0); packet.writeUInt32LE(height, 4); packet.writeUInt32LE(frame.length, 8)
        frame.copy(packet, 12)
        if (waitingDrain) newest = packet
        else write(packet)
      },
      onError(listener) {
        listeners.add(listener)
        if (failure) listener(failure)
        return () => { listeners.delete(listener) }
      },
      close() {
        if (closingPromise) return closingPromise
        closing = true; newest = null; listeners.clear(); clearTimeout(timer)
        closingPromise = new Promise<void>((done) => {
          if (exited) { done(); return }
          // EOF lets the helper stop scheduled playback and release the port.
          const killTimer = setTimeout(() => child.kill('SIGKILL'), 4000)
          child.once('exit', () => { clearTimeout(killTimer); done() })
          child.stdin.end()
        })
        return closingPromise
      },
    }
    child.stdout.on('data', (data: Buffer) => {
      lines += data.toString()
      if (lines.length > 65536) { fail(new Error('Invalid DeckLink helper response')); return }
      let end: number
      while ((end = lines.indexOf('\n')) >= 0) {
        const line = lines.slice(0, end); lines = lines.slice(end + 1)
        try {
          const event = JSON.parse(line) as Partial<VideoPlaybackDiagnostics> & { event?: string; reason?: string }
          if (event.event === 'started' && !ready && !failure) { ready = true; clearTimeout(timer); resolve(sink) }
          if (event.event === 'stats' && ['completed', 'late', 'dropped', 'repeated', 'received', 'outputFps'].every((key) => {
            const value = event[key as keyof VideoPlaybackDiagnostics]
            return typeof value === 'number' && Number.isFinite(value) && value >= 0
          })) {
            hardware = { completed: event.completed!, late: event.late!, dropped: event.dropped!, repeated: event.repeated!, received: event.received!, outputFps: event.outputFps! }
          }
          if (event.event === 'error') fail(new Error(event.reason || 'DeckLink playback failed'))
        } catch { fail(new Error('Invalid DeckLink helper response')) }
      }
    })
  })
}

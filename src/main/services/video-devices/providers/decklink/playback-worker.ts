// Worker entry (built as its own main-process chunk — see electron.vite.config.ts).
// Owns the DeckLink helper process and its pipe. Each frame is ~8 MB; copying
// and writing that down a pipe from Electron's main loop starved the UI and the
// paint events feeding the card, which made output choppy.
import { spawn } from 'node:child_process'
import { parentPort, workerData } from 'node:worker_threads'
import { createPlaybackSink, type PlaybackSink } from './client'
import type { PlaybackWorkerCommand, PlaybackWorkerData, PlaybackWorkerEvent } from './worker-protocol'

const port = parentPort!
const { helperPath, portId, modeId } = workerData as PlaybackWorkerData
const post = (event: PlaybackWorkerEvent): void => port.postMessage(event)
const reason = (error: unknown): string => error instanceof Error ? error.message : 'DeckLink playback failed'

let sink: PlaybackSink | null = null
let closing = false
let statsTimer: ReturnType<typeof setInterval> | null = null

const close = (): void => {
  if (closing) return
  closing = true
  if (statsTimer) clearInterval(statsTimer)
  void (sink?.close() ?? Promise.resolve()).finally(() => {
    post({ type: 'closed' })
    port.close()
  })
}

// Registered before the helper starts, so a close sent during startup is not lost.
port.on('message', (command: PlaybackWorkerCommand) => {
  if (command.type === 'close') { close(); return }
  if (!sink || closing) { post({ type: 'ack' }); return }
  try {
    sink.setFrame(Buffer.from(command.data), command.width, command.height)
  } catch (error) {
    post({ type: 'error', reason: reason(error) })
  }
  post({ type: 'ack' })
})

createPlaybackSink(spawn(helperPath, ['--play', portId, modeId], { stdio: 'pipe' })).then((started) => {
  sink = started
  if (closing) { void started.close(); return }
  started.onError((error) => post({ type: 'error', reason: error.message }))
  post({ type: 'started' })
  statsTimer = setInterval(() => {
    const diagnostics = sink?.diagnostics()
    if (diagnostics) post({ type: 'stats', diagnostics })
  }, 1000)
}, (error) => {
  post({ type: 'error', reason: reason(error) })
  close()
})

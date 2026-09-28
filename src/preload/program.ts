import { contextBridge, ipcRenderer } from 'electron'

// Must equal PROGRAM.NDI_AUDIO in src/lib/program.ts. Written out rather than
// imported: this preload runs sandboxed, and a shared import makes the bundler
// emit a chunk that a sandboxed preload cannot `require`.
const NDI_AUDIO_CHANNEL = 'program:ndiAudio'

// ─── Program-window preload (NDI surfaces only) ───────────────────────────────
// The program page gets exactly one capability: handing blocks of program sound
// to the main process for its NDI sender. Nothing else from `window.api` is
// exposed — this page renders operator-supplied media and text.

contextBridge.exposeInMainWorld('kairoProgram', {
  /** Planar float32 PCM: `channels` runs of `samples` values each. */
  sendAudio(block: { sampleRate: number; channels: number; samples: number; data: Float32Array }): void {
    if (!block || !(block.data instanceof Float32Array)) return
    ipcRenderer.send(NDI_AUDIO_CHANNEL, {
      sampleRate: block.sampleRate,
      channels: block.channels,
      samples: block.samples,
      data: block.data,
    })
  },
})

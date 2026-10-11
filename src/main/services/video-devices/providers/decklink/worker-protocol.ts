/** Messages between Electron's main thread and the DeckLink playback worker. */

export interface PlaybackWorkerData {
  helperPath: string
  portId: string
  modeId: string
  /** GPU frame ring (plan 008): start the helper with `--play-shm` reading it. */
  ringName?: string
}

/** Whether the helper attached the GPU frame ring; null when none was offered. */
export type RingStatus = { ok: true } | { ok: false; reason: string } | null

export type PlaybackWorkerCommand =
  | { type: 'frame'; width: number; height: number; data: ArrayBuffer }
  | { type: 'close' }

export type PlaybackWorkerEvent =
  | { type: 'started'; ring?: RingStatus }
  | { type: 'stats'; diagnostics: import('../../../../../lib/video-devices').VideoPlaybackDiagnostics }
  /** The worker has handed the last frame to the helper pipe; send the next. */
  | { type: 'ack' }
  | { type: 'error'; reason: string }
  | { type: 'closed' }

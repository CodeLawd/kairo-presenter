/** Messages between Electron's main thread and the DeckLink playback worker. */

export interface PlaybackWorkerData {
  helperPath: string
  portId: string
  modeId: string
}

export type PlaybackWorkerCommand =
  | { type: 'frame'; width: number; height: number; data: ArrayBuffer }
  | { type: 'close' }

export type PlaybackWorkerEvent =
  | { type: 'started' }
  | { type: 'stats'; diagnostics: import('../../../../../lib/video-devices').VideoPlaybackDiagnostics }
  /** The worker has handed the last frame to the helper pipe; send the next. */
  | { type: 'ack' }
  | { type: 'error'; reason: string }
  | { type: 'closed' }

/** Serializable hardware inventory shared across the IPC boundary. */
export interface VideoMode {
  id: string
  label: string
  width: number
  height: number
  frameRateN: number
  frameRateD: number
  interlaced: boolean
}
export interface VideoPort {
  id: string
  provider: string
  deviceName: string
  portName: string
  modes: VideoMode[]
  supportsKeyFill: boolean
  unavailableReason: string | null
}
export interface VideoProviderStatus {
  available: boolean
  version?: string
  reason?: string
}
export type VideoTestPattern = 'bars' | 'text' | 'motion'
export interface VideoPlaybackDiagnostics {
  completed: number
  late: number
  dropped: number
  /** Frames scheduled again without a newer input image. Expected for still slides. */
  repeated: number
  received: number
  outputFps: number
}
export interface VideoOutputState {
  ready: boolean
  reason: string
  testPattern?: VideoTestPattern | null
  diagnostics?: { capturedFrames: number; captureFps: number; hardware: VideoPlaybackDiagnostics | null }
}
export interface VideoDeviceSnapshot {
  ports: VideoPort[]
  providers: (VideoProviderStatus & { name: string })[]
  outputs: Record<string, VideoOutputState>
}

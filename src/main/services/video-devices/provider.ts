import type { VideoPort, VideoProviderStatus } from '../../../lib/video-devices'
export type { VideoMode, VideoPort, VideoProviderStatus } from '../../../lib/video-devices'

export interface VideoOutputSink {
  diagnostics?(): import('../../../lib/video-devices').VideoPlaybackDiagnostics | null
  /** Full frames per second from the selected hardware mode (not field rate). */
  frameRate?: number
  /**
   * Replace the frame repeated on the hardware clock. Top-down BGRA.
   * The provider must retain immutable bytes before returning; callers may reuse
   * their buffer. Conversion and scheduling must not depend on JS paint timing.
   */
  setFrame(bgra: Buffer, width: number, height: number): void
  /**
   * GPU capture path (plan 008): a shared-memory ring of UYVY frames at the
   * output raster that the provider's reader repeats on the hardware clock.
   * Absent when the provider has no such path; `setFrame` always still works.
   */
  frameRing?: import('../gpu-frames').FrameRing | null
  /** Asynchronous driver/helper failure; revoke readiness immediately. */
  onError?(listener: (error: Error) => void): () => void
  /** Release scheduled frames and ports; repeated close must be safe. */
  close(): Promise<void>
}

export interface VideoDeviceProvider {
  readonly name: string
  status(): VideoProviderStatus
  listPorts(): Promise<VideoPort[]>
  onPortsChanged?(listener: () => void): () => void
  openOutput(portId: string, modeId: string, opts: { keyFill: boolean }): Promise<VideoOutputSink>
}

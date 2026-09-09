import type { AudioDevice } from '@shared/ipc'

/**
 * The one source of audio input devices. IDs here are real
 * MediaDeviceInfo.deviceId values, so they can be passed straight to
 * getUserMedia({ audio: { deviceId: { exact: id } } }).
 *
 * The previous main-process enumerator returned CoreAudio labels from
 * system_profiler, which getUserMedia rejects with OverconstrainedError.
 */
const DEFAULT_DEVICE: AudioDevice = {
  id: 'default',
  label: 'System Default',
  kind: 'audioinput',
  isDefault: true,
}

/**
 * Before microphone permission is granted, Chromium reports audioinput entries
 * with an empty deviceId and an empty label. Those cannot be used as a
 * constraint, so they are dropped and the caller falls back to the system
 * default (which capture.ts passes through without an exact constraint).
 */
export async function listAudioInputDevices(): Promise<AudioDevice[]> {
  let all: MediaDeviceInfo[]
  try {
    all = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return [DEFAULT_DEVICE]
  }

  const inputs = all
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== '')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
      kind: 'audioinput' as const,
      isDefault: device.deviceId === 'default',
    }))

  if (inputs.length === 0) return [DEFAULT_DEVICE]
  if (!inputs.some((device) => device.isDefault)) inputs[0].isDefault = true
  return inputs
}

/**
 * Picks the device id to capture from, preferring a saved choice that is still
 * present. A saved id goes stale whenever a microphone is unplugged, or when it
 * predates renderer-side enumeration and still holds a CoreAudio label.
 *
 * `devices` is expected to come from listAudioInputDevices(), which never
 * returns an empty list and always marks one entry default.
 */
export function resolveCaptureDeviceId(devices: AudioDevice[], savedId?: string): string {
  if (savedId && devices.some((device) => device.id === savedId)) return savedId
  return (devices.find((device) => device.isDefault) ?? devices[0]).id
}

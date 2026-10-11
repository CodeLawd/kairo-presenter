import type { VideoDeviceProvider } from './provider'

/** Registrations supply lazy factories; importing this module never loads native code. */
export interface VideoProviderRegistration {
  name: string
  tuples: readonly string[]
  load: () => VideoDeviceProvider
}

export type VideoProviderLoadCode = 'unsupported-tuple' | 'runtime-unavailable' | 'load-failed'

export type VideoProviderLoadResult =
  | { ok: true; provider: VideoDeviceProvider }
  | { ok: false; providerName: string; code: VideoProviderLoadCode; reason: string }

/** Contains JS exceptions only. Native crash containment needs a process boundary. */
export function loadVideoDeviceProvider(
  registration: VideoProviderRegistration,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): VideoProviderLoadResult {
  const unavailable = (code: VideoProviderLoadCode, reason: string): VideoProviderLoadResult => ({ ok: false, providerName: registration.name, code, reason })
  if (!registration.tuples.includes(`${platform}:${arch}`)) {
    return unavailable('unsupported-tuple', `Unsupported platform/architecture: ${platform}/${arch}`)
  }
  try {
    const provider = registration.load()
    const status = provider.status()
    if (!status.available) return unavailable('runtime-unavailable', status.reason || 'Video device runtime unavailable')
    return { ok: true, provider }
  } catch (error) {
    return unavailable('load-failed', error instanceof Error ? error.message : 'Video device provider failed to load')
  }
}

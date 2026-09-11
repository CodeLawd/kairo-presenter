import type { SessionDeviceInfo } from './schemas/session.schema'

export type DeviceSnapshot = Partial<SessionDeviceInfo> & { name?: string }

export function mergeDeviceInfo(
  previous: Partial<SessionDeviceInfo> | null | undefined,
  incoming: DeviceSnapshot | null | undefined,
): SessionDeviceInfo {
  const pick = (key: keyof SessionDeviceInfo): string =>
    incoming?.[key]?.trim() || previous?.[key]?.trim() || ''
  return {
    hostname: pick('hostname'),
    os: pick('os'),
    osVersion: pick('osVersion'),
    arch: pick('arch'),
    appVersion: pick('appVersion'),
    electronVersion: pick('electronVersion'),
  }
}

/**
 * Best-effort fill for booths that signed in before we stored a device snapshot.
 * Electron's Chromium UA has OS, arch, app, and Electron version; axios's own
 * UA has none of that and is ignored.
 */
export function inferDeviceFromUserAgent(userAgent: string | null | undefined): DeviceSnapshot {
  const ua = userAgent?.trim()
  if (!ua || /^axios\//i.test(ua)) return {}

  const electronVersion = ua.match(/\bElectron\/(\d+(?:\.\d+)*)/i)?.[1]
  const appVersion = ua.match(/\bKairo\/(\d+(?:\.\d+)*)/i)?.[1]
  const darwin = ua.match(/Macintosh;.*Mac OS X (\d+[._]\d+(?:[._]\d+)?)/i)
  const windows = ua.match(/Windows NT (\d+(?:\.\d+)?)/i)
  const linux = /\bLinux\b/i.test(ua) && !darwin && !windows

  let os = ''
  let osVersion = ''
  if (darwin) {
    os = 'darwin'
    osVersion = darwin[1].replace(/_/g, '.')
  } else if (windows) {
    os = 'win32'
    osVersion = windows[1]
  } else if (linux) {
    os = 'linux'
  }

  let arch = ''
  if (/\barm64|aarch64\b/i.test(ua)) arch = 'arm64'
  else if (/\b(Win64|x64|x86_64|amd64)\b/i.test(ua)) arch = 'x64'
  else if (/\bIntel\b/i.test(ua) && os === 'darwin') arch = 'x64'

  return { os, osVersion, arch, appVersion, electronVersion }
}

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function osLabel(os: string | null | undefined): string | null {
  if (!os) return null
  if (os === 'darwin') return 'macOS'
  if (os === 'win32') return 'Windows'
  if (os === 'linux') return 'Linux'
  return os
}

export function displayDeviceName(input: {
  hostname?: string
  deviceName?: string
}): string {
  const host = input.hostname?.trim().replace(/\.local$/i, '')
  if (host) return host
  if (input.deviceName?.trim()) return input.deviceName.trim()
  return 'Desktop app'
}

/** A booth that refreshed within this window is treated as online. */
export const DEVICE_ONLINE_MS = 15 * 60_000

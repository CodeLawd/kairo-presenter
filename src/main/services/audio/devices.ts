import { exec } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log/main'
import type { AudioDevice } from '@shared/ipc'

const execAsync = promisify(exec)

// ─── Timeout wrapper ──────────────────────────────────────────────────────────

async function execWithTimeout(cmd: string, timeoutMs = 5_000): Promise<string> {
  const { stdout } = await Promise.race([
    execAsync(cmd),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Command timed out: ${cmd}`)), timeoutMs)
    ),
  ])
  return stdout
}

// ─── macOS ────────────────────────────────────────────────────────────────────

interface SPAudioItem {
  _name: string
  coreaudio_default_audio_input_device?: string
  coreaudio_device_input?: string
  coreaudio_device_srate?: number | string
  coreaudio_device_manufacturer?: string
  coreaudio_input_source?: string
  coreaudio_output_source?: string
  _items?: SPAudioItem[]
}

interface SPAudioDataType {
  SPAudioDataType: SPAudioItem[]
}

async function listDevicesMac(): Promise<AudioDevice[]> {
  try {
    const raw = await execWithTimeout('system_profiler SPAudioDataType -json')
    const parsed = JSON.parse(raw) as SPAudioDataType

    let items = parsed.SPAudioDataType ?? []
    // On modern macOS, system_profiler wraps the actual device list in a nested _items array
    if (items.length > 0 && items[0]._items) {
      items = items[0]._items
    }

    const devices: AudioDevice[] = []

    for (const item of items) {
      const inputChannels = parseInt((item.coreaudio_device_input ?? '0').toString(), 10)
      if (inputChannels === 0) continue // output-only device

      // Prefer coreaudio_input_source as the label (what sox/coreaudio uses)
      const label = item.coreaudio_input_source || item._name
      const isDefault =
        item.coreaudio_default_audio_input_device === 'yes' ||
        item.coreaudio_default_audio_input_device === 'spaudio_yes'

      devices.push({
        id: label, // sox uses AUDIODEV=label on macOS
        label,
        kind: 'audioinput',
        isDefault,
      })
    }

    if (devices.length === 0) {
      // Fallback: return a default device so the app isn't stuck
      devices.push({ id: 'default', label: 'System Default', kind: 'audioinput', isDefault: true })
    }

    return devices
  } catch (err) {
    log.warn('[AudioDevices] macOS enumeration failed', (err as Error).message)
    return [{ id: 'default', label: 'System Default', kind: 'audioinput', isDefault: true }]
  }
}

// ─── Windows ──────────────────────────────────────────────────────────────────

interface WinSoundDevice {
  Caption: string
  DeviceID: string
  Status: string
}

async function listDevicesWin(): Promise<AudioDevice[]> {
  try {
    const ps = `Get-CimInstance Win32_SoundDevice | Where-Object { $_.DeviceType -eq 'Audio' -or $_.Caption -match 'Microphone|Input|Capture' } | Select-Object Caption, DeviceID, Status | ConvertTo-Json`
    const raw = await execWithTimeout(`powershell -NoProfile -Command "${ps}"`)

    let items: WinSoundDevice | WinSoundDevice[] = JSON.parse(raw)
    if (!Array.isArray(items)) items = [items]

    return items.map((item, i) => ({
      id: item.DeviceID ?? `win-${i}`,
      label: item.Caption ?? `Audio Device ${i + 1}`,
      kind: 'audioinput' as const,
      isDefault: i === 0,
    }))
  } catch (err) {
    log.warn('[AudioDevices] Windows enumeration failed', (err as Error).message)
    return [{ id: 'default', label: 'System Default', kind: 'audioinput', isDefault: true }]
  }
}

// ─── Linux ────────────────────────────────────────────────────────────────────

// Parses lines like:
//   card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]
const ARECORD_RE = /card (\d+): (\S+) \[([^\]]+)\], device (\d+): ([^[]+)/

async function listDevicesLinux(): Promise<AudioDevice[]> {
  try {
    const raw = await execWithTimeout('arecord -l 2>&1')
    const devices: AudioDevice[] = []

    for (const line of raw.split('\n')) {
      const m = line.match(ARECORD_RE)
      if (!m) continue
      const card = m[1]
      const device = m[4]
      const label = m[3].trim()
      const id = `hw:${card},${device}`
      devices.push({
        id,
        label: `${label} (${id})`,
        kind: 'audioinput',
        isDefault: devices.length === 0,
      })
    }

    if (devices.length === 0) {
      devices.push({ id: 'default', label: 'System Default', kind: 'audioinput', isDefault: true })
    }

    return devices
  } catch (err) {
    log.warn('[AudioDevices] Linux enumeration failed', (err as Error).message)
    return [{ id: 'default', label: 'System Default', kind: 'audioinput', isDefault: true }]
  }
}

// ─── Public ───────────────────────────────────────────────────────────────────

export async function listAudioInputDevices(): Promise<AudioDevice[]> {
  switch (process.platform) {
    case 'darwin': return listDevicesMac()
    case 'win32':  return listDevicesWin()
    default:       return listDevicesLinux()
  }
}

/** Returns the ID of the first isDefault=true device, or the first device, or 'default'. */
export function getDefaultDeviceId(devices: AudioDevice[]): string {
  return (devices.find((d) => d.isDefault) ?? devices[0])?.id ?? 'default'
}

/**
 * The app's one capture service, wired to Electron: the recorder addon, the
 * saved settings, the outputs' surfaces, the Movies folder and the microphone
 * permission. The behaviour lives in `./recorder`.
 */
import { app, systemPreferences } from 'electron'
import log from 'electron-log/main'
import { mkdir, statfs } from 'node:fs/promises'
import path from 'node:path'
import { PRODUCT_NAME } from '@shared/brand'
import { normalizeCaptureSettings } from '@shared/capture'
import { normalizeOverlaySettings } from '@shared/overlay-defaults'
import { store } from '../../db'
import { surfaceManager } from '../output/surface-manager'
import { CaptureService, type RecorderAddon, type RecorderLoad } from './recorder'

export { CaptureService } from './recorder'

type RequireFn = (id: string) => unknown

/** Where the built addon lives: packaged resources first, then the dev build. */
export function recorderCandidates(resourcesPath: string | undefined = process.resourcesPath, cwd = process.cwd()): string[] {
  return [
    ...(resourcesPath ? [path.join(resourcesPath, 'recorder', 'recorder.node')] : []),
    path.join(cwd, 'native', 'recorder', 'build', 'recorder.node'),
  ]
}

export function loadRecorder(
  requireFn: RequireFn = require,
  platform: NodeJS.Platform = process.platform,
  candidates: string[] = recorderCandidates(),
): RecorderLoad {
  if (platform !== 'darwin') return { ok: false, reason: 'Recording is only available on a Mac for now' }
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const addon = requireFn(candidate) as RecorderAddon
      const status = addon.available()
      if (!status.ok) return { ok: false, reason: status.reason ?? 'Metal unavailable' }
      return { ok: true, addon }
    } catch (error) {
      errors.push(`${candidate}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  return { ok: false, reason: `Recorder not loaded (${errors.join('; ')})` }
}

let cached: RecorderLoad | null = null

function recorderAddon(): RecorderLoad {
  if (cached) return cached
  try {
    cached = loadRecorder()
  } catch (error) {
    cached = { ok: false, reason: `loader threw: ${(error as Error).message}` }
  }
  if (cached.ok) log.info('[Capture] recorder loaded')
  else log.info('[Capture] unavailable', { reason: cached.reason })
  return cached
}

export const captureService = new CaptureService({
  load: recorderAddon,
  settings: () => normalizeCaptureSettings(store.get('capture')),
  outputs: () => normalizeOverlaySettings(store.get('overlay')).outputs,
  attach: (outputId, tap) => surfaceManager.setCaptureTap(outputId, tap),
  sourceAspect: (outputId) => surfaceManager.captureSource(outputId)?.aspect ?? null,
  defaultFolder: () => path.join(app.getPath('videos'), PRODUCT_NAME),
  ensureFolder: async (folder) => { await mkdir(folder, { recursive: true }) },
  freeBytes: async (folder) => {
    const stats = await statfs(folder)
    return stats.bavail * stats.bsize
  },
  microphoneAccess: async () => {
    if (process.platform !== 'darwin') return true
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    if (status === 'denied' || status === 'restricted') return false
    return systemPreferences.askForMediaAccess('microphone')
  },
  now: () => Date.now(),
})

/** The folder recordings go to now — for "Show in Finder" before anything is recorded. */
export function captureFolder(): string {
  return normalizeCaptureSettings(store.get('capture')).folder || path.join(app.getPath('videos'), PRODUCT_NAME)
}

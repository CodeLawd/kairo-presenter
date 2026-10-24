/**
 * The app's one crash reporter, wired to Electron: the queue on disk, the
 * Privacy switch, the signed-in session and the log file. The behaviour lives
 * in `./reporter`.
 */
import { randomUUID } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import os from 'node:os'
import { app } from 'electron'
import Store from 'electron-store'
import log from 'electron-log/main'
import type { CrashReport } from '@shared/cloud/crashes'
import { store as settings } from '../../db'
import { cloudSession } from '../cloud/session'
import { setOutputCrashHook } from '../output/managed-window'
import { CrashReporter } from './reporter'

export { CrashReporter } from './reporter'

const FIRST_FLUSH_MS = 20_000
const FLUSH_EVERY_MS = 60 * 60 * 1000
/** Enough of the log for 200 lines, without reading a large file whole. */
const LOG_READ_BYTES = 256 * 1024

const queue = new Store<{ reports: CrashReport[] }>({ name: 'kairo-crash-reports', defaults: { reports: [] } })

/** The end of the log file. Sync is fine: it runs once, after a crash. */
function readLogEnd(): string {
  try {
    const file = log.transports.file.getFile().path
    const fd = openSync(file, 'r')
    try {
      const size = fstatSync(fd).size
      const length = Math.min(size, LOG_READ_BYTES)
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, size - length)
      return buffer.toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

function gpuStatus(): Record<string, string> {
  try {
    return { ...(app.getGPUFeatureStatus() as unknown as Record<string, string>) }
  } catch {
    return {}
  }
}

export const crashReports = new CrashReporter({
  load: () => queue.get('reports') ?? [],
  save: (reports) => queue.set('reports', reports),
  enabled: () => settings.get('usage')?.sendCrashReports !== false,
  canUpload: () => cloudSession.canUpload(),
  upload: (body) => cloudSession.reportCrashes(body),
  installId: () => cloudSession.usageDevice().installId,
  system: () => {
    const { installId: _installId, ...device } = cloudSession.usageDevice()
    return { ...device, memoryGb: Math.round(os.totalmem() / 1024 ** 3), gpu: gpuStatus() }
  },
  readLog: readLogEnd,
  home: os.homedir(),
  windows: process.platform === 'win32',
  now: () => Date.now(),
  newId: () => randomUUID(),
  warn: (message) => log.info(message),
})

/** Sends anything left from last time once the app has settled, then hourly. */
export function startCrashReports(): void {
  setOutputCrashHook((label, details) =>
    crashReports.record({ kind: 'renderer', process: label, reason: details.reason, exitCode: details.exitCode }),
  )
  crashReports.scheduleFlush(FIRST_FLUSH_MS)
  setInterval(() => void crashReports.flush(), FLUSH_EVERY_MS).unref?.()
}

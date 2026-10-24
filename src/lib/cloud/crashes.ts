/**
 * Crash summaries, shared by the desktop app (which collects and queues them)
 * and the API (which validates and stores them for the staff console).
 *
 * Unlike usage statistics these carry text: the end of the app's log and the
 * errors the window printed before it died. The log can name songs, files and
 * references, so summaries have their own switch in Settings, and the desktop
 * replaces the home folder in every path before anything is queued.
 */

/** What died: a window's page, or a helper process (GPU, audio…). */
export const CRASH_KINDS = ['renderer', 'child_process'] as const
export type CrashKind = (typeof CRASH_KINDS)[number]

export interface CrashSystem {
  os: string
  osVersion: string
  arch: string
  appVersion: string
  electronVersion: string
  memoryGb: number
  /** Chromium's GPU feature status (e.g. `gpu_compositing: enabled`) — crashes often hinge on it. */
  gpu: Record<string, string>
}

export interface CrashReport {
  /** Made by the desktop, so a re-sent report is stored once. */
  id: string
  kind: CrashKind
  /** Which process: `main-window`, an output's name, or Chromium's type (`GPU`, `Utility`…). */
  process: string
  /** Electron's reason: crashed, oom, launch-failed, abnormal-exit… */
  reason: string
  exitCode: number
  /** ISO time of the first crash, and of the latest when it repeated. */
  firstAt: string
  lastAt: string
  /** The same crash again within a minute counts here instead of a new report. */
  count: number
  system: CrashSystem
  /** Errors the window logged just before (newest last). */
  errors: string[]
  /** The end of the app's log at the latest crash. */
  log: string
}

/** POST /v1/crashes. */
export interface CrashUpload {
  installId: string
  reports: CrashReport[]
}

/** Report ids the API stored; the desktop drops them from its queue. */
export interface CrashUploadResult {
  accepted: string[]
}

export const CRASH_MAX_REPORTS = 10
export const CRASH_MAX_ERRORS = 20
export const CRASH_MAX_ERROR_CHARS = 1_000
export const CRASH_MAX_LOG_LINES = 200
export const CRASH_MAX_LOG_CHARS = 64_000
/** A crash that repeats inside this window joins the report before it. */
export const CRASH_REPEAT_MS = 60_000

/**
 * Replaces the user's home folder in `text` with `~`, in plain and in
 * JSON-escaped form (log lines print Windows paths with doubled backslashes),
 * ignoring case on Windows, where `C:\Users\ATS` and `c:\users\ats` are one.
 */
export function scrubHome(text: string, home: string, windows: boolean): string {
  if (!home) return text
  const forms = new Set([home, home.replace(/\\/g, '\\\\'), home.replace(/\\/g, '/')])
  let out = text
  for (const form of forms) {
    const pattern = new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), windows ? 'gi' : 'g')
    out = out.replace(pattern, '~')
  }
  return out
}

/** The last `maxLines` lines of `text`, no longer than `maxChars` (cut at a line start). */
export function logTail(text: string, maxLines = CRASH_MAX_LOG_LINES, maxChars = CRASH_MAX_LOG_CHARS): string {
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  let tail = lines.slice(-maxLines).join('\n')
  if (tail.length > maxChars) {
    tail = tail.slice(-maxChars)
    const cut = tail.indexOf('\n')
    if (cut >= 0) tail = tail.slice(cut + 1)
  }
  return tail
}

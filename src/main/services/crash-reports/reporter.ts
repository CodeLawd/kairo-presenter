import {
  CRASH_MAX_ERROR_CHARS,
  CRASH_MAX_ERRORS,
  CRASH_MAX_REPORTS,
  CRASH_REPEAT_MS,
  logTail,
  scrubHome,
  type CrashKind,
  type CrashReport,
  type CrashSystem,
  type CrashUpload,
  type CrashUploadResult,
} from '@shared/cloud/crashes'

export interface CrashDeps {
  /** The queue as saved on disk, oldest first. */
  load: () => CrashReport[]
  save: (reports: CrashReport[]) => void
  /** Settings → Privacy → Send crash reports. */
  enabled: () => boolean
  /** Signed in with a confirmed address, so an upload could go out now. */
  canUpload: () => boolean
  upload: (body: CrashUpload) => Promise<CrashUploadResult>
  installId: () => string
  system: () => CrashSystem
  /** The app's log file as text (or its end); '' when unreadable. */
  readLog: () => string
  home: string
  windows: boolean
  now: () => number
  newId: () => string
  warn: (message: string) => void
}

export interface CrashEvent {
  kind: CrashKind
  process: string
  reason: string
  exitCode: number
}

/**
 * Crash summaries: what died, how, the machine, the window's last errors and
 * the end of the log — queued on disk and sent to Kairo when signed in, so a
 * crash at a church reaches the staff console without anyone finding a log.
 *
 * A crash that repeats within a minute (a window reloading into the same
 * crash) joins the report before it, so a crash loop is one report, not ten.
 */
export class CrashReporter {
  private errors: string[] = []
  private flushing = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: CrashDeps) {}

  /** An error a window printed; the newest few go with the next crash. */
  noteError(text: string): void {
    this.errors.push(text.slice(0, CRASH_MAX_ERROR_CHARS))
    if (this.errors.length > CRASH_MAX_ERRORS) this.errors.splice(0, this.errors.length - CRASH_MAX_ERRORS)
  }

  /** Queues a summary of the crash and sends it shortly. Never throws. */
  record(event: CrashEvent): void {
    if (!this.deps.enabled()) return
    try {
      const at = new Date(this.deps.now()).toISOString()
      const scrub = (text: string): string => scrubHome(text, this.deps.home, this.deps.windows)
      const errors = this.errors.map(scrub)
      const log = scrub(logTail(this.deps.readLog()))
      const reports = this.deps.load()
      const last = reports.at(-1)
      if (
        last &&
        last.kind === event.kind &&
        last.process === event.process &&
        last.reason === event.reason &&
        last.exitCode === event.exitCode &&
        this.deps.now() - Date.parse(last.lastAt) < CRASH_REPEAT_MS
      ) {
        reports[reports.length - 1] = { ...last, lastAt: at, count: last.count + 1, errors, log }
      } else {
        reports.push({
          id: this.deps.newId(),
          kind: event.kind,
          process: event.process.slice(0, 64),
          reason: event.reason,
          exitCode: event.exitCode,
          firstAt: at,
          lastAt: at,
          count: 1,
          system: this.deps.system(),
          errors,
          log,
        })
      }
      this.deps.save(reports.slice(-CRASH_MAX_REPORTS))
      this.scheduleFlush(5_000)
    } catch (err) {
      this.deps.warn(`[Crashes] could not record: ${(err as Error).message}`)
    }
  }

  /** Sends the queue now (a short wait coalesces a burst of crashes into one request). */
  scheduleFlush(delayMs: number): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, delayMs)
    this.flushTimer.unref?.()
  }

  async flush(): Promise<void> {
    if (!this.deps.enabled()) {
      // Switched off: anything still queued is discarded, never sent later.
      if (this.deps.load().length > 0) this.deps.save([])
      return
    }
    if (this.flushing || !this.deps.canUpload()) return
    const reports = this.deps.load()
    if (reports.length === 0) return
    this.flushing = true
    try {
      const { accepted } = await this.deps.upload({ installId: this.deps.installId(), reports })
      const sent = new Set(accepted)
      const sentAt = new Map(reports.map((r) => [r.id, r.lastAt]))
      // Re-read: a crash recorded during the upload must not be lost, and a
      // report that grew meanwhile goes again (the API replaces it by id).
      this.deps.save(this.deps.load().filter((r) => !(sent.has(r.id) && sentAt.get(r.id) === r.lastAt)))
    } catch (err) {
      // Kept for the next try.
      this.deps.warn(`[Crashes] not sent: ${(err as Error).message}`)
    } finally {
      this.flushing = false
    }
  }
}

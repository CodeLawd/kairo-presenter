import type { BrowserWindow } from 'electron'
import log from 'electron-log/main'

/** Automatic rebuilds after a crash or hang allowed per `FAILURE_WINDOW_MS`. */
const MAX_FAILURES = 3
const FAILURE_WINDOW_MS = 60_000

// ─── Managed window ───────────────────────────────────────────────────────────
// The lifecycle every Kairo output window shares (program surfaces and stage
// displays): windows are created lazily and one at a time; a window that
// finishes loading after `close()` is thrown away; crashes and hangs of the
// live window are reported once to the subclass; a retry budget stops a page
// that dies on load from respawning forever; and a closed display window stays
// parked — nothing may reopen it until `restore()` — so a window is never
// placed on whatever display is left after its own was unplugged.

export abstract class ManagedWindow {
  protected win: BrowserWindow | null = null
  private creating: Promise<BrowserWindow | null> | null = null
  /** Bumped by `close()`, so a window still loading when it ran is discarded. */
  private generation = 0
  protected destroyed = false
  protected parked = false
  private failures: number[] = []

  constructor(
    readonly label: string,
    private readonly logTag: string,
  ) {}

  /** The native window, not yet loaded. */
  protected abstract build(): BrowserWindow
  /** Loads the page into `win`. */
  protected abstract load(win: BrowserWindow): Promise<void>
  /** `win` is loaded and current: push state and show it. */
  protected abstract ready(win: BrowserWindow): Promise<void>
  /** The live window crashed or hung. */
  protected abstract onFailure(reason: string): void | Promise<void>
  /** Display windows park on close; an offscreen one may reopen on its next paint. */
  protected parksOnClose(): boolean {
    return true
  }
  /** Drops per-window state (waiters, timers, last-sent caches) when the window goes. */
  protected onClosed(): void {}

  protected get isOpen(): boolean {
    return !!this.win && !this.win.isDestroyed()
  }

  /** The live window, creating it if needed; null while parked or destroyed. */
  protected async ensureWindow(): Promise<BrowserWindow | null> {
    if (this.destroyed || this.parked) return null
    if (this.win && !this.win.isDestroyed()) return this.win
    if (this.creating) return this.creating
    this.creating = this.createWindow()
    try {
      return await this.creating
    } finally {
      this.creating = null
    }
  }

  private async createWindow(): Promise<BrowserWindow | null> {
    const generation = this.generation
    const win = this.build()
    // Only the live window may report a failure — a window already replaced
    // (or destroyed by us) reporting its own death is not news.
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`[${this.logTag}] ${this.label} render process gone`, details)
      if (this.win === win) void this.onFailure('render process gone')
    })
    win.on('unresponsive', () => {
      log.warn(`[${this.logTag}] ${this.label} window unresponsive`)
      if (this.win === win) void this.onFailure('unresponsive')
    })
    await this.load(win)
    const stale = (): boolean => this.destroyed || generation !== this.generation
    if (!stale()) await this.ready(win)
    // Closed or destroyed while loading: nobody holds this window any more.
    if (stale() || win.isDestroyed()) {
      if (!win.isDestroyed()) win.destroy()
      return null
    }
    this.win = win
    log.info(`[${this.logTag}] ${this.label} window created`)
    return win
  }

  /**
   * Records a crash or hang. True while under the retry budget — the caller
   * rebuilds; false once exhausted — the caller should give up and close.
   */
  protected allowFailure(reason: string): boolean {
    const now = Date.now()
    this.failures = this.failures.filter((at) => now - at < FAILURE_WINDOW_MS)
    if (this.failures.length >= MAX_FAILURES) {
      log.error(`[${this.logTag}] ${this.label} keeps failing — not recreating again`, { reason })
      return false
    }
    this.failures.push(now)
    return true
  }

  /** Destroys the current window without parking — for an immediate rebuild. */
  protected dropWindow(): void {
    this.generation++
    this.onClosed()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  /** Closes the window; a display window stays parked until `restore()`. */
  close(): void {
    if (this.parksOnClose()) this.parked = true
    this.dropWindow()
  }

  /** Closes the window for good — no recovery, no further use. */
  destroy(): void {
    this.destroyed = true
    this.close()
  }
}

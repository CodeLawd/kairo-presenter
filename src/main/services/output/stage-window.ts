import type { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import stageHtml from './stage.html?asset'
import type { ProgramState, ProgramTimerStyle, StageDisplayConfig } from '@shared/program'
import { createDisplayWindow, needsRebuild, sameBounds, showDisplayWindow, type DisplaySink } from './display-window'
import { ManagedWindow } from './managed-window'

/** What the stage page renders — program state plus this display's toggles. */
type StageView = Pick<ProgramState, 'current' | 'next' | 'stageMessage' | 'timer'> &
  Pick<StageDisplayConfig, 'showNext' | 'showClock' | 'showTimer'> & { timerStyle: ProgramTimerStyle }

// ─── Stage display window (standalone phase 2, E5) ────────────────────────────
// A confidence monitor on its own display: current slide, next slide, clock,
// countdown and a stage-only message. It never takes part in output dispatch;
// it only mirrors `programService` state. Same display rules as a program
// screen: parked while its display is gone, rehearsal window on the control
// display.

export class StageWindow extends ManagedWindow {
  private view: StageView | null = null
  /** The view as last sent, so unrelated program changes cost nothing here. */
  private sentView = ''

  constructor(
    label: string,
    private sink: DisplaySink,
  ) {
    super(label, 'Stage')
  }

  async retarget(sink: DisplaySink): Promise<void> {
    const previous = this.sink
    this.sink = sink
    if (!this.win || !this.isOpen) return
    if (needsRebuild(previous, sink)) {
      this.dropWindow()
      await this.ensureWindow()
      return
    }
    if (!sameBounds(previous.bounds, sink.bounds)) showDisplayWindow(this.win, sink)
  }

  async update(view: StageView): Promise<void> {
    this.view = view
    if (this.win && this.isOpen) await this.push(this.win)
  }

  private async push(win: BrowserWindow): Promise<void> {
    if (!this.view || win.isDestroyed()) return
    const json = JSON.stringify(this.view)
    if (json === this.sentView) return
    this.sentView = json
    try {
      await win.webContents.executeJavaScript(`window.__setStage(${json})`)
    } catch (err) {
      log.warn(`[Stage] ${this.label} update failed`, (err as Error).message)
    }
  }

  // ─── ManagedWindow ──────────────────────────────────────────────────────────

  protected build(): BrowserWindow {
    return createDisplayWindow(this.label, this.sink)
  }

  protected async load(win: BrowserWindow): Promise<void> {
    await win.loadFile(stageHtml)
  }

  protected async ready(win: BrowserWindow): Promise<void> {
    showDisplayWindow(win, this.sink)
    await this.push(win)
  }

  protected override onClosed(): void {
    // A new window starts blank: the next update must be sent in full.
    this.sentView = ''
  }

  /** Rebuild while under the retry budget; otherwise stay closed until the next reconcile. */
  protected async onFailure(reason: string): Promise<void> {
    if (!this.allowFailure(reason)) {
      this.close()
      return
    }
    this.dropWindow()
    await this.ensureWindow()
  }

  /** Opens (or reopens) the window on its display. */
  async restore(): Promise<void> {
    if (this.destroyed) return
    this.parked = false
    await this.ensureWindow()
  }
}

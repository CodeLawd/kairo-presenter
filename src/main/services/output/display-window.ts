import { BrowserWindow, type Rectangle } from 'electron'

/**
 * A window on one physical display. `rehearsal` means that display also holds
 * Kairo's controls: the window is then an ordinary framed one, because a
 * full-screen, always-on-top window there would lock the operator out.
 */
export interface DisplaySink {
  kind: 'display'
  bounds: Rectangle
  rehearsal: boolean
  /** Frame height in 1920-wide theme pixels (1080 unless the output fills a non-16:9 display). */
  frameHeight: number
}

const WIDTH = 1920

/** Program and stage windows share these; the shell never needs Node. */
const WEB_PREFERENCES = {
  backgroundThrottling: false,
  contextIsolation: true,
  nodeIntegration: false,
  // Background videos (and program audio, when enabled) must start on their own.
  autoplayPolicy: 'no-user-gesture-required' as const,
}

export function createDisplayWindow(title: string, sink: DisplaySink): BrowserWindow {
  if (sink.rehearsal) {
    // Same display as Kairo's controls: an ordinary window the operator can
    // move aside. Not closable — turning the output off is what closes it,
    // so the window and the settings cannot disagree.
    const width = Math.round(sink.bounds.width / 2)
    const height = Math.round((width * sink.frameHeight) / WIDTH)
    return new BrowserWindow({
      title: `${title} (rehearsal)`,
      x: Math.round(sink.bounds.x + (sink.bounds.width - width) / 2),
      y: Math.round(sink.bounds.y + (sink.bounds.height - height) / 2),
      width,
      height,
      show: false,
      closable: false,
      minimizable: true,
      backgroundColor: '#000000',
      webPreferences: WEB_PREFERENCES,
    })
  }

  return new BrowserWindow({
    ...sink.bounds,
    title,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    // Pushing a slide must never take keyboard focus from the operator —
    // Backspace, arrows and clicker keys all land in the main window.
    focusable: false,
    hasShadow: false,
    // macOS rounds the corners of every window, borderless ones included —
    // on a projector that shows as four clipped corners on the slide.
    roundedCorners: false,
    resizable: false,
    movable: false,
    // Lets the window sit over the macOS menu bar instead of being nudged
    // below it.
    enableLargerThanScreen: true,
    webPreferences: WEB_PREFERENCES,
  })
}

/**
 * Covers the whole display, menu bar and dock/taskbar included.
 *
 * macOS: a screen-saver-level window at the display bounds sits over the menu
 * bar and dock without entering native full screen, which would move it to
 * its own Space and animate. Windows/Linux: real full screen, so the taskbar
 * does not draw over it. Both still need the M0 hardware check.
 */
function placeOnDisplay(win: BrowserWindow, sink: DisplaySink): void {
  if (sink.rehearsal) return
  win.setBounds(sink.bounds)
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') {
    // Without skipTransformProcessType, Electron flips the whole app to a
    // UI-element process and back, which hides every Kairo window (controls
    // included) and the dock icon — the app vanishes when an output is set.
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
  } else {
    win.setFullScreen(true)
  }
}

export function showDisplayWindow(win: BrowserWindow, sink: DisplaySink): void {
  placeOnDisplay(win, sink)
  win.showInactive()
}

export function sameBounds(a: DisplaySink['bounds'], b: DisplaySink['bounds']): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Whether moving from `a` to `b` needs a new window rather than a move. */
export function needsRebuild(a: DisplaySink, b: DisplaySink): boolean {
  return a.rehearsal !== b.rehearsal || a.frameHeight !== b.frameHeight
}

import { BrowserWindow } from 'electron'

// The operator's window, tracked explicitly. `BrowserWindow.getAllWindows()`
// also returns the offscreen NDI renderer and any projector windows, so
// "the first window" is not a safe way to find the one with the controls —
// a dialog parented to a projector window opens on the projector.

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** The window a dialog should attach to: whatever has focus, else the main window. */
export function dialogParentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? getMainWindow()
}

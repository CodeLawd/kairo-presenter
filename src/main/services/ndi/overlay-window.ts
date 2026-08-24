import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import overlayHtml from './overlay.html?asset'
import { renderOverlayHTML } from '@shared/overlay-template'
import type { OverlayTheme } from '@shared/ipc'
import { ndiService } from './index'

// ─── Constants ────────────────────────────────────────────────────────────────

const WIDTH = 1920
const HEIGHT = 1080
const OSR_FRAME_RATE = 10
// Video backgrounds repaint continuously — 10fps reads as a slideshow. 24 keeps
// motion acceptable without tripling the BGRA copy load. Tune after live perf checks.
const OSR_FRAME_RATE_VIDEO = 24

// ─── Offscreen overlay renderer ────────────────────────────────────────────────
// D4/D5: offscreen hidden BrowserWindow loaded from the `?asset`-imported
// overlay.html shell. Its 'paint' event feeds NdiService.updateFrame with the
// BGRA bitmap. Lazy-created on first use, and only when NdiService.available —
// never spun up if grandiose-mac failed to load.

class OverlayWindow {
  private win: BrowserWindow | null = null
  private creating: Promise<BrowserWindow> | null = null

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win
    if (this.creating) return this.creating

    this.creating = this.createWindow()
    try {
      return await this.creating
    } finally {
      this.creating = null
    }
  }

  private async createWindow(): Promise<BrowserWindow> {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    win.webContents.setFrameRate(OSR_FRAME_RATE)

    win.webContents.on('paint', (_event, _dirty, image) => {
      // On Retina displays the offscreen bitmap arrives at devicePixelRatio
      // scale (e.g. 3840×2160) — normalize to the fixed NDI frame size.
      const { width, height } = image.getSize()
      const frame = width === WIDTH && height === HEIGHT
        ? image
        : image.resize({ width: WIDTH, height: HEIGHT })
      ndiService.updateFrame(frame.getBitmap(), WIDTH, HEIGHT)
    })

    win.webContents.on('render-process-gone', (_event, details) => {
      log.error('[NDI] Overlay window render process gone', details)
    })

    await win.loadFile(overlayHtml)
    log.info('[NDI] Overlay window created', { asset: overlayHtml })

    this.win = win
    return win
  }

  async showScripture(reference: string, text: string, theme: OverlayTheme): Promise<void> {
    if (!ndiService.getStatus().available) return
    const win = await this.ensureWindow()
    if (win.isDestroyed()) return
    const isVideoBg = theme.background.type === 'video' && !!theme.background.mediaPath
    win.webContents.setFrameRate(isVideoBg ? OSR_FRAME_RATE_VIDEO : OSR_FRAME_RATE)
    const html = renderOverlayHTML(theme, reference, text, WIDTH, HEIGHT)
    await win.webContents.executeJavaScript(`window.__setContent(${JSON.stringify(html)})`)
  }

  /** Blanks the overlay window content AND resets the NDI sender's repeating frame. */
  async clear(): Promise<void> {
    ndiService.clearFrame()
    if (this.win && !this.win.isDestroyed()) {
      try {
        await this.win.webContents.executeJavaScript('window.__setContent("")')
      } catch (err) {
        log.warn('[NDI] Overlay clear executeJavaScript failed', (err as Error).message)
      }
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
  }
}

export const overlayWindow = new OverlayWindow()

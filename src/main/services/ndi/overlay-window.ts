import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import overlayHtml from './overlay.html?asset'
import { renderOverlayHTML } from '@shared/overlay-template'
import type { MediaPlayback, OverlayTheme } from '@shared/ipc'
import { mediaFilterCss } from '@shared/media-playback'
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
  /** Which output last rendered here — see showScripture. */
  private lastOutputId: string | null = null
  /**
   * What is currently painted, kept so the background can be swapped underneath
   * without the operator having to re-push the slide. Changing a background
   * mid-song must not blank the words.
   */
  private lastRender: { reference: string; text: string; theme: OverlayTheme } | null = null

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

  /**
   * Renders one output's slide. `outputId` is not used to route anything — this
   * window and its NDI sender are singletons — it exists so the one-NDI-output
   * assumption is visible AT the place that depends on it. If a second output
   * ever reaches here, it is silently overwriting the first one's frame, and
   * this warning is the only thing that will say so.
   */
  async showScripture(
    outputId: string,
    reference: string,
    text: string,
    theme: OverlayTheme
  ): Promise<boolean> {
    if (!ndiService.getStatus().available) return false
    if (this.lastOutputId !== null && this.lastOutputId !== outputId) {
      log.warn('[NDI] Overlay window reused by a second output — frames will overwrite', {
        previous: this.lastOutputId,
        next: outputId,
      })
    }
    this.lastOutputId = outputId
    this.lastRender = { reference, text, theme }
    await this.paint(reference, text, theme)
    return true
  }

  /**
   * Swaps the background under whatever is already on screen.
   *
   * Returns false when nothing has been pushed yet — the caller then knows the
   * background is staged but not visible, rather than assuming it went live.
   */
  async setBackground(background: OverlayTheme['background']): Promise<boolean> {
    if (!ndiService.getStatus().available) return false
    const current = this.lastRender
    if (!current) return false

    const theme: OverlayTheme = { ...current.theme, background }
    this.lastRender = { ...current, theme }
    await this.paint(current.reference, current.text, theme)
    return true
  }

  /**
   * Updates loop and color on the current background without rebuilding the
   * slide — a full paint restarts the video, which is unusable on a slider.
   */
  async patchBackgroundPlayback(playback: MediaPlayback): Promise<void> {
    const current = this.lastRender
    if (!current) return
    const background: OverlayTheme['background'] = {
      ...current.theme.background,
      mediaLoop: playback.loop,
      hue: playback.hue,
      saturation: playback.saturation,
      brightness: playback.brightness,
      contrast: playback.contrast,
    }
    this.lastRender = { ...current, theme: { ...current.theme, background } }
    if (!this.win || this.win.isDestroyed()) return
    const filter = mediaFilterCss(playback)
    await this.win.webContents.executeJavaScript(
      `window.__patchBackground(${JSON.stringify(filter)}, ${playback.loop ? 'true' : 'false'})`,
    )
  }

  private async paint(reference: string, text: string, theme: OverlayTheme): Promise<void> {
    // Retry sender creation if an earlier attempt lost the name to another copy
    // of the app. Cooldown-guarded inside the service, and a no-op once a sender
    // exists — without this a startup clash would need an app restart to clear.
    await ndiService.start()

    const win = await this.ensureWindow()
    if (win.isDestroyed()) return
    const isVideoBg = theme.background.type === 'video' && !!theme.background.mediaPath
    win.webContents.setFrameRate(isVideoBg ? OSR_FRAME_RATE_VIDEO : OSR_FRAME_RATE)
    const html = renderOverlayHTML(theme, reference, text, WIDTH, HEIGHT)
    await win.webContents.executeJavaScript(`window.__setContent(${JSON.stringify(html)})`)
  }

  /** Blanks the overlay window content AND resets the NDI sender's repeating frame. */
  async clear(): Promise<void> {
    this.lastOutputId = null
    this.lastRender = null
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

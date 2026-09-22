import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import overlayHtml from './overlay.html?asset'
import { renderOverlayHTML, type OverlayColoredLine } from '@shared/overlay-template'
import type { MediaPlayback, OverlayTheme } from '@shared/ipc'
import { mediaFilterCss } from '@shared/media-playback'
import { overlayMediaUrl } from '@shared/overlay-template'
import { ndiService } from './index'

// ─── Constants ────────────────────────────────────────────────────────────────

const WIDTH = 1920
const HEIGHT = 1080
const OSR_FRAME_RATE = 10
// Video backgrounds repaint continuously — 10fps reads as a slideshow. 24 keeps
// motion acceptable without tripling the BGRA copy load. Tune after live perf checks.
const OSR_FRAME_RATE_VIDEO = 24
/** Capture rate used for the moment a document page is swapped in. */
const OSR_FRAME_RATE_SWAP = 60
/** Longest a page turn waits for its own captured frame before giving up. */
const PAINT_WAIT_MS = 400

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
  /** True while the overlay is showing a document page and nothing else. */
  private documentMode = false
  /** Resolvers waiting for the next offscreen capture to reach the NDI sender. */
  private paintWaiters: Array<() => void> = []
  /**
   * What is currently painted, kept so the background can be swapped underneath
   * without the operator having to re-push the slide. Changing a background
   * mid-song must not blank the words.
   */
  private lastRender: {
    reference: string
    text: string
    theme: OverlayTheme
    coloredLines?: OverlayColoredLine[]
  } | null = null

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
        backgroundThrottling: false,
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
      // Anyone awaiting "this page is really on the wire" is released here —
      // the capture, not a guess at how long painting takes.
      const waiters = this.paintWaiters
      this.paintWaiters = []
      for (const resolve of waiters) resolve()
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
    theme: OverlayTheme,
    coloredLines?: OverlayColoredLine[],
  ): Promise<boolean> {
    if (!ndiService.getStatus().available) return false
    if (this.lastOutputId !== null && this.lastOutputId !== outputId) {
      log.warn('[NDI] Overlay window reused by a second output — frames will overwrite', {
        previous: this.lastOutputId,
        next: outputId,
      })
    }
    this.lastOutputId = outputId
    this.lastRender = { reference, text, theme, coloredLines }
    await this.paint(reference, text, theme, coloredLines)
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
    await this.paint(current.reference, current.text, theme, current.coloredLines)
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

  /** Pause or resume the current background video without rebuilding the slide. */
  async setVideoPaused(paused: boolean): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    await this.win.webContents.executeJavaScript(
      `window.__setVideoPaused(${paused ? 'true' : 'false'})`,
    )
  }

  /** Scrub the current background video without rebuilding the slide. */
  async seekVideo(seconds: number): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    const time = Number.isFinite(seconds) ? seconds : 0
    await this.win.webContents.executeJavaScript(`window.__seekVideo(${time})`)
  }

  private async paint(
    reference: string,
    text: string,
    theme: OverlayTheme,
    coloredLines?: OverlayColoredLine[],
  ): Promise<void> {
    // Retry sender creation if an earlier attempt lost the name to another copy
    // of the app. Cooldown-guarded inside the service, and a no-op once a sender
    // exists — without this a startup clash would need an app restart to clear.
    await ndiService.start()

    const win = await this.ensureWindow()
    if (win.isDestroyed()) return
    const isVideoBg = theme.background.type === 'video' && !!theme.background.mediaPath
    win.webContents.setFrameRate(isVideoBg ? OSR_FRAME_RATE_VIDEO : OSR_FRAME_RATE)
    const html = renderOverlayHTML(theme, reference, text, WIDTH, HEIGHT, { coloredLines })
    this.documentMode = false
    await win.webContents.executeJavaScript(`window.__setContent(${JSON.stringify(html)})`)
  }

  /** Documents use a clean, opaque frame and wait for the page pixels to decode. */
  async showDocument(outputId: string, theme: OverlayTheme): Promise<boolean> {
    if (!(await this.showScripture(outputId, '', '', theme))) return false
    if (!this.win || this.win.isDestroyed()) return false
    await this.win.webContents.executeJavaScript(`(async () => {
      const root = document.querySelector('.pa-overlay-root');
      const image = root?.querySelector('img');
      if (!root || !image) throw new Error('Document output image is missing.');
      root.style.background = '#000';
      await image.decode();
    })()`)
    this.documentMode = true
    await this.nextPaint(PAINT_WAIT_MS)
    return true
  }

  /** Resolves on the next captured frame, or after `timeoutMs` either way. */
  private nextPaint(timeoutMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.paintWaiters = this.paintWaiters.filter(waiter => waiter !== release)
        resolve()
      }, timeoutMs)
      const release = (): void => { clearTimeout(timer); resolve() }
      this.paintWaiters.push(release)
    })
  }

  /**
   * Page turn inside a deck that is already on screen.
   *
   * Swapping the one <img> skips rebuilding the slide HTML, which is most of
   * the delay an operator feels on a clicker press. Returns false whenever the
   * overlay is not currently showing a document from this output — the caller
   * then does the full push, so correctness never depends on this shortcut.
   */
  async swapDocumentPage(outputId: string, mediaPath: string): Promise<boolean> {
    const current = this.lastRender
    if (!this.documentMode || !current || this.lastOutputId !== outputId) return false
    if (!this.win || this.win.isDestroyed()) return false
    const url = overlayMediaUrl(mediaPath)
    // Static pages are captured at a slow offscreen frame rate, so a turn would
    // otherwise sit up to a frame interval before anything is grabbed. Burst
    // the capture rate around the swap, wait for the frame that actually
    // carries the new page, then drop back: the wall updates at once and the
    // CPU goes back to idle between pages.
    let swapped = false
    try {
      this.win.webContents.setFrameRate(OSR_FRAME_RATE_SWAP)
      swapped = await this.win.webContents.executeJavaScript(
        `window.__swapDocumentPage(${JSON.stringify(url)})`,
      )
      if (swapped) await this.nextPaint(PAINT_WAIT_MS)
    } catch (err) {
      log.warn('[NDI] Document page swap failed', (err as Error).message)
      return false
    } finally {
      if (this.win && !this.win.isDestroyed()) this.win.webContents.setFrameRate(OSR_FRAME_RATE)
    }
    if (!swapped) return false
    this.lastRender = {
      ...current,
      theme: { ...current.theme, background: { ...current.theme.background, mediaPath } },
    }
    return true
  }

  /** Decode the following page ahead of the click that asks for it. */
  async preloadDocumentPage(mediaPath: string): Promise<void> {
    if (!this.documentMode || !this.win || this.win.isDestroyed()) return
    try {
      await this.win.webContents.executeJavaScript(
        `window.__preloadDocumentPage(${JSON.stringify(overlayMediaUrl(mediaPath))})`,
      )
    } catch { /* A missed preload only costs the next swap its head start. */ }
  }

  /**
   * Drops verse / lyric / reference text without tearing down the background
   * video. Returns false when nothing has been painted yet.
   */
  async clearText(): Promise<boolean> {
    const current = this.lastRender
    if (!current) return false
    this.lastRender = { ...current, reference: '', text: '', coloredLines: undefined }
    if (!this.win || this.win.isDestroyed()) return true
    try {
      await this.win.webContents.executeJavaScript('window.__clearText()')
    } catch (err) {
      log.warn('[NDI] Overlay clearText failed', (err as Error).message)
      return false
    }
    return true
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

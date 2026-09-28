import { BrowserWindow } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'
import overlayHtml from './overlay.html?asset'
import { overlayMediaUrl, renderOverlayHTML, type OverlayColoredLine } from '@shared/overlay-template'
import type { MediaPlayback, OverlayTheme } from '@shared/ipc'
import { mediaFilterCss } from '@shared/media-playback'
import type { NdiService } from '../ndi'
import { createDisplayWindow, needsRebuild, sameBounds, showDisplayWindow, type DisplaySink } from './display-window'
import { ManagedWindow } from './managed-window'

// ─── Constants ────────────────────────────────────────────────────────────────

const WIDTH = 1920
const HEIGHT = 1080
const OSR_FRAME_RATE = 10
// Video backgrounds repaint continuously — 10fps reads as a slideshow. 24 keeps
// motion acceptable without tripling the BGRA copy load. Tune after live perf checks.
const OSR_FRAME_RATE_VIDEO = 24
/** Capture rate used for the moment a document page is swapped in. */
const OSR_FRAME_RATE_SWAP = 60
/** Capture rate while a fade runs, so the dissolve reaches NDI as motion. */
const OSR_FRAME_RATE_FADE = 30
/** Longest a page turn waits for its own frame before giving up. */
const PAINT_WAIT_MS = 400

// ─── Sinks ────────────────────────────────────────────────────────────────────

/**
 * Where a surface's pixels go.
 *
 * `ndi` — offscreen, transparent, hidden; each captured `paint` is handed to
 * its NDI sender. `display` — a visible window on one physical display; the
 * compositor is the delivery, so nothing is captured.
 */
export type SurfaceSink = { kind: 'ndi'; channel: NdiService } | DisplaySink

/** Per-surface shell settings — see `window.__configure` in overlay.html. */
export interface SurfaceConfig {
  transitionMs: number
  /** `enabled`: this surface plays background-video sound (the one audio surface). */
  audio: { enabled: boolean; volume: number; outputLabel: string }
  /** This surface plays the camera's sound (the audio surface, when a camera has sound). */
  cameraAudible: boolean
  /** NDI surfaces only: tap program sound and send it with the video. */
  ndiAudio: boolean
}

const DEFAULT_CONFIG: SurfaceConfig = {
  transitionMs: 0,
  audio: { enabled: false, volume: 1, outputLabel: '' },
  cameraAudible: false,
  ndiAudio: false,
}

/** The live camera: its video input and, optionally, the audio input played with it. */
export interface CameraLayer {
  label: string
  audioLabel: string | null
}

/** The program layers above the slide. Markup comes from `src/lib/program.ts`. */
export interface SurfaceLayers {
  message: string
  props: string
  logo: string
  camera: CameraLayer | null
}

const EMPTY_LAYERS: SurfaceLayers = { message: '', props: '', logo: '', camera: null }

interface RenderState {
  reference: string
  text: string
  theme: OverlayTheme
  coloredLines?: OverlayColoredLine[]
}

// ─── Program surface ──────────────────────────────────────────────────────────
// One renderer, two sinks. Both load the same `?asset`-imported overlay.html
// shell and paint `renderOverlayHTML()` into it, so an NDI feed, a projector
// and the Theme preview cannot disagree about what a slide looks like.

export class ProgramSurface extends ManagedWindow {
  /** Which output last rendered here — a page swap only continues its own deck. */
  private lastOutputId: string | null = null
  /** True while the surface is showing a document page and nothing else. */
  private documentMode = false
  /** Resolvers waiting for the next captured frame (ndi sink only). */
  private paintWaiters: Array<() => void> = []
  /**
   * What is currently painted, kept so the background can be swapped underneath
   * without the operator having to re-push the slide, and so a recreated window
   * (renderer crash, display replug) comes back showing the same thing.
   */
  private lastRender: RenderState | null = null
  private config: SurfaceConfig = DEFAULT_CONFIG
  private layers: SurfaceLayers = EMPTY_LAYERS
  private fadeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    label: string,
    private sink: SurfaceSink,
  ) {
    super(label, 'Output')
  }

  private get frameHeight(): number {
    return this.sink.kind === 'display' ? this.sink.frameHeight : HEIGHT
  }

  /** Whether a push to this surface can reach its sink right now. */
  available(): boolean {
    if (this.destroyed || this.parked) return false
    return this.sink.kind === 'ndi' ? this.sink.channel.getStatus().available : true
  }

  /**
   * Moves a display surface to new bounds (display resolution changed, or the
   * bound display turned into / stopped being the control display). A change
   * of rehearsal mode or frame shape needs a different window, so that rebuilds.
   */
  async retarget(sink: DisplaySink): Promise<void> {
    if (this.sink.kind !== 'display') return
    const previous = this.sink
    this.sink = sink
    if (!this.win || !this.isOpen) return
    if (needsRebuild(previous, sink)) {
      await this.recover('display mode changed', false)
      return
    }
    // Reconcile runs on every settings write; only a moved display needs placing.
    if (!sameBounds(previous.bounds, sink.bounds)) showDisplayWindow(this.win, sink)
  }

  // ─── Window lifecycle (ManagedWindow) ───────────────────────────────────────

  /** A display surface whose display is gone stays parked; NDI reopens on its next paint. */
  protected override parksOnClose(): boolean {
    return this.sink.kind === 'display'
  }

  protected override onClosed(): void {
    this.paintWaiters.splice(0).forEach((resolve) => resolve())
    if (this.fadeTimer) clearTimeout(this.fadeTimer)
    this.fadeTimer = null
  }

  protected build(): BrowserWindow {
    const sink = this.sink
    return sink.kind === 'ndi' ? this.createNdiWindow(sink.channel) : createDisplayWindow(this.label, sink)
  }

  protected async load(win: BrowserWindow): Promise<void> {
    const query: Record<string, string> = { h: String(this.frameHeight) }
    if (this.sink.kind === 'display') query.fit = 'display'
    await win.loadFile(overlayHtml, { query })
  }

  protected async ready(win: BrowserWindow): Promise<void> {
    await this.applyConfig(win)
    await this.applyLayers(win)
    if (this.sink.kind === 'display' && !win.isDestroyed()) showDisplayWindow(win, this.sink)
  }

  protected onFailure(reason: string): Promise<void> {
    return this.recover(reason)
  }

  private createNdiWindow(channel: NdiService): BrowserWindow {
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
        autoplayPolicy: 'no-user-gesture-required',
        // One capability only: hand program sound to this surface's NDI sender.
        preload: join(__dirname, '../preload/program.js'),
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
      channel.updateFrame(frame.getBitmap(), WIDTH, HEIGHT)
      // Anyone awaiting "this page is really on the wire" is released here —
      // the capture, not a guess at how long painting takes.
      const waiters = this.paintWaiters
      this.paintWaiters = []
      for (const resolve of waiters) resolve()
    })
    return win
  }

  /**
   * Throws the window away, builds a new one and puts the last slide back.
   * `failure` rebuilds (crash, hang) count against the retry budget; planned
   * ones (replug, moving between rehearsal and full screen) never do, so an
   * operator dragging the controls across displays cannot use it up.
   */
  private async recover(reason: string, failure = true): Promise<void> {
    if (this.destroyed || this.parked) return
    if (failure && !this.allowFailure(reason)) {
      this.close()
      return
    }
    this.dropWindow()
    try {
      const current = this.lastRender
      if (!current) {
        // Nothing painted, but program layers (logo, message) may be up.
        await this.ensureWindow()
        return
      }
      const wasDocument = this.documentMode
      await this.paint(current, true)
      if (wasDocument) await this.markDocument()
      log.info(`[Output] ${this.label} recovered`, { reason })
    } catch (err) {
      log.error(`[Output] ${this.label} recovery failed`, (err as Error).message)
    }
  }

  // ─── Shell configuration and program layers ─────────────────────────────────

  /** Transition length and program audio. Applied now and to every future window. */
  async configure(config: SurfaceConfig): Promise<void> {
    // Called on every reconcile; an unchanged config is not worth a round trip
    // (with an output device set, the page re-enumerates devices on each one).
    if (JSON.stringify(config) === JSON.stringify(this.config)) return
    this.config = config
    if (this.win && !this.win.isDestroyed()) await this.applyConfig(this.win)
  }

  private async applyConfig(win: BrowserWindow): Promise<void> {
    if (win.isDestroyed()) return
    await win.webContents.executeJavaScript(`window.__configure(${JSON.stringify(this.config)})`)
  }

  /**
   * Message, props, logo and camera above the slide. Only the layers that
   * changed are sent, so an unrelated update never re-fades a logo.
   */
  async setLayers(next: SurfaceLayers): Promise<void> {
    const previous = this.layers
    this.layers = next
    const win = this.win
    if (!win || win.isDestroyed()) {
      // Nothing on screen yet: a logo or message is still worth a window, so the
      // program shows it without waiting for the first slide.
      if (this.available() && hasAnyLayer(next) && !hasAnyLayer(previous)) {
        if (this.sink.kind === 'ndi') await this.sink.channel.start()
        await this.ensureWindow().catch(() => undefined)
      }
      return
    }
    await this.applyLayers(win, previous)
  }

  private async applyLayers(win: BrowserWindow, previous: SurfaceLayers = EMPTY_LAYERS): Promise<void> {
    if (win.isDestroyed()) return
    const next = this.layers
    const calls: string[] = []
    if (next.message !== previous.message) calls.push(`window.__setMessage(${JSON.stringify(next.message)})`)
    if (next.props !== previous.props) calls.push(`window.__setProps(${JSON.stringify(next.props)})`)
    if (next.logo !== previous.logo) calls.push(`window.__setLogo(${JSON.stringify(next.logo)})`)
    if (!sameCamera(next.camera, previous.camera)) {
      calls.push(
        `window.__setCamera(${JSON.stringify(next.camera?.label ?? null)}, ${JSON.stringify(next.camera?.audioLabel ?? null)})`,
      )
    }
    if (calls.length === 0) return
    this.bumpForFade()
    // A camera going live (or away) changes the capture rate NDI needs.
    if (this.sink.kind === 'ndi' && !this.fadeTimer) win.webContents.setFrameRate(this.idleFrameRate())
    try {
      await win.webContents.executeJavaScript(calls.join(';'))
    } catch (err) {
      log.warn(`[Output] ${this.label} layer update failed`, (err as Error).message)
    }
  }

  /** NDI captures slowly between changes; run it at motion rate while a fade plays. */
  private bumpForFade(): void {
    if (this.sink.kind !== 'ndi' || this.config.transitionMs <= 0) return
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.webContents.setFrameRate(OSR_FRAME_RATE_FADE)
    if (this.fadeTimer) clearTimeout(this.fadeTimer)
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null
      if (this.win && !this.win.isDestroyed()) this.win.webContents.setFrameRate(this.idleFrameRate())
    }, this.config.transitionMs + 150)
  }

  /** Capture rate between changes: motion rate while a video or camera is up. */
  private idleFrameRate(): number {
    const theme = this.lastRender?.theme
    const video = theme?.background.type === 'video' && !!theme.background.mediaPath
    return video || this.layers.camera ? OSR_FRAME_RATE_VIDEO : OSR_FRAME_RATE
  }

  // ─── Content ────────────────────────────────────────────────────────────────

  /** Renders one output's slide. `outputId` scopes document page swaps to this output's deck. */
  async showSlide(
    outputId: string,
    reference: string,
    text: string,
    theme: OverlayTheme,
    coloredLines?: OverlayColoredLine[],
    options: { instant?: boolean } = {},
  ): Promise<boolean> {
    if (!this.available()) return false
    this.lastOutputId = outputId
    this.lastRender = { reference, text, theme, coloredLines }
    await this.paint(this.lastRender, options.instant ?? false)
    return true
  }

  /**
   * Swaps the background under whatever is already on screen.
   *
   * Returns false when nothing has been pushed yet — the caller then knows the
   * background is staged but not visible, rather than assuming it went live.
   */
  async setBackground(background: OverlayTheme['background']): Promise<boolean> {
    if (!this.available()) return false
    const current = this.lastRender
    if (!current) return false

    this.lastRender = { ...current, theme: { ...current.theme, background } }
    await this.paint(this.lastRender, false)
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

  /** The renderer process id of this surface's window — routes NDI audio from its page. */
  webContentsId(): number | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.id : null
  }

  /** Whether the background video has finished (or there is none). For lobby playlists. */
  async videoEnded(): Promise<boolean> {
    if (!this.win || this.win.isDestroyed()) return true
    try {
      return !!(await this.win.webContents.executeJavaScript('window.__videoEnded()'))
    } catch {
      return true
    }
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
    { reference, text, theme, coloredLines }: RenderState,
    instant: boolean,
  ): Promise<void> {
    if (this.sink.kind === 'ndi') {
      // Retry sender creation if an earlier attempt lost the name to another
      // copy of the app. Cooldown-guarded inside the service, and a no-op once
      // a sender exists — without this a startup clash would need a restart.
      await this.sink.channel.start()
    }

    const win = await this.ensureWindow()
    if (!win) return
    const html = renderOverlayHTML(theme, reference, text, WIDTH, this.frameHeight, { coloredLines })
    this.documentMode = false
    if (this.sink.kind === 'ndi') {
      if (!instant && this.config.transitionMs > 0) this.bumpForFade()
      else if (!this.fadeTimer) win.webContents.setFrameRate(this.idleFrameRate())
    }
    await win.webContents.executeJavaScript(
      `window.__setContent(${JSON.stringify(html)}, ${instant ? 'true' : 'false'})`,
    )
  }

  /** Documents use a clean, opaque frame and wait for the page pixels to decode. */
  async showDocument(outputId: string, theme: OverlayTheme): Promise<boolean> {
    if (!(await this.showSlide(outputId, '', '', theme, undefined, { instant: true }))) return false
    if (!this.win || this.win.isDestroyed()) return false
    await this.markDocument()
    return true
  }

  private async markDocument(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    await this.win.webContents.executeJavaScript('window.__markDocument()')
    this.documentMode = true
    await this.nextPaint(PAINT_WAIT_MS)
  }

  /**
   * Resolves once the current content has reached the sink — the captured
   * frame on NDI, two composited frames on a display — or after `timeoutMs`.
   */
  private nextPaint(timeoutMs: number): Promise<void> {
    if (this.sink.kind === 'display') {
      const win = this.win
      if (!win || win.isDestroyed()) return Promise.resolve()
      return Promise.race([
        win.webContents.executeJavaScript('window.__nextFrame()').then(() => undefined, () => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ])
    }
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
   * surface is not currently showing a document from this output — the caller
   * then does the full push, so correctness never depends on this shortcut.
   */
  async swapDocumentPage(outputId: string, mediaPath: string): Promise<boolean> {
    const current = this.lastRender
    if (!this.documentMode || !current || this.lastOutputId !== outputId) return false
    if (!this.win || this.win.isDestroyed()) return false
    const url = overlayMediaUrl(mediaPath)
    const ndi = this.sink.kind === 'ndi'
    // Static pages are captured at a slow offscreen frame rate, so a turn would
    // otherwise sit up to a frame interval before anything is grabbed. Burst
    // the capture rate around the swap, wait for the frame that actually
    // carries the new page, then drop back: the wall updates at once and the
    // CPU goes back to idle between pages. A display has no capture to burst.
    let swapped = false
    try {
      if (ndi) this.win.webContents.setFrameRate(OSR_FRAME_RATE_SWAP)
      swapped = await this.win.webContents.executeJavaScript(
        `window.__swapDocumentPage(${JSON.stringify(url)})`,
      )
      if (swapped) await this.nextPaint(PAINT_WAIT_MS)
    } catch (err) {
      log.warn(`[Output] ${this.label} document page swap failed`, (err as Error).message)
      return false
    } finally {
      if (ndi && this.win && !this.win.isDestroyed()) this.win.webContents.setFrameRate(this.idleFrameRate())
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
      this.bumpForFade()
      await this.win.webContents.executeJavaScript('window.__clearText()')
    } catch (err) {
      log.warn(`[Output] ${this.label} clearText failed`, (err as Error).message)
      return false
    }
    return true
  }

  /** Blanks the slide and background. Program layers (logo, message) are separate. */
  async clear(): Promise<void> {
    this.lastOutputId = null
    this.lastRender = null
    this.documentMode = false
    const win = this.win
    const fades = !!win && !win.isDestroyed() && this.config.transitionMs > 0
    // With a fade the captured frames carry the dissolve down to transparent;
    // resetting the sender first would cut to black and then fade from it.
    if (this.sink.kind === 'ndi' && !fades && !hasAnyLayer(this.layers)) this.sink.channel.clearFrame()
    if (win && !win.isDestroyed()) {
      try {
        this.bumpForFade()
        await win.webContents.executeJavaScript('window.__setContent("")')
      } catch (err) {
        log.warn(`[Output] ${this.label} clear failed`, (err as Error).message)
      }
    }
  }

  /**
   * Reopens a closed display surface with whatever it last showed — `close()`
   * keeps `lastRender`, so a replugged display repaints without a re-push.
   */
  async restore(): Promise<void> {
    if (this.destroyed) return
    this.parked = false
    // With nothing painted this still opens the (black) window, so the
    // projector visibly belongs to Kairo from the moment it is chosen.
    if (!this.isOpen) await this.recover('restored', false)
  }
}

function sameCamera(a: CameraLayer | null, b: CameraLayer | null): boolean {
  return a === b || (!!a && !!b && a.label === b.label && a.audioLabel === b.audioLabel)
}

function hasAnyLayer(layers: SurfaceLayers): boolean {
  return !!(layers.message || layers.props || layers.logo || layers.camera)
}

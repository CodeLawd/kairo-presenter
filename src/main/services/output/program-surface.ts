import { outputTestPatternHTML } from '@shared/output-test-pattern'
import type { VideoTestPattern } from '@shared/video-devices'
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'
import overlayHtml from './overlay.html?asset'
import { overlayMediaUrl, renderOverlayHTML, type OverlayColoredLine } from '@shared/overlay-template'
import type { MediaPlayback, OverlayTheme } from '@shared/ipc'
import type { ConfidenceInfo, ProgramWeb } from '@shared/program'
import type { DocumentSlide, DocumentPlaybackStatus, DocumentVideoCommand } from '@shared/documents'
import { mediaFilterCss } from '@shared/media-playback'
import type { NdiService } from '../ndi'
import { gpuFrames, type GpuFramesLoad } from '../gpu-frames'
import { GpuCapture, shareTexture, type CaptureTarget, type SharedTexture } from './gpu-capture'
import type { SyphonChannel } from '../syphon'
import type { VideoOutputSink } from '../video-devices/provider'
import { createDisplayWindow, needsRebuild, sameBounds, showDisplayWindow, type DisplaySink } from './display-window'
import { ManagedWindow } from './managed-window'
import { prepareScreenWebFrame, scrollWebFrame } from '../web'
import { WEB_SCREEN_FRAME } from '@shared/web'

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

/**
 * The pixel ratio offscreen windows paint at — the primary display's scale
 * factor. Only whole ratios are compensated; anything else falls back to the
 * per-frame resize in the paint handler.
 */
function captureScale(): number {
  try {
    const factor = screen.getPrimaryDisplay().scaleFactor
    return Number.isInteger(factor) && factor >= 1 && factor <= 4 ? factor : 1
  } catch {
    return 1
  }
}

// ─── Sinks ────────────────────────────────────────────────────────────────────

/**
 * Where a surface's pixels go.
 *
 * `ndi` — offscreen, transparent, hidden; each captured `paint` is handed to
 * its NDI sender. `syphon` — the same, published as a Syphon server for other
 * apps on this Mac. `display` — a visible window on one physical display; the
 * compositor is the delivery, so nothing is captured.
 */
export type SurfaceSink =
  | { kind: 'ndi'; channel: NdiService }
  | { kind: 'syphon'; channel: SyphonChannel }
  | { kind: 'device'; sink: VideoOutputSink }
  | DisplaySink

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
  /** A live web page behind the words. */
  web: ProgramWeb | null
  /** Countdown, clock and stage message, drawn as text by the shell. */
  info: ConfidenceInfo | null
}

/**
 * Something else that wants this surface's frames as they are painted — a
 * recording (Live → Start Capture). It never changes what the sink gets.
 */
export interface FrameTap {
  /** The rate it records at; an offscreen surface paints at least this fast while tapped. */
  fps: number
  /** GPU path: a painted texture. The tap must release it. */
  texture(texture: SharedTexture): void
  /** CPU path, and display windows: a BGRA bitmap. */
  pixels(bgra: Buffer, width: number, height: number): void
}

const EMPTY_LAYERS: SurfaceLayers = { message: '', props: '', logo: '', camera: null, web: null, info: null }

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
  testPattern: VideoTestPattern | null = null

  async setTestPattern(pattern: VideoTestPattern | null): Promise<boolean> {
    if (!this.available()) return false
    const win = await this.ensureWindow()
    if (!win || win.isDestroyed()) return false
    await this.applyTestPattern(win, pattern)
    this.testPattern = pattern
    return true
  }

  private async applyTestPattern(win: BrowserWindow, pattern: VideoTestPattern | null): Promise<void> {
    const html = pattern ? outputTestPatternHTML(pattern, this.label) : ''
    await win.webContents.executeJavaScript(`document.getElementById("kairo-diagnostic-pattern")?.remove();document.body.insertAdjacentHTML("beforeend",${JSON.stringify(html)})`)
  }
  /** Which output last rendered here — a page swap only continues its own deck. */
  private lastOutputId: string | null = null
  /** True while the surface is showing a document page and nothing else. */
  private documentMode = false
  private documentSlide: DocumentSlide | null = null
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
  /** GPU capture for the current offscreen window, when it uses shared textures. */
  private capture: GpuCapture | null = null
  /** Set once GPU capture fails on this surface; it stays on CPU for the session. */
  private gpuDisabled: string | null = null
  private tap: FrameTap | null = null
  /** When a display window last handed the tap a frame — those are throttled to its rate. */
  private tapFrameAt = 0

  constructor(
    label: string,
    private sink: SurfaceSink,
    /** The gpu-frames addon; injectable for tests. */
    private readonly loadGpu: () => GpuFramesLoad = gpuFrames,
  ) {
    super(label, 'Output')
  }

  /** Captured offscreen (NDI or a video card) rather than shown in a display window. */
  private get offscreen(): boolean {
    return this.sink.kind !== 'display'
  }

  private get frameHeight(): number {
    return this.sink.kind === 'display' ? this.sink.frameHeight : HEIGHT
  }

  /** Whether a push to this surface can reach its sink right now. */
  available(): boolean {
    if (this.destroyed || this.parked) return false
    return this.sink.kind === 'ndi' || this.sink.kind === 'syphon' ? this.sink.channel.getStatus().available : true
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

  /** Keep the current slide/document when the hardware acquisition is replaced. */
  async retargetDevice(sink: VideoOutputSink): Promise<void> {
    if (this.sink.kind !== 'device' || this.destroyed) return
    this.sink = { kind: 'device', sink }
    this.parked = false
    await this.recover('video device restored', false)
  }

  // ─── Frame tap (recording) ──────────────────────────────────────────────────

  /** Starts or stops handing frames to `tap`. Survives window rebuilds. */
  setTap(tap: FrameTap | null): void {
    if (tap === this.tap) return
    this.tap = tap
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (this.offscreen) {
      if (!this.fadeTimer) win.webContents.setFrameRate(this.idleFrameRate())
      // A still page paints nothing; one invalidate gives the tap its first frame now.
      if (tap) win.webContents.invalidate()
    } else {
      this.subscribeDisplay(win)
    }
  }

  /** Width over height of what this surface paints — the shape a recording of it takes. */
  frameAspect(): number {
    if (this.sink.kind !== 'display') return WIDTH / HEIGHT
    const win = this.win
    if (win && !win.isDestroyed()) {
      const [width, height] = win.getContentSize()
      if (width > 0 && height > 0) return width / height
    }
    return WIDTH / this.sink.frameHeight
  }

  /**
   * A display window is composited, not captured, so a tap on one subscribes
   * to its frames. They arrive at the display's pixel size; the recorder scales.
   */
  private subscribeDisplay(win: BrowserWindow): void {
    const contents = win.webContents
    try { contents.endFrameSubscription() } catch { /* none running */ }
    const tap = this.tap
    if (!tap) return
    this.tapFrameAt = 0
    contents.beginFrameSubscription(false, (image) => {
      if (this.tap !== tap) return
      const now = Date.now()
      if (now - this.tapFrameAt < 900 / tap.fps) return
      this.tapFrameAt = now
      const bitmap = image.toBitmap()
      const size = image.getSize()
      // The bitmap is in device pixels; its length gives the scale.
      const scale = Math.sqrt(bitmap.length / 4 / Math.max(1, size.width * size.height)) || 1
      try {
        tap.pixels(bitmap, Math.round(size.width * scale), Math.round(size.height * scale))
      } catch (error) {
        log.warn(`[Output] ${this.label} recording frame failed`, (error as Error).message)
      }
    })
    contents.invalidate()
  }

  // ─── Window lifecycle (ManagedWindow) ───────────────────────────────────────

  /** A display surface whose display is gone stays parked; NDI reopens on its next paint. */
  protected override parksOnClose(): boolean {
    return this.sink.kind !== 'ndi' && this.sink.kind !== 'syphon'
  }

  protected override onClosed(): void {
    this.capture?.close()
    this.capture = null
    this.paintWaiters.splice(0).forEach((resolve) => resolve())
    if (this.fadeTimer) clearTimeout(this.fadeTimer)
    this.fadeTimer = null
  }

  protected build(): BrowserWindow {
    const sink = this.sink
    const win = sink.kind === 'display' ? createDisplayWindow(this.label, sink) : this.createOffscreenWindow(sink)
    // A live web page follows the operator's scrolling smoothly (see scrollWeb).
    prepareScreenWebFrame(win.webContents)
    return win
  }

  protected async load(win: BrowserWindow): Promise<void> {
    const query: Record<string, string> = { h: String(this.frameHeight) }
    if (this.sink.kind === 'display') query.fit = 'display'
    await win.loadFile(overlayHtml, { query })
  }

  protected async ready(win: BrowserWindow): Promise<void> {
    await this.applyConfig(win)
    await this.applyLayers(win)
    if (this.testPattern) await this.applyTestPattern(win, this.testPattern)
    if (this.sink.kind === 'display' && !win.isDestroyed()) {
      showDisplayWindow(win, this.sink)
      if (this.tap) this.subscribeDisplay(win)
    }
  }

  protected onFailure(reason: string): Promise<void> {
    return this.recover(reason)
  }

  /** Where GPU-converted frames for `sink` go, or null when it has no GPU path. */
  private captureTarget(sink: Exclude<SurfaceSink, DisplaySink>): CaptureTarget | null {
    if (sink.kind === 'ndi') {
      return { kind: 'ndi', deliver: (uyva, width, height) => sink.channel.updateConvertedFrame(uyva, width, height) }
    }
    if (sink.kind === 'syphon') return { kind: 'syphon', channel: sink.channel }
    return sink.sink.frameRing ? { kind: 'ring', ring: sink.sink.frameRing } : null
  }

  /** GPU capture failed: this surface rebuilds on the CPU path and keeps its picture. */
  private gpuFallback(reason: string): void {
    if (this.gpuDisabled || this.destroyed) return
    this.gpuDisabled = reason
    log.warn(`[Output] ${this.label} GPU capture failed — falling back to CPU capture for this session`, { reason })
    void this.recover('GPU capture fell back to CPU', false)
  }

  private createOffscreenWindow(sink: Exclude<SurfaceSink, DisplaySink>): BrowserWindow {
    // Offscreen pages paint at the display's pixel ratio — 3840×2160 on a Retina
    // Mac — and every frame then had to be shrunk on the main thread. A window
    // 1/scale the size, zoomed by 1/scale, keeps the 1920-px layout but paints
    // exactly 1920×1080. (Zoom set here stays on this window; it does not
    // spread to other file:// windows.)
    const scale = captureScale()
    this.capture?.close()
    this.capture = null
    const opened = this.gpuDisabled
      ? { reason: this.gpuDisabled }
      : GpuCapture.create(this.loadGpu(), this.captureTarget(sink), (reason) => this.gpuFallback(reason))
    if ('capture' in opened) this.capture = opened.capture
    log.info(`[Output] ${this.label} capture: ${this.capture ? 'gpu' : 'cpu'}`, 'reason' in opened ? { reason: opened.reason } : {})
    const capture = this.capture
    const win = new BrowserWindow({
      width: WIDTH / scale,
      height: HEIGHT / scale,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        // Shared textures only when this surface can convert them; a window
        // built that way paints no bitmap, so the CPU path needs a plain one.
        offscreen: capture ? { useSharedTexture: true } : true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
        zoomFactor: 1 / scale,
        // One capability only: hand program sound to this surface's NDI sender.
        preload: join(__dirname, '../preload/program.js'),
      },
    })

    win.webContents.setFrameRate(this.captureFrameRate(OSR_FRAME_RATE))

    win.webContents.on('paint', (event, _dirty, image) => {
      const texture = (event as { texture?: Electron.OffscreenSharedTexture }).texture
      if (texture) {
        // GPU path. The converter scales any paint size to its raster, and
        // releases the texture as soon as the GPU is done with it. A recording
        // takes the same texture; it goes back once both are done with it.
        const tap = this.tap
        const converting = !!capture && this.capture === capture
        const [forSink, forTap] = tap && converting ? shareTexture(texture, 2) : [texture, texture]
        if (converting) capture.handle(forSink)
        if (tap) tap.texture(forTap)
        if (!converting && !tap) texture.release()
      } else {
        // CPU path. Normally exactly WIDTH×HEIGHT (see captureScale). A display
        // change after the window was built can still change the paint size.
        const { width, height } = image.getSize()
        const frame = width === WIDTH && height === HEIGHT
          ? image
          : image.resize({ width: WIDTH, height: HEIGHT })
        try {
          if (sink.kind === 'ndi') sink.channel.updateFrame(frame.getBitmap(), WIDTH, HEIGHT)
          else if (sink.kind === 'syphon') sink.channel.publishPixels(frame.getBitmap(), WIDTH, HEIGHT)
          else sink.sink.setFrame(frame.getBitmap(), WIDTH, HEIGHT)
        } catch (error) {
          log.warn(`[Output] ${this.label} frame delivery failed`, (error as Error).message)
        }
        try {
          this.tap?.pixels(frame.getBitmap(), WIDTH, HEIGHT)
        } catch (error) {
          log.warn(`[Output] ${this.label} recording frame failed`, (error as Error).message)
        }
      }
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
      const documentSlide = this.documentSlide
      await this.paint(current, true)
      if (wasDocument) {
        await this.markDocument()
        if (documentSlide) await this.setDocumentSlide(documentSlide)
      }
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
    // Only the audio surface makes a sound. Kairo's own media follow that in the
    // page; a live web page doesn't, so every other window is muted outright,
    // or each screen would play the page's sound and the room would hear echoes.
    // An NDI feed carrying sound is left alone: it taps sound from its own window.
    win.webContents.setAudioMuted?.(!this.config.audio.enabled && !this.config.cameraAudible && !this.config.ndiAudio)
    await win.webContents.executeJavaScript(`window.__configure(${JSON.stringify(this.config)})`)
  }

  /**
   * Message, props, logo, camera and info above the slide. Only the layers that
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
        else if (this.sink.kind === 'syphon') this.sink.channel.start()
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
    if (next.web?.url !== previous.web?.url || next.web?.reload !== previous.web?.reload) {
      calls.push(`window.__setWeb(${JSON.stringify(next.web?.url ?? null)}, ${next.web?.reload ?? 0})`)
    }
    if (JSON.stringify(next.info) !== JSON.stringify(previous.info)) {
      calls.push(`window.__setInfo(${JSON.stringify(next.info)})`)
    }
    if (calls.length === 0) return
    this.bumpForFade()
    // A camera or web page going live (or away) changes the capture rate an offscreen surface needs.
    if (this.offscreen && !this.fadeTimer) win.webContents.setFrameRate(this.idleFrameRate())
    try {
      await win.webContents.executeJavaScript(calls.join(';'))
    } catch (err) {
      log.warn(`[Output] ${this.label} layer update failed`, (err as Error).message)
    }
  }

  /** Scrolls the live web page, following the operator's preview. */
  scrollWeb(x: number, y: number): void {
    const win = this.win
    if (!this.layers.web || !win || win.isDestroyed()) return
    scrollWebFrame(win.webContents, WEB_SCREEN_FRAME, x, y)
  }

  /** Offscreen capture runs slowly between changes; run it at motion rate while a fade plays. */
  private bumpForFade(): void {
    if (!this.offscreen || this.config.transitionMs <= 0) return
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.webContents.setFrameRate(this.captureFrameRate(OSR_FRAME_RATE_FADE))
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
    const moving = video || this.documentSlide?.videos.length || this.layers.camera || this.layers.web
    return this.captureFrameRate(moving ? OSR_FRAME_RATE_VIDEO : OSR_FRAME_RATE)
  }

  /**
   * Electron accepts integer capture rates; the card retains its exact rational
   * clock. A recording raises the rate to its own, so motion records smoothly.
   */
  private captureFrameRate(fallback: number): number {
    const rate = this.sink.kind === 'device' ? this.sink.sink.frameRate : undefined
    const base = rate !== undefined && Number.isFinite(rate) && rate > 0
      ? Math.min(240, Math.ceil(rate))
      : fallback
    return this.tap ? Math.max(base, Math.ceil(this.tap.fps)) : base
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
    if (this.sink.kind === 'syphon') this.sink.channel.start()
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
    this.documentSlide = null
    if (this.offscreen) {
      if (!instant && this.config.transitionMs > 0) this.bumpForFade()
      else if (!this.fadeTimer) win.webContents.setFrameRate(this.idleFrameRate())
    }
    await win.webContents.executeJavaScript(
      `window.__setContent(${JSON.stringify(html)}, ${instant ? 'true' : 'false'})`,
    )
  }

  /** Documents use a clean, opaque frame and wait for the page pixels to decode. */
  async showDocument(outputId: string, theme: OverlayTheme, slide?: DocumentSlide): Promise<boolean> {
    if (!(await this.showSlide(outputId, '', '', theme, undefined, { instant: true }))) return false
    if (!this.win || this.win.isDestroyed()) return false
    await this.markDocument()
    if (slide) await this.setDocumentSlide(slide)
    return true
  }

  private async setDocumentSlide(slide: DocumentSlide): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    this.documentSlide = slide
    const payload = { ...slide, path: overlayMediaUrl(slide.path), videos: slide.videos.map((video) => ({ ...video, file: overlayMediaUrl(video.file) })) }
    await this.win.webContents.executeJavaScript(`window.__setDocumentVideos(${JSON.stringify(payload)})`)
    if (this.offscreen) this.win.webContents.setFrameRate(this.idleFrameRate())
    await this.nextPaint(PAINT_WAIT_MS)
  }

  async documentPlayback(): Promise<DocumentPlaybackStatus | null> {
    if (!this.documentMode || !this.documentSlide || !this.win || this.win.isDestroyed()) return null
    return this.win.webContents.executeJavaScript('window.__documentPlayback()')
  }

  async controlDocumentVideo(id: string, page: number, video: number, command: DocumentVideoCommand): Promise<boolean> {
    const slide = this.documentSlide
    if (!this.documentMode || !slide || slide.id !== id || slide.page !== page || !slide.videos[video] || !this.win || this.win.isDestroyed()) return false
    await this.win.webContents.executeJavaScript(`window.__controlDocumentVideo(${video}, ${JSON.stringify(command)})`)
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
  async swapDocumentPage(outputId: string, mediaPath: string, slide?: DocumentSlide): Promise<boolean> {
    const current = this.lastRender
    if (!this.documentMode || !current || this.lastOutputId !== outputId) return false
    if (!this.win || this.win.isDestroyed()) return false
    const url = overlayMediaUrl(mediaPath)

    // Static pages are captured at a slow offscreen frame rate, so a turn would
    // otherwise sit up to a frame interval before anything is grabbed. Burst
    // the capture rate around the swap, wait for the frame that actually
    // carries the new page, then drop back: the wall updates at once and the
    // CPU goes back to idle between pages. A display has no capture to burst.
    let swapped = false
    try {
      if (this.offscreen) this.win.webContents.setFrameRate(this.captureFrameRate(OSR_FRAME_RATE_SWAP))
      swapped = await this.win.webContents.executeJavaScript(
        `window.__swapDocumentPage(${JSON.stringify(url)})`,
      )
      if (swapped) await this.nextPaint(PAINT_WAIT_MS)
    } catch (err) {
      log.warn(`[Output] ${this.label} document page swap failed`, (err as Error).message)
      return false
    } finally {
      if (this.offscreen && this.win && !this.win.isDestroyed()) this.win.webContents.setFrameRate(this.idleFrameRate())
    }
    if (!swapped) return false
    this.documentSlide = null
    this.lastRender = {
      ...current,
      theme: { ...current.theme, background: { ...current.theme.background, mediaPath } },
    }
    if (slide) await this.setDocumentSlide(slide)
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
    this.documentSlide = null
    const win = this.win
    const fades = !!win && !win.isDestroyed() && this.config.transitionMs > 0
    // With a fade the captured frames carry the dissolve down to transparent;
    // resetting the sender first would cut to black and then fade from it.
    if (this.sink.kind === 'ndi' && !fades && !hasAnyLayer(this.layers)) this.sink.channel.clearFrame()
    if (this.sink.kind === 'syphon' && !fades && !hasAnyLayer(this.layers)) this.sink.channel.clearFrame(WIDTH, HEIGHT)
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
  return !!(layers.message || layers.props || layers.logo || layers.camera || layers.web || layers.info)
}

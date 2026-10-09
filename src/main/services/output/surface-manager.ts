import { powerSaveBlocker, screen, BrowserWindow, type Display } from 'electron'
import log from 'electron-log/main'
import type { DisplayInfo, MediaPlayback, OverlayOutput, OverlayTheme } from '@shared/ipc'
import { describeDisplay, frameHeightFor, resolveDisplay } from '@shared/displays'
import { escapeHtml } from '@shared/overlay-template'
import { normalizeOverlaySettings } from '@shared/overlay-defaults'
import { followsProgram, isRenderedKind, primaryNdiOutputId } from '@shared/overlay-outputs'
import { NDI_SENDER_NAME, PRODUCT_NAME } from '@shared/brand'
import {
  confidenceFor,
  EMPTY_PROGRAM_STATE,
  normalizePresentationSettings,
  programLayersFor,
  transitionMs,
  type OutputShowFilter,
  type PresentationSettings,
  type ProgramState,
  type StageDisplayStatus,
} from '@shared/program'
import { store } from '../../db'
import { getMainWindow } from '../../main-window'
import { ndiService, type NdiService } from '../ndi'
import type { DisplaySink } from './display-window'
import { LobbyPlayer } from './lobby-player'
import { ProgramSurface, type SurfaceLayers } from './program-surface'
import { StageWindow } from './stage-window'

/** How long "Identify displays" labels stay up. */
const IDENTIFY_MS = 3000
/**
 * Quiet period before display changes are acted on. macOS emits `moved` on
 * every step of a window drag, and a replug arrives as a burst of add /
 * metrics events — reconciling each one would rebuild windows mid-gesture.
 */
const DISPLAY_CHANGE_DEBOUNCE_MS = 250

/** Why a screen output can or cannot take a push right now — the Outputs UI shows `reason`. */
interface ScreenOutputState {
  ready: boolean
  reason: string
}

/** A rendered output that can take a push right now, with the surface it paints. */
export interface SurfaceTarget {
  output: OverlayOutput
  surface: ProgramSurface
}

type ChangeListener = (displays: DisplayInfo[]) => void

interface NdiEntry {
  surface: ProgramSurface
  channel: NdiService
  /** The legacy-named sender ProPresenter's video input is bound to. */
  primary: boolean
}

// ─── Surface manager ──────────────────────────────────────────────────────────
// Owns every program window: one offscreen surface per enabled `ndi` output
// (each with its own NDI sender), one display surface per enabled, connected
// `screen` output, and one stage window per enabled stage display. `reconcile`
// is the only place windows are opened or closed; it runs on launch, after
// every overlay / presentation settings write, and on display changes.

class SurfaceManager {
  private ndiEntries = new Map<string, NdiEntry>()
  /** Screens that follow the service. Pushes, backgrounds and Clear reach these. */
  private screens = new Map<string, ProgramSurface>()
  /** Screens running their own playlist, each with its player. Nothing from the service reaches them. */
  private lobbies = new Map<string, { surface: ProgramSurface; player: LobbyPlayer }>()
  private states = new Map<string, ScreenOutputState>()
  /** Stage windows exist only while their display is assigned; status is kept for every enabled one. */
  private stages = new Map<string, StageWindow>()
  private stageStates = new Map<string, StageDisplayStatus>()
  /** The outputs as of the last reconcile — filters and order come from here. */
  private outputs: OverlayOutput[] = []
  private program: ProgramState = EMPTY_PROGRAM_STATE
  private powerBlockerId: number | null = null
  private listeners = new Set<ChangeListener>()
  private storeListeners = new Set<() => void>()
  private stageListeners = new Set<(status: StageDisplayStatus[]) => void>()
  /** Stage status as last announced, so only real changes are pushed. */
  private sentStageStatus = ''
  private initialized = false
  private reconciling: Promise<void> = Promise.resolve()
  private displayChangeTimer: ReturnType<typeof setTimeout> | null = null

  init(): void {
    if (this.initialized) return
    this.initialized = true
    const onDisplaysChanged = (): void => this.displaysChanged()
    screen.on('display-added', onDisplaysChanged)
    screen.on('display-removed', onDisplaysChanged)
    screen.on('display-metrics-changed', onDisplaysChanged)
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Fires when stage-display status changes (display plugged, output toggled, …). */
  onStageStatus(listener: (status: StageDisplayStatus[]) => void): () => void {
    this.stageListeners.add(listener)
    return () => this.stageListeners.delete(listener)
  }

  private emitStageStatus(): void {
    const status = this.stageStatus()
    const json = JSON.stringify(status)
    if (json === this.sentStageStatus) return
    this.sentStageStatus = json
    for (const listener of this.stageListeners) listener(status)
  }

  /** Fires after the manager itself rewrote settings in the store (re-matched display ids). */
  onStoreWrite(listener: () => void): () => void {
    this.storeListeners.add(listener)
    return () => this.storeListeners.delete(listener)
  }

  /** Something about the displays changed — the main window moved screens, say. Debounced. */
  displaysChanged(): void {
    if (this.displayChangeTimer) clearTimeout(this.displayChangeTimer)
    this.displayChangeTimer = setTimeout(() => {
      this.displayChangeTimer = null
      void this.reconcile()
      this.emitChange()
    }, DISPLAY_CHANGE_DEBOUNCE_MS)
  }

  private emitChange(): void {
    const displays = this.listDisplays()
    for (const listener of this.listeners) listener(displays)
  }

  // ─── Displays ───────────────────────────────────────────────────────────────

  listDisplays(): DisplayInfo[] {
    if (!this.initialized) return []
    const primaryId = screen.getPrimaryDisplay().id
    const main = getMainWindow()
    const controlId = main ? screen.getDisplayMatching(main.getBounds()).id : null
    return screen.getAllDisplays().map((display) => toDisplayInfo(display, primaryId, controlId))
  }

  /** Flashes each display's name for a few seconds so an operator can tell them apart. */
  identify(): void {
    this.listDisplays().forEach((display, index) => {
      const win = new BrowserWindow({
        x: display.bounds.x + Math.round(display.bounds.width / 2) - 240,
        y: display.bounds.y + Math.round(display.bounds.height / 2) - 120,
        width: 480,
        height: 240,
        frame: false,
        transparent: true,
        show: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        roundedCorners: false,
        resizable: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      const html = identifyHtml(index + 1, describeDisplay(display), display.hostsMainWindow)
      void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
        if (!win.isDestroyed()) win.showInactive()
      })
      setTimeout(() => {
        if (!win.isDestroyed()) win.destroy()
      }, IDENTIFY_MS)
    })
  }

  // ─── Reconcile ──────────────────────────────────────────────────────────────

  /**
   * Makes the windows match the stored outputs, stage displays and connected
   * displays. Serialized: a settings write landing during a display event must
   * not open two windows for one output.
   */
  reconcile(outputs?: readonly OverlayOutput[]): Promise<void> {
    const run = (): Promise<void> => this.reconcileNow(
      outputs ?? normalizeOverlaySettings(store.get('overlay')).outputs,
    )
    this.reconciling = this.reconciling.then(run, run)
    return this.reconciling
  }

  private async reconcileNow(outputs: readonly OverlayOutput[]): Promise<void> {
    if (!this.initialized) return
    this.outputs = [...outputs]
    this.presentationCache = null
    const presentation = this.presentation()
    const displays = this.listDisplays()
    const repersist = new Map<string, number>()

    this.reconcileNdi(outputs)
    const usedDisplays = await this.reconcileScreens(outputs, displays, repersist)
    await this.reconcileStages(presentation, displays, usedDisplays)
    this.emitStageStatus()

    const liveWindows = [...this.states.values()].some((s) => s.ready) ||
      [...this.stageStates.values()].some((s) => s.ready)
    this.updatePowerBlocker(liveWindows)
    if (repersist.size > 0) this.repersistDisplayIds(repersist)

    await this.applyConfig(presentation)
    await this.applyProgram(presentation)
  }

  /**
   * One surface per enabled `ndi` output. The first keeps the legacy sender
   * (`ndiService`, "Kairo Scripture") so ProPresenter's bound video input still
   * finds it; the others get their own senders named after the output.
   */
  private reconcileNdi(outputs: readonly OverlayOutput[]): void {
    const wanted = outputs.filter((o) => o.kind === 'ndi' && o.enabled)
    const primaryId = primaryNdiOutputId(outputs)
    const keep = new Set<string>()
    wanted.forEach((output, index) => {
      const primary = output.id === primaryId
      const name = primary ? NDI_SENDER_NAME : `${PRODUCT_NAME} ${output.name || `NDI ${index + 1}`}`
      const existing = this.ndiEntries.get(output.id)
      if (existing && existing.channel.senderName === name && existing.primary === primary) {
        keep.add(output.id)
        return
      }
      if (existing) this.dropNdi(output.id, existing)
      const channel = primary ? ndiService : ndiService.createChannel(name)
      if (!channel) return
      const surface = new ProgramSurface(primary ? 'NDI' : `NDI (${output.name})`, { kind: 'ndi', channel })
      this.ndiEntries.set(output.id, { surface, channel, primary })
      keep.add(output.id)
      if (!primary) log.info('[Output] Extra NDI sender added', { output: output.id, name })
    })
    for (const [id, entry] of this.ndiEntries) {
      if (!keep.has(id)) this.dropNdi(id, entry)
    }
  }

  private dropNdi(id: string, entry: NdiEntry): void {
    entry.surface.destroy()
    // The primary sender is the app-lifetime singleton; only extras stop here.
    if (!entry.primary) {
      void entry.channel.stop().catch(() => undefined)
    } else {
      entry.channel.clearFrame()
    }
    this.ndiEntries.delete(id)
  }

  /** Returns the ids of displays now showing a screen output. */
  private async reconcileScreens(
    outputs: readonly OverlayOutput[],
    displays: DisplayInfo[],
    repersist: Map<string, number>,
  ): Promise<Set<number>> {
    const screenOutputs = outputs.filter((o) => o.kind === 'screen')
    const used = new Set<number>()
    this.states.clear()

    for (const output of screenOutputs) {
      if (!output.enabled) continue
      const existing = this.screenSurface(output.id)
      if (output.displayId === null) {
        this.states.set(output.id, { ready: false, reason: 'No display chosen' })
        existing?.close()
        continue
      }
      const display = resolveDisplay(output, displays, used)
      if (!display) {
        const connected = resolveDisplay(output, displays)
        this.states.set(output.id, { ready: false, reason: connected ? 'Display in use by another screen' : 'Display not connected' })
        existing?.close()
        continue
      }
      if (display.id !== output.displayId) repersist.set(output.id, display.id)
      used.add(display.id)

      const sink: DisplaySink = {
        kind: 'display',
        bounds: display.bounds,
        rehearsal: display.hostsMainWindow,
        frameHeight: frameHeightFor(display.size, output.aspect === 'fill'),
      }
      const surface = existing ?? new ProgramSurface(output.name || 'Screen', sink)
      this.fileScreen(output, surface)
      this.states.set(output.id, screenReadyState(output, display.hostsMainWindow))
      try {
        if (existing) await surface.retarget(sink)
        else log.info('[Output] Screen output opened', { output: output.id, display: display.label })
        await surface.restore()
      } catch (err) {
        log.error('[Output] Could not open screen output', { output: output.id, error: (err as Error).message })
        this.states.set(output.id, { ready: false, reason: 'Screen window failed to open' })
      }
    }

    // Outputs that were removed or turned off lose their surface — and with it
    // the slide they last showed, so turning one back on starts blank.
    const live = new Set(screenOutputs.filter((o) => o.enabled).map((o) => o.id))
    for (const [id, surface] of this.screens) {
      if (live.has(id)) continue
      surface.destroy()
      this.screens.delete(id)
    }
    for (const [id, lobby] of this.lobbies) {
      if (live.has(id)) continue
      lobby.player.stop()
      lobby.surface.destroy()
      this.lobbies.delete(id)
    }
    return used
  }

  /** The window a screen output already has, whichever role it had. */
  private screenSurface(id: string): ProgramSurface | undefined {
    return this.screens.get(id) ?? this.lobbies.get(id)?.surface
  }

  /**
   * Files a screen's surface by its source. Switching source moves the same
   * window across: into a lobby it gains a playlist player; back to the
   * service it drops the player and the last playlist item.
   */
  private fileScreen(output: OverlayOutput, surface: ProgramSurface): void {
    const lobby = this.lobbies.get(output.id)
    if (followsProgram(output)) {
      if (lobby) {
        lobby.player.stop()
        this.lobbies.delete(output.id)
        void surface.clear()
      }
      this.screens.set(output.id, surface)
      return
    }
    this.screens.delete(output.id)
    if (lobby) {
      lobby.player.update(output)
      return
    }
    const player = new LobbyPlayer(surface, output)
    this.lobbies.set(output.id, { surface, player })
    player.start()
    log.info('[Output] Screen output is running its own playlist', { output: output.id })
  }

  private async reconcileStages(
    presentation: PresentationSettings,
    displays: DisplayInfo[],
    usedDisplays: Set<number>,
  ): Promise<void> {
    this.stageStates.clear()
    const keep = new Set<string>()
    for (const config of presentation.stageDisplays) {
      if (!config.enabled) continue
      const setStatus = (ready: boolean, reason: string): void => {
        this.stageStates.set(config.id, { id: config.id, ready, reason })
      }
      const display = config.displayId === null ? null : resolveDisplay(config, displays)
      if (!display || usedDisplays.has(display.id)) {
        setStatus(false, config.displayId === null
          ? 'No display chosen'
          : display ? 'Display in use by a program screen' : 'Display not connected')
        this.stages.get(config.id)?.close()
        keep.add(config.id)
        continue
      }
      keep.add(config.id)
      usedDisplays.add(display.id)
      const sink: DisplaySink = { kind: 'display', bounds: display.bounds, rehearsal: display.hostsMainWindow, frameHeight: 1080 }
      setStatus(true, display.hostsMainWindow ? 'On the control display — showing a rehearsal window' : 'Live')
      const existing = this.stages.get(config.id)
      const window = existing ?? new StageWindow(config.name, sink)
      this.stages.set(config.id, window)
      try {
        if (existing) await window.retarget(sink)
        await window.restore()
      } catch (err) {
        log.error('[Stage] Could not open stage display', { id: config.id, error: (err as Error).message })
        setStatus(false, 'Stage window failed to open')
      }
    }
    for (const [id, window] of this.stages) {
      if (!keep.has(id)) {
        window.destroy()
        this.stages.delete(id)
      }
    }
  }

  /** Windows re-ids a replugged monitor; remember the new id so the next lookup is direct. */
  private repersistDisplayIds(ids: Map<string, number>): void {
    const stored = normalizeOverlaySettings(store.get('overlay'))
    store.set('overlay', {
      ...stored,
      outputs: stored.outputs.map((o) => (ids.has(o.id) ? { ...o, displayId: ids.get(o.id)! } : o)),
    })
    log.info('[Output] Screen output re-matched to a display with a new id', Object.fromEntries(ids))
    for (const listener of this.storeListeners) listener()
  }

  private updatePowerBlocker(active: boolean): void {
    if (active && this.powerBlockerId === null) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    } else if (!active && this.powerBlockerId !== null) {
      powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = null
    }
  }

  // ─── Program: transition, audio, layers, stage ──────────────────────────────

  /**
   * Presentation settings as of the last reconcile. Every settings write that
   * touches them reconciles, and a `store.get` re-reads the settings file, so
   * program-state changes (every push) use this copy instead.
   */
  private presentationCache: PresentationSettings | null = null

  private presentation(): PresentationSettings {
    this.presentationCache ??= normalizePresentationSettings(store.get('presentation'))
    return this.presentationCache
  }

  /**
   * The surface that plays video audio: the first live screen, else the
   * primary NDI surface. Exactly one, so two windows never echo each other.
   */
  private audioSurface(): ProgramSurface | null {
    const targets = this.liveTargets('backgrounds')
    return (
      targets.find((t) => t.output.kind === 'screen')?.surface ??
      targets.find((t) => this.isPrimaryNdi(t.output.id))?.surface ??
      null
    )
  }

  private async applyConfig(presentation: PresentationSettings): Promise<void> {
    // Lobby screens are never the audio surface and have no NDI sender, so the
    // same rule leaves them silent: the room's sound is the service's.
    const audioSurface = this.audioSurface()
    const ms = transitionMs(presentation.transition)
    const { enabled, volume, outputLabel } = presentation.audio
    const ndiAudio = new Set(
      presentation.audio.ndi
        ? [...this.ndiEntries.values()].filter((e) => e.channel.audioSupported).map((e) => e.surface)
        : [],
    )
    await Promise.all(
      [...this.ndiSurfaces, ...this.screens.values(), ...this.lobbySurfaces()].map((surface) =>
        surface.configure({
          transitionMs: ms,
          audio: { enabled: enabled && surface === audioSurface, volume, outputLabel },
          cameraAudible: surface === audioSurface && !!this.program.camera && !!this.program.cameraAudio,
          ndiAudio: ndiAudio.has(surface),
        }).catch(() => undefined),
      ),
    )
  }

  /** Whether any NDI feed can carry sound on this machine (NDI 6 binding loaded). */
  ndiAudioSupported(): boolean {
    return ndiService.audioSupported
  }

  /**
   * A block of program sound from an NDI surface's page (program preload).
   * Routed by the sending window, so a page can only ever feed its own sender.
   */
  handleNdiAudio(webContentsId: number, block: { sampleRate: number; channels: number; samples: number; data: Float32Array }): void {
    let entry: NdiEntry | undefined
    for (const candidate of this.ndiEntries.values()) {
      if (candidate.surface.webContentsId() === webContentsId) entry = candidate
    }
    if (!entry) return
    const { sampleRate, channels, samples, data } = block
    if (!(data instanceof Float32Array)) return
    if (!Number.isInteger(channels) || channels < 1 || channels > 8) return
    if (!Number.isInteger(samples) || samples < 1 || samples > 16384) return
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return
    if (data.length !== channels * samples) return
    entry.channel.sendAudio({
      sampleRate,
      channels,
      samples,
      channelStrideBytes: samples * 4,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    })
  }

  /** Program state changed (message, props, logo, camera, current / next, timer). */
  async setProgram(state: ProgramState): Promise<void> {
    const cameraSoundChanged = state.camera !== this.program.camera || state.cameraAudio !== this.program.cameraAudio
    this.program = state
    const presentation = this.presentation()
    // Which surface plays the camera's sound depends on the camera.
    if (cameraSoundChanged) await this.applyConfig(presentation)
    await this.applyProgram(presentation)
  }

  private async applyProgram(presentation: PresentationSettings): Promise<void> {
    const state = this.program
    const camera = state.camera ? { label: state.camera, audioLabel: state.cameraAudio } : null
    const layersFor = (output: OverlayOutput): SurfaceLayers => ({
      ...programLayersFor(output, state, presentation),
      // A lobby shows its playlist, never the service camera.
      camera: output.show.backgrounds && !this.lobbies.has(output.id) ? camera : null,
      info: confidenceFor(output, state, presentation),
    })
    const surfaceWork = this.outputs
      .filter((o) => o.enabled && isRenderedKind(o.kind))
      .map((output) => {
        const surface = this.surfaceOf(output)
        return surface ? surface.setLayers(layersFor(output)).catch(() => undefined) : Promise.resolve()
      })

    const stageConfigs = new Map(presentation.stageDisplays.map((c) => [c.id, c]))
    const stageWork = [...this.stages.entries()].map(([id, window]) => {
      const config = stageConfigs.get(id)
      if (!config) return Promise.resolve()
      return window.update({
        current: state.current,
        next: state.next,
        stageMessage: state.stageMessage,
        timer: state.timer,
        showNext: config.showNext,
        showClock: config.showClock,
        showTimer: config.showTimer,
        timerStyle: presentation.timer,
      }).catch(() => undefined)
    })
    await Promise.all([...surfaceWork, ...stageWork])
  }

  stageStatus(): StageDisplayStatus[] {
    return this.presentation().stageDisplays.map((config) =>
      !config.enabled
        ? { id: config.id, ready: false, reason: 'Off' }
        : this.stageStates.get(config.id) ?? { id: config.id, ready: false, reason: 'Display not connected' },
    )
  }

  // ─── Lookup ─────────────────────────────────────────────────────────────────

  /** Any window an output renders into, lobby screens included. */
  private surfaceOf(output: OverlayOutput): ProgramSurface | null {
    if (output.kind === 'ndi') return this.ndiEntries.get(output.id)?.surface ?? null
    if (output.kind === 'screen') return this.screenSurface(output.id) ?? null
    return null
  }

  /** The surface a service push to this output lands on, when it can take one. Never a lobby. */
  surfaceFor(output: OverlayOutput): ProgramSurface | null {
    if (!output.enabled) return null
    const surface = output.kind === 'ndi'
      ? this.ndiEntries.get(output.id)?.surface
      : output.kind === 'screen' && this.states.get(output.id)?.ready
        ? this.screens.get(output.id)
        : undefined
    return surface && surface.available() ? surface : null
  }

  /** Whether `outputId` is the NDI output ProPresenter's video input is bound to. */
  isPrimaryNdi(outputId: string): boolean {
    return this.ndiEntries.get(outputId)?.primary ?? false
  }

  /**
   * Rendered outputs (in list order) that can take a push right now. With
   * `show`, only those whose content filter allows it.
   */
  liveTargets(show?: keyof OutputShowFilter, outputs: readonly OverlayOutput[] = this.outputs): SurfaceTarget[] {
    return outputs.flatMap((output) => {
      if (!isRenderedKind(output.kind) || !output.enabled) return []
      if (show && !output.show[show]) return []
      const surface = this.surfaceFor(output)
      return surface ? [{ output, surface }] : []
    })
  }

  screenState(outputId: string): ScreenOutputState {
    return this.states.get(outputId) ?? { ready: false, reason: 'Display not connected' }
  }

  /** Every NDI surface — cleared with the `presentation` layer. */
  get ndiSurfaces(): ProgramSurface[] {
    return [...this.ndiEntries.values()].map((e) => e.surface)
  }

  /** Screens that follow the service — lobby screens are left out of pushes and Clear. */
  get screenSurfaces(): ProgramSurface[] {
    return [...this.screens.values()]
  }

  private lobbySurfaces(): ProgramSurface[] {
    return [...this.lobbies.values()].map((l) => l.surface)
  }

  /** Every surface that follows the service (NDI and program screens) — what Clear clears. */
  allSurfaces(): ProgramSurface[] {
    return [...this.ndiSurfaces, ...this.screenSurfaces]
  }

  // ─── Broadcasts ─────────────────────────────────────────────────────────────
  // Operations that are about "the program", not about one output.

  /** True when at least one surface had something painted to swap under. */
  async setBackground(background: OverlayTheme['background']): Promise<boolean> {
    const results = await Promise.all(this.allSurfaces().map((s) => s.setBackground(background)))
    return results.some(Boolean)
  }

  async patchBackgroundPlayback(playback: MediaPlayback): Promise<void> {
    await Promise.all(this.allSurfaces().map((s) => s.patchBackgroundPlayback(playback)))
  }

  async setVideoPaused(paused: boolean): Promise<void> {
    await Promise.all(this.allSurfaces().map((s) => s.setVideoPaused(paused)))
  }

  async seekVideo(seconds: number): Promise<void> {
    await Promise.all(this.allSurfaces().map((s) => s.seekVideo(seconds)))
  }

  async preloadDocumentPage(mediaPath: string): Promise<void> {
    await Promise.all(this.allSurfaces().map((s) => s.preloadDocumentPage(mediaPath)))
  }

  // ─── Teardown ───────────────────────────────────────────────────────────────

  /** Closes the projector and stage windows (main window gone) but keeps what they showed. */
  closeScreens(): void {
    for (const surface of [...this.screens.values(), ...this.lobbySurfaces()]) surface.close()
    for (const window of this.stages.values()) window.close()
    this.updatePowerBlocker(false)
  }

  destroyAll(): void {
    if (this.displayChangeTimer) clearTimeout(this.displayChangeTimer)
    this.displayChangeTimer = null
    for (const { player, surface } of this.lobbies.values()) {
      player.stop()
      surface.destroy()
    }
    this.lobbies.clear()
    for (const surface of this.screens.values()) surface.destroy()
    this.screens.clear()
    for (const window of this.stages.values()) window.destroy()
    this.stages.clear()
    this.stageStates.clear()
    for (const [id, entry] of this.ndiEntries) this.dropNdi(id, entry)
    this.updatePowerBlocker(false)
  }
}

/** Status for a screen whose display is connected. */
function screenReadyState(output: OverlayOutput, onControlDisplay: boolean): ScreenOutputState {
  if (onControlDisplay) return { ready: true, reason: 'On the control display — showing a rehearsal window' }
  if (!followsProgram(output)) {
    return {
      ready: true,
      reason: output.playlistId ? 'Playing its own playlist — service pushes do not land here' : 'Choose a playlist to play',
    }
  }
  return { ready: true, reason: 'Live' }
}

function toDisplayInfo(display: Display, primaryId: number, controlId: number | null): DisplayInfo {
  return {
    id: display.id,
    // `label` is empty on some Linux setups — the UI falls back to "Display".
    label: display.label ?? '',
    bounds: { ...display.bounds },
    size: { ...display.size },
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId,
    hostsMainWindow: display.id === controlId,
  }
}

function identifyHtml(number: number, description: string, control: boolean): string {
  return `<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:transparent;font-family:-apple-system,'Segoe UI',sans-serif;cursor:default">
<div style="background:rgba(17,18,13,.9);color:#FFFBF4;border:2px solid #FFFBF4;border-radius:20px;padding:24px 36px;text-align:center">
<div style="font-size:88px;font-weight:700;line-height:1">${number}</div>
<div style="margin-top:10px;font-size:18px;opacity:.85">${escapeHtml(description)}</div>
${control ? '<div style="margin-top:6px;font-size:13px;color:#A29F96">Kairo’s controls are here</div>' : ''}
</div></body></html>`
}

export const surfaceManager = new SurfaceManager()

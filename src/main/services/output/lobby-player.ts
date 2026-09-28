import log from 'electron-log/main'
import type { OverlayOutput, OverlayTheme } from '@shared/ipc'
import { themeWithLiveMedia } from '@shared/media-playback'
import { mediaService } from '../media'
import type { ProgramSurface } from './program-surface'

/** How often a playing video is checked for its end. */
const VIDEO_POLL_MS = 500
/** A video that never reports an end (a broken file, a live stream) still moves on. */
const MAX_VIDEO_MS = 30 * 60 * 1000
/** Retry interval while the playlist is missing or empty. */
const IDLE_RETRY_MS = 5000

// ─── Lobby player (standalone phase 3) ────────────────────────────────────────
// Drives a `screen` output whose source is `playlist`: a foyer or lobby display
// that cycles a media-dock playlist on its own and never takes service pushes.
// Images hold for `slideSec`; videos play once, to their end. The output's
// transition (cut / fade) applies between items, as on the program.

export class LobbyPlayer {
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Bumped on every (re)start, so a stale loop iteration can tell it lost. */
  private run = 0
  private index = 0
  /** Item on screen now — a repeat of the same video rewinds instead of repainting. */
  private currentItemId: string | null = null

  constructor(
    private surface: ProgramSurface,
    private output: OverlayOutput,
  ) {}

  /** Picks up a new playlist or timing; restarts from the top when the playlist changed. */
  update(output: OverlayOutput): void {
    const playlistChanged = output.playlistId !== this.output.playlistId
    this.output = output
    if (playlistChanged) {
      this.index = 0
      this.restart()
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.restart()
  }

  stop(): void {
    this.running = false
    this.run++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private restart(): void {
    if (!this.running) return
    this.run++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    void this.step(this.run)
  }

  private wait(run: number, ms: number, next: () => void): void {
    if (run !== this.run) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (run === this.run) next()
    }, ms)
  }

  /** Shows the next playable item, then schedules the one after it. */
  private async step(run: number): Promise<void> {
    if (run !== this.run) return
    const playlist = mediaService.getLibrary().playlists.find((p) => p.id === this.output.playlistId)
    // Missing files are kept in the playlist (the dock reports them); skip them here.
    const items = (playlist?.itemIds ?? [])
      .map((id) => mediaService.getItem(id))
      .filter((item): item is NonNullable<typeof item> => !!item)
    if (items.length === 0) {
      this.wait(run, IDLE_RETRY_MS, () => void this.step(run))
      return
    }
    if (this.index >= items.length) this.index = 0
    const item = items[this.index]
    this.index = (this.index + 1) % items.length

    // Text-free frame with the item as its background. A video must not loop
    // here, or the playlist would never advance past it.
    const base: OverlayTheme = themeWithLiveMedia(this.output.theme, item, mediaService.getPlayback(item.id))
    const theme: OverlayTheme = item.kind === 'video'
      ? { ...base, background: { ...base.background, mediaLoop: false } }
      : base
    try {
      // The program keeps a background element whose file did not change, so
      // a one-video playlist would otherwise sit on its finished last frame.
      const repeatVideo = item.kind === 'video' && item.id === this.currentItemId
      let shown = true
      if (repeatVideo) {
        await this.surface.seekVideo(0)
        await this.surface.setVideoPaused(false)
      } else {
        shown = await this.surface.showSlide(this.output.id, '', '', theme)
      }
      this.currentItemId = item.id
      if (!shown) {
        this.wait(run, IDLE_RETRY_MS, () => void this.step(run))
        return
      }
    } catch (err) {
      log.warn('[Lobby] Could not show playlist item', { output: this.output.id, error: (err as Error).message })
      this.wait(run, IDLE_RETRY_MS, () => void this.step(run))
      return
    }

    if (item.kind !== 'video') {
      this.wait(run, this.output.slideSec * 1000, () => void this.step(run))
      return
    }
    const started = Date.now()
    const poll = (): void => {
      void this.surface.videoEnded().then((ended) => {
        if (run !== this.run) return
        if (ended || Date.now() - started > MAX_VIDEO_MS) void this.step(run)
        else this.wait(run, VIDEO_POLL_MS, poll)
      })
    }
    // Give the new element a moment to load before asking whether it ended.
    this.wait(run, 1000, poll)
  }
}

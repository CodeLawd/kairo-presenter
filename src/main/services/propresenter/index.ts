import log from 'electron-log/main'
import type {
  ConnectOptions,
  ProPresenterStatus,
  ProPresenterLibrary,
  ProPresenterPlaylist,
  ProPresenterPresentation,
  ProPresenterPlaylistItem,
} from '@shared/ipc'
import { ProPresenterClient } from './client'
import type { PPLibraryItem, PPPlaylist, PPStreamUpdate } from './types'
import { ndiService } from '../ndi'
import { configureProPresenterResourceClient, proPresenterResources } from './resources'

type StatusCallback = (status: ProPresenterStatus) => void

// ─── Adapters — PP API shapes → shared IPC shapes ─────────────────────────────

function adaptLibrary(items: PPLibraryItem[]): ProPresenterLibrary {
  return {
    presentations: items.map((item) => ({
      id: item.id.uuid,
      name: item.id.name,
      slides: [],
    })),
  }
}

function adaptPlaylist(pp: PPPlaylist): ProPresenterPlaylist {
  const items: ProPresenterPlaylistItem[] = (pp.items ?? []).map((item) => ({
    id: item.id.uuid,
    type: item.type === 'presentation' ? 'presentation'
         : item.type === 'video'        ? 'media'
         : 'header',
    name: item.id.name,
    presentationId: item.type === 'presentation' ? item.id.uuid : undefined,
  }))
  return { id: pp.id.uuid, name: pp.id.name, items }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class ProPresenterService {
  private client = new ProPresenterClient()
  private statusCallbacks: StatusCallback[] = []

  private status: ProPresenterStatus = {
    state: 'disconnected',
    host: 'localhost',
    port: 50000,
    version: null,
    activeSlideId: null,
    activePresentationId: null,
    activePresentationName: null,
    activePlaylistId: null,
    activePlaylistName: null,
  }

  constructor() {
    configureProPresenterResourceClient(this.client)
    this.client.on('status-change', (state) => {
      this.status = { ...this.status, state }
      if (state === 'connected') {
        proPresenterResources.invalidate()
        this.updateInitialStatus().catch((err) => {
          log.error('[PPService] updateInitialStatus failed:', err.message)
        })
      } else if (state === 'disconnected') {
        proPresenterResources.invalidate()
        this.status = {
          ...this.status,
          version: null,
          activeSlideId: null,
          activePresentationId: null,
          activePresentationName: null,
          activePlaylistId: null,
          activePlaylistName: null,
        }
      }
      this.emitStatus()
    })

    this.client.on('error', (err) => {
      log.error('[PPService] Client error', err.message)
      this.status = {
        ...this.status,
        state: 'error',
        version: null,
        activeSlideId: null,
        activePresentationId: null,
        activePresentationName: null,
        activePlaylistId: null,
        activePlaylistName: null,
      }
      this.emitStatus()
    })

    this.client.on('reconnecting', (attempt, delayMs) => {
      log.info('[PPService] Reconnecting', { attempt, delayMs })
    })

    this.client.on('update', (update: PPStreamUpdate) => {
      this.handleStreamUpdate(update)
    })
  }

  private async updateInitialStatus(): Promise<void> {
    try {
      // 1. Get version
      const versionInfo = await this.client.getVersion()
      const verStr = `${versionInfo.major}.${versionInfo.minor}.${versionInfo.patch}`
      this.status.version = verStr

      // 2. Get active presentation name
      try {
        const presRes = await this.client.getActivePresentation()
        if (presRes?.presentation) {
          const pres = presRes.presentation
          this.status.activePresentationId = pres.id?.uuid ?? null
          this.status.activePresentationName = pres.id?.name ?? null
        }
      } catch (e) {
        log.warn('[PPService] Failed to fetch active presentation name:', (e as Error).message)
      }

      // 3. Get active playlist name
      try {
        const playlistRes = await this.client.getActivePlaylist() as any
        if (playlistRes) {
          const playlist = playlistRes.presentation?.playlist || playlistRes
          if (playlist && (playlist.uuid || playlist.id?.uuid)) {
            this.status.activePlaylistId = playlist.uuid || playlist.id.uuid
            this.status.activePlaylistName = playlist.name || playlist.id?.name || null
          }
        }
      } catch (e) {
        log.warn('[PPService] Failed to fetch active playlist name:', (e as Error).message)
      }

      this.emitStatus()
    } catch (err) {
      log.error('[PPService] Error updating initial status:', (err as Error).message)
    }
  }

  // ─── Event subscriptions ───────────────────────────────────────────────────

  onStatusChange(callback: StatusCallback): void {
    this.statusCallbacks.push(callback)
  }

  private emitStatus(): void {
    const snapshot = { ...this.status }
    this.statusCallbacks.forEach((cb) => cb(snapshot))
  }

  // ─── Stream update handler ─────────────────────────────────────────────────

  private handleStreamUpdate(update: PPStreamUpdate): void {
    const url = update.url ?? ''

    if (url.includes('presentation/active')) {
      const data = update.data as { presentation?: { id?: { uuid?: string; name?: string } }; current_slide?: number } | null
      const presentationId = data?.presentation?.id?.uuid ?? null
      const presentationName = data?.presentation?.id?.name ?? null
      const slideIdx = data?.current_slide ?? null
      const slideId = presentationId && slideIdx !== null ? `${presentationId}:${slideIdx}` : null

      if (
        this.status.activePresentationId !== presentationId ||
        this.status.activePresentationName !== presentationName ||
        this.status.activeSlideId !== slideId
      ) {
        this.status = {
          ...this.status,
          activePresentationId: presentationId,
          activePresentationName: presentationName || this.status.activePresentationName,
          activeSlideId: slideId,
        }
        this.emitStatus()
      }
    }

    if (url.includes('playlist/active')) {
      const data = update.data as { presentation?: { playlist?: { uuid?: string; name?: string } } } | null
      const playlistId = data?.presentation?.playlist?.uuid ?? null
      const playlistName = data?.presentation?.playlist?.name ?? null
      if (
        this.status.activePlaylistId !== playlistId ||
        this.status.activePlaylistName !== playlistName
      ) {
        this.status = {
          ...this.status,
          activePlaylistId: playlistId,
          activePlaylistName: playlistName || this.status.activePlaylistName,
        }
        this.emitStatus()
      }
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  getStatus(): ProPresenterStatus {
    return { ...this.status }
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.status = { ...this.status, host: options.host, port: options.port }
    await this.client.connect(options.host, options.port)
  }

  async disconnect(): Promise<void> {
    this.client.disconnect()
    proPresenterResources.invalidate()
    this.status = {
      ...this.status,
      state: 'disconnected',
      activeSlideId: null,
      activePresentationId: null,
      activePlaylistId: null,
    }
    this.emitStatus()
  }

  async triggerSlide(slideId: string): Promise<void> {
    // slideId format: "{presentationUUID}:{slideIndex}"
    const sep = slideId.lastIndexOf(':')
    if (sep === -1) {
      log.warn('[PPService] triggerSlide: malformed slideId', { slideId })
      return
    }
    const presentationId = slideId.slice(0, sep)
    const slideIndex = parseInt(slideId.slice(sep + 1), 10)
    if (isNaN(slideIndex)) {
      log.warn('[PPService] triggerSlide: invalid slide index', { slideId })
      return
    }
    await this.client.triggerSlide(presentationId, slideIndex)
  }

  async clearAll(): Promise<void> {
    // Clear both PP layers: slides (presentation) and scripture overlay (messages),
    // plus (D2) reset the NDI overlay window/sender back to a blank frame.
    ndiService.clearFrame()
    await Promise.all([this.client.clearAll(), this.client.clearMessages()])
  }

  async getLibrary(): Promise<ProPresenterLibrary> {
    const items = await this.client.getLibrary()
    return adaptLibrary(items)
  }

  async getPlaylists(): Promise<ProPresenterPlaylist[]> {
    const playlists = await this.client.getPlaylists()
    return playlists.map(adaptPlaylist)
  }

  // ─── Passthrough to client for advanced use ────────────────────────────────

  get rawClient(): ProPresenterClient {
    return this.client
  }
}

export const proPresenterService = new ProPresenterService()
export type { ProPresenterPresentation }

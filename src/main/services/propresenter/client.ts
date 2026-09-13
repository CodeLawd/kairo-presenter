/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- typed EventEmitter idiom: `declare interface` refines the inherited emitter surface. */
/* eslint-disable @typescript-eslint/no-explicit-any -- ProPresenter's HTTP API is untyped; every response is normalized defensively at its call site. */
import { EventEmitter } from 'events'
import http from 'http'
import axios, { type AxiosInstance, type AxiosError } from 'axios'
import log from 'electron-log/main'
import { proPresenterConnectAttempts, proPresenterHttpTimeoutMs } from '@shared/pp-http'
import type {
  PPVersionResponse,
  PPLibrary,
  PPLibraryItem,
  PPPlaylist,
  PPPresentation,
  PPActivePresentationResponse,
  PPStatusResponse,
  PPStreamUpdate,
  PPCreateSlide,
  PPSlideGroupSpec,
  PPCreatePresentationRequest,
  PPConnectionState,
  PPTextElement,
  PPMessage,
  PPMessageToken,
  PPVideoInput,
  PPLookSummary,
  PPBinaryAsset,
  PPResourceCollectionEnvelope,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Name of the message template Kairo creates/reuses for scripture overlays. */
const SCRIPTURE_MESSAGE_NAME = 'Kairo Scripture'
const LEGACY_SCRIPTURE_MESSAGE_NAME = 'ProAutomate Scripture'
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const STREAM_BUFFER_MAX = 1_024 * 1_024 // 1 MB safety cap
const RESOURCE_BINARY_MAX_BYTES = 5 * 1024 * 1024
const RESOURCE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface PPCreatePresentationOptions {
  /** Stable UUID of an existing ProPresenter theme. */
  themeId?: string
}

// ─── Typed EventEmitter ───────────────────────────────────────────────────────

interface PPClientEventMap {
  connected: [version: PPVersionResponse]
  disconnected: []
  error: [err: Error]
  reconnecting: [attempt: number, delayMs: number]
  update: [update: PPStreamUpdate]
  'status-change': [state: PPConnectionState]
}

export declare interface ProPresenterClient {
  on<K extends keyof PPClientEventMap>(event: K, listener: (...args: PPClientEventMap[K]) => void): this
  emit<K extends keyof PPClientEventMap>(event: K, ...args: PPClientEventMap[K]): boolean
  off<K extends keyof PPClientEventMap>(event: K, listener: (...args: PPClientEventMap[K]) => void): this
  once<K extends keyof PPClientEventMap>(event: K, listener: (...args: PPClientEventMap[K]) => void): this
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class ProPresenterClient extends EventEmitter {
  private host = 'localhost'
  private port = 50000
  private _state: PPConnectionState = 'disconnected'
  private http: AxiosInstance
  private streamReq: http.ClientRequest | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private lastPollData: string | null = null
  private cachedLibraryId: string | null = null
  private cachedScriptureMessageId: string | null = null
  private cachedScriptureMessageTemplate: string | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private reconnectDelay = RECONNECT_BASE_MS
  private destroyed = false
  private httpAgent: http.Agent | null = null
  /**
   * Bumped by every `connect()`. A run whose generation is stale has been
   * superseded — it must not report its own outcome, or a background reconnect
   * to the previous host will land its failure on top of the connection the
   * operator just made by hand (they see "no response" while ProPresenter is
   * plainly answering).
   */
  private connectGeneration = 0

  constructor() {
    super()
    this.http = this.buildAxios()
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._state === 'connected'
  }

  get connectionState(): PPConnectionState {
    return this._state
  }

  private setState(state: PPConnectionState): void {
    if (this._state === state) return
    this._state = state
    this.emit('status-change', state)
  }

  // ─── Axios factory ─────────────────────────────────────────────────────────

  private buildAxios(): AxiosInstance {
    this.httpAgent?.destroy()
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 })
    return axios.create({
      baseURL: `http://${this.host}:${this.port}`,
      timeout: proPresenterHttpTimeoutMs(this.host),
      httpAgent: this.httpAgent,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    })
  }

  private rebuildAxios(): void {
    this.http = this.buildAxios()
  }

  // ─── Connection management ─────────────────────────────────────────────────

  async connect(host: string, port: number): Promise<void> {
    this.destroyed = false
    const generation = ++this.connectGeneration
    const superseded = (): boolean => this.destroyed || generation !== this.connectGeneration
    if (host !== this.host || port !== this.port) {
      this.cachedLibraryId = null
      this.cachedScriptureMessageId = null
      this.cachedScriptureMessageTemplate = null
    }
    this.host = host
    this.port = port
    this.rebuildAxios()

    this.clearReconnectTimer()
    this.setState('connecting')
    const timeoutMs = proPresenterHttpTimeoutMs(host)
    const attempts = proPresenterConnectAttempts(host)
    log.info('[PP] Connecting', { host, port, timeoutMs, attempts })

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (superseded()) return
      try {
        const version = await this.getVersion()
        if (superseded()) return
        this.resetReconnect()
        this.setState('connected')
        log.info('[PP] Connected', { version: `${version.major}.${version.minor}.${version.patch}` })
        this.emit('connected', version)
        this.startStream()
        return
      } catch (err) {
        lastError = this.normalizeError(err)
        log.warn('[PP] Connect attempt failed', {
          attempt,
          attempts,
          timeoutMs,
          error: lastError.message,
        })
      }
    }

    if (superseded()) return

    const error = lastError ?? new Error('Connection failed')
    log.error('[PP] Connection failed', error.message)
    this.setState('error')
    this.emit('error', error)
    this.scheduleReconnect()
  }

  disconnect(): void {
    this.destroyed = true
    this.clearReconnectTimer()
    this.closeStream()
    this.setState('disconnected')
    this.emit('disconnected')
    log.info('[PP] Disconnected')
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    this.reconnectAttempt++
    const delay = Math.min(this.reconnectDelay, RECONNECT_MAX_MS)
    log.info('[PP] Reconnecting', { attempt: this.reconnectAttempt, delayMs: delay })
    this.emit('reconnecting', this.reconnectAttempt, delay)

    const generation = this.connectGeneration
    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed || generation !== this.connectGeneration) return
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
      await this.connect(this.host, this.port)
    }, delay)
  }

  private resetReconnect(): void {
    this.reconnectAttempt = 0
    this.reconnectDelay = RECONNECT_BASE_MS
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ─── Chunked stream ────────────────────────────────────────────────────────

  private startStream(): void {
    if (this.streamReq) return

    // POST /v1/status/updates takes an array of bare status paths to aggregate.
    // Anything else — an object, or paths carrying the /v1/ prefix — is a 400.
    const streamBody = JSON.stringify(['presentation/active'])
    const options: http.RequestOptions = {
      hostname: this.host,
      port: this.port,
      path: '/v1/status/updates',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(streamBody),
      },
      timeout: 0,
    }

    const makeRequest = (): void => {
      if (this.destroyed || !this.isConnected) return

      let buffer = ''

      try {
        this.streamReq = http.request(options, (res) => {
          log.debug('[PP] Stream connected', { status: res.statusCode })

          if (res.statusCode === 404) {
            log.warn('[PP] Status updates endpoint not found (404) — falling back to 2s polling of /v1/presentation/active')
            this.streamReq = null
            this.startPolling()
            return
          }

          if (res.statusCode && res.statusCode >= 400) {
            log.warn('[PP] Stream rejected', { status: res.statusCode, msg: 'falling back to polling' })
            this.streamReq = null
            this.startPolling()
            return
          }

          res.setEncoding('utf8')

          res.on('data', (chunk: string) => {
            buffer += chunk

            // Safety: prevent unbounded buffer growth
            if (buffer.length > STREAM_BUFFER_MAX) {
              log.warn('[PP] Stream buffer overflow — resetting')
              buffer = ''
              return
            }

            // Each chunk may contain one or more newline-delimited JSON objects
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? '' // keep incomplete trailing line

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue
              try {
                const update = JSON.parse(trimmed) as PPStreamUpdate
                this.emit('update', update)
              } catch {
                // Partial or malformed chunk — skip
              }
            }
          })

          res.on('end', () => {
            log.warn('[PP] Stream ended — will reconnect stream')
            this.streamReq = null
            if (!this.destroyed && this.isConnected) {
              setTimeout(makeRequest, 1_000)
            }
          })

          res.on('error', (err) => {
            log.error('[PP] Stream response error', err.message)
            this.streamReq = null
            if (!this.destroyed && this.isConnected) {
              setTimeout(makeRequest, 2_000)
            }
          })
        })

        this.streamReq.on('error', (err) => {
          log.error('[PP] Stream request error', err.message)
          this.streamReq = null
          if (!this.destroyed) {
            this.setState('error')
            this.emit('error', err)
            this.scheduleReconnect()
          }
        })

        this.streamReq.write(streamBody)
        this.streamReq.end()
      } catch (err) {
        log.error('[PP] Failed to open stream', this.normalizeError(err).message)
        this.streamReq = null
      }
    }

    makeRequest()
  }

  private startPolling(): void {
    if (this.pollTimer) return
    log.info('[PP] Starting 2s polling fallback — polling /v1/presentation/active')
    const poll = async (): Promise<void> => {
      if (this.destroyed || !this.isConnected) return
      try {
        const { data } = await this.http.get<any>('/v1/presentation/active')
        const serialized = JSON.stringify(data)
        if (serialized !== this.lastPollData) {
          this.lastPollData = serialized
          this.emit('update', { url: '/v1/presentation/active', data } as PPStreamUpdate)
        }
      } catch {
        // ignore transient poll errors
      }
      if (!this.destroyed && this.isConnected) {
        this.pollTimer = setTimeout(poll, 2_000)
      }
    }
    this.pollTimer = setTimeout(poll, 0)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.lastPollData = null
  }

  private closeStream(): void {
    this.stopPolling()
    if (this.streamReq) {
      try {
        this.streamReq.destroy()
      } catch {
        // ignore
      }
      this.streamReq = null
    }
  }

  // ─── Error helpers ─────────────────────────────────────────────────────────

  private normalizeError(err: unknown): Error {
    if (err instanceof Error) return err
    return new Error(String(err))
  }

  private logAxiosError(method: string, err: unknown): void {
    const e = err as AxiosError
    if (e.response) {
      log.error(`[PP] ${method} — HTTP ${e.response.status}`, e.response.data)
    } else if (e.request) {
      log.error(`[PP] ${method} — No response (timeout or unreachable)`)
    } else {
      log.error(`[PP] ${method} — ${e.message}`)
    }
  }

  // ─── Read-only resource requests ──────────────────────────────────────────

  /**
   * Reads a collection while tolerating the envelopes used by different PP
   * versions. Unsupported endpoints become an empty collection so discovery
   * can continue with the categories that are available.
   */
  async getResourceCollection(path: string): Promise<unknown[]> {
    return (await this.getResourceCollectionOutcome(path)).items
  }

  async getResourceCollectionOutcome(path: string): Promise<{ items: unknown[]; error?: unknown }> {
    try {
      const { data } = await this.http.get<unknown>(path)
      if (Array.isArray(data)) return { items: data }
      if (!data || typeof data !== 'object') return { items: [] }

      const envelope = data as PPResourceCollectionEnvelope
      for (const key of ['items', 'collections', 'data', 'resources'] as const) {
        if (Array.isArray(envelope[key])) return { items: envelope[key] as unknown[] }
      }
      return { items: [] }
    } catch (err) {
      this.logAxiosError(`getResourceCollection(${path})`, err)
      return { items: [], error: err }
    }
  }

  /** Reads one resource detail without allowing a detail failure to escape. */
  async getResourceDetails(path: string): Promise<Record<string, unknown> | null> {
    try {
      const { data } = await this.http.get<unknown>(path)
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null
      const record = data as Record<string, unknown>
      if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
        return record.data as Record<string, unknown>
      }
      return record
    } catch (err) {
      this.logAxiosError(`getResourceDetails(${path})`, err)
      return null
    }
  }

  /**
   * Reads an approved image format into an owned byte array. The response is
   * deliberately GET-only and bounded before it crosses into the cache.
   */
  async getBinaryAsset(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<PPBinaryAsset | null> {
    try {
      const response = await this.http.get<ArrayBuffer | Uint8Array>(path, {
        params,
        responseType: 'arraybuffer',
      })
      const mimeType = String(response.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
      if (!RESOURCE_IMAGE_MIME_TYPES.has(mimeType)) {
        log.warn('[PP] Resource preview returned unsupported MIME type', { path, mimeType })
        return null
      }

      const data = response.data
      const bytes = data instanceof Uint8Array
        ? Uint8Array.from(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data.slice(0))
          : null
      if (!bytes || bytes.byteLength > RESOURCE_BINARY_MAX_BYTES) {
        log.warn('[PP] Resource preview exceeded the 5 MiB limit', {
          path,
          bytes: bytes?.byteLength ?? 0,
        })
        return null
      }

      return { mimeType, bytes }
    } catch (err) {
      this.logAxiosError(`getBinaryAsset(${path})`, err)
      return null
    }
  }

  private resourcePath(...segments: string[]): string {
    return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
  }

  // Collection/detail wrappers keep endpoint knowledge in the main process.
  async getThemes(): Promise<unknown[]> { return this.getResourceCollection('/v1/themes') }
  async getTheme(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'theme', id))
  }
  async getMacros(): Promise<unknown[]> { return this.getResourceCollection('/v1/macros') }
  async getMacroCollections(): Promise<unknown[]> { return this.getResourceCollection('/v1/macro_collections') }
  async getMacro(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'macro', id))
  }
  async getLook(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'look', id))
  }
  async getMessage(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'message', id))
  }
  async getProps(): Promise<unknown[]> { return this.getResourceCollection('/v1/props') }
  async getPropCollections(): Promise<unknown[]> { return this.getResourceCollection('/v1/prop_collections') }
  async getProp(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'prop', id))
  }
  async getMessagesCollection(): Promise<unknown[]> { return this.getResourceCollection('/v1/messages') }
  async getMediaPlaylists(): Promise<unknown[]> { return this.getResourceCollection('/v1/media/playlists') }
  async getMediaPlaylist(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'media', 'playlist', id))
  }
  async getMasks(): Promise<unknown[]> { return this.getResourceCollection('/v1/masks') }
  async getMask(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'mask', id))
  }
  async getStageLayouts(): Promise<unknown[]> { return this.getResourceCollection('/v1/stage/layouts') }
  async getStageScreens(): Promise<unknown[]> { return this.getResourceCollection('/v1/stage/screens') }
  async getStageLayout(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'stage', 'layout', id))
  }
  async getClearGroups(): Promise<unknown[]> { return this.getResourceCollection('/v1/clear/groups') }
  async getLibraryDetails(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'library', id))
  }
  async getPlaylistDetails(id: string): Promise<Record<string, unknown> | null> {
    return this.getResourceDetails(this.resourcePath('v1', 'playlist', id))
  }

  // Lazy preview wrappers. `childId` is used for a theme slide; all segments
  // are encoded independently so a UUID/name can never escape its path slot.
  async getThemeSlideThumbnail(themeId: string, childId: string, params: Record<string, string | number> = {}): Promise<PPBinaryAsset | null> {
    return this.getBinaryAsset(this.resourcePath('v1', 'theme', themeId, 'slides', childId, 'thumbnail'), params)
  }
  async getPropThumbnail(id: string, params: Record<string, string | number> = {}): Promise<PPBinaryAsset | null> {
    return this.getBinaryAsset(this.resourcePath('v1', 'prop', id, 'thumbnail'), params)
  }
  async getMaskThumbnail(id: string, params: Record<string, string | number> = {}): Promise<PPBinaryAsset | null> {
    return this.getBinaryAsset(this.resourcePath('v1', 'mask', id, 'thumbnail'), params)
  }
  async getMediaThumbnail(id: string, params: Record<string, string | number> = {}): Promise<PPBinaryAsset | null> {
    return this.getBinaryAsset(this.resourcePath('v1', 'media', id, 'thumbnail'), params)
  }
  async getStageLayoutThumbnail(id: string, params: Record<string, string | number> = {}): Promise<PPBinaryAsset | null> {
    return this.getBinaryAsset(this.resourcePath('v1', 'stage', 'layout', id, 'thumbnail'), params)
  }
  async getMacroIcon(id: string, params: Record<string, string | number> = {}): Promise<PPBinaryAsset | null> {
    return this.getBinaryAsset(this.resourcePath('v1', 'macro', id, 'icon'), params)
  }

  // ─── Version ───────────────────────────────────────────────────────────────

  async getVersion(): Promise<PPVersionResponse> {
    try {
      const { data } = await this.http.get<any>('/version')
      let major = 7
      let minor = 0
      let patch = 0
      let build_number = ''
      
      if (data && typeof data.host_description === 'string') {
        const match = data.host_description.match(/ProPresenter\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/i)
        if (match) {
          major = parseInt(match[1], 10)
          minor = match[2] ? parseInt(match[2], 10) : 0
          patch = match[3] ? parseInt(match[3], 10) : 0
        }
      } else if (data && typeof data.version === 'object') {
        major = data.version.major || 7
        minor = data.version.minor || 0
        patch = data.version.patch || 0
        build_number = String(data.version.build || '')
      }

      return {
        major,
        minor,
        patch,
        build_number: build_number || String(data.build_number || ''),
        os_version: data.os_version
      }
    } catch (err) {
      this.logAxiosError('getVersion', err)
      throw this.normalizeError(err)
    }
  }

  // ─── Library ───────────────────────────────────────────────────────────────

  async getLibraries(): Promise<PPLibrary[]> {
    try {
      const { data } = await this.http.get<any>('/v1/libraries')
      // PP returns flat [{uuid, name, index}] — normalize to PPLibrary shape
      const raw: any[] = Array.isArray(data) ? data : (data?.items ?? [])
      return raw.map((item) => ({
        id: {
          uuid:  item.uuid  ?? item.id?.uuid  ?? '',
          name:  item.name  ?? item.id?.name  ?? '',
          index: item.index ?? item.id?.index ?? 0,
        },
      }))
    } catch (err) {
      this.logAxiosError('getLibraries', err)
      return []
    }
  }

  /**
   * Lists presentations in one library, or across every library when no id is
   * given. There is no endpoint that returns all presentations at once —
   * `/v1/library` is a 404 — so the aggregate case fans out over `/v1/libraries`.
   */
  async getLibrary(libraryId?: string): Promise<PPLibraryItem[]> {
    if (!libraryId) {
      const libraries = await this.getLibraries()
      const items: PPLibraryItem[] = []
      const seen = new Set<string>()
      for (const library of libraries) {
        const id = library.id.uuid || library.id.name
        if (!id) continue
        for (const item of await this.getLibrary(id)) {
          const key = item.id.uuid || `${library.id.name}/${item.id.name}`
          if (seen.has(key)) continue
          seen.add(key)
          items.push(item)
        }
      }
      return items
    }

    try {
      const { data } = await this.http.get<any>(`/v1/library/${encodeURIComponent(libraryId)}`)
      // PP returns {update_type, items: [{uuid, name, index}]} — normalize to PPLibraryItem shape
      const raw: any[] = Array.isArray(data) ? data : (data?.items ?? [])
      return raw.map((item) => ({
        id: {
          uuid:  item.uuid  ?? item.id?.uuid  ?? '',
          name:  item.name  ?? item.id?.name  ?? '',
          index: item.index ?? item.id?.index ?? 0,
        },
      }))
    } catch (err) {
      this.logAxiosError('getLibrary', err)
      return []
    }
  }

  private async fetchFirstLibraryId(): Promise<string | null> {
    const libs = await this.getLibraries()
    if (libs.length > 0) {
      const id = libs[0].id?.uuid ?? libs[0].id?.name ?? null
      if (id) {
        log.info('[PP] Using library', { id, name: libs[0].id?.name })
        return id
      }
    }
    log.warn('[PP] No libraries found — using "Default" fallback')
    return 'Default'
  }

  /**
   * Search all libraries for a presentation matching the given scripture reference.
   * Matching is case-insensitive and treats `_` and `:` as equivalent (PP uses `_`
   * in filenames where `:` would be invalid, e.g. "John 3_16" matches "John 3:16").
   */
  async searchLibraries(
    reference: string
  ): Promise<{ libraryId: string; presentationName: string } | null> {
    const normalize = (s: string): string =>
      s.toLowerCase().replace(/_/g, ':').replace(/–|—/g, '-').replace(/\s+/g, ' ').trim()

    // Strip trailing translation parens for a shorter query: "John 3:16 (KJV)" → "john 3:16"
    const stripTranslation = (s: string): string => s.replace(/\s*\([^)]*\)\s*$/, '').trim()

    const queryNorm = normalize(reference)

    const libs = await this.getLibraries()
    for (const lib of libs) {
      const libId = lib.id.uuid || lib.id.name
      if (!libId) continue
      const items = await this.getLibrary(libId)
      for (const item of items) {
        const nameNorm = normalize(item.id.name)
        const nameCore = normalize(stripTranslation(item.id.name))
        if (nameNorm.includes(queryNorm) || nameCore === queryNorm || queryNorm.includes(nameCore)) {
          log.info('[PP] Library match found', { libId, name: item.id.name, query: reference })
          return { libraryId: libId, presentationName: item.id.name }
        }
      }
    }

    log.warn('[PP] No library match found', { reference })
    return null
  }

  async triggerLibraryPresentation(libraryId: string, presentationName: string): Promise<boolean> {
    try {
      await this.http.get(
        `/v1/library/${encodeURIComponent(libraryId)}/${encodeURIComponent(presentationName)}/trigger`
      )
      log.info('[PP] Library presentation triggered', { libraryId, presentationName })
      return true
    } catch (err) {
      this.logAxiosError('triggerLibraryPresentation', err)
      return false
    }
  }

  // ─── Playlists ─────────────────────────────────────────────────────────────

  async getPlaylists(): Promise<PPPlaylist[]> {
    try {
      const { data } = await this.http.get<unknown>('/v1/playlists')
      // Index payload is usually a flat array of { id }; sometimes wrapped.
      // Items live on GET /v1/playlist/{id} — do not assume they are here.
      const raw: unknown[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { data?: unknown[] } | null)?.data)
          ? ((data as { data: unknown[] }).data)
          : Array.isArray((data as { playlists?: unknown[] } | null)?.playlists)
            ? ((data as { playlists: unknown[] }).playlists)
            : []
      return raw.filter((entry): entry is PPPlaylist => {
        const id = (entry as PPPlaylist | null)?.id
        return Boolean(id?.uuid && id?.name != null)
      })
    } catch (err) {
      this.logAxiosError('getPlaylists', err)
      return []
    }
  }

  async getPlaylistItems(playlistId: string): Promise<PPPlaylist | null> {
    try {
      const { data } = await this.http.get<PPPlaylist>(`/v1/playlist/${encodeURIComponent(playlistId)}`)
      return data
    } catch (err) {
      this.logAxiosError('getPlaylistItems', err)
      return null
    }
  }

  async getActivePlaylist(): Promise<PPPlaylist | null> {
    try {
      const { data } = await this.http.get<PPPlaylist>('/v1/playlist/active')
      return data
    } catch (err) {
      this.logAxiosError('getActivePlaylist', err)
      return null
    }
  }

  // ─── Presentation control ──────────────────────────────────────────────────

  async getActivePresentation(): Promise<PPActivePresentationResponse | null> {
    try {
      const { data } = await this.http.get<PPActivePresentationResponse>('/v1/presentation/active')
      return data
    } catch (err) {
      this.logAxiosError('getActivePresentation', err)
      return null
    }
  }

  async getPresentation(presentationId: string): Promise<PPPresentation | null> {
    try {
      const { data } = await this.http.get<PPPresentation>(
        `/v1/presentation/${encodeURIComponent(presentationId)}`
      )
      return data
    } catch (err) {
      this.logAxiosError('getPresentation', err)
      return null
    }
  }

  async triggerSlide(presentationId: string, slideIndex: number): Promise<boolean> {
    // Library path (if we have a cached library ID)
    if (this.cachedLibraryId) {
      try {
        await this.http.get(
          `/v1/library/${encodeURIComponent(this.cachedLibraryId)}/${encodeURIComponent(presentationId)}/${slideIndex}/trigger`
        )
        log.info('[PP] Slide triggered (library path)', { presentationId, slideIndex })
        return true
      } catch {
        log.debug('[PP] Library trigger failed, trying UUID path')
      }
    }
    // UUID-based trigger: /{uuid}/{index}/trigger
    try {
      await this.http.get(
        `/v1/presentation/${encodeURIComponent(presentationId)}/${slideIndex}/trigger`
      )
      log.info('[PP] Slide triggered (UUID path)', { presentationId, slideIndex })
      return true
    } catch {
      log.debug('[PP] UUID/{index}/trigger failed, trying first-cue trigger')
    }
    // Trigger from beginning (no index)
    try {
      await this.http.get(`/v1/presentation/${encodeURIComponent(presentationId)}/trigger`)
      log.info('[PP] Slide triggered (first-cue fallback)', { presentationId })
      return true
    } catch (err) {
      this.logAxiosError('triggerSlide', err)
      return false
    }
  }

  async triggerNextSlide(): Promise<boolean> {
    // PP20: /v1/trigger/next (confirmed 204)
    try {
      await this.http.get('/v1/trigger/next')
      log.info('[PP] Next slide triggered')
      return true
    } catch {
      log.debug('[PP] /v1/trigger/next failed, trying legacy path')
    }
    try {
      await this.http.get('/v1/presentation/active/next')
      log.info('[PP] Next slide triggered (legacy)')
      return true
    } catch (err) {
      this.logAxiosError('triggerNextSlide', err)
      return false
    }
  }

  async triggerPreviousSlide(): Promise<boolean> {
    // PP20: /v1/trigger/previous
    try {
      await this.http.get('/v1/trigger/previous')
      log.info('[PP] Previous slide triggered')
      return true
    } catch {
      log.debug('[PP] /v1/trigger/previous failed, trying legacy path')
    }
    try {
      await this.http.get('/v1/presentation/active/previous')
      log.info('[PP] Previous slide triggered (legacy)')
      return true
    } catch (err) {
      this.logAxiosError('triggerPreviousSlide', err)
      return false
    }
  }

  // ─── Content pushing ───────────────────────────────────────────────────────

  private buildPresentationBody(
    name: string,
    slideGroups: PPCreatePresentationRequest['slide_groups'],
    options: PPCreatePresentationOptions = {},
  ): PPCreatePresentationRequest {
    const themeId = options.themeId?.trim()
    return {
      id: { name },
      ...(themeId ? { theme: { uuid: themeId, name: '', index: 0 } } : {}),
      slide_groups: slideGroups,
    }
  }

  async createPresentation(
    name: string,
    slides: PPCreateSlide[],
    options: PPCreatePresentationOptions = {},
  ): Promise<PPPresentation | null> {
    const defaultSlideArea: PPTextElement = {
      text: '',
      position: { x: 0.0, y: 0.0, width: 1.0, height: 1.0 },
    }

    const body = this.buildPresentationBody(name, [
      {
        id: { name: 'Main' },
        slides: slides.map((slide, i) => ({
          id: { name: slide.label || `Slide ${i + 1}` },
          label: slide.label,
          notes: slide.notes ?? '',
          text_elements: slide.lines.length > 0
            ? slide.lines.map((line) => ({ ...defaultSlideArea, text: line }))
            : [defaultSlideArea],
        })),
      },
    ], options)

    return this.postPresentation(name, body, slides.length)
  }

  async createGroupedPresentation(
    name: string,
    groups: PPSlideGroupSpec[],
    options: PPCreatePresentationOptions = {},
  ): Promise<PPPresentation | null> {
    const defaultArea: PPTextElement = {
      text: '',
      position: { x: 0.0, y: 0.0, width: 1.0, height: 1.0 },
    }

    const body = this.buildPresentationBody(name, groups.map((group) => ({
      id: { name: group.name },
      slides: group.slides.map((slide, i) => ({
        id: { name: slide.label || `${group.name} ${i + 1}` },
        label: slide.label,
        notes: slide.notes ?? '',
        text_elements:
          slide.lines.length > 0
            ? slide.lines.map((line) => ({ ...defaultArea, text: line }))
            : [defaultArea],
      })),
    })), options)

    return this.postPresentation(name, body, groups.length)
  }

  private async postPresentation(
    name: string,
    body: PPCreatePresentationRequest,
    count: number
  ): Promise<PPPresentation | null> {
    if (!this.cachedLibraryId) {
      this.cachedLibraryId = await this.fetchFirstLibraryId()
    }

    const libId = this.cachedLibraryId ?? 'Default'
    const encodedLib  = encodeURIComponent(libId)
    const encodedName = encodeURIComponent(name)

    // PP7: PUT /v1/library/{library_id}/{presentation_name}
    try {
      const { data } = await this.http.put<PPPresentation>(
        `/v1/library/${encodedLib}/${encodedName}`,
        body
      )
      log.info('[PP] Presentation created (PUT)', { name, count, libId })
      // PUT may return 204 with empty body — construct a minimal result so caller can trigger
      if (data && data.id?.uuid) return data
      return { id: { uuid: name, name, index: 0 }, slide_groups: [] }
    } catch (err) {
      this.logAxiosError('createPresentation(PUT)', err)
    }

    // Fallback: POST /v1/library (older builds)
    try {
      const { data } = await this.http.post<PPPresentation>('/v1/library', body)
      log.info('[PP] Presentation created (POST fallback)', { name, count })
      return data
    } catch (err) {
      this.logAxiosError('createPresentation(POST)', err)
      return null
    }
  }

  /**
   * Takes down everything this app can put on screen.
   *
   * PP19 clear endpoints are GET (POST returns 404), and the presentation layer
   * is named `slide` — `/v1/clear/layer/presentation` 404s, which meant this
   * used to fail without clearing anything. Verified against PP 19.0.1: the
   * accepted names are audio, props, messages, announcements, slide, media and
   * video_input; presentation, background and all are rejected.
   *
   * `video_input` is cleared by default for a full PP reset. Callers clearing
   * ProAutomate's own output can pass `{ clearVideoInput: false }` to preserve
   * the operator's selected input while the NDI frame is blanked separately.
   */
  async clearAll(options: { clearVideoInput?: boolean } = {}): Promise<boolean> {
    const layers = options.clearVideoInput === false
      ? (['slide'] as const)
      : (['slide', 'video_input'] as const)
    const results = await Promise.all(
      layers.map(async (layer) => {
        try {
          await this.http.get(`/v1/clear/layer/${layer}`)
          return true
        } catch (err) {
          this.logAxiosError(`clearAll(${layer})`, err)
          return false
        }
      }),
    )
    const ok = results.every(Boolean)
    if (ok) {
      log.info(options.clearVideoInput === false
        ? '[PP] Slide layer cleared; video-input selection preserved'
        : '[PP] Slide and video-input layers cleared')
    }
    return ok
  }

  async clearMessages(): Promise<boolean> {
    try {
      await this.http.get('/v1/clear/layer/messages')
      log.info('[PP] Messages layer cleared')
      return true
    } catch (err) {
      this.logAxiosError('clearMessages', err)
      return false
    }
  }

  // ─── Messages (scripture overlay) ──────────────────────────────────────────

  async getMessages(): Promise<PPMessage[]> {
    try {
      const { data } = await this.http.get<PPMessage[]>('/v1/messages')
      return Array.isArray(data) ? data : []
    } catch (err) {
      this.logAxiosError('getMessages', err)
      return []
    }
  }

  /**
   * Find (or create) the "Kairo Scripture" message template and return
   * its UUID. The template holds two tokens — Reference and Text — whose values
   * are filled on every trigger. Styling lives in ProPresenter (Messages panel),
   * so users can restyle it once and every push inherits the look.
   *
   * If the caller-supplied `template` differs from the message's current
   * `message` string (e.g. the user edited it in Settings), the existing
   * message is updated via PUT before its UUID is returned.
   */
  private async ensureScriptureMessage(template: string): Promise<string | null> {
    // Fast path: uuid cached and template unchanged since last sync — skip the
    // extra GET /v1/messages round trip.
    if (this.cachedScriptureMessageId && this.cachedScriptureMessageTemplate === template) {
      return this.cachedScriptureMessageId
    }

    const messages = await this.getMessages()
    const existing = this.cachedScriptureMessageId
      ? messages.find((m) => m.id?.uuid === this.cachedScriptureMessageId)
      : messages.find((m) => m.id?.name === SCRIPTURE_MESSAGE_NAME)
        ?? messages.find((m) => m.id?.name === LEGACY_SCRIPTURE_MESSAGE_NAME)

    if (existing?.id?.uuid) {
      this.cachedScriptureMessageId = existing.id.uuid
      if (existing.message !== template) {
        await this.updateScriptureMessageTemplate(existing, template)
      }
      this.cachedScriptureMessageTemplate = template
      return existing.id.uuid
    }

    // PP19 requires every field below — omitting any returns 400
    try {
      const { data } = await this.http.post<PPMessage>('/v1/messages', {
        id: { name: SCRIPTURE_MESSAGE_NAME },
        message: template,
        tokens: [
          { name: 'Reference', text: { text: '' } },
          { name: 'Text', text: { text: '' } },
        ],
        theme: { uuid: '', name: '', index: 0 },
        visible_on_network: false,
        is_active: false,
      })
      const uuid = data?.id?.uuid ?? null
      if (uuid) {
        this.cachedScriptureMessageId = uuid
        this.cachedScriptureMessageTemplate = template
        log.info('[PP] Scripture message template created', { uuid, template })
      }
      return uuid
    } catch (err) {
      this.logAxiosError('ensureScriptureMessage', err)
      return null
    }
  }

  /** PUT the full message body back with an updated `message` template string. */
  private async updateScriptureMessageTemplate(existing: PPMessage, template: string): Promise<void> {
    try {
      await this.http.put(`/v1/message/${encodeURIComponent(existing.id.uuid)}`, {
        id: existing.id,
        message: template,
        tokens: existing.tokens,
        theme: existing.theme,
        visible_on_network: existing.visible_on_network,
        is_active: existing.is_active,
      })
      log.info('[PP] Scripture message template updated', { uuid: existing.id.uuid, template })
    } catch (err) {
      this.logAxiosError('updateScriptureMessageTemplate', err)
    }
  }

  /** Push scripture text to the audience output via the messages layer. */
  async showScriptureMessage(reference: string, text: string, template: string): Promise<boolean> {
    const uuid = await this.ensureScriptureMessage(template)
    if (!uuid) return false

    const tokens: PPMessageToken[] = [
      { name: 'Reference', text: { text: reference } },
      { name: 'Text', text: { text } },
    ]

    try {
      await this.http.post(`/v1/message/${encodeURIComponent(uuid)}/trigger`, tokens)
      log.info('[PP] Scripture message shown', { reference })
      return true
    } catch (err) {
      // Template may have been deleted in PP since we cached it — recreate once
      this.cachedScriptureMessageId = null
      this.cachedScriptureMessageTemplate = null
      const retryUuid = await this.ensureScriptureMessage(template)
      if (retryUuid && retryUuid !== uuid) {
        try {
          await this.http.post(`/v1/message/${encodeURIComponent(retryUuid)}/trigger`, tokens)
          log.info('[PP] Scripture message shown (after recreate)', { reference })
          return true
        } catch (retryErr) {
          this.logAxiosError('showScriptureMessage(retry)', retryErr)
          return false
        }
      }
      this.logAxiosError('showScriptureMessage', err)
      return false
    }
  }

  /** Triggers an operator-selected message without creating or updating it. */
  async showBoundMessage(messageId: string, reference: string, text: string): Promise<boolean> {
    const tokens: PPMessageToken[] = [
      { name: 'Reference', text: { text: reference } },
      { name: 'Text', text: { text } },
    ]

    try {
      await this.http.post(`/v1/message/${encodeURIComponent(messageId)}/trigger`, tokens)
      log.info('[PP] Bound message shown', { messageId, reference })
      return true
    } catch (err) {
      this.logAxiosError('showBoundMessage', err)
      return false
    }
  }

  /** Confirms that a durable binding still resolves in the connected PP workspace. */
  async resourceExists(kind: string, id: string): Promise<boolean> {
    if (!id.trim()) return false
    switch (kind) {
      case 'theme': return (await this.getTheme(id)) !== null
      case 'macro': return (await this.getMacro(id)) !== null
      case 'look': return (await this.getLook(id)) !== null
      case 'message': return (await this.getMessage(id)) !== null
      case 'prop': return (await this.getProp(id)) !== null
      case 'media': return (await this.getMediaPlaylist(id)) !== null
      case 'mask': return (await this.getMask(id)) !== null
      case 'stageLayout': return (await this.getStageLayout(id)) !== null
      case 'clearGroup': return (await this.getResourceDetails(this.resourcePath('v1', 'clear', 'group', id))) !== null
      case 'library': return (await this.getLibraryDetails(id)) !== null
      case 'playlist': return (await this.getPlaylistDetails(id)) !== null
      case 'videoInput': return (await this.getVideoInputs()).some((input) => input.uuid === id)
      default: return false
    }
  }

  async clearScriptureMessage(): Promise<boolean> {
    if (!this.cachedScriptureMessageId) return true
    try {
      await this.http.get(`/v1/message/${encodeURIComponent(this.cachedScriptureMessageId)}/clear`)
      log.info('[PP] Scripture message cleared')
      return true
    } catch (err) {
      this.logAxiosError('clearScriptureMessage', err)
      return false
    }
  }

  // ─── Video inputs (NDI overlay, phase 2) ───────────────────────────────────

  /**
   * Fetches a PP collection as normalized {id, name} pairs. PP nests the
   * identifier under `id` on some builds and flattens it on others, and wraps
   * the collection in `items` on some endpoints — that tolerance is expressed
   * once here rather than once per endpoint.
   */
  private async getIdNameList(path: string, label: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const { data } = await this.http.get<any>(path)
      const raw: any[] = Array.isArray(data) ? data : (data?.items ?? [])
      return raw
        .map((item) => ({
          id: item.uuid ?? item.id?.uuid ?? (typeof item.id === 'string' ? item.id : ''),
          name: item.name ?? item.id?.name ?? '',
        }))
        .filter((entry) => entry.id !== '')
    } catch (err) {
      this.logAxiosError(label, err)
      return []
    }
  }

  /**
   * Triggers a PP resource. The GET-then-POST-on-404/405 shape is the expected
   * PP19 REST convention but has NOT been confirmed against a live instance for
   * either caller (see M0 in docs/plans/2026-07-08-ndi-overlay.md) — the winning
   * verb is logged so the real shape can be recorded once observed. Written once
   * so verifying it fixes every trigger at the same time.
   */
  private async triggerResource(path: string, label: string, ctx: object): Promise<boolean> {
    try {
      await this.http.get(path)
      log.info(`[PP] ${label} triggered (GET)`, ctx)
      return true
    } catch (err) {
      const status = (err as AxiosError).response?.status
      if (status === 404 || status === 405) {
        try {
          await this.http.post(path)
          log.info(`[PP] ${label} triggered (POST fallback)`, ctx)
          return true
        } catch (postErr) {
          this.logAxiosError(`${label} trigger (POST fallback)`, postErr)
          return false
        }
      }
      this.logAxiosError(`${label} trigger`, err)
      return false
    }
  }

  async getVideoInputs(): Promise<PPVideoInput[]> {
    const entries = await this.getIdNameList('/v1/video_inputs', 'getVideoInputs')
    return entries.map((entry) => ({ uuid: entry.id, name: entry.name }))
  }

  async triggerVideoInput(uuid: string): Promise<boolean> {
    return this.triggerResource(
      `/v1/video_inputs/${encodeURIComponent(uuid)}/trigger`,
      'Video input',
      { uuid }
    )
  }

  // ─── Looks (phase 3) ───────────────────────────────────────────────────────

  /** PP's configured Looks — a Look decides which layers each screen shows. */
  async getLooks(): Promise<PPLookSummary[]> {
    return this.getIdNameList('/v1/looks', 'getLooks')
  }

  async triggerLook(id: string): Promise<boolean> {
    return this.triggerResource(`/v1/look/${encodeURIComponent(id)}/trigger`, 'Look', { id })
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  async getCurrentStatus(): Promise<PPStatusResponse | null> {
    try {
      const { data } = await this.http.get<PPStatusResponse>('/v1/status')
      return data
    } catch (err) {
      this.logAxiosError('getCurrentStatus', err)
      return null
    }
  }

  // ─── Stage display ─────────────────────────────────────────────────────────

  async setStageMessage(message: string): Promise<boolean> {
    try {
      await this.http.put('/v1/stage/message', { message })
      log.info('[PP] Stage message set', { message })
      return true
    } catch (err) {
      this.logAxiosError('setStageMessage', err)
      return false
    }
  }

  async clearStageMessage(): Promise<boolean> {
    try {
      await this.http.delete('/v1/stage/message')
      log.info('[PP] Stage message cleared')
      return true
    } catch (err) {
      this.logAxiosError('clearStageMessage', err)
      return false
    }
  }
}

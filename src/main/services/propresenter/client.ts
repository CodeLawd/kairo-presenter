import { EventEmitter } from 'events'
import http from 'http'
import https from 'https'
import axios, { type AxiosInstance, type AxiosError } from 'axios'
import log from 'electron-log/main'
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
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 3_000
/** Name of the message template ProAutomate creates/reuses for scripture overlays. */
const SCRIPTURE_MESSAGE_NAME = 'ProAutomate Scripture'
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const STREAM_BUFFER_MAX = 1_024 * 1_024 // 1 MB safety cap

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
    return axios.create({
      baseURL: `http://${this.host}:${this.port}`,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    })
  }

  private rebuildAxios(): void {
    this.http = this.buildAxios()
  }

  // ─── Connection management ─────────────────────────────────────────────────

  async connect(host: string, port: number): Promise<void> {
    this.destroyed = false
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
    log.info('[PP] Connecting', { host, port })

    try {
      const version = await this.getVersion()
      this.resetReconnect()
      this.setState('connected')
      log.info('[PP] Connected', { version: `${version.major}.${version.minor}.${version.patch}` })
      this.emit('connected', version)
      this.startStream()
    } catch (err) {
      const error = this.normalizeError(err)
      log.error('[PP] Connection failed', error.message)
      this.setState('error')
      this.emit('error', error)
      this.scheduleReconnect()
    }
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

    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed) return
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

    // PP20 uses POST /v1/status/updates with a body specifying which streams to aggregate
    const streamBody = JSON.stringify({ url: '/v1/presentation/active' })
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

  async getLibrary(libraryId?: string): Promise<PPLibraryItem[]> {
    try {
      const path = libraryId ? `/v1/library/${encodeURIComponent(libraryId)}` : '/v1/library'
      const { data } = await this.http.get<any>(path)
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
      const { data } = await this.http.get<PPPlaylist[]>('/v1/playlists')
      return Array.isArray(data) ? data : []
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

  private buildPresentationBody(name: string, slideGroups: PPCreatePresentationRequest['slide_groups']): PPCreatePresentationRequest {
    return { id: { name }, slide_groups: slideGroups }
  }

  async createPresentation(name: string, slides: PPCreateSlide[]): Promise<PPPresentation | null> {
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
    ])

    return this.postPresentation(name, body, slides.length)
  }

  async createGroupedPresentation(name: string, groups: PPSlideGroupSpec[]): Promise<PPPresentation | null> {
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
    })))

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

  async clearAll(): Promise<boolean> {
    // PP19: clear layer endpoints are GET (POST returns 404)
    try {
      await this.http.get('/v1/clear/layer/presentation')
      log.info('[PP] Presentation layer cleared')
      return true
    } catch (err) {
      this.logAxiosError('clearAll', err)
      return false
    }
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
   * Find (or create) the "ProAutomate Scripture" message template and return
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

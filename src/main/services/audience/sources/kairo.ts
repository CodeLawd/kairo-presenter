import type { EngageCommand } from '../../../../lib/engage'
import { WebSocket } from 'ws'
import { toDataURL } from 'qrcode'
import { randomUUID } from 'crypto'
import log from 'electron-log/main'
import type { AudienceQuestionState, AudienceSession } from '../../../../lib/audience'
import { AUDIENCE_MAX_SNAPSHOT_BYTES, normalizeAudienceRoomSettings, type AudienceRoomCreated, type AudienceRoomSettings, type AudienceServerEvent } from '../../../../lib/audience-protocol'
import type { AudienceSource, AudienceUpdate } from '../source'

/** Cache generated QR data URLs by join URL so each engagement QR code is generated only once. */
const qrCodeCache = new Map<string, Promise<string>>()

function getQrCodeDataUrl(url: string): Promise<string> {
  const cached = qrCodeCache.get(url)
  if (cached) return cached
  const generated = toDataURL(url, { width: 384, margin: 2, errorCorrectionLevel: 'M' }).catch((error) => {
    qrCodeCache.delete(url)
    throw error
  })
  qrCodeCache.set(url, generated)
  return generated
}

/** Operator credentials stay in main-process memory, never in IPC snapshots. */
export class KairoAudienceSource implements AudienceSource {
  readonly id = 'kairo'
  private requests = new Map<string, {resolve:()=>void; reject:(error:Error)=>void}>()
  private listeners = new Set<(update: AudienceUpdate) => void>()
  private ws: WebSocket | null = null
  private reconnect: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private authRecovery = false
  private authRecoveries = 0
  private stopped = false
  private room: AudienceRoomCreated | null = null
  private session: AudienceSession | null = null
  private joined = 0
  private pending = new Map<string, { type: 'state'; id: string; state: AudienceQuestionState; requestId: string }>()
  private endAck: { requestId: string; resolve: () => void; reject: (error: Error) => void } | null = null
  private settingsAck: { requestId: string; settings: AudienceRoomSettings; resolve: () => void } | null = null
  constructor(
    private readonly baseUrl: string,
    private readonly createRoom: () => Promise<AudienceRoomCreated>,
    private readonly fallbackBaseUrl?: string,
    private readonly refreshRoom?: () => Promise<AudienceRoomCreated>,
  ) {}
  onUpdate(callback: (update: AudienceUpdate) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  private emit(update: AudienceUpdate): void { for (const callback of this.listeners) callback(update) }
  private status(state: 'connecting' | 'live' | 'error' | 'stopped', error?: string, step?: 'reserving' | 'connecting'): void {
    this.emit({ status: { id: this.id, kind: 'kairo', label: 'Engage Q&A', state, joined: this.joined, ...(step ? { step } : {}), ...(error ? { error } : {}) } })
  }
  async start(): Promise<void> {
    this.status('connecting', undefined, 'reserving')
    this.room = await this.createRoom()
    this.session = { roomId: this.room.roomId, code: this.room.code, url: this.room.url, title: this.room.title, settings: normalizeAudienceRoomSettings(this.room.settings), qrDataUrl: await getQrCodeDataUrl(this.room.url) }
    this.emit({ session: this.session })
    this.connect()
  }
  private connect(): void {
    if (this.stopped || !this.room) return
    this.status('connecting', this.attempts ? 'Reconnecting. Your questions are safe.' : undefined, 'connecting')
    const endpoint = this.fallbackBaseUrl && this.attempts % 2 === 1 ? this.fallbackBaseUrl : this.baseUrl
    const url = new URL(`/v1/engage/${this.room.code}/ws?role=operator`, endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.room.operatorToken}` }, handshakeTimeout: 10_000, maxPayload: AUDIENCE_MAX_SNAPSHOT_BYTES })
    this.ws = ws
    let responsive = true
    let heartbeat: ReturnType<typeof setInterval> | null = null
    ws.on('open', () => {
      heartbeat = setInterval(() => {
        if (!responsive) { ws.terminate(); return }
        responsive = false
        ws.ping()
      }, 15_000)
      heartbeat.unref()
    })
    ws.on('pong', () => { responsive = true })
    ws.on('message', data => {
      if (this.stopped || this.ws !== ws) return
      let event: AudienceServerEvent
      try { event = JSON.parse(data.toString()) } catch { return }
      if (event.type === 'engage') this.emit({ engage: event })
      else if (event.type === 'snapshot') {
        this.attempts = 0
        this.authRecoveries = 0
        this.joined = event.joined
        this.emit({ questions: event.questions, moderation: 'authoritative' })
        if (this.session && JSON.stringify(event.settings) !== JSON.stringify(this.session.settings)) {
          this.session = { ...this.session, settings: event.settings }
          this.emit({ session: this.session })
        }
        this.status('live')
        for (const pending of this.pending.values()) ws.send(JSON.stringify(pending))
      } else if (event.type === 'question') this.emit({ questions: [event.question], moderation: 'authoritative' })
      else if (event.type === 'joined') { this.joined = event.joined; this.status('live') }
      else if (event.type === 'ack') {
        this.requests.get(event.requestId)?.resolve(); this.requests.delete(event.requestId)
        this.pending.delete(event.requestId)
        if (this.endAck?.requestId === event.requestId) { this.endAck.resolve(); this.endAck = null }
        if (this.settingsAck?.requestId === event.requestId) {
          if (this.session) { this.session = { ...this.session, settings: this.settingsAck.settings }; this.emit({ session: this.session }) }
          this.settingsAck.resolve(); this.settingsAck = null
        }
      } else if (event.type === 'ended') this.finish()
      else if (event.type === 'error') {
        // A rejected moderation request (e.g. a question the room no longer has)
        // concerns that question only; the connection itself is still live.
        if (event.requestId) { this.requests.get(event.requestId)?.reject(new Error(event.message)); this.requests.delete(event.requestId); this.pending.delete(event.requestId) }
        else this.status('error', event.message)
      }
    })
    ws.on('error', error => {
      log.warn('[Engage] Socket error', { host: url.host, message: error.message })
      this.status('error', 'Lost the connection. Reconnecting…')
    })
    ws.on('unexpected-response', (_request, response) => {
      log.warn('[Engage] Socket handshake rejected', { host: url.host, status: response.statusCode })
      response.resume()
      ws.terminate()
      if (response.statusCode === 410 || response.statusCode === 404) { this.finish(); return }
      if (response.statusCode === 401 || response.statusCode === 403) {
        if (!this.refreshRoom || this.authRecoveries >= 1) {
          this.authRecovery = true
          this.status('error', 'Engage access was rejected. Open this engagement again to reconnect.')
          return
        }
        this.authRecovery = true
        this.authRecoveries += 1
        void this.refreshRoom().then(room => {
          if (this.stopped) return
          this.room = room
          this.authRecovery = false
          this.connect()
        }).catch(error => {
          log.warn('[Engage] Could not renew operator access', { message: error instanceof Error ? error.message : String(error) })
          this.status('error', 'Engage access expired. Open this engagement again to reconnect.')
        })
      }
    })
    ws.on('close', (code, reason) => {
      if (heartbeat) clearInterval(heartbeat)
      if (this.stopped || this.ws !== ws) return
      log.info('[Engage] Socket closed', { host: url.host, code, reason: reason.toString() })
      if (this.authRecovery) return
      this.status('connecting', 'Reconnecting. Your questions are safe.', 'connecting')
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.floor(Math.random() * 500)
      this.reconnect = setTimeout(() => this.connect(), delay)
    })
  }
  async command(command: EngageCommand): Promise<void> {
    if(this.stopped || this.ws?.readyState !== WebSocket.OPEN) throw new Error('Wait for Engage to reconnect, then try again.')
    const requestId=randomUUID()
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.requests.delete(requestId);reject(new Error('That change did not go through. Try again.'))},8000)
      this.requests.set(requestId,{resolve:()=>{clearTimeout(timer);resolve()},reject:error=>{clearTimeout(timer);reject(error)}})
      this.ws!.send(JSON.stringify({...command,requestId}))
    })
  }
  async manage(action: string, body: unknown): Promise<void> {
    if(!this.room || this.stopped) throw new Error('Open an engagement first.')
    const response=await fetch(new URL(`/v1/engage/${this.room.code}/${action}`,this.baseUrl),{method:'POST',headers:{Authorization:`Bearer ${this.room.operatorToken}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)})
    if(!response.ok) throw new Error((await response.text()).slice(0,300) || 'Could not complete that change.')
  }
  async setState(id: string, state: AudienceQuestionState): Promise<void> {
    if (this.stopped) throw new Error('This session has ended.')
    // Keep only the latest moderation for a question during a network outage.
    for (const [key, event] of this.pending) if (event.id === id) this.pending.delete(key)
    const event = { type: 'state' as const, id, state, requestId: randomUUID() }
    this.pending.set(event.requestId, event)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }
  async setSettings(settings: AudienceRoomSettings): Promise<void> {
    if (this.stopped || this.ws?.readyState !== WebSocket.OPEN) throw new Error('Wait until the Q&A is connected, then try again.')
    const requestId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.settingsAck = null; reject(new Error('That change didn’t go through. Try again.')) }, 8000)
      this.settingsAck = { requestId, settings, resolve: () => { clearTimeout(timer); resolve() } }
      this.ws!.send(JSON.stringify({ type: 'settings', settings, requestId }))
    })
  }
  async stop(): Promise<void> {
    if (this.stopped) return
    if (!this.room) { this.finish(); return }
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error('Wait until the Q&A reconnects, then end it, so everyone sees it has ended.')
    const requestId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.endAck = null; reject(new Error('Couldn’t end the Q&A. Check your connection and try again.')) }, 8000)
      this.endAck = { requestId, resolve: () => { clearTimeout(timer); resolve() }, reject: error => { clearTimeout(timer); reject(error) } }
      this.ws!.send(JSON.stringify({ type: 'end', requestId }))
    })
    this.finish()
  }
  dispose(): void { this.finish() }
  private finish(): void {
    this.stopped = true
    if (this.reconnect) clearTimeout(this.reconnect)
    this.ws?.close()
    this.ws = null
    this.pending.clear()
    for(const request of this.requests.values())request.reject(new Error('Engagement disconnected.'))
    this.requests.clear()
    this.emit({ session: null })
    this.status('stopped')
  }
}

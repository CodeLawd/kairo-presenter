import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { join } from 'path'
import { normalizeAudienceText, type AudienceSourceStatus } from '../../../../lib/audience'
import type { AudienceSource, AudienceUpdate } from '../source'
import type { SlidoPageRead } from './slido-selectors'
import { slidoReadStale } from './slido-health'

export function allowedSlidoNavigation(address: string): boolean {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && ['sli.do', 'slido.com', 'accounts.google.com', 'cisco.com', 'webex.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch { return false }
}

type Step = NonNullable<AudienceSourceStatus['step']>

/** This window is an input source only; it is never handed to any screen surface. */
export class SlidoAudienceSource implements AudienceSource {
  readonly id: string
  private readonly code: string | null
  private readonly eventId: string | null
  private readonly moderator: boolean
  private readonly skipReview: boolean
  private window: BrowserWindow | null = null
  private listeners = new Set<(update: AudienceUpdate) => void>()
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastQuestions = new Map<string, number>()
  private lastGoodAt: number | null = null
  /** Last read that found questions — shown to the operator as "updated …". */
  private lastReadAt: number | null = null
  private eventName: string | null = null
  private notFound = false
  private hiddenOnce = false
  private lastStatus = ''
  private lastPayload = ''
  private stopped = false
  private children = new Set<BrowserWindow>()
  constructor(event: { code: string } | { eventId: string }, options: { moderator?: boolean; skipReview?: boolean } = {}) {
    this.code = 'code' in event ? event.code : null
    this.eventId = 'eventId' in event ? event.eventId : null
    const key = this.code ?? this.eventId ?? ''
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(key)) throw new Error('That doesn’t look like a Slido code or link.')
    this.id = `slido:${key.toLowerCase()}`
    this.moderator = options.moderator === true
    this.skipReview = options.skipReview === true
  }
  onUpdate(callback: (update: AudienceUpdate) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  private emit(update: AudienceUpdate): void { for (const cb of this.listeners) cb(update) }
  private status(state: 'connecting' | 'live' | 'error' | 'stopped', error?: string, step?: Step): void {
    // Reads arrive every second; refresh "updated …" at most every 10 seconds.
    const key = `${state}:${error || ''}:${step || ''}:${this.eventName || ''}:${this.lastReadAt === null ? '' : Math.floor(this.lastReadAt / 10_000)}`
    if (this.lastStatus === key || (this.stopped && state !== 'stopped')) return
    this.lastStatus = key
    this.emit({
      status: {
        id: this.id, kind: 'slido', label: this.eventName ?? (this.code ? `Slido #${this.code}` : 'Slido event'), state,
        canOpen: this.moderator, moderator: this.moderator, skipReview: this.skipReview,
        ...(this.code ? { code: this.code } : {}), ...(this.eventId ? { eventId: this.eventId } : {}), ...(this.eventName ? { eventName: this.eventName } : {}),
        ...(this.lastReadAt === null ? {} : { updatedAt: this.lastReadAt }), ...(step ? { step } : {}), ...(error ? { error } : {}),
      },
    })
  }
  private read = (event: IpcMainEvent, raw: unknown): void => {
    const win = this.window
    if (this.stopped || !win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const page = raw as Partial<SlidoPageRead>
    const address = new URL(win.webContents.getURL())
    if (page.notFound === true && address.hostname === 'app.sli.do' && !address.pathname.startsWith('/event/')) {
      this.notFound = true
      this.status('error', 'No live Slido event with that code. Check the code, or start the event in Slido.')
      return
    }
    if (typeof page.eventName === 'string' && page.eventName.trim() && address.hostname === 'app.sli.do') {
      this.eventName = page.eventName.trim().slice(0, 80)
    }
    if (address.hostname !== (this.moderator ? 'admin.sli.do' : 'app.sli.do') || !address.pathname.startsWith('/event/') || !Array.isArray(page.questions)) return
    const now = Date.now()
    const state = this.skipReview ? 'approved' as const : 'review' as const
    const questions = page.questions.slice(0, 5000).flatMap(item => {
      if (!item || typeof item.externalId !== 'string' || !item.externalId || item.externalId.length > 200 || (item.author !== null && typeof item.author !== 'string')) return []
      const text = normalizeAudienceText(item.text)
      if (!text || !Number.isSafeInteger(item.votes) || item.votes < 0) return []
      const id = `${this.id}:${item.externalId}`
      if (!this.lastQuestions.has(id)) this.lastQuestions.set(id, now)
      return [{ id, sourceId: this.id, text, author: item.author?.trim().slice(0, 80) || null, votes: item.votes, state, createdAt: this.lastQuestions.get(id)! }]
    })
    // An event with no questions yet still counts as connected.
    if (!questions.length && page.empty !== true) return
    this.lastGoodAt = now
    this.lastReadAt = now
    this.status('live')
    // Signed in and reading: the sign-in window has done its job.
    if (this.moderator && !this.hiddenOnce && win.isVisible()) { this.hiddenOnce = true; win.hide() }
    const serialized = JSON.stringify(questions)
    if (questions.length && this.lastPayload !== serialized) { this.lastPayload = serialized; this.emit({ questions, ...(this.skipReview ? { moderation: 'trusted' as const } : {}) }) }
  }
  open(): void {
    if (this.moderator && this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus() }
  }
  async start(): Promise<void> {
    this.status('connecting', undefined, 'finding')
    const win = new BrowserWindow({
      show: false, width: 1100, height: 800, title: 'Sign in to Slido',
      webPreferences: {
        preload: join(__dirname, '../preload/audience-slido.js'), partition: 'persist:audience-slido',
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
        additionalArguments: [`--audience-slido-code=${this.code ?? ''}`, ...(this.moderator ? ['--audience-slido-moderator'] : [])],
      },
    })
    this.window = win
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    win.webContents.session.setPermissionCheckHandler(() => false)
    ipcMain.on('audience:slido:read', this.read)
    win.webContents.setWindowOpenHandler(({ url }) => this.moderator && allowedSlidoNavigation(url)
      ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:audience-slido', sandbox: true, nodeIntegration: false, contextIsolation: true } } }
      : { action: 'deny' })
    win.webContents.on('did-create-window', child => {
      this.children.add(child)
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      child.on('closed', () => this.children.delete(child))
      child.webContents.on('will-navigate', (event, url) => { if (!allowedSlidoNavigation(url)) event.preventDefault() })
      child.webContents.on('will-redirect', (event, url) => { if (!allowedSlidoNavigation(url)) event.preventDefault() })
    })
    win.webContents.on('will-navigate', (event, url) => { if (!allowedSlidoNavigation(url)) event.preventDefault() })
    win.webContents.on('will-redirect', (event, url) => { if (!allowedSlidoNavigation(url)) event.preventDefault() })
    let openedModerator = false
    const navigated = (): void => {
      const address = new URL(win.webContents.getURL())
      const event = /^\/event\/([a-zA-Z0-9]+)\//.exec(address.pathname)
      if (this.moderator && !openedModerator && address.hostname === 'app.sli.do' && event) {
        openedModerator = true
        win.show()
        this.status('connecting', undefined, 'sign-in')
        void win.loadURL(`https://admin.sli.do/event/${event[1]}/polls`).catch(() => this.status('error', 'Couldn’t open the moderator page. Open the Slido window and try again.'))
      } else if (this.moderator && openedModerator && this.lastReadAt === null) {
        this.status('connecting', undefined, address.hostname === 'admin.sli.do' ? 'open-event' : 'sign-in')
      }
    }
    win.webContents.on('did-navigate-in-page', navigated)
    win.webContents.on('did-finish-load', () => { this.lastGoodAt = Date.now(); navigated() })
    this.watchdog = setInterval(() => {
      if (this.notFound || !slidoReadStale(this.lastGoodAt, Date.now())) return
      const url = win.isDestroyed() ? '' : win.webContents.getURL()
      // Waiting for someone to sign in is not a failure.
      if (this.moderator && !url.includes('admin.sli.do/event/')) return
      this.status('error', this.lastReadAt === null
        ? 'Couldn’t read this event. Check the code, then try again.'
        : 'Questions stopped coming in from Slido. The ones you have are safe.')
    }, 1000)
    this.watchdog.unref()
    win.webContents.on('did-fail-load', (_event, errorCode) => { if (errorCode !== -3) this.status('error', 'Couldn’t reach Slido. Check your internet connection.') })
    win.webContents.on('render-process-gone', () => this.status('error', 'The Slido page stopped. Disconnect and connect again.'))
    // Closing the sign-in window hides it; the source keeps reading.
    win.on('close', event => { if (!this.stopped) { event.preventDefault(); win.hide() } })
    await win.loadURL(this.eventId ? `https://app.sli.do/event/${this.eventId}` : 'https://app.sli.do/')
  }
  async stop(): Promise<void> { this.dispose() }
  dispose(): void {
    this.stopped = true
    ipcMain.removeListener('audience:slido:read', this.read)
    if (this.watchdog) clearInterval(this.watchdog)
    for (const child of this.children) if (!child.isDestroyed()) child.destroy()
    this.children.clear()
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
    this.status('stopped')
  }
}

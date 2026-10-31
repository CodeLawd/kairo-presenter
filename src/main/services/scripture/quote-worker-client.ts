import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { GlobalQuoteMatch } from './global-quote'
import type { CachedQuoteVerse } from './api-bible-cache'
interface Job { id: number; text: string; possible: boolean; resolve: (matches: GlobalQuoteMatch[]) => void; reject: (error: Error) => void }
/** Persistent read-only worker. One active and one newest queued lookup bound memory under load. */
export class QuoteWorkerClient {
  private worker: Worker | null = null
  private ready = false
  private active: Job | null = null
  private queued: Job | null = null
  private nextId = 0
  private chunkId = 0
  private chunks = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private failureListeners = new Set<() => void>()
  constructor(
    private dbPath: string,
    private workerPath = path.join(__dirname, 'scripture-quote-worker.js'),
    private createWorker: (workerPath: string, dbPath: string) => Worker =
      (workerPath, dbPath) => new Worker(workerPath, { workerData: { dbPath } }),
  ) {}

  onFailure(listener: () => void): () => void {
    this.failureListeners.add(listener)
    return () => { this.failureListeners.delete(listener) }
  }

  beginCache(version: number): void {
    this.ensureWorker()
    this.worker!.postMessage({ type: 'cache-begin', version })
  }
  appendCache(version: number, rows: readonly CachedQuoteVerse[]): Promise<void> {
    if (this.closed || !this.worker) return Promise.reject(new Error('Quotation worker unavailable'))
    const chunkId = ++this.chunkId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.chunks.delete(chunkId)
        reject(new Error('Quotation cache batch timed out'))
      }, 5000)
      timer.unref()
      this.chunks.set(chunkId, { resolve, reject, timer })
      this.worker!.postMessage({ type: 'cache-append', version, rows, chunkId })
    })
  }
  commitCache(version: number): void {
    if (!this.closed && this.worker) this.worker.postMessage({ type: 'cache-commit', version })
  }

  /** `possible` also asks for paraphrase candidates — finished speech only. */
  search(text: string, possible = false): Promise<GlobalQuoteMatch[]> {
    if (this.closed) return Promise.reject(new Error('Quotation worker is closed'))
    return new Promise((resolve, reject) => {
      const job = { id: ++this.nextId, text, possible, resolve, reject }
      if (this.active) { this.queued?.resolve([]); this.queued = job; return }
      this.dispatch(job)
    })
  }

  private ensureWorker(): void {
    if (this.closed) throw new Error('Quotation worker is closed')
    if (this.worker) return
    this.ready = false
    this.worker = this.createWorker(this.workerPath, this.dbPath)
    this.worker.on('message', (message: { ready?: boolean; id?: number; cacheAck?: number; matches?: GlobalQuoteMatch[]; error?: string }) => {
      if (message.ready) {
        this.ready = true
        if (this.active) this.worker?.postMessage({ id: this.active.id, text: this.active.text, possible: this.active.possible })
        return
      }
      if (message.cacheAck !== undefined) {
        const pending = this.chunks.get(message.cacheAck)
        if (pending) {
          clearTimeout(pending.timer)
          this.chunks.delete(message.cacheAck)
          if (message.error) pending.reject(new Error(message.error))
          else pending.resolve()
        }
        return
      }
      if (message.id !== this.active?.id) return
      const current = this.active
      this.active = null
      if (!current) return
      if (this.timer) clearTimeout(this.timer)
      if (message.error) current.reject(new Error(message.error))
      else current.resolve(message.matches ?? [])
      const next = this.queued
      this.queued = null
      if (next) this.dispatch(next)
    })
    this.worker.on('error', error => this.fail(error))
    this.worker.on('exit', () => { if (this.worker) this.fail(new Error('Quotation worker exited')) })
  }

  private dispatch(job: Job): void {
    this.active = job
    try {
      this.ensureWorker()
      if (this.ready) this.worker!.postMessage({ id: job.id, text: job.text, possible: job.possible })
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    this.timer = setTimeout(() => this.fail(new Error('Quotation search timed out')), 5000)
    this.timer.unref()
  }

  private fail(error: Error): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const chunk of this.chunks.values()) { clearTimeout(chunk.timer); chunk.reject(error) }
    this.chunks.clear()
    this.active?.reject(error)
    this.queued?.reject(error)
    this.active = null
    this.queued = null
    this.ready = false
    const worker = this.worker
    this.worker = null
    if (worker) { worker.removeAllListeners(); void worker.terminate() }
    if (!this.closed) for (const listener of this.failureListeners) listener()
  }
  close(): void { this.closed = true; this.fail(new Error('Quotation worker closed')) }
}

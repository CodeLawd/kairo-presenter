import log from 'electron-log/main'
import type { ApiBibleDownloadProgress, ApiBibleOfflineTranslation, ScriptureTranslation } from '@shared/ipc'
import { canonicalBookIdFromUsfm } from './api-bible'
import type { ApiBibleCache } from './api-bible-cache'
import { ApiBibleRequestError, type ApiBibleClient } from './api-bible-client'
import { API_CACHE_MESSAGES } from './api-cache-policy'

const DEFAULT_CONCURRENCY = 2
const MAX_RATE_LIMIT_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 2_000

export interface AuthorizedTranslation {
  bibleId: string
  translation: ScriptureTranslation
  name: string
}

export interface ApiBibleDownloadManagerDeps {
  cache: ApiBibleCache
  /** Built lazily so the current API key is always used. */
  getClient: () => ApiBibleClient
  /** Translations the saved key can reach, including never-downloaded ones. */
  getAuthorizedTranslations: () => Promise<AuthorizedTranslation[]>
  /** The product/license decision — possession of a key is not enough. */
  isOfflineDownloadEnabled: (bibleId: string) => boolean
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  concurrency?: number
}

interface ChapterTask {
  chapterId: string
  bookId: number
  bookName: string
}

/**
 * Owns resumable whole-translation downloads and refreshes. Every chapter is
 * committed in its own transaction, so an interrupted run resumes without
 * refetching completed work.
 */
export class ApiBibleDownloadManager {
  /** Test/UX seam: stop after the chapter currently being committed. */
  pauseAfterNextChapter = false

  private readonly paused = new Set<string>()
  private readonly active = new Set<string>()
  private readonly listeners = new Set<(progress: ApiBibleDownloadProgress) => void>()
  private readonly running = new Map<string, Promise<void>>()

  constructor(private readonly deps: ApiBibleDownloadManagerDeps) {}

  // ─── Subscriptions ──────────────────────────────────────────────────────────

  onProgress(callback: (progress: ApiBibleDownloadProgress) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  /**
   * Every translation the operator can act on: what the key authorizes (so a
   * never-downloaded Bible can be started) merged with what is already cached
   * (so a revoked one can still be purged).
   */
  async listOfflineTranslations(): Promise<ApiBibleOfflineTranslation[]> {
    const now = this.now()
    const cached = this.deps.cache.listTranslationStates(now)
    const rows = new Map<string, ApiBibleOfflineTranslation>()

    for (const state of cached) {
      rows.set(state.bibleId, {
        ...state,
        offlineDownloadEnabled: this.deps.isOfflineDownloadEnabled(state.bibleId),
      })
    }

    // A listing failure must not hide what is already on disk.
    let authorized: AuthorizedTranslation[] = []
    try {
      authorized = await this.deps.getAuthorizedTranslations()
    } catch (error) {
      log.warn('[Scripture] Could not list authorized Bibles', (error as Error).message)
    }

    for (const item of authorized) {
      if (rows.has(item.bibleId)) continue
      rows.set(item.bibleId, {
        bibleId: item.bibleId,
        translation: item.translation,
        name: item.name,
        copyright: '',
        status: 'not-downloaded',
        cachedChapters: 0,
        totalChapters: 0,
        cachedVerses: 0,
        fetchedAt: null,
        expiresAt: null,
        offlineDownloadEnabled: this.deps.isOfflineDownloadEnabled(item.bibleId),
      })
    }

    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Downloads cannot survive an app exit; reopen them as explicitly paused. */
  recoverInterruptedDownloads(): void {
    for (const state of this.deps.cache.listTranslationStates(this.now())) {
      if (state.status === 'downloading') {
        this.deps.cache.setStatus(state.bibleId, 'paused')
        log.info('[Scripture] Reopened interrupted download as paused', { bibleId: state.bibleId })
      }
    }
  }

  // ─── Commands ───────────────────────────────────────────────────────────────

  async startDownload(bibleId: string): Promise<void> {
    if (!this.deps.isOfflineDownloadEnabled(bibleId)) {
      throw new Error(API_CACHE_MESSAGES.offlineDownloadNotPermitted)
    }
    await this.run(bibleId)
  }

  /** Re-fetches chapters at or past the 30-day boundary for a cached translation. */
  async refreshTranslation(bibleId: string): Promise<void> {
    // Refresh re-fetches the whole cached translation, so it needs the same
    // licence confirmation a download does.
    if (!this.deps.isOfflineDownloadEnabled(bibleId)) {
      throw new Error(API_CACHE_MESSAGES.offlineDownloadNotPermitted)
    }
    if (!this.deps.cache.getTranslationState(bibleId, this.now())) {
      throw new Error(`${bibleId} has no cached content to refresh.`)
    }
    await this.run(bibleId)
  }

  /**
   * Starts a download and returns as soon as it is running. The renderer awaits
   * this call, so blocking until the whole Bible finished would leave its Pause
   * button unusable for the entire download.
   */
  async startDownloadInBackground(bibleId: string): Promise<void> {
    if (!this.deps.isOfflineDownloadEnabled(bibleId)) {
      throw new Error(API_CACHE_MESSAGES.offlineDownloadNotPermitted)
    }
    this.detach(bibleId, () => this.run(bibleId))
  }

  /** Same contract as `startDownloadInBackground`, for a stale translation. */
  async refreshInBackground(bibleId: string): Promise<void> {
    if (!this.deps.isOfflineDownloadEnabled(bibleId)) {
      throw new Error(API_CACHE_MESSAGES.offlineDownloadNotPermitted)
    }
    if (!this.deps.cache.getTranslationState(bibleId, this.now())) {
      throw new Error(`${bibleId} has no cached content to refresh.`)
    }
    this.detach(bibleId, () => this.run(bibleId))
  }

  /** Resolves once background downloads have settled (tests, shutdown). */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.running.values()])
  }

  hasCachedTranslation(bibleId: string): boolean {
    return this.deps.cache.getTranslationState(bibleId, this.now()) !== null
  }

  pauseDownload(bibleId: string): void {
    this.paused.add(bibleId)
  }

  removeTranslation(bibleId: string): void {
    this.paused.add(bibleId)
    this.deps.cache.removeTranslation(bibleId)
    this.emit({
      bibleId,
      status: 'not-downloaded',
      completedChapters: 0,
      totalChapters: 0,
      cachedVerses: 0,
    })
  }

  /** Runs work detached; failures land in the cache state and a progress event. */
  private detach(bibleId: string, work: () => Promise<void>): void {
    if (this.running.has(bibleId)) return
    const task = work()
      .catch(() => {
        // `run()` already recorded the failure and emitted it to the renderer.
      })
      .finally(() => {
        this.running.delete(bibleId)
      })
    this.running.set(bibleId, task)
  }

  // ─── Download pipeline ──────────────────────────────────────────────────────

  private async run(bibleId: string): Promise<void> {
    if (this.active.has(bibleId)) return
    this.active.add(bibleId)
    this.paused.delete(bibleId)
    const { cache } = this.deps

    try {
      const client = this.deps.getClient()
      const details = await this.guardAccess(bibleId, () => client.getBible(bibleId))

      cache.upsertTranslation({
        bibleId,
        translation: (details.abbreviationLocal ?? details.abbreviation ?? bibleId) as ScriptureTranslation,
        name: details.name,
        copyright: details.copyright,
      })
      cache.markAccessChecked(bibleId, this.now())
      cache.setStatus(bibleId, 'downloading')
      this.emitState(bibleId)

      const tasks = await this.discoverChapters(bibleId, client)
      cache.setTotalChapters(bibleId, tasks.length)

      const pending = new Set(cache.getIncompleteChapters(bibleId, tasks.map((t) => t.chapterId), this.now()))
      const queue = tasks.filter((task) => pending.has(task.chapterId))

      await this.drainQueue(bibleId, client, queue)

      const stopped = this.paused.has(bibleId)
      const state = cache.getTranslationState(bibleId, this.now())
      const complete = state !== null && state.totalChapters > 0 && state.cachedChapters >= state.totalChapters
      cache.setStatus(bibleId, complete ? 'downloaded' : stopped ? 'paused' : 'partial')
      this.emitState(bibleId)
    } catch (error) {
      const message = (error as Error).message
      if (cache.getTranslationState(bibleId, this.now())?.status !== 'unavailable') {
        cache.setStatus(bibleId, 'failed', message)
      }
      this.emitState(bibleId)
      log.warn('[Scripture] Offline Bible download failed', { bibleId, message })
      throw error
    } finally {
      this.active.delete(bibleId)
      this.paused.delete(bibleId)
      this.pauseAfterNextChapter = false
    }
  }

  private async discoverChapters(bibleId: string, client: ApiBibleClient): Promise<ChapterTask[]> {
    const books = await this.guardAccess(bibleId, () => client.listBooks(bibleId))
    const tasks: ChapterTask[] = []
    for (const book of books) {
      const bookId = canonicalBookIdFromUsfm(book.id)
      if (!bookId) continue // Apocrypha and other books outside the canonical map.
      const chapters = await this.guardAccess(bibleId, () => client.listChapters(bibleId, book.id))
      for (const chapter of chapters) {
        if (chapter.number.toLowerCase() === 'intro') continue
        tasks.push({ chapterId: chapter.id, bookId, bookName: book.name })
      }
    }
    return tasks
  }

  private async drainQueue(bibleId: string, client: ApiBibleClient, queue: ChapterTask[]): Promise<void> {
    let index = 0
    const workers = Array.from({ length: this.deps.concurrency ?? DEFAULT_CONCURRENCY }, async () => {
      while (index < queue.length && !this.paused.has(bibleId)) {
        const task = queue[index++]
        await this.downloadChapter(bibleId, client, task)
        if (this.pauseAfterNextChapter) {
          this.pauseAfterNextChapter = false
          this.paused.add(bibleId)
        }
      }
    })
    await Promise.all(workers)
  }

  private async downloadChapter(bibleId: string, client: ApiBibleClient, task: ChapterTask): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const passage = await this.guardAccess(bibleId, () =>
          client.getChapter(bibleId, task.chapterId, task.bookName),
        )
        // Commit only after the response parses, so fetched_at never advances
        // without current content from API.Bible.
        this.deps.cache.putChapter(bibleId, task.chapterId, {
          bookId: task.bookId,
          bookName: task.bookName,
          verses: passage.verses,
          fetchedAt: this.now(),
          coverage: { chapter: chapterNumberOf(task.chapterId) },
        })
        this.emitState(bibleId)
        return
      } catch (error) {
        const rateLimited =
          error instanceof ApiBibleRequestError && error.isRateLimited && attempt <= MAX_RATE_LIMIT_RETRIES
        if (!rateLimited) throw error
        await this.wait((error as ApiBibleRequestError).retryAfterMs ?? DEFAULT_RETRY_DELAY_MS)
      }
    }
  }

  /** Turns a revoked key into a purge-ready `unavailable` state exactly once. */
  private async guardAccess<T>(bibleId: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request()
    } catch (error) {
      if (error instanceof ApiBibleRequestError && error.isAccessError) {
        this.deps.cache.markUnavailable(bibleId, API_CACHE_MESSAGES.accessRevoked)
        this.emitState(bibleId)
        throw new Error(API_CACHE_MESSAGES.accessRevoked)
      }
      throw error
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private emitState(bibleId: string): void {
    const state = this.deps.cache.getTranslationState(bibleId, this.now())
    if (!state) return
    this.emit({
      bibleId,
      status: state.status,
      completedChapters: state.cachedChapters,
      totalChapters: state.totalChapters,
      cachedVerses: state.cachedVerses,
      ...(state.error ? { error: state.error } : {}),
    })
  }

  private emit(progress: ApiBibleDownloadProgress): void {
    for (const listener of this.listeners) listener(progress)
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)()
  }

  private wait(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/** `JHN.3` → 3. Chapter ids always carry the number after the book code. */
function chapterNumberOf(chapterId: string): number {
  return Number(chapterId.split('.').pop())
}

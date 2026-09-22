import type { ScriptureResult, ScriptureTranslation, ScriptureVerse } from '@shared/ipc'
import { USFM_BOOK_CODES } from './api-bible'
import { ApiBibleRequestError, type ApiBibleDetails, type ApiBiblePassage } from './api-bible-client'
import type { ApiBibleCacheState, ApiBibleCachePassage, ApiBibleTranslationMeta } from './api-bible-cache'
import { API_CACHE_MESSAGES } from './api-cache-policy'

/** The slice of `ApiBibleCache` this orchestration needs. */
export interface ApiBibleLookupCache {
  getRange(
    bibleId: string,
    bookId: number,
    chapter: number,
    verseStart: number,
    verseEnd?: number,
    now?: number,
  ): ScriptureVerse[] | null
  hasRange(bibleId: string, bookId: number, chapter: number, verseStart: number, verseEnd?: number): boolean
  getTranslationState(bibleId: string, now?: number): ApiBibleCacheState | null
  upsertTranslation(meta: ApiBibleTranslationMeta): void
  putPassage(bibleId: string, passage: ApiBibleCachePassage): void
  markUnavailable(bibleId: string, error: string): void
  getLastAccessCheck(bibleId: string): number | null
  markAccessChecked(bibleId: string, at: number): void
}

/** The slice of `ApiBibleClient` this orchestration needs. */
export interface ApiBibleLookupClient {
  getPassage(bibleId: string, passageId: string, bookName: string): Promise<ApiBiblePassage>
  getChapter(bibleId: string, chapterId: string, bookName: string): Promise<ApiBiblePassage>
  getBible(bibleId: string): Promise<ApiBibleDetails>
}

export interface ApiBibleLookupRequest {
  bibleId: string
  translation: ScriptureTranslation
  book: { id: number; name: string }
  chapter: number
  verseStart: number
  verseEnd?: number
  /** Display name for the translation, when the caller already knows it. */
  name?: string
}

export interface ApiBibleLookupChapterRequest {
  bibleId: string
  translation: ScriptureTranslation
  book: { id: number; name: string }
  chapter: number
  /** Display name for the translation, when the caller already knows it. */
  name?: string
}

/**
 * Cache-first API.Bible passage lookup. Cached text is served only while it is
 * inside the 30-day window; expired or revoked text is refused rather than shown.
 */
export class ApiBibleLookup {
  private readonly revalidating = new Map<string, Promise<void>>()

  constructor(
    private readonly cache: ApiBibleLookupCache,
    private readonly client: ApiBibleLookupClient,
    private readonly clock: () => number = Date.now,
    /** Cached text used before this instant needs its access re-checked. */
    private readonly sessionStartedAt: number = Date.now(),
  ) {}

  /** Resolves once background access revalidation has settled (tests, shutdown). */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.revalidating.values()])
  }

  async lookupPassage(request: ApiBibleLookupRequest): Promise<ScriptureResult[]> {
    const { bibleId, book, chapter, verseStart, verseEnd } = request
    const now = this.clock()

    const cached = this.cache.getRange(bibleId, book.id, chapter, verseStart, verseEnd, now)
    if (cached) {
      // Licence compliance: confirm at least once per session that the key still
      // grants this translation. Runs in the background so an offline service
      // keeps working; only an explicit refusal revokes the cached text.
      this.revalidateAccess(bibleId, now)
      return [this.toResult(request, cached)]
    }

    if (this.cache.getTranslationState(bibleId, now)?.status === 'unavailable') {
      throw new Error(API_CACHE_MESSAGES.accessRevoked)
    }

    let passage: ApiBiblePassage
    try {
      passage = await this.client.getPassage(bibleId, buildPassageId(request), book.name)
    } catch (error) {
      throw this.toUserFacingError(error, request)
    }

    if (passage.verses.length === 0) return []

    this.cache.upsertTranslation({
      bibleId,
      translation: request.translation,
      name: request.name ?? request.translation,
      copyright: passage.copyright,
    })
    this.cache.putPassage(bibleId, {
      bookId: book.id,
      bookName: book.name,
      verses: passage.verses,
      fetchedAt: now,
      coverage: { chapter, verseStart, verseEnd: verseEnd ?? verseStart },
    })
    this.cache.markAccessChecked(bibleId, now)

    return [this.toResult(request, passage.verses)]
  }

  /**
   * Whole-chapter lookup ("Psalms 23") via the API.Bible chapter endpoint.
   * The cache stores the chapter as fully covered, so later verse lookups
   * inside it stay offline.
   */
  async lookupChapter(request: ApiBibleLookupChapterRequest): Promise<ScriptureResult[]> {
    const { bibleId, book, chapter } = request
    const now = this.clock()

    // Ask for the widest possible span: a fully cached chapter satisfies any
    // sub-range through its whole-chapter coverage marker.
    const cached = this.cache.getRange(bibleId, book.id, chapter, 1, MAX_VERSES_PER_CHAPTER, now)
    if (cached && cached.length > 0) {
      this.revalidateAccess(bibleId, now)
      return [this.toChapterResult(request, cached)]
    }

    if (this.cache.getTranslationState(bibleId, now)?.status === 'unavailable') {
      throw new Error(API_CACHE_MESSAGES.accessRevoked)
    }

    let passage: ApiBiblePassage
    try {
      passage = await this.client.getChapter(bibleId, buildChapterId(request), book.name)
    } catch (error) {
      throw this.toChapterUserFacingError(error, request)
    }

    if (passage.verses.length === 0) return []

    this.cache.upsertTranslation({
      bibleId,
      translation: request.translation,
      name: request.name ?? request.translation,
      copyright: passage.copyright,
    })
    this.cache.putPassage(bibleId, {
      bookId: book.id,
      bookName: book.name,
      verses: passage.verses,
      fetchedAt: now,
      coverage: { chapter },
    })
    this.cache.markAccessChecked(bibleId, now)

    return [this.toChapterResult(request, passage.verses)]
  }

  private revalidateAccess(bibleId: string, now: number): void {
    const lastCheck = this.cache.getLastAccessCheck(bibleId)
    if (lastCheck !== null && lastCheck >= this.sessionStartedAt) return
    if (this.revalidating.has(bibleId)) return

    const check = this.client
      .getBible(bibleId)
      .then(() => {
        this.cache.markAccessChecked(bibleId, now)
      })
      .catch((error: unknown) => {
        if (error instanceof ApiBibleRequestError && error.isAccessError) {
          this.cache.markUnavailable(bibleId, API_CACHE_MESSAGES.accessRevoked)
        }
        // Network failures say nothing about entitlement — leave the cache alone.
      })
      .finally(() => {
        this.revalidating.delete(bibleId)
      })
    this.revalidating.set(bibleId, check)
  }

  private toResult(request: ApiBibleLookupRequest, verses: ScriptureVerse[]): ScriptureResult {
    const end = request.verseEnd ? `–${request.verseEnd}` : ''
    return {
      reference: `${request.book.name} ${request.chapter}:${request.verseStart}${end}`,
      translation: request.translation,
      verses,
    }
  }

  private toChapterResult(
    request: ApiBibleLookupChapterRequest,
    verses: ScriptureVerse[],
  ): ScriptureResult {
    return {
      reference: `${request.book.name} ${request.chapter}`,
      translation: request.translation,
      verses,
    }
  }

  private toUserFacingError(error: unknown, request: ApiBibleLookupRequest): Error {
    if (error instanceof ApiBibleRequestError && error.isAccessError) {
      this.cache.markUnavailable(request.bibleId, API_CACHE_MESSAGES.accessRevoked)
      return new Error(API_CACHE_MESSAGES.accessRevoked)
    }
    const { bibleId, book, chapter, verseStart, verseEnd } = request
    if (this.cache.hasRange(bibleId, book.id, chapter, verseStart, verseEnd)) {
      // The text is on disk but past its 30-day licence window.
      return new Error(API_CACHE_MESSAGES.refreshRequired)
    }
    return new Error(API_CACHE_MESSAGES.notAvailableOffline)
  }

  private toChapterUserFacingError(error: unknown, request: ApiBibleLookupChapterRequest): Error {
    if (error instanceof ApiBibleRequestError && error.isAccessError) {
      this.cache.markUnavailable(request.bibleId, API_CACHE_MESSAGES.accessRevoked)
      return new Error(API_CACHE_MESSAGES.accessRevoked)
    }
    const { bibleId, book, chapter } = request
    if (this.cache.hasRange(bibleId, book.id, chapter, 1, MAX_VERSES_PER_CHAPTER)) {
      // The text is on disk but past its 30-day licence window.
      return new Error(API_CACHE_MESSAGES.refreshRequired)
    }
    return new Error(API_CACHE_MESSAGES.notAvailableOffline)
  }
}

export function buildPassageId(request: {
  book: { id: number }
  chapter: number
  verseStart: number
  verseEnd?: number
}): string {
  const usfm = USFM_BOOK_CODES[request.book.id - 1]
  const start = `${usfm}.${request.chapter}.${request.verseStart}`
  return request.verseEnd ? `${start}-${usfm}.${request.chapter}.${request.verseEnd}` : start
}

/** Longest chapter in the canon (Psalm 119) — caps whole-chapter cache probes. */
export const MAX_VERSES_PER_CHAPTER = 176

export function buildChapterId(request: { book: { id: number }; chapter: number }): string {
  const usfm = USFM_BOOK_CODES[request.book.id - 1]
  return `${usfm}.${request.chapter}`
}

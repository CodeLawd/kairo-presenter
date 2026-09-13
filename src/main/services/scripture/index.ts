import type { QuoteCandidate } from './quote-recovery'
import log from 'electron-log/main'
import fs from 'fs'
import type {
  ScriptureSuggestion,
  ScriptureResult,
  ScriptureVerse,
  ScriptureTranslation,
  ScriptureTranslationOption,
  LocalBiblePackInstallResult,
  LocalBiblePackStatus,
} from '@shared/ipc'
import { BibleDatabase } from './bible-db'
import { parseScriptureReference } from './reference'
import { buildApiBibleIdMap } from './api-bible'
import { ApiBibleClient } from './api-bible-client'
import { ApiBibleLookup, type ApiBibleLookupCache } from './api-bible-lookup'
import type { ApiBibleCache } from './api-bible-cache'
import { resolveReferenceLookup } from './reference-search'
import {
  NKJV_PACK_TRANSLATION_ID,
  packStatusFor,
  downloadNkjvPack,
  temporaryPackPath,
  resolveWritableBibleDbPath,
  validatePackFile,
} from './local-bible-pack'

type SuggestionCallback = (suggestion: ScriptureSuggestion) => void

export class ScriptureService {
  private db: BibleDatabase | null = null
  private apiCache: ApiBibleCache | null = null
  private client: ApiBibleClient | null = null
  private clientKey = ''
  private lookup: ApiBibleLookup | null = null
  /** Access revalidation happens once per app session, not once per search. */
  private readonly sessionStartedAt = Date.now()
  private defaultTranslation: ScriptureTranslation = 'NKJV'
  private apiBibleIds = new Map<string, string>()
  /** Which API key `apiBibleIds` was loaded for; ids never outlive their key. */
  private apiBibleIdsKey: string | null = null
  private clientFactory: (apiKey: string) => ApiBibleClient = (apiKey) => new ApiBibleClient(apiKey)
  private autoMode = false
  private confidenceThreshold = 0.7
  private pendingSuggestions = new Map<string, ScriptureSuggestion>()
  private suggestionCallbacks: SuggestionCallback[] = []

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  open(dbPath?: string): void {
    // The writable userData copy — never resources/bible.db, which is
    // read-only once packaged and must never gain user-installed packs in
    // development checkouts. Copied on first run only; an existing userData
    // database (including a previously installed local NKJV) is never replaced.
    const p = dbPath ?? resolveWritableBibleDbPath()
    this.db = new BibleDatabase(p)
  }

  /** Injected by the main process once `userData` paths and encryption resolve. */
  attachApiCache(cache: ApiBibleCache | null): void {
    this.apiCache = cache
    this.lookup = null
    log.info('[Scripture] API.Bible cache', { attached: cache !== null })
  }

  getApiCache(): ApiBibleCache | null {
    return this.apiCache
  }

  // ─── Optional local Bible packs (e.g. NKJV from a user-supplied file) ──────
  // Filesystem and database access stay in the main process; the renderer only
  // ever sees typed results. Validation failures throw plain Errors whose
  // messages are safe to display in Settings.

  private requireDb(): BibleDatabase {
    if (!this.db) throw new Error('Scripture database is not open.')
    return this.db
  }

  /** Whether `translation` is served from the local bible.db right now. */
  isLocalTranslation(translation: string): boolean {
    if (!this.db) return false
    return this.db
      .getAllTranslations()
      .some((item) => item.id.toUpperCase() === translation.toUpperCase())
  }

  getLocalBiblePackStatus(translation: string): LocalBiblePackStatus {
    const db = this.requireDb()
    const normalized = translation.toUpperCase()
    const has = db.hasTranslation(normalized)
    const verseCount = has ? db.getVerseCount(normalized) : 0
    const chapterCount = has ? db.getChapterCount(normalized) : 0
    const status = packStatusFor(normalized, verseCount, chapterCount, has)
    return {
      translation: status.translation,
      verseCount: status.verseCount,
      chapterCount: status.chapterCount,
      installed: status.installed,
    }
  }

  /**
   * Validate an NKJV SQLite pack and import it into the writable userData
   * bible.db, replacing only NKJV rows. Validation runs before anything is
   * written; the import itself is one transaction, so a failure preserves
   * whatever NKJV copy was installed before.
   */
  installLocalBiblePack(packPath: string): LocalBiblePackInstallResult {
    const db = this.requireDb()
    // Throws on any structural problem — the database is untouched.
    const pack = validatePackFile(packPath)
    // Single-transaction replace of NKJV verses + FTS rows. A throw here
    // rolls back to the previously installed NKJV.
    db.importTranslationPack(
      pack.translationId,
      pack.translationName,
      pack.language,
      pack.verses,
    )
    log.info('[Scripture] Local Bible pack installed', {
      translation: pack.translationId,
      verses: pack.verseCount,
    })
    return {
      translation: pack.translationId,
      verseCount: pack.verseCount,
      chapterCount: pack.chapterCount,
      installed: true,
    }
  }

  async downloadLocalBibleTranslation(translation: string): Promise<LocalBiblePackInstallResult> {
    const normalized = translation.toUpperCase()
    if (normalized !== NKJV_PACK_TRANSLATION_ID) {
      throw new Error(`No downloadable local pack is available for ${normalized}.`)
    }
    const sqlite = await downloadNkjvPack()
    const temporaryPath = temporaryPackPath()
    try {
      fs.writeFileSync(temporaryPath, sqlite, { flag: 'wx', mode: 0o600 })
      return this.installLocalBiblePack(temporaryPath)
    } finally {
      try { fs.unlinkSync(temporaryPath) } catch { /* best-effort temporary cleanup */ }
    }
  }

  /**
   * Remove only the locally installed NKJV rows and their FTS entries.
   * Restricted to NKJV so bundled translations (KJV, BSB, …) can never be
   * removed through this path, no matter what id the renderer passes.
   */
  removeLocalBibleTranslation(translation: string): LocalBiblePackStatus {
    const db = this.requireDb()
    const normalized = translation.toUpperCase()
    if (normalized !== NKJV_PACK_TRANSLATION_ID) {
      throw new Error(`Only the local ${NKJV_PACK_TRANSLATION_ID} copy can be removed.`)
    }
    if (db.hasTranslation(normalized)) {
      db.removeTranslation(normalized)
      log.info('[Scripture] Local Bible translation removed', { translation: normalized })
    }
    return this.getLocalBiblePackStatus(normalized)
  }

  // ─── Event subscriptions ──────────────────────────────────────────────────

  onSuggestion(callback: SuggestionCallback): void {
    this.suggestionCallbacks.push(callback)
  }

  private emitSuggestion(suggestion: ScriptureSuggestion): void {
    this.pendingSuggestions.set(suggestion.id, suggestion)
    this.suggestionCallbacks.forEach((cb) => cb(suggestion))
  }

  /** Called by the Orchestrator to register an auto-detected suggestion. */
  receiveSuggestion(suggestion: ScriptureSuggestion): void {
    this.emitSuggestion(suggestion)
  }

  getPendingSuggestion(id: string): ScriptureSuggestion | null {
    return this.pendingSuggestions.get(id) ?? null
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  setDefaultTranslation(translation: string): void {
    this.defaultTranslation = translation as ScriptureTranslation
    log.info('Default translation updated', { translation })
  }

  setAutoMode(enabled: boolean): void {
    this.autoMode = enabled
    log.info('Scripture auto mode', { enabled })
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0, Math.min(1, threshold))
    log.info('Confidence threshold updated', { threshold: this.confidenceThreshold })
  }

  // ─── Suggestion lifecycle ─────────────────────────────────────────────────

  dismissSuggestion(suggestionId: string): void {
    this.pendingSuggestions.delete(suggestionId)
    log.info('Scripture suggestion dismissed', { suggestionId })
  }

  /** Local-only candidate lookup for a damaged spoken citation. */
  searchLocalQuoteCandidates(phrase: string): QuoteCandidate[] {
    if (!this.db) return []
    const query = phrase.replace(/\b(?:the|has|hath|been|of|you|me|us|and|is|he|it)\b/gi, ' ')
    return this.db.searchText(query).map(verse => ({
      book: verse.bookName, chapter: verse.chapter, verse: verse.verse, text: verse.text,
    }))
  }

  // ─── Scripture lookup / search ────────────────────────────────────────────

  async search(query: string, translation = this.defaultTranslation, apiKey = ''): Promise<ScriptureResult[]> {
    log.info('Scripture search', { query, translation })
    if (!this.db) {
      log.warn('Scripture DB not open')
      return []
    }

    const mapRows = (
      rows: Array<{ bookName: string; chapter: number; verse: number; text: string; translationId?: string }>,
      tx: typeof translation,
    ): ScriptureResult[] =>
      rows.map((v) => ({
        reference: `${v.bookName} ${v.chapter}:${v.verse}`,
        verses: [{ book: v.bookName, chapter: v.chapter, verse: v.verse, text: v.text }],
        translation: (v.translationId as typeof translation) || tx,
      }))

    const localIds = this.db.getAllTranslations().map((item) => item.id.toUpperCase())
    const preferredIsLocal = localIds.includes(translation.toUpperCase())

    const ref = this.parseReference(query)
    if (ref) {
      const toLocalResult = (
        verses: ScriptureVerse[],
        tx: string,
      ): ScriptureResult => {
        const bookName = this.db!.resolveBookName(ref.book)?.name ?? ref.book
        const end = ref.verseEnd ? `–${ref.verseEnd}` : ''
        return {
          reference: `${bookName} ${ref.chapter}:${ref.verseStart}${end}`,
          verses,
          translation: tx as typeof translation,
        }
      }
      return resolveReferenceLookup({
        requested: translation,
        localIds,
        lookupLocal: (tx) =>
          this.lookupVerses(
            ref.book,
            ref.chapter,
            ref.verseStart,
            ref.verseEnd,
            tx as typeof translation,
          ),
        lookupApi: apiKey
          ? () => this.lookupFromApiBible(ref, translation, apiKey)
          : null,
        toLocalResult,
      })
    }

    // Phrase / keyword search: a locally installed NKJV is always served
    // from SQLite first and never touches API.Bible — the operator installed
    // it precisely so no key or network is needed. Every other translation
    // keeps the existing behavior: prefer the configured API.Bible
    // translation (NKJV, NIV, …), then fall back to the local bible.db seed.
    const localNkjvPreferred =
      translation.toUpperCase() === NKJV_PACK_TRANSLATION_ID && preferredIsLocal
    if (apiKey && !localNkjvPreferred) {
      try {
        const apiHits = await this.searchPhraseFromApiBible(query, translation, apiKey)
        if (apiHits.length > 0) {
          log.info('Scripture phrase search via API.Bible', {
            query,
            translation,
            hits: apiHits.length,
            top: apiHits.slice(0, 3).map((hit) => hit.reference),
          })
          return apiHits
        }
      } catch (error) {
        log.warn('[Scripture] API.Bible phrase search failed — trying local', {
          query,
          translation,
          message: (error as Error).message,
        })
      }
    }

    // Remembered-phrase search uses the local bible.db. If the Settings
    // translation is API-only (NKJV, NIV, …), search every seeded Bible and
    // prefer rows from the requested translation when present.
    const phraseRows = preferredIsLocal
      ? this.db.searchText(query, translation)
      : this.db.searchText(query) // all local translations

    let rows = phraseRows
    if (rows.length === 0 && preferredIsLocal) {
      rows = this.db.searchText(query)
    }
    if (rows.length === 0) {
      for (const tx of localIds) {
        if (preferredIsLocal && tx === translation.toUpperCase()) continue
        rows = this.db.searchText(query, tx)
        if (rows.length > 0) break
      }
    }
    if (rows.length === 0) return []

    if (preferredIsLocal) {
      rows = [
        ...rows.filter((row) => row.translationId.toUpperCase() === translation.toUpperCase()),
        ...rows.filter((row) => row.translationId.toUpperCase() !== translation.toUpperCase()),
      ]
    }

    log.info('Scripture phrase search hits', {
      query,
      preferred: translation,
      preferredIsLocal,
      hits: rows.length,
      top: rows.slice(0, 3).map((row) => `${row.translationId} ${row.bookName} ${row.chapter}:${row.verse}`),
    })

    return mapRows(
      rows.slice(0, 25).map((v) => ({
        bookName: v.bookName,
        chapter: v.chapter,
        verse: v.verse,
        text: v.text,
        translationId: v.translationId,
      })),
      (rows[0]?.translationId as typeof translation) || translation,
    )
  }

  private async searchPhraseFromApiBible(
    query: string,
    translation: ScriptureTranslation,
    apiKey: string,
  ): Promise<ScriptureResult[]> {
    const bibleId = await this.resolveBibleId(translation, apiKey)
    const hits = await this.getClient(apiKey).search(bibleId, query, 8)
    return hits.flatMap((hit) => {
      const book =
        (hit.reference.match(/^(.+?)\s+\d+:\d+/)?.[1] ?? '').trim() ||
        (hit.bookId ? this.db?.resolveBookName(hit.bookId)?.name : null) ||
        hit.bookId ||
        'Unknown'
      const chapter = hit.chapter
      const verse = hit.verse
      if (!chapter || !verse || !hit.text) return []
      const reference = hit.reference.includes(':')
        ? hit.reference.replace(/\s+/g, ' ').trim()
        : `${book} ${chapter}:${verse}`
      return [
        {
          reference,
          translation,
          verses: [{ book, chapter, verse, text: hit.text }],
        },
      ]
    })
  }

  async lookupVerses(
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd?: number,
    translation = this.defaultTranslation,
  ): Promise<ScriptureVerse[]> {
    log.info('Scripture lookup', { book, chapter, verseStart, verseEnd })
    if (!this.db) return []
    const rows = verseEnd
      ? this.db.getVerseRange(translation, book, chapter, verseStart, verseEnd)
      : [this.db.getVerse(translation, book, chapter, verseStart)].filter(Boolean)
    return (rows as NonNullable<typeof rows[number]>[]).map((v) => ({
      book: v.bookName,
      chapter,
      verse: v.verse,
      text: v.text,
    }))
  }

  async getTranslationOptions(apiKey = '', strict = false): Promise<ScriptureTranslationOption[]> {
    const catalog = TRANSLATION_CATALOG
    const local = new Set(this.db?.getAllTranslations().map((item) => item.id.toUpperCase()) ?? [])
    if (apiKey) {
      try {
        await this.loadApiBibleIds(apiKey)
      } catch (error) {
        log.warn('[Scripture] Unable to load API.Bible translations', (error as Error).message)
        if (strict) throw error
      }
    }
    return catalog.map(([id, name, access]) => ({
      id, name, access,
      available: local.has(id) || this.apiBibleIds.has(id),
      requiresApiKey: access === 'api' && !local.has(id),
    }))
  }

  private async loadApiBibleIds(apiKey: string): Promise<void> {
    const bibles = await this.getClient(apiKey).listBibles()
    this.apiBibleIds = buildApiBibleIdMap(bibles)
    this.apiBibleIdsKey = apiKey
    log.info('[Scripture] API.Bible translations authorized', {
      count: this.apiBibleIds.size,
      ids: [...this.apiBibleIds.keys()],
    })
  }

  /** Resolves the API.Bible id authorized for a translation, loading the list once. */
  async resolveBibleId(translation: ScriptureTranslation, apiKey: string): Promise<string> {
    if (this.apiBibleIdsKey !== apiKey || !this.apiBibleIds.has(translation)) {
      await this.loadApiBibleIds(apiKey)
    }
    const bibleId = this.apiBibleIds.get(translation)
    if (!bibleId) throw new Error(`${translation} is not authorized for this API.Bible key.`)
    return bibleId
  }

  /** API translations the saved key can reach, for the offline cache UI. */
  async listAuthorizedTranslations(apiKey: string): Promise<
    Array<{ bibleId: string; translation: ScriptureTranslation; name: string }>
  > {
    if (!apiKey) {
      this.forgetAuthorizedIds()
      return []
    }
    await this.loadApiBibleIds(apiKey)
    return TRANSLATION_CATALOG.flatMap(([id, name, access]) => {
      if (access !== 'api') return []
      const bibleId = this.apiBibleIds.get(id)
      return bibleId ? [{ bibleId, translation: id, name }] : []
    })
  }

  /** Throws unless the id is in the list this API key is authorized for. */
  async ensureAuthorizedBibleId(bibleId: string, apiKey: string): Promise<void> {
    if (this.apiBibleIdsKey === apiKey && this.isAuthorizedBibleId(bibleId)) return
    await this.loadApiBibleIds(apiKey)
    if (!this.isAuthorizedBibleId(bibleId)) {
      throw new Error('That Bible is not authorized for this API.Bible key.')
    }
  }

  /** True when the id belongs to the list this key is authorized for. */
  isAuthorizedBibleId(bibleId: string): boolean {
    return [...this.apiBibleIds.values()].includes(bibleId)
  }

  getClient(apiKey: string): ApiBibleClient {
    if (!this.client || this.clientKey !== apiKey) {
      // A new key authorizes a different set of Bibles. Dropping the old ids
      // stops a lookup from requesting a Bible this key cannot reach, which
      // would come back 403 and purge otherwise valid cached content.
      this.forgetAuthorizedIds()
      this.client = this.clientFactory(apiKey)
      this.clientKey = apiKey
      this.lookup = null
    }
    return this.client
  }

  private forgetAuthorizedIds(): void {
    this.apiBibleIds = new Map()
    this.apiBibleIdsKey = null
  }

  /** Test seam: supply an `ApiBibleClient` built on a stub transport. */
  setClientFactoryForTesting(factory: (apiKey: string) => ApiBibleClient): void {
    this.clientFactory = factory
    this.client = null
    this.forgetAuthorizedIds()
  }

  private async lookupFromApiBible(
    ref: { book: string; chapter: number; verseStart: number; verseEnd?: number },
    translation: ScriptureTranslation,
    apiKey: string,
  ): Promise<ScriptureResult[]> {
    if (!this.db) return []
    const bibleId = await this.resolveBibleId(translation, apiKey)
    const book = this.db.resolveBookName(ref.book)
    if (!book) return []
    return this.getLookup(apiKey).lookupPassage({
      bibleId,
      translation,
      book: { id: book.id, name: book.name },
      chapter: ref.chapter,
      verseStart: ref.verseStart,
      verseEnd: ref.verseEnd,
    })
  }

  /** One lookup per cache+key pair, so per-session access checks are not repeated. */
  private getLookup(apiKey: string): ApiBibleLookup {
    const client = this.getClient(apiKey)
    if (!this.lookup) {
      this.lookup = new ApiBibleLookup(
        this.apiCache ?? NO_CACHE,
        client,
        Date.now,
        this.sessionStartedAt,
      )
    }
    return this.lookup
  }

  parseReference(input: string): {
    book: string
    chapter: number
    verseStart: number
    verseEnd?: number
  } | null {
    return parseScriptureReference(input)
  }

  /**
   * Called by the STT service (or a text-analysis pipeline) when transcript
   * text might contain a scripture reference. Fires onSuggestion if confidence
   * meets the threshold and autoMode is on.
   */
  analyzeTranscript(text: string): void {
    if (!this.autoMode) return
    const ref = this.parseReference(text)
    if (!ref) return
    const confidence = 0.8 // TODO: replace with NLP confidence score
    if (confidence < this.confidenceThreshold) return

    const suggestion: ScriptureSuggestion = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      reference: `${ref.book} ${ref.chapter}:${ref.verseStart}${ref.verseEnd ? `-${ref.verseEnd}` : ''}`,
      verses: [],
      translation: this.defaultTranslation,
      confidence,
      source: 'auto',
      triggerText: text,
    }
    this.emitSuggestion(suggestion)
  }
}

const TRANSLATION_CATALOG: Array<[ScriptureTranslation, string, 'local' | 'api']> = [
  ['NKJV', 'New King James Version', 'api'],
  ['KJV', 'King James Version', 'local'],
  ['BSB', 'Berean Standard Bible', 'local'],
  ['WEB', 'World English Bible', 'local'],
  ['ASV', 'American Standard Version', 'local'],
  ['OEB', 'Open English Bible', 'local'],
  ['NIV', 'New International Version', 'api'],
  ['NLT', 'New Living Translation', 'api'],
  ['NASB', 'New American Standard Bible', 'api'],
  ['MSG', 'The Message', 'api'],
  ['AMPC', 'Amplified Bible, Classic Edition', 'api'],
  ['TPT', 'The Passion Translation', 'api'],
  ['ESV', 'English Standard Version', 'api'],
  ['CSB', 'Christian Standard Bible', 'api'],
]

/** Used when OS encryption is unavailable: lookups still work, nothing persists. */
const NO_CACHE: ApiBibleLookupCache = {
  getRange: () => null,
  hasRange: () => false,
  getTranslationState: () => null,
  upsertTranslation: () => {},
  putPassage: () => {},
  markUnavailable: () => {},
  getLastAccessCheck: () => Number.MAX_SAFE_INTEGER,
  markAccessChecked: () => {},
}

export const scriptureService = new ScriptureService()

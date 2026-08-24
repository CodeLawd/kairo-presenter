import path from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import axios from 'axios'
import type {
  ScriptureSuggestion,
  ScriptureResult,
  ScriptureVerse,
  ScriptureTranslation,
  ScriptureTranslationOption,
} from '@shared/ipc'
import { BibleDatabase } from './bible-db'
import { parseScriptureReference } from './reference'

type SuggestionCallback = (suggestion: ScriptureSuggestion) => void

class ScriptureService {
  private db: BibleDatabase | null = null
  private defaultTranslation: ScriptureTranslation = 'NKJV'
  private apiBibleIds = new Map<string, string>()
  private autoMode = false
  private confidenceThreshold = 0.7
  private pendingSuggestions = new Map<string, ScriptureSuggestion>()
  private suggestionCallbacks: SuggestionCallback[] = []

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  open(dbPath?: string): void {
    const p = dbPath ?? (
      is.dev
        ? path.join(app.getAppPath(), 'resources', 'bible.db')
        : path.join(process.resourcesPath, 'bible.db')
    )
    this.db = new BibleDatabase(p)
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

  // ─── Scripture lookup / search ────────────────────────────────────────────

  async search(query: string, translation = this.defaultTranslation, apiKey = ''): Promise<ScriptureResult[]> {
    log.info('Scripture search', { query, translation })
    if (!this.db) {
      log.warn('Scripture DB not open')
      return []
    }
    const ref = this.parseReference(query)
    if (ref) {
      const verses = await this.lookupVerses(ref.book, ref.chapter, ref.verseStart, ref.verseEnd, translation)
      if (verses.length > 0) {
        const bookName = this.db.resolveBookName(ref.book)?.name ?? ref.book
        const end = ref.verseEnd ? `–${ref.verseEnd}` : ''
        const reference = `${bookName} ${ref.chapter}:${ref.verseStart}${end}`
        return [{ reference, verses, translation }]
      }
      if (apiKey) return this.lookupFromApiBible(ref, translation, apiKey)
    }
    // Full-text keyword search
    const rows = this.db.searchText(query, translation)
    if (rows.length === 0) return []
    return rows.map((v) => ({
      reference: `${v.bookName} ${v.chapter}:${v.verse}`,
      verses: [{ book: v.bookName, chapter: v.chapter, verse: v.verse, text: v.text }],
      translation,
    }))
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

  async getTranslationOptions(apiKey = ''): Promise<ScriptureTranslationOption[]> {
    const catalog: Array<[ScriptureTranslation, string, 'local' | 'api']> = [
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
    ]
    const local = new Set(this.db?.getAllTranslations().map((item) => item.id.toUpperCase()) ?? [])
    if (apiKey) await this.loadApiBibleIds(apiKey).catch((error) => {
      log.warn('[Scripture] Unable to load API.Bible translations', (error as Error).message)
    })
    return catalog.map(([id, name, access]) => ({
      id, name, access,
      available: local.has(id) || this.apiBibleIds.has(id),
      requiresApiKey: access === 'api',
    }))
  }

  private async loadApiBibleIds(apiKey: string): Promise<void> {
    const response = await axios.get('https://api.scripture.api.bible/v1/bibles', {
      headers: { 'api-key': apiKey }, timeout: 10_000,
      params: { language: 'eng' },
    })
    const bibles = (response.data?.data ?? []) as Array<{ id: string; abbreviation?: string; name?: string }>
    for (const bible of bibles) {
      const abbreviation = (bible.abbreviation ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (abbreviation) this.apiBibleIds.set(abbreviation, bible.id)
    }
  }

  private async lookupFromApiBible(
    ref: { book: string; chapter: number; verseStart: number; verseEnd?: number },
    translation: ScriptureTranslation,
    apiKey: string,
  ): Promise<ScriptureResult[]> {
    if (!this.db) return []
    if (!this.apiBibleIds.has(translation)) await this.loadApiBibleIds(apiKey)
    const bibleId = this.apiBibleIds.get(translation)
    if (!bibleId) throw new Error(`${translation} is not authorized for this API.Bible key.`)
    const book = this.db.resolveBookName(ref.book)
    if (!book) return []
    const usfm = USFM_BOOK_CODES[book.id - 1]
    const start = `${usfm}.${ref.chapter}.${ref.verseStart}`
    const passageId = ref.verseEnd ? `${start}-${usfm}.${ref.chapter}.${ref.verseEnd}` : start
    const response = await axios.get(
      `https://api.scripture.api.bible/v1/bibles/${encodeURIComponent(bibleId)}/passages/${passageId}`,
      { headers: { 'api-key': apiKey }, timeout: 10_000, params: { 'content-type': 'text', 'include-notes': false, 'include-titles': false } },
    )
    const text = String(response.data?.data?.content ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return []
    const end = ref.verseEnd ? `–${ref.verseEnd}` : ''
    return [{
      reference: `${book.name} ${ref.chapter}:${ref.verseStart}${end}`,
      translation,
      verses: [{ book: book.name, chapter: ref.chapter, verse: ref.verseStart, text }],
    }]
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

export const scriptureService = new ScriptureService()

const USFM_BOOK_CODES = [
  'GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV',
]

import path from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import type {
  ScriptureSuggestion,
  ScriptureResult,
  ScriptureVerse,
  ScriptureTranslation,
} from '@shared/ipc'
import { BibleDatabase } from './bible-db'

type SuggestionCallback = (suggestion: ScriptureSuggestion) => void

class ScriptureService {
  private db: BibleDatabase | null = null
  private defaultTranslation: ScriptureTranslation = 'KJV'
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

  async search(query: string): Promise<ScriptureResult[]> {
    log.info('Scripture search', { query, translation: this.defaultTranslation })
    if (!this.db) {
      log.warn('Scripture DB not open')
      return []
    }
    const ref = this.parseReference(query)
    if (ref) {
      const verses = await this.lookupVerses(ref.book, ref.chapter, ref.verseStart, ref.verseEnd)
      if (verses.length > 0) {
        const bookName = this.db.resolveBookName(ref.book)?.name ?? ref.book
        const end = ref.verseEnd ? `–${ref.verseEnd}` : ''
        const reference = `${bookName} ${ref.chapter}:${ref.verseStart}${end}`
        return [{ reference, verses, translation: this.defaultTranslation }]
      }
    }
    // Full-text keyword search
    const rows = this.db.searchText(query, this.defaultTranslation)
    if (rows.length === 0) return []
    return rows.map((v) => ({
      reference: `${v.bookName} ${v.chapter}:${v.verse}`,
      verses: [{ book: v.bookName, chapter: v.chapter, verse: v.verse, text: v.text }],
      translation: this.defaultTranslation,
    }))
  }

  async lookupVerses(
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd?: number
  ): Promise<ScriptureVerse[]> {
    log.info('Scripture lookup', { book, chapter, verseStart, verseEnd })
    if (!this.db) return []
    const rows = verseEnd
      ? this.db.getVerseRange(this.defaultTranslation, book, chapter, verseStart, verseEnd)
      : [this.db.getVerse(this.defaultTranslation, book, chapter, verseStart)].filter(Boolean)
    return (rows as NonNullable<typeof rows[number]>[]).map((v) => ({
      book: v.bookName,
      chapter,
      verse: v.verse,
      text: v.text,
    }))
  }

  parseReference(input: string): {
    book: string
    chapter: number
    verseStart: number
    verseEnd?: number
  } | null {
    const match = input.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/)
    if (!match) return null
    return {
      book: match[1].trim(),
      chapter: parseInt(match[2]),
      verseStart: parseInt(match[3]),
      verseEnd: match[4] ? parseInt(match[4]) : undefined,
    }
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

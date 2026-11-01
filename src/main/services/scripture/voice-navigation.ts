import type { ScriptureSuggestion, ScriptureTranslation, ScriptureVerse, TranscriptResult } from '@shared/ipc'
import { findSpokenTranslationMatches } from '@shared/spoken-translations'
import { transcriptEvidenceKey } from './transcript-recording'

export interface LiveScriptureContext {
  book: string
  chapter: number
  verseStart: number
  verseEnd: number
  translation: ScriptureTranslation
  revision: number
  /** The detected row this verse belongs to, so spoken steps extend it instead of adding rows. */
  passageId?: string
  passageIndex?: number
}
export type ScriptureVoiceCommand = { direction: -1 | 1 } | { translation: ScriptureTranslation }
/** Words a preacher puts in front of a command ("Okay, next verse") that change nothing. */
const LEAD_IN = /^(?:(?:okay|ok|alright|all right|so|and|now|then|right|please|let's|let us) )+/
/**
 * The whole phrase must be the command, so "next verse is what he said" or
 * "go on and tell your neighbour" stays narration. Preachers say it many ways:
 * "next", "next one", "go on", "keep going", "previous", "back one".
 */
const NEXT_VERSE = new RegExp('^(?:' + [
  "(?:(?:go|move|read) (?:on )?(?:to )?)?(?:the )?next(?: verse| one)?",
  'go on', 'move on', 'carry on', 'keep going', 'continue',
  '(?:the )?following verse',
].join('|') + ')(?: please)?$')
const PREVIOUS_VERSE = new RegExp('^(?:' + [
  '(?:(?:go back|back|read) (?:to )?)?(?:the )?previous(?: verse| one)?',
  'go back(?: (?:a|one)(?: verse)?)?', 'back(?: (?:a|one)(?: verse)?)?',
  '(?:the )?verse before',
].join('|') + ')(?: please)?$')

export function parseScriptureVoiceCommand(text: string): ScriptureVoiceCommand | null {
  const phrase = text.toLowerCase().replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim().replace(LEAD_IN, '')
  if (NEXT_VERSE.test(phrase)) return { direction: 1 }
  if (PREVIOUS_VERSE.test(phrase)) return { direction: -1 }
  const match = phrase.match(/^(?:please )?(?:switch to|read (?:it|that) in|show (?:it|that) in) (.+?)(?: please)?$/)
  if (!match) return null
  const translations = findSpokenTranslationMatches(match[1])
  const whole = translations.filter(t => t.start === 0 && t.end === match[1].length)
  return whole.length === 1 ? { translation: whole[0].id } : null
}

/**
 * A detected or suggested passage as the place the next command steps from,
 * when nothing is live yet. Ambiguous quote matches are not a place to step
 * from. `revision` must not collide with program revisions.
 */
export function followUpContext(suggestion: ScriptureSuggestion, revision: number): LiveScriptureContext | null {
  const first = suggestion.verses[0]
  const last = suggestion.verses[suggestion.verses.length - 1]
  if (!first || suggestion.ambiguous || suggestion.provisional) return null
  return {
    book: first.book, chapter: first.chapter, verseStart: first.verse,
    verseEnd: last.chapter === first.chapter ? last.verse : first.verse,
    translation: suggestion.translation, revision,
    passageId: suggestion.passageId ?? suggestion.id,
    passageIndex: suggestion.passageIndex ?? 0,
  }
}

/** Commands consume finalized evidence once; UI/program revisions guard slow lookups. */
export class ScriptureVoiceNavigation {
  private consumed = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private generation = 0
  private ownRevisions = new Map<number, number>()
  constructor(private readonly deps: {
    enabled: () => boolean
    autoMode: () => boolean
    current: () => LiveScriptureContext | null
    chapter: (book: string, chapter: number, translation: ScriptureTranslation) => Promise<ScriptureVerse[]>
    present: (suggestion: ScriptureSuggestion) => Promise<void>
    suggest: (suggestion: ScriptureSuggestion) => void
    /** Switch a whole detected row to another translation, in place. */
    retranslateRow?: (passageId: string, translation: ScriptureTranslation) => void
    error: (error: unknown) => void
  }) {}
  reset(): void { this.generation++; this.consumed.clear(); this.ownRevisions.clear(); this.queue = Promise.resolve() }
  claim(result: TranscriptResult): boolean {
    // The cheap parse runs first: enabled() reads settings, and most finals are not commands.
    const command = parseScriptureVoiceCommand(result.text)
    if (!command || !this.deps.enabled() || !this.deps.current()) return false
    const key = transcriptEvidenceKey(result, result.id)
    if (this.consumed.has(key)) return true
    this.consumed.add(key)
    if (this.consumed.size > 1024) this.consumed.delete(this.consumed.values().next().value!)
    const generation = this.generation
    const expected = this.deps.current()!
    this.queue = this.queue.then(async () => {
      if (generation !== this.generation || !this.deps.enabled()) return
      const current = this.deps.current()
      if (!current || (current.revision !== expected.revision && this.ownRevisions.get(expected.revision) !== current.revision)) return
      const translation = 'translation' in command ? command.translation : current.translation
      // A translation switch changes the row it came from rather than adding one;
      // only in Auto mode does the verse also go back up in the new translation.
      if ('translation' in command && current.passageId && this.deps.retranslateRow) {
        this.deps.retranslateRow(current.passageId, translation)
        if (!this.deps.autoMode()) return
      }
      let chapter = current.chapter
      let verses = await this.deps.chapter(current.book, chapter, translation)
      let selected: ScriptureVerse[]
      if ('translation' in command) {
        selected = verses.filter(v => v.verse >= current.verseStart && v.verse <= current.verseEnd)
      } else {
        selected = verses.filter(v => command.direction === 1 ? v.verse > current.verseEnd : v.verse < current.verseStart)
        if (!selected.length) {
          chapter += command.direction
          if (chapter < 1) return
          verses = await this.deps.chapter(current.book, chapter, translation)
          selected = verses
        }
        selected = selected.length ? [command.direction === 1 ? selected[0] : selected[selected.length - 1]] : []
      }
      if (!selected.length || generation !== this.generation || !this.deps.enabled() || this.deps.current()?.revision !== current.revision) return
      const start = selected[0].verse
      const end = selected[selected.length - 1].verse
      const suggestion: ScriptureSuggestion = {
        id: `voice-${generation}-${key}`, reference: `${current.book} ${chapter}:${start}${end !== start ? `-${end}` : ''}`,
        verses: selected, translation, confidence: 1, source: 'manual', triggerText: result.text,
        // Next / previous extend the row the preacher is reading from.
        ...(current.passageId ? {
          passageId: current.passageId,
          passageIndex: (current.passageIndex ?? 0) + ('translation' in command ? 0 : command.direction),
        } : {}),
      }
      if (this.deps.autoMode()) {
        await this.deps.present(suggestion)
        const after = this.deps.current()
        if (generation === this.generation && after && after.book === current.book && after.chapter === chapter && after.verseStart === start && after.translation === translation) {
          for (const [root, revision] of this.ownRevisions) if (revision === current.revision) this.ownRevisions.set(root, after.revision)
          this.ownRevisions.set(current.revision, after.revision)
          if (this.ownRevisions.size > 1024) this.ownRevisions.delete(this.ownRevisions.keys().next().value!)
        }
      }
      else this.deps.suggest(suggestion)
    }).catch(this.deps.error)
    return true
  }
  settled(): Promise<void> { return this.queue }
}

/**
 * Where a spoken command steps from: whichever came last, the verse put on
 * screen or the passage just detected. "Matthew 1:8 … next verse" means 1:9
 * even while an older verse is still live.
 */
export function pickCommandContext(
  live: { context: LiveScriptureContext; at: number } | null,
  followUp: { context: LiveScriptureContext; at: number } | null,
): LiveScriptureContext | null {
  if (live && followUp) return followUp.at > live.at ? followUp.context : live.context
  return live?.context ?? followUp?.context ?? null
}

/**
 * The translation the preacher is reading from, for a detected verse that
 * names none: the passage on screen (or just detected), when the verse is in
 * the same book and the same or a neighbouring chapter. Reading John 5 in the
 * AMPC, John 5:30 should arrive in the AMPC, not the default translation.
 */
export function readingTranslation(
  context: LiveScriptureContext | null,
  ref: { book: string; chapter: number },
): ScriptureTranslation | null {
  if (!context || context.book !== ref.book) return null
  return Math.abs(context.chapter - ref.chapter) <= 1 ? context.translation : null
}

/** The detected verse is exactly what is already on screen — same verse, same translation. */
export function isOnScreen(
  live: LiveScriptureContext | null,
  ref: { book: string; chapter: number; verseStart: number; verseEnd?: number | null },
  translation: string,
): boolean {
  if (!live) return false
  return live.book === ref.book && live.chapter === ref.chapter && live.translation === translation
    && live.verseStart === ref.verseStart && live.verseEnd === (ref.verseEnd ?? ref.verseStart)
}

import type BetterSqlite3 from 'better-sqlite3'
import type { QuoteCandidate } from './quote-recovery'
import { verseKey } from '@shared/sermon-plan-match'
import { spokenVerseText } from '@shared/verse-text'

export interface CacheQuoteSource {
  bibleId: string
  bookId: number
  chapter: number
  verse: number
  fetchedAt: number
  expiresAt: number
}

export interface GlobalQuoteCandidate extends QuoteCandidate {
  translation?: string
  cacheSource?: CacheQuoteSource
  quoteCorpusVersion?: number
}

export interface GlobalQuoteMatch extends GlobalQuoteCandidate {
  score: number
  ambiguous: boolean
}

const STOP = new Set(
  'a an and as at be for in is it of that the to was with he she they we you i his her their our your my its'.split(' '),
)
/** Words common to biblical narration; shared alone they are not evidence of a particular verse. */
const FORMULA = new Set(
  'came pass said unto them behold shall hath has have been will there which god lord good'.split(' '),
)
/**
 * Everyday words that say nothing about which verse is meant. A possible
 * (paraphrase) match must share rarer words than these.
 */
const COMMON = new Set((
  'about after again against also always another because before being between both came come comes could ' +
  'days does done down each even ever every first from give given going gone great have here into just keep ' +
  'know known last left life like little long look made make many more most much must never next nothing ' +
  'only other over people place said same says should since some still such take than that their them then ' +
  'there these they thing things think this those through time today told took turn under upon very want ' +
  'way well went were what when where which while will with without word words world would year years your'
).split(' '))
/** Words in an exact run that, as most of the utterance, make a confident match on their own. */
const EXACT_UTTERANCE_MIN_RUN = 8
/** Shared rare words a paraphrase needs before it is offered as possible. */
const POSSIBLE_MIN_SHARED = 3
/**
 * A word is rare enough to point at a verse when at most this many verses of
 * one translation contain it: "hem" (6), "touch" (52) and "garment" (83) do;
 * "stand" (275), "first" (410) and "let" (1,239) don't.
 */
const RARE_VERSE_COUNT = 150

/** How many verses of one translation contain a word (or its plural). */
export type WordRarity = (word: string) => number
const RELAXED_SKIP = new Set(['said', 'shall', 'unto', 'have', 'been', 'will', 'them', 'this', 'from', 'there', 'which'])

function quoteTokens(text: string): string[] {
  return spokenVerseText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function evidenceTokens(text: string): string[] {
  return quoteTokens(text).filter((t) => !STOP.has(t))
}

/** "garments" and "garment" are the same evidence in a paraphrase. */
function stem(token: string): string {
  return token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token
}

function rareWords(text: string, rarity: WordRarity): Set<string> {
  return new Set(
    evidenceTokens(text)
      .filter((t) => t.length > 2 && !FORMULA.has(t) && !COMMON.has(t))
      .map(stem)
      .filter((t) => rarity(t) <= RARE_VERSE_COUNT),
  )
}

/**
 * Paraphrase evidence: the verses sharing the most rare words with the latest
 * speech, regardless of order. Offered only as "possible" — never a confident match.
 */
function possibleMatches(text: string, candidates: GlobalQuoteCandidate[], rarity: WordRarity): GlobalQuoteMatch[] {
  const heard = rareWords(evidenceTokens(text).slice(-24).join(' '), rarity)
  if (heard.size < POSSIBLE_MIN_SHARED) return []
  const grouped = new Map<string, GlobalQuoteMatch>()
  for (const candidate of candidates) {
    const verse = new Set(evidenceTokens(candidate.text).map(stem))
    const score = [...heard].filter((t) => verse.has(t)).length
    if (score < POSSIBLE_MIN_SHARED) continue
    const key = verseKey(candidate.book, candidate.chapter, candidate.verse)
    const old = grouped.get(key)
    if (!old || old.score < score) grouped.set(key, { ...candidate, score, ambiguous: true })
  }
  const ranked = [...grouped.values()].sort((a, b) => b.score - a.score)
  if (!ranked.length) return []
  return ranked.filter((r) => r.score >= ranked[0].score - 1).slice(0, 3)
}

interface AlignedRun {
  run: number
  heardStart: number
  verseStart: number
}

/** Longest ordered run allowing one recognition substitution, without discarding negation. */
function alignedRun(heard: string[], verse: string[]): AlignedRun {
  let best: AlignedRun = { run: 0, heardStart: -1, verseStart: -1 }
  for (let i = 0; i < heard.length; i++) {
    for (let j = 0; j < verse.length; j++) {
      let matches = 0
      let errors = 0
      for (let k = 0; k < Math.min(heard.length - i, verse.length - j); k++) {
        if (heard[i + k] === verse[j + k]) matches++
        else if (heard[i + k] === 'not' || verse[j + k] === 'not' || ++errors > 1) break
        if (matches >= 4 && matches > best.run) best = { run: matches, heardStart: i, verseStart: j }
      }
    }
  }
  return best
}

/** "Do not give…" negates the quotation; a "not" earlier in the commentary does not. */
function negatedBefore(heard: string[], verse: string[], at: AlignedRun): boolean {
  const spoken = heard.slice(Math.max(0, at.heardStart - 2), at.heardStart).includes('not')
  return spoken && !verse.slice(Math.max(0, at.verseStart - 2), at.verseStart).includes('not')
}

/**
 * Confident quotations first. Given word rarity, speech that only paraphrases a
 * verse can still return up to three "possible" verses, always marked ambiguous.
 */
export function matchGlobalQuote(text: string, candidates: GlobalQuoteCandidate[], rarity?: WordRarity): GlobalQuoteMatch[] {
  const heard = evidenceTokens(text).slice(-40)
  if (heard.length < 3) return []
  const heardAll = quoteTokens(text).slice(-60)
  const anchors = [...new Set(heard.filter((t) => t.length > 2 && !FORMULA.has(t)))]
  const grouped = new Map<string, GlobalQuoteMatch>()
  for (const candidate of candidates) {
    const verse = evidenceTokens(candidate.text).slice(0, 180)
    const verseWords = new Set(verse)
    if (anchors.filter((t) => verseWords.has(t)).length < 2) continue
    const content = alignedRun(heard, verse)
    if (negatedBefore(heard, verse, content)) continue
    const fullRun = alignedRun(heardAll, quoteTokens(candidate.text).slice(0, 240)).run
    // Verses of short common words ("I am the way, the truth, and the life") have
    // little content to run on; an exact run that is most of what was said counts.
    const exactUtterance = fullRun >= EXACT_UTTERANCE_MIN_RUN && fullRun >= heardAll.length * 0.75
    const score = Math.max(content.run, fullRun >= 10 ? fullRun / 2 : 0, exactUtterance ? 5 : 0)
    // Ordered evidence plus distinctive anchors rejects generic sermon formulae.
    if (score < 5) continue
    // Translations of one verse are one candidate, not competitors.
    const key = verseKey(candidate.book, candidate.chapter, candidate.verse)
    const old = grouped.get(key)
    if (!old || old.score < score) grouped.set(key, { ...candidate, score, ambiguous: false })
  }
  const ranked = [...grouped.values()].sort((a, b) => b.score - a.score)
  if (!ranked.length) return rarity ? possibleMatches(text, candidates, rarity) : []
  const top = ranked[0].score
  const matches = ranked.filter((r) => r.score >= top - 1).slice(0, 3)
  return matches.map((r) => ({ ...r, ambiguous: matches.length > 1 }))
}

/**
 * Whether the newest piece of speech belongs to this verse. Preachers quote in
 * short pieces ("Good measure." / "in the world." after a pause), so the newest
 * piece only has to share words with the matched verse — it can't be asked to
 * carry the match alone. It belongs when it shares two meaningful words, or when
 * it is so short that every meaningful word in it is the verse's.
 */
export function freshSpeechSupports(fresh: string, verseText: string): boolean {
  const words = new Set(evidenceTokens(verseText))
  const meaningful = [...new Set(evidenceTokens(fresh).filter((t) => t.length > 2))]
  const shared = meaningful.filter((t) => words.has(t))
  return shared.length >= 2 || (shared.length > 0 && shared.length === meaningful.length)
}

const retrievalStatements = new WeakMap<BetterSqlite3.Database, BetterSqlite3.Statement>()

function retrievalStatement(db: BetterSqlite3.Database): BetterSqlite3.Statement {
  let statement = retrievalStatements.get(db)
  if (!statement) {
    statement = db.prepare(`SELECT b.name AS book, CAST(f.chapter AS INTEGER) AS chapter,
        CAST(f.verse AS INTEGER) AS verse, f.text, f.translation_id AS translation
      FROM verses_fts f JOIN books b ON b.id = CAST(f.book_id AS INTEGER)
      WHERE verses_fts MATCH ? ORDER BY rank LIMIT 120`)
    retrievalStatements.set(db, statement)
  }
  return statement
}

/** Worker-only: verse counts per word from the installed Bibles, looked up once each. */
export function wordRarity(db: BetterSqlite3.Database): WordRarity {
  const translations = Math.max(1, (db.prepare('SELECT COUNT(DISTINCT translation_id) AS n FROM verses').get() as { n: number }).n)
  const count = db.prepare('SELECT COUNT(*) AS n FROM verses_fts WHERE verses_fts MATCH ?')
  const cache = new Map<string, number>()
  return (word) => {
    let verses = cache.get(word)
    if (verses === undefined) {
      // Prefix match, so the stem "garment" also counts "garments".
      verses = (count.get(`"${word.replace(/"/g, '""')}"*`) as { n: number }).n / translations
      if (cache.size > 20_000) cache.clear()
      cache.set(word, verses)
    }
    return verses
  }
}

/** Worker-only: bounded candidate retrieval over the existing FTS index. No LIKE scans. */
export function retrieveGlobalQuote(db: BetterSqlite3.Database, text: string): GlobalQuoteCandidate[] {
  const tokens = [...new Set(evidenceTokens(text).filter((t) => t.length > 2))].slice(-12)
  if (tokens.length < 3) return []
  const literal = (t: string): string => `"${t.replace(/"/g, '""')}"`
  const query = retrievalStatement(db)
  const results = new Map<string, GlobalQuoteCandidate>()
  const add = (rows: GlobalQuoteCandidate[]): void => {
    for (const row of rows) results.set(`${row.translation}|${verseKey(row.book, row.chapter, row.verse)}`, row)
  }
  // AND is selective; relaxed subwindows retain candidates when commentary or STT errors enter the window.
  const windows = [tokens.slice(-6), tokens.slice(-9, -3), tokens.slice(0, 6)].filter((w) => w.length >= 3)
  for (const w of windows) add(query.all(w.map(literal).join(' AND ')) as GlobalQuoteCandidate[])
  if (matchGlobalQuote(text, [...results.values()]).length === 0) {
    const anchors = tokens.filter((t) => !RELAXED_SKIP.has(t)).slice(-6)
    if (anchors.length >= 3) add(query.all(anchors.map(literal).join(' OR ')) as GlobalQuoteCandidate[])
  }
  return [...results.values()].slice(0, 240)
}

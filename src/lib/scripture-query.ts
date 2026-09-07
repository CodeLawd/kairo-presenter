import type { ScriptureResult, ScriptureTranslation } from './ipc'

export interface BookCompletion {
  value: string
  book: string
  typedBook: string
}

type BookEntry = readonly [name: string, aliases: readonly string[]]

const BOOKS: readonly BookEntry[] = [
  ['Genesis', ['gen', 'ge', 'gn']], ['Exodus', ['exod', 'exo', 'ex']],
  ['Leviticus', ['lev', 'lv']], ['Numbers', ['num', 'nu']],
  ['Deuteronomy', ['deut', 'deu', 'dt']], ['Joshua', ['josh', 'jos']],
  ['Judges', ['judg', 'jdg']], ['Ruth', ['ruth', 'ru']],
  ['1 Samuel', ['1sam', '1 sam', '1sa']], ['2 Samuel', ['2sam', '2 sam', '2sa']],
  ['1 Kings', ['1kgs', '1 kgs', '1ki']], ['2 Kings', ['2kgs', '2 kgs', '2ki']],
  ['1 Chronicles', ['1chr', '1 chr', '1ch']], ['2 Chronicles', ['2chr', '2 chr', '2ch']],
  ['Ezra', ['ezra', 'ezr']], ['Nehemiah', ['neh']], ['Esther', ['esth', 'est']],
  ['Job', ['job']], ['Psalms', ['psalms', 'psalm', 'ps']], ['Proverbs', ['prov', 'pro']],
  ['Ecclesiastes', ['eccl', 'ecc']], ['Song of Solomon', ['song', 'song of songs', 'sos']],
  ['Isaiah', ['isa']], ['Jeremiah', ['jer']], ['Lamentations', ['lam']],
  ['Ezekiel', ['ezek', 'eze']], ['Daniel', ['dan']], ['Hosea', ['hos']],
  ['Joel', ['joel']], ['Amos', ['amos']], ['Obadiah', ['obad', 'oba']],
  ['Jonah', ['jonah', 'jon']], ['Micah', ['mic']], ['Nahum', ['nah']],
  ['Habakkuk', ['hab']], ['Zephaniah', ['zeph']], ['Haggai', ['hag']],
  ['Zechariah', ['zech']], ['Malachi', ['mal']], ['Matthew', ['matt', 'mat']],
  ['Mark', ['mark', 'mrk']], ['Luke', ['luke', 'luk']], ['John', ['john', 'jhn', 'jn']],
  ['Acts', ['acts', 'act']], ['Romans', ['rom', 'ro']],
  ['1 Corinthians', ['1cor', '1 cor', '1co']], ['2 Corinthians', ['2cor', '2 cor', '2co']],
  ['Galatians', ['gal']], ['Ephesians', ['eph']], ['Philippians', ['phil', 'php']],
  ['Colossians', ['col']], ['1 Thessalonians', ['1thess', '1 thess', '1th']],
  ['2 Thessalonians', ['2thess', '2 thess', '2th']], ['1 Timothy', ['1tim', '1 tim', '1ti']],
  ['2 Timothy', ['2tim', '2 tim', '2ti']], ['Titus', ['titus', 'tit']],
  ['Philemon', ['phlm', 'phm']], ['Hebrews', ['heb']], ['James', ['jas', 'jam']],
  ['1 Peter', ['1pet', '1 pet', '1pe']], ['2 Peter', ['2pet', '2 pet', '2pe']],
  ['1 John', ['1john', '1 john', '1jn']], ['2 John', ['2john', '2 john', '2jn']],
  ['3 John', ['3john', '3 john', '3jn']], ['Jude', ['jude']],
  ['Revelation', ['rev']],
]

function variants([name, aliases]: BookEntry): string[] {
  return [name.toLowerCase(), ...aliases.map((alias) => alias.toLowerCase())]
}

function splitBookAndNumbers(input: string): { typedBook: string; suffix: string } {
  const normalized = input.trim().replace(/\s+/g, ' ')
  const match = normalized.match(/^(.+?)(\s+\d[\d\s:\-\u2013\u2014]*)$/)
  return match
    ? { typedBook: match[1].trim(), suffix: match[2] }
    : { typedBook: normalized, suffix: '' }
}

function findBookPrefix(input: string): { book: string; remainder: string } | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ')
  const matches: Array<{ book: string; variant: string }> = []
  for (const book of BOOKS) {
    for (const variant of variants(book)) {
      if (normalized === variant || normalized.startsWith(`${variant} `)) {
        matches.push({ book: book[0], variant })
      }
    }
  }
  matches.sort((a, b) => b.variant.length - a.variant.length)
  const best = matches[0]
  if (!best) return null
  return { book: best.book, remainder: normalized.slice(best.variant.length).trim() }
}

export function normalizeScriptureQuery(input: string): string | null {
  const match = findBookPrefix(input)
  if (!match || !match.remainder) return null
  const numbers = match.remainder.match(/^(\d+)\s*(?::|\s)\s*(\d+)(?:\s*(?:-|\u2013|\u2014|\s)\s*(\d+))?$/)
  if (!numbers) return null
  const end = numbers[3] ? `–${Number(numbers[3])}` : ''
  return `${match.book} ${Number(numbers[1])}:${Number(numbers[2])}${end}`
}

export function getBookCompletion(input: string): BookCompletion | null {
  const { typedBook, suffix } = splitBookAndNumbers(input)
  const needle = typedBook.toLowerCase()
  if (needle.length < 3) return null
  const candidates = BOOKS.filter((book) => variants(book).some((variant) => variant.startsWith(needle)))
  const unique = [...new Map(candidates.map((book) => [book[0], book])).values()]
  if (unique.length !== 1 || unique[0][0].toLowerCase() === needle) return null
  const book = unique[0][0]
  return { value: suffix ? `${book}${suffix}` : `${book} `, book, typedBook }
}

export function isLikelyPhraseQuery(input: string): boolean {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (normalizeScriptureQuery(normalized) || findBookPrefix(normalized)) return false
  const words = normalized.match(/[a-zA-Z']+/g) ?? []
  return words.length >= 3 && words.join('').length >= 8
}

/**
 * Whether the Operator / Scripture search box should fetch live matches
 * while typing (references and remembered phrases — not bare book stubs).
 */
export function shouldLiveSuggestScriptureQuery(input: string): boolean {
  const normalized = input.trim().replace(/\s+/g, ' ')
  if (normalized.length < 3) return false
  if (isLikelyPhraseQuery(normalized)) return true
  if (normalizeScriptureQuery(normalized)) return true
  const book = findBookPrefix(normalized)
  // "John 3", "rom 8:28", "1 cor 13" — need a book plus numbers (or a long full book name).
  if (book && book.remainder.length > 0) return true
  if (book && book.book.length >= 5 && !book.remainder) return false
  return false
}

export function resolveSubmittedScriptureQuery(input: string): string {
  return normalizeScriptureQuery(input) ?? input.trim()
}

export function expandScriptureResult(result: ScriptureResult): ScriptureResult[] {
  return result.verses.map((verse) => ({
    reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
    translation: result.translation,
    verses: [verse],
  }))
}

export function combineScriptureResults(results: ScriptureResult[]): ScriptureResult | null {
  const verses = results.flatMap((result) => result.verses)
  const first = verses[0]
  const last = verses.at(-1)
  if (!first || !last || !results[0]) return null

  let reference: string
  if (first.book !== last.book) {
    reference = results.map((result) => result.reference).join(', ')
  } else if (first.chapter !== last.chapter) {
    reference = `${first.book} ${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`
  } else if (first.verse !== last.verse) {
    reference = `${first.book} ${first.chapter}:${first.verse}–${last.verse}`
  } else {
    reference = `${first.book} ${first.chapter}:${first.verse}`
  }

  return { reference, translation: results[0].translation, verses }
}

export function getAdjacentVerseQueries(
  loaded: ScriptureResult[],
  direction: 'previous' | 'next',
): string[] {
  const edgeResult = direction === 'next' ? loaded.at(-1) : loaded[0]
  const edgeVerse = direction === 'next' ? edgeResult?.verses.at(-1) : edgeResult?.verses[0]
  if (!edgeVerse) return []

  const { book, chapter, verse } = edgeVerse
  if (direction === 'next') {
    return [`${book} ${chapter}:${verse + 1}`, `${book} ${chapter + 1}:1`]
  }
  if (verse > 1) return [`${book} ${chapter}:${verse - 1}`]
  if (chapter <= 1) return []
  // Cap at Psalm 119 length — avoids a 1–999 API.Bible range blow-up.
  return [`${book} ${chapter - 1}:1–176`]
}

/**
 * Re-looks-up each loaded (not playlist) passage in a new translation.
 * Passages with no text in that Bible stay as-is and are listed in `unavailable`.
 */
export async function reloadPassagesInTranslation(
  passages: ScriptureResult[],
  translation: ScriptureTranslation,
  search: (
    query: string,
    translation: ScriptureTranslation,
  ) => Promise<ScriptureResult[]>,
): Promise<{ results: ScriptureResult[]; unavailable: string[] }> {
  const results: ScriptureResult[] = []
  const unavailable: string[] = []

  for (const passage of passages) {
    try {
      const hits = await search(passage.reference, translation)
      const hit = hits.find((item) => item.verses.length > 0)
      if (!hit) {
        unavailable.push(passage.reference)
        results.push(passage)
        continue
      }
      results.push(hit)
    } catch {
      unavailable.push(passage.reference)
      results.push(passage)
    }
  }

  return { results, unavailable }
}

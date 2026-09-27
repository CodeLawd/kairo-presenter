/**
 * One-command Bible translation import.
 *
 * Takes a translation JSON in any common shape, fixes the problems that
 * usually stop a pack from validating, builds the SQLite pack, and reports
 * every change it made. Host the compressed pack and add a `downloadablePack`
 * entry (url + sha256) to src/lib/bible-translations.ts; it then shows up in
 * Settings → Scripture → Bible library with a one-click Install button.
 *
 * Run (better-sqlite3 is built for Electron, so run under Electron-as-Node):
 *   npm run import:translation -- --input ~/Downloads/esv.json --translation ESV
 *   npm run import:translation -- --input nlt.json --translation NLT --pdf-cleanup --force
 *
 * Accepted input shapes:
 *   1. Nested:    { translation: { abbrev, name, language }, books: [{ index | name, chapters: [{ chapter, verses: [{ verse, text }] }] }] }
 *   2. Flat map:  { "Genesis 1:1": "In the beginning…", … }
 *   3. Flat list: [{ book: "Genesis" | 1, chapter: 1, verse: 1, text: "…" }, …]
 *
 * Fixes applied automatically (each one is listed in the report):
 *   - Known modern verse-numbering differences are mapped onto the canonical
 *     layout the app validates against (2 Cor 13, 3 John, Revelation 12–13).
 *   - Verses a translation omits from its main text (Matt 17:21, Acts 8:37, …)
 *     get a short note instead of being empty.
 *   - Other empty verses inside a chapter repeat the previous verse, which is
 *     how printed Bibles show a combined range such as "20–21".
 *   - Stray whitespace is collapsed and "--" becomes an em dash.
 *   - With --pdf-cleanup: italic [brackets] are unwrapped, speaker labels such
 *     as "[Young Woman:]" and table headers are removed, footnote marks (* † ‡)
 *     are dropped. Off by default: some translations (e.g. AMP) use brackets as
 *     real text.
 *
 * Anything it cannot fix safely (a chapter with extra or missing verses that
 * matches no known rule, a missing chapter, an empty first verse) stops the
 * import with a list of every problem, and no pack is written.
 */

import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { gzipSync } from 'zlib'
import { BOOKS } from '../src/main/services/scripture/bible-db'
import { BIBLE_VERSE_COUNTS } from '../src/main/services/scripture/bible-verse-counts'
import { validatePackRowsFor } from '../src/main/services/scripture/local-bible-pack'
import { getTranslationDefinition } from '../src/lib/bible-translations'
import { parsePackSource, writePackFile } from './build-bible-pack'

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** Book → chapter → verse texts, all 0-indexed. `undefined` marks a missing verse. */
export type BibleGrid = Array<Array<Array<string | undefined>>>

export interface PackSource {
  translation: { abbrev: string; name: string; language: string }
  books: Array<{
    index: number
    name: string
    chapters: Array<{ chapter: number; verses: Array<{ verse: number; text: string }> }>
  }>
}

export interface NormalizeOptions {
  translation: string
  name?: string
  language?: string
  pdfCleanup?: boolean
}

export interface NormalizeResult {
  source: PackSource
  changes: string[]
  errors: string[]
}

const BOOK_COUNT = BIBLE_VERSE_COUNTS.length

// ─── Book name resolution ─────────────────────────────────────────────────────

const normalizeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

const BOOK_LOOKUP = (() => {
  const map = new Map<string, number>()
  const add = (name: string, id: number): void => {
    const key = normalizeName(name)
    if (key && !map.has(key)) map.set(key, id)
  }
  for (const book of BOOKS) {
    add(book.name, book.id)
    add(book.abbr, book.id)
    for (const alias of book.aliases) add(alias, book.id)
  }
  // Common forms not in the lookup-alias table.
  add('Revelations', 66)
  add('Revelation of John', 66)
  add('Song of Songs', 22)
  add('Psalm', 19)
  return map
})()

const ROMAN_PREFIX: Array<[RegExp, string]> = [
  [/^iii\s+/i, '3 '],
  [/^ii\s+/i, '2 '],
  [/^i\s+/i, '1 '],
]

/** 1-based book id for a name, abbreviation, or number; null when unknown. */
export function resolveBookId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= BOOK_COUNT ? value : null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return resolveBookId(Number(trimmed))
  const direct = BOOK_LOOKUP.get(normalizeName(trimmed))
  if (direct) return direct
  for (const [pattern, replacement] of ROMAN_PREFIX) {
    if (pattern.test(trimmed)) {
      const roman = BOOK_LOOKUP.get(normalizeName(trimmed.replace(pattern, replacement)))
      if (roman) return roman
    }
  }
  return null
}

const bookName = (id: number): string => BOOKS[id - 1]?.name ?? `Book ${id}`
const ref = (bookId: number, chapter: number, verse?: number): string =>
  verse === undefined ? `${bookName(bookId)} ${chapter}` : `${bookName(bookId)} ${chapter}:${verse}`

// ─── Loading ──────────────────────────────────────────────────────────────────

function emptyGrid(): BibleGrid {
  return Array.from({ length: BOOK_COUNT }, () => [])
}

function place(
  grid: BibleGrid,
  errors: string[],
  book: unknown,
  chapter: unknown,
  verse: unknown,
  text: unknown,
): void {
  const bookId = resolveBookId(book)
  if (!bookId) {
    errors.push(`Unknown book ${JSON.stringify(book)}.`)
    return
  }
  const c = Number(chapter)
  const v = Number(verse)
  if (!Number.isInteger(c) || c < 1 || !Number.isInteger(v) || v < 1) {
    errors.push(`Invalid chapter/verse ${JSON.stringify(chapter)}:${JSON.stringify(verse)} in ${bookName(bookId)}.`)
    return
  }
  const chapters = grid[bookId - 1] as BibleGrid[number]
  while (chapters.length < c) chapters.push([])
  const verses = chapters[c - 1] as Array<string | undefined>
  while (verses.length < v) verses.push(undefined)
  if (verses[v - 1] !== undefined) {
    errors.push(`Duplicate verse ${ref(bookId, c, v)}.`)
    return
  }
  verses[v - 1] = typeof text === 'string' ? text : ''
}

/** Read any supported input shape into a grid, plus source metadata. */
export function loadTranslationSource(raw: unknown): {
  grid: BibleGrid
  meta: { abbrev?: string; name?: string; language?: string }
  errors: string[]
} {
  const grid = emptyGrid()
  const errors: string[] = []
  const meta: { abbrev?: string; name?: string; language?: string } = {}

  if (Array.isArray(raw)) {
    for (const row of raw as Array<Record<string, unknown>>) {
      place(grid, errors, row?.book ?? row?.bookId ?? row?.book_id, row?.chapter, row?.verse, row?.text)
    }
    return { grid, meta, errors }
  }

  if (!raw || typeof raw !== 'object') {
    return { grid, meta, errors: ['Input is not a JSON object or array.'] }
  }

  const object = raw as Record<string, unknown>
  if (Array.isArray(object.books)) {
    const translation = (object.translation ?? {}) as Record<string, unknown>
    if (typeof translation.abbrev === 'string') meta.abbrev = translation.abbrev
    if (typeof translation.name === 'string') meta.name = translation.name
    if (typeof translation.language === 'string') meta.language = translation.language
    for (const [position, book] of (object.books as Array<Record<string, unknown>>).entries()) {
      const bookKey = book?.index ?? book?.name ?? position + 1
      const chapters = Array.isArray(book?.chapters) ? (book.chapters as Array<Record<string, unknown>>) : []
      for (const [chapterPosition, chapter] of chapters.entries()) {
        const verses = Array.isArray(chapter?.verses) ? (chapter.verses as Array<Record<string, unknown>>) : []
        for (const [versePosition, verse] of verses.entries()) {
          place(
            grid,
            errors,
            bookKey,
            chapter?.chapter ?? chapterPosition + 1,
            verse?.verse ?? versePosition + 1,
            verse?.text,
          )
        }
      }
    }
    return { grid, meta, errors }
  }

  // Flat map: "Book C:V" → text.
  const keyPattern = /^(.+?)\s+(\d+):(\d+)$/
  const entries = Object.entries(object)
  if (entries.length > 0 && entries.every(([key]) => keyPattern.test(key.trim()))) {
    for (const [key, text] of entries) {
      const match = keyPattern.exec(key.trim()) as RegExpExecArray
      place(grid, errors, match[1], match[2], match[3], text)
    }
    return { grid, meta, errors }
  }

  return {
    grid,
    meta,
    errors: [
      'Unrecognized JSON shape. Expected { books: [...] }, a flat { "Book C:V": text } map, or a list of { book, chapter, verse, text }.',
    ],
  }
}

// ─── Versification rules ──────────────────────────────────────────────────────

const chapterOf = (grid: BibleGrid, bookId: number, chapter: number): Array<string | undefined> | undefined =>
  grid[bookId - 1]?.[chapter - 1]

/** First sentence break (". ", "! ", "? ", optionally after a closing quote). */
function splitAtSentence(text: string): [string, string] | null {
  const match = /[.!?]["”’)]?\s+/.exec(text)
  if (!match) return null
  const cut = match.index + match[0].length
  const first = text.slice(0, cut).trim()
  const second = text.slice(cut).trim()
  return first && second ? [first, second] : null
}

interface VersificationRule {
  /** Applies only when the source has exactly this shape. */
  matches: (grid: BibleGrid) => boolean
  apply: (grid: BibleGrid) => string
}

/**
 * Differences between modern English numbering (NLT, NIV-style layouts, …)
 * and the canonical layout the app validates against. Each rule checks its
 * own precondition, so translations that already match are left alone.
 */
const VERSIFICATION_RULES: VersificationRule[] = [
  {
    // 2 Corinthians 13: verse 12 carries canonical 12–13; verse 13 is canonical 14.
    matches: (grid) => chapterOf(grid, 47, 13)?.length === 13 && splitAtSentence(chapterOf(grid, 47, 13)?.[11] ?? '') !== null,
    apply: (grid) => {
      const verses = chapterOf(grid, 47, 13) as string[]
      const [first, second] = splitAtSentence(verses[11] as string) as [string, string]
      verses.splice(11, 1, first, second)
      return '2 Corinthians 13: split verse 12 at its sentence break into 12–13; verse 13 became 14.'
    },
  },
  {
    // 3 John: verses 14–15 are canonical 14.
    matches: (grid) => chapterOf(grid, 64, 1)?.length === 15,
    apply: (grid) => {
      const verses = chapterOf(grid, 64, 1) as Array<string | undefined>
      const [v14, v15] = verses.splice(13, 2)
      verses.push([v14, v15].filter((text) => text && text.trim()).join(' '))
      return '3 John 1: merged verses 14–15 into verse 14.'
    },
  },
  {
    // Revelation 12:18 is the first half of canonical 13:1.
    matches: (grid) => chapterOf(grid, 66, 12)?.length === 18 && chapterOf(grid, 66, 13)?.length === 18,
    apply: (grid) => {
      const ch12 = chapterOf(grid, 66, 12) as Array<string | undefined>
      const ch13 = chapterOf(grid, 66, 13) as Array<string | undefined>
      const [moved] = ch12.splice(17, 1)
      ch13[0] = [moved, ch13[0]].filter((text) => text && text.trim()).join(' ')
      return 'Revelation 12:18 moved to the start of 13:1.'
    },
  },
]

// ─── Empty verses ─────────────────────────────────────────────────────────────

/** Verses many modern translations leave out of the main text. [book, chapter, verse] */
const MANUSCRIPT_OMISSIONS: ReadonlyArray<readonly [number, number, number]> = [
  [40, 17, 21], [40, 18, 11], [40, 23, 14],
  [41, 7, 16], [41, 9, 44], [41, 9, 46], [41, 11, 26], [41, 15, 28],
  [42, 17, 36], [42, 23, 17],
  [43, 5, 4],
  [44, 8, 37], [44, 15, 34], [44, 24, 7], [44, 28, 29],
  [45, 16, 24],
]
const isOmission = (bookId: number, chapter: number, verse: number): boolean =>
  MANUSCRIPT_OMISSIONS.some(([b, c, v]) => b === bookId && c === chapter && v === verse)

export const omissionNote = (translationId: string): string =>
  `(Not included in the ${translationId}; some manuscripts add this verse.)`

// ─── Text cleanup ─────────────────────────────────────────────────────────────

const TABLE_HEADER = /\s*\[(?:Tribe|Leader|Number|Clan|Family|Division|Name)(?:\s+(?:Tribe|Leader|Number|Clan|Family|Division|Name))*\]\s*/g
const SPEAKER_LABEL = /\s*("?)\s*\[[^\]]*:\]\s*/g

function cleanText(text: string, pdfCleanup: boolean, counts: Record<string, number>): string {
  const bump = (key: string): void => { counts[key] = (counts[key] ?? 0) + 1 }
  let result = text
  if (pdfCleanup) {
    result = result.replace(TABLE_HEADER, () => { bump('table headers removed'); return ' ' })
    result = result.replace(SPEAKER_LABEL, (_match, quote: string) => { bump('speaker labels removed'); return quote ? '" ' : ' ' })
    result = result.replace(/\[([^\]]*)\]/g, (_match, inner: string) => { bump('bracketed italics unwrapped'); return inner })
    result = result.replace(/[*†‡]/g, () => { bump('footnote marks removed'); return '' })
  }
  result = result.replace(/\s*--\s*/g, () => { bump('"--" replaced with an em dash'); return '—' })
  return result.replace(/\s+/g, ' ').trim()
}

// ─── Normalize ────────────────────────────────────────────────────────────────

/** Apply every automatic fix; collect what changed and what could not be fixed. */
export function normalizeTranslation(raw: unknown, options: NormalizeOptions): NormalizeResult {
  const translationId = options.translation.trim().toUpperCase()
  const { grid, meta, errors } = loadTranslationSource(raw)
  const changes: string[] = []

  if (errors.length > 0) {
    return { source: emptySource(translationId, options, meta), changes, errors }
  }

  // 1. Numbering differences with a known canonical mapping.
  for (const rule of VERSIFICATION_RULES) {
    if (rule.matches(grid)) changes.push(rule.apply(grid))
  }

  // 2. Structure that cannot be fixed automatically.
  for (let bookId = 1; bookId <= BOOK_COUNT; bookId++) {
    const expectedChapters = BIBLE_VERSE_COUNTS[bookId - 1] as readonly number[]
    const chapters = grid[bookId - 1] as BibleGrid[number]
    if (chapters.length === 0) {
      errors.push(`${bookName(bookId)} is missing.`)
      continue
    }
    if (chapters.length !== expectedChapters.length) {
      errors.push(`${bookName(bookId)} has ${chapters.length} chapters, expected ${expectedChapters.length}.`)
      continue
    }
    for (let chapter = 1; chapter <= expectedChapters.length; chapter++) {
      const verses = chapters[chapter - 1] as Array<string | undefined>
      const expected = expectedChapters[chapter - 1] as number
      if (verses.length !== expected) {
        errors.push(
          `${ref(bookId, chapter)} has ${verses.length} verses, expected ${expected} — numbering differs in a way no automatic rule covers; fix this chapter in the JSON.`,
        )
      }
    }
  }
  if (errors.length > 0) {
    return { source: emptySource(translationId, options, meta), changes, errors }
  }

  // 3. Empty verses (a verse key missing from the input counts as empty).
  const omissionText = omissionNote(translationId)
  const combined: string[] = []
  const omitted: string[] = []
  for (let bookId = 1; bookId <= BOOK_COUNT; bookId++) {
    const chapters = grid[bookId - 1] as BibleGrid[number]
    chapters.forEach((verses, chapterIndex) => {
      const chapter = chapterIndex + 1
      verses.forEach((text, verseIndex) => {
        if (text && text.trim()) return
        const verse = verseIndex + 1
        if (isOmission(bookId, chapter, verse)) {
          verses[verseIndex] = omissionText
          omitted.push(ref(bookId, chapter, verse))
          return
        }
        const previous = verseIndex > 0 ? verses[verseIndex - 1] : undefined
        if (previous && previous.trim()) {
          verses[verseIndex] = previous
          combined.push(ref(bookId, chapter, verse))
          return
        }
        errors.push(`${ref(bookId, chapter, verse)} is empty and has no previous verse to share text with.`)
      })
    })
  }
  if (omitted.length > 0) {
    changes.push(`${omitted.length} verse(s) left out of the main text now read "${omissionText}": ${omitted.join(', ')}.`)
  }
  if (combined.length > 0) {
    changes.push(`${combined.length} empty verse(s) repeat the previous verse (combined ranges): ${combined.join(', ')}.`)
  }
  if (errors.length > 0) {
    return { source: emptySource(translationId, options, meta), changes, errors }
  }

  // 4. Text cleanup.
  const counts: Record<string, number> = {}
  for (const chapters of grid) {
    for (const verses of chapters) {
      verses.forEach((text, index) => {
        verses[index] = cleanText(text as string, options.pdfCleanup === true, counts)
      })
    }
  }
  for (const [label, count] of Object.entries(counts)) changes.push(`Cleanup: ${count} ${label}.`)

  // 5. Cleanup can empty a verse that held only a label or marker.
  grid.forEach((chapters, bookIndex) => {
    chapters.forEach((verses, chapterIndex) => {
      verses.forEach((text, verseIndex) => {
        if (!text) errors.push(`${ref(bookIndex + 1, chapterIndex + 1, verseIndex + 1)} is empty after cleanup.`)
      })
    })
  })

  const source = emptySource(translationId, options, meta)
  source.books = grid.map((chapters, bookIndex) => ({
    index: bookIndex + 1,
    name: bookName(bookIndex + 1),
    chapters: chapters.map((verses, chapterIndex) => ({
      chapter: chapterIndex + 1,
      verses: verses.map((text, verseIndex) => ({ verse: verseIndex + 1, text: text as string })),
    })),
  }))
  return { source, changes, errors }
}

function emptySource(
  translationId: string,
  options: NormalizeOptions,
  meta: { name?: string; language?: string },
): PackSource {
  return {
    translation: {
      abbrev: translationId,
      name: options.name ?? meta.name ?? getTranslationDefinition(translationId)?.name ?? translationId,
      language: options.language ?? meta.language ?? 'en',
    },
    books: [],
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

export interface ImportOptions extends NormalizeOptions {
  input: string
  output: string
  force: boolean
}

export function parseImportArgs(argv: string[]): ImportOptions {
  let input: string | null = null
  let output: string | null = null
  let translation: string | null = null
  let name: string | undefined
  let language: string | undefined
  let force = false
  let pdfCleanup = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--input' && next) { input = next; i++ }
    else if (arg === '--output' && next) { output = next; i++ }
    else if (arg === '--translation' && next) { translation = next; i++ }
    else if (arg === '--name' && next) { name = next; i++ }
    else if (arg === '--language' && next) { language = next; i++ }
    else if (arg === '--force') force = true
    else if (arg === '--pdf-cleanup') pdfCleanup = true
    else {
      throw new Error(
        `Unknown argument "${arg}". Usage: --input <bible.json> --translation <ID> [--name <name>] [--language <lang>] [--output <pack.db>] [--pdf-cleanup] [--force]`,
      )
    }
  }
  if (!input) throw new Error('Missing required --input <bible.json>.')
  if (!translation || !/^[A-Za-z0-9]{2,12}$/.test(translation)) {
    throw new Error('Missing or invalid --translation <ID> (2–12 letters/digits, e.g. ESV).')
  }
  const id = translation.toUpperCase()
  return {
    input: resolve(input),
    output: resolve(output ?? `bible-packs/${id.toLowerCase()}-pack.db`),
    translation: id,
    name,
    language,
    force,
    pdfCleanup,
  }
}

export interface ImportResult {
  packPath: string
  gzipPath: string
  reportPath: string
  sha256: string
  verseCount: number
  changes: string[]
}

export async function importTranslation(argv: string[], out: (line: string) => void = console.log): Promise<ImportResult> {
  const options = parseImportArgs(argv)
  if (!existsSync(options.input)) throw new Error(`Input not found: ${options.input}`)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(options.input, 'utf8'))
  } catch (error) {
    throw new Error(`Could not parse ${options.input}: ${(error as Error).message}`)
  }

  const { source, changes, errors } = normalizeTranslation(raw, options)
  if (errors.length > 0) {
    const shown = errors.slice(0, 50)
    const more = errors.length > shown.length ? `\n  …and ${errors.length - shown.length} more` : ''
    throw new Error(`Cannot import ${options.translation} — ${errors.length} problem(s):\n  ${shown.join('\n  ')}${more}`)
  }

  // Reuse the pack builder's parsing and the installer's validation, so an
  // imported pack is held to exactly the same rules as an installed one.
  const parsed = parsePackSource(source, options.translation)
  const validated = validatePackRowsFor(options.translation, source.translation.name, source.translation.language, parsed.rows)
  writePackFile(
    { rows: parsed.rows, name: source.translation.name, language: source.translation.language },
    options.output,
    options.force,
    options.translation,
  )

  const gzipPath = `${options.output}.gz`
  const compressed = gzipSync(readFileSync(options.output), { level: 9 })
  writeFileSync(gzipPath, compressed)
  const sha256 = createHash('sha256').update(compressed).digest('hex')

  const reportPath = `${options.output}.report.txt`
  const report = [
    `Translation: ${options.translation} — ${source.translation.name} (${source.translation.language})`,
    `Input: ${options.input}`,
    `Pack: ${options.output}`,
    `Verses: ${validated.verseCount.toLocaleString()}`,
    `Compressed: ${gzipPath} (${(compressed.length / 1048576).toFixed(2)} MB, sha256 ${sha256})`,
    '',
    changes.length > 0 ? 'Changes made:' : 'No changes were needed.',
    ...changes.map((change) => `- ${change}`),
  ].join('\n')
  writeFileSync(reportPath, `${report}\n`)

  out(report)
  out('')
  out(`Report saved: ${reportPath}`)
  out('Publish: host the .gz above and add a downloadablePack entry (sha256 above) to src/lib/bible-translations.ts.')

  return { packPath: options.output, gzipPath, reportPath, sha256, verseCount: validated.verseCount, changes }
}

const invokedAsScript =
  typeof process.argv[1] === 'string' && process.argv[1].endsWith('import-translation.ts')

if (invokedAsScript) {
  importTranslation(process.argv.slice(2)).catch((error: Error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}

import {
  BIBLE_TRANSLATIONS,
  buildAbbreviationAliases,
  buildNamePatterns,
  buildPreferredBibleIds,
} from '@shared/bible-translations'

export const API_BIBLE_BASE_URL = 'https://rest.api.bible/v1'

export interface ApiBibleSummary {
  id: string
  abbreviation?: string
  abbreviationLocal?: string
  name?: string
  nameLocal?: string
  type?: string
}

interface ApiBibleContentNode {
  name?: string
  type?: string
  text?: string
  attrs?: {
    number?: string
    sid?: string
    verseId?: string
    verseOrgIds?: string[]
  }
  items?: ApiBibleContentNode[]
}

export interface ParsedApiBibleVerse {
  book: string
  chapter: number
  verse: number
  text: string
}

// Derived from the bible-translations registry — add an entry there to teach
// every consumer below about a new translation. The static-looking constants
// are kept as export names for existing tests, but their contents come from
// the single source of truth.
const CATALOG_IDS = new Set(BIBLE_TRANSLATIONS.map((entry) => entry.id.toUpperCase()))

/** Forms API.Bible actually ships that are not our catalog ids. */
const ABBREVIATION_ALIASES: Record<string, string> = buildAbbreviationAliases()

/**
 * Official English text ids published by API.Bible. Used when a key is
 * authorized for that edition but the abbreviation string is unhelpful.
 */
const PREFERRED_BIBLE_IDS: Record<string, string> = buildPreferredBibleIds()

/** Longer names first so “New King James” does not collapse to KJV. */
const NAME_PATTERNS: Array<[RegExp, string]> = buildNamePatterns()

function normalizeAbbreviation(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function catalogIdFromAbbreviation(value: string | undefined): { id: string; exact: boolean } | null {
  const normalized = normalizeAbbreviation(value)
  if (!normalized) return null
  if (CATALOG_IDS.has(normalized)) return { id: normalized, exact: true }

  const withoutLanguage = normalized.replace(/^(ENG|EN)(?=[A-Z])/, '')
  if (withoutLanguage !== normalized) {
    if (CATALOG_IDS.has(withoutLanguage)) return { id: withoutLanguage, exact: true }
    const aliased = ABBREVIATION_ALIASES[withoutLanguage]
    if (aliased) return { id: aliased, exact: false }
  }

  const aliased = ABBREVIATION_ALIASES[normalized]
  return aliased ? { id: aliased, exact: false } : null
}

function catalogIdFromName(value: string | undefined): string | null {
  if (!value) return null
  for (const [pattern, id] of NAME_PATTERNS) {
    if (pattern.test(value)) return id
  }
  return null
}

export function buildApiBibleIdMap(bibles: ApiBibleSummary[]): Map<string, string> {
  const best = new Map<string, { bibleId: string; score: number }>()
  const consider = (catalogId: string, bibleId: string, score: number): void => {
    const current = best.get(catalogId)
    if (!current || score > current.score) best.set(catalogId, { bibleId, score })
  }

  for (const bible of bibles) {
    if (bible.type && bible.type !== 'text') continue

    // Whether this Bible matched a registry entry by any signal. Dynamic
    // discovery below only fires when nothing matched, so one Bible never
    // appears twice (e.g. KJV by name AND ENGKJV by abbreviation).
    let known = false

    const preferred = PREFERRED_BIBLE_IDS[bible.id]
    if (preferred) { consider(preferred, bible.id, 85); known = true }

    const local = catalogIdFromAbbreviation(bible.abbreviationLocal)
    if (local) { consider(local.id, bible.id, local.exact ? 100 : 80); known = true }

    const fallback = catalogIdFromAbbreviation(bible.abbreviation)
    if (fallback) { consider(fallback.id, bible.id, fallback.exact ? 90 : 70); known = true }

    const named = catalogIdFromName(bible.nameLocal) ?? catalogIdFromName(bible.name)
    if (named) { consider(named, bible.id, 40); known = true }

    // Dynamic discovery: an API.Bible text the registry never heard of still
    // maps to its own normalized abbreviation, so a newly authorized Bible
    // shows up without a code change or app release.
    if (!known) {
      const dynamic = normalizeAbbreviation(bible.abbreviationLocal ?? bible.abbreviation)
      if (dynamic && !CATALOG_IDS.has(dynamic) && !(dynamic in ABBREVIATION_ALIASES)) {
        consider(dynamic, bible.id, 10)
      }
    }
  }

  return new Map([...best.entries()].map(([id, value]) => [id, value.bibleId]))
}

/**
 * Display names for API.Bible ids that have no registry entry (dynamic
 * discovery above). Known ids resolve through the registry instead.
 */
export function displayNameForDynamicTranslation(id: string, bibles: ApiBibleSummary[]): string {
  const normalized = id.toUpperCase()
  const match = bibles.find(
    (bible) =>
      normalizeAbbreviation(bible.abbreviationLocal ?? bible.abbreviation) === normalized,
  )
  return match?.nameLocal ?? match?.name ?? normalized
}

function normalizeVerseId(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/\s+/g, '.').replace(/:/g, '.')
  return /^[1-3]?[A-Z]{2,3}\.\d+\.\d+$/.test(normalized) ? normalized : null
}

export function parseApiBiblePassageContent(
  content: unknown,
  bookName: string,
): ParsedApiBibleVerse[] {
  if (!Array.isArray(content)) return []

  const textByVerseId = new Map<string, string[]>()
  let currentVerseId: string | null = null

  const visit = (node: ApiBibleContentNode, insideVerseMarker = false): void => {
    const isVerseMarker = node.name === 'verse'
    const explicitId = normalizeVerseId(
      node.attrs?.verseId ?? node.attrs?.verseOrgIds?.[0] ?? node.attrs?.sid,
    )
    if (explicitId) currentVerseId = explicitId

    if (node.type === 'text' && node.text && !insideVerseMarker && currentVerseId) {
      const parts = textByVerseId.get(currentVerseId) ?? []
      parts.push(node.text)
      textByVerseId.set(currentVerseId, parts)
    }

    for (const child of node.items ?? []) visit(child, insideVerseMarker || isVerseMarker)
  }

  for (const node of content as ApiBibleContentNode[]) visit(node)

  return [...textByVerseId.entries()].flatMap(([id, parts]) => {
    const match = id.match(/^[1-3]?[A-Z]{2,3}\.(\d+)\.(\d+)$/)
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (!match || !text) return []
    return [{ book: bookName, chapter: Number(match[1]), verse: Number(match[2]), text }]
  })
}

/** Canonical book order → API.Bible USFM code (index = canonical book id − 1). */
// prettier-ignore
export const USFM_BOOK_CODES = [
  'GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV',
]

/** Canonical book id (1-based) for an API.Bible USFM book code. */
export function canonicalBookIdFromUsfm(code: string): number | null {
  const index = USFM_BOOK_CODES.indexOf(code.toUpperCase())
  return index === -1 ? null : index + 1
}

export const API_BIBLE_BASE_URL = 'https://rest.api.bible/v1'

export interface ApiBibleSummary {
  id: string
  abbreviation?: string
  abbreviationLocal?: string
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

function normalizeAbbreviation(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function buildApiBibleIdMap(bibles: ApiBibleSummary[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const bible of bibles) {
    const local = normalizeAbbreviation(bible.abbreviationLocal)
    const fallback = normalizeAbbreviation(bible.abbreviation)
    if (local) result.set(local, bible.id)
    if (fallback) result.set(fallback, bible.id)
  }
  return result
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

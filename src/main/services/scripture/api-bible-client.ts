import axios from 'axios'
import type { ScriptureVerse } from '@shared/ipc'
import {
  API_BIBLE_BASE_URL,
  parseApiBiblePassageContent,
  type ApiBibleSummary,
} from './api-bible'

const REQUEST_TIMEOUT_MS = 10_000

/** Content parameters shared by the passage and chapter endpoints. */
const CONTENT_PARAMS = {
  'content-type': 'json',
  'include-notes': false,
  'include-titles': false,
  'include-chapter-numbers': false,
} as const

export interface ApiBibleTransport {
  get(url: string, config?: unknown): Promise<{ data: unknown }>
}

export interface ApiBibleDetails extends ApiBibleSummary {
  name: string
  copyright: string
  language?: string
}

export interface ApiBibleBookSummary {
  id: string
  name: string
  abbreviation?: string
}

export interface ApiBibleChapterSummary {
  id: string
  number: string
  bookId: string
}

export interface ApiBiblePassage {
  bibleId: string
  passageId: string
  reference: string
  copyright: string
  verses: ScriptureVerse[]
}

/** One hit from GET /bibles/{id}/search — keyword or remembered-phrase match. */
export interface ApiBibleSearchHit {
  id: string
  reference: string
  text: string
  bookId?: string
  chapter?: number
  verse?: number
}

/** Normalized API.Bible failure so callers can branch without knowing Axios. */
export class ApiBibleRequestError extends Error {
  readonly status: number | null
  readonly retryAfterMs: number | null

  constructor(message: string, status: number | null, retryAfterMs: number | null) {
    super(message)
    this.name = 'ApiBibleRequestError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }

  /** The key or plan no longer grants this translation. */
  get isAccessError(): boolean {
    return this.status === 401 || this.status === 403
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }
}

/** All API.Bible HTTP lives here; nothing else in the app talks to the API. */
export class ApiBibleClient {
  constructor(
    private readonly apiKey: string,
    private readonly transport: ApiBibleTransport = axios,
  ) {}

  async listBibles(): Promise<ApiBibleSummary[]> {
    const data = await this.get('/bibles', { language: 'eng' })
    return (asRecord(data).data ?? []) as ApiBibleSummary[]
  }

  async getBible(bibleId: string): Promise<ApiBibleDetails> {
    const data = await this.get(`/bibles/${encodeURIComponent(bibleId)}`)
    const details = asRecord(asRecord(data).data)
    return {
      id: String(details.id ?? bibleId),
      name: String(details.name ?? ''),
      abbreviation: details.abbreviation as string | undefined,
      abbreviationLocal: details.abbreviationLocal as string | undefined,
      copyright: String(details.copyright ?? ''),
      language: (asRecord(details.language).id as string | undefined) ?? undefined,
    }
  }

  async listBooks(bibleId: string): Promise<ApiBibleBookSummary[]> {
    const data = await this.get(`/bibles/${encodeURIComponent(bibleId)}/books`)
    return (asRecord(data).data ?? []) as ApiBibleBookSummary[]
  }

  async listChapters(bibleId: string, bookId: string): Promise<ApiBibleChapterSummary[]> {
    const data = await this.get(
      `/bibles/${encodeURIComponent(bibleId)}/books/${encodeURIComponent(bookId)}/chapters`,
    )
    return (asRecord(data).data ?? []) as ApiBibleChapterSummary[]
  }

  getPassage(bibleId: string, passageId: string, bookName: string): Promise<ApiBiblePassage> {
    return this.fetchContent(bibleId, 'passages', passageId, bookName)
  }

  getChapter(bibleId: string, chapterId: string, bookName: string): Promise<ApiBiblePassage> {
    return this.fetchContent(bibleId, 'chapters', chapterId, bookName)
  }

  /**
   * Keyword / remembered-phrase search inside one authorized Bible.
   * GET /bibles/{bibleId}/search?query=…
   */
  async search(
    bibleId: string,
    query: string,
    limit = 10,
  ): Promise<ApiBibleSearchHit[]> {
    const data = await this.get(`/bibles/${encodeURIComponent(bibleId)}/search`, {
      query,
      limit,
      sort: 'relevance',
    })
    return parseApiBibleSearchResponse(data)
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async fetchContent(
    bibleId: string,
    resource: 'passages' | 'chapters',
    id: string,
    bookName: string,
  ): Promise<ApiBiblePassage> {
    const data = await this.get(
      `/bibles/${encodeURIComponent(bibleId)}/${resource}/${id}`,
      CONTENT_PARAMS,
    )
    const payload = asRecord(asRecord(data).data)
    return {
      bibleId,
      passageId: String(payload.id ?? id),
      reference: String(payload.reference ?? ''),
      copyright: String(payload.copyright ?? ''),
      verses: parseApiBiblePassageContent(payload.content, bookName),
    }
  }

  private async get(pathname: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.transport.get(`${API_BIBLE_BASE_URL}${pathname}`, {
        headers: { 'api-key': this.apiKey },
        timeout: REQUEST_TIMEOUT_MS,
        ...(params ? { params } : {}),
      })
      return response.data
    } catch (error) {
      throw toRequestError(error)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tolerates both `{ data: { verses: [...] } }` and flat `data: [...]` shapes. */
export function parseApiBibleSearchResponse(payload: unknown): ApiBibleSearchHit[] {
  const root = asRecord(payload)
  const data = asRecord(root.data)
  const rawList = Array.isArray(data.verses)
    ? data.verses
    : Array.isArray(data.passages)
      ? data.passages
      : Array.isArray(root.data)
        ? root.data
        : []

  const hits: ApiBibleSearchHit[] = []
  for (const item of rawList) {
    const row = asRecord(item)
    const id = String(row.id ?? row.orgId ?? '')
    const reference = String(row.reference ?? '').trim()
    const text = stripHtml(String(row.text ?? row.content ?? ''))
    if (!reference && !id) continue
    if (!text) continue

    const idMatch = id.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/i)
    const refMatch = reference.match(/^(.+?)\s+(\d+):(\d+)\b/)
    hits.push({
      id,
      reference: reference || (idMatch ? `${idMatch[1]} ${idMatch[2]}:${idMatch[3]}` : id),
      text,
      bookId: idMatch?.[1]?.toUpperCase() ?? (typeof row.bookId === 'string' ? row.bookId : undefined),
      chapter: idMatch
        ? Number.parseInt(idMatch[2], 10)
        : refMatch
          ? Number.parseInt(refMatch[2], 10)
          : undefined,
      verse: idMatch
        ? Number.parseInt(idMatch[3], 10)
        : refMatch
          ? Number.parseInt(refMatch[3], 10)
          : undefined,
    })
  }
  return hits
}

function toRequestError(error: unknown): ApiBibleRequestError {
  if (error instanceof ApiBibleRequestError) return error
  const response = asRecord(asRecord(error).response)
  const status = typeof response.status === 'number' ? response.status : null
  const headers = asRecord(response.headers)
  const retryAfter = Number(headers['retry-after'] ?? headers['Retry-After'])
  return new ApiBibleRequestError(
    (error as Error)?.message ?? 'API.Bible request failed',
    status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : null,
  )
}

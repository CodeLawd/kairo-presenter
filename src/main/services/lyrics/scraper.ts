import axios, { AxiosError } from 'axios'
import * as cheerio from 'cheerio'
import log from 'electron-log/main'
import type { ProviderResult } from './provider-types'
import { canonicalText, structureLyrics } from './normalize'

// Re-exported so the normalization tests keep a single entry point.
export { dedupeSections, normalizeSectionHeader } from './normalize'

// ─── Constants ────────────────────────────────────────────────────────────────

const GENIUS_SEARCH_URL = 'https://genius.com/api/search/multi'
const REQUEST_TIMEOUT_MS = 12_000
const MAX_RESULTS = 8

/**
 * Genius serves a bot interstitial to unrecognised agents. A stock desktop
 * agent gets the same HTML a person browsing the page would.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** Minimum gap between outbound requests, so a fast typist can't hammer the host. */
const MIN_REQUEST_GAP_MS = 350

const SEARCH_CACHE_TTL_MS = 5 * 60_000
const LYRICS_CACHE_TTL_MS = 60 * 60_000

// ─── Internal types ───────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

interface GeniusHit {
  result?: {
    id?: number
    _type?: string
    title?: string
    url?: string
    lyrics_state?: string
    instrumental?: boolean
    /** Includes featured credits, e.g. "Elevation Worship (Ft. Brandon Lake)". */
    artist_names?: string
    primary_artist?: { name?: string }
    release_date_components?: { year?: number }
    stats?: { pageviews?: number }
  }
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Turns the raw text of the Genius lyrics containers into the section-marked
 * format `LyricsService.parseText` expects.
 */
export function normalizeGeniusLyrics(raw: string): string {
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    // Genius injects these into the container alongside the lyrics.
    .replace(/You might also like/g, '\n')
    .replace(/See .{1,60} LiveGet tickets as low as \$\d+/g, '\n')

  return structureLyrics(cleaned)
}

// ─── Service ──────────────────────────────────────────────────────────────────

class LyricsScraperService {
  private searchCache = new Map<string, CacheEntry<ProviderResult[]>>()
  private lyricsCache = new Map<string, CacheEntry<string>>()
  private lastRequestAt = 0

  /**
   * Searches Genius by title, artist, or a fragment of the lyrics.
   *
   * Genius is the only free catalogue that indexes lyric bodies, so a
   * half-remembered phrase can resolve to a song without the operator knowing
   * the title — provided Genius carries it at all.
   *
   * Results come back in Genius relevance order; ranking is the aggregator's job.
   */
  async search(query: string): Promise<ProviderResult[]> {
    const q = query.trim()
    if (q.length < 3) return []

    const cached = readCache(this.searchCache, q.toLowerCase())
    if (cached) return cached

    await this.throttle()

    let data: unknown
    try {
      // The multi endpoint rejects per_page with a 422; the list is trimmed below.
      const response = await axios.get(GENIUS_SEARCH_URL, {
        params: { q },
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      })
      data = response.data
    } catch (err) {
      throw toFriendlyError(err, 'search Genius')
    }

    const sections = (data as { response?: { sections?: { hits?: GeniusHit[] }[] } })
      ?.response?.sections ?? []

    const seen = new Set<number>()
    const results: ProviderResult[] = []

    for (const section of sections) {
      for (const hit of section.hits ?? []) {
        const song = hit.result
        if (!song?.url || song._type !== 'song') continue
        if (song.lyrics_state && song.lyrics_state !== 'complete') continue
        if (song.instrumental) continue
        if (typeof song.id !== 'number' || seen.has(song.id)) continue
        seen.add(song.id)

        results.push({
          id: `genius:${song.id}`,
          provider: 'genius',
          title: (song.title ?? '').trim() || 'Untitled',
          artist: (song.artist_names ?? song.primary_artist?.name ?? '').trim(),
          url: song.url,
          releaseYear: song.release_date_components?.year
            ? String(song.release_date_components.year)
            : undefined,
          popularity: song.stats?.pageviews ?? 0,
        })
        if (results.length >= MAX_RESULTS) break
      }
      if (results.length >= MAX_RESULTS) break
    }

    writeCache(this.searchCache, q.toLowerCase(), results, SEARCH_CACHE_TTL_MS)
    log.info('[LyricsScraper] Genius search', { query: q, results: results.length })
    return results
  }

  /**
   * Fetches a Genius song page and returns its lyrics as section-marked text,
   * ready for `LyricsService.parseText`.
   *
   * Pass `title` when known so medley / live-set pages keep only the segment
   * that matches this song instead of every song on the page.
   */
  async fetchLyrics(url: string, options: { title?: string } = {}): Promise<string> {
    if (!/^https:\/\/(www\.)?genius\.com\//.test(url)) {
      throw new Error('Refusing to fetch a non-Genius URL.')
    }

    const cacheKey = `${url}::${(options.title ?? '').trim().toLowerCase()}`
    const cached = readCache(this.lyricsCache, cacheKey)
    if (cached) return cached

    await this.throttle()

    let html: string
    try {
      const response = await axios.get<string>(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
      })
      html = response.data
    } catch (err) {
      throw toFriendlyError(err, 'fetch lyrics from Genius')
    }

    const containers = extractLyricContainersFromHtml(html)
    const title = options.title?.trim() || titleFromGeniusUrl(url)
    const extracted = selectPrimaryLyricSegment(containers, title)
    if (!extracted.trim()) {
      throw new Error(
        'No lyrics found on that Genius page. It may be instrumental, or the page layout changed.'
      )
    }

    const normalized = normalizeGeniusLyrics(extracted)
    writeCache(this.lyricsCache, cacheKey, normalized, LYRICS_CACHE_TTL_MS)
    return normalized
  }

  clearCache(): void {
    this.searchCache.clear()
    this.lyricsCache.clear()
  }

  /** Spaces outbound requests so rapid typing can't burst against the host. */
  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }
}

// ─── HTML extraction ──────────────────────────────────────────────────────────

function extractLyricContainersFromHtml(html: string): string[] {
  const $ = cheerio.load(html)
  const parts: string[] = []
  $('div[data-lyrics-container="true"]').each((_, element) => {
    const node = $(element)
    // Inline formatting help and song-bio teasers Genius nests in the container.
    node.find('[data-exclude-from-selection="true"]').remove()
    node.find('br').replaceWith('\n')
    parts.push(node.text())
  })
  return parts
}

/** @deprecated Prefer extractLyricContainersFromHtml + selectPrimaryLyricSegment */
export function extractLyricsFromHtml(html: string): string {
  return extractLyricContainersFromHtml(html).join('\n')
}

/**
 * Genius live / medley pages often pack several songs into consecutive lyric
 * containers, separated by empty ones.
 *
 * Safety rules (prefer keeping too much over cutting the real song):
 *  1. No empty separators → join every non-empty container (normal multi-page song).
 *  2. Fewer than 3 segments → keep everything. One empty gap is usually layout
 *     noise mid-song, not a medley boundary.
 *  3. No title hit in any segment → keep everything.
 *  4. Otherwise keep a contiguous window around the best title match, and pull in
 *     neighbours that still share vocabulary with it (same song continuing).
 *     Drop only neighbours that look foreign (no title tokens + low overlap).
 */
export function selectPrimaryLyricSegment(containers: string[], title: string): string {
  const segments: string[][] = []
  let current: string[] = []

  for (const raw of containers) {
    const text = raw.trim()
    if (!text) {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
      continue
    }
    current.push(text)
  }
  if (current.length > 0) segments.push(current)

  if (segments.length === 0) return ''

  const bodies = segments.map((segment) => segment.join('\n'))

  // Single run of containers (no empty separators) — one song across pages.
  if (segments.length === 1) return bodies[0]

  // One empty gap is too weak a signal to risk truncating a real song.
  if (segments.length < 3) return bodies.join('\n')

  const tokens = titleTokens(title)
  const scores = bodies.map((body) => scoreLyricSegment(body, tokens))
  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i]
      bestIdx = i
    }
  }

  // Title never appears in the lyric body — do not guess which slice to keep.
  if (bestScore <= 0) return bodies.join('\n')

  const primaryWords = significantWords(bodies[bestIdx])

  // Mark segments that look like a different song from the title match.
  const foreign = bodies.map((_, index) => {
    if (index === bestIdx) return false
    if (scores[index] > 0) return false
    return overlapRatio(primaryWords, significantWords(bodies[index])) < 0.18
  })

  // Nothing looks foreign — empty gaps were probably layout, keep the full page.
  if (!foreign.some(Boolean)) return bodies.join('\n')

  // Contiguous window around the title match, stopping at foreign neighbours.
  let start = bestIdx
  let end = bestIdx
  while (start > 0 && !foreign[start - 1]) start -= 1
  while (end < bodies.length - 1 && !foreign[end + 1]) end += 1

  return bodies.slice(start, end + 1).join('\n')
}

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'feat', 'featuring', 'official', 'lyrics',
  'with', 'from', 'live', 'remix',
])

function titleTokens(title: string): string[] {
  return canonicalText(title)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !TITLE_STOPWORDS.has(w))
}

function scoreLyricSegment(body: string, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const canon = canonicalText(body)
  let score = 0
  for (const token of tokens) {
    if (!canon.includes(token)) continue
    // Longer title tokens (Ijadopin) outweigh short ones (ija).
    score += token.length >= 6 ? 4 : token.length >= 4 ? 2 : 1
  }
  return score
}

function significantWords(text: string): Set<string> {
  return new Set(
    canonicalText(text)
      .split(' ')
      .map((w) => w.trim())
      .filter((w) => w.length >= 4 && !TITLE_STOPWORDS.has(w))
  )
}

/** Share of the smaller set also present in the larger one. */
function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const word of small) {
    if (large.has(word)) shared += 1
  }
  return shared / small.size
}

/** "https://genius.com/Apostle-bamilaw-ijadopin-lyrics" → "apostle bamilaw ijadopin" */
function titleFromGeniusUrl(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return slug.replace(/-lyrics$/i, '').replace(/-/g, ' ').trim()
  } catch {
    return ''
  }
}

// ─── Cache + error helpers ────────────────────────────────────────────────────

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function toFriendlyError(err: unknown, action: string): Error {
  const axiosErr = err as AxiosError
  const status = axiosErr?.response?.status

  if (status === 429 || status === 403) {
    return new Error('Genius is rate limiting this connection. Wait a minute and try again.')
  }
  if (status === 404) {
    return new Error('That song is no longer available on Genius.')
  }
  if (axiosErr?.code === 'ECONNABORTED') {
    return new Error(`Timed out trying to ${action}.`)
  }
  if (axiosErr?.code === 'ENOTFOUND' || axiosErr?.code === 'EAI_AGAIN') {
    return new Error('No internet connection.')
  }
  log.warn(`[LyricsScraper] Failed to ${action}`, err)
  return new Error(`Could not ${action}. ${axiosErr?.message ?? 'Unknown error.'}`)
}

export const lyricsScraperService = new LyricsScraperService()

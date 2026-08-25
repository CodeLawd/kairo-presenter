import axios, { AxiosError } from 'axios'
import * as cheerio from 'cheerio'
import log from 'electron-log/main'
import type { ProviderResult } from './provider-types'
import { canonicalText } from './normalize'
import { lrclibService } from './lrclib'
import { lyricsScraperService } from './scraper'
import { isAllowedLyricsUrl, scrapeLyricsPage } from './web-lyrics'
import { cleanPageTitle } from './page-title'

/**
 * Last-resort tier when Genius / LRCLIB miss a song.
 *
 * Nigerian and African gospel repertoire often never lands in those catalogues.
 * A general web index finds the lyric blog posts; this module scrapes the
 * allowlisted pages and returns them as importable results.
 *
 * Brave Search API is preferred when a key is configured. Without one, the
 * public Brave HTML results page is used so the tier still works offline of
 * any paid plan.
 */

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_HTML_URL = 'https://search.brave.com/search'
const REQUEST_TIMEOUT_MS = 12_000
const MIN_REQUEST_GAP_MS = 1_100
const MAX_WEB_RESULTS = 8
const MAX_CANDIDATES = 4
const MAX_DIRECT_PAGES = 2
const MAX_SCRAPE_PAGES = 3

/** Shortest query that is still worth a web round-trip. */
export const MIN_WEB_QUERY_CHARS = 3

const CACHE_TTL_MS = 10 * 60_000

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

interface BraveWebResult {
  title?: string
  url?: string
  description?: string
}

interface CacheEntry {
  value: ProviderResult[]
  expiresAt: number
}

// Re-export so existing tests keep a stable import path.
export { cleanPageTitle } from './page-title'

class SnippetResolver {
  private cache = new Map<string, CacheEntry>()
  private lastRequestAt = 0

  /**
   * Resolves a query the catalogues could not place.
   *
   * `apiKey` is optional — without it we fall back to Brave's HTML results.
   */
  async resolve(snippet: string, apiKey?: string): Promise<ProviderResult[]> {
    const query = snippet.trim()
    if (query.length < MIN_WEB_QUERY_CHARS) return []

    const cacheKey = query.toLowerCase()
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    this.cache.delete(cacheKey)

    let webResults: BraveWebResult[]
    try {
      webResults = apiKey
        ? await this.searchWebApi(query, apiKey)
        : await this.searchWebHtml(query)
    } catch (err) {
      log.warn('[SnippetResolver] web search failed', err)
      return []
    }

    if (webResults.length === 0) return []

    const canonicalSnippet = canonicalText(query)
    const verified = await this.gatherCandidates(webResults, canonicalSnippet, query)

    this.cache.set(cacheKey, { value: verified, expiresAt: Date.now() + CACHE_TTL_MS })
    log.info('[SnippetResolver] resolved', {
      query,
      web: webResults.length,
      verified: verified.length,
      via: apiKey ? 'api' : 'html',
    })
    return verified
  }

  private async gatherCandidates(
    webResults: BraveWebResult[],
    canonicalSnippet: string,
    rawQuery: string
  ): Promise<ProviderResult[]> {
    const found: ProviderResult[] = []
    const seen = new Set<string>()

    const push = (result: ProviderResult): void => {
      const key = `${canonicalText(result.title)}|${canonicalText(result.artist)}`
      if (seen.has(key)) return
      seen.add(key)
      found.push(result)
    }

    // 1. Direct Genius lyric pages from the SERP.
    const geniusUrls = webResults
      .map((result) => result.url ?? '')
      .filter((url) => /^https:\/\/(www\.)?genius\.com\/[^/]+-lyrics\/?$/.test(url))
      .slice(0, MAX_DIRECT_PAGES)

    for (const url of geniusUrls) {
      try {
        const { title, artist } = titleFromGeniusUrl(url)
        const lyrics = await lyricsScraperService.fetchLyrics(url, { title })
        if (!matchesQuery(lyrics, canonicalSnippet) && !titleMatchesQuery(url, rawQuery)) continue
        push({ id: `genius:${url}`, provider: 'genius', title, artist, url, lyrics })
      } catch (err) {
        log.warn('[SnippetResolver] genius page failed', { url, err })
      }
    }

    // 2. Scrape allowlisted lyric blogs (African Gospel Lyrics, etc.).
    const scrapeUrls = webResults
      .map((result) => result.url ?? '')
      .filter((url) => isAllowedLyricsUrl(url) && !/\/tag\/|\/category\/|\/page\//i.test(url))
      .slice(0, MAX_SCRAPE_PAGES)

    for (const url of scrapeUrls) {
      try {
        const page = await scrapeLyricsPage(url)
        const lyricHit = matchesQuery(page.lyrics, canonicalSnippet)
        const titleHit =
          titleMatchesQuery(page.title, rawQuery) || titleMatchesQuery(`${page.title} ${page.artist}`, rawQuery)
        if (!lyricHit && !titleHit) continue
        push({
          id: `web:${url}`,
          provider: 'web',
          title: page.title,
          artist: page.artist,
          url: page.url,
          lyrics: page.lyrics,
          snippet: lyricHit ? firstMatchingLine(page.lyrics, canonicalSnippet) : undefined,
        })
      } catch (err) {
        log.warn('[SnippetResolver] scrape failed', { url, err })
      }
    }

    // 3. Re-query LRCLIB with cleaned page titles — covers songs the catalogues
    // do have once we know the real name.
    if (found.length === 0) {
      const queries = dedupeQueries(webResults.map((result) => cleanPageTitle(result.title ?? '')))
      for (const candidate of queries.slice(0, MAX_CANDIDATES)) {
        let hits: ProviderResult[]
        try {
          hits = await lrclibService.search(candidate)
        } catch {
          continue
        }
        for (const hit of hits) {
          if (!hit.lyrics) continue
          if (!matchesQuery(hit.lyrics, canonicalSnippet) && !titleMatchesQuery(hit.title, rawQuery)) {
            continue
          }
          push({
            ...hit,
            snippet: firstMatchingLine(hit.lyrics, canonicalSnippet),
          })
        }
        if (found.length > 0) break
      }
    }

    return found
  }

  private async searchWebApi(query: string, apiKey: string): Promise<BraveWebResult[]> {
    await this.throttle()
    try {
      const response = await axios.get(BRAVE_SEARCH_URL, {
        params: { q: `${query} lyrics`, count: MAX_WEB_RESULTS },
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
        },
        timeout: REQUEST_TIMEOUT_MS,
      })
      const results = (response.data as { web?: { results?: BraveWebResult[] } })?.web?.results
      return Array.isArray(results) ? results.slice(0, MAX_WEB_RESULTS) : []
    } catch (err) {
      throw toFriendlyError(err)
    }
  }

  /** Keyless fallback — parse Brave's public HTML results page. */
  private async searchWebHtml(query: string): Promise<BraveWebResult[]> {
    await this.throttle()
    try {
      const response = await axios.get<string>(BRAVE_HTML_URL, {
        params: { q: `${query} lyrics` },
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
      })
      return parseBraveHtml(response.data).slice(0, MAX_WEB_RESULTS)
    } catch (err) {
      throw toFriendlyError(err)
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }
}

/** Exported for tests. */
export function parseBraveHtml(html: string): BraveWebResult[] {
  const $ = cheerio.load(html)
  const results: BraveWebResult[] = []
  const seen = new Set<string>()

  $('div[data-type="web"] a[href^="http"], .snippet a[href^="http"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || seen.has(href)) return
    if (/brave\.com|youtube\.com|youtu\.be|scribd\.com|facebook\.com/i.test(href)) return
    seen.add(href)
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    // Brave often prefixes "Site domain.com › path Title…"
    const title = text
      .replace(/^[^\s]+\s+\S+\s+›\s+[^\s]+\s+/, '')
      .replace(/^[A-Za-z0-9 .-]+\s+\S+\s+›\s+/, '')
      .trim() || text
    results.push({ title, url: href })
  })

  return results
}

function matchesQuery(lyrics: string, canonicalSnippet: string): boolean {
  if (!canonicalSnippet) return false
  const body = canonicalText(lyrics)
  if (body.includes(canonicalSnippet)) return true
  // Tolerate slight transcription drift on longer remembered lines.
  const words = canonicalSnippet.split(' ').filter((word) => word.length > 1)
  if (words.length < 3) return false
  const hit = words.filter((word) => body.includes(word)).length
  return hit / words.length >= 0.75
}

function titleMatchesQuery(titleOrUrl: string, rawQuery: string): boolean {
  const title = canonicalText(titleOrUrl.replace(/https?:\/\/[^/]+\//, ' ').replace(/[-_/]/g, ' '))
  const query = canonicalText(rawQuery)
  if (!title || !query) return false
  if (title.includes(query) || query.includes(title)) return true
  // "ami oluwa" ↔ "amioluwa"
  const collapsedTitle = title.replace(/\s+/g, '')
  const collapsedQuery = query.replace(/\s+/g, '')
  if (collapsedTitle.includes(collapsedQuery) || collapsedQuery.includes(collapsedTitle)) return true
  const words = query.split(' ').filter((w) => w.length > 2)
  if (words.length === 0) return false
  const hit = words.filter((w) => title.includes(w) || collapsedTitle.includes(w)).length
  return hit / words.length >= 0.75
}

function firstMatchingLine(lyrics: string, canonicalSnippet: string): string | undefined {
  for (const line of lyrics.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && canonicalText(trimmed).includes(canonicalSnippet.split(' ')[0] ?? '')) {
      if (canonicalText(trimmed).includes(canonicalSnippet) || canonicalSnippet.split(' ').length <= 2) {
        return trimmed
      }
    }
  }
  return lyrics.split('\n').map((l) => l.trim()).find(Boolean)
}

function titleFromGeniusUrl(url: string): { title: string; artist: string } {
  const slug = url.replace(/^https:\/\/(www\.)?genius\.com\//, '').replace(/-lyrics\/?$/, '')
  const words = slug.split('-').filter(Boolean)
  const titleCase = (parts: string[]): string =>
    parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  const split = Math.min(2, Math.max(1, words.length - 1))
  return { artist: titleCase(words.slice(0, split)), title: titleCase(words.slice(split)) }
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const query of queries) {
    const key = canonicalText(query)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(query)
  }
  return out
}

function toFriendlyError(err: unknown): Error {
  const axiosErr = err as AxiosError
  const status = axiosErr?.response?.status
  if (status === 401 || status === 403) return new Error('The Brave Search API key was rejected.')
  if (status === 429) return new Error('Brave Search quota reached for now.')
  return new Error(`Web search failed. ${axiosErr?.message ?? 'Unknown error.'}`)
}

export const snippetResolver = new SnippetResolver()

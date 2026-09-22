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

/**
 * Headers a real browser sends. The keyless engines all bot-check, and a bare
 * `User-Agent` with no `Accept-Language` is the giveaway that gets a request
 * served a challenge page instead of results.
 */
const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

/**
 * Keyless engines, tried in order until one returns results.
 *
 * Every one of them rate-limits and serves captchas to unattended requests,
 * but they do it independently: when one is blocking this machine another
 * usually is not. A single engine made the whole web tier unavailable — and
 * with it, every song the catalogues do not carry.
 */
const HTML_ENGINES: { name: string; url: string; parse: (html: string) => BraveWebResult[] }[] = [
  { name: 'duckduckgo', url: 'https://html.duckduckgo.com/html/', parse: parseDuckHtml },
  { name: 'duckduckgo-lite', url: 'https://lite.duckduckgo.com/lite/', parse: parseDuckHtml },
  { name: 'brave', url: 'https://search.brave.com/search', parse: parseBraveHtml },
  { name: 'mojeek', url: 'https://www.mojeek.com/search', parse: parseMojeekHtml },
]

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

    let webResults: BraveWebResult[] = []
    let usedApi = false
    if (apiKey) {
      try {
        webResults = await this.searchWebApi(query, apiKey)
        usedApi = true
      } catch (err) {
        // A rejected or exhausted key must not take the tier down with it —
        // the keyless engines are still there, and a booth mid-service would
        // otherwise lose every song the catalogues do not carry.
        log.warn('[SnippetResolver] Brave API search failed, falling back to keyless engines', {
          error: (err as Error).message,
        })
      }
    }

    if (webResults.length === 0) {
      try {
        webResults = await this.searchWebHtml(query)
      } catch (err) {
        log.warn('[SnippetResolver] web search failed', err)
        return []
      }
    }

    if (webResults.length === 0) return []

    const canonicalSnippet = canonicalText(query)
    const verified = await this.gatherCandidates(webResults, canonicalSnippet, query)

    this.cache.set(cacheKey, { value: verified, expiresAt: Date.now() + CACHE_TTL_MS })
    log.info('[SnippetResolver] resolved', {
      query,
      web: webResults.length,
      verified: verified.length,
      via: usedApi ? 'api' : 'html',
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

  /**
   * Keyless fallback — public HTML result pages.
   *
   * Each engine gets one attempt; a block, a challenge page or an empty parse
   * moves on to the next rather than failing the tier. Only a clean sweep
   * throws, and then with the first engine's reason.
   */
  private async searchWebHtml(query: string): Promise<BraveWebResult[]> {
    let firstError: Error | null = null

    for (const engine of HTML_ENGINES) {
      await this.throttle()
      try {
        const response = await axios.get<string>(engine.url, {
          params: { q: `${query} lyrics` },
          headers: BROWSER_HEADERS,
          timeout: REQUEST_TIMEOUT_MS,
          responseType: 'text',
          // A challenge page is a 202 here, not an error status.
          validateStatus: (status) => status >= 200 && status < 400,
        })
        if (looksLikeChallenge(response.data)) {
          log.warn('[SnippetResolver] web engine served a challenge page', { engine: engine.name })
          continue
        }
        const results = engine.parse(response.data).slice(0, MAX_WEB_RESULTS)
        if (results.length > 0) {
          log.info('[SnippetResolver] web engine answered', { engine: engine.name, results: results.length })
          return results
        }
        log.warn('[SnippetResolver] web engine returned nothing', {
          engine: engine.name,
          status: response.status,
        })
      } catch (err) {
        const friendly = toFriendlyError(err)
        log.warn('[SnippetResolver] web engine failed', { engine: engine.name, error: friendly.message })
        firstError = firstError ?? friendly
      }
    }

    if (firstError) throw firstError
    return []
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

/** Result links that are never a lyrics page worth scraping. */
const JUNK_HOST = /brave\.com|duckduckgo\.com|mojeek\.com|google\.|bing\.com|youtube\.com|youtu\.be|scribd\.com|facebook\.com|instagram\.com|tiktok\.com|spotify\.com|apple\.com/i

/**
 * DuckDuckGo's HTML results wrap every link in a redirect
 * (`//duckduckgo.com/l/?uddg=<encoded>`), so the real URL has to be unwrapped
 * before the allowlist can judge it.
 */
export function parseDuckHtml(html: string): BraveWebResult[] {
  const $ = cheerio.load(html)
  const results: BraveWebResult[] = []
  const seen = new Set<string>()

  $('a.result__a, a.result-link, h2 a[href]').each((_, el) => {
    const href = unwrapDuckUrl($(el).attr('href') ?? '')
    if (!href || seen.has(href) || JUNK_HOST.test(href)) return
    seen.add(href)
    results.push({ title: $(el).text().replace(/\s+/g, ' ').trim(), url: href })
  })

  return results
}

function unwrapDuckUrl(href: string): string {
  if (!href) return ''
  const absolute = href.startsWith('//') ? `https:${href}` : href
  const encoded = absolute.match(/[?&]uddg=([^&]+)/)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      return ''
    }
  }
  return absolute.startsWith('http') ? absolute : ''
}

/** Mojeek puts each hit in `ul.results-standard li > h2 > a`. */
export function parseMojeekHtml(html: string): BraveWebResult[] {
  const $ = cheerio.load(html)
  const results: BraveWebResult[] = []
  const seen = new Set<string>()

  $('ul.results-standard li h2 a[href^="http"], li.result h2 a[href^="http"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href || seen.has(href) || JUNK_HOST.test(href)) return
    seen.add(href)
    const title = $(el).text().replace(/\s+/g, ' ').trim()
    if (!title) return
    results.push({ title, url: href })
  })

  return results
}

/**
 * True when an engine served a captcha or interstitial instead of results.
 *
 * These pages still parse — as navigation and footer links — so without this
 * check the tier would hand a "Newsletter" link to the scraper and report a
 * successful search.
 */
export function looksLikeChallenge(html: string): boolean {
  const head = html.slice(0, 4000)
  const title = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? ''
  if (/captcha|robot|unusual traffic|are you human|access denied|just a moment/i.test(title)) {
    return true
  }
  return /enable javascript and cookies to continue|verify you are (a )?human/i.test(head)
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
  // Brave answers a bad key with 422 and its own error code, not 401/403, so
  // the status alone would read as "malformed request" and send an operator
  // hunting the wrong problem.
  const code = (axiosErr?.response?.data as { error?: { code?: string } } | undefined)?.error?.code
  if (code === 'SUBSCRIPTION_TOKEN_INVALID' || status === 401 || status === 403) {
    return new Error('The Brave Search API key was rejected. Check it in Settings → API Keys.')
  }
  if (code === 'RATE_LIMITED' || status === 429) {
    return new Error('Web search is rate-limiting this machine right now.')
  }
  return new Error(`Web search failed. ${axiosErr?.message ?? 'Unknown error.'}`)
}

export const snippetResolver = new SnippetResolver()

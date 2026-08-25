import axios from 'axios'
import * as cheerio from 'cheerio'
import log from 'electron-log/main'
import {
  cleanGlossSource,
  extractInlineGlossPairs,
  glossMatchKey,
  isGlossLine,
  lookupOnlineGloss,
} from '@shared/lyrics-translate'
import { isAllowedLyricsUrl, structureBilingualHymn } from './web-lyrics'

/**
 * Finds English glosses already published on gospel lyric sites.
 * Prefer these over machine translation for African worship songs.
 */

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_HTML_URL = 'https://search.brave.com/search'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const MAX_PAGES = 3

interface WebHit {
  title?: string
  url?: string
}

export async function fetchOnlineGlossMap(options: {
  title: string
  artist?: string
  braveApiKey?: string
}): Promise<Map<string, string>> {
  const title = options.title.trim()
  if (title.length < 2) return new Map()

  const query = [title, options.artist?.trim(), 'lyrics'].filter(Boolean).join(' ')
  // Bias search toward bilingual gospel / hymn sites that publish real English.
  const glossQuery = `${query} (site:africangospellyrics.com OR site:lyricsom.com OR site:yorubahymns.blogspot.com OR site:blogspot.com)`
  const seedUrls = buildSeedUrls(title, options.artist)
  let hits: WebHit[] = []
  try {
    hits = options.braveApiKey?.trim()
      ? await searchBraveApi(glossQuery, options.braveApiKey.trim())
      : await searchBraveHtml(glossQuery)
    if (hits.length === 0) {
      hits = options.braveApiKey?.trim()
        ? await searchBraveApi(query, options.braveApiKey.trim())
        : await searchBraveHtml(query)
    }
  } catch (err) {
    log.warn('[OnlineGlosses] search failed', err)
  }

  const urls = [
    ...seedUrls,
    ...hits
      .map((hit) => hit.url ?? '')
      .filter((url) => isAllowedLyricsUrl(url) && !/\/tag\/|\/category\/|\/page\//i.test(url)),
  ]
  const seen = new Set<string>()
  const uniqueUrls = urls.filter((url) => {
    if (!url || seen.has(url)) return false
    seen.add(url)
    return true
  }).slice(0, MAX_PAGES + seedUrls.length)

  const merged = new Map<string, string>()
  for (const url of uniqueUrls) {
    try {
      const pairs = await scrapeGlossPairs(url)
      for (const [key, gloss] of pairs) {
        if (!merged.has(key)) merged.set(key, gloss)
      }
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      // Seed URLs are guesses — 404/403 is normal, not a translate failure.
      if (status === 404 || status === 403 || status === 410) {
        log.info('[OnlineGlosses] skip missing page', { url, status })
      } else {
        log.warn('[OnlineGlosses] scrape failed', {
          url,
          status,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  log.info('[OnlineGlosses] harvested', {
    query,
    pages: uniqueUrls.length,
    pairs: merged.size,
  })
  return merged
}

/** Well-known gospel lyric URL shapes — don't rely on search alone. */
function buildSeedUrls(title: string, artist?: string): string[] {
  const slug = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[''`´]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

  // Drop English parentheticals so "Ija D'opin (The Strife is O'er)" → ija-dopin
  const bareTitle = title.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  const t = slug(bareTitle) || slug(title)
  const a = artist ? slug(artist) : ''
  const urls: string[] = []
  const hay = `${title} ${bareTitle}`.toLowerCase()

  // Known bilingual Yoruba hymn — seed before slug guesses (LRCLIB titles vary).
  if (/ija\s*d[''`]?opin|ijadopin|strife is o.?er|ogu+n si\s*tan/i.test(hay)) {
    urls.push('https://yorubahymns.blogspot.com/2015/04/ija-dopin-ogun-si-tan.html')
  }

  if (t) {
    // AG WordPress posts are often /YYYY/MM/DD/slug/ — slug-only also 301s for Odudu.
    urls.push(`https://africangospellyrics.com/${t}/`)
    if (t === 'odudu') {
      urls.push('https://africangospellyrics.com/2026/04/02/odudu/')
    }
    // Known Yoruba hymn archive — slug is usually the Yoruba title words.
    urls.push(`https://yorubahymns.blogspot.com/2015/04/${t}.html`)
    if (t.includes('ija') && (t.includes('dopin') || t.includes('opin'))) {
      urls.push('https://yorubahymns.blogspot.com/2015/04/ija-dopin-ogun-si-tan.html')
    }
    if (a) {
      urls.push(`https://lyricsom.com/${t}-lyrics-by-${a}/`)
      urls.push(`https://gospelsongs.com.ng/${a}-${t}-lyrics/`)
    }
  }
  return urls.filter((url) => isAllowedLyricsUrl(url))
}

export { lookupOnlineGloss, glossMatchKey }

async function scrapeGlossPairs(url: string): Promise<Map<string, string>> {
  const response = await axios.get<string>(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'text',
    // Let callers treat missing seeds as empty rather than thrown Axios dumps.
    validateStatus: (status) => status >= 200 && status < 300,
  })
  // Soft 404 pages sometimes return 200 with “not found” chrome — still parse;
  // empty extraction is fine.
  const $ = cheerio.load(response.data)
  $('script, style, noscript, nav, header, footer, aside, .comments, #comments').remove()

  const root =
    $('.entry-content, .post-content, .post-body, .lyrics, article').first().length > 0
      ? $('.entry-content, .post-content, .post-body, .lyrics, article').first()
      : $('body')

  // Preserve <br> so "line (gloss)" stays on one logical line when sites use breaks.
  const clone = root.clone()
  clone.find('br').replaceWith('\n')
  const text = clone
    .text()
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

  const pairs = extractInlineGlossPairs(text)

  // Also accept already-expanded under-line glosses: source\n(gloss)
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    if (isGlossLine(lines[i + 1]) && !isGlossLine(lines[i])) {
      const cleaned = cleanGlossSource(lines[i])
      const key = glossMatchKey(cleaned)
      const gloss = lines[i + 1].trim().replace(/^\(/, '').replace(/\)$/, '').trim()
      if (key.length >= 3 && gloss && !pairs.has(key)) pairs.set(key, gloss)
    }
  }

  // Numbered bilingual hymns publish English as a second stanza block — zip them.
  const hymn = structureBilingualHymn(text)
  if (hymn) {
    const hymnLines = hymn.split('\n')
    for (let i = 0; i < hymnLines.length - 1; i++) {
      if (
        isGlossLine(hymnLines[i + 1]) &&
        !isGlossLine(hymnLines[i]) &&
        !/^\[/.test(hymnLines[i].trim())
      ) {
        const cleaned = cleanGlossSource(hymnLines[i])
        const key = glossMatchKey(cleaned)
        const gloss = hymnLines[i + 1].trim().replace(/^\(/, '').replace(/\)$/, '').trim()
        if (key.length >= 3 && gloss && !pairs.has(key)) pairs.set(key, gloss)
      }
    }
  }

  return pairs
}

async function searchBraveApi(query: string, apiKey: string): Promise<WebHit[]> {
  const response = await axios.get(BRAVE_SEARCH_URL, {
    params: { q: query, count: 8 },
    headers: {
      'X-Subscription-Token': apiKey,
      Accept: 'application/json',
    },
    timeout: REQUEST_TIMEOUT_MS,
  })
  const results = (response.data as { web?: { results?: WebHit[] } })?.web?.results
  return Array.isArray(results) ? results : []
}

async function searchBraveHtml(query: string): Promise<WebHit[]> {
  const response = await axios.get<string>(BRAVE_HTML_URL, {
    params: { q: query },
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'text',
  })
  const $ = cheerio.load(response.data)
  const results: WebHit[] = []
  const seen = new Set<string>()
  $('div[data-type="web"] a[href^="http"], .snippet a[href^="http"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || seen.has(href)) return
    if (/brave\.com|youtube\.com|youtu\.be|facebook\.com/i.test(href)) return
    seen.add(href)
    results.push({ title: $(el).text().trim(), url: href })
  })
  return results
}

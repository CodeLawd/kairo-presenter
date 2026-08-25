import axios, { AxiosError } from 'axios'
import * as cheerio from 'cheerio'
import log from 'electron-log/main'
import { structureLyrics } from './normalize'
import {
  expandInlineGlossesToLines,
  isGlossLine,
} from '@shared/lyrics-translate'

/**
 * Fetches lyrics from gospel / lyric sites that Genius and LRCLIB never carry.
 *
 * African worship repertoire often lives on blogs and lyric sites long before it
 * reaches a structured catalogue. The snippet resolver finds those pages via
 * web search; this module turns a page URL into section-marked lyric text.
 */

const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** Hosts we are willing to scrape. Anything else is ignored. */
const ALLOWED_HOSTS = new Set([
  'africangospellyrics.com',
  'www.africangospellyrics.com',
  'lyricsom.com',
  'www.lyricsom.com',
  'tooxclusive.com',
  'www.tooxclusive.com',
  'mpmania.com',
  'www.mpmania.com',
  'ceenaija.com',
  'www.ceenaija.com',
  'gospelsongs.com.ng',
  'www.gospelsongs.com.ng',
  'notjustok.com',
  'www.notjustok.com',
])

export interface ScrapedLyricsPage {
  title: string
  artist: string
  lyrics: string
  url: string
}

export function isAllowedLyricsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (ALLOWED_HOSTS.has(host)) return true
    // Yoruba / African hymn archives often live on Blogger (e.g. yorubahymns.blogspot.com).
    if (host.endsWith('.blogspot.com') || host.endsWith('.blogspot.co.uk')) return true
    return false
  } catch {
    return false
  }
}

/**
 * Pulls title, artist and lyric body from an allowlisted lyric page.
 */
export async function scrapeLyricsPage(url: string): Promise<ScrapedLyricsPage> {
  if (!isAllowedLyricsUrl(url)) {
    throw new Error('Refusing to scrape a non-allowlisted lyrics host.')
  }

  let html: string
  try {
    const response = await axios.get<string>(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
    })
    html = response.data
  } catch (err) {
    throw toFriendlyError(err)
  }

  const $ = cheerio.load(html)
  // Comments, share widgets and related-post footers drown the lyric body.
  $('script, style, noscript, nav, header, footer, aside, .comments, #comments, .sharedaddy, .jp-relatedposts').remove()

  const pageTitle =
    $('h1.entry-title, h1.post-title, article h1, .entry-header h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim()

  const { title, artist } = parsePageHeading(pageTitle)

  const body = extractLyricBody($)
  if (!body.trim()) {
    throw new Error('No lyrics found on that page.')
  }

  const cleaned = cleanScrapedLyrics(body)
  // Numbered bilingual hymns (Yoruba + English on one page) → verses with glosses.
  const structured = structureBilingualHymn(cleaned) ?? structureLyrics(cleaned)
  log.info('[WebLyrics] scraped', { url, title, artist, chars: structured.length })
  return { title, artist, lyrics: structured, url }
}

function extractLyricBody($: cheerio.CheerioAPI): string {
  const selectors = [
    '.post-body.entry-content',
    '.post-body',
    '.entry-content',
    '.post-content',
    '.lyrics',
    'article .content',
    'article',
  ]

  for (const selector of selectors) {
    const root = $(selector).first()
    if (root.length === 0) continue

    // Prefer explicit paragraphs — they keep stanza breaks intact.
    // Preserve <br> as real newlines; collapsing whitespace used to jam an
    // entire stanza onto one scrolling slide.
    const paragraphs = root
      .find('p')
      .map((_, el) => {
        const $p = $(el).clone()
        $p.find('br').replaceWith('\n')
        return $p
          .text()
          .replace(/\u00a0/g, ' ')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => line.replace(/[ \t]+/g, ' ').trim())
          .filter(Boolean)
          .join('\n')
      })
      .get()
      .filter((block) => block.length > 0 && !isBoilerplate(block))

    if (paragraphs.length >= 2) return paragraphs.join('\n\n')

    const clone = root.clone()
    clone.find('br').replaceWith('\n')
    const text = clone
      .text()
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .trim()
    if (text.length > 80) return text
  }

  return ''
}

function isBoilerplate(line: string): boolean {
  const lower = line.toLowerCase()
  return (
    lower.startsWith('languages:') ||
    lower.startsWith('discover more') ||
    lower.startsWith('subscribe') ||
    lower.startsWith('leave a comment') ||
    lower.startsWith('share this') ||
    lower.startsWith('type your email') ||
    lower.startsWith('posted by') ||
    lower.startsWith('email this') ||
    lower.includes('wordpress.com account') ||
    lower.includes('sign me up') ||
    /^related\b/.test(lower) ||
    /^comments?\b/.test(lower)
  )
}

/**
 * Turns a bilingual hymn page (source language stanzas, then English stanzas)
 * into `[Verse N]` blocks with English lines as `(gloss)` rows.
 *
 * Returns null when the page is not a numbered bilingual hymn.
 *
 * @see https://yorubahymns.blogspot.com/2015/04/ija-dopin-ogun-si-tan.html
 */
export function structureBilingualHymn(raw: string): string | null {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0 && !isBoilerplate(line))

  if (lines.length < 8) return null

  let sawNumberedVerse = false
  let englishTitleAt = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+\.\s*/.test(lines[i])) {
      sawNumberedVerse = true
      continue
    }
    // After Yoruba verses, the English hymn title is a second all-caps heading.
    if (sawNumberedVerse && isSecondaryHymnTitle(lines[i])) {
      englishTitleAt = i
      break
    }
  }
  if (englishTitleAt < 0) return null

  const sourceVerses = parseNumberedVerses(lines.slice(0, englishTitleAt))
  const englishVerses = parseNumberedVerses(lines.slice(englishTitleAt + 1))
  if (sourceVerses.length < 1 || englishVerses.length === 0) return null

  const englishByNum = new Map(englishVerses.map((verse) => [verse.num, verse.lines]))
  const out: string[] = []

  for (const verse of sourceVerses) {
    out.push('', `[Verse ${verse.num}]`)
    const glossLines = englishByNum.get(verse.num) ?? []
    const count = Math.max(verse.lines.length, glossLines.length)
    for (let i = 0; i < count; i++) {
      const source = verse.lines[i]
      const gloss = glossLines[i]
      if (source) out.push(source)
      if (gloss) out.push(`(${gloss})`)
    }
  }

  const structured = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return structured.includes('[Verse') ? structured : null
}

function isSecondaryHymnTitle(line: string): boolean {
  if (line.length < 12 || /^\d+\./.test(line)) return false
  const letters = line.replace(/[^A-Za-z]/g, '')
  if (letters.length < 10) return false
  const upper = (letters.match(/[A-Z]/g) ?? []).length
  if (upper / letters.length < 0.8) return false
  // Prefer titles that look English so we don't split on a second Yoruba heading.
  return /\b(the|is|of|and|for|lord|battle|done|over|o'?er|strife|strive|song|hymn)\b/i.test(
    line
  )
}

function parseNumberedVerses(lines: string[]): { num: number; lines: string[] }[] {
  const verses: { num: number; lines: string[] }[] = []
  let current: { num: number; lines: string[] } | null = null

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.*)$/)
    if (match) {
      if (current) {
        current.lines = reflowBrokenLines(current.lines)
        verses.push(current)
      }
      const rest = match[2].trim()
      current = { num: parseInt(match[1], 10) || verses.length + 1, lines: rest ? [rest] : [] }
      continue
    }
    if (!current) continue
    if (isSecondaryHymnTitle(line)) break
    current.lines.push(line)
  }
  if (current) {
    current.lines = reflowBrokenLines(current.lines)
    verses.push(current)
  }
  return verses
}

/**
 * Blogger wraps English hymn lines mid-phrase ("1. The" / "strive is O'er…").
 * Join short fragments back into singable lines.
 */
function reflowBrokenLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    const isAlleluia = /^(alleluia|hallelujah|amen)\b/i.test(line)
    const prevIsAlleluia = prev ? /^(alleluia|hallelujah|amen)\b/i.test(prev) : false
    if (
      prev &&
      !isAlleluia &&
      !prevIsAlleluia &&
      prev.length < 28 &&
      !/[.!?]$/.test(prev)
    ) {
      out[out.length - 1] = `${prev} ${line}`.replace(/\s+/g, ' ').trim()
    } else {
      out.push(line)
    }
  }
  return out
}

/**
 * Strips translation parentheticals that African Gospel Lyrics embeds inline —
 * "Odudu dabu Jesus no (There is no other Name like Jesus)" keeps the singable
 * line and drops the English gloss so slides stay short.
 */
export function cleanScrapedLyrics(raw: string): string {
  return expandInlineGlossesToLines(
    raw.replace(/\r\n?/g, '\n').replace(/\bx\d+\b/gi, '')
  )
    // Mid-line parentheticals only — never cross newlines (gloss rows stay).
    .replace(/(\S)[^\S\n]*\([^)\n]{0,120}\)/g, '$1')
    .replace(/^\s*(spoken|refrain|chorus|verse|bridge|pre-?chorus)\s*:?\s*/gim, (match) => {
      const label = match.replace(/[:\s]/g, '')
      if (/^(spoken)$/i.test(label)) return '[Verse]\n'
      if (/^(refrain|chorus)$/i.test(label)) return '[Chorus]\n'
      if (/^pre-?chorus$/i.test(label)) return '[Pre-Chorus]\n'
      if (/^bridge$/i.test(label)) return '[Bridge]\n'
      if (/^verse$/i.test(label)) return '[Verse]\n'
      return match
    })
    // Stanzas jammed with double spaces → one lyric line each.
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trimEnd()
      if (!trimmed.trim()) return ['']
      if (/^\[.+\]$/.test(trimmed.trim())) return [trimmed.trim()]
      if (isGlossLine(trimmed.trim())) return [trimmed.trim()]
      if (/\s{2,}/.test(trimmed)) {
        return trimmed.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean)
      }
      return [trimmed]
    })
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * "Odudu (Spirit) Lyrics by Theophilus Sunday | African Gospel Lyrics"
 * → { title: "Odudu", artist: "Theophilus Sunday" }
 */
export function parsePageHeading(raw: string): { title: string; artist: string } {
  let heading = (raw ?? '').split('|')[0].trim()

  const lyricsSplit = heading.match(/^(.*?)\s+lyrics(?:\s+by)?\s+(.+)$/i)
  if (lyricsSplit) {
    return {
      title: stripParenthetical(lyricsSplit[1]),
      artist: cleanArtist(lyricsSplit[2]),
    }
  }

  heading = heading.replace(/\s+lyrics\s*$/i, '').trim()

  const byMatch = heading.match(/^(.*?)\s+by\s+(.+)$/i)
  if (byMatch) {
    return {
      title: stripParenthetical(byMatch[1]),
      artist: cleanArtist(byMatch[2]),
    }
  }

  // "Amioluwa (The Mark of God) Sunmisola Agbebi and Yinka Okeleye"
  const trailingArtists = heading.match(
    /^(.*?)[\s,]+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3}(?:\s+(?:and|&|,)\s+[A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3})+)$/
  )
  if (trailingArtists && trailingArtists[1].trim().length >= 3) {
    return {
      title: stripParenthetical(trailingArtists[1]),
      artist: cleanArtist(trailingArtists[2]),
    }
  }

  return { title: stripParenthetical(heading) || 'Untitled', artist: '' }
}

function cleanArtist(value: string): string {
  return value
    .replace(/\s+and\s+/gi, ', ')
    .replace(/\s*[-–—]\s*[\w.-]+\.(com|ng|net|org)\b.*$/i, '')
    .trim()
}

function stripParenthetical(value: string): string {
  return value.replace(/\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function toFriendlyError(err: unknown): Error {
  const axiosErr = err as AxiosError
  if (axiosErr?.code === 'ECONNABORTED') return new Error('Timed out fetching lyrics page.')
  if (axiosErr?.code === 'ENOTFOUND' || axiosErr?.code === 'EAI_AGAIN') {
    return new Error('No internet connection.')
  }
  return new Error(`Could not fetch lyrics page. ${axiosErr?.message ?? 'Unknown error.'}`)
}

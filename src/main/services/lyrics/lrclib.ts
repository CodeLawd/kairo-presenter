import axios, { AxiosError } from 'axios'
import log from 'electron-log/main'
import type { ProviderResult } from './provider-types'
import { canonicalText, structureLyrics } from './normalize'

/**
 * LRCLIB — a free, keyless, open lyrics database.
 *
 * It exists alongside Genius because the two have very different catalogues.
 * Genius indexes lyric bodies but skews Western pop; LRCLIB is crowdsourced
 * from music players and covers gospel, worship and non-Western repertoire
 * that Genius simply does not carry.
 *
 * Its search matches track and artist metadata only — not lyric bodies — but
 * every hit ships its lyrics inline, so a snippet the operator half-remembers
 * can still be matched locally against the returned text.
 */

const SEARCH_URL = 'https://lrclib.net/api/search'
const GET_URL = 'https://lrclib.net/api/get'
const REQUEST_TIMEOUT_MS = 12_000
/** GET can be slower than search; give it a bit more room before failing import. */
const FETCH_TIMEOUT_MS = 20_000
const MAX_RESULTS = 8

/** LRCLIB asks clients to identify themselves rather than spoof a browser. */
const USER_AGENT = 'Kairo (https://github.com/CodeLawd/kairo-presenter)'

const SEARCH_CACHE_TTL_MS = 5 * 60_000
/** Keep search-inline lyrics around so preview/import skip a second round trip. */
const LYRICS_CACHE_TTL_MS = 30 * 60_000

interface LrclibTrack {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

interface CacheEntry {
  value: ProviderResult[]
  expiresAt: number
}

interface LyricsCacheEntry {
  plain: string
  expiresAt: number
}

/**
 * LRCLIB is crowdsourced from media players, so a lot of entries carry the
 * YouTube title they were ripped from rather than the song name.
 *
 * "Ese (Thank You) | NATHANIEL BASSEY feat. AIDEE IME - #nathanielbassey"
 * needs to read "Ese (Thank You)" before it can sit in a list next to a
 * hand-entered library song.
 */
export function cleanTrackTitle(raw: string): string {
  let title = (raw ?? '').trim()

  // Everything from the first pipe on is channel/description noise.
  title = title.split('|')[0]
  // Trailing hashtag runs, with or without a leading dash.
  title = title.replace(/\s*[-–—]?\s*(#[\w'’-]+\s*)+$/u, '')
  // Bracketed distribution tags that aren't part of the song name.
  title = title.replace(
    /\s*[([]\s*(official\s*)?(music\s*)?(video|audio|lyrics?|lyric video|visualizer|hd|4k)\s*[)\]]/gi,
    ''
  )
  title = title.replace(/\s{2,}/g, ' ').replace(/[\s\-–—,]+$/u, '').trim()

  return title || (raw ?? '').trim()
}

/**
 * LRCLIB lists the same recording once per tagging variant — same song under
 * "Nathaniel Bassey", "Nathaniel Bassey Main" and "NATHANIEL BASSEY". Keying on
 * canonicalised title plus the first-credited artist collapses those.
 */
function dedupeKey(title: string, artist: string): string {
  const primaryArtist = artist.split(/[;,]|\bfeat\.?\b|\bft\.?\b/i)[0]
  return `${canonicalText(title)}|${canonicalText(primaryArtist)}`
}

class LrclibService {
  private searchCache = new Map<string, CacheEntry>()
  /** Plain lyrics keyed by track id — filled by search, reused by fetchLyrics. */
  private lyricsCache = new Map<string, LyricsCacheEntry>()

  /**
   * Searches LRCLIB by track or artist name.
   *
   * Results carry their lyrics inline so the caller can rank by snippet match
   * without a second round trip per candidate.
   */
  async search(query: string): Promise<ProviderResult[]> {
    const q = query.trim()
    if (q.length < 3) return []
    return this.runSearch({ q }, q)
  }

  /**
   * Searches by track and artist separately.
   *
   * LRCLIB's free-text `q=` matches one metadata field, so a typed
   * "<title> by <artist>" finds nothing at all — the same song comes straight
   * back when the two halves are sent as `track_name` and `artist_name`.
   */
  async searchStructured(track: string, artist: string): Promise<ProviderResult[]> {
    const trackName = track.trim()
    const artistName = artist.trim()
    if (trackName.length < 2) return []
    return this.runSearch(
      { track_name: trackName, ...(artistName ? { artist_name: artistName } : {}) },
      `${trackName} | ${artistName}`,
    )
  }

  private async runSearch(
    params: Record<string, string>,
    cacheLabel: string,
  ): Promise<ProviderResult[]> {
    const q = cacheLabel.trim()
    const cacheKey = q.toLowerCase()
    const cached = this.searchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      // Re-warm the lyrics cache so import still skips /api/get after a search hit.
      for (const result of cached.value) {
        const id = result.id.replace(/^lrclib:/, '')
        if (result.lyrics?.trim()) {
          this.lyricsCache.set(id, {
            plain: result.lyrics.trim(),
            expiresAt: Date.now() + LYRICS_CACHE_TTL_MS,
          })
        }
      }
      return cached.value
    }
    this.searchCache.delete(cacheKey)

    let tracks: LrclibTrack[]
    try {
      const response = await axios.get<LrclibTrack[]>(SEARCH_URL, {
        params,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      })
      tracks = Array.isArray(response.data) ? response.data : []
    } catch (err) {
      throw toFriendlyError(err, 'search')
    }

    const byKey = new Map<string, ProviderResult>()

    for (const track of tracks) {
      if (typeof track.id !== 'number') continue
      if (track.instrumental) continue

      const lyrics = track.plainLyrics?.trim()
      if (!lyrics) continue

      const title = cleanTrackTitle(track.trackName ?? '')
      const artist = (track.artistName ?? '').trim()
      if (!title) continue

      const key = dedupeKey(title, artist)
      const existing = byKey.get(key)
      // Variants of one recording differ mainly in transcription completeness.
      if (existing && (existing.lyrics?.length ?? 0) >= lyrics.length) continue

      this.rememberPlainLyrics(String(track.id), lyrics)

      byKey.set(key, {
        id: `lrclib:${track.id}`,
        provider: 'lrclib',
        title,
        artist,
        url: `${GET_URL}/${track.id}`,
        album: track.albumName?.trim() || undefined,
        lyrics,
      })
    }

    const results = [...byKey.values()].slice(0, MAX_RESULTS)
    this.searchCache.set(cacheKey, {
      value: results,
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    })
    log.info('[LRCLIB] search', { query: q, raw: tracks.length, results: results.length })
    return results
  }

  /**
   * Returns one record's lyrics as section-marked text.
   * Prefers lyrics already seen during search so preview/import do not depend
   * on a second LRCLIB round trip (which often times out).
   */
  async fetchLyrics(url: string): Promise<string> {
    const id = url.match(/\/api\/get\/(\d+)$/)?.[1]
    if (!id) throw new Error('Refusing to fetch a non-LRCLIB URL.')

    const cached = this.readCachedPlain(id)
    if (cached) return structureLyrics(cached)

    try {
      const plain = await this.fetchPlainLyrics(id)
      this.rememberPlainLyrics(id, plain)
      return structureLyrics(plain)
    } catch (err) {
      // Last chance: any stale cache entry still beats a hard timeout for the booth.
      const stale = this.lyricsCache.get(id)?.plain
      if (stale) {
        log.warn('[LRCLIB] fetch failed — using stale search cache', { id })
        return structureLyrics(stale)
      }
      throw err
    }
  }

  /** Store plain lyrics from search (or another caller) for later preview/import. */
  rememberPlainLyrics(urlOrId: string, plain: string): void {
    const id =
      urlOrId.match(/\/api\/get\/(\d+)$/)?.[1] ??
      urlOrId.replace(/^lrclib:/, '').trim()
    const text = plain.trim()
    if (!id || !/^\d+$/.test(id) || !text) return
    this.lyricsCache.set(id, {
      plain: text,
      expiresAt: Date.now() + LYRICS_CACHE_TTL_MS,
    })
  }

  private readCachedPlain(id: string): string | null {
    const cached = this.lyricsCache.get(id)
    if (!cached) return null
    if (cached.expiresAt < Date.now()) {
      this.lyricsCache.delete(id)
      return null
    }
    return cached.plain
  }

  private async fetchPlainLyrics(id: string): Promise<string> {
    let lastError: unknown
    // One retry — LRCLIB intermittently stalls on /api/get.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await axios.get<LrclibTrack>(`${GET_URL}/${id}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          timeout: FETCH_TIMEOUT_MS,
        })
        const plain = response.data.plainLyrics?.trim()
        if (!plain) {
          throw new Error('That LRCLIB entry has no plain lyrics — it may be instrumental.')
        }
        return plain
      } catch (err) {
        lastError = err
        const code = (err as AxiosError)?.code
        // Don't retry non-timeout errors (404, missing lyrics, etc.).
        if (
          err instanceof Error &&
          err.message.includes('no plain lyrics')
        ) {
          throw err
        }
        if (code !== 'ECONNABORTED' || attempt === 1) break
        log.warn('[LRCLIB] get timed out — retrying', { id, attempt: attempt + 1 })
      }
    }
    throw toFriendlyError(lastError, 'fetch')
  }

  clearCache(): void {
    this.searchCache.clear()
    this.lyricsCache.clear()
  }
}

function toFriendlyError(err: unknown, action: 'search' | 'fetch' = 'search'): Error {
  const axiosErr = err as AxiosError
  const status = axiosErr?.response?.status

  if (status === 404) return new Error('That song is no longer available on LRCLIB.')
  if (status === 429) {
    return new Error('LRCLIB is rate limiting this connection. Wait a minute and try again.')
  }
  if (axiosErr?.code === 'ECONNABORTED') {
    return new Error(
      action === 'fetch' ? 'Timed out fetching lyrics from LRCLIB.' : 'Timed out searching LRCLIB.'
    )
  }
  if (axiosErr?.code === 'ENOTFOUND' || axiosErr?.code === 'EAI_AGAIN') {
    return new Error('No internet connection.')
  }
  log.warn('[LRCLIB] request failed', err)
  return new Error(`Could not reach LRCLIB. ${axiosErr?.message ?? 'Unknown error.'}`)
}

export const lrclibService = new LrclibService()

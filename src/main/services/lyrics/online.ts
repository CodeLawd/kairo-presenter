import log from 'electron-log/main'
import type { LyricsOnlineResult, LyricsProvider } from '@shared/ipc'
import type { ProviderResult } from './provider-types'
import { canonicalText } from './normalize'
import { lyricsScraperService } from './scraper'
import { lrclibService } from './lrclib'
import { MIN_WEB_QUERY_CHARS, snippetResolver } from './snippet-resolver'
import { parseSongQuery, queryVariants } from '@shared/lyrics-query'

/**
 * Fans one query out across every online catalogue and returns a single ranked
 * list.
 *
 * The providers are complementary rather than redundant. Genius indexes lyric
 * bodies, so it answers "I only remember one line" — but only for what it
 * carries, which skews Western. LRCLIB matches titles and artists only, yet its
 * crowdsourced catalogue reaches gospel and non-Western repertoire Genius is
 * missing entirely, and it returns lyrics inline so a snippet can be confirmed
 * locally.
 *
 * When both miss — common for African worship — a web-search tier finds lyric
 * blogs and scrapes allowlisted pages. That path no longer requires an API key.
 */

const MAX_RESULTS = 10

/** Below this, a query is too short for the providers to say anything useful. */
const MIN_QUERY_LENGTH = 3

// ─── Scoring weights ──────────────────────────────────────────────────────────

/**
 * A confirmed phrase hit in the lyric body outranks everything. It is the only
 * signal that is checked locally rather than trusted from a provider, so it is
 * the one we can be sure about.
 */
const SCORE_LYRIC_PHRASE = 6
/** Most of the query's words present, but not as a contiguous phrase. */
const SCORE_LYRIC_WORDS = 2.5
const SCORE_TITLE_EXACT = 5
const SCORE_TITLE_PREFIX = 3
const SCORE_TITLE_CONTAINS = 1.5
/**
 * Per-field weight for the share of query words the field accounts for.
 *
 * The title is worth far more than the credits: someone typing "ese nathaniel
 * bassey" wants the song called Ese, not a different song that happens to
 * feature an artist named Ese.
 */
const SCORE_TITLE_COVERAGE = 4
const SCORE_ARTIST_COVERAGE = 1.5
/**
 * Weight for a result by the artist the operator actually named.
 *
 * "way maker by sinach" is a request for Sinach's recording, not the best-known
 * cover of it, and worship titles are covered constantly. This sits above the
 * completeness and popularity nudges so a fuller or more popular version by
 * someone else cannot outrank the artist who was asked for.
 */
const SCORE_ARTIST_NAMED = 3.5
/** Weight of the provider's own relevance ordering. */
const SCORE_RANK_WEIGHT = 2
/**
 * Ceiling on the popularity nudge. Enough to settle a field of near-identical
 * hits in favour of the version a congregation actually knows, but far below
 * the lyric and title signals it must never override.
 */
const SCORE_POPULARITY_MAX = 1.2
/** Prefer fuller transcriptions when two hits share a title (hymn blogs vs LRCLIB stubs). */
const SCORE_COMPLETENESS_MAX = 2.5

/** Share of query words that must appear for a loose lyric match. */
const WORD_MATCH_THRESHOLD = 0.75

interface Scored {
  result: ProviderResult
  score: number
}

// Query decomposition (title vs artist, compound-title variants) lives in
// `@shared/lyrics-query` so it can be tested without the network.
export { queryVariants }

export async function searchAllProviders(
  query: string,
  options: { braveApiKey?: string } = {}
): Promise<LyricsOnlineResult[]> {
  const q = query.trim()
  if (q.length < MIN_QUERY_LENGTH) return []

  const parsed = parseSongQuery(q)
  const variants = queryVariants(q)
  const settled = await Promise.allSettled([
    ...variants.flatMap((variant) => [
      lyricsScraperService.search(variant),
      lrclibService.search(variant),
    ]),
    // A typed "<title> by <artist>" is invisible to LRCLIB's free-text search;
    // the structured endpoint answers it. Both orders of a dashed query are
    // tried because only the real one returns anything.
    ...parsed.pairs.map((pair) => lrclibService.searchStructured(pair.title, pair.artist)),
  ])

  const gathered: ProviderResult[] = []
  const failures: string[] = []
  const seenIds = new Set<string>()

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      for (const result of outcome.value) {
        if (seenIds.has(result.id)) continue
        seenIds.add(result.id)
        gathered.push(result)
      }
    } else {
      failures.push(outcome.reason?.message ?? 'Unknown error')
    }
  }

  // Only a total washout of every catalogue call is worth surfacing as an error.
  // Partial failures (one variant 404s) are normal.
  if (failures.length === settled.length) {
    throw new Error(failures[0])
  }
  if (failures.length > 0) {
    log.warn('[LyricsOnline] provider failed', { query: q, failures: failures.slice(0, 3) })
  }

  if (needsWebResolution(q, gathered)) {
    gathered.push(...(await snippetResolver.resolve(q, options.braveApiKey)))
  }

  return rankResults(q, gathered)
}

/**
 * Whether the catalogues failed to place this query with any confidence.
 *
 * Fires for empty results, title searches the catalogues answered with
 * unrelated noise, and remembered lyric lines they simply do not carry.
 */
export function needsWebResolution(query: string, gathered: ProviderResult[]): boolean {
  if (query.trim().length < MIN_WEB_QUERY_CHARS) return false
  if (gathered.length === 0) return true

  const canonicalQuery = canonicalText(query)
  const queryWords = canonicalQuery.split(' ').filter(Boolean)
  const collapsedQuery = canonicalQuery.replace(/\s+/g, '')

  // A confirmed lyric phrase means a catalogue already solved it — unless the
  // hit is a stub transcription (common for hymns on LRCLIB).
  const phraseHits = gathered.filter(
    (result) =>
      result.lyrics && findLyricMatch(result.lyrics, canonicalQuery, queryWords).kind === 'phrase'
  )
  if (phraseHits.length > 0) {
    const longest = Math.max(0, ...phraseHits.map((result) => result.lyrics?.length ?? 0))
    return longest < 700
  }

  // A strong title hit (including "ami oluwa" ↔ "amioluwa") usually means we're
  // done — unless the catalogue lyrics look truncated (common for hymns on LRCLIB).
  const hasStrongTitle = gathered.some((result) => {
    const title = canonicalText(result.title)
    const collapsedTitle = title.replace(/\s+/g, '')
    if (title === canonicalQuery || collapsedTitle === collapsedQuery) return true
    if (title.includes(canonicalQuery) || collapsedTitle.includes(collapsedQuery)) return true
    if (queryWords.length === 0) return false
    const covered = queryWords.filter((word) => title.includes(word) || collapsedTitle.includes(word))
    return covered.length / queryWords.length >= 0.8
  })

  if (!hasStrongTitle) return true

  const longestLyrics = Math.max(0, ...gathered.map((result) => result.lyrics?.length ?? 0))
  // Incomplete catalogue transcriptions should not block a fuller web hymn page.
  return longestLyrics > 0 && longestLyrics < 700
}

/** Exported for tests — pure ranking over already-fetched provider results. */
export function rankResults(query: string, results: ProviderResult[]): LyricsOnlineResult[] {
  const canonicalQuery = canonicalText(query)
  const queryWords = canonicalQuery.split(' ').filter(Boolean)
  // A dashed query yields both orders, so either side may be the artist —
  // both were typed by the operator either way.
  const parsed = parseSongQuery(query)
  const namedArtists = parsed.pairs
    .map((pair) => canonicalText(pair.artist))
    .filter((artist) => artist.length >= 3)
  // When the query names a title and an artist, each field is scored against
  // its own half. Measuring the title against the whole string ("way maker by
  // sinach") caps a perfect title at half credit and lets a mis-tagged record
  // that happens to carry the artist's name in its title make up the gap.
  const titleWords = parsed.pairs.length > 0
    ? canonicalText(parsed.pairs[0].title).split(' ').filter(Boolean)
    : queryWords
  const artistWords = parsed.pairs.length > 0
    ? canonicalText(parsed.pairs[0].artist).split(' ').filter(Boolean)
    : queryWords

  // Provider relevance is positional, so rank is per provider, not global.
  const rankByProvider = new Map<LyricsProvider, number>()

  const scored: Scored[] = results.map((result) => {
    const rank = rankByProvider.get(result.provider) ?? 0
    rankByProvider.set(result.provider, rank + 1)
    return scoreResult(result, canonicalQuery, queryWords, rank, {
      namedArtists,
      titleWords,
      artistWords,
    })
  })

  scored.sort((a, b) => b.score - a.score)

  return dropWeakResults(dedupe(scored))
    .slice(0, MAX_RESULTS)
    .map(({ result }) => {
      // Keep search-inline lyrics available for preview/import without /api/get.
      if (result.provider === 'lrclib' && result.lyrics) {
        lrclibService.rememberPlainLyrics(result.url, result.lyrics)
      }
      return toIpcResult(result)
    })
}

/**
 * Once a clearly relevant hit exists, drop catalogue noise that only matched
 * a stray word. Otherwise "ami oluwa" surfaces Amioluwa plus a page of Genius
 * songs that happen to share a syllable.
 */
function dropWeakResults(scored: Scored[]): Scored[] {
  if (scored.length === 0) return scored
  const best = scored[0].score
  if (best < SCORE_TITLE_CONTAINS + 1) return scored
  const floor = Math.max(best * 0.4, SCORE_TITLE_CONTAINS + 0.5)
  return scored.filter((entry) => entry.score >= floor)
}

function scoreResult(
  result: ProviderResult,
  canonicalQuery: string,
  queryWords: string[],
  rank: number,
  profile: { namedArtists: string[]; titleWords: string[]; artistWords: string[] } = {
    namedArtists: [],
    titleWords: queryWords,
    artistWords: queryWords,
  }
): Scored {
  let score = SCORE_RANK_WEIGHT / (1 + rank)
  const enriched: ProviderResult = { ...result }

  const title = canonicalText(result.title)
  const collapsedQuery = canonicalQuery.replace(/\s+/g, '')
  const collapsedTitle = title.replace(/\s+/g, '')
  if (title === canonicalQuery || collapsedTitle === collapsedQuery) score += SCORE_TITLE_EXACT
  else if (title.startsWith(canonicalQuery) || collapsedTitle.startsWith(collapsedQuery)) score += SCORE_TITLE_PREFIX
  else if (title.includes(canonicalQuery) || collapsedTitle.includes(collapsedQuery)) score += SCORE_TITLE_CONTAINS

  // Coverage runs on the song and its lead artist rather than the raw strings,
  // so a "(feat. …)" credit can't make an unrelated song look like a match.
  score += SCORE_TITLE_COVERAGE * wordCoverage(coreTitle(result.title), profile.titleWords)
  score += SCORE_ARTIST_COVERAGE * wordCoverage(primaryArtistKey(result.artist), profile.artistWords)

  if (result.lyrics) {
    const match = findLyricMatch(result.lyrics, canonicalQuery, queryWords)
    if (match.kind === 'phrase') {
      score += SCORE_LYRIC_PHRASE
      enriched.snippet = match.line
    } else if (match.kind === 'words') {
      score += SCORE_LYRIC_WORDS
      enriched.snippet = match.line
    }
  }

  if (profile.namedArtists.length > 0 && matchesNamedArtist(result.artist, profile.namedArtists)) {
    score += SCORE_ARTIST_NAMED
  }

  if (result.popularity) {
    score += Math.min(SCORE_POPULARITY_MAX, Math.log10(result.popularity + 1) / 5)
  }

  if (result.lyrics && result.lyrics.length > 120) {
    // log10(700)≈2.8 → soft bonus; caps so length never beats a real title miss.
    score += Math.min(SCORE_COMPLETENESS_MAX, Math.log10(result.lyrics.length) - 2)
  }

  return { result: enriched, score }
}

/**
 * Whether a result is by an artist the query named.
 *
 * Credits are written every which way — "Sinach", "SINACH", "Sinach & Loveworld
 * Singers" — so containment in either direction counts as the same artist.
 */
function matchesNamedArtist(artist: string, namedArtists: string[]): boolean {
  const canonical = canonicalText(artist)
  if (canonical.length < 3) return false
  return namedArtists.some((named) => canonical.includes(named) || named.includes(canonical))
}

/** Share of the query's words this field accounts for. */
function wordCoverage(field: string, queryWords: string[]): number {
  if (!field || queryWords.length === 0) return 0
  const matched = queryWords.filter((word) => field.includes(word)).length
  return matched / queryWords.length
}

type LyricMatch =
  | { kind: 'phrase' | 'words'; line: string }
  | { kind: 'none'; line?: undefined }

/**
 * Looks for the query inside a lyric body and returns the line that carried it.
 *
 * Comparison runs on canonicalised text because transcriptions disagree wildly
 * on punctuation and diacritics — "Ese! Ese! Ese o" has to match a typed
 * "ese ese ese o".
 */
export function findLyricMatch(
  lyrics: string,
  canonicalQuery: string,
  queryWords: string[]
): LyricMatch {
  if (!canonicalQuery) return { kind: 'none' }

  const lines = lyrics.split('\n').map((line) => line.trim()).filter(Boolean)

  for (const line of lines) {
    if (canonicalText(line).includes(canonicalQuery)) return { kind: 'phrase', line }
  }

  // The phrase may straddle a line break, which is common when someone types a
  // couplet they remember as one breath.
  if (canonicalText(lyrics).includes(canonicalQuery)) {
    const anchor = queryWords[0]
    const line = lines.find((candidate) => canonicalText(candidate).includes(anchor))
    return { kind: 'phrase', line: line ?? lines[0] }
  }

  // "ami oluwa" typed against lyrics that print "Amioluwa" as one token.
  const collapsedQuery = canonicalQuery.replace(/\s+/g, '')
  if (collapsedQuery.length >= 4) {
    for (const line of lines) {
      if (canonicalText(line).replace(/\s+/g, '').includes(collapsedQuery)) {
        return { kind: 'phrase', line }
      }
    }
  }

  if (queryWords.length === 0) return { kind: 'none' }

  const canonicalLyrics = canonicalText(lyrics)
  const present = queryWords.filter((word) => canonicalLyrics.includes(word))
  if (present.length / queryWords.length >= WORD_MATCH_THRESHOLD) {
    const line = lines.find((candidate) => {
      const canonical = canonicalText(candidate)
      return present.filter((word) => canonical.includes(word)).length >= Math.min(2, present.length)
    })
    if (line) return { kind: 'words', line }
  }

  return { kind: 'none' }
}

/** Qualifiers that mark a re-release rather than a different song. */
const TITLE_QUALIFIERS =
  /\b(live|acoustic|remix|remaster(ed)?|radio edit|extended|version|reprise|instrumental|demo|session|mix)\b/gi

/**
 * Reduces a title to the song underneath it.
 *
 * One recording reaches the list as "Ese (Thank You)", "Ese - Live" and
 * "ESE (feat. AIDEE IME)". An operator looking for the song wants one row, not
 * a menu of tagging variants.
 */
export function coreTitle(title: string): string {
  const stripped = title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/i, ' ')
    .replace(TITLE_QUALIFIERS, ' ')
    .replace(/[-–—]\s*$/, ' ')
  return canonicalText(stripped) || canonicalText(title)
}

function primaryArtistKey(artist: string): string {
  return canonicalText(artist.split(/[;,/]|\bfeat\.?\b|\bft\.?\b|\(/i)[0])
}

/** Containment above this means the shorter lyric body is the same song. */
const LYRIC_IDENTITY_THRESHOLD = 0.75

/**
 * Collapses the same song appearing more than once.
 *
 * Two passes, because duplicates arrive in two different shapes. Tagging
 * variants of one recording share a title and artist once the qualifiers come
 * off. Separate recordings of the same worship song — the case where eight
 * artists have each covered it — only reveal themselves through the lyrics.
 *
 * Genius wins ties: its pages carry real section headers, which import as
 * proper Verse/Chorus slide groups, where LRCLIB's plain text can only be
 * chunked into evenly sized stanzas.
 */
function dedupe(scored: Scored[]): Scored[] {
  const byKey = new Map<string, Scored>()

  for (const entry of scored) {
    const key = `${coreTitle(entry.result.title)}|${primaryArtistKey(entry.result.artist)}`
    const existing = byKey.get(key)
    if (!existing) byKey.set(key, entry)
    else byKey.set(key, merge(existing, entry))
  }

  const kept: (Scored & { fingerprint?: Set<string> })[] = []

  for (const entry of byKey.values()) {
    const fingerprint = entry.result.lyrics ? lineSet(entry.result.lyrics) : undefined

    const twin = fingerprint
      ? kept.find(
          (candidate) =>
            candidate.fingerprint && containment(candidate.fingerprint, fingerprint) >= LYRIC_IDENTITY_THRESHOLD
        )
      : undefined

    if (!twin) {
      kept.push({ ...entry, fingerprint })
      continue
    }

    const winner = merge(twin, entry)
    twin.result = winner.result
    twin.score = winner.score
  }

  return kept.sort((a, b) => b.score - a.score)
}

/** Keeps the better of two rows for the same song, pooling their metadata. */
const PROVIDER_RANK: Record<string, number> = { genius: 3, lrclib: 2, web: 1 }

function merge(a: Scored, b: Scored): Scored {
  const aWins =
    a.result.provider === b.result.provider
      ? a.score >= b.score
      : (PROVIDER_RANK[a.result.provider] ?? 0) > (PROVIDER_RANK[b.result.provider] ?? 0)

  const winner = aWins ? a : b
  const loser = aWins ? b : a

  winner.result.snippet ??= loser.result.snippet
  winner.result.album ??= loser.result.album
  winner.result.releaseYear ??= loser.result.releaseYear
  winner.result.lyrics ??= loser.result.lyrics
  // A song surfacing from both catalogues is a stronger hit than either alone.
  winner.score = Math.max(a.score, b.score)

  return winner
}

function lineSet(lyrics: string): Set<string> {
  const set = new Set<string>()
  for (const line of lyrics.split('\n')) {
    const canonical = canonicalText(line)
    if (canonical) set.add(canonical)
  }
  return set
}

/**
 * How completely the shorter lyric body sits inside the longer one.
 *
 * Containment rather than symmetric overlap, because covers of the same song
 * differ mostly in how much got transcribed — one entry stops after two verses
 * where another runs to the final tag. Measuring against the shorter text
 * recognises those as one song; measuring against the longer would not.
 */
function containment(a: Set<string>, b: Set<string>): number {
  const [large, small] = a.size >= b.size ? [a, b] : [b, a]
  if (small.size === 0) return 0
  let shared = 0
  for (const line of small) if (large.has(line)) shared++
  return shared / small.size
}

/** Drops the ranking-only fields so they never cross the IPC boundary. */
function toIpcResult(result: ProviderResult): LyricsOnlineResult {
  const { lyrics: _lyrics, popularity: _popularity, ...rest } = result
  return rest
}

/**
 * Splits what an operator types into the parts a catalogue can actually match.
 *
 * People type a song the way they'd say it — "blessed be the name of the lord
 * by dunsin oyekan" — but LRCLIB's free-text `q=` matches that against a
 * single metadata field and returns nothing, and Genius scores it as a lyric
 * phrase and returns unrelated pages. Both answer immediately when the title
 * and artist are handed over separately, so every query is decomposed here
 * before it reaches a provider.
 *
 * Nothing about any particular song lives in this module: it only knows the
 * shapes people write ("A by B", "A - B", "A: B") and hands back candidates
 * for the callers to try.
 */

export interface SongQueryParts {
  /** The whole query, trimmed — always searched as typed as well. */
  full: string
  /** Title/artist candidates, most likely first. Empty when nothing split. */
  pairs: { title: string; artist: string }[]
  /**
   * Bare title guesses, for catalogues that match titles only. Ordered most
   * likely first and free of any artist words.
   */
  titles: string[]
}

/** ` by `, and the dash / colon separators people paste from playlists. */
const BY_SPLIT = /\s+by\s+/i
const DASH_SPLIT = /\s+[-–—]\s+|\s*\|\s*|\s*:\s+/

/** Words that are never a title or an artist on their own. */
const NOISE_WORDS = new Set(['lyrics', 'lyric', 'song', 'official', 'video', 'audio'])

function clean(value: string): string {
  const trimmed = value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'([]+|[\s"')\]]+$/g, '')
    .trim()
  const words = trimmed.split(' ').filter((w) => !NOISE_WORDS.has(w.toLowerCase()))
  return (words.length > 0 ? words.join(' ') : trimmed).trim()
}

function usable(value: string): boolean {
  return clean(value).length >= 2
}

/**
 * Decomposes a typed query into title/artist candidates.
 *
 * ` by ` is unambiguous, so it yields one pair. A dash or colon is not —
 * playlists write "Artist - Title" and lyric sites write "Title - Artist" —
 * so both orders come back and the provider decides which one exists.
 */
export function parseSongQuery(raw: string): SongQueryParts {
  const full = raw.replace(/\s+/g, ' ').trim()
  const parts: SongQueryParts = { full, pairs: [], titles: [] }
  if (!full) return parts

  const byMatch = full.split(BY_SPLIT)
  if (byMatch.length === 2 && usable(byMatch[0]) && usable(byMatch[1])) {
    const title = clean(byMatch[0])
    const artist = clean(byMatch[1])
    parts.pairs.push({ title, artist })
    parts.titles.push(title)
    return parts
  }

  const dashParts = full.split(DASH_SPLIT).filter((p) => p.trim())
  if (dashParts.length === 2 && usable(dashParts[0]) && usable(dashParts[1])) {
    const left = clean(dashParts[0])
    const right = clean(dashParts[1])
    parts.pairs.push({ title: right, artist: left }, { title: left, artist: right })
    parts.titles.push(right, left)
    return parts
  }

  // Nothing to split on: the whole string is the best title guess, and a
  // cleaned copy is added when stripping noise words actually changed it.
  const cleaned = clean(full)
  if (cleaned && cleaned !== full) parts.titles.push(cleaned)
  return parts
}

/**
 * Catalogue queries to run for one typed query, in the order they should be
 * tried: what was typed, then each title guess.
 *
 * Also collapses a short multi-word query into one token, because compound
 * African titles are often catalogued that way ("ami oluwa" ↔ "Amioluwa").
 */
export function queryVariants(query: string): string[] {
  const parsed = parseSongQuery(query)
  if (!parsed.full) return []

  const variants = [parsed.full, ...parsed.titles]

  const words = parsed.full.split(' ').filter(Boolean)
  if (words.length >= 2 && words.length <= 3 && words.every((word) => word.length <= 10)) {
    const collapsed = words.join('')
    if (collapsed.length >= 4) variants.push(collapsed)
  }

  const seen = new Set<string>()
  return variants.filter((variant) => {
    const key = variant.toLowerCase()
    if (!variant || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Recognising a song the library already holds.
 *
 * A folder of song sheets collected over years carries the same song several
 * times — re-typed, re-titled, or saved again under a new file name. Importing
 * blind produces a library where half the entries are pairs, and the operator
 * only finds out mid-service when two identical songs sit next to each other
 * in search.
 *
 * Nothing here decides anything: it reports what matched and why, and the
 * import screen shows that to the operator.
 */

import type { LyricsSong } from './ipc'

/** `same-song`: the same song record, by id — a re-import of an export. */
export type DuplicateReason = 'same-song' | 'ccli' | 'title-artist' | 'lyrics'

export interface DuplicateMatch {
  /** The song already in the library (or earlier in the same batch). */
  songId: string
  title: string
  artist: string
  reason: DuplicateReason
}

/**
 * Share of the shorter song's lines that must appear in the other for the two
 * to be the same song. Below 1.0 because transcriptions drift: a repeated
 * chorus written out twice, an extra ad-lib line, a spelling difference.
 */
const LYRIC_MATCH_THRESHOLD = 0.75

/** Songs shorter than this are matched on title and artist only — a two-line
 *  chorus shares most of its lines with every other short chorus. */
const MIN_LINES_FOR_LYRIC_MATCH = 4

/**
 * Titles that are placeholders rather than names. A file with no heading and a
 * generic name parses to one of these, and two unrelated songs both called
 * "Untitled" must not look like the same song.
 */
const PLACEHOLDER_TITLE = /^(untitled|unknown|song|lyrics|new song|document|untitled \d+|untitled copy)$/

/** Lowercase, unaccented, punctuation-free — the form two transcriptions share. */
export function canonical(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Title + lead artist, insensitive to the things that differ between two
 * copies of one song: case, punctuation, a "(Live)" suffix, a featured credit.
 */
export function songKey(title: string, artist: string): string {
  const bareTitle = canonical(
    title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b(feat|ft)\.?\s.*$/i, ' ')
      .replace(/\b(live|acoustic|remix|reprise|official|version|cover)\b/gi, ' '),
  )
  const leadArtist = canonical(artist.split(/[;,/]|\bfeat\.?\b|\bft\.?\b|\(/i)[0] ?? '')
  return `${bareTitle || canonical(title)}|${leadArtist}`
}

/** The song's distinct lyric lines, as a comparable set. */
export function lyricFingerprint(song: LyricsSong): Set<string> {
  const lines = new Set<string>()
  for (const section of song.sections) {
    for (const line of section.lines) {
      const value = canonical(line)
      if (value) lines.add(value)
    }
  }
  return lines
}

/** Share of the smaller set that also appears in the larger one. */
export function containment(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  if (small.size === 0) return 0
  let shared = 0
  for (const line of small) if (large.has(line)) shared++
  return shared / small.size
}

/**
 * Finds the song in `library` that `candidate` is a copy of, or null.
 *
 * Three signals, strongest first. A shared CCLI number is a publisher's own
 * identifier and settles it. A matching title and artist is the everyday case.
 * Lyrics catch the rest: the same song saved under a different name, or with
 * the artist left blank in one copy — which is most of a hand-made folder.
 */
export function findDuplicate(
  candidate: LyricsSong,
  library: LyricsSong[],
): DuplicateMatch | null {
  const describe = (song: LyricsSong, reason: DuplicateReason): DuplicateMatch => ({
    songId: song.id,
    title: song.title,
    artist: song.artist ?? '',
    reason,
  })

  const ccli = candidate.ccliNumber?.trim()
  if (ccli) {
    const match = library.find((song) => song.ccliNumber?.trim() === ccli)
    if (match) return describe(match, 'ccli')
  }

  const bareTitle = canonical(candidate.title)
  if (bareTitle && !PLACEHOLDER_TITLE.test(bareTitle)) {
    const key = songKey(candidate.title, candidate.artist ?? '')
    const keyed = library.find((song) => songKey(song.title, song.artist ?? '') === key)
    if (keyed) return describe(keyed, 'title-artist')
  }

  const fingerprint = lyricFingerprint(candidate)
  if (fingerprint.size < MIN_LINES_FOR_LYRIC_MATCH) return null

  for (const song of library) {
    const other = lyricFingerprint(song)
    if (other.size < MIN_LINES_FOR_LYRIC_MATCH) continue
    if (containment(fingerprint, other) >= LYRIC_MATCH_THRESHOLD) {
      return describe(song, 'lyrics')
    }
  }

  return null
}

/** One line explaining a match, for the badge in the import list. */
export function describeDuplicate(match: DuplicateMatch): string {
  const who = match.artist ? ` by ${match.artist}` : ''
  switch (match.reason) {
    case 'same-song':
      return `Already in your library as "${match.title}"${who}`
    case 'ccli':
      return `Same CCLI number as "${match.title}"${who}`
    case 'title-artist':
      return `Same title and artist as "${match.title}"${who}`
    case 'lyrics':
      return `Same lyrics as "${match.title}"${who}`
  }
}

/**
 * Parser for song text copied off a lyrics site into the clipboard.
 *
 * Operators grab songs from Genius, AZLyrics, Hymnary, Musixmatch and the
 * like by selecting the page and hitting copy. What lands on the clipboard is
 * the lyrics plus whatever chrome sat inside the selection: a
 * "37 Contributors" line, a "Song Title Lyrics" heading, "You might also
 * like", the trailing "12345Embed" view counter. This module strips that
 * chrome, lifts the title/artist out of the heading when the site put one
 * there, and hands back a clean body for `lyrics.import` (`type: 'text'`).
 */

export interface ClipboardSongDraft {
  title: string
  artist: string
  copyright: string
  text: string
  /** Count of lyric lines kept — the UI reports it so a bad paste is obvious. */
  lineCount: number
}

/** Lines that are page chrome wherever they appear in the selection. */
const NOISE_LINE = [
  /^\d+\s+contributors?\b/i,
  /^(\d+|one|two|few|several)?\s*translations?$/i,
  /^you might also like$/i,
  /^see .+ live$/i,
  /^get tickets as low as \$\d+/i,
  /^read more\s*$/i,
  /^(share|embed|print|copy|edit lyrics|add a comment)$/i,
  /^how to format lyrics/i,
  /^lyrics licensed (and provided )?by\b/i,
  /^(writer|writer\/composer|composer|producer)s?\s*:/i,
  /^\d+\s*(views?|likes?)$/i,
  /^advertisement$/i,
  /^submit corrections$/i,
  /^we're doing our best to make sure/i,
  /^sign up (and|to)\b/i,
  /^more on genius$/i,
  /^\[?instrumental\]?$/i,
]

/** Site headings that carry the song's own metadata. */
const TITLE_HEADING = /^(.+?)\s+lyrics$/i
/** AZLyrics-style "Artist - Title lyrics" / Genius "Artist – Title". */
const ARTIST_TITLE = /^(.+?)\s+[–—-]\s+(.+?)$/

const COPYRIGHT_LINE = /^(©|\(c\)|copyright\b|ccli\b)/i

const ZERO_WIDTH = /[\u200b-\u200f\u2028\u2029\ufeff]/g

function isNoise(line: string): boolean {
  return NOISE_LINE.some((re) => re.test(line))
}

/**
 * True when the text looks like a song rather than an arbitrary clipboard
 * payload — used to decide whether an auto-paste should fill the form.
 */
export function looksLikeLyrics(raw: string): boolean {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 4) return false
  // A URL or a single long paragraph is almost never a pasted song.
  if (lines.length === 1) return false
  if (/^https?:\/\/\S+$/i.test(lines[0]) && lines.length < 6) return false
  return true
}

/**
 * Cleans clipboard text into an importable draft.
 *
 * Returns null when the payload has no usable lyric body; callers show their
 * own "nothing song-like on the clipboard" message rather than importing junk.
 */
export function parseClipboardSong(raw: string): ClipboardSongDraft | null {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(ZERO_WIDTH, '')
  if (!normalized.trim()) return null

  let title = ''
  let artist = ''
  let copyright = ''

  const kept: string[] = []

  const lines = normalized.split('\n')
  // Leading chrome sits above the first lyric line; metadata is only trusted
  // from that header region so a lyric line like "Translations" mid-song
  // cannot be mistaken for a heading.
  let inHeader = true

  for (const rawLine of lines) {
    // Genius glues its view counter to the last lyric line: "…Embed".
    const line = rawLine.replace(/\d*Embed\s*$/, '').trim()

    if (!line) {
      if (kept.length) kept.push('')
      continue
    }

    if (isNoise(line)) continue

    if (COPYRIGHT_LINE.test(line)) {
      if (!copyright) copyright = line.replace(/^copyright\b[:\s]*/i, '').trim()
      continue
    }

    if (inHeader) {
      const heading = line.match(TITLE_HEADING)
      if (heading) {
        const head = heading[1].trim()
        const split = head.match(ARTIST_TITLE)
        if (split) {
          artist = artist || split[1].trim()
          title = title || split[2].trim()
        } else if (!title) {
          title = head
        }
        continue
      }
      // "Artist: Name" / "by Some Artist" under the heading.
      const byline = line.match(/^(?:by|artist|performed by)\s*[:-]?\s*(.+)$/i)
      if (byline && title && !artist) {
        artist = byline[1].trim()
        continue
      }
      if (/^\[/.test(line) || kept.length) inHeader = false
    }

    if (line) inHeader = false
    kept.push(line)
  }

  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const lineCount = text.split('\n').filter((l) => l.trim() && !/^\[.+\]$/.test(l.trim())).length
  if (lineCount === 0) return null

  return { title, artist, copyright, text, lineCount }
}

/** A line that could be a song name or a credit, not a lyric. */
function looksLikeHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^\[.*\]$/.test(trimmed)) return false
  return trimmed.length <= 60 && trimmed.split(/\s+/).length <= 10
}

/**
 * Reads the title (and artist, when it is there) off the top of a document.
 *
 * Song sheets people type themselves — an RTF from TextEdit, a plain .txt —
 * carry no metadata at all: the song name sits on the first line, sometimes
 * with the artist under it, and a blank line before the lyrics start. Without
 * this the title falls back to the file name and those lines import as the
 * first verse.
 *
 * Returns empty fields and the text untouched whenever the opening does not
 * clearly look like a heading — a long first line, a section marker, or lyrics
 * that start immediately.
 */
export function liftHeadingTitle(text: string): { title: string; artist: string; text: string } {
  const unchanged = { title: '', artist: '', text }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first === -1) return unchanged
  if (!looksLikeHeadingLine(lines[first])) return unchanged

  const second = lines[first + 1]
  const third = lines[first + 2]

  // "Way Maker" / blank / lyrics…
  if (second !== undefined && !second.trim()) {
    const rest = lines.slice(first + 2).join('\n').trim()
    return rest ? { title: lines[first].trim(), artist: '', text: rest } : unchanged
  }

  // "Way Maker" / "Sinach" / blank / lyrics…
  if (
    second !== undefined &&
    looksLikeHeadingLine(second) &&
    third !== undefined &&
    !third.trim()
  ) {
    const rest = lines.slice(first + 3).join('\n').trim()
    if (rest) {
      return { title: lines[first].trim(), artist: second.trim(), text: rest }
    }
  }

  return unchanged
}

/** Metadata keys a song file's header block can carry. */
const SONG_META_KEY = /^\s*(title|song ?title|author|artist|writer|songwriter|copyright|ccli ?#?|ccli ?number|ccli ?song ?number)\s*[=:]/i

/**
 * Whether a file opens with a metadata block (`Title=…`, `Artist: …`).
 *
 * SongSelect exports do; a lyrics file someone typed does not, and routing the
 * second kind through the metadata parser is what produced a library of
 * "Untitled" — it has no file name to fall back to and no header to read.
 * Only the first few lines are considered, so a `Copyright:` line at the foot
 * of a song sheet does not make the whole file look like an export.
 */
export function hasSongMetadata(text: string): boolean {
  const head = text.replace(/\r\n?/g, '\n').split('\n').slice(0, 8)
  return head.some((line) => SONG_META_KEY.test(line))
}

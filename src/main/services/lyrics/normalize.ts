/**
 * Shared lyric text normalization.
 *
 * Every online provider hands back lyrics in its own shape — Genius uses
 * bracketed section headers, LRCLIB usually has none at all — but the
 * downstream parser wants one format. Both funnel through `structureLyrics`.
 */

// ─── Section vocabulary ───────────────────────────────────────────────────────

/**
 * Providers use a broader section vocabulary than ProPresenter. Anything not
 * mapped here would otherwise reach the slide formatter as a literal lyric
 * line, so every header is forced into one of the eight supported types.
 */
const SECTION_ALIASES: Record<string, string> = {
  // English
  verse: 'Verse',
  v: 'Verse',
  chorus: 'Chorus',
  c: 'Chorus',
  refrain: 'Chorus',
  hook: 'Chorus',
  'pre-chorus': 'Pre-Chorus',
  prechorus: 'Pre-Chorus',
  'pre chorus': 'Pre-Chorus',
  'post-chorus': 'Tag',
  postchorus: 'Tag',
  bridge: 'Bridge',
  b: 'Bridge',
  intro: 'Intro',
  introduction: 'Intro',
  outro: 'Outro',
  ending: 'Ending',
  end: 'Ending',
  tag: 'Tag',
  vamp: 'Tag',
  turnaround: 'Tag',
  'ad-lib': 'Tag',
  adlib: 'Tag',
  adlibs: 'Tag',

  // Spanish — keys are accent-folded, so "Introducción" matches "introduccion"
  verso: 'Verse',
  estrofa: 'Verse',
  coro: 'Chorus',
  estribillo: 'Chorus',
  'pre-coro': 'Pre-Chorus',
  precoro: 'Pre-Chorus',
  puente: 'Bridge',
  introduccion: 'Intro',
  final: 'Ending',
  cierre: 'Ending',

  // Portuguese
  refrao: 'Chorus',
  'pre-refrao': 'Pre-Chorus',
  prerefrao: 'Pre-Chorus',
  ponte: 'Bridge',
  introducao: 'Intro',
  encerramento: 'Ending',

  // French
  couplet: 'Verse',
  'pre-refrain': 'Pre-Chorus',
  prerefrain: 'Pre-Chorus',
  pont: 'Bridge',
  fin: 'Ending',

  // Yoruba / Igbo / Pidgin — common in Nigerian gospel transcriptions
  egbe: 'Chorus',
  ijeide: 'Verse',
}

/**
 * Sections that carry no projectable text. Providers often park stray ad-libs
 * under these, which would otherwise import as junk verses.
 */
const DROPPED_SECTIONS = new Set([
  'instrumental',
  'instrumentals',
  'interlude',
  'interludio',
  'interlude musical',
  'solo',
  'break',
  'breakdown',
  'musical',
  'intermedio',
])

/** Marker for a section whose content should be discarded entirely. */
export const DROP_MARKER = '[__drop__]'

/** Fallback for headers with no ProPresenter equivalent (Spoken, Skit, …). */
const UNKNOWN_SECTION = 'Verse'

/**
 * Overlap at or above this share of lines means two same-named sections are
 * the same part of the song, transcribed with different ad-libs.
 */
const SECTION_MERGE_THRESHOLD = 0.6

/** Stanza size used when a page has neither section headers nor stanza breaks. */
const STANZA_FALLBACK_LINES = 4

/**
 * Non-lyric stage directions that LRCLIB / live transcriptions insert as lines.
 * Dropping them keeps section detection from treating cues as verses.
 */
export function isPerformanceCueLine(line: string): boolean {
  const lower = line.trim().toLowerCase()
  if (!lower) return false
  return (
    /^(instruments?\s+playing|instrumental(\s+break)?|end\.?|fade\s*out)$/i.test(lower) ||
    /^speaking in tongues?\.?$/i.test(lower)
  )
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

/** "Refrão" → "refrao", so accented labels hit the same alias keys. */
export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Reduces a line to a comparable fingerprint: lowercase, unaccented, and
 * stripped of punctuation.
 *
 * Lyric transcriptions differ constantly in punctuation and diacritics — the
 * same refrain shows up as "Ese! Ese! Ese o", "Ese, ese, ese o" and
 * "Èsé èsé èsé o". Comparing raw text would call those three different lines.
 */
export function canonicalText(value: string): string {
  return foldAccents(value.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Rewrites one bracketed section header into a label the lyrics parser accepts.
 *
 * Handles the attribution suffix Genius adds to collaborative songs
 * ("[Chorus: Some Artist]" → "[Chorus]") and preserves any ordinal
 * ("[Verse 2: A & B]" → "[Verse 2]").
 *
 * Returns null when the line is not a bracketed header.
 */
export function normalizeSectionHeader(line: string): string | null {
  const match = line.match(/^\[([^\]]{1,60})\]$/)
  if (!match) return null

  const head = match[1].split(':')[0].trim()
  const ordinal = head.match(/^(.*?)\s*(\d+)\s*$/)
  const base = foldAccents((ordinal ? ordinal[1] : head).trim().toLowerCase()).replace(/\s+/g, ' ')

  if (DROPPED_SECTIONS.has(base)) return DROP_MARKER

  const canonical = SECTION_ALIASES[base] ?? UNKNOWN_SECTION
  return ordinal ? `[${canonical} ${ordinal[2]}]` : `[${canonical}]`
}

/**
 * Turns provider lyric text into the section-marked format
 * `LyricsService.parseText` expects.
 *
 * Providers separate stanzas with a single newline, but the parser's fallback
 * block splitter needs two. When the text carries no headers at all, stanza
 * breaks are doubled so sections still come out separated.
 */
export function structureLyrics(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    // Headers occasionally run flush against the previous line.
    .replace(/\[/g, '\n[')
    .replace(/\]/g, ']\n')

  const out: string[] = []
  let sawHeader = false

  for (const rawLine of text.split('\n')) {
    // The view counter Genius appends to the final line, e.g. "12345Embed".
    const line = rawLine.replace(/\d*Embed\s*$/, '').trim()
    if (!line) {
      out.push('')
      continue
    }
    if (isPerformanceCueLine(line)) continue
    const header = normalizeSectionHeader(line)
    if (header) {
      sawHeader = true
      out.push('', header)
      continue
    }
    out.push(line)
  }

  const collapsed = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  if (sawHeader) return dedupeSections(collapsed)

  // Without headers the parser falls back to blank-line block detection, which
  // only breaks on a run of two or more blank lines.
  if (collapsed.includes('\n\n')) return collapsed.replace(/\n\n/g, '\n\n\n')

  // Some pages carry neither headers nor stanza breaks — just a flat run of
  // line breaks. Chunking leaves the operator with sections they can relabel
  // rather than one undifferentiated block, and the slide boundaries match
  // the default four-lines-per-slide anyway.
  const lyricLines = collapsed.split('\n').filter((line) => line.trim())
  if (lyricLines.length <= STANZA_FALLBACK_LINES) return collapsed

  const stanzas: string[] = []
  for (let i = 0; i < lyricLines.length; i += STANZA_FALLBACK_LINES) {
    stanzas.push(lyricLines.slice(i, i + STANZA_FALLBACK_LINES).join('\n'))
  }
  return stanzas.join('\n\n\n')
}

/**
 * Pulls projectable lyric lines out of structured or raw provider text.
 * Used as a last-resort verse when section detection finds nothing.
 */
export function extractLyricLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      // Skip section markers the parser understands (or Genius-style brackets).
      if (/^[[({].+[\])}]$/.test(trimmed) && trimmed.length <= 40) return false
      if (trimmed === DROP_MARKER) return false
      if (isPerformanceCueLine(trimmed)) return false
      return true
    })
}

/**
 * Collapses repeats of the same section into a single entry.
 *
 * Transcriptions follow the performance order, so a modern worship song writes
 * the chorus out once per repeat. ProPresenter wants one reusable group per
 * section, and the downstream parser numbers by occurrence — left alone, five
 * `[Chorus]` markers become five near-identical "Chorus N" slide groups.
 *
 * Sections are kept when their content differs, so a final chorus with an extra
 * line still survives as its own section. Empty sections (Instrumental,
 * Interlude) are dropped.
 */
export function dedupeSections(text: string): string {
  const blocks: { header: string; lines: string[] }[] = []
  let current: { header: string; lines: string[] } | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (/^\[.+\]$/.test(line)) {
      if (current) blocks.push(current)
      current = { header: line, lines: [] }
    } else if (line) {
      if (!current) current = { header: '', lines: [] }
      current.lines.push(line)
    }
  }
  if (current) blocks.push(current)

  const kept: { header: string; lines: string[]; canonical: Set<string> }[] = []

  for (const block of blocks) {
    if (block.header === DROP_MARKER) continue
    if (block.lines.length === 0) continue

    const canonical = canonicalLineSet(block.lines)
    if (canonical.size === 0) continue

    const twin = kept.find(
      (entry) =>
        entry.header === block.header &&
        overlap(entry.canonical, canonical) >= SECTION_MERGE_THRESHOLD
    )

    if (!twin) {
      kept.push({ ...block, canonical })
      continue
    }

    // Keep whichever transcription is fuller, so a final chorus that adds a
    // line replaces the shorter earlier take rather than being discarded.
    if (block.lines.length > twin.lines.length) {
      twin.lines = block.lines
      twin.canonical = canonical
    }
  }

  return kept
    .map((block) => (block.header ? `${block.header}\n${block.lines.join('\n')}` : block.lines.join('\n')))
    .join('\n\n')
}

/** Share of the larger set's lines that also appear in the smaller one. */
function overlap(a: Set<string>, b: Set<string>): number {
  const [large, small] = a.size >= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const line of small) if (large.has(line)) shared++
  return large.size === 0 ? 0 : shared / large.size
}

/** Line fingerprints for similarity comparison — ignores case and punctuation. */
function canonicalLineSet(lines: string[]): Set<string> {
  const set = new Set<string>()
  for (const line of lines) {
    const canonical = canonicalText(line)
    if (canonical) set.add(canonical)
  }
  return set
}

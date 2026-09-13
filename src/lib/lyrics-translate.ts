/**
 * Bilingual lyric glosses: keep the original line, put English under it in ().
 *
 * Odudu dabu Jesus no
 * (There is no other Name like Jesus)
 */

export function isGlossLine(line: string): boolean {
  return /^\(.+\)$/.test(line.trim())
}

export function isSectionMarkerLine(line: string): boolean {
  return /^\[.+\]$/.test(line.trim())
}

/** Lines that should be sent to the translator. */
export function shouldTranslateLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (isGlossLine(trimmed)) return false
  if (isSectionMarkerLine(trimmed)) return false
  return true
}

/** Wraps translation text as `(gloss)`, stripping any outer parens from the API. */
export function formatGloss(text: string): string {
  let body = (text ?? '').trim()
  while (body.startsWith('(') && body.endsWith(')') && body.length >= 2) {
    body = body.slice(1, -1).trim()
  }
  return `(${body || '…'})`
}

/**
 * Inserts or replaces gloss lines under the given source-line indices.
 *
 * `glossBySourceIndex` keys are indices into the input `lines` array.
 * Re-running with new glosses replaces an existing `(…)` under that line
 * instead of stacking another pair.
 */
export function applyLineGlosses(
  lines: string[],
  glossBySourceIndex: Map<number, string> | Record<number, string>
): string[] {
  const glosses =
    glossBySourceIndex instanceof Map
      ? glossBySourceIndex
      : new Map(
          Object.entries(glossBySourceIndex).map(([k, v]) => [Number(k), v] as [number, string])
        )

  const skip = new Set<number>()
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue
    const line = lines[i]
    out.push(line)

    if (!glosses.has(i)) continue
    if (i + 1 < lines.length && isGlossLine(lines[i + 1])) {
      skip.add(i + 1)
    }
    out.push(formatGloss(glosses.get(i) ?? ''))
  }

  return out
}

/**
 * Removes bilingual gloss lines (`(English)`) that sit under lyric lines.
 * Leaves the original language intact.
 */
export function stripLineGlosses(lines: string[]): string[] {
  return lines.filter((line) => !isGlossLine(line))
}

export function sectionsHaveGlosses(sections: { lines: string[] }[]): boolean {
  return sections.some((section) => section.lines.some(isGlossLine))
}

/**
 * Collects 0-based indices of lines that need translation (skips blanks,
 * section markers, and existing glosses).
 */
export function collectTranslatableIndices(lines: string[]): number[] {
  const indices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (shouldTranslateLine(lines[i])) indices.push(i)
  }
  return indices
}

/** True when Google (or our heuristic) says the source is already English. */
export function isEnglishLanguageCode(code: string | undefined | null): boolean {
  if (!code) return false
  return code.trim().toLowerCase().startsWith('en')
}

const JUNK_GLOSS =
  /^(refrain|repeat|chorus|verse|bridge|share on|opens in|email|print|languages?|download|lyrics|mp3|feat|ft\.?|x\d+)\b/i

const COMMON_ENGLISH = new Set([
  'i', 'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'am',
  'be', 'my', 'me', 'you', 'he', 'she', 'we', 'they', 'it', 'not', 'no', 'yes', 'oh',
  'see', 'jesus', 'power', 'belongs', 'blood', 'speaks', 'god', 'with', 'alone',
  'christ', 'mark', 'cannot', 'defeated', 'identity', 'hosanna', 'hosannah', 'amen',
  'lord', 'holy', 'spirit', 'praise', 'glory', 'hallelujah', 'thank', 'you', 'your',
])

/** Site chrome / section labels that must never become lyric glosses. */
export function isJunkGloss(gloss: string): boolean {
  const t = gloss.trim()
  if (!t) return true
  if (JUNK_GLOSS.test(t)) return true
  if (/opens in new window/i.test(t)) return true
  return false
}

/**
 * Heuristic: line is already English worship text (skip machine + online junk).
 * Short Latin lines made only of common English tokens count as English.
 */
export function isLikelyEnglishLyric(line: string): boolean {
  const key = glossMatchKey(line)
  if (!key) return false
  // Non-Latin scripts → not English.
  // eslint-disable-next-line no-control-regex -- the C0 range is the intended floor of the Latin test.
  if (/[^\u0000-\u024f]/.test(line)) return false
  const words = key.split(' ').filter(Boolean)
  if (words.length === 0) return false
  const englishHits = words.filter((w) => COMMON_ENGLISH.has(w)).length
  return englishHits / words.length >= 0.75
}

/**
 * Skip glossing when the line was already English, the gloss is junk, or the
 * API returned the same text (no useful bilingual pair).
 */
export function shouldApplyGloss(
  source: string,
  translated: string,
  detectedSourceLanguage?: string | null
): boolean {
  if (isEnglishLanguageCode(detectedSourceLanguage)) return false
  if (isLikelyEnglishLyric(source)) return false
  if (isJunkGloss(translated)) return false
  const a = glossMatchKey(source)
  const b = glossMatchKey(translated)
  if (a === b) return false
  return true
}

/** Loose key for matching lyric lines across sites / punctuation. */
export function glossMatchKey(line: string): string {
  return line
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // d'opin → dopin so LRCLIB and hymn-page spellings align
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Collapse doubled vowels (oguun → ogun) for fuzzy hymn matching. */
function normalizeGlossTokens(key: string): string[] {
  return key
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1+/g, '$1'))
}

/** How well a harvested lyric key matches a slide line (1 = exact). */
function glossKeyScore(key: string, candidate: string): number {
  if (!key || !candidate) return 0
  if (key === candidate) return 1
  const shorter = key.length <= candidate.length ? key : candidate
  const longer = key.length <= candidate.length ? candidate : key
  // Prefix: "odu jesus nana tumale" ↔ "odu jesus nana tumale chaka chaka"
  if (longer.startsWith(`${shorter} `)) {
    return shorter.length / longer.length
  }
  // Whole-phrase containment on word boundaries
  if (` ${longer} `.includes(` ${shorter} `)) {
    return shorter.length / longer.length
  }

  const a = normalizeGlossTokens(key)
  const b = normalizeGlossTokens(candidate)
  if (a.length === 0 || b.length === 0) return 0
  if (a.join(' ') === b.join(' ')) return 0.95
  // Apostrophe / spacing drift: "ogun si'tan" ↔ "ogun si tan", "d'opin" ↔ "dopin"
  if (a.join('') === b.join('')) return 0.92

  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const token of setA) {
    if (setB.has(token)) inter++
  }
  const union = setA.size + setB.size - inter
  if (union === 0) return 0
  const jaccard = inter / union
  // Require enough shared tokens so short junk lines don't latch on.
  if (jaccard >= 0.7 && inter >= 3) return jaccard * 0.9
  return 0
}

const GLUED_SECTION_LABEL =
  /^(lyrics|uncategorized|chorus|verse|bridge|refrain|spoken|outro|intro|tag|hook|pre[- ]?chorus)(?=[A-Z0-9])/i

/**
 * Peel site chrome glued onto lyric lines ("ChorusOdudu…", "Refrain: Ide…", "… x4").
 */
export function cleanGlossSource(source: string): string {
  let s = source.replace(/^[\s\-–—:|]+/, '').trim()
  for (let i = 0; i < 5; i++) {
    const next = s.replace(GLUED_SECTION_LABEL, '')
    if (next === s) break
    s = next
  }
  s = s.replace(/^(chorus|verse|bridge|refrain|spoken)\s*[:.-]?\s*/i, '')
  s = s.replace(/\s*x\d+\s*$/i, '').replace(/\s*\(\s*repeat\s*\)\s*$/i, '').trim()
  return s
}

/**
 * Pulls `singable (English gloss)` pairs from lyric-site text.
 * African Gospel Lyrics and Lyricsom often embed translations this way.
 */
export function extractInlineGlossPairs(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  const pattern = /([^\n(]{2,120}?)\s*\(([^)\n]{2,120})\)/g
  for (const match of raw.matchAll(pattern)) {
    const cleanedSource = cleanGlossSource(match[1])
    let gloss = match[2].trim()
    if (!cleanedSource || !gloss) continue
    if (isJunkGloss(gloss)) continue
    if (/https?:|www\./i.test(gloss)) continue
    const key = glossMatchKey(cleanedSource)
    if (key.length < 3) continue
    if (isLikelyEnglishLyric(cleanedSource)) continue
    while (gloss.startsWith('(') && gloss.endsWith(')')) gloss = gloss.slice(1, -1).trim()
    if (isJunkGloss(gloss)) continue
    if (!map.has(key)) map.set(key, gloss)
  }
  return map
}

/**
 * Turns inline `line (gloss)` into our under-line bilingual format before
 * other cleanup runs.
 */
export function expandInlineGlossesToLines(raw: string): string {
  return raw
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trimEnd()
      if (!trimmed.trim() || isSectionMarkerLine(trimmed.trim())) return [trimmed]
      const match = trimmed.match(/^(.*?)\s*\(([^)]{2,120})\)\s*$/)
      if (!match) return [trimmed]
      const source = match[1].trim()
      const gloss = match[2].trim()
      if (!source || !gloss || isJunkGloss(gloss)) {
        return [trimmed]
      }
      return [source, formatGloss(gloss)]
    })
    .join('\n')
}

/**
 * Looks up a gloss by fuzzy line key.
 * Requires a close match so "I see Jesus" does not pick up "i see jesus x4 → Refrain".
 */
export function lookupOnlineGloss(line: string, pairs: Map<string, string>): string | undefined {
  const cleaned = cleanGlossSource(line)
  if (!cleaned || isLikelyEnglishLyric(cleaned)) return undefined

  const keys = [glossMatchKey(cleaned)]
  // Split jammed slide lines ("E chego mano Jesus! E chego mano")
  for (const part of cleaned.split(/[!?;|/]+/)) {
    const k = glossMatchKey(part)
    if (k.length >= 3 && !keys.includes(k)) keys.push(k)
  }

  let best: { gloss: string; score: number } | null = null
  for (const key of keys) {
    if (!key || isLikelyEnglishLyric(key)) continue
    const exact = pairs.get(key)
    if (exact && !isJunkGloss(exact)) return exact

    for (const [candidate, gloss] of pairs) {
      if (isJunkGloss(gloss)) continue
      const score = glossKeyScore(key, candidate)
      // Exact / strong prefix (≥ ~half the longer phrase) only — avoid weak junk.
      if (score < 0.5) continue
      if (!best || score > best.score) best = { gloss, score }
      if (score === 1) return gloss
    }
  }
  return best?.gloss
}

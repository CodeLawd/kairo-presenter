// Bible translations named aloud in a sermon: "John 3:16 in the NLT", "the New
// Living Translation says", "let's read that in the N-I-V".
//
// Derived from the translation registry, so a new translation is heard with no
// change here. Speech is noisier than sermon notes, so matching is stricter:
//
// - Letters count in any case ("NLT", "niv") or spelled out ("n l t",
//   "N.I.V."), except an id that is also an English word: "web" in a sentence
//   is not the World English Bible, so WEB only counts in capitals.
// - A short name that is also everyday English ("new living", "world
//   english") only counts when used as a name: followed by translation,
//   version or bible, or ending the phrase ("in the New Living.", "the New
//   Living says"). "We serve the new living God" is not the NLT.
// - Names that are ordinary sermon words ("the message", "amplified") only
//   count in a form nobody says by accident ("the Message Bible", "the Amplified").
//
// Dependency-free like the registry: it runs in main and in tests.

import { BIBLE_TRANSLATIONS } from './bible-translations'

/** Ids that are also English words, so only their capitalized form is a translation. */
const WORD_IDS = new Set(['WEB'])

/** Short names that mean a translation however they're used. */
const UNAMBIGUOUS_SHORT_NAME = /king james/i

/** What must follow a short everyday-English name for it to be a translation's name. */
const NAME_ENDING = String.raw`(?=\s+(?:translation|version|bible)\b|\s*(?:[,.;:!?)–—-]|$)|\s+(?:says|said|puts|put|reads|read|renders|has|and|or|too|again|instead)\b)`

/** Spoken forms that replace the registry's name patterns for ids whose names are common words. */
const SPOKEN_NAME_OVERRIDES: Record<string, string[]> = {
  MSG: ['the message (?:bible|translation|version)', 'message bible', 'message translation'],
  AMPC: ['the amplified', 'amplified (?:bible|version|translation|classic)'],
}

interface SpokenPattern {
  id: string
  pattern: RegExp
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPatterns(): SpokenPattern[] {
  const patterns: SpokenPattern[] = []
  for (const entry of BIBLE_TRANSLATIONS) {
    const id = entry.id.toUpperCase()
    // Abbreviation as written ("NLT", "niv"), or letter by letter ("n l t").
    patterns.push({
      id: entry.id,
      pattern: new RegExp(String.raw`\b${escapeRegex(id)}\b`, WORD_IDS.has(id) ? 'g' : 'gi'),
    })
    if (/^[A-Z]{2,5}$/.test(id)) {
      const spelled = id.split('').join(String.raw`[\s.\-]+`)
      patterns.push({ id: entry.id, pattern: new RegExp(String.raw`\b${spelled}\b\.?`, 'gi') })
    }
    // Names: the full name, then the registry's shorter name patterns.
    const names = SPOKEN_NAME_OVERRIDES[id] ?? [
      escapeRegex(entry.name.replace(/,/g, '')).replace(/\s+/g, String.raw`\s+`),
      ...(entry.namePatterns ?? []).map((source) =>
        UNAMBIGUOUS_SHORT_NAME.test(source) ? source : `(?:${source})${NAME_ENDING}`),
    ]
    for (const source of names) {
      patterns.push({ id: entry.id, pattern: new RegExp(String.raw`\b(?:${source})`, 'gi') })
    }
  }
  return patterns
}

const PATTERNS = buildPatterns()

export interface SpokenTranslationMatch {
  id: string
  start: number
  end: number
}

/**
 * Every translation named in `text`, in the order spoken.
 * Overlapping names resolve to the longest, so "New King James" is NKJV and
 * not KJV, and "New American Standard" is NASB and not ASV.
 */
export function findSpokenTranslationMatches(text: string): SpokenTranslationMatch[] {
  const found: SpokenTranslationMatch[] = []
  for (const { id, pattern } of PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      found.push({ id, start: match.index, end: match.index + match[0].length })
      if (match[0].length === 0) pattern.lastIndex++
    }
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const kept: SpokenTranslationMatch[] = []
  for (const candidate of found) {
    const overlapping = kept.find((other) => candidate.start < other.end && other.start < candidate.end)
    if (!overlapping) {
      kept.push(candidate)
      continue
    }
    if (candidate.end - candidate.start > overlapping.end - overlapping.start) {
      kept.splice(kept.indexOf(overlapping), 1, candidate)
    }
  }
  return kept.sort((a, b) => a.start - b.start)
}

/** Ids of the translations named in `text`, in spoken order, no repeats. */
export function findSpokenTranslations(text: string): string[] {
  const ids: string[] = []
  for (const { id } of findSpokenTranslationMatches(text)) {
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

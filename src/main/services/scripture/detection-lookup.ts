import type { ScriptureResult, ScriptureTranslation, ScriptureVerse } from '@shared/ipc'

interface DetectedReference {
  book: string
  chapter: number
  verseStart: number
  verseEnd?: number
}

interface ReferenceSearch {
  search(query: string, translation?: ScriptureTranslation, apiKey?: string): Promise<ScriptureResult[]>
}

/** Resolve live detections through the same local → API.Bible fallback as manual search. */
export async function lookupDetectedScripture(
  service: ReferenceSearch,
  ref: DetectedReference,
  translation: ScriptureTranslation,
  apiKey: string,
): Promise<ScriptureVerse[]> {
  const end = ref.verseEnd != null ? `-${ref.verseEnd}` : ''
  const results = await service.search(
    `${ref.book} ${ref.chapter}:${ref.verseStart}${end}`,
    translation,
    apiKey,
  )
  return results.flatMap((result) => result.verses)
}

/**
 * Looks a detection up in `translation`. When that was a translation the
 * preacher named and it can't be shown here (not installed, no API.Bible
 * access), falls back to the default so the operator still gets the verse —
 * and reports the named one, so the card can say so.
 */
export async function lookupWithTranslationFallback(
  lookup: (translation: ScriptureTranslation) => Promise<ScriptureVerse[]>,
  translation: ScriptureTranslation,
  requested: ScriptureTranslation | null,
  defaultTranslation: ScriptureTranslation,
): Promise<{ verses: ScriptureVerse[]; translation: ScriptureTranslation; requestedTranslation?: ScriptureTranslation }> {
  const verses = await lookup(translation)
  if (verses.length > 0 || !requested || requested === defaultTranslation) {
    return { verses, translation }
  }
  return {
    verses: await lookup(defaultTranslation),
    translation: defaultTranslation,
    requestedTranslation: requested,
  }
}

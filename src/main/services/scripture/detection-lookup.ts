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

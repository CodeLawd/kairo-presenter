import type { ScriptureResult, ScriptureTranslation, ScriptureVerse } from './ipc'

/**
 * A passage the operator kept.
 *
 * The verse text is stored, not just the reference: a saved passage must open
 * the same on a Sunday with no internet as it did when it was saved, and an
 * offline pack may not carry the translation it was looked up in.
 */
export interface SavedPassage {
  id: string
  reference: string
  translation: ScriptureTranslation
  verses: ScriptureVerse[]
  savedAt: number
}

export const PASSAGES_CHANNEL = 'passages:command'
export const PASSAGES_CHANGED = 'passages:changed'

export type PassagesCommand =
  | { action: 'list' }
  /** Save a looked-up passage, optionally straight into a library. */
  | { action: 'save'; result: ScriptureResult; libraryId?: string }
  | { action: 'remove'; passageId: string }

export interface PassagesAPI {
  command: (command: PassagesCommand) => Promise<SavedPassage[]>
  onChanged: (callback: (passages: SavedPassage[]) => void) => () => void
}

export const PASSAGES_MAX = 500

/** Same reference in the same translation is the same passage, saved once. */
export function passageKey(reference: string, translation: string): string {
  return `${reference.trim().toLowerCase()}|${translation.toLowerCase()}`
}

export function withPassage(
  passages: SavedPassage[],
  passage: SavedPassage,
): SavedPassage[] {
  const key = passageKey(passage.reference, passage.translation)
  const existing = passages.find(item => passageKey(item.reference, item.translation) === key)
  // Re-saving refreshes the text but keeps the id, so library filing and any
  // open view survive.
  if (existing) {
    return passages.map(item =>
      item.id === existing.id ? { ...passage, id: existing.id, savedAt: existing.savedAt } : item,
    )
  }
  return passages.length >= PASSAGES_MAX ? passages : [passage, ...passages]
}

export function passageToResult(passage: SavedPassage): ScriptureResult {
  return {
    reference: passage.reference,
    translation: passage.translation,
    verses: passage.verses,
  }
}

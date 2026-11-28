import { ABSENT_BOOKS, GENERATED_OVERRIDES } from './bible-versification-data'

interface VerseNumberingOverride {
  lastVerse: number
  omitted?: readonly number[]
}

// Verified against the AMPC source edition. Reference numbers only: omitted
// verses must never be filled or renumbered. Shared by pack validation and UI navigation.
const OVERRIDES: Record<string, Record<string, VerseNumberingOverride>> = {
  AMPC: {
    '41:9': { lastVerse: 50, omitted: [44, 46] },
    '64:1': { lastVerse: 15 },
  },
}

/** Every chapter of an untranslated book holds no verses. */
const ABSENT_CHAPTER: VerseNumberingOverride = { lastVerse: 0 }

export function hasCustomPackVersification(translation: string): boolean {
  const id = translation.toUpperCase()
  return Object.hasOwn(OVERRIDES, id) || Object.hasOwn(GENERATED_OVERRIDES, id) || Object.hasOwn(ABSENT_BOOKS, id)
}

export function getVerseNumberingOverride(
  translation: string,
  bookId: number,
  chapter: number,
): VerseNumberingOverride | undefined {
  const id = translation.toUpperCase()
  if (ABSENT_BOOKS[id]?.includes(bookId)) return ABSENT_CHAPTER
  const key = `${bookId}:${chapter}`
  const hand = OVERRIDES[id]?.[key]
  if (hand) return hand
  const generated = GENERATED_OVERRIDES[id]?.[key]
  if (!generated) return undefined
  const [lastVerse, ...omitted] = generated
  return omitted.length ? { lastVerse, omitted } : { lastVerse }
}

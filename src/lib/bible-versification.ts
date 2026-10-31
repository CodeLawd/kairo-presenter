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

export function hasCustomPackVersification(translation: string): boolean {
  return Object.hasOwn(OVERRIDES, translation.toUpperCase())
}

export function getVerseNumberingOverride(
  translation: string,
  bookId: number,
  chapter: number,
): VerseNumberingOverride | undefined {
  return OVERRIDES[translation.toUpperCase()]?.[`${bookId}:${chapter}`]
}

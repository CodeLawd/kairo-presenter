import { BIBLE_VERSE_COUNTS } from './bible-verse-counts'
import { getVerseNumberingOverride } from '@shared/bible-versification'
export { hasCustomPackVersification } from '@shared/bible-versification'

/** Exact verse identifiers allowed in a chapter, in source order. */
export function getPackVerseNumbers(translation: string, bookId: number, chapter: number): number[] {
  const override = getVerseNumberingOverride(translation, bookId, chapter)
  const lastVerse = override?.lastVerse ?? BIBLE_VERSE_COUNTS[bookId - 1]?.[chapter - 1] ?? 0
  return Array.from({ length: lastVerse }, (_, i) => i + 1)
    .filter((verse) => !override?.omitted?.includes(verse))
}

export function packTotalsFor(translation: string): { books: number; chapters: number; verses: number } {
  let chapters = 0
  let verses = 0
  for (const [bookIndex, counts] of BIBLE_VERSE_COUNTS.entries()) {
    chapters += counts.length
    for (let chapter = 1; chapter <= counts.length; chapter++) {
      verses += getPackVerseNumbers(translation, bookIndex + 1, chapter).length
    }
  }
  return { books: BIBLE_VERSE_COUNTS.length, chapters, verses }
}

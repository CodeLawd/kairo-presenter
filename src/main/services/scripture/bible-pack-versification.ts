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

/** Untranslated books and chapters hold no verses, so they are not counted. */
export function packTotalsFor(translation: string): { books: number; chapters: number; verses: number } {
  let books = 0
  let chapters = 0
  let verses = 0
  for (const [bookIndex, counts] of BIBLE_VERSE_COUNTS.entries()) {
    const before = chapters
    for (let chapter = 1; chapter <= counts.length; chapter++) {
      const count = getPackVerseNumbers(translation, bookIndex + 1, chapter).length
      if (count > 0) chapters++
      verses += count
    }
    if (chapters > before) books++
  }
  return { books, chapters, verses }
}

/** The last chapter of `bookId` that holds verses in `translation`, or 0. */
export function lastPackChapter(translation: string, bookId: number): number {
  const counts = BIBLE_VERSE_COUNTS[bookId - 1] ?? []
  for (let chapter = counts.length; chapter >= 1; chapter--) {
    if (getPackVerseNumbers(translation, bookId, chapter).length > 0) return chapter
  }
  return 0
}

/**
 * Synthetic Bible fixture for local-pack tests.
 *
 * Every string here is generated placeholder text — no copyrighted Bible
 * wording. The SHAPE mirrors a full Protestant canon (66 books, 1,189
 * chapters, 31,102 verses) so converter validation, pack import, lookup and
 * FTS search exercise production-scale counts without production text.
 */

export const FIXTURE_BOOKS = 66
export const FIXTURE_CHAPTERS = 1189
export const FIXTURE_VERSES = 31102

/** Distinctive token embedded in one verse for phrase-search tests. */
export const FIXTURE_MARKER = 'zephyrquill'

import { NKJV_VERSE_COUNTS } from '../nkjv-verse-counts'

export interface FixtureVerse {
  bookId: number
  chapter: number
  verse: number
  text: string
}

export interface FixtureSource {
  translation: { abbrev: string; name: string; language: string }
  books: Array<{
    index: number
    name: string
    chapters: Array<{ chapter: number; verses: Array<{ verse: number; text: string }> }>
  }>
}

export function chaptersForBook(bookIndex0: number): number {
  return NKJV_VERSE_COUNTS[bookIndex0]?.length ?? 0
}

export function versesForChapter(bookIndex0: number, chapterIndex0: number): number {
  return NKJV_VERSE_COUNTS[bookIndex0]?.[chapterIndex0] ?? 0
}

const BOOK_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
]

function verseText(bookId: number, chapter: number, verse: number): string {
  return `Synthetic fixture text for book ${bookId} chapter ${chapter} verse ${verse}, written for automated testing only.`
}

/** Flat canonical rows: 31,102 synthetic verses in book/chapter/verse order. */
export function buildFixtureVerses(): FixtureVerse[] {
  const rows: FixtureVerse[] = []
  for (let bookId = 1; bookId <= FIXTURE_BOOKS; bookId++) {
    const chapters = chaptersForBook(bookId - 1)
    for (let chapter = 1; chapter <= chapters; chapter++) {
      const verses = versesForChapter(bookId - 1, chapter - 1)
      for (let verse = 1; verse <= verses; verse++) {
        rows.push({ bookId, chapter, verse, text: verseText(bookId, chapter, verse) })
      }
    }
  }
  return rows
}

/** Nested source-JSON shape consumed by the pack converter. */
export function buildFixtureSource(abbrev = 'NKJV'): FixtureSource {
  const books: FixtureSource['books'] = []
  for (let index = 1; index <= FIXTURE_BOOKS; index++) {
    const chapters: FixtureSource['books'][number]['chapters'] = []
    const chapterCount = chaptersForBook(index - 1)
    for (let chapter = 1; chapter <= chapterCount; chapter++) {
      const verses: Array<{ verse: number; text: string }> = []
      const verseCount = versesForChapter(index - 1, chapter - 1)
      for (let verse = 1; verse <= verseCount; verse++) {
        verses.push({ verse, text: verseText(index, chapter, verse) })
      }
      chapters.push({ chapter, verses })
    }
    books.push({ index, name: BOOK_NAMES[index - 1] as string, chapters })
  }
  return {
    translation: { abbrev, name: 'Synthetic Fixture Translation', language: 'en' },
    books,
  }
}

/**
 * Append extra text to the verse at (bookId, chapter, verse). Returns the
 * updated row for reference-lookup assertions.
 */
export function markFixtureVerse(
  rows: FixtureVerse[],
  bookId: number,
  chapter: number,
  verse: number,
  extra: string,
): FixtureVerse {
  const row = rows.find(
    (candidate) => candidate.bookId === bookId && candidate.chapter === chapter && candidate.verse === verse,
  )
  if (!row) throw new Error(`Fixture has no verse ${bookId} ${chapter}:${verse}`)
  row.text = `${row.text} ${extra}`
  return row
}

/** Mirror a marker into the nested source shape (same coordinates). */
export function markFixtureSource(
  source: FixtureSource,
  bookId: number,
  chapter: number,
  verse: number,
  extra: string,
): void {
  const text = source.books[bookId - 1]?.chapters[chapter - 1]?.verses[verse - 1]?.text
  if (typeof text !== 'string') throw new Error(`Fixture source has no verse ${bookId} ${chapter}:${verse}`)
  const target = source.books[bookId - 1]?.chapters[chapter - 1]?.verses[verse - 1]
  if (target) target.text = `${text} ${extra}`
}

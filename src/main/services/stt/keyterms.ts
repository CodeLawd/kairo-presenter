/**
 * Deepgram keyterm prompting for Bible book names.
 *
 * Nova-3 caps keyterms at 500 tokens per request and Deepgram recommends a
 * focused list of 20–50 terms, so this is not every book: names such as John,
 * Mark or Acts are ordinary English the model already hears well. These are
 * the ones that come back misspelled or as other words ("Habakkuk", "Philippines").
 */
const HARD_BOOK_NAMES = [
  'Leviticus',
  'Deuteronomy',
  'Chronicles',
  'Nehemiah',
  'Psalm',
  'Psalms',
  'Proverbs',
  'Ecclesiastes',
  'Song of Solomon',
  'Isaiah',
  'Jeremiah',
  'Lamentations',
  'Ezekiel',
  'Hosea',
  'Obadiah',
  'Micah',
  'Nahum',
  'Habakkuk',
  'Zephaniah',
  'Haggai',
  'Zechariah',
  'Malachi',
  'Corinthians',
  'Galatians',
  'Ephesians',
  'Philippians',
  'Colossians',
  'Thessalonians',
  'Philemon',
  'Hebrews',
  'Revelation',
] as const

export const MAX_KEYTERMS = 50

/**
 * Terms to boost for one transcription session. Books in the live sermon
 * playlist come first, since they are the ones the preacher is about to say.
 * The names are English, so other transcription languages get none.
 */
export function scriptureKeyterms(
  language: string,
  playlistBooks: readonly string[] = [],
): string[] {
  if (!/^en(?:-|$)/i.test(language.trim())) return []
  const seen = new Set<string>()
  const terms: string[] = []
  for (const book of [...playlistBooks, ...HARD_BOOK_NAMES]) {
    // "1 Corinthians" is spoken "First Corinthians"; the name is what needs help.
    const name = book.replace(/^[123]\s+/, '').trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    terms.push(name)
    if (terms.length === MAX_KEYTERMS) break
  }
  return terms
}

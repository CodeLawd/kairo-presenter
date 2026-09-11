/**
 * Pull the canonical book name out of a scripture reference.
 *
 * Recap references are usually already canonical ("Romans 8:1"). Live
 * detections sometimes arrive abbreviated ("Rom 8:1", "1 Cor 13"). Longest
 * prefix wins so "1 John" is not eaten by "John".
 */

type BookEntry = readonly [name: string, aliases: readonly string[]]

const BOOKS: readonly BookEntry[] = [
  ['Genesis', ['gen', 'ge', 'gn']],
  ['Exodus', ['exod', 'exo', 'ex']],
  ['Leviticus', ['lev', 'lv']],
  ['Numbers', ['num', 'nu']],
  ['Deuteronomy', ['deut', 'deu', 'dt']],
  ['Joshua', ['josh', 'jos']],
  ['Judges', ['judg', 'jdg']],
  ['Ruth', ['ruth', 'ru']],
  ['1 Samuel', ['1sam', '1 sam', '1sa']],
  ['2 Samuel', ['2sam', '2 sam', '2sa']],
  ['1 Kings', ['1kgs', '1 kgs', '1ki']],
  ['2 Kings', ['2kgs', '2 kgs', '2ki']],
  ['1 Chronicles', ['1chr', '1 chr', '1ch']],
  ['2 Chronicles', ['2chr', '2 chr', '2ch']],
  ['Ezra', ['ezra', 'ezr']],
  ['Nehemiah', ['neh']],
  ['Esther', ['esth', 'est']],
  ['Job', ['job']],
  ['Psalms', ['psalms', 'psalm', 'ps']],
  ['Proverbs', ['prov', 'pro']],
  ['Ecclesiastes', ['eccl', 'ecc']],
  ['Song of Solomon', ['song of songs', 'song', 'sos']],
  ['Isaiah', ['isa']],
  ['Jeremiah', ['jer']],
  ['Lamentations', ['lam']],
  ['Ezekiel', ['ezek', 'eze']],
  ['Daniel', ['dan']],
  ['Hosea', ['hos']],
  ['Joel', ['joel']],
  ['Amos', ['amos']],
  ['Obadiah', ['obad', 'oba']],
  ['Jonah', ['jonah', 'jon']],
  ['Micah', ['mic']],
  ['Nahum', ['nah']],
  ['Habakkuk', ['hab']],
  ['Zephaniah', ['zeph']],
  ['Haggai', ['hag']],
  ['Zechariah', ['zech']],
  ['Malachi', ['mal']],
  ['Matthew', ['matt', 'mat']],
  ['Mark', ['mark', 'mrk']],
  ['Luke', ['luke', 'luk']],
  ['John', ['john', 'jhn', 'jn']],
  ['Acts', ['acts', 'act']],
  ['Romans', ['rom', 'ro']],
  ['1 Corinthians', ['1cor', '1 cor', '1co']],
  ['2 Corinthians', ['2cor', '2 cor', '2co']],
  ['Galatians', ['gal']],
  ['Ephesians', ['eph']],
  ['Philippians', ['phil', 'php']],
  ['Colossians', ['col']],
  ['1 Thessalonians', ['1thess', '1 thess', '1th']],
  ['2 Thessalonians', ['2thess', '2 thess', '2th']],
  ['1 Timothy', ['1tim', '1 tim', '1ti']],
  ['2 Timothy', ['2tim', '2 tim', '2ti']],
  ['Titus', ['titus', 'tit']],
  ['Philemon', ['phlm', 'phm']],
  ['Hebrews', ['heb']],
  ['James', ['jas', 'jam']],
  ['1 Peter', ['1pet', '1 pet', '1pe']],
  ['2 Peter', ['2pet', '2 pet', '2pe']],
  ['1 John', ['1john', '1 john', '1jn']],
  ['2 John', ['2john', '2 john', '2jn']],
  ['3 John', ['3john', '3 john', '3jn']],
  ['Jude', ['jude']],
  ['Revelation', ['rev']],
]

const PREFIXES: { book: string; variant: string }[] = BOOKS.flatMap(([name, aliases]) =>
  [name.toLowerCase(), ...aliases.map((alias) => alias.toLowerCase())].map((variant) => ({
    book: name,
    variant,
  })),
).sort((a, b) => b.variant.length - a.variant.length)

export function bookFromReference(reference: string): string | null {
  const normalized = reference.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return null
  for (const prefix of PREFIXES) {
    if (normalized === prefix.variant || normalized.startsWith(`${prefix.variant} `)) {
      return prefix.book
    }
  }
  return null
}

export function tallyBooks(references: string[]): { book: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const reference of references) {
    const book = bookFromReference(reference)
    if (!book) continue
    counts.set(book, (counts.get(book) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([book, count]) => ({ book, count }))
    .sort((a, b) => b.count - a.count || a.book.localeCompare(b.book))
}

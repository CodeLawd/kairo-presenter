import { BIBLE_BOOK_NAMES } from '@shared/scripture-query'

/** "Jesus said", "the Bible says", "Paul writes" — speech about to quote. */
const QUOTE_CUE = new RegExp(
  '\\b(?:jesus|god|the lord|paul|peter|moses|david|john|solomon|isaiah|the prophet|the psalmist|the apostle|' +
  'the scriptures?|the bible|the word|his word)\\s+(?:said|says|saith|wrote|writes|declares|tells us|is written|was written)\\b' +
  '|\\bit is written\\b|\\bscripture\\b|\\bthe word of god\\b|\\bverse\\b|\\bchapter\\b',
  'i',
)
/**
 * People and places a retold passage names ("the Lord opened her heart to heed
 * the things spoken by Paul"). Bare "God" is left out: "God bless you" and
 * "thank God" run through every announcement.
 */
const BIBLE_FIGURES = /\b(?:jesus|christ|the lord|lord god|holy spirit|paul|moses|abraham|isaac|jacob|joseph|noah|elijah|elisha|pharaoh|the disciples|the apostles?|pharisees|israel(?:ites)?|jerusalem|galilee|nazareth|bethlehem|egypt|samaria)\b/i
/** King James wording that ordinary speech doesn't use. */
const SCRIPTURE_WORDS = /\b(?:thee|thou|thy|thine|ye|hath|doth|saith|unto|shalt|shall|verily|behold|begat|blessed|whosoever|wherefore|lo)\b/i
/**
 * Book names that are also everyday words or first names ("Mark my words",
 * "John from the tech team", "acts of kindness") only count when used like a
 * citation: "Mark 4", "John chapter 3", "the book of Job", "the gospel of John".
 */
const EVERYDAY_BOOKS = new Set(['john', 'james', 'mark', 'luke', 'matthew', 'peter', 'jude', 'job', 'acts', 'numbers', 'ruth', 'judges', 'kings', 'daniel', 'samuel', 'timothy', 'titus', 'joel', 'amos', 'esther', 'jonah', 'revelation', 'philemon'])
const bookNames = [...new Set(BIBLE_BOOK_NAMES.map((name) => name.replace(/^\d\s*/, '').toLowerCase()))]
const DISTINCT_BOOK = new RegExp(`\\b(?:${bookNames.filter((name) => !EVERYDAY_BOOKS.has(name)).join('|')})\\b`, 'i')
const EVERYDAY = [...EVERYDAY_BOOKS].join('|')
const CITED_BOOK = new RegExp(`\\b(?:book|gospel|letter|epistle)\\s+of\\s+(?:${EVERYDAY})\\b|\\b(?:${EVERYDAY})\\s+(?:chapter\\s+)?(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\b`, 'i')

/**
 * Whether speech nothing local could place is still worth asking the AI about.
 * Most of a sermon is story, explanation and announcements; sending all of it
 * spends the church's monthly AI requests on sentences that aren't scripture.
 * Generous on purpose: any quotation cue, King James wording or book name passes.
 */
export function soundsLikeScripture(text: string): boolean {
  return QUOTE_CUE.test(text) || SCRIPTURE_WORDS.test(text) || BIBLE_FIGURES.test(text) || DISTINCT_BOOK.test(text) || CITED_BOOK.test(text)
}

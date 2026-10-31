import { BIBLE_BOOK_NAMES } from '@shared/scripture-query'

/** "Jesus said", "the Bible says", "Paul writes" — speech about to quote. */
const QUOTE_CUE = new RegExp(
  '\\b(?:jesus|god|the lord|paul|peter|moses|david|john|solomon|isaiah|the prophet|the psalmist|the apostle|' +
  'the scriptures?|the bible|the word|his word|it)\\s+(?:said|says|saith|wrote|writes|declares|tells us|is written|was written)\\b' +
  '|\\bit is written\\b|\\bscripture\\b|\\bthe word of god\\b|\\bverse\\b|\\bchapter\\b',
  'i',
)
/** King James wording that ordinary speech doesn't use. */
const SCRIPTURE_WORDS = /\b(?:thee|thou|thy|thine|ye|hath|doth|saith|unto|shalt|shall|verily|behold|begat|blessed|whosoever|wherefore|lo)\b/i
const BOOK_NAME = new RegExp(`\\b(?:${BIBLE_BOOK_NAMES.map((name) => name.replace(/^\d\s*/, '')).join('|')})\\b`, 'i')

/**
 * Whether speech nothing local could place is still worth asking the AI about.
 * Most of a sermon is story, explanation and announcements; sending all of it
 * spends the church's monthly AI requests on sentences that aren't scripture.
 * Generous on purpose: any quotation cue, King James wording or book name passes.
 */
export function soundsLikeScripture(text: string): boolean {
  return QUOTE_CUE.test(text) || SCRIPTURE_WORDS.test(text) || BOOK_NAME.test(text)
}

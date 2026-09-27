import type { ScriptureReference } from './detector';
import { isValidScriptureReference } from './verse-bounds';
import { tokenize } from '@shared/scripture-live-progress';

export interface QuoteCandidate { book: string; chapter: number; verse: number; text: string }

const units: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20' };
const words = (text: string): string => text.toLowerCase().replace(/\bhath\b/g, 'has').replace(/\b(?:you|me)\b/g, 'us').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Recover only when quotation and encoded chapter/verse independently agree. */
export function recoverDamagedQuote(
  text: string,
  search: (phrase: string) => QuoteCandidate[],
): ScriptureReference[] {
  const citation = text.match(/\b([1-3]?\s*[a-z]+)\s+([a-z0-9]*\d[a-z0-9]*)(?:[-–](\w+))?\s+says[,.:]?\s+(.+)/i);
  if (!citation || !/[a-z]/i.test(citation[2])) return [];
  const quote = words(citation[4].split(/[.!?]/)[0]);
  if (quote.split(' ').length < 7) return [];
  const encoded = citation[2].toLowerCase().replace(/one|two|three|four|five|six|seven|eight|nine/g, word => units[word]);
  if (!/^\d+$/.test(encoded)) return [];
  const rawEnd = citation[3]?.toLowerCase();
  const end = rawEnd ? Number(units[rawEnd] ?? rawEnd) : undefined;
  const book = citation[1].trim().toLowerCase().replace(/^psalm$/, 'psalms');
  const unique = new Map<string, ScriptureReference>();
  for (const candidate of search(citation[4].split(/[.!?]/)[0])) {
    if (candidate.book.toLowerCase() !== book || !words(candidate.text).includes(quote)) continue;
    if (`${candidate.chapter}${candidate.verse}` !== encoded) continue;
    const ref: ScriptureReference = {
      book: candidate.book, chapter: candidate.chapter, verseStart: candidate.verse,
      ...(end === undefined ? {} : { verseEnd: end }), confidence: 0.9,
      detectionType: 'quote', sourceText: text.slice(0, 150),
    };
    if (isValidScriptureReference(ref)) unique.set(`${ref.book} ${ref.chapter}:${ref.verseStart}`, ref);
  }
  return unique.size === 1 ? [...unique.values()] : [];
}

/** Content words (stop words removed) the heard text must share in order with one verse. */
const CHAPTER_QUOTE_MIN_RUN = 4;
/** A run this long is a reading, not a coincidence — confident enough to auto-present. */
const CHAPTER_QUOTE_STRONG_RUN = 6;

function longestSharedRun(heard: string[], verse: string[]): number {
  let best = 0;
  let previous = new Uint16Array(verse.length + 1);
  let current = new Uint16Array(verse.length + 1);
  for (let i = 1; i <= heard.length; i++) {
    for (let j = 1; j <= verse.length; j++) {
      current[j] = heard[i - 1] === verse[j - 1] ? previous[j - 1] + 1 : 0;
      if (current[j] > best) best = current[j];
    }
    [previous, current] = [current, previous];
  }
  return best;
}

/** One verse's wording, tokenized once for repeated matching. */
export interface ChapterVerseTokens { verse: number; tokens: string[] }

/** Tokenizes a chapter across translations, dropping identical wordings. */
export function tokenizeChapter(candidates: QuoteCandidate[]): ChapterVerseTokens[] {
  const seen = new Set<string>();
  const verses: ChapterVerseTokens[] = [];
  for (const candidate of candidates) {
    const tokens = tokenize(candidate.text);
    const key = `${candidate.verse}|${tokens.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verses.push({ verse: candidate.verse, tokens });
  }
  return verses;
}

/**
 * Finds the verse of an already-named chapter that the speaker is quoting:
 * "In John 3 Jesus says, for God so loved the world…". Knowing the chapter
 * makes a short ordered run of the verse's wording decisive, so this resolves
 * locally instead of waiting on the model. Verses may repeat across
 * translations; a tie between two different verses is treated as no match.
 */
export function matchChapterQuote(
  heardText: string,
  verses: ChapterVerseTokens[],
): { verse: number; confidence: number } | null {
  const heard = tokenize(heardText);
  if (heard.length < CHAPTER_QUOTE_MIN_RUN) return null;
  const runByVerse = new Map<number, number>();
  for (const { verse, tokens } of verses) {
    const run = longestSharedRun(heard, tokens);
    if (run > (runByVerse.get(verse) ?? 0)) runByVerse.set(verse, run);
  }
  const ranked = [...runByVerse.entries()].sort((a, b) => b[1] - a[1]);
  const [best, runnerUp] = ranked;
  if (!best || best[1] < CHAPTER_QUOTE_MIN_RUN) return null;
  if (runnerUp && runnerUp[1] === best[1]) return null;
  return { verse: best[0], confidence: best[1] >= CHAPTER_QUOTE_STRONG_RUN ? 0.85 : 0.65 };
}

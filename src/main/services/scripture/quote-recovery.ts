import type { ScriptureReference } from './detector';
import { isValidScriptureReference } from './verse-bounds';

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

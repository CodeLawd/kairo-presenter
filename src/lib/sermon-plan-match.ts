import type {
  ScriptureTranslation,
  ScriptureVerse,
  SermonPlan,
  SermonScriptureItem,
} from "./ipc";
import { tokenize } from "./scripture-live-progress";

/** One verse of one sermon-playlist item, pre-resolved and ready to project. */
export interface PlanVerseEntry {
  planId: string;
  planItemId: string;
  /** The playlist item's own label, e.g. "Romans 8:28–30". */
  itemReference: string;
  /** Canonical single-verse reference, e.g. "Romans 8:28". */
  reference: string;
  translation: ScriptureTranslation;
  verse: ScriptureVerse;
  /** Position of this verse inside its playlist item. */
  indexInItem: number;
  /** How many verses the playlist item holds. */
  itemLength: number;
}

export interface SermonPlanIndex {
  planId: string;
  /** `${book}|${chapter}|${verse}` (lowercased book) → entry. */
  byVerseKey: Map<string, PlanVerseEntry>;
  /** Entries with enough distinct text to be matched by quotation. */
  quotable: Array<{ entry: PlanVerseEntry; tokens: string[] }>;
}

export interface PlanQuoteMatch {
  entry: PlanVerseEntry;
  coverage: number;
}

/** Minimum distinct tokens a verse needs before it is eligible for quote matching. */
const MIN_VERSE_TOKENS = 6;
/** Distinct-token coverage a transcript must reach to count as reading the verse. */
const DEFAULT_MIN_COVERAGE = 0.6;
/** Distinct verse tokens that must be heard regardless of coverage ratio. */
const MIN_MATCHED_TOKENS = 4;
/** Length of the ordered run required so scattered common words cannot match. */
const RUN_LENGTH = 3;

export function verseKey(book: string, chapter: number, verse: number): string {
  return `${book.trim().toLowerCase().replace(/\s+/g, " ")}|${chapter}|${verse}`;
}

function itemVerseReference(verse: ScriptureVerse): string {
  return `${verse.book} ${verse.chapter}:${verse.verse}`;
}

function isUsableItem(item: SermonScriptureItem): boolean {
  return item.available && item.verses.length > 0;
}

/**
 * Builds the lookup structures for one sermon playlist.
 *
 * Keys come from `verse.book/chapter/verse` rather than the item's reference
 * string: the app writes ranges with an en dash in some paths and an ASCII
 * hyphen in others, and the verse rows are already canonical.
 */
export function buildSermonPlanIndex(plan: SermonPlan): SermonPlanIndex {
  const byVerseKey = new Map<string, PlanVerseEntry>();

  for (const item of plan.items) {
    if (!isUsableItem(item)) continue;
    for (const [indexInItem, verse] of item.verses.entries()) {
      const entry: PlanVerseEntry = {
        planId: plan.id,
        planItemId: item.id,
        itemReference: item.reference,
        reference: itemVerseReference(verse),
        translation: item.translation,
        verse,
        indexInItem,
        itemLength: item.verses.length,
      };
      const key = verseKey(verse.book, verse.chapter, verse.verse);
      const existing = byVerseKey.get(key);
      // Narrower item wins: a bare single-verse call must not drag a whole
      // passage onto the screen when both are in the playlist.
      if (existing && existing.itemLength <= entry.itemLength) continue;
      byVerseKey.set(key, entry);
    }
  }

  const quotable: SermonPlanIndex["quotable"] = [];
  for (const entry of byVerseKey.values()) {
    const tokens = tokenize(entry.verse.text ?? "");
    if (new Set(tokens).size < MIN_VERSE_TOKENS) continue;
    quotable.push({ entry, tokens });
  }

  return { planId: plan.id, byVerseKey, quotable };
}

/**
 * Resolves a detected reference against the playlist. Returns the covered
 * verses in order, or `[]` when any verse of the range is missing — a partial
 * hit must fall through to the normal Bible lookup so nothing is dropped.
 */
export function matchPlanReference(
  index: SermonPlanIndex | null,
  ref: { book: string; chapter: number; verseStart: number; verseEnd?: number },
): PlanVerseEntry[] {
  const end =
    ref.verseEnd != null && ref.verseEnd > ref.verseStart
      ? ref.verseEnd
      : ref.verseStart;
  if (!index) return [];
  const entries: PlanVerseEntry[] = [];
  for (let verse = ref.verseStart; verse <= end; verse++) {
    const entry = index.byVerseKey.get(verseKey(ref.book, ref.chapter, verse));
    if (!entry) return [];
    entries.push(entry);
  }
  return entries;
}

function hasOrderedRun(
  verseTokens: string[],
  heardSequence: string[],
  runLength: number,
): boolean {
  if (verseTokens.length < runLength || heardSequence.length < runLength) {
    return false;
  }
  const heardRuns = new Set<string>();
  for (let i = 0; i + runLength <= heardSequence.length; i++) {
    heardRuns.add(heardSequence.slice(i, i + runLength).join(" "));
  }
  for (let i = 0; i + runLength <= verseTokens.length; i++) {
    if (heardRuns.has(verseTokens.slice(i, i + runLength).join(" "))) return true;
  }
  return false;
}

/**
 * Finds the playlist verse the transcript is reading aloud, if any.
 *
 * Coverage alone lets sermon commentary score highly by reusing a verse's
 * words, so a contiguous run of the verse's own wording is also required.
 */
export function matchPlanQuote(
  index: SermonPlanIndex | null,
  transcript: string,
  minCoverage: number = DEFAULT_MIN_COVERAGE,
): PlanQuoteMatch | null {
  if (!index) return null;
  const heardSequence = tokenize(transcript);
  if (heardSequence.length < MIN_MATCHED_TOKENS) return null;
  const heard = new Set(heardSequence);

  let best: PlanQuoteMatch | null = null;
  for (const { entry, tokens } of index.quotable) {
    const distinct = [...new Set(tokens)];
    const matched = distinct.filter((token) => heard.has(token)).length;
    if (matched < MIN_MATCHED_TOKENS) continue;
    const coverage = matched / distinct.length;
    if (coverage < minCoverage) continue;
    if (!hasOrderedRun(tokens, heardSequence, RUN_LENGTH)) continue;
    if (!best || coverage > best.coverage) best = { entry, coverage };
  }
  return best;
}

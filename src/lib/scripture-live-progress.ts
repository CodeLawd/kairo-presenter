import type { ScriptureSuggestion } from "./ipc";

export interface ScriptureSuggestionGroup {
  id: string;
  reference: string;
  suggestions: ScriptureSuggestion[];
}

export interface OperatorSuggestionSections {
  current: ScriptureSuggestionGroup[];
  history: ScriptureSuggestionGroup[];
}

export function partitionOperatorSuggestionGroups(
  groups: ScriptureSuggestionGroup[],
  _activeGroupId: string | null,
  visibleGroupCount = 3,
): OperatorSuggestionSections {
  const newestFirst = [...groups].reverse();
  const current = newestFirst.slice(0, Math.max(0, visibleGroupCount));
  const currentIds = new Set(current.map((group) => group.id));
  return {
    current,
    history: newestFirst.filter((group) => !currentIds.has(group.id)),
  };
}

export interface ScriptureReadingProgress {
  matchedIndex: number;
  activeIndex: number;
  activeSuggestionId: string;
  confidence: number;
}

export interface PassageFollowState {
  passageId: string;
  currentIndex: number;
  /** Unused since reading is followed in order; kept so older callers still type-check. */
  matchedTokenIndexes: number[];
  /** How far into the current verse's words the reader has got, from finished phrases. */
  readTo?: number;
  /** How many of those words were actually heard (the rest were skipped or misheard). */
  heardCount?: number;
}

export interface PassageFollowUpdate {
  state: PassageFollowState;
  nextSuggestionId: string | null;
}

export function applyOperatorSuggestionSent(
  suggestions: ScriptureSuggestion[],
  sentSuggestionIds: ReadonlySet<string>,
  suggestionId: string,
): {
  suggestions: ScriptureSuggestion[];
  sentSuggestionIds: Set<string>;
} {
  return {
    suggestions,
    sentSuggestionIds: new Set(sentSuggestionIds).add(suggestionId),
  };
}

export function groupScriptureSuggestions(
  suggestions: ScriptureSuggestion[],
): ScriptureSuggestionGroup[] {
  const groups = new Map<string, ScriptureSuggestionGroup>();
  for (const suggestion of suggestions) {
    const id = suggestion.passageId ?? suggestion.id;
    const existing = groups.get(id);
    if (existing) {
      existing.suggestions.push(suggestion);
      continue;
    }
    groups.set(id, {
      id,
      reference: suggestion.passageReference ?? suggestion.reference,
      suggestions: [suggestion],
    });
  }
  return [...groups.values()].map((group) => {
    // One verse, one chip: a spoken step can land while the row is still
    // switching translation, briefly leaving two copies of the same verse.
    const seen = new Set<string>();
    const unique = group.suggestions.filter((item) => {
      const key = `${item.reference}|${item.translation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      ...group,
      suggestions: unique.sort(
        (left, right) =>
          (left.passageIndex ?? 0) - (right.passageIndex ?? 0),
      ),
    };
  });
}

export function navigateOperatorSuggestionId(
  visibleIds: string[],
  selectedId: string | null,
  delta: -1 | 1,
): string | null {
  if (visibleIds.length === 0) return null;
  const currentIndex = selectedId ? visibleIds.indexOf(selectedId) : -1;
  if (currentIndex < 0) return visibleIds[0];
  return visibleIds[Math.max(0, Math.min(visibleIds.length - 1, currentIndex + delta))];
}

export function findReadingProgress(
  transcript: string,
  suggestions: ScriptureSuggestion[],
): ScriptureReadingProgress | null {
  const heard = new Set(tokenize(transcript));
  if (heard.size < 3) return null;

  let bestIndex = -1;
  let bestCoverage = 0;
  let bestMatched = 0;
  suggestions.forEach((suggestion, index) => {
    const verseTokens = [...new Set(tokenize(suggestion.verses[0]?.text ?? ""))];
    if (verseTokens.length < 2) return;
    const matched = verseTokens.filter((token) => heard.has(token)).length;
    const coverage = matched / verseTokens.length;
    if (
      matched > bestMatched ||
      (matched === bestMatched && coverage > bestCoverage)
    ) {
      bestMatched = matched;
      bestCoverage = coverage;
      bestIndex = index;
    }
  });

  if (bestIndex < 0 || bestCoverage < 0.45) return null;
  const shouldAdvance =
    bestCoverage >= 0.72 && bestIndex < suggestions.length - 1;
  const activeIndex = shouldAdvance ? bestIndex + 1 : bestIndex;
  return {
    matchedIndex: bestIndex,
    activeIndex,
    activeSuggestionId: suggestions[activeIndex].id,
    confidence: bestCoverage,
  };
}

export function mergeScriptureSuggestion(
  suggestions: ScriptureSuggestion[],
  incoming: ScriptureSuggestion,
): ScriptureSuggestion[] {
  if (suggestions.some((item) => item.id === incoming.id)) return suggestions;
  // A fresh single-verse detection must not duplicate a card already loaded
  // inside a passage. Keep its id and passage membership for keyboard/follow state.
  if ((incoming.passageLength ?? 1) <= 1) {
    const existing = suggestions.find(item =>
      item.translation === incoming.translation &&
      item.reference.trim().toLowerCase() === incoming.reference.trim().toLowerCase(),
    );
    if (existing) return suggestions;
  }

  const passage = incoming.passageReference?.match(
    /^(.+?)\s+(\d+):(\d+)(?:[-–—](\d+))?$/,
  );
  if (!passage || (incoming.passageLength ?? 1) <= 1) {
    return [...suggestions, incoming];
  }

  const [, book, chapterText, startText, endText] = passage;
  const chapter = Number(chapterText);
  const start = Number(startText);
  const end = Number(endText ?? startText);
  // A passage already holding every one of these verses wins: a later, narrower
  // guess at the same reading (the AI's "John 1:1-4" after "John 1:1-10" was
  // said) must not carve verses out of it and split it into two cards.
  const covering = new Map<string, number[]>();
  for (const item of suggestions) {
    const verse = item.verses[0];
    if (!item.passageId || item.passageId === incoming.passageId || item.translation !== incoming.translation || !verse) continue;
    if (verse.book.toLowerCase() !== book.toLowerCase() || verse.chapter !== chapter) continue;
    covering.set(item.passageId, [...(covering.get(item.passageId) ?? []), verse.verse]);
  }
  for (const verses of covering.values()) {
    if (Math.min(...verses) <= start && Math.max(...verses) >= end) return suggestions;
  }
  const retained = suggestions.filter((item) => {
    if (item.passageId === incoming.passageId) return true;
    // The same passage in another translation sits beside it, never replaces it.
    if (item.translation !== incoming.translation) return true;
    const verse = item.verses[0];
    if (!verse) return true;
    return !(
      verse.book.toLowerCase() === book.toLowerCase() &&
      verse.chapter === chapter &&
      verse.verse >= start &&
      verse.verse <= end
    );
  });
  return [...retained, incoming];
}

export function nextAutoFollowSuggestion(
  suggestions: ScriptureSuggestion[],
  activeSuggestionId: string,
  armedPassageId: string,
  sentSuggestionIds: ReadonlySet<string>,
): ScriptureSuggestion | null {
  const candidate = suggestions.find(
    (item) =>
      item.id === activeSuggestionId &&
      item.passageId === armedPassageId &&
      !sentSuggestionIds.has(item.id),
  );
  if (!candidate) return null;
  const furthestSentIndex = suggestions.reduce((furthest, item) => {
    if (
      item.passageId !== armedPassageId ||
      !sentSuggestionIds.has(item.id)
    ) {
      return furthest;
    }
    return Math.max(furthest, item.passageIndex ?? -1);
  }, -1);
  return (candidate.passageIndex ?? 0) > furthestSentIndex ? candidate : null;
}

/** How many verse words ahead a heard word may match: covers a skipped or misheard word or two. */
const FOLLOW_LOOKAHEAD = 4;

/**
 * Walks heard words through the verse in order. Each heard word may match one
 * of the next few verse words; a match moves the reader past it. Order is the
 * point: "In the beginning was the Word" reaches the first "Word", not the last.
 */
function readThrough(verse: string[], heard: string[], from: number, heardBefore: number) {
  let readTo = from;
  let heardCount = heardBefore;
  let lastHeard = -1;
  heard.forEach((token, index) => {
    const limit = Math.min(verse.length, readTo + FOLLOW_LOOKAHEAD);
    for (let at = readTo; at < limit; at++) {
      if (verse[at] !== token) continue;
      readTo = at + 1;
      heardCount += 1;
      lastHeard = index;
      return;
    }
  });
  return { readTo, heardCount, lastHeard };
}

/**
 * Follows a preacher reading a passage aloud, verse by verse.
 *
 * A verse is done once its closing words have been heard in order (allowing a
 * misheard word or two) and at least half of it was heard at all — so it holds
 * until the sentence is finished. It can also be done early when the next verse
 * clearly begins, but only from words heard after the current verse's last
 * match: the two often share words, which used to start the next one at once.
 *
 * `final` is false for live (interim) text, which keeps growing as the phrase
 * goes on: it is re-read from the last finished phrase rather than added on,
 * so the same words arriving again cannot push the reader forward.
 */
export function updatePassageFollow(
  state: PassageFollowState,
  transcript: string,
  suggestions: ScriptureSuggestion[],
  final = true,
): PassageFollowUpdate {
  const passage = suggestions
    .filter((item) => item.passageId === state.passageId)
    .sort((left, right) =>
      (left.passageIndex ?? 0) - (right.passageIndex ?? 0),
    );
  const current = passage.find(
    (item) => item.passageIndex === state.currentIndex,
  );
  const verseTokens = tokenize(current?.verses[0]?.text ?? "");
  if (!current || verseTokens.length < 2) {
    return { state, nextSuggestionId: null };
  }

  const heard = tokenize(transcript);
  const reading = readThrough(verseTokens, heard, state.readTo ?? 0, state.heardCount ?? 0);
  const closingSlack = verseTokens.length <= 8 ? 1 : 2;
  const finished =
    reading.readTo >= verseTokens.length - closingSlack &&
    reading.heardCount >= Math.ceil(verseTokens.length * 0.5);

  const next = passage.find((item) => item.passageIndex === state.currentIndex + 1);
  const nextLead = tokenize(next?.verses[0]?.text ?? "").slice(0, 4);
  const afterCurrent = heard.slice(reading.lastHeard + 1);
  const nextStarted =
    nextLead.length >= 3 &&
    readThrough(nextLead, afterCurrent, 0, 0).heardCount >= 3;

  if (next && (finished || nextStarted)) {
    return {
      state: {
        passageId: state.passageId,
        currentIndex: state.currentIndex + 1,
        matchedTokenIndexes: [],
        readTo: 0,
        heardCount: 0,
      },
      nextSuggestionId: next.id,
    };
  }
  return {
    // Live text is provisional: only a finished phrase moves the starting point.
    state: final
      ? { ...state, readTo: reading.readTo, heardCount: reading.heardCount }
      : state,
    nextSuggestionId: null,
  };
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "for",
  "in",
  "is",
  "it",
  "of",
  "that",
  "the",
  "to",
  "was",
  "with",
]);

const SPOKEN_ALIASES: Record<string, string> = {
  forth: "out",
  spake: "spoke",
  thee: "you",
  thou: "you",
  unto: "to",
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/'s$/, "").replace(/'/g, ""))
    .map((token) => SPOKEN_ALIASES[token] ?? token)
    .filter((token) => !STOP_WORDS.has(token));
}

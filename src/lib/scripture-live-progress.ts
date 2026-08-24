import type { ScriptureSuggestion } from "./ipc";

export interface ScriptureSuggestionGroup {
  id: string;
  reference: string;
  suggestions: ScriptureSuggestion[];
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
  matchedTokenIndexes: number[];
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
  return [...groups.values()].map((group) => ({
    ...group,
    suggestions: [...group.suggestions].sort(
      (left, right) =>
        (left.passageIndex ?? 0) - (right.passageIndex ?? 0),
    ),
  }));
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
  const retained = suggestions.filter((item) => {
    if (item.passageId === incoming.passageId) return true;
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

export function updatePassageFollow(
  state: PassageFollowState,
  transcript: string,
  suggestions: ScriptureSuggestion[],
): PassageFollowUpdate {
  const passage = suggestions
    .filter((item) => item.passageId === state.passageId)
    .sort((left, right) =>
      (left.passageIndex ?? 0) - (right.passageIndex ?? 0),
    );
  const current = passage.find(
    (item) => item.passageIndex === state.currentIndex,
  );
  const verseText = current?.verses[0]?.text ?? "";
  const verseTokens = tokenize(verseText);
  if (!current || verseTokens.length < 2) {
    return { state, nextSuggestionId: null };
  }

  const heard = new Set(tokenize(transcript));
  const matched = new Set(state.matchedTokenIndexes);
  verseTokens.forEach((token, index) => {
    if (heard.has(token)) matched.add(index);
  });

  const matchedIndexes = [...matched].sort((left, right) => left - right);
  const coverage = matchedIndexes.length / verseTokens.length;
  const tailStart = Math.max(0, Math.floor(verseTokens.length * 0.85));
  const tokenCounts = new Map<string, number>();
  verseTokens.forEach((token) => {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  });
  const distinctiveTailIndexes = verseTokens
    .map((token, index) => ({ token, index }))
    .filter(
      ({ token, index }) =>
        index >= tailStart && tokenCounts.get(token) === 1,
    )
    .map(({ index }) => index);
  const tailMatches = distinctiveTailIndexes.filter((index) =>
    matched.has(index),
  ).length;
  const tailNeeded = Math.min(2, distinctiveTailIndexes.length);
  const nextCandidate = passage.find(
    (item) => item.passageIndex === state.currentIndex + 1,
  );
  const nextTokens = tokenize(nextCandidate?.verses[0]?.text ?? "");
  const nextLeadLength = Math.max(3, Math.ceil(nextTokens.length * 0.35));
  const nextLeadTokens = [...new Set(nextTokens.slice(0, nextLeadLength))];
  const nextLeadMatches = nextLeadTokens.filter((token) => heard.has(token)).length;
  const nextVerseClearlyStarted =
    nextLeadTokens.length >= 3 &&
    nextLeadMatches >= 3 &&
    nextLeadMatches / nextLeadTokens.length >= 0.6;
  const complete =
    (coverage >= 0.55 && tailMatches >= tailNeeded) || nextVerseClearlyStarted;
  const next = complete
    ? passage.find((item) => item.passageIndex === state.currentIndex + 1)
    : null;

  if (!next) {
    return {
      state: { ...state, matchedTokenIndexes: matchedIndexes },
      nextSuggestionId: null,
    };
  }
  return {
    state: {
      passageId: state.passageId,
      currentIndex: state.currentIndex + 1,
      matchedTokenIndexes: [],
    },
    nextSuggestionId: next.id,
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/'s$/, "").replace(/'/g, ""))
    .map((token) => SPOKEN_ALIASES[token] ?? token)
    .filter((token) => !STOP_WORDS.has(token));
}

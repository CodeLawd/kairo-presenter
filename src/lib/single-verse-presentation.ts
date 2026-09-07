import type { ScriptureSuggestion } from './ipc';

/** All scripture outputs present exactly one verse, even for legacy range payloads. */
export function singleVerseSuggestion(suggestion: ScriptureSuggestion): ScriptureSuggestion {
  const verse = suggestion.verses[0];
  if (!verse) return suggestion;
  return { ...suggestion, reference: `${verse.book} ${verse.chapter}:${verse.verse}`, verses: [verse] };
}

export function splitVerseSuggestions(suggestion: ScriptureSuggestion): ScriptureSuggestion[] {
  return suggestion.verses.map((verse, index) => ({
    ...suggestion,
    id: `${suggestion.id}-${index}`,
    reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
    verses: [verse],
    passageId: suggestion.passageId ?? suggestion.id,
    passageReference: suggestion.reference,
    passageIndex: index,
    passageLength: suggestion.verses.length,
  }));
}

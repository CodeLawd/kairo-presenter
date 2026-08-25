import assert from "node:assert/strict";
import test from "node:test";

import type { ScriptureSuggestion } from "../src/lib/ipc";
import {
  applyOperatorSuggestionSent,
  groupScriptureSuggestions,
  partitionOperatorSuggestionGroups,
  findReadingProgress,
  mergeScriptureSuggestion,
  navigateOperatorSuggestionId,
  nextAutoFollowSuggestion,
  updatePassageFollow,
} from "../src/lib/scripture-live-progress";

const verseTexts = [
  "And God spake unto Noah, saying,",
  "Go forth of the ark, thou, and thy wife, and thy sons, and thy sons' wives with thee.",
  "Bring forth with thee every living thing that is with thee, of all flesh.",
  "Every beast, every creeping thing, and every fowl, and whatsoever creepeth upon the earth.",
  "And Noah builded an altar unto the Lord.",
  "And the Lord smelled a sweet savour.",
  "And the Lord said in his heart, I will not again curse the ground any more for man's sake.",
  "While the earth remaineth, seedtime and harvest, and cold and heat shall not cease.",
];

const suggestions: ScriptureSuggestion[] = verseTexts.map((text, index) => ({
  id: `genesis-8-${index + 15}`,
  reference: `Genesis 8:${index + 15}`,
  verses: [
    { book: "Genesis", chapter: 8, verse: index + 15, text },
  ],
  translation: "KJV",
  confidence: 0.97,
  source: "auto",
  triggerText: "Genesis chapter eight verse fifteen to twenty two",
  passageId: "genesis-8-15-22",
  passageReference: "Genesis 8:15-22",
  passageIndex: index,
  passageLength: 8,
}));

test("groups all eight individual verse suggestions under their passage", () => {
  const groups = groupScriptureSuggestions(suggestions);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reference, "Genesis 8:15-22");
  assert.deepEqual(
    groups[0].suggestions.map((suggestion) => suggestion.reference),
    [
      "Genesis 8:15",
      "Genesis 8:16",
      "Genesis 8:17",
      "Genesis 8:18",
      "Genesis 8:19",
      "Genesis 8:20",
      "Genesis 8:21",
      "Genesis 8:22",
    ],
  );
});

test("advances to the next card when the preacher reaches the end of a verse", () => {
  const progress = findReadingProgress(
    "Then God spoke to Noah saying go out of the ark, you and your wife, and your sons and your sons wives with you",
    suggestions,
  );

  assert.equal(progress?.matchedIndex, 1);
  assert.equal(progress?.activeIndex, 2);
  assert.equal(progress?.activeSuggestionId, "genesis-8-17");
});

test("an explicit passage replaces an earlier standalone guess inside its range", () => {
  const guessedVerse = { ...suggestions[6], passageId: undefined, passageReference: undefined };
  const incomingRangeVerse = suggestions[0];

  const merged = mergeScriptureSuggestion([guessedVerse], incomingRangeVerse);

  assert.deepEqual(merged.map((item) => item.id), [incomingRangeVerse.id]);
});

test("returns the next unsent verse only for the passage armed by the operator", () => {
  const candidate = nextAutoFollowSuggestion(
    suggestions,
    "genesis-8-17",
    "genesis-8-15-22",
    new Set(["genesis-8-15", "genesis-8-16"]),
  );

  assert.equal(candidate?.id, "genesis-8-17");
  assert.equal(
    nextAutoFollowSuggestion(
      suggestions,
      "genesis-8-17",
      "another-passage",
      new Set(),
    ),
    null,
  );
  assert.equal(
    nextAutoFollowSuggestion(
      suggestions,
      "genesis-8-16",
      "genesis-8-15-22",
      new Set(["genesis-8-18"]),
    ),
    null,
  );
});

test("keeps the current verse armed through commentary and resumes from retained progress", () => {
  const initial = {
    passageId: "genesis-8-15-22",
    currentIndex: 1,
    matchedTokenIndexes: [] as number[],
  };
  const partial = updatePassageFollow(
    initial,
    "Go out of the ark, you and your wife",
    suggestions,
  );
  const commentary = updatePassageFollow(
    partial.state,
    "The ark reminds us that obedience can be difficult in every generation",
    suggestions,
  );
  const resumed = updatePassageFollow(
    commentary.state,
    "and your sons and your sons wives with you",
    suggestions,
  );

  assert.equal(partial.nextSuggestionId, null);
  assert.equal(commentary.nextSuggestionId, null);
  assert.equal(resumed.nextSuggestionId, "genesis-8-17");
  assert.equal(resumed.state.currentIndex, 2);
});

test("does not advance when an early repeated word also appears at the end of the verse", () => {
  const longVerseSuggestions = suggestions.map((suggestion) =>
    suggestion.reference === "Genesis 8:17"
      ? {
          ...suggestion,
          verses: [{
            book: "Genesis",
            chapter: 8,
            verse: 17,
            text: "Bring forth with thee every living thing that is with thee, of all flesh, of fowl, and of cattle, and of every creeping thing that creepeth upon the earth; that they may breed abundantly in the earth, and be fruitful, and multiply upon the earth.",
          }],
        }
      : suggestion,
  );
  const initial = {
    passageId: "genesis-8-15-22",
    currentIndex: 2,
    matchedTokenIndexes: [] as number[],
  };

  const earlyEarth = updatePassageFollow(
    initial,
    "Bring out with you every living thing of all flesh, birds and cattle, and every creeping thing that creeps on the earth",
    longVerseSuggestions,
  );
  const resumedEnding = updatePassageFollow(
    earlyEarth.state,
    "so that they may breed abundantly in the earth and be fruitful and multiply on the earth",
    longVerseSuggestions,
  );

  assert.equal(earlyEarth.nextSuggestionId, null);
  assert.equal(resumedEnding.nextSuggestionId, "genesis-8-18");
});

test("group reading can advance when the next verse begins clearly", () => {
  const groupPassage = suggestions.slice(0, 3).map((suggestion, index) => ({
    ...suggestion,
    id: `deuteronomy-1-${index + 6}`,
    reference: `Deuteronomy 1:${index + 6}`,
    passageId: "deuteronomy-1-6-8",
    passageIndex: index,
    verses: [{
      book: "Deuteronomy",
      chapter: 1,
      verse: index + 6,
      text: index === 0
        ? "The LORD our God spake unto us in Horeb, saying, Ye have dwelt long enough in this mount"
        : index === 1
          ? "Turn you, and take your journey, and go to the mount of the Amorites"
          : "Behold, I have set the land before you: go in and possess the land",
    }],
  }));

  const update = updatePassageFollow(
    { passageId: "deuteronomy-1-6-8", currentIndex: 0, matchedTokenIndexes: [] },
    "Turn you and take your journey",
    groupPassage,
  );

  assert.equal(update.nextSuggestionId, "deuteronomy-1-7");
});

test("does not leave a long verse before its true final phrase is read", () => {
  const passage = suggestions.slice(0, 2).map((suggestion, index) => ({
    ...suggestion,
    id: `deuteronomy-1-${index + 7}`,
    reference: `Deuteronomy 1:${index + 7}`,
    passageId: "deuteronomy-1-7-8",
    passageIndex: index,
    verses: [{
      book: "Deuteronomy",
      chapter: 1,
      verse: index + 7,
      text: index === 0
        ? "Turn you, and take your journey, and go to the mount of the Amorites, and unto all the places nigh thereunto, in the plain, in the hills, and in the vale, and in the south, and by the sea side, to the land of the Canaanites, and unto Lebanon, unto the great river, the river Euphrates"
        : "Behold, I have set the land before you: go in and possess the land",
    }],
  }));
  const state = { passageId: "deuteronomy-1-7-8", currentIndex: 0, matchedTokenIndexes: [] };
  const beforeEnding = updatePassageFollow(
    state,
    "Turn you take your journey go to the mount of the Amorites all the places nearby in the plain hills valley south seaside land of the Canaanites Lebanon",
    passage,
  );
  const atEnding = updatePassageFollow(
    beforeEnding.state,
    "unto the great river the river Euphrates",
    passage,
  );

  assert.equal(beforeEnding.nextSuggestionId, null);
  assert.equal(atEnding.nextSuggestionId, "deuteronomy-1-8");
});

test("sending a standalone verse keeps its card visible", () => {
  const standalone = {
    ...suggestions[0],
    passageId: undefined,
    passageReference: undefined,
    passageIndex: undefined,
    passageLength: undefined,
  };

  const result = applyOperatorSuggestionSent(
    [standalone],
    new Set<string>(),
    standalone.id,
  );

  assert.deepEqual(result.suggestions.map((item) => item.id), [standalone.id]);
  assert.deepEqual([...result.sentSuggestionIds], [standalone.id]);
});

test("keeps newest detections first without reordering a clicked active passage", () => {
  const groups = groupScriptureSuggestions([
    { ...suggestions[0], id: "old", passageId: "old", passageReference: "Genesis 8:15" },
    { ...suggestions[1], id: "active", passageId: "active", passageReference: "Genesis 8:16" },
    { ...suggestions[2], id: "newer", passageId: "newer", passageReference: "Genesis 8:17" },
    { ...suggestions[3], id: "newest", passageId: "newest", passageReference: "Genesis 8:18" },
  ]);

  const sections = partitionOperatorSuggestionGroups(groups, "active", 3);

  assert.deepEqual(sections.current.map((group) => group.id), ["newest", "newer", "active"]);
  assert.deepEqual(sections.history.map((group) => group.id), ["old"]);
});

test("operator arrow navigation moves through the visible verse order", () => {
  const ids = ["verse-1", "verse-2", "verse-3"];

  assert.equal(navigateOperatorSuggestionId(ids, null, 1), "verse-1");
  assert.equal(navigateOperatorSuggestionId(ids, "verse-1", 1), "verse-2");
  assert.equal(navigateOperatorSuggestionId(ids, "verse-2", -1), "verse-1");
  assert.equal(navigateOperatorSuggestionId(ids, "verse-3", 1), "verse-3");
});

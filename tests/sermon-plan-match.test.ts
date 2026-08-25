import assert from "node:assert/strict";
import test from "node:test";

import type { ScriptureVerse, SermonPlan, SermonScriptureItem } from "../src/lib/ipc";
import {
  buildSermonPlanIndex,
  matchPlanQuote,
  matchPlanReference,
  verseKey,
} from "../src/lib/sermon-plan-match";

const ROMANS_8_28 =
  "And we know that all things work together for good to those who love God, to those who are the called according to His purpose.";
const ROMANS_8_29 =
  "For whom He foreknew, He also predestined to be conformed to the image of His Son, that He might be the firstborn among many brethren.";

function verse(
  book: string,
  chapter: number,
  number: number,
  text: string,
): ScriptureVerse {
  return { book, chapter, verse: number, text };
}

function item(
  overrides: Partial<SermonScriptureItem> & Pick<SermonScriptureItem, "id" | "reference">,
): SermonScriptureItem {
  return {
    translation: "NKJV",
    verses: [],
    available: true,
    ...overrides,
  };
}

function plan(items: SermonScriptureItem[]): SermonPlan {
  return {
    id: "plan-1",
    title: "Sunday",
    sourceFileName: "notes.docx",
    items,
    createdAt: 0,
    updatedAt: 0,
  };
}

const singleVerseItem = item({
  id: "item-single",
  reference: "Romans 8:28",
  verses: [verse("Romans", 8, 28, ROMANS_8_28)],
});

const rangeItem = item({
  id: "item-range",
  reference: "Romans 8:28–29",
  verses: [
    verse("Romans", 8, 28, ROMANS_8_28),
    verse("Romans", 8, 29, ROMANS_8_29),
  ],
});

test("a multi-verse item indexes one entry per verse with passage metadata", () => {
  const index = buildSermonPlanIndex(plan([rangeItem]));

  assert.equal(index.byVerseKey.size, 2);
  const first = index.byVerseKey.get(verseKey("Romans", 8, 28));
  const second = index.byVerseKey.get(verseKey("Romans", 8, 29));
  assert.ok(first && second);
  assert.deepEqual(
    [first.indexInItem, first.itemLength, first.reference, first.itemReference],
    [0, 2, "Romans 8:28", "Romans 8:28–29"],
  );
  assert.deepEqual([second.indexInItem, second.itemLength], [1, 2]);
});

test("items with no resolved text are excluded from the index", () => {
  const index = buildSermonPlanIndex(
    plan([
      item({ id: "unavailable", reference: "John 3:16", available: false }),
      item({ id: "empty", reference: "John 3:17", verses: [] }),
    ]),
  );

  assert.equal(index.byVerseKey.size, 0);
  assert.equal(index.quotable.length, 0);
});

test("the narrower item wins when two items cover the same verse", () => {
  const index = buildSermonPlanIndex(plan([rangeItem, singleVerseItem]));

  assert.equal(
    index.byVerseKey.get(verseKey("Romans", 8, 28))?.planItemId,
    "item-single",
  );
  // Order of the items in the plan must not change the outcome.
  const reversed = buildSermonPlanIndex(plan([singleVerseItem, rangeItem]));
  assert.equal(
    reversed.byVerseKey.get(verseKey("Romans", 8, 28))?.planItemId,
    "item-single",
  );
});

test("matchPlanReference resolves single verses and fully covered ranges", () => {
  const index = buildSermonPlanIndex(plan([rangeItem]));

  const single = matchPlanReference(index, {
    book: "Romans",
    chapter: 8,
    verseStart: 28,
  });
  assert.deepEqual(single.map((entry) => entry.verse.verse), [28]);

  const range = matchPlanReference(index, {
    book: "Romans",
    chapter: 8,
    verseStart: 28,
    verseEnd: 29,
  });
  assert.deepEqual(range.map((entry) => entry.verse.verse), [28, 29]);
});

test("a partially covered range falls through to the normal lookup", () => {
  const index = buildSermonPlanIndex(plan([singleVerseItem]));

  assert.deepEqual(
    matchPlanReference(index, {
      book: "Romans",
      chapter: 8,
      verseStart: 28,
      verseEnd: 30,
    }),
    [],
  );
});

test("references outside the playlist and a null index return no entries", () => {
  const index = buildSermonPlanIndex(plan([singleVerseItem]));

  assert.deepEqual(
    matchPlanReference(index, { book: "Romans", chapter: 9, verseStart: 28 }),
    [],
  );
  assert.deepEqual(
    matchPlanReference(index, { book: "John", chapter: 3, verseStart: 16 }),
    [],
  );
  assert.deepEqual(
    matchPlanReference(null, { book: "Romans", chapter: 8, verseStart: 28 }),
    [],
  );
});

test("book aliases and casing resolve to the same index key", () => {
  const index = buildSermonPlanIndex(plan([singleVerseItem]));

  assert.equal(
    matchPlanReference(index, { book: "romans", chapter: 8, verseStart: 28 })
      .length,
    1,
  );
});

test("reading a playlist verse aloud is matched by quote", () => {
  const index = buildSermonPlanIndex(plan([singleVerseItem]));

  const match = matchPlanQuote(
    index,
    "and we know that all things work together for good to those who love God",
  );
  assert.ok(match);
  assert.equal(match.entry.planItemId, "item-single");
  assert.ok(match.coverage >= 0.6);
});

test("commentary that reuses the verse's words without reading it does not match", () => {
  const index = buildSermonPlanIndex(plan([singleVerseItem]));

  const match = matchPlanQuote(
    index,
    "God is good, and the things He called us to do work out for our purpose when we love Him, together as one people who know that",
  );
  assert.equal(match, null);
});

test("short verses are never quote-matchable", () => {
  const index = buildSermonPlanIndex(
    plan([
      item({
        id: "short",
        reference: "John 11:35",
        verses: [verse("John", 11, 35, "Jesus wept.")],
      }),
    ]),
  );

  assert.equal(index.quotable.length, 0);
  assert.equal(matchPlanQuote(index, "Jesus wept, and He wept again"), null);
});

test("a null index and empty speech never quote-match", () => {
  assert.equal(matchPlanQuote(null, ROMANS_8_28), null);
  const index = buildSermonPlanIndex(plan([singleVerseItem]));
  assert.equal(matchPlanQuote(index, "   "), null);
});

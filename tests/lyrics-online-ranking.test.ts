import assert from "node:assert/strict";
import test from "node:test";

import { coreTitle, findLyricMatch, rankResults } from "../src/main/services/lyrics/online";
import { cleanTrackTitle } from "../src/main/services/lyrics/lrclib";
import { canonicalText } from "../src/main/services/lyrics/normalize";
import type { ProviderResult } from "../src/main/services/lyrics/provider-types";

// Placeholder lyric text, not a real song.
const LYRICS = [
  "Placeholder opening line",
  "Ese! Ese! Ese o",
  "Placeholder closing line",
].join("\n");

function result(over: Partial<ProviderResult> = {}): ProviderResult {
  return {
    id: "lrclib:1",
    provider: "lrclib",
    title: "Placeholder Song",
    artist: "Placeholder Artist",
    url: "https://lrclib.net/api/get/1",
    ...over,
  };
}

// ─── cleanTrackTitle ──────────────────────────────────────────────────────────

test("cleanTrackTitle strips channel suffixes and hashtag runs", () => {
  assert.equal(
    cleanTrackTitle(
      "Ese (Thank You) | NATHANIEL BASSEY feat. AIDEE IME - #nathanielbassey #ese",
    ),
    "Ese (Thank You)",
  );
});

test("cleanTrackTitle strips distribution tags", () => {
  assert.equal(cleanTrackTitle("Song Name (Official Video)"), "Song Name");
  assert.equal(cleanTrackTitle("Song Name [Lyric Video]"), "Song Name");
});

test("cleanTrackTitle leaves a clean title untouched", () => {
  assert.equal(cleanTrackTitle("Ese - Live"), "Ese - Live");
  assert.equal(cleanTrackTitle("Song Name (feat. Someone)"), "Song Name (feat. Someone)");
});

test("cleanTrackTitle never returns empty", () => {
  assert.equal(cleanTrackTitle("| #tag"), "| #tag");
});

// ─── findLyricMatch ───────────────────────────────────────────────────────────

test("findLyricMatch ignores punctuation and case", () => {
  const q = canonicalText("ese ese ese o");
  const match = findLyricMatch(LYRICS, q, q.split(" "));
  assert.equal(match.kind, "phrase");
  assert.equal(match.line, "Ese! Ese! Ese o");
});

test("findLyricMatch folds accents", () => {
  const q = canonicalText("ese ese ese o");
  const match = findLyricMatch("Èsé! Èsé! Èsé o", q, q.split(" "));
  assert.equal(match.kind, "phrase");
});

test("findLyricMatch finds a phrase split across lines", () => {
  const q = canonicalText("opening line placeholder closing");
  const match = findLyricMatch(
    "Placeholder opening line\nPlaceholder closing line",
    q,
    q.split(" "),
  );
  assert.equal(match.kind, "phrase");
});

test("findLyricMatch reports no match for unrelated text", () => {
  const q = canonicalText("entirely different wording here");
  assert.equal(findLyricMatch(LYRICS, q, q.split(" ")).kind, "none");
});

// ─── rankResults ──────────────────────────────────────────────────────────────

test("a confirmed lyric match outranks a more popular title-only hit", () => {
  const ranked = rankResults("ese ese ese o", [
    result({
      id: "genius:1",
      provider: "genius",
      title: "Some Popular Song (Romanized)",
      artist: "Big Artist",
      url: "https://genius.com/a",
      popularity: 560_000,
    }),
    result({
      id: "lrclib:2",
      title: "Ese (Thank You)",
      artist: "Placeholder Artist",
      lyrics: LYRICS,
    }),
  ]);

  assert.equal(ranked[0].id, "lrclib:2");
  assert.equal(ranked[0].snippet, "Ese! Ese! Ese o");
});

test("popularity cannot outrank an exact title match", () => {
  const ranked = rankResults("placeholder song", [
    result({
      id: "genius:1",
      provider: "genius",
      title: "Unrelated Track",
      url: "https://genius.com/a",
      popularity: 5_000_000,
    }),
    result({ id: "lrclib:2", title: "Placeholder Song" }),
  ]);

  assert.equal(ranked[0].id, "lrclib:2");
});

test("the same song from both providers collapses to one row, preferring Genius", () => {
  const ranked = rankResults("placeholder song", [
    result({
      id: "lrclib:2",
      title: "Placeholder Song",
      artist: "Placeholder Artist",
      album: "Placeholder Album",
    }),
    result({
      id: "genius:1",
      provider: "genius",
      title: "Placeholder Song",
      artist: "Placeholder Artist (Ft. Someone)",
      url: "https://genius.com/a",
      releaseYear: "2023",
    }),
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "genius:1");
  // Detail unique to the LRCLIB row survives the merge.
  assert.equal(ranked[0].album, "Placeholder Album");
  assert.equal(ranked[0].releaseYear, "2023");
});

test("strong web hits bury unrelated Genius noise", () => {
  const ranked = rankResults("ami oluwa", [
    result({
      id: "web:1",
      provider: "web",
      title: "Amioluwa",
      artist: "Sunmisola Agbebi",
      lyrics: "Amioluwa o mbe lori mi\nAmioluwa o mbe lara mi",
      url: "https://africangospellyrics.com/amioluwa/",
    }),
    result({
      id: "genius:noise",
      provider: "genius",
      title: "I Am",
      artist: "S.O.",
      url: "https://genius.com/so-i-am-lyrics",
    }),
    result({
      id: "genius:noise2",
      provider: "genius",
      title: "Wetin We Gain",
      artist: "Victor AD",
      url: "https://genius.com/victor-ad-wetin-we-gain-lyrics",
    }),
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, "Amioluwa");
  assert.equal(ranked[0].provider, "web");
});

test("ranking-only fields never cross the IPC boundary", () => {
  const ranked = rankResults("placeholder", [
    result({ lyrics: LYRICS, popularity: 100 }),
  ]);

  assert.ok(!("lyrics" in ranked[0]));
  assert.ok(!("popularity" in ranked[0]));
});

test("a short query returns nothing rather than noise", () => {
  assert.deepEqual(rankResults("", []), []);
});

// ─── coreTitle + variant collapsing ───────────────────────────────────────────

test("coreTitle strips qualifiers that mark a re-release", () => {
  assert.equal(coreTitle("Ese (Thank You)"), "ese");
  assert.equal(coreTitle("Ese - Live"), "ese");
  assert.equal(coreTitle("ESE (feat. AIDEE IME)"), "ese");
  assert.equal(coreTitle("Ese (Live) (feat. AIDEE IME)"), "ese");
});

test("coreTitle keeps distinct songs distinct", () => {
  assert.notEqual(coreTitle("My Victory"), coreTitle("Victory Song"));
});

test("coreTitle falls back to the full title when stripping empties it", () => {
  assert.equal(coreTitle("(Live)"), "live");
});

test("tagging variants of one recording collapse to a single row", () => {
  const ranked = rankResults("ese", [
    result({ id: "lrclib:1", title: "Ese (Thank You)", artist: "Nathaniel Bassey" }),
    result({ id: "lrclib:2", title: "Ese - Live", artist: "Nathaniel Bassey" }),
    result({ id: "lrclib:3", title: "ESE (feat. AIDEE IME)", artist: "NATHANIEL BASSEY" }),
  ]);

  assert.equal(ranked.length, 1);
});

test("a featured credit cannot make an unrelated song outrank the real one", () => {
  const ranked = rankResults("ese nathaniel bassey", [
    result({
      id: "genius:1",
      provider: "genius",
      title: "He Has Prevailed",
      artist: "Nathaniel Bassey (Ft. Ese Chekwa)",
      url: "https://genius.com/a",
      popularity: 5_600,
    }),
    result({ id: "lrclib:2", title: "Ese (Thank You)", artist: "Nathaniel Bassey" }),
  ]);

  assert.equal(ranked[0].id, "lrclib:2");
});

test("the same song transcribed to different lengths collapses", () => {
  const full = ["Line one", "Line two", "Line three", "Line four"].join("\n");
  const partial = ["Line one", "Line two"].join("\n");

  const ranked = rankResults("placeholder", [
    result({ id: "lrclib:1", title: "Song A", artist: "Artist One", lyrics: full }),
    result({ id: "lrclib:2", title: "Song B", artist: "Artist Two", lyrics: partial }),
  ]);

  assert.equal(ranked.length, 1);
});

test("different songs are not collapsed by the lyric fingerprint", () => {
  const ranked = rankResults("placeholder", [
    result({ id: "lrclib:1", title: "Song A", artist: "Artist One", lyrics: "Alpha\nBravo\nCharlie" }),
    result({ id: "lrclib:2", title: "Song B", artist: "Artist Two", lyrics: "Delta\nEcho\nFoxtrot" }),
  ]);

  assert.equal(ranked.length, 2);
});

// ─── "<title> by <artist>" queries ────────────────────────────────────────────
// Typing the artist is a constraint, not a hint: worship titles are covered
// constantly, so a cover by someone else must never outrank the recording the
// operator asked for.

test("a query naming an artist ranks that artist's recording first", () => {
  const ranked = rankResults("way maker by sinach", [
    result({ id: "lrclib:2", title: "Way Maker", artist: "Some Cover Artist", popularity: 5000 }),
    result({ id: "genius:1", provider: "genius", title: "Way Maker", artist: "Sinach" }),
  ]);
  assert.equal(ranked[0].artist, "Sinach");
});

test("a mis-tagged record carrying the artist's name in its title does not win", () => {
  // Catalogues do produce these: title "Maker Live", artist "Sinach Way".
  const ranked = rankResults("way maker by sinach", [
    result({ id: "genius:9", provider: "genius", title: "Maker Live", artist: "Sinach Way" }),
    result({ id: "genius:1", provider: "genius", title: "Way Maker", artist: "Sinach" }),
  ]);
  assert.equal(ranked[0].title, "Way Maker");
});

test("the artist half of the query does not dilute title scoring", () => {
  // Scored against the whole string, "Way Maker" covers only half the query
  // and an unrelated fuller record can make up the difference.
  const ranked = rankResults("way maker by sinach", [
    result({ id: "lrclib:3", title: "Way Maker Medley Live Extended", artist: "Unrelated", lyrics: "x ".repeat(600) }),
    result({ id: "genius:1", provider: "genius", title: "Way Maker", artist: "Sinach" }),
  ]);
  assert.equal(ranked[0].artist, "Sinach");
});

test("a dashed query treats either side as the named artist", () => {
  const ranked = rankResults("Sinach - Way Maker", [
    result({ id: "lrclib:2", title: "Way Maker", artist: "Another Choir" }),
    result({ id: "genius:1", provider: "genius", title: "Way Maker", artist: "Sinach" }),
  ]);
  assert.equal(ranked[0].artist, "Sinach");
});

test("a plain title query still ranks on the title alone", () => {
  const ranked = rankResults("way maker", [
    result({ id: "lrclib:5", title: "Completely Different Song", artist: "Sinach" }),
    result({ id: "genius:1", provider: "genius", title: "Way Maker", artist: "Anyone" }),
  ]);
  assert.equal(ranked[0].title, "Way Maker");
});

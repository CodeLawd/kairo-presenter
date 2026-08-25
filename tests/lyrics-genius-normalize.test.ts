import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeSections,
  normalizeGeniusLyrics,
  normalizeSectionHeader,
  selectPrimaryLyricSegment,
} from "../src/main/services/lyrics/scraper";
import { isPerformanceCueLine } from "../src/main/services/lyrics/normalize";

// All lyric text below is invented placeholder content, not a real song.
const LINE_A = "Placeholder line one for the parser";
const LINE_B = "Placeholder line two for the parser";
const LINE_C = "Placeholder line three for the parser";

test("normalizeSectionHeader keeps supported labels intact", () => {
  assert.equal(normalizeSectionHeader("[Chorus]"), "[Chorus]");
  assert.equal(normalizeSectionHeader("[Verse 2]"), "[Verse 2]");
  assert.equal(normalizeSectionHeader("[Bridge]"), "[Bridge]");
  assert.equal(normalizeSectionHeader("[Pre-Chorus]"), "[Pre-Chorus]");
});

test("normalizeSectionHeader drops the Genius attribution suffix", () => {
  assert.equal(normalizeSectionHeader("[Chorus: Some Artist]"), "[Chorus]");
  assert.equal(normalizeSectionHeader("[Verse 2: Artist A & Artist B]"), "[Verse 2]");
});

test("normalizeSectionHeader maps Genius-only vocabulary onto supported types", () => {
  assert.equal(normalizeSectionHeader("[Refrain]"), "[Chorus]");
  assert.equal(normalizeSectionHeader("[Hook]"), "[Chorus]");
  assert.equal(normalizeSectionHeader("[Post-Chorus]"), "[Tag]");
  assert.equal(normalizeSectionHeader("[Vamp]"), "[Tag]");
});

test("normalizeSectionHeader never lets an unknown header through verbatim", () => {
  // An unmapped label must not survive as literal text, or it would be
  // projected as a lyric line.
  assert.equal(normalizeSectionHeader("[Spoken Word]"), "[Verse]");
  assert.equal(normalizeSectionHeader("[Skit]"), "[Verse]");
});

test("normalizeSectionHeader marks non-projectable sections for removal", () => {
  const drop = normalizeSectionHeader("[Instrumental]");
  assert.equal(normalizeSectionHeader("[Interlude]"), drop);
  assert.equal(normalizeSectionHeader("[Interludio]"), drop);
  assert.equal(normalizeSectionHeader("[Solo]"), drop);
  assert.notEqual(drop, "[Verse]");
});

test("normalizeGeniusLyrics discards non-projectable sections and their content", () => {
  const out = normalizeGeniusLyrics(
    `[Verse 1]\n${LINE_A}\n[Interlude]\n${LINE_B}\n[Chorus]\n${LINE_C}`,
  );
  assert.ok(out.includes(LINE_A));
  assert.ok(out.includes(LINE_C));
  assert.ok(!out.includes(LINE_B));
  assert.ok(!out.toLowerCase().includes("drop"));
});

test("normalizeSectionHeader ignores non-header lines", () => {
  assert.equal(normalizeSectionHeader(LINE_A), null);
  assert.equal(normalizeSectionHeader("Not [bracketed] fully"), null);
});

test("normalizeGeniusLyrics strips the trailing embed counter", () => {
  const out = normalizeGeniusLyrics(`[Verse 1]\n${LINE_A}\n${LINE_B}12345Embed`);
  assert.ok(!out.includes("Embed"));
  assert.ok(out.includes(LINE_B));
});

test("normalizeGeniusLyrics removes the interstitial recommendation text", () => {
  const out = normalizeGeniusLyrics(`[Verse 1]\n${LINE_A}\nYou might also like\n${LINE_B}`);
  assert.ok(!out.includes("You might also like"));
});

test("normalizeGeniusLyrics splits headers onto their own line", () => {
  const out = normalizeGeniusLyrics(`${LINE_A}[Chorus]${LINE_B}`);
  const lines = out.split("\n").filter(Boolean);
  assert.deepEqual(lines, [LINE_A, "[Chorus]", LINE_B]);
});

test("normalizeGeniusLyrics doubles stanza breaks when a page has no headers", () => {
  // Without markers the parser falls back to blank-line blocks, and its
  // splitter only breaks on two or more consecutive blank lines.
  const out = normalizeGeniusLyrics(`${LINE_A}\n\n${LINE_B}\n\n${LINE_C}`);
  assert.ok(out.includes(`${LINE_A}\n\n\n${LINE_B}`));
});

test("normalizeGeniusLyrics leaves single stanza breaks alone when headers exist", () => {
  const out = normalizeGeniusLyrics(`[Verse 1]\n${LINE_A}\n\n[Chorus]\n${LINE_B}`);
  assert.ok(!out.includes("\n\n\n"));
  assert.ok(out.includes("[Chorus]"));
});

test("normalizeGeniusLyrics chunks pages with no headers and no stanza breaks", () => {
  // Some pages are a flat run of line breaks with no structure at all. Without
  // chunking the whole song would land in a single unlabelled section.
  const flat = Array.from({ length: 10 }, (_, i) => `${LINE_A} ${i}`).join("\n");
  const out = normalizeGeniusLyrics(flat);

  const blocks = out.split(/\n{3,}/);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].split("\n").length, 4);
  assert.equal(blocks[2].split("\n").length, 2);
});

test("normalizeGeniusLyrics leaves a short header-less page as one block", () => {
  const out = normalizeGeniusLyrics(`${LINE_A}\n${LINE_B}`);
  assert.ok(!out.includes("\n\n"));
});

// ─── Non-English section vocabulary ───────────────────────────────────────────

test("normalizeSectionHeader maps Spanish section names", () => {
  assert.equal(normalizeSectionHeader("[Coro]"), "[Chorus]");
  assert.equal(normalizeSectionHeader("[Verso 2]"), "[Verse 2]");
  assert.equal(normalizeSectionHeader("[Puente]"), "[Bridge]");
  assert.equal(normalizeSectionHeader("[Estribillo]"), "[Chorus]");
});

test("normalizeSectionHeader folds accents before matching", () => {
  assert.equal(normalizeSectionHeader("[Refrão]"), "[Chorus]");
  assert.equal(normalizeSectionHeader("[Introdução]"), "[Intro]");
  assert.equal(normalizeSectionHeader("[Introducción]"), "[Intro]");
});

test("normalizeSectionHeader maps French section names", () => {
  assert.equal(normalizeSectionHeader("[Couplet 1]"), "[Verse 1]");
  assert.equal(normalizeSectionHeader("[Pont]"), "[Bridge]");
});

// ─── Section dedup ────────────────────────────────────────────────────────────

test("dedupeSections collapses repeats of an identical section", () => {
  const chorus = `[Chorus]\n${LINE_A}\n${LINE_B}`;
  const out = dedupeSections(`[Verse 1]\n${LINE_C}\n\n${chorus}\n\n${chorus}\n\n${chorus}`);

  assert.equal(out.match(/\[Chorus\]/g)?.length, 1);
  assert.ok(out.includes("[Verse 1]"));
});

test("dedupeSections keeps sections whose content differs", () => {
  const out = dedupeSections(
    `[Chorus]\n${LINE_A}\n\n[Chorus]\n${LINE_A}\n${LINE_B}`,
  );
  assert.equal(out.match(/\[Chorus\]/g)?.length, 2);
});

test("dedupeSections merges same-named sections that mostly overlap", () => {
  // Genius transcribes each repeat with its own ad-libs, so repeated sections
  // are near-identical rather than byte-identical.
  const first = `[Chorus]\n${LINE_A}\n${LINE_B}\n${LINE_C}`;
  const withAdLib = `[Chorus]\n${LINE_A}\n${LINE_B}\n${LINE_C}\n(Placeholder ad-lib)`;
  const out = dedupeSections(`${first}\n\n${withAdLib}`);

  assert.equal(out.match(/\[Chorus\]/g)?.length, 1);
  // The fuller take wins, so no line is lost.
  assert.ok(out.includes("(Placeholder ad-lib)"));
});

test("dedupeSections does not merge across different section names", () => {
  const out = dedupeSections(`[Chorus]\n${LINE_A}\n${LINE_B}\n\n[Outro]\n${LINE_A}\n${LINE_B}`);
  assert.ok(out.includes("[Chorus]"));
  assert.ok(out.includes("[Outro]"));
});

test("dedupeSections ignores case and punctuation when comparing", () => {
  const out = dedupeSections(`[Chorus]\n${LINE_A}\n\n[Chorus]\n${LINE_A.toUpperCase()}!`);
  assert.equal(out.match(/\[Chorus\]/g)?.length, 1);
});

test("dedupeSections drops empty sections", () => {
  const out = dedupeSections(`[Intro]\n\n[Verse 1]\n${LINE_A}\n\n[Interlude]`);
  assert.ok(!out.includes("[Intro]"));
  assert.ok(!out.includes("[Interlude]"));
  assert.ok(out.includes("[Verse 1]"));
});

test("dedupeSections distinguishes numbered bridges with different content", () => {
  const out = dedupeSections(
    `[Bridge 1]\n${LINE_A}\n\n[Bridge 1]\n${LINE_A}\n\n[Bridge 2]\n${LINE_B}`,
  );
  assert.equal(out.match(/\[Bridge 1\]/g)?.length, 1);
  assert.equal(out.match(/\[Bridge 2\]/g)?.length, 1);
});

test("normalizeGeniusLyrics dedupes through the full pipeline", () => {
  // Mirrors the arrangement shape Genius returns for modern worship songs.
  const raw = [
    `[Verse 1]`, LINE_A,
    `[Chorus]`, LINE_B,
    `[Verse 2]`, LINE_C,
    `[Chorus]`, LINE_B,
    `[Chorus]`, LINE_B,
  ].join("\n");

  const out = normalizeGeniusLyrics(raw);
  assert.equal(out.match(/\[Chorus\]/g)?.length, 1);
  assert.equal(out.match(/\[Verse 1\]/g)?.length, 1);
  assert.equal(out.match(/\[Verse 2\]/g)?.length, 1);
});

test("selectPrimaryLyricSegment keeps the titled song from a medley page", () => {
  // Genius live-set pages separate songs with empty lyric containers.
  const containers = [
    "Ijadopin ogun si tan\nOlugbala Jagun Molu\nHalleluyah",
    "",
    "Iro didun lorin Serah\nJesu Jesu Jesu",
    "",
    "Agbara esu da\nNibiti Jesu gbe n joba",
    "",
    "E tobi yeye e tobi yeye\nAye atorun o gbayin",
  ];
  const out = selectPrimaryLyricSegment(containers, "Ijadopin");
  assert.match(out, /Ijadopin ogun si tan/);
  assert.doesNotMatch(out, /Iro didun/);
  assert.doesNotMatch(out, /Agbara esu/);
  assert.doesNotMatch(out, /E tobi yeye/);
});

test("selectPrimaryLyricSegment joins multi-page single songs", () => {
  const containers = [
    `${LINE_A}\n${LINE_B}`,
    `${LINE_C}`,
  ];
  const out = selectPrimaryLyricSegment(containers, "Some Song");
  assert.equal(out, `${LINE_A}\n${LINE_B}\n${LINE_C}`);
});

test("selectPrimaryLyricSegment keeps both halves when only one empty gap exists", () => {
  // A single empty container is common layout noise mid-song — never truncate.
  const containers = [
    `Ijadopin ogun si tan\n${LINE_A}`,
    "",
    `${LINE_B}\n${LINE_C}`,
  ];
  const out = selectPrimaryLyricSegment(containers, "Ijadopin");
  assert.match(out, /Ijadopin/);
  assert.match(out, new RegExp(LINE_B));
  assert.match(out, new RegExp(LINE_C));
});

test("selectPrimaryLyricSegment keeps later verses that share vocabulary with the title segment", () => {
  const containers = [
    "Ijadopin ogun si tan\nOlugbala Jagun Molu\nOrin ayo la o ma ko",
    "",
    "Orin ayo la o ma ko\nOlugbala Jagun Molu\nHalleluyah eh",
    "",
    "Unrelated other song about rivers and mountains far away",
  ];
  const out = selectPrimaryLyricSegment(containers, "Ijadopin");
  assert.match(out, /Ijadopin/);
  assert.match(out, /Halleluyah eh/);
  assert.doesNotMatch(out, /rivers and mountains/);
});

test("isPerformanceCueLine drops stage directions", () => {
  assert.equal(isPerformanceCueLine("Instruments playing"), true);
  assert.equal(isPerformanceCueLine("END."), true);
  assert.equal(isPerformanceCueLine("Speaking in Tongues"), true);
  assert.equal(isPerformanceCueLine(LINE_A), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { cleanPageTitle } from "../src/main/services/lyrics/page-title";
import { needsWebResolution, queryVariants } from "../src/main/services/lyrics/online";
import { parsePageHeading, cleanScrapedLyrics } from "../src/main/services/lyrics/web-lyrics";
import type { ProviderResult } from "../src/main/services/lyrics/provider-types";

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

// ─── cleanPageTitle ───────────────────────────────────────────────────────────

test("cleanPageTitle strips download-site boilerplate and the site name", () => {
  assert.equal(
    cleanPageTitle("DOWNLOAD SONG: Nathaniel Bassey - Ese (Mp3 & Lyrics) | CeeNaija"),
    "Nathaniel Bassey Ese",
  );
});

test("cleanPageTitle strips lyric-site suffixes", () => {
  assert.equal(
    cleanPageTitle("Ese (Thank You) Lyrics – Nathaniel Bassey Ft Aidee Ime"),
    "Ese Nathaniel Bassey Ft Aidee Ime",
  );
});

test("cleanPageTitle handles a plain artist-title page name", () => {
  assert.equal(
    cleanPageTitle("Nathaniel Bassey feat. Aidee Ime - Ese - Live Lyrics | Musixmatch"),
    "Nathaniel Bassey feat. Aidee Ime Ese Live",
  );
});

test("cleanPageTitle collapses a title that is entirely boilerplate", () => {
  assert.equal(cleanPageTitle("Download Mp3 Lyrics | SomeSite"), "");
});

// ─── needsWebResolution ───────────────────────────────────────────────────────

test("tiny queries never spend a web lookup", () => {
  assert.equal(needsWebResolution("ab", []), false);
});

test("empty catalogue results trigger the web tier", () => {
  assert.equal(needsWebResolution("ami oluwa", []), true);
  assert.equal(needsWebResolution("odudu dabu jesus no", []), true);
});

test("unrelated catalogue noise still triggers the web tier", () => {
  const gathered = [
    result({ provider: "genius", title: "I Am", artist: "S.O.", lyrics: undefined }),
  ];
  assert.equal(needsWebResolution("ami oluwa", gathered), true);
});

test("a catalogue hit that already contains the line skips the web tier", () => {
  // Long enough that we trust the catalogue transcription is complete.
  const body = Array.from({ length: 40 }, (_, i) => `Placeholder line ${i}`).join("\n")
  const gathered = [result({ lyrics: `${body}\nEse! Ese! Ese o\nAnother line` })];
  assert.equal(needsWebResolution("ese ese ese o", gathered), false);
});

test("a strong title hit skips the web tier", () => {
  const gathered = [result({ title: "Amioluwa", artist: "Sunmisola Agbebi" })];
  assert.equal(needsWebResolution("ami oluwa", gathered), false);
});

// ─── queryVariants ────────────────────────────────────────────────────────────

test("queryVariants adds a collapsed compound form", () => {
  assert.deepEqual(queryVariants("ami oluwa"), ["ami oluwa", "amioluwa"]);
});

test("queryVariants leaves a single token alone", () => {
  assert.deepEqual(queryVariants("amioluwa"), ["amioluwa"]);
});

test("queryVariants does not collapse a long lyric line", () => {
  assert.deepEqual(queryVariants("odudu dabu jesus no"), ["odudu dabu jesus no"]);
});

// ─── web lyric page helpers ───────────────────────────────────────────────────

test("parsePageHeading extracts title and artist from AG-style headings", () => {
  assert.deepEqual(
    parsePageHeading("Odudu (Spirit) Lyrics by Theophilus Sunday | African Gospel Lyrics"),
    { title: "Odudu", artist: "Theophilus Sunday" },
  );
});

test("parsePageHeading handles 'Title Artist and Artist' without a by-clause", () => {
  const parsed = parsePageHeading(
    "Amioluwa (The Mark of God) Lyrics Sunmisola Agbebi and Yinka Okeleye",
  );
  assert.equal(parsed.title, "Amioluwa");
  assert.match(parsed.artist, /Sunmisola/i);
});

test("cleanScrapedLyrics expands inline glosses under each line", () => {
  const cleaned = cleanScrapedLyrics(
    "Odudu dabu Jesus no (There is no other Name like Jesus) x4\n\nRefrain:\nIde na lolu le (He made the lame walk)",
  );
  assert.match(cleaned, /Odudu dabu Jesus no/);
  assert.match(cleaned, /\(There is no other Name like Jesus\)/);
  assert.match(cleaned, /Ide na lolu le/);
  assert.match(cleaned, /\(He made the lame walk\)/);
  assert.match(cleaned, /\[Chorus\]/);
});

test("cleanScrapedLyrics splits jammed double-space phrases onto rows", () => {
  const cleaned = cleanScrapedLyrics(
    "Ide na lolu le  Ide noku daji  Odu Jesus nana tumale",
  );
  assert.equal(
    cleaned,
    "Ide na lolu le\nIde noku daji\nOdu Jesus nana tumale",
  );
});

test("cleanScrapedLyrics maps Spoken and Bridge labels", () => {
  const cleaned = cleanScrapedLyrics("Spoken:\nHello\n\nBridge:\nPower belongs to Jesus");
  assert.match(cleaned, /\[Verse\]/);
  assert.match(cleaned, /\[Bridge\]/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { cleanPageTitle } from "../src/main/services/lyrics/page-title";
import { needsWebResolution, queryVariants } from "../src/main/services/lyrics/online";
import { parsePageHeading, cleanScrapedLyrics } from "../src/main/services/lyrics/web-lyrics";
import {
  looksLikeChallenge,
  parseDuckHtml,
  parseMojeekHtml,
} from "../src/main/services/lyrics/snippet-resolver";
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

// ─── keyless web engines ──────────────────────────────────────────────────────
// Every keyless engine rate-limits and serves captchas to unattended requests,
// so the tier tries several. These are the two ways that goes wrong: a
// challenge page that still parses, and a redirect-wrapped result URL.

test("a captcha page is not mistaken for results", () => {
  assert.equal(looksLikeChallenge("<html><head><title>Captcha</title></head><body>x</body></html>"), true);
  assert.equal(
    looksLikeChallenge("<html><head><title>Just a moment...</title></head><body/></html>"),
    true,
  );
  assert.equal(
    looksLikeChallenge("<html><body>Enable JavaScript and cookies to continue</body></html>"),
    true,
  );
  assert.equal(looksLikeChallenge("<html><head><title>song lyrics - Search</title></head></html>"), false);
});

test("DuckDuckGo redirect links are unwrapped to the real page", () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fhymnary.org%2Ftext%2Fsome_hymn&rut=x">Some Hymn</a>
  `;
  assert.deepEqual(parseDuckHtml(html), [
    { title: "Some Hymn", url: "https://hymnary.org/text/some_hymn" },
  ]);
});

test("search-engine and social links are never offered as lyrics pages", () => {
  const html = `
    <a class="result__a" href="https://duckduckgo.com/settings">Settings</a>
    <a class="result__a" href="https://www.youtube.com/watch?v=1">Video</a>
    <a class="result__a" href="https://www.hymnal.net/song">Real page</a>
  `;
  assert.deepEqual(parseDuckHtml(html).map((r) => r.url), ["https://www.hymnal.net/song"]);
});

test("Mojeek results come from its hit list, not its chrome", () => {
  const html = `
    <a href="https://www.mojeek.com/about">About</a>
    <ul class="results-standard">
      <li><h2><a href="https://gospellyrics.example/song">A Song</a></h2></li>
    </ul>
  `;
  assert.deepEqual(parseMojeekHtml(html), [
    { title: "A Song", url: "https://gospellyrics.example/song" },
  ]);
});

test("a dashed page heading splits into artist and title", () => {
  // Lyric blogs and Genius slugs both put the artist first. Left whole, the
  // same song appears twice — once parsed, once as one long title.
  assert.deepEqual(parsePageHeading("Some Artist - A Song Title"), {
    title: "A Song Title",
    artist: "Some Artist",
  });
  assert.deepEqual(parsePageHeading("Some Artist \u2013 A Song Title Lyrics"), {
    title: "A Song Title",
    artist: "Some Artist",
  });
});

test("a hyphenated title without spaces is not split", () => {
  assert.equal(parsePageHeading("Wonder-Working God").title, "Wonder-Working God");
});

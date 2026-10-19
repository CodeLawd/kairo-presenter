import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OVERLAY_THEME,
  DEFAULT_OVERLAY_SETTINGS,
  makeOverlayOutput,
  normalizeOverlayOutputs,
  normalizeOverlaySettings,
} from "../src/lib/overlay-defaults";
import {
  hasContentOverride,
  inheritLyricsTheme,
  isRenderedKind,
  liveOverlayTheme,
  MAX_NDI_OUTPUTS,
  outputTemplateFor,
  outputThemeFor,
  outputThemeIdFor,
  setContentOverride,
  withContentPatch,
} from "../src/lib/overlay-outputs";
import { themeForPush, withoutBackground } from "../src/lib/media-playback";
import { createOverlayElement } from "../src/lib/overlay-elements";

const legacy = {
  mode: "auto" as const,
  ppVideoInputUuid: "uuid-1",
  theme: DEFAULT_OVERLAY_THEME,
  template: "{Reference}\n{Text}",
};

test("legacy modes migrate only independent destinations", () => {
  for (const mode of ["auto", "ndi", "message"] as const) {
    const outputs = normalizeOverlayOutputs(undefined, { ...legacy, mode });
    assert.deepEqual(outputs.map(o => o.kind), ["ndi", "screen"]);
    assert.equal(outputs[0].enabled, mode !== "message");
    assert.equal(outputs[1].enabled, false);
  }
});

// ─── Normalizer invariants ────────────────────────────────────────────────────

test("NDI outputs beyond the sender limit are disabled, not deleted — the operator's config survives", () => {
  const ndi = Array.from({ length: MAX_NDI_OUTPUTS + 1 }, (_, i) =>
    makeOverlayOutput(`ndi-${i}`, "ndi", { enabled: true }),
  );
  const outputs = normalizeOverlayOutputs([...ndi, makeOverlayOutput("card", "device", { enabled: true })], legacy);

  assert.deepEqual(outputs.map((o) => o.id), [...ndi.map((o) => o.id), "card"]);
  assert.deepEqual(
    outputs.filter((o) => o.kind === "ndi").map((o) => o.enabled),
    [...Array(MAX_NDI_OUTPUTS).fill(true), false],
  );
});

test("duplicate, blank and unknown-kind entries are healed rather than trusted", () => {
  const outputs = normalizeOverlayOutputs(
    [
      { id: "a", kind: "screen", enabled: true },
      { id: "a", kind: "screen", enabled: true },   // duplicate id
      { id: "", kind: "screen" },                    // blank id
      { id: "b", kind: "teleport", enabled: true }, // unknown kind
      "not an object",
    ],
    legacy,
  );

  assert.deepEqual(outputs.map((o) => o.id), ["a"]);
});

test("an empty saved list gets the Main Screen back; missing output lists migrate", () => {
  // Audience always has one screen, as in ProPresenter.
  assert.deepEqual(normalizeOverlayOutputs([], legacy).map((o) => [o.kind, o.name]), [["screen", "Main Screen"]]);
  assert.ok(normalizeOverlayOutputs("nope", legacy).length > 0);
  assert.ok(normalizeOverlayOutputs(null, legacy).length > 0);
});

test("each output's theme is clamped through the theme normalizer", () => {
  const [output] = normalizeOverlayOutputs(
    [{ id: "main", kind: "ndi", theme: { verse: { fontSizePx: 9999, color: "javascript:alert(1)" } } }],
    legacy,
  );

  assert.equal(output.theme.verse.fontSizePx, 200); // clamped to the 12–200 range
  assert.equal(output.theme.verse.color, DEFAULT_OVERLAY_THEME.verse.color);
});

test("normalization strips retired settings and output fields", () => {
  const settings = normalizeOverlaySettings({ mode: "ndi", ppVideoInputUuid: "uuid-9", outputs: [
    { id: "feed", kind: "ndi", enabled: true, ppVideoInputUuid: "uuid-9", lookId: "look-1" },
    { id: "old", kind: "message", enabled: true },
  ] });
  assert.deepEqual(settings.outputs.map(o => o.id), ["feed"]);
  for (const key of ["mode", "ppVideoInputUuid"]) assert.equal(Object.hasOwn(settings, key), false);
  for (const key of ["ppVideoInputUuid", "lookId"]) assert.equal(Object.hasOwn(settings.outputs[0], key), false);
});

test("live overlay theme prefers the enabled NDI output over a disabled one", () => {
  const enabledTheme = {
    ...DEFAULT_OVERLAY_THEME,
    verse: { ...DEFAULT_OVERLAY_THEME.verse, color: "#ff0000" },
  };
  const overlay = {
    ...DEFAULT_OVERLAY_SETTINGS,
    outputs: [
      makeOverlayOutput("off", "ndi", { enabled: false, theme: DEFAULT_OVERLAY_THEME }),
      makeOverlayOutput("on", "ndi", { enabled: true, theme: enabledTheme }),
    ],
  };

  assert.equal(liveOverlayTheme(overlay).verse.color, "#ff0000");
});

// ─── Per-content-kind overrides ───────────────────────────────────────────────

const RED_THEME = {
  ...DEFAULT_OVERLAY_THEME,
  verse: { ...DEFAULT_OVERLAY_THEME.verse, color: "#ff0000" },
};

test("an output with no override resolves lyrics to its scripture theme and template", () => {
  const output = makeOverlayOutput("main", "ndi", { theme: RED_THEME, template: "{Text}" });

  assert.equal(hasContentOverride(output, "lyrics"), false);
  assert.equal(outputThemeFor(output, "lyrics").verse.color, "#ff0000");
  assert.equal(outputTemplateFor(output, "lyrics"), "{Text}");
});

test("lyrics inheriting scripture do not take Fit to box with them", () => {
  const fitted = {
    ...RED_THEME,
    layout: { ...RED_THEME.layout, autoFitText: true },
  };
  const output = makeOverlayOutput("main", "ndi", { theme: fitted });

  assert.equal(outputThemeFor(output, "scripture").layout.autoFitText, true);
  assert.equal(outputThemeFor(output, "lyrics").layout.autoFitText, false);
  assert.equal(outputThemeFor(output, "lyrics").verse.color, "#ff0000");
  assert.equal(inheritLyricsTheme(fitted).layout.autoFitText, false);
});

test("lyrics inheriting scripture leave its backdrop and elements behind", () => {
  const boxed = {
    ...RED_THEME,
    elements: [createOverlayElement("rectangle", undefined, "logo")],
    layout: { ...RED_THEME.layout, backdropBox: true },
  };
  const output = makeOverlayOutput("main", "ndi", { theme: boxed });

  assert.equal(outputThemeFor(output, "scripture").layout.backdropBox, true);
  assert.equal(outputThemeFor(output, "scripture").elements.length, 1);
  assert.equal(outputThemeFor(output, "lyrics").layout.backdropBox, false);
  assert.deepEqual(outputThemeFor(output, "lyrics").elements, []);
  // Turning the lyrics override on seeds from the same clean look.
  const override = setContentOverride(output, "lyrics", true);
  assert.equal(outputThemeFor(override, "lyrics").layout.backdropBox, false);
  assert.deepEqual(outputThemeFor(override, "lyrics").elements, []);
});

test("a new theme has no backdrop box until the operator adds one", () => {
  assert.equal(DEFAULT_OVERLAY_THEME.layout.backdropBox, false);
});

test("an applied lyrics theme keeps its own Fit to box", () => {
  const lyricsTheme = {
    ...DEFAULT_OVERLAY_THEME,
    layout: { ...DEFAULT_OVERLAY_THEME.layout, autoFitText: true },
  };
  const output = withContentPatch(
    setContentOverride(makeOverlayOutput("main", "ndi"), "lyrics", true),
    "lyrics",
    { themeId: "lyrics-stage", theme: lyricsTheme },
  );

  assert.equal(outputThemeFor(output, "lyrics").layout.autoFitText, true);
  assert.equal(outputThemeFor(output, "scripture").layout.autoFitText, false);
});

test("seeding a lyrics override does not copy scripture Fit to box", () => {
  const fitted = {
    ...RED_THEME,
    layout: { ...RED_THEME.layout, autoFitText: true },
  };
  const output = setContentOverride(
    makeOverlayOutput("main", "ndi", { theme: fitted, themeId: "theme-1" }),
    "lyrics",
    true,
  );

  assert.equal(outputThemeFor(output, "lyrics").layout.autoFitText, false);
  assert.equal(outputThemeFor(output, "scripture").layout.autoFitText, true);
});

test("enabling the lyrics override seeds styling from scripture but drops the citation", () => {
  const base = makeOverlayOutput("main", "ndi", {
    theme: RED_THEME,
    themeId: "theme-1",
    template: "{Reference}\n{Text}",
  });
  const output = setContentOverride(base, "lyrics", true);

  assert.equal(hasContentOverride(output, "lyrics"), true);
  assert.equal(outputThemeFor(output, "lyrics").verse.color, "#ff0000");
  assert.equal(outputThemeIdFor(output, "lyrics"), "theme-1");

  // A lyric slide has no reference to print — neither layer nor token.
  assert.equal(outputThemeFor(output, "lyrics").reference.show, false);
  assert.equal(outputTemplateFor(output, "lyrics"), "{Text}");
  // ...and the scripture side keeps both.
  assert.equal(outputThemeFor(output, "scripture").reference.show, true);
  assert.equal(outputTemplateFor(output, "scripture"), "{Reference}\n{Text}");
});

test("applying a theme to one output leaves every other output's theme untouched", () => {
  const main = makeOverlayOutput("main", "ndi", { theme: DEFAULT_OVERLAY_THEME });
  const spare = makeOverlayOutput("spare", "ndi", { theme: DEFAULT_OVERLAY_THEME });
  const outputs = [main, spare].map((output) =>
    output.id !== "main"
      ? output
      : withContentPatch(output, "scripture", { theme: structuredClone(RED_THEME) }),
  );

  assert.equal(outputs[1], spare);
  assert.equal(outputThemeFor(outputs[0], "scripture").verse.color, "#ff0000");
  assert.equal(outputThemeFor(outputs[1], "scripture").verse.color, DEFAULT_OVERLAY_THEME.verse.color);
});

test("editing the lyrics override leaves the scripture config untouched", () => {
  const base = setContentOverride(
    makeOverlayOutput("main", "ndi", { theme: DEFAULT_OVERLAY_THEME, template: "{Reference}" }),
    "lyrics",
    true,
  );
  const output = withContentPatch(base, "lyrics", { theme: RED_THEME, template: "{Text}" });

  assert.equal(outputThemeFor(output, "lyrics").verse.color, "#ff0000");
  assert.equal(outputTemplateFor(output, "lyrics"), "{Text}");
  assert.equal(outputThemeFor(output, "scripture").verse.color, DEFAULT_OVERLAY_THEME.verse.color);
  assert.equal(outputTemplateFor(output, "scripture"), "{Reference}");
});

test("a scripture patch writes the base fields even when a lyrics override exists", () => {
  const base = setContentOverride(makeOverlayOutput("main", "ndi"), "lyrics", true);
  const output = withContentPatch(base, "scripture", { template: "{Reference}" });

  assert.equal(outputTemplateFor(output, "scripture"), "{Reference}");
  assert.equal(hasContentOverride(output, "lyrics"), true);
});

test("turning the override off returns lyrics to the scripture theme", () => {
  const withOverride = withContentPatch(
    setContentOverride(makeOverlayOutput("main", "ndi"), "lyrics", true),
    "lyrics",
    { theme: RED_THEME },
  );
  const output = setContentOverride(withOverride, "lyrics", false);

  assert.equal(output.lyrics, null);
  assert.equal(outputThemeFor(output, "lyrics").verse.color, DEFAULT_OVERLAY_THEME.verse.color);
});

test("liveOverlayTheme answers per content kind", () => {
  const overlay = {
    ...DEFAULT_OVERLAY_SETTINGS,
    outputs: [
      withContentPatch(
        setContentOverride(
          makeOverlayOutput("on", "ndi", { enabled: true, theme: DEFAULT_OVERLAY_THEME }),
          "lyrics",
          true,
        ),
        "lyrics",
        { theme: RED_THEME },
      ),
    ],
  };

  assert.equal(liveOverlayTheme(overlay, "scripture").verse.color, DEFAULT_OVERLAY_THEME.verse.color);
  assert.equal(liveOverlayTheme(overlay, "lyrics").verse.color, "#ff0000");
});

test("a stored lyrics override survives normalization; an absent one stays null", () => {
  const [withOverride, without] = normalizeOverlayOutputs(
    [
      { id: "a", kind: "ndi", lyrics: { themeId: "t", theme: RED_THEME, template: "{Text}" } },
      { id: "b", kind: "screen" },
    ],
    legacy,
  );

  assert.equal(withOverride.lyrics?.template, "{Text}");
  assert.equal(withOverride.lyrics?.theme.verse.color, "#ff0000");
  assert.equal(without.lyrics, null);
});

test("normalizing a lyrics override keeps its own background", () => {
  const [output] = normalizeOverlayOutputs(
    [
      {
        id: "a",
        kind: "ndi",
        lyrics: {
          themeId: "t",
          theme: {
            ...RED_THEME,
            background: { ...DEFAULT_OVERLAY_THEME.background, type: "video", mediaPath: "/tmp/loop.mp4" },
          },
          template: "{Text}",
        },
      },
    ],
    legacy,
  );

  assert.equal(output.lyrics?.theme.background.type, "video");
  assert.equal(output.lyrics?.theme.verse.color, "#ff0000");
});

test("seeding a lyrics override strips a background inherited from scripture", () => {
  const base = makeOverlayOutput("main", "ndi", {
    theme: {
      ...DEFAULT_OVERLAY_THEME,
      background: { ...DEFAULT_OVERLAY_THEME.background, type: "gradient" as const },
    },
  });
  const output = setContentOverride(base, "lyrics", true);

  assert.equal(outputThemeFor(output, "lyrics").background.type, "transparent");
  assert.equal(outputThemeFor(output, "scripture").background.type, "gradient");
});

test("a lyrics theme with a background renders with it", () => {
  // Song themes can own a background, like scripture themes; the dock loop
  // only fills in for one that has none (themeForPush).
  const output = withContentPatch(
    setContentOverride(makeOverlayOutput("main", "ndi"), "lyrics", true),
    "lyrics",
    {
      theme: {
        ...DEFAULT_OVERLAY_THEME,
        background: {
          ...DEFAULT_OVERLAY_THEME.background,
          type: "image",
          mediaPath: "/tmp/theme-bg.png",
        },
      },
    },
  );

  assert.equal(outputThemeFor(output, "lyrics").background.type, "image");
});

// ─── Kairo screens (standalone phase 1) ───────────────────────────────────────

test("screen outputs are accepted and display fields are filled on every kind", () => {
  const outputs = normalizeOverlayOutputs(
    [
      { id: "proj", kind: "screen", enabled: true, displayId: 7, displayLabel: " DELL ", displaySize: { width: 1920, height: 1080 } },
      { id: "feed", kind: "ndi", displayId: 7, displayLabel: "junk" },
    ],
    legacy,
  );
  assert.equal(outputs[0].kind, "screen");
  assert.equal(outputs[0].displayId, 7);
  assert.equal(outputs[0].displayLabel, "DELL");
  assert.deepEqual(outputs[0].displaySize, { width: 1920, height: 1080 });
  // Display fields mean nothing off a screen output — kept uniform, not trusted.
  assert.equal(outputs[1].displayId, null);
  assert.equal(outputs[1].displayLabel, "");
  assert.equal(outputs[1].displaySize, null);
});

test("an invalid displayId or size heals to null", () => {
  for (const displayId of ["7", 1.5, NaN, Infinity, null, undefined]) {
    const [output] = normalizeOverlayOutputs([{ id: "p", kind: "screen", displayId }], legacy);
    assert.equal(output.displayId, null, String(displayId));
  }
  const [output] = normalizeOverlayOutputs(
    [{ id: "p", kind: "screen", displaySize: { width: -1, height: 1080 } }],
    legacy,
  );
  assert.equal(output.displaySize, null);
});

test("a second enabled screen on the same display is disabled, not deleted", () => {
  const outputs = normalizeOverlayOutputs(
    [
      makeOverlayOutput("a", "screen", { enabled: true, displayId: 3 }),
      makeOverlayOutput("b", "screen", { enabled: true, displayId: 3 }),
      makeOverlayOutput("c", "screen", { enabled: true, displayId: 4 }),
    ],
    legacy,
  );
  assert.deepEqual(outputs.map((o) => [o.id, o.enabled]), [["a", true], ["b", false], ["c", true]]);
});

test("explicit output lists do not recreate a removed Projector; legacy migrations still include it", () => {
  const once = normalizeOverlayOutputs([makeOverlayOutput("main", "ndi", { enabled: true })], legacy);
  assert.equal(once.some((o) => o.kind === "screen"), false);
  const twice = normalizeOverlayOutputs(once, legacy);
  assert.equal(twice.filter((o) => o.kind === "screen").length, 0);
  // Fresh installs and legacy migrations carry it too, still off.
  const migrated = normalizeOverlayOutputs(undefined, legacy);
  assert.equal(migrated.filter((o) => o.kind === "screen" && !o.enabled).length, 1);
});

test("liveOverlayTheme prefers an enabled screen, then an enabled NDI output", () => {
  const screenTheme = { ...DEFAULT_OVERLAY_THEME, verse: { ...DEFAULT_OVERLAY_THEME.verse, color: "#00ff00" } };
  const overlay = {
    ...DEFAULT_OVERLAY_SETTINGS,
    outputs: [
      makeOverlayOutput("main", "ndi", { enabled: true, theme: RED_THEME }),
      makeOverlayOutput("projector", "screen", { enabled: true, theme: screenTheme }),
    ],
  };
  assert.equal(liveOverlayTheme(overlay).verse.color, "#00ff00");
  const screenOff = {
    ...overlay,
    outputs: overlay.outputs.map((o) => (o.kind === "screen" ? { ...o, enabled: false } : o)),
  };
  assert.equal(liveOverlayTheme(screenOff).verse.color, "#ff0000");
});

test("playlist fields are clamped, and NDI always follows the program", () => {
  const [screen, ndi] = normalizeOverlayOutputs(
    [
      { ...makeOverlayOutput("lobby", "screen"), source: "playlist", playlistId: " p1 ", slideSec: 1 },
      { ...makeOverlayOutput("feed", "ndi"), source: "playlist", playlistId: "p1", slideSec: 9999 },
    ],
    legacy,
  );
  assert.equal(screen.source, "playlist");
  assert.equal(screen.playlistId, "p1");
  assert.equal(screen.slideSec, 3);
  assert.equal(ndi.source, "program");
  assert.equal(ndi.playlistId, "");
  assert.equal(normalizeOverlayOutputs([{ ...makeOverlayOutput("s", "screen"), source: "bogus" }], legacy)[0].source, "program");
});

test("withoutBackground drops any background so text sits on black", () => {
  const theme = {
    ...DEFAULT_OVERLAY_THEME,
    background: { ...DEFAULT_OVERLAY_THEME.background, type: "video" as const, mediaPath: "/clip.mp4" },
  };
  assert.equal(withoutBackground(theme).background.type, "transparent");
  assert.equal(withoutBackground(theme).verse, theme.verse);
});

test("themeForPush: backgrounds off strips, own background wins unless forced", () => {
  const live = { kind: "video" as const, path: "/loop.mp4" };
  const owned = { ...DEFAULT_OVERLAY_THEME, background: { ...DEFAULT_OVERLAY_THEME.background, type: "color" as const } };
  const bare = { ...DEFAULT_OVERLAY_THEME, background: { ...DEFAULT_OVERLAY_THEME.background, type: "transparent" as const } };
  assert.equal(themeForPush(owned, { showsBackgrounds: false, live }).background.type, "transparent");
  assert.equal(themeForPush(owned, { showsBackgrounds: true, live }).background.type, "color");
  assert.equal(themeForPush(owned, { showsBackgrounds: true, live, force: true }).background.mediaPath, "/loop.mp4");
  assert.equal(themeForPush(bare, { showsBackgrounds: true, live }).background.type, "video");
  assert.equal(themeForPush(bare, { showsBackgrounds: true, live: null }), bare);
});

test('retired auto-clear values are discarded from saved overlay settings', () => {
  const settings = normalizeOverlaySettings({ ...DEFAULT_OVERLAY_SETTINGS, autoClearSec: 15 });
  assert.equal(Object.hasOwn(settings, 'autoClearSec'), false);
  assert.equal(Object.hasOwn(DEFAULT_OVERLAY_SETTINGS, 'autoClearSec'), false);
});

test('Syphon outputs are kept when settings load, with at most four switched on', () => {
  const outputs = Array.from({ length: 6 }, (_, i) => ({ id: `syphon-${i}`, kind: 'syphon', name: `Syphon ${i}`, enabled: true }))
  const normalized = normalizeOverlaySettings({ outputs }).outputs.filter((o) => o.kind === 'syphon')
  assert.equal(normalized.length, 6, 'every Syphon output is kept')
  assert.equal(normalized.filter((o) => o.enabled).length, 4, 'the fifth and sixth are switched off')
  assert.ok(isRenderedKind('syphon'), 'Kairo renders Syphon outputs itself')
})

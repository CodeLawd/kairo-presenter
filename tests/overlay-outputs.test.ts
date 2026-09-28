import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OVERLAY_THEME,
  DEFAULT_OVERLAY_SETTINGS,
  applyOutputRoute,
  makeOverlayOutput,
  normalizeOverlayOutputs,
  normalizeOverlaySettings,
  outputRouteOf,
} from "../src/lib/overlay-defaults";
import {
  hasContentOverride,
  inheritLyricsTheme,
  themeForContentKind,
  liveOverlayTheme,
  MAX_NDI_OUTPUTS,
  outputTemplateFor,
  outputThemeFor,
  outputThemeIdFor,
  setContentOverride,
  withContentPatch,
} from "../src/lib/overlay-outputs";

const legacy = {
  mode: "auto" as const,
  ppVideoInputUuid: "uuid-1",
  theme: DEFAULT_OVERLAY_THEME,
  template: "{Reference}\n{Text}",
};

// ─── Legacy migration ─────────────────────────────────────────────────────────
// Each pre-phase-3 mode must come out as the same sequence of destinations it
// used to walk, or upgrading users lose their output.

test("auto mode migrates to NDI, then library, then the message overlay as fallback", () => {
  const outputs = normalizeOverlayOutputs(undefined, legacy);
  const enabled = outputs.filter((o) => o.enabled);

  // Precedence must match the shipped getOverlayDispatchOrder("auto"),
  // which was ["ndi", "library", "message"] — NDI ahead of the library scan.
  assert.deepEqual(enabled.map((o) => o.kind), ["ndi", "library", "message"]);
  const [ndi, library] = enabled;
  assert.ok(ndi.order < library.order, "NDI must sort ahead of the library scan");
  assert.equal(enabled.find((o) => o.kind === "message")?.fallbackOnly, true);
  assert.equal(enabled.find((o) => o.kind === "ndi")?.ppVideoInputUuid, "uuid-1");
});

test("ndi mode migrates without the library search", () => {
  const outputs = normalizeOverlayOutputs(undefined, { ...legacy, mode: "ndi" });

  assert.deepEqual(
    outputs.filter((o) => o.enabled).map((o) => o.kind),
    ["ndi", "message"],
  );
  assert.equal(outputs.find((o) => o.kind === "library")?.enabled, false);
});

test("message mode migrates to library then message, never NDI", () => {
  const outputs = normalizeOverlayOutputs(undefined, { ...legacy, mode: "message" });

  assert.deepEqual(
    outputs.filter((o) => o.enabled).map((o) => o.kind),
    ["library", "message"],
  );
  assert.equal(outputs.find((o) => o.kind === "ndi")?.enabled, false);
});

test("every migration offers a stage output, switched off so upgrades change nothing", () => {
  for (const mode of ["auto", "ndi", "message"] as const) {
    const stage = normalizeOverlayOutputs(undefined, { ...legacy, mode })
      .find((o) => o.kind === "stage");
    assert.ok(stage, `${mode} should offer a stage output`);
    assert.equal(stage.enabled, false);
  }
});

// ─── Normalizer invariants ────────────────────────────────────────────────────

test("NDI outputs beyond the sender limit are disabled, not deleted — the operator's config survives", () => {
  const ndi = Array.from({ length: MAX_NDI_OUTPUTS + 1 }, (_, i) =>
    makeOverlayOutput(`ndi-${i}`, "ndi", { enabled: true }),
  );
  const outputs = normalizeOverlayOutputs([...ndi, makeOverlayOutput("stage", "stage", { enabled: true })], legacy);

  // `projector` is the disabled Kairo screen every older store is given.
  assert.deepEqual(outputs.map((o) => o.id), [...ndi.map((o) => o.id), "stage", "projector"]);
  assert.deepEqual(
    outputs.filter((o) => o.kind === "ndi").map((o) => o.enabled),
    [...Array(MAX_NDI_OUTPUTS).fill(true), false],
  );
});

test("duplicate, blank and unknown-kind entries are healed rather than trusted", () => {
  const outputs = normalizeOverlayOutputs(
    [
      { id: "a", kind: "stage", enabled: true },
      { id: "a", kind: "stage", enabled: true },   // duplicate id
      { id: "", kind: "stage" },                    // blank id
      { id: "b", kind: "teleport", enabled: true }, // unknown kind
      "not an object",
    ],
    legacy,
  );

  assert.deepEqual(outputs.map((o) => o.id), ["a", "b", "projector"]);
  assert.equal(outputs[1].kind, "message");
});

test("an empty or non-array outputs value falls back to the migration, never to nothing", () => {
  assert.ok(normalizeOverlayOutputs([], legacy).length > 0);
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

test("normalizeOverlaySettings populates outputs and keeps the legacy fields readable", () => {
  const settings = normalizeOverlaySettings({ mode: "ndi", ppVideoInputUuid: "uuid-9" });

  assert.equal(settings.outputs.some((o) => o.kind === "ndi" && o.enabled), true);
  assert.equal(settings.outputs.find((o) => o.kind === "ndi")?.ppVideoInputUuid, "uuid-9");
  assert.equal(settings.mode, "ndi");
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
      { id: "b", kind: "message" },
    ],
    legacy,
  );

  assert.equal(withOverride.lyrics?.template, "{Text}");
  assert.equal(withOverride.lyrics?.theme.verse.color, "#ff0000");
  assert.equal(without.lyrics, null);
});

test("normalizing a lyrics override strips a baked-in background", () => {
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

  assert.equal(output.lyrics?.theme.background.type, "transparent");
  assert.equal(output.lyrics?.theme.verse.color, "#ff0000");
});

test("a lyrics theme can never carry a background", () => {
  const withImage = {
    ...DEFAULT_OVERLAY_THEME,
    background: { ...DEFAULT_OVERLAY_THEME.background, type: "image" as const, mediaPath: "/tmp/a.png" },
  };

  // Backgrounds change every song, so they are pushed live rather than saved
  // into a theme — a lyrics theme is text only.
  assert.equal(themeForContentKind(withImage, "lyrics").background.type, "transparent");
  // Scripture is untouched.
  assert.equal(themeForContentKind(withImage, "scripture").background.type, "image");
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

test("a stored lyrics override cannot keep a scripture background", () => {
  // Apply-to-output used to write the draft as-is, so a scripture image could
  // land in the lyrics slot. Resolve time must still strip it, or a lyric
  // push replaces the dock loop with that image.
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

  assert.equal(output.lyrics?.theme.background.type, "image");
  assert.equal(outputThemeFor(output, "lyrics").background.type, "transparent");
});

// ─── Kairo screens (standalone phase 1) ───────────────────────────────────────

test("screen outputs are accepted and display fields are filled on every kind", () => {
  const outputs = normalizeOverlayOutputs(
    [
      { id: "proj", kind: "screen", enabled: true, displayId: 7, displayLabel: " DELL ", displaySize: { width: 1920, height: 1080 } },
      { id: "stage", kind: "stage", displayId: 7, displayLabel: "junk" },
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

test("an older store gets one disabled Projector output — once", () => {
  const once = normalizeOverlayOutputs([makeOverlayOutput("main", "ndi", { enabled: true })], legacy);
  const projector = once.find((o) => o.id === "projector")!;
  assert.equal(projector.kind, "screen");
  assert.equal(projector.enabled, false);
  const twice = normalizeOverlayOutputs(once, legacy);
  assert.equal(twice.filter((o) => o.kind === "screen").length, 1);
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

test("the onboarding route switches outputs on and off, and reads back", () => {
  const defaults = DEFAULT_OVERLAY_SETTINGS.outputs;
  // A fresh install draws on its own screen; ProPresenter is opt-in.
  assert.equal(outputRouteOf(defaults), "screen");
  assert.deepEqual(defaults.filter((o) => o.enabled).map((o) => o.id), ["projector"]);

  const pp = applyOutputRoute(defaults, "propresenter");
  assert.equal(outputRouteOf(pp), "propresenter");
  // Nothing PP-side was on, so the shipped ProPresenter preset comes on.
  assert.deepEqual(pp.filter((o) => o.enabled).map((o) => o.id).sort(), ["library", "lower-third", "main"]);

  const back = applyOutputRoute(pp, "screen");
  assert.equal(outputRouteOf(back), "screen");
  assert.deepEqual(back.filter((o) => o.enabled).map((o) => o.id), ["projector"]);

  assert.equal(outputRouteOf(applyOutputRoute(defaults, "both")), "both");
});

test("playlist fields are clamped, and only a screen can run its own playlist", () => {
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

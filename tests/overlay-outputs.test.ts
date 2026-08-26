import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OVERLAY_THEME,
  DEFAULT_OVERLAY_SETTINGS,
  makeOverlayOutput,
  normalizeOverlayOutputs,
  normalizeOverlaySettings,
} from "../src/lib/overlay-defaults";
import { liveOverlayTheme } from "../src/lib/overlay-outputs";

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

test("a second NDI output is disabled, not deleted — the operator's config survives", () => {
  const outputs = normalizeOverlayOutputs(
    [
      makeOverlayOutput("main", "ndi", { enabled: true }),
      makeOverlayOutput("second", "ndi", { enabled: true }),
      makeOverlayOutput("stage", "stage", { enabled: true }),
    ],
    legacy,
  );

  assert.deepEqual(outputs.map((o) => o.id), ["main", "second", "stage"]);
  assert.equal(outputs[0].enabled, true);
  assert.equal(outputs[1].enabled, false);
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

  assert.deepEqual(outputs.map((o) => o.id), ["a", "b"]);
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

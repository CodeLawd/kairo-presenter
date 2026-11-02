import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATOR_PANEL_BOUNDS,
  OPERATOR_PANEL_DEFAULTS,
  normalizeOperatorPanelWidth,
  resizeOperatorPanel,
} from "../src/lib/operator-layout";

test("left resize follows the pointer and stays inside its usable bounds", () => {
  assert.equal(resizeOperatorPanel("left", 280, 45), 325);
  assert.equal(resizeOperatorPanel("left", 280, -200), 180);
  assert.equal(resizeOperatorPanel("left", 400, 100), 420);
});

test("right resize moves opposite the pointer and stays inside its usable bounds", () => {
  assert.equal(resizeOperatorPanel("right", 440, -10), 450);
  assert.equal(resizeOperatorPanel("right", 440, 100), 420, "never squeezed below the toolbox's width");
  assert.equal(resizeOperatorPanel("right", 600, -200), OPERATOR_PANEL_BOUNDS.right.max);
  assert.equal(resizeOperatorPanel("right", 440, -100), 540);
});

test("startup defaults leave room for the tools and a wider rail is allowed", () => {
  assert.equal(OPERATOR_PANEL_DEFAULTS.right, 460);
  assert.ok(OPERATOR_PANEL_DEFAULTS.right < OPERATOR_PANEL_BOUNDS.right.max);
  assert.ok(OPERATOR_PANEL_BOUNDS.right.max >= 640, "the tools panel opens wide enough for its canvases");
  assert.ok(OPERATOR_PANEL_DEFAULTS.left > 240);
  assert.ok(OPERATOR_PANEL_DEFAULTS.left < OPERATOR_PANEL_BOUNDS.left.max);
});

test("persisted widths fall back when missing or malformed", () => {
  assert.equal(normalizeOperatorPanelWidth("left", "265"), 265);
  assert.equal(
    normalizeOperatorPanelWidth("right", "not-a-number"),
    OPERATOR_PANEL_DEFAULTS.right,
  );
  assert.equal(normalizeOperatorPanelWidth("right", null), OPERATOR_PANEL_DEFAULTS.right);
});

test("legacy default widths migrate to the new startup sizes", () => {
  assert.equal(normalizeOperatorPanelWidth("left", "240"), OPERATOR_PANEL_DEFAULTS.left);
  assert.equal(normalizeOperatorPanelWidth("right", "320"), OPERATOR_PANEL_DEFAULTS.right);
  // A width saved before the minimum went up opens at the minimum.
  assert.equal(normalizeOperatorPanelWidth("right", "300"), 420);
  assert.equal(normalizeOperatorPanelWidth("right", "440"), 440, "a width someone chose stays");
  assert.equal(normalizeOperatorPanelWidth("right", "680"), 680);
  assert.equal(normalizeOperatorPanelWidth("right", "900"), OPERATOR_PANEL_BOUNDS.right.max);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATOR_PANEL_BOUNDS,
  OPERATOR_PANEL_DEFAULTS,
  OPERATOR_REFERENCE_HEIGHT,
  normalizeOperatorPanelWidth,
  normalizeOperatorReferenceHeight,
  resizeOperatorPanel,
  resizeOperatorReferenceHeight,
} from "../src/lib/operator-layout";

test("left resize follows the pointer and stays inside its usable bounds", () => {
  assert.equal(resizeOperatorPanel("left", 280, 45), 325);
  assert.equal(resizeOperatorPanel("left", 280, -200), 180);
  assert.equal(resizeOperatorPanel("left", 400, 100), 420);
});

test("right resize moves opposite the pointer and stays inside its usable bounds", () => {
  assert.equal(resizeOperatorPanel("right", 320, -60), 380);
  assert.equal(resizeOperatorPanel("right", 320, 100), 280);
  assert.equal(resizeOperatorPanel("right", 440, -100), 460);
});

test("startup defaults open the live rail at full width and give transcript more room", () => {
  assert.equal(OPERATOR_PANEL_DEFAULTS.right, OPERATOR_PANEL_BOUNDS.right.max);
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
});

test("reference panel height grows when dragging the top edge up", () => {
  assert.equal(resizeOperatorReferenceHeight(200, -40), 240);
  assert.equal(resizeOperatorReferenceHeight(200, 100), OPERATOR_REFERENCE_HEIGHT.min);
  assert.equal(resizeOperatorReferenceHeight(400, -100), OPERATOR_REFERENCE_HEIGHT.max);
});

test("persisted reference heights clamp and fall back when malformed", () => {
  assert.equal(normalizeOperatorReferenceHeight("180"), 180);
  assert.equal(normalizeOperatorReferenceHeight("not-a-number"), OPERATOR_REFERENCE_HEIGHT.default);
  assert.equal(normalizeOperatorReferenceHeight(null), OPERATOR_REFERENCE_HEIGHT.default);
  assert.equal(normalizeOperatorReferenceHeight("80"), OPERATOR_REFERENCE_HEIGHT.min);
});

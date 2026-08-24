import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOperatorPanelWidth,
  resizeOperatorPanel,
} from "../src/lib/operator-layout";

test("left resize follows the pointer and stays inside its usable bounds", () => {
  assert.equal(resizeOperatorPanel("left", 240, 45), 285);
  assert.equal(resizeOperatorPanel("left", 240, -200), 180);
  assert.equal(resizeOperatorPanel("left", 400, 100), 420);
});

test("right resize moves opposite the pointer and stays inside its usable bounds", () => {
  assert.equal(resizeOperatorPanel("right", 320, -60), 380);
  assert.equal(resizeOperatorPanel("right", 320, 100), 280);
  assert.equal(resizeOperatorPanel("right", 440, -100), 460);
});

test("persisted widths fall back when missing or malformed", () => {
  assert.equal(normalizeOperatorPanelWidth("left", "265", 240), 265);
  assert.equal(normalizeOperatorPanelWidth("right", "not-a-number", 320), 320);
  assert.equal(normalizeOperatorPanelWidth("right", null, 320), 320);
});

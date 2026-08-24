import assert from "node:assert/strict";
import test from "node:test";

import { getOverlayDispatchOrder } from "../src/lib/overlay-dispatch";

test("auto mode prioritizes the selected-theme NDI renderer", () => {
  assert.deepEqual(getOverlayDispatchOrder("auto"), ["ndi", "library", "message"]);
});

test("explicit output modes retain their configured mechanisms", () => {
  assert.deepEqual(getOverlayDispatchOrder("ndi"), ["ndi", "message"]);
  assert.deepEqual(getOverlayDispatchOrder("message"), ["library", "message"]);
});

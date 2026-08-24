import assert from "node:assert/strict";
import test from "node:test";

import { transitionDetectorRecovery } from "../src/lib/detector-recovery";

test("a retry window remains degraded until an AI request actually succeeds", () => {
  const initial = { consecutiveErrors: 2, fallbackActive: true, probing: false };
  const probing = transitionDetectorRecovery(initial, "begin_probe");
  const recovered = transitionDetectorRecovery(probing, "request_succeeded");

  assert.deepEqual(probing, {
    consecutiveErrors: 2,
    fallbackActive: false,
    probing: true,
  });
  assert.deepEqual(recovered, {
    consecutiveErrors: 0,
    fallbackActive: false,
    probing: false,
  });
});

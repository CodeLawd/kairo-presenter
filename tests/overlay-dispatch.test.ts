import assert from "node:assert/strict";
import test from "node:test";

import { makeOverlayOutput } from "../src/lib/overlay-defaults";
import { firstLookId, getDispatchPlan, layerOfKind } from "../src/lib/overlay-outputs";

test("each output kind maps onto the ProPresenter layer it actually writes to", () => {
  assert.equal(layerOfKind("ndi"), "presentation");
  assert.equal(layerOfKind("library"), "presentation");
  assert.equal(layerOfKind("message"), "messages");
  assert.equal(layerOfKind("stage"), "stage");
});

test("outputs on different layers fan out; outputs sharing a layer stay in one group", () => {
  const plan = getDispatchPlan([
    makeOverlayOutput("main", "ndi", { enabled: true, order: 1 }),
    makeOverlayOutput("library", "library", { enabled: true, order: 0 }),
    makeOverlayOutput("stage", "stage", { enabled: true }),
  ]);

  assert.deepEqual(
    plan.groups.map((g) => g.layer),
    ["presentation", "stage"],
  );
  // Presentation competes: NDI (themed) always runs before a library match,
  // even when the library output is ordered first.
  assert.deepEqual(
    plan.groups[0].outputs.map((o) => o.id),
    ["main", "library"],
  );
  assert.deepEqual(plan.groups[1].outputs.map((o) => o.id), ["stage"]);
});

test("disabled outputs never reach the plan", () => {
  const plan = getDispatchPlan([
    makeOverlayOutput("main", "ndi", { enabled: false }),
    makeOverlayOutput("stage", "stage", { enabled: true }),
  ]);

  assert.deepEqual(plan.groups.map((g) => g.layer), ["stage"]);
});

test("fallbackOnly outputs are held back from the fan-out", () => {
  const plan = getDispatchPlan([
    makeOverlayOutput("main", "ndi", { enabled: true }),
    makeOverlayOutput("lower-third", "message", { enabled: true, fallbackOnly: true }),
  ]);

  assert.deepEqual(plan.groups.map((g) => g.layer), ["presentation"]);
  assert.deepEqual(plan.fallbacks.map((o) => o.id), ["lower-third"]);
});

test("a plan with nothing enabled has no work in it", () => {
  const empty = getDispatchPlan([makeOverlayOutput("main", "ndi", { enabled: false })]);
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.fallbacks, []);
});

test("the first configured Look wins; blank ids are skipped", () => {
  const plan = getDispatchPlan([
    makeOverlayOutput("library", "library", { enabled: true, order: 0, lookId: "" }),
    makeOverlayOutput("main", "ndi", { enabled: true, order: 1, lookId: "  look-a  " }),
    makeOverlayOutput("stage", "stage", { enabled: true, lookId: "look-b" }),
  ]);

  assert.equal(firstLookId(plan.groups), "look-a");
  assert.equal(firstLookId([]), null);
});

test("themed NDI runs before a library match even when the library is ordered first", () => {
  const plan = getDispatchPlan([
    makeOverlayOutput("library", "library", { enabled: true, order: 0 }),
    makeOverlayOutput("main", "ndi", { enabled: true, order: 5 }),
  ]);

  assert.deepEqual(
    plan.groups[0].outputs.map((o) => o.kind),
    ["ndi", "library"],
  );
});

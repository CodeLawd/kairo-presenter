import assert from "node:assert/strict";
import test from "node:test";

import { makeOverlayOutput } from "../src/lib/overlay-defaults";
import {
  chooseNdiVideoInputId,
  firstLookId,
  followsProgram,
  getDispatchPlan,
  layerOfKind,
  outputDestinationLabel,
  ppLayerOf,
  outputRequiresPropresenter,
  surfaceOutputs,
} from "../src/lib/overlay-outputs";

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

test("a confirmed durable NDI binding wins over name discovery", () => {
  const inputs = [
    { uuid: "discovered", name: "ProAutomate NDI" },
    { uuid: "bound", name: "Camera feed" },
  ];
  assert.equal(chooseNdiVideoInputId("bound", "output-old", inputs), "bound");
  assert.equal(chooseNdiVideoInputId("missing", "output-old", inputs), "output-old");
  assert.equal(chooseNdiVideoInputId("", "", inputs), "discovered");
});

// ─── Kairo screens (standalone phase 1) ───────────────────────────────────────

test("screens are not on any ProPresenter layer: they go in the rendered bucket and all run", () => {
  assert.equal(layerOfKind("screen"), null);
  const plan = getDispatchPlan([
    makeOverlayOutput("left", "screen", { enabled: true, order: 1 }),
    makeOverlayOutput("right", "screen", { enabled: true, order: 0 }),
    makeOverlayOutput("main", "ndi", { enabled: true }),
  ]);
  assert.deepEqual(plan.rendered.map((o) => o.id), ["left", "right"]);
  // A screen never joins the presentation competition.
  assert.deepEqual(plan.groups.map((g) => [g.layer, g.outputs.map((o) => o.id)]), [["presentation", ["main"]]]);
});

test("destination labels name where an output lands", () => {
  assert.equal(outputDestinationLabel("screen"), "Kairo screen");
  assert.equal(outputDestinationLabel("ndi"), "NDI feed");
  assert.match(outputDestinationLabel("message"), /ProPresenter/);
});

test("only the outputs that talk to ProPresenter's API require it", () => {
  assert.deepEqual(
    (["ndi", "screen", "library", "message", "stage"] as const).map((kind) => [kind, outputRequiresPropresenter(kind)]),
    [["ndi", false], ["screen", false], ["library", true], ["message", true], ["stage", true]],
  );
});

test("surfaceOutputs is the enabled outputs Kairo renders itself", () => {
  const outputs = surfaceOutputs([
    makeOverlayOutput("main", "ndi", { enabled: true }),
    makeOverlayOutput("projector", "screen", { enabled: true }),
    makeOverlayOutput("off", "screen", { enabled: false }),
    makeOverlayOutput("library", "library", { enabled: true }),
  ]);
  assert.deepEqual(outputs.map((o) => o.id), ["main", "projector"]);
});

test("only the primary NDI output competes for the presentation layer; extra feeds run with the screens", () => {
  const outputs = [
    makeOverlayOutput("main", "ndi", { enabled: true }),
    makeOverlayOutput("stream", "ndi", { enabled: true }),
    makeOverlayOutput("library", "library", { enabled: true }),
    makeOverlayOutput("projector", "screen", { enabled: true }),
  ];
  const plan = getDispatchPlan(outputs);
  assert.deepEqual(plan.groups.map((g) => [g.layer, g.outputs.map((o) => o.id)]), [["presentation", ["main", "library"]]]);
  assert.deepEqual(plan.rendered.map((o) => o.id), ["stream", "projector"]);
  assert.equal(ppLayerOf(outputs[0], outputs), "presentation");
  assert.equal(ppLayerOf(outputs[1], outputs), null);
});

test("filtering the primary NDI feed out of a push does not promote another feed", () => {
  const outputs = [
    makeOverlayOutput("main", "ndi", { enabled: true }),
    makeOverlayOutput("stream", "ndi", { enabled: true }),
  ];
  // e.g. the primary feed opted out of lyrics
  const plan = getDispatchPlan(outputs, (o) => o.id !== "main");
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.rendered.map((o) => o.id), ["stream"]);
});

test("a disabled first NDI output hands the primary role to the next enabled one", () => {
  const plan = getDispatchPlan([
    makeOverlayOutput("old", "ndi", { enabled: false }),
    makeOverlayOutput("main", "ndi", { enabled: true }),
  ]);
  assert.deepEqual(plan.groups.map((g) => [g.layer, g.outputs.map((o) => o.id)]), [["presentation", ["main"]]]);
});

test("a screen running its own playlist never takes a push", () => {
  const lobby = makeOverlayOutput("lobby", "screen", { enabled: true, source: "playlist", playlistId: "p1" });
  const projector = makeOverlayOutput("projector", "screen", { enabled: true });
  const plan = getDispatchPlan([lobby, projector]);
  assert.deepEqual(plan.rendered.map((o) => o.id), ["projector"]);
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(surfaceOutputs([lobby, projector]).map((o) => o.id), ["projector"]);
  assert.equal(followsProgram(lobby), false);
  assert.equal(followsProgram(projector), true);
});

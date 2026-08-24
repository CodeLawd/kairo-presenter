# Operator Live Scripture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect explicit passage ranges quickly, show every verse separately, suppress overlapping duplicates, and follow the preacher's reading through the Operator queue.

**Architecture:** Add pure scripture detection/progress helpers with tests, call local explicit detection before the LLM, attach passage grouping metadata during orchestrator expansion, and render grouped per-verse cards with transcript-driven focus in Operator.

**Tech Stack:** Electron, React, TypeScript, Node test runner via `tsx --test`, Tailwind CSS

**Spec:** `docs/plans/2026-08-24-operator-live-scripture-design.md`

## Global Constraints

- Preserve `contextIsolation: true` and the existing preload IPC boundary.
- Keep renderer dependencies bundled and main-process dependencies externalized.
- Do not overwrite unrelated uncommitted work.

---

### Task 1: Fast explicit detection and semantic deduplication

**Files:**
- Modify: `src/main/services/scripture/detector.ts`
- Test: `src/main/services/scripture/__tests__/detector.test.ts`

**Interfaces:**
- Produces: immediate explicit `ScriptureReference[]` detections and overlap-aware cache filtering.

- [ ] Add a failing test proving spoken `Genesis chapter eight verse 15 to 22` emits the range immediately.
- [ ] Add a failing test proving `Genesis 8:22` is suppressed after `Genesis 8:15-22` within the cache window.
- [ ] Run the focused test and verify both failures are behavioral.
- [ ] Implement local explicit parsing on each analysis request and semantic reference overlap keys.
- [ ] Run the focused tests until green.

### Task 2: Passage grouping and verse progress

**Files:**
- Create: `src/lib/scripture-live-progress.ts`
- Modify: `src/lib/ipc.ts`
- Modify: `src/main/orchestrator.ts`
- Test: `tests/scripture-live-progress.test.ts`

**Interfaces:**
- Produces: `ScriptureSuggestion.passageId`, `passageReference`, `passageIndex`, `passageLength` and `findReadingProgress(segment, suggestions)`.

- [ ] Add failing tests for eight separate Genesis suggestions and movement from verse 15 to verse 16 near the end of verse 15.
- [ ] Run the focused tests and verify expected failures.
- [ ] Implement the pure progress helper and attach range metadata during expansion.
- [ ] Run the focused tests until green.

### Task 3: Uniform Operator verse queue

**Files:**
- Modify: `src/renderer/src/components/operator/Operator.tsx`

**Interfaces:**
- Consumes: grouped scripture suggestions and `findReadingProgress`.
- Produces: grouped passage heading, separate verse cards, current/next reading states, and automatic focus scrolling.

- [ ] Wire finalized transcripts to the progress helper.
- [ ] Replace merged suggestion presentation with grouped compact verse cards matching Scripture tab hierarchy.
- [ ] Keep Send and Dismiss actions per verse and preserve keyboard behavior.
- [ ] Verify with typecheck and lint.

### Task 4: End-to-end verification

**Files:**
- No production files.

- [ ] Run all scripture/progress tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Restart Electron so main-process changes are loaded.
- [ ] Replay Genesis 8:15-22 and verify immediate eight-card display, no merged/duplicate cards, and reading progression.

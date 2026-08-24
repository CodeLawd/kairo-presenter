# Scripture Smart Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shorthand scripture references, Tab book completion, and enter-to-preview phrase suggestions.

**Architecture:** Put deterministic input interpretation in a pure scripture query helper shared by the main process and renderer. Keep verse lookup and FTS ranking in the existing main-process service, and add a debounced accessible suggestion popup to the existing Scripture component.

**Tech Stack:** TypeScript, React 18, Electron IPC, SQLite FTS5, Node test runner

**Spec:** `docs/plans/2026-08-23-scripture-smart-search-design.md`

## Global Constraints

- Enter or click previews; suggestions never automatically add or project scripture.
- Keep `nodeIntegration: false` and `contextIsolation: true`.
- Use the local Bible database for phrase suggestions.
- Preserve existing explicit Add to playlist and Send actions.

---

### Task 1: Scripture query interpreter

**Files:**
- Create: `src/lib/scripture-query.ts`
- Create: `tests/scripture-query.test.ts`
- Modify: `src/main/services/scripture/reference.ts`

**Interfaces:**
- Produces: `normalizeScriptureQuery(input: string): string | null`, `getBookCompletion(input: string): BookCompletion | null`, and `isLikelyPhraseQuery(input: string): boolean`.
- Consumes: the canonical Bible book names, abbreviations, and aliases.

- [ ] Write literal tests for `jos 1 5 9` → `Joshua 1:5–9`, standard references, numbered books, `josh` completion, preserved suffixes, and phrase classification.
- [ ] Run `npx tsx --test tests/scripture-query.test.ts` and confirm missing exports fail.
- [ ] Implement the smallest parser/completion helper that passes.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Main-process search normalization

**Files:**
- Modify: `src/main/services/scripture/index.ts`
- Modify: `src/main/services/scripture/reference.ts`

**Interfaces:**
- Consumes: `normalizeScriptureQuery`.
- Produces: existing `scripture.search` behavior with relaxed references accepted.

- [ ] Add a failing reference test proving relaxed shorthand reaches the structured parser.
- [ ] Run `npx tsx --test src/main/services/scripture/__tests__/reference.test.ts` and confirm failure.
- [ ] Normalize before parsing while leaving phrase search unchanged.
- [ ] Re-run scripture service tests.

### Task 3: Keyboard-first suggestion UI

**Files:**
- Modify: `src/renderer/src/components/scripture/Scripture.tsx`

**Interfaces:**
- Consumes: `getBookCompletion`, `isLikelyPhraseQuery`, and `window.api.scripture.search`.
- Produces: Tab completion, debounced ranked suggestions, Arrow navigation, Escape dismissal, and Enter/click preview.

- [ ] Add state for suggestions, active index, visibility, and stale-request protection.
- [ ] Debounce phrase searches and cap the popup to five results.
- [ ] Wire Tab, arrows, Escape, Enter, mouse selection, combobox ARIA, and preview-only behavior.
- [ ] Update field hints so shorthand and phrase search are discoverable.
- [ ] Run `npm run typecheck` and fix only errors related to this feature.

### Task 4: Verification

**Files:**
- Verify only; no planned production files.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: evidence that parser tests, typecheck, lint, and production build succeed or a precise record of unrelated pre-existing failures.

- [ ] Run the focused query/reference tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Review the final diff for accidental changes to existing Scripture work.

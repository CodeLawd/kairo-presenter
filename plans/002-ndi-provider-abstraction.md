# Plan 002: Introduce a platform-neutral NDI provider

> **Executor instructions**: Implement only the adapter selected by Plan 001.
> Preserve renderer IPC contracts and the current fail-soft startup behavior.
>
> **Drift check (run first)**: `git diff --stat f6c91aa..HEAD -- src/main/services/ndi src/main/ipc/index.ts src/preload/index.ts src/lib/ipc.ts package.json package-lock.json`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-cross-platform-ndi-decision.md`
- **Category**: migration / tech-debt
- **Planned at**: commit `f6c91aa`, 2026-09-12

## Why this matters

The service currently embeds one package name and native API directly. An internal
provider boundary is needed so platform loading, tests, and future native upgrades
do not alter orchestration or renderer behavior.

## Current state

- `src/main/services/ndi/index.ts` defines a minimal local `GrandioseModule` shape,
  constructs the transparent frame buffer, loads `grandiose-mac`, creates a sender,
  and owns the frame timer.
- `src/main/index.ts:308-313` starts NDI unconditionally and logs failure.
- IPC already exposes NDI state. Do not change this public contract.
- Main services are singleton instances and remain inaccessible to the renderer.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all pass |
| Main tests | `npm run test:main` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `src/main/services/ndi/provider.ts` (create)
- `src/main/services/ndi/provider-loader.ts` (create)
- `src/main/services/ndi/index.ts`
- `src/main/services/ndi/__tests__/provider-loader.test.ts` (create)
- `package.json` and `package-lock.json` only as required by Plan 001

**Out of scope**:

- Renderer, preload, IPC response shapes, overlay layout, frame rate/resolution,
  transcription, and ProPresenter behavior.

## Steps

### Step 1: Define the provider boundary

Move only the native binding surface into `provider.ts`: SDK version, sender
creation, source discovery if currently supported, and sender frame/stop behavior.
Keep frame scheduling and current-frame ownership in `NdiService`.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Add an injectable loader

Make `provider-loader.ts` select the Plan 001 adapter using `process.platform` and
`process.arch`. Unsupported combinations return a typed unavailable result rather
than throwing. Do not use renderer-visible environment variables to select native
code. Dependency loading must stay lazy and inside error handling.

**Verify**: tests cover the four supported tuples plus unsupported tuples and a
native-load exception.

### Step 3: Migrate `NdiService`

Inject the provider/loader into the service while keeping the exported singleton.
Maintain current status fields, logging, retry cooldown, transparent initial
frame, sender name, dimensions, and shutdown behavior.

**Verify**: existing tests plus new tests pass; `rg -n "grandiose-mac" src/main/services/ndi/index.ts` returns no matches.

### Step 4: Add a fake provider test

Test successful start, frame delivery, stop, loader failure, sender creation
failure, and repeated start/stop without loading a native addon.

**Verify**: `npm run test:main` → all tests pass, including the new NDI suite.

## Done criteria

- [ ] No platform package name appears in `NdiService`.
- [ ] All four supported target tuples select the intended adapter.
- [ ] Unsupported or broken native bindings disable only NDI.
- [ ] IPC and renderer files remain unchanged.
- [ ] Typecheck, lint, tests, and build pass.
- [ ] Plan 002 is marked `DONE`.

## STOP conditions

- Plan 001 is not complete or selects no reproducible binding.
- The adapter requires changing renderer IPC or frame semantics.
- Native failure can crash main before the service catches it.
- Existing NDI behavior cannot be characterized by tests.

## Maintenance notes

Keep platform branching in the loader, not scattered across the service. Reviewers
should reject adapters that make native downloads at runtime.


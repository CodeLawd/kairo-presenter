# Plan 003: Add reproducible native packaging for the release matrix

> **Executor instructions**: Produce local unsigned artifacts first. Do not add
> release publishing or secrets in this plan.
>
> **Drift check (run first)**: `git diff --stat f6c91aa..HEAD -- package.json package-lock.json build scripts src/main/services/ndi`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/002-ndi-provider-abstraction.md`
- **Category**: migration / dx
- **Planned at**: commit `f6c91aa`, 2026-09-12

## Why this matters

Electron, `better-sqlite3`, and NDI contain native code. A valid artifact must be
built for its exact operating system and CPU, contain only that platform's native
payload, and launch without development dependencies or globally installed NDI.

## Current state

- `package.json` builds only macOS arm64 DMG/ZIP.
- `npmRebuild: true` rebuilds native dependencies for Electron.
- `asarUnpack` currently unpacks all of `better-sqlite3` and `grandiose-mac`.
- `resources/bible.db` is copied through `extraResources` and must remain local.
- `electron.vite.config.ts` externalizes main/preload dependencies.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Clean install | `npm ci` | exit 0 |
| Quality gate | `npm run typecheck && npm test && npm run test:main && npm run lint` | all pass |
| Compile | `npm run build` | exit 0 |
| Package | target-specific npm script added below | one artifact for the current native target |

## Scope

**In scope**:

- `package.json`, `package-lock.json`
- `build/icon.icns`, `build/icon.ico`, and Linux PNG icons
- `scripts/verify-package.mjs` (create)
- target-specific NDI packaging paths selected in Plan 001

**Out of scope**:

- CI, signing secrets, publishing, updater UI, universal Mac, Windows/Linux ARM64.

## Steps

### Step 1: Define builder targets and scripts

Add separate scripts for `mac:arm64`, `mac:x64`, `win:x64`, and `linux:x64`.
Configure mac DMG+ZIP, Windows NSIS, and Linux AppImage+deb. Declare minimum OS
versions and platform-appropriate icons. Preserve current app ID and product name.

**Verify**: electron-builder's effective config shows exactly the expected target
and architecture for each script; no script builds a universal Mac app.

### Step 2: Package only the selected native payload

Use electron-builder file sets or a pre-packaging staging mechanism documented by
Plan 001. Each artifact must include its `better-sqlite3` addon, NDI addon, and NDI
runtime. Preserve runtime loader files such as package entry points and metadata.
Exclude other platforms' `.node`, `.dylib`, `.dll`, and `.so` files.

**Verify**: `scripts/verify-package.mjs <artifact-or-unpacked-app> <platform> <arch>` exits 0 and reports exactly one platform/architecture payload.

### Step 3: Add package integrity verification

The verification script must check:

- main, preload, and renderer output exist;
- `bible.db` exists and is readable;
- the correct `better-sqlite3` addon exists outside ASAR;
- the selected NDI addon/runtime exist outside ASAR;
- no foreign native libraries exist;
- production dependencies required by main/preload resolve;
- unpacked app architecture matches the requested target.

Avoid brittle absolute size assertions. Record size as diagnostic output and use a
generous regression ceiling maintained per target.

**Verify**: corrupt a copied artifact in a temporary directory and confirm the
script exits nonzero; confirm it exits 0 on the intact artifact.

### Step 4: Build natively on each operating system

Run clean installs and packaging on native machines for all four targets. Never
reuse `node_modules`. Launch each unpacked application and capture logs.

**Verify**: four result rows record artifact name, SHA-256, logical size, installer
size, app launch, SQLite open, and NDI load.

## Done criteria

- [ ] Four native artifacts build from a clean checkout.
- [ ] Each artifact contains only its target native payload.
- [ ] Packaged app opens `bible.db` and a writable user-data database.
- [ ] NDI loads without a globally installed SDK.
- [ ] Package verifier catches missing and foreign native payloads.
- [ ] Existing Mac arm64 behavior remains intact.
- [ ] Plan 003 is marked `DONE`.

## STOP conditions

- Any target is produced only through cross-compilation or emulation.
- electron-builder downloads/compiles native code on the customer machine.
- Packaging requires disabling context isolation or enabling Node integration.
- NDI or SQLite cannot load from the packaged application.
- The fix would place secrets or signing credentials in the repository.

## Maintenance notes

Run package verification after every Electron or native dependency upgrade. Size
optimization must remain target-specific; do not globally remove payloads required
by another build job.


# Plan 001: Prove and select the cross-platform NDI runtime

> **Executor instructions**: This is an evidence-gathering and decision plan.
> Do not replace `grandiose-mac` or alter application runtime code. Run every
> verification and record results in the decision document. If a STOP condition
> occurs, stop and report rather than choosing an unverified dependency.
>
> **Drift check (run first)**: `git diff --stat f6c91aa..HEAD -- package.json package-lock.json src/main/services/ndi build/entitlements.mac.plist`
> If these files changed, reconcile the facts below with the live code first.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction / migration
- **Planned at**: commit `f6c91aa`, 2026-09-12

## Why this matters

NDI is the critical portability blocker. The application currently loads
`grandiose-mac`, whose installed native addon is usable only for the machine on
which it was built. Its package happens to contain foreign NDI runtime libraries,
but those files do not prove that a compatible Node addon exists. Packaging work
must not begin until binary availability and redistribution rights are established.

## Current state

- `src/main/services/ndi/index.ts:68-80` calls `require('grandiose-mac')` in a
  try/catch. Failure disables NDI without preventing application startup.
- `node_modules/grandiose-mac/index.js` loads `binding-options.js` through
  `pkg-prebuilds`, preferring `build/Release/grandiose-mac.node`.
- The addon links to an NDI runtime under `lib/<platform>`.
- `build/entitlements.mac.plist` disables macOS library validation because the NDI
  dylib is loaded dynamically.
- Full product parity requires NDI sender creation and source discovery on every
  target. Merely allowing the app to boot with NDI disabled is not success.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test && npm run test:main` | all tests pass |
| Inspect native linkage (macOS) | `otool -L node_modules/grandiose-mac/build/Release/grandiose-mac.node` | NDI dependency is visible and understood |

## Scope

**In scope**:

- Create `docs/decisions/001-cross-platform-ndi.md`.
- Inspect candidate NDI bindings, their source, release artifacts, licenses, and
  supported Electron/N-API versions.
- Build disposable prototypes outside application runtime code if needed.

**Out of scope**:

- Modifying `src/**` or production packaging.
- Publishing packages or installers.
- Accepting a binding solely because its README claims cross-platform support.

## Steps

### Step 1: Define the acceptance contract

In the decision document, record the exact matrix from `plans/README.md` and the
required operations: load runtime, report SDK version, discover sources, create a
sender, send a BGRA frame, stop cleanly, and survive app shutdown.

**Verify**: `rg -n "darwin-arm64|darwin-x64|win32-x64|linux-x64|discover|BGRA|redistribut" docs/decisions/001-cross-platform-ndi.md` → every target and capability is present.

### Step 2: Evaluate three approaches

Evaluate, with evidence:

1. Fork `grandiose-mac`, maintain its Node-API addon, and publish prebuilds.
2. Adopt a maintained cross-platform Node NDI binding.
3. Build a small project-owned Node-API wrapper around the official NDI SDK.

For each, record supported targets, latest maintenance activity, Electron/Node-API
compatibility, binary provenance, license, redistribution terms, signing needs,
estimated maintenance cost, and a minimal load/send/discover test result.

Prefer approach 1 if the source builds cleanly and licensing is acceptable; it
minimizes application behavior change. Prefer approach 3 only if no maintained
binding satisfies the contract. Do not choose approach 2 without source access and
repeatable native builds.

**Verify**: the decision document contains a comparison table with all three
approaches and links or local paths to every piece of evidence.

### Step 3: Prove binaries on native runners

Run the minimal probe on native macOS arm64, macOS x64, Windows x64, and Ubuntu
x64 machines. Record OS version, CPU architecture, Electron version, addon hash,
NDI runtime hash, load result, discovery result, send result, and shutdown result.

**Verify**: four completed result rows exist; none relies on Rosetta or emulation.

### Step 4: Record the decision

Write the selected approach, rejected alternatives, ownership, versioning policy,
binary build process, licensing conclusion, and rollback/fallback behavior. State
whether releases may temporarily show “NDI unavailable” or whether NDI parity is a
hard release requirement. Default to parity as the hard requirement.

**Verify**: a maintainer can identify one selected approach and reproduce all four
native probes using only the document.

## Test plan

- Use a real NDI sender/receiver on the same LAN for discovery.
- Send a known 1280×720 BGRA frame and verify it visually or by frame checksum at
  the receiver.
- Repeat load/start/stop at least ten times to expose native shutdown failures.
- Verify behavior with no NDI runtime installed globally; the bundled runtime must
  be sufficient.

## Done criteria

- [ ] One NDI approach is selected with licensing evidence.
- [ ] Native proofs pass on all four targets.
- [ ] Required runtime files and hashes are recorded per target.
- [ ] Failure/fallback behavior is explicit.
- [ ] No production source or packaging files changed.
- [ ] Plan 001 is marked `DONE` in `plans/README.md`.

## STOP conditions

- Redistribution terms for any NDI SDK binary are unclear.
- Any target requires compilation or downloads on an end-user machine.
- The selected addon cannot be reproduced from source.
- A target only works through emulation.
- The binding crashes during repeated shutdown testing.

## Maintenance notes

Repeat the native probe whenever Electron, the NDI SDK, or the binding is upgraded.
Store no proprietary SDK payload in a public repository unless its license clearly
allows that distribution.


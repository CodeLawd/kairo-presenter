# Plan 006: Qualify updates and physical-machine acceptance

> **Executor instructions**: Do not declare a target supported from CI alone.
> Use signed, packaged builds on physical machines and retain a release checklist.
>
> **Drift check (run first)**: `git diff --stat f6c91aa..HEAD -- src/main/services/updater package.json .github README.md docs`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: `plans/005-ci-signing-release.md`
- **Category**: tests / migration
- **Planned at**: commit `f6c91aa`, 2026-09-12

## Why this matters

Signing, microphone permissions, NDI networking, and auto-update behavior cannot
be validated adequately by compilation. Each architecture must download only its
matching update and preserve operator settings and local data.

## Current state

- `src/main/services/updater/index.ts` disables automatic downloads and installs
  only after explicit operator action.
- macOS uses ZIP for updates and DMG for initial installation.
- Update metadata comes from electron-builder's GitHub publish configuration.
- The app stores settings/databases under Electron's per-user data directory.

## Scope

**In scope**:

- `docs/release-checklist.md` (create)
- focused updater tests under `src/main/services/updater/__tests__/` if gaps appear
- updater configuration needed to select correct OS/architecture artifacts
- `README.md` support status after acceptance passes

**Out of scope**:

- Silent background installation, forced updates, data-format migrations unrelated
  to platform support, new OS/architecture targets.

## Steps

### Step 1: Create an architecture-aware update fixture

Publish a private/draft pre-release containing version N and N+1 for all four
targets. Record expected artifact selection by OS/architecture. Preserve explicit
download behavior and install-on-quit semantics.

**Verify**: each N installation reports only N+1 for its own OS/architecture and
never requests a foreign artifact URL.

### Step 2: Exercise upgrade and rollback safety

On each physical target, create settings, sign in where permitted, import media,
open the Bible database, and perform a short transcription/NDI session. Upgrade to
N+1, restart, and verify settings/data. Test a failed/interrupted download and
confirm version N still launches. Do not automate destructive rollback of user
data.

**Verify**: checklist has four passing rows with installed version, downloaded
artifact hash, preserved-data checks, and signature verification.

### Step 3: Run the full acceptance suite

For every target test: clean install/uninstall, first launch, microphone permission
denial and grant, device enumeration, transcription, scripture detection, local
Bible lookup, ProPresenter connection/reconnection, NDI discovery/send, document
import/export, media clipboard/import, external links, update, and clean shutdown.
Record p50/p99 transcription-to-trigger latency using the same fixture and ensure
it does not regress beyond the existing agreed tolerance; if no tolerance exists,
establish the Mac arm64 baseline before comparison and require stakeholder approval
for any regression.

**Verify**: `docs/release-checklist.md` contains measured results, logs/artifact
references, and explicit pass/fail for every capability and target.

### Step 4: Publish the support statement

Only after all rows pass, update user-facing documentation to state the supported
matrix and known limitations. Do not use “all Linux”; name Ubuntu versions.

**Verify**: support documentation matches `plans/README.md` exactly.

## Done criteria

- [ ] Signed N→N+1 updates pass on all four targets.
- [ ] No target downloads a foreign architecture artifact.
- [ ] Interrupted updates leave the current version usable.
- [ ] Settings, credentials where supported, media references, and databases survive.
- [ ] Full physical-machine checklist passes, including NDI and audio.
- [ ] Latency is measured and remains within the approved tolerance.
- [ ] Public support documentation names only qualified targets.
- [ ] Plan 006 is marked `DONE`.

## STOP conditions

- A signed update fails signature verification.
- Update selection serves a foreign OS or architecture.
- User data is lost or migrated incompatibly.
- NDI, audio, or ProPresenter works only in development but not packaged builds.
- No physical machine is available for a claimed supported target.

## Maintenance notes

Run the abbreviated checklist for every release and the full matrix after Electron,
NDI, native dependency, signing, or installer changes. Preserve old signed builds
needed to test real upgrade paths.


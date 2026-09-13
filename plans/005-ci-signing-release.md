# Plan 005: Add native CI, signing, and coordinated release publication

> **Executor instructions**: Never print, commit, or persist signing credentials.
> First make pull-request builds unsigned and non-publishing; enable release
> publication only after repository maintainers provision secrets.
>
> **Drift check (run first)**: `git diff --stat f6c91aa..HEAD -- .github package.json package-lock.json build scripts src/main/services/updater`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/003-native-packaging-matrix.md`, `plans/004-platform-desktop-integrations.md`
- **Category**: dx / migration
- **Planned at**: commit `f6c91aa`, 2026-09-12

## Why this matters

Native artifacts must be built on their target operating system, signed with the
appropriate platform identity, and published together. Allowing matrix jobs to
publish independently risks incomplete releases and incorrect update metadata.

## Current state

- No `.github/workflows` files exist at the planned commit.
- `package.json` publishes through GitHub Releases.
- macOS already has hardened-runtime entitlements and notarization configuration.
- `electron-updater` expects builder-generated update metadata in packaged builds.

## Scope

**In scope**:

- `.github/workflows/ci.yml` (create)
- `.github/workflows/release.yml` (create)
- package/build scripts needed by the workflows
- documentation listing secret *names and setup procedure*, never values

**Out of scope**:

- Purchasing certificates, changing GitHub repository visibility, publishing from
  pull requests, or supporting additional architectures.

## Steps

### Step 1: Add non-publishing CI

Create a native matrix for macOS arm64, macOS x64, Windows x64, and Ubuntu x64.
Each job checks out code, selects the pinned Node version, runs `npm ci`, quality
gates, the native package command, and package verification. Upload artifacts for
inspection but never publish a release.

**Verify**: a pull-request workflow completes all four jobs and contains no event
or command capable of publishing.

### Step 2: Configure signing boundaries

Document and reference GitHub secret names for Apple certificate/notarization and
Windows code signing. Restrict secret use to protected release tags/environments.
Linux artifacts receive published SHA-256 checksums. Ensure logs redact sensitive
environment values.

**Verify**: fork/PR execution receives no signing secrets; protected release jobs
produce signed Mac and Windows artifacts.

### Step 3: Coordinate release publication

Build artifacts in matrix jobs, upload them to workflow storage, then use one final
publish job after every matrix job succeeds. That job downloads all artifacts,
checks expected filenames and hashes, verifies signatures, and creates/updates one
GitHub release with all builder metadata and blockmaps.

**Verify**: deliberately fail one matrix job in a test branch; confirm no release
is created. Restore it and confirm exactly one draft/test release contains the full
matrix.

### Step 4: Add supply-chain controls

Pin workflow actions to immutable commit SHAs, use least-privilege permissions,
set `contents: write` only on the publication job, and generate an artifact hash
manifest. Retain build logs without secrets.

**Verify**: workflow permissions inspection shows read-only defaults and write
access only in the protected publisher.

## Done criteria

- [ ] PR CI builds and verifies four unsigned target artifacts.
- [ ] Protected release CI signs/notarizes the relevant artifacts.
- [ ] One coordinated job publishes the complete release.
- [ ] Partial matrix failure cannot publish.
- [ ] Workflow actions are SHA-pinned and permissions are least-privilege.
- [ ] No secret values exist in source or logs.
- [ ] Plan 005 is marked `DONE`.

## STOP conditions

- Required certificates or maintainer authorization are unavailable.
- A workflow must expose signing material to untrusted pull requests.
- GitHub release metadata cannot distinguish OS and architecture correctly.
- Any matrix job publishes independently.

## Maintenance notes

Rotate certificates outside source control and update only secret metadata. Keep
the release manifest stable so Plan 006 can test architecture selection.


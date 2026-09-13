# Plan 004: Make desktop integrations platform-aware

> **Executor instructions**: Preserve feature behavior where the OS supports it
> and surface an explicit unavailable result where it does not.
>
> **Drift check (run first)**: `git diff --stat f6c91aa..HEAD -- src/main/index.ts src/main/services/documents src/main/services/media src/main/services/cloud src/renderer/src`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/003-native-packaging-matrix.md`
- **Category**: migration / correctness
- **Planned at**: commit `f6c91aa`, 2026-09-12

## Why this matters

The main window already has sensible macOS, Windows, and Linux branches, and audio
capture uses Chromium. Document application discovery is still macOS-only, while
clipboard, shortcuts, secure storage, and Linux display behavior need packaged
validation.

## Current state

- `src/main/index.ts:173-250` uses platform-appropriate menus and window styling.
- `src/renderer/src/audio/capture.ts` uses `getUserMedia` and AudioWorklet.
- `src/main/services/documents/office-apps.ts` recognizes `.app` bundles and
  searches `/Applications`; only bundle-ID lookup is explicitly Darwin-gated.
- `src/main/services/media/clipboard.ts` contains platform branches and path
  normalization that already recognizes Windows drive paths.
- `src/main/services/cloud/secure-store.ts` uses Electron `safeStorage` and
  deliberately runs without persistence when a Linux keyring is unavailable.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Quality gate | `npm run typecheck && npm test && npm run test:main && npm run lint` | all pass |
| Package | native target script from Plan 003 | exit 0 |

## Scope

**In scope**:

- `src/main/services/documents/office-apps.ts`
- `src/main/services/documents/__tests__/office-apps.test.ts` (create)
- `src/main/services/media/clipboard.ts` and focused tests if a verified defect exists
- settings/status UI only when required to explain unsupported integration or
  unavailable Linux credential persistence
- platform support documentation in `README.md`

**Out of scope**:

- Replacing Chromium audio capture, changing document conversion output, changing
  NDI, visual redesign, or claiming support for untested Linux distributions.

## Steps

### Step 1: Extract platform-specific office discovery

Keep the existing macOS implementation. Add Windows discovery for PowerPoint,
WPS Office, and LibreOffice using registered applications and documented install
locations. Add Linux discovery for LibreOffice using PATH and `.desktop` entries.
Use injectable filesystem/process probes so tests do not depend on installed apps.

**Verify**: tests cover installed, missing, inaccessible, and malformed discovery
data on all three OS families.

### Step 2: Audit shortcuts, clipboard, and paths on packaged builds

Exercise copy/paste, multi-file clipboard input, media import, rename/delete,
external links, menu shortcuts, Unicode filenames, spaces, Windows drive paths,
and case-sensitive Linux paths. Change code only for reproduced defects and add a
regression test for each change.

**Verify**: a platform checklist records pass/fail and every code change has a
failing-before/passing-after automated test.

### Step 3: Validate microphone and secure storage behavior

Verify device enumeration, permission denial/retry, device removal, audio level,
PCM delivery, and transcription start on each packaged target. On Linux, test once
with a supported keyring and once without. Without a keyring, the app must run and
clearly state that sign-in will not persist.

**Verify**: packaged acceptance results exist for all four targets; no credential
or API key value appears in logs.

### Step 4: Document the support contract

Document minimum OS versions, Ubuntu scope, supported document apps per platform,
keyring limitation, NDI requirement, and where logs are stored.

**Verify**: `README.md` contains the four supported targets and the limitations
confirmed above.

## Done criteria

- [ ] Office discovery works or explicitly reports unavailable on each target.
- [ ] Audio capture and permission recovery pass on physical machines.
- [ ] Clipboard/import/path checklist passes.
- [ ] Linux without a keyring remains usable without persistent login.
- [ ] All tests/typecheck/lint pass.
- [ ] Plan 004 is marked `DONE`.

## STOP conditions

- A workaround requires invoking a shell with interpolated user input.
- A target requires plaintext credential persistence.
- Platform behavior cannot be reproduced on a native packaged application.
- The change alters document contents or transcription latency.

## Maintenance notes

Keep OS discovery behind narrow adapters and inject system probes in tests. Avoid
hardcoding one vendor's installation directory as the only detection method.


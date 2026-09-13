# Release checklist (Plan 006 — physical-machine acceptance gate)

Do not declare a target supported from CI alone. Every row below runs on a
SIGNED, packaged build on a physical machine. A successful compile is not
evidence that audio, NDI discovery, signing, or updates work.

Targets: macOS arm64 · macOS x64 · Windows 10/11 x64 · Ubuntu 22.04/24.04 x64.

## Step 1 — Architecture-aware update fixture (N → N+1)

1. Publish a private/draft pre-release with version N and N+1 for ALL FOUR
   targets (use the `Release` workflow, keep the release DRAFT).
2. Install N on each target. Check for updates (explicit operator action —
   downloads never start silently and install only on quit).
3. Expected: each N installation offers ONLY the N+1 artifact matching its
   own OS/architecture (electron-builder `latest-mac.yml` / `latest.yml` /
   `latest-linux.yml` select per platform; mac ZIP is the update payload,
   DMG is first-install only). Record the offered URL + SHA-256 per target;
   fail the run if any target is offered a foreign artifact.

| Target | Installed N | Offered N+1 URL | SHA-256 match | Pass |
|---|---|---|---|---|
| macOS arm64 | | | | |
| macOS x64 | | | | |
| Windows x64 | | | | |
| Ubuntu x64 | | | | |

## Step 2 — Upgrade and rollback safety

On each target BEFORE upgrading: create settings, sign in (where a keyring
exists), import media, open the bundled Bible DB, run a short
transcription + NDI session. Upgrade to N+1, restart, verify:

| Target | Settings survive | Login persists (or documented keyring gap) | Media refs intact | DBs open | Signature valid | Pass |
|---|---|---|---|---|---|---|
| macOS arm64 | | | | | | |
| macOS x64 | | | | | | |
| Windows x64 | | | | | | |
| Ubuntu x64 | | | | | | |

Interrupted download: kill the app mid-download, relaunch — version N must
still launch and offer the update again. Never automate destructive rollback
of user data.

## Step 3 — Full acceptance suite (per target)

- Clean install AND clean uninstall (no leftovers that break reinstall).
- First launch (window, onboarding, no crash without network).
- Microphone: permission denial → clear disabled state; grant → retry works;
  device enumeration; device removal mid-session; audio level + PCM delivery.
- Transcription start/stop; scripture detection on the fixture transcript.
- Local Bible lookup (bundled DB, airplane mode).
- ProPresenter connect / reconnect / timeout copy.
- NDI: source discovery on the LAN; sender creation; 1280×720 BGRA frame
  verified at the receiver (visual or checksum); 10× start/stop; clean
  shutdown with no native crash. Bundled runtime only — uninstall any global
  NDI SDK first.
- Document import/export (per-platform apps in README); media
  clipboard/import incl. Unicode names, spaces, Windows drive paths,
  case-sensitive Linux paths; external links open; menu shortcuts.
- Update N→N+1 (Step 1) then clean shutdown.

Latency: record p50/p99 transcription-to-trigger on the shared fixture per
target. If no tolerance exists, the Mac arm64 row is the baseline; any other
target regressing beyond the agreed tolerance needs stakeholder sign-off.

| Capability | mac arm64 | mac x64 | win x64 | ubuntu x64 |
|---|---|---|---|---|
| Clean install / uninstall | | | | |
| First launch | | | | |
| Mic deny → grant → retry | | | | |
| Device enumeration / removal | | | | |
| Transcription | | | | |
| Scripture detection | | | | |
| Offline Bible lookup | | | | |
| ProPresenter connect/reconnect | | | | |
| NDI discovery + send + shutdown | | | | |
| Document import/export | | | | |
| Media clipboard/import/paths | | | | |
| External links / shortcuts | | | | |
| Update N→N+1 | | | | |
| p50 / p99 latency | / | / | / | / |

## Evidence log (fill per release)

- 2026-09-12, macOS 27.0 arm64, unsigned `--dir` build (local dev machine):
  packaged app launches; `[NDI] provider loaded (NDI SDK 5.5.2)` from the
  bundled dylib with no global SDK; `verify-package.mjs` PASS
  (darwin:arm64, 4 native files, no foreign payload, arch match, 535 MB).
  Sender creation against no receiver: first launch failed fast + fail-soft
  retry path engaged; second launch attempt hung in native `send()` —
  KNOWN RISK: native sender creation has no timeout; a hung first attempt
  wedges `start()` until restart. Re-test against a real NDI receiver before
  claiming support. Updater correctly no-ops without `app-update.yml`.
- (append: CI PR run link, draft pre-release link, per-target rows…)

## Step 4 — Publish the support statement

Only after every row passes: `README.md` “Supported platforms” must match
`plans/README.md` exactly. Never claim “all Linux” — name Ubuntu versions.
Flip the draft release to published only at this point.

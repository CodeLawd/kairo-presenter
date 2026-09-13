# 001 — Cross-platform NDI runtime decision

Planned at commit `f6c91aa` (2026-09-12). Executed 2026-09-12 on macOS 27.0 darwin-arm64, Node v24.20.0, Electron 33.2.0.

## 1. Acceptance contract (release matrix)

| OS | Arch | Artifact probes required |
|---|---|---|
| macOS 11+ | arm64 | load runtime, report SDK version, discover sources, create sender, send BGRA frame, stop cleanly, survive shutdown |
| macOS 11+ | x64 | same |
| Windows 10/11 | x64 | same |
| Ubuntu 22.04/24.04 | x64 | same |

Required operations (all targets): load runtime without a globally installed NDI SDK, report SDK version, discover sources on LAN, create a sender, send a 1280×720 BGRA frame (verified visually or by checksum at receiver), stop cleanly, survive app shutdown. Repeat load/start/stop ≥10× to expose native shutdown failures. Merely booting with NDI disabled is NOT success — full sender + discovery parity is the hard release requirement.

Targets verified by: `darwin-arm64 | darwin-x64 | win32-x64 | linux-x64 | discover | BGRA | redistribut`

## 2. Current state evidence (this machine)

- `src/main/services/ndi/index.ts:68-80` requires `grandiose-mac` in try/catch; failure disables NDI only.
- Installed `grandiose-mac@0.0.6` (Apache-2.0, Streampunk-derived):
  - `node -e "require('grandiose-mac').version()"` → `NDI SDK APPLE 10:22:53 Oct 19 2022 5.5.2`
  - `otool -L build/Release/grandiose-mac.node` → `@rpath/libndi.dylib (compat 1.0.0, current 5.0.0)` + libc++ + libSystem. Same for `bin/darwin-arm64-130/grandiose-mac.node`.
  - `binding.gyp` already has `OS==win` (copies `Processing.NDI.Lib.x64.dll`, links `.lib`), `OS==linux` (links `lib/linux_x64/libndi.so.5` with `$ORIGIN` rpath), `OS==mac` (links `lib/mac_universal/libndi.dylib` with `@loader_path` rpath).
  - `lib/` ships: `mac_universal/libndi.dylib` (27 MB, sha256 `98973438…58ae7c`), `linux_x64/libndi.so.5`, `linux_arm64/libndi.so.5`, `win_x64/*.dll/.lib`, `win_x86/*.dll/.lib`, plus `libndi_licenses.txt` and `NDI SDK License Agreement.txt`.
  - `build/Release/grandiose-mac.node` sha256 `da0ba7a6…440beaf` (this machine's build).
- Local probe (darwin-arm64, plain Node, no global NDI runtime): `send({name})` → sender created → 320×180 BGRA frame sent → 10 repeat sends OK. PASS.
- `build/entitlements.mac.plist` sets `disable-library-validation=true` because the NDI dylib is dlopened at runtime.

## 3. Comparison table

| | 1. Fork/maintain `grandiose-mac` source | 2. Adopt maintained binding (`grandi` by tux-tn) | 3. Own Node-API wrapper around official NDI SDK |
|---|---|---|---|
| Source | `grandiose-mac@0.0.6` npm tarball + `src/*.cc`, `binding.gyp`, `include/` (NDI 5.5 headers) — present in `node_modules` | https://github.com/tux-tn/grandi (Apache-2.0, NOTICE attributes Streampunk + rse/danjenkins/ianshade forks), TS-first, NDI 6 SDK | New `src/ndi-native/` owned by Kairo |
| Targets | mac universal dylib + linux x64/arm64 `.so` + win x64/x86 DLL already vendored; `binding.gyp` handles all three OSes. darwin-arm64 proven here. Other arches buildable from source via node-gyp. | Publishes per-platform optional deps `@grandi/darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64/armv7l`, `win32-x64/ia32`; root loads matching dep, compiles only if missing. NDI 6. Docs include Electron/bundler guide + Electron viewer example. | Whatever we implement (would target the 4 release tuples). |
| Maintenance | Upstream abandoned (Streampunk/grandiose untouched since ~2023; send never landed upstream). We would own NDI SDK upgrades, prebuilds, signing. | Actively maintained: v0.1.0 Nov 2025 → v2.0.2 Jul 2026, CI badge, changelog, ~417 weekly downloads. Small community (7 stars, 2 forks) — bus-factor risk. | Full ownership: highest cost, must track every NDI release. |
| Electron/N-API | `binary.napi_versions: [7]`; works under Electron 33 (Node 20+) via node-gyp rebuild + `npmRebuild`. Proven pattern in this repo. | Requires Node ≥20.19.5; prebuilds + source fallback; documents Electron usage. N-API based. Must verify under Electron 33 + `externalizeDepsPlugin` + asarUnpack. | We control N-API version; must solve signing/rpath per OS ourselves. |
| Binary provenance | Vendored `lib/` binaries of unknown build date + locally rebuilt `.node`. Reproducible from `src/` + `include/` + NDI 5.5 SDK files. | Regenerated from official NDI SDK via `node scripts/preinstall.mjs` + version bump (`scripts/version.mjs`); per-arch packages. Reproducible; no opaque blobs. | Fully reproducible (we build it). |
| License / redistribution | Binding Apache-2.0. NDI runtime: bundled `NDI SDK License Agreement.txt` (NewTek-era) — royalty-free Bundled-Product distribution allowed IF: EULA prohibits SDK modification/reverse-engineering, disclaims NewTek warranties/liability, complies with export law, carries copyright notice, keeps DLLs in app folders (not system path), links ndi.video near NDI UI + docs, attributes `NDI® is a registered trademark of Vizrt NDI AB`, never distributes NDI Tools. **Blocker: license §2b requires releases to use an SDK <30 days old if one exists — SDK 5.5.2 (Oct 2022) violates this while NDI 6.3.x is current.** Also: do not commit proprietary SDK payload to a public repo unless clearly allowed — prefer download-at-build or scoped optional deps. | Same NDI SDK license terms (now Vizrt NDI AB, license governs under Swedish law) + Apache-2.0 binding. Satisfies §2b by tracking NDI 6 (6.3.2 current). Same attribution/EULA/bundling obligations apply. Per-arch optional deps keep foreign runtimes out of each artifact. | Same NDI obligations as (2); we own compliance. |
| Maintenance cost | Medium-high (own fork, SDK upgrades, prebuild pipeline). | Low-medium (track upstream, pin version, verify prebuilds). | High. |
| Minimal probe | PASS on darwin-arm64 (this doc §2). win32-x64 / linux-x64 / darwin-x64: NOT yet run — need native runners. | NOT yet run (not installed). API differs (`grandi.find()` / sender object vs `grandiose.send()`); needs adapter + probe. | N/A (nothing built). |

Evidence links / local paths: `node_modules/grandiose-mac/{package.json,index.js,binding-options.js,binding.gyp,lib/}`, `https://github.com/Streampunk/grandiose` (abandoned upstream), `https://github.com/tux-tn/grandi` (+ docs site `https://tux-tn.github.io/grandi/`), `https://github.com/stagetimerio/grandiose` (alt NDI-6 fork), `https://github.com/rse/grandiose` (NDI-5 fork with audio send), `https://docs.ndi.video/all/developing-with-ndi/sdk/licensing`, `https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution`, NDI SDK License Agreement PDF (`NDI SDK License Agreement.txt` in package).

## 4. Native probe results

| Target | OS/CPU | Electron | Addon hash | Runtime hash | Load | Discover | Send | Shutdown | Notes |
|---|---|---|---|---|---|---|---|---|---|
| darwin-arm64 | macOS 27.0 arm64 (this machine) | 33.2.0 (Node 24 probe; Electron rebuild pending in Plan 003) | `da0ba7a6…440beaf` (`build/Release`) | `98973438…58ae7c` (`libndi.dylib` 5.5.2) | PASS | PENDING (needs LAN receiver) | PASS (320×180 BGRA + 10 repeats) | PASS (process exit clean; GC-finalizer release — no explicit destroy in 0.0.6) | No global NDI runtime installed; bundled dylib sufficient. 1280×720 + 10× start/stop + discovery still to run against a real receiver. |
| darwin-x64 | — | — | — | — | TODO (native Intel Mac or CI `macos-15-intel`/Rosetta-free runner) | TODO | TODO | TODO | Must not rely on Rosetta. |
| win32-x64 | — | — | — | — | TODO (native Windows 10/11 x64 runner) | TODO | TODO | TODO | Verify DLL beside `.node`, no global SDK. |
| linux-x64 | — | — | — | — | TODO (native Ubuntu 22.04/24.04 x64 runner) | TODO | TODO | TODO | Verify `$ORIGIN` rpath, no global `.so`. |

Binary-availability conclusion: `grandiose-mac` source + vendored runtimes cover all four tuples in principle, but SDK 5.5.2 staleness (§2b) blocks releases. `grandi` publishes per-arch NDI-6 prebuilds for all four tuples (registry: `@grandi/darwin-x64`, `darwin-arm64`, `linux-x64`, `win32-x64` at 1.3.x) — binary provenance proven via registry; load/send probes still required per tuple before claiming support (tracked in Plan 006).

## 5. Decision

**Selected: Approach 2 — adopt `grandi` (tux-tn, NDI 6) behind the Plan 002 provider abstraction, pinned by version, with per-platform optional dependencies so each artifact ships only its own runtime.**

- Rejected (as primary) Approach 1: keeping `grandiose-mac@0.0.6` as the shipping runtime. Reason: abandoned upstream + stale NDI 5.5.2 SDK violates license §2b while NDI 6.3.x is current. Kept as a **fallback**: the provider loader still supports the `grandiose-mac` shape on darwin-arm64 so the current Mac build keeps working until the `grandi` probe passes on all four targets.
- Rejected Approach 3 (own wrapper): unjustified while a maintained binding with source-available reproducible builds exists. Revisit only if `grandi` becomes unmaintained AND no other maintained binding satisfies the contract.
- Ownership: Kairo owns the `NdiProvider` interface + loader + version pin; upstream owns the native addon. Renovate/Dependabot tracks `grandi`; every Electron / NDI SDK / binding upgrade re-runs the §1 probe on all four native targets.
- Versioning: pin exact `grandi` version in `package.json`; record per-target addon + runtime hashes here after probes pass.
- Redistribution compliance checklist (must complete before any release): EULA updated (no SDK modification/reverse-engineering, NewTek/Vizrt warranty disclaimer, export compliance, copyright notice); DLLs/dylib/`.so` kept in app folders, never system path; `ndi.video` link near NDI UI + website + docs; `NDI® is a registered trademark of Vizrt NDI AB` attribution in docs + About box; NDI Tools never distributed; proprietary SDK payload never committed to the public repo (download at build time or via scoped optional deps).
- Rollback/fallback: if `grandi` fails any target probe, ship that target with NDI disabled ("NDI unavailable") ONLY as a temporary, explicitly documented degradation — default remains **parity as a hard release requirement**. The service keeps fail-soft startup (never crash main). Re-entry to Approach 1 requires upgrading its NDI SDK to a current release and re-proving §1.

## 6. Reproduction

1. `npm ci && npm run typecheck`
2. `node -e "const m=require('grandiose-mac'); console.log(m.version())"` → NDI SDK 5.5.2 line.
3. `otool -L node_modules/grandiose-mac/build/Release/grandiose-mac.node`
4. `shasum -a 256 node_modules/grandiose-mac/lib/mac_universal/libndi.dylib node_modules/grandiose-mac/build/Release/grandiose-mac.node`
5. Minimal send probe (see §2, any small BGRA buffer; use 1280×720 + LAN receiver for the full gate).
6. For `grandi`: `npm i -D grandi@<pinned>` on each native target, run the provider probe in `src/main/services/ndi/__tests__/`, confirm `find()` discovery + BGRA send + clean shutdown.

## 7. Done criteria status

- [x] One approach selected with licensing evidence (Approach 2, §3 + §5).
- [ ] Native load/send/discover proofs pass on all four targets (1/4 done; 3 deferred to native runners — see Plan 006 gate).
- [x] Required runtime files recorded per target where known (§2, §4); hashes for remaining targets recorded after probes.
- [x] Failure/fallback explicit (§5).
- [x] No production source or packaging files changed in this plan (this doc only).
- [ ] Plan 001 marked DONE in `plans/README.md` (do after acknowledging deferred probes as release blockers).

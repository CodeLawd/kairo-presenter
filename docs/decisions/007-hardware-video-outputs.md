# Hardware video outputs: Step 0 investigation

Date: 2026-10-11. Baseline: `87c09ff`.
Status: **IN PROGRESS — user authorized hardware-independent implementation while
deferring driver setup. Native integration remains gated by hardware qualification.**

## Local evidence

- Drift command from Plan 007 returned no differences; HEAD is the planned baseline.
- Host: macOS 27.0.1 (26A434), arm64. Project declares Electron `^33.2.0`.
- `/Library/Frameworks/DeckLinkAPI.framework` is absent.
- Initial `system_profiler SPPCIDataType` returned no inventory. After the user
  confirmed connection, a repeat PCI/Thunderbolt inventory detected the Sonnet
  Echo Express SE-III TB3 and video device `bdbd:a140`, with PCI link up and
  **Driver Installed: No**. The chassis link is 40 Gb/s. The card model and
  compatibility remain unverified; the PCI ID is not a confirmed model name.
- Model, firmware, driver version, active profile, physical connector mapping,
  and supported output/keying modes remain unknown.
- No SDK files were found in the repository. No driver was installed, extension
  approved, machine rebooted, native module loaded, or card output started.

## Binding investigation

No binding selected. A custom N-API addon is a candidate, not a settled decision.

[Macadam](https://github.com/Streampunk/macadam) documents scheduled playback,
hardware time queries and external keying. Its documented scheduler is replenished
through JavaScript promises; this alone does not prove autonomous native frame
repeat under a stalled Electron main thread. Its
[package manifest](https://raw.githubusercontent.com/Streampunk/macadam/master/package.json)
reports version 2.0.18, Apache-2.0, source compilation through node-gyp, and a
segfault-handler dependency. That version is the inspected repository manifest,
not a verified latest published release. Last release date, bundled SDK version,
arm64 build, current Electron compatibility, hotplug support, native conversion
and autonomous repeat remain unverified. Do not add it to dependencies yet.

Blackmagic's [SDK overview](https://sdk-doc.blackmagicdesign.com/decklink-sdk/)
currently documents SDK 16.0 and dynamic linking to the user's installed runtime.
Its [project instructions](https://sdk-doc.blackmagicdesign.com/decklink-sdk/decklinkapi.html)
require the macOS header and dispatch source. Neither establishes permission to
redistribute a particular SDK's dispatch source or compiled derivative. Record
the actual downloaded SDK's EULA, version, applicable clauses and required notices
before selecting or shipping a binding. Licensing answer: **pending**.

## Review findings to resolve before runtime work

1. **Native crash containment:** JavaScript try/catch catches thrown exceptions,
   not SIGSEGV or abort. With the plan's crash STOP condition, an unqualified addon
   must first be exercised in a separate process. If native crash isolation is a
   product guarantee, playback must also live in a supervised helper process;
   an in-main loader alone cannot satisfy it. Decide the process boundary before
   committing to the service implementation.
2. **Clock ownership:** the native provider owns frame repetition and scheduling;
   the service owns routing and lifecycle. Prototype a frozen producer and a
   deliberately stalled JS thread, in addition to a continuously painted frame.
3. **Frame ownership:** setFrame must copy or otherwise retain immutable bytes
   before returning; validate raster and byte length. Do not reuse a scheduled
   SDK frame while hardware owns it. Decide Chromium premultiplied-alpha handling,
   Rec.709 range, scaling policy and interlaced field treatment in the prototype.
4. **Exclusive resources:** two outputs cannot acquire the same port; key/fill may
   reserve a second connector. Profile changes can invalidate IDs and modes.
   Reject ambiguous label matches rather than opening an arbitrary physical port.
5. **Recovery:** serialize reconciliation and shut down pending opens on quit.
   Test disconnect during open, mode changes, repeated close, provider enumeration
   failure, and one broken provider alongside a healthy provider. Define how
   asynchronous playback failures reach output status; the proposed sink interface
   currently has no failure notification.
6. **Surface integration:** capture, fade pacing, document paint waits, clear,
   recovery and availability currently branch on `ndi`. Share offscreen behavior
   deliberately, preserving NDI audio behavior. Routing helpers also special-case
   `screen` playlist sources; extending the kind list alone is insufficient.
7. **Plan consistency:** the vendor-name exclusion cannot literally coexist with
   the required installation help text. Keep vendor-specific runtime code inside
   providers/loader, while allowing user-facing driver guidance and documentation.
   SDK/driver availability and a busy port need distinct UI states.
8. **Packaging:** asarUnpack does not include a file excluded by build.files.
   Explicitly stage the addon/helper into an included path, verify each tuple's
   payload, and sign all shipped native executables and libraries.

## Gate evidence still required

- Install a Desktop Video release compatible with this host and card; complete
  any macOS approval/reboot. Capture model, firmware, driver and active profile
  from Desktop Video Setup, plus fresh PCI inventory.
- Obtain SDK and inspect its license. Compare both binding candidates with real
  arm64 Electron build/load evidence; qualify x64 separately before shipping it.
- Resolve the process boundary and asynchronous failure contract above.
- Outside src/, run 1080p29.97 for ten minutes with three-frame preroll. Record
  SDK completion counts (completed/late/dropped/flushed), hardware-clock progress,
  frozen-producer and JS-stall results, and monitor observations. Dropped/late
  counts: **not measured**, never zero by assumption.
- Verify interlaced output, busy port, unplug/replug and profile changes on hardware.

Implementation ledger: Step 0 investigation recorded. User subsequently authorized
proceeding without Desktop Video. Provider interfaces, lazy loader, device service,
device kind normalization/routing, offscreen surfaces, IPC/preload and Outputs UI
implemented. Native modules are not registered or loaded. Step 3 and Step 6 pending;
Step 4/5 manual hardware acceptance pending. Native process/asynchronous failure
contract, profile-dependent key/fill ownership and label rematching remain unresolved.

Review: fixed synchronous failed-frame readiness (close and hold until explicit
refresh), changed-port acquisition ordering (release owners before swapping), and
surface replacement on replug (retain slide/document state). Regression tests cover
these paths. Device audio embedding remains out of scope; a device-only video setup
continues using the existing renderer program audio fallback.

Verification (2026-10-11): 25 hardware-focused tests pass, 486 main-process tests
pass, typecheck/build pass, lint has zero errors and 28 existing warnings, and
git diff --check passes. Tests used direct `--import tsx` execution to avoid the
tsx CLI's sandbox-blocked named pipe. The full tests/*.test.ts suite reports
749 passes and five failures: lyrics-usr-title, media-folders, media-import,
media-playlists and media-root. These fail while writing electron-store settings
under the user's Library/Preferences directory, which is outside the sandbox;
the same failures were observed before the service/UI work. Main tests also log
blocked writes to Library/Logs but pass. No physical playback, actual Electron UI
interaction, native crash isolation, signed package or ten-minute pacing check
was performed. Parallel scripture changes in the workspace were left intact.

Ruling: proceed with hardware-independent foundations under the user's explicit
instruction, preserving qualification gates for native integration and shipment.
Cost if the qualified binding needs a different boundary: revise these interfaces
and their tests before connecting it to output surfaces.

## Native integration started (2026-10-11)

- User installed Desktop Video 16.4, enabled extensions, restarted and confirmed
  Desktop Video Setup detects four channels. SDK 16.0 extracted in Downloads.
- Built Kairo-owned standalone C++17 helper from SDK headers and dispatch source,
  dynamically loading the installed framework. Runs in a separate process; no
  Electron ABI dependency or native code in main. Development on the existing
  work was moved to `codex/decklink-native-integration`, preserving local changes.
- SDK EULA clause 0.1 excludes Mac/Include files from clauses 1, 4.3, 4.4, 5, 7, 8.
  The header/dispatch file license grants use/distribution/derivative works and
  exempts machine-executable object code from source notice inclusion. This is
  the basis for compiling our helper; vendor sample code/frameworks are not copied.
- Actual SDK inventory: runtime 16.4, model **DeckLink Duo 2**, persistent IDs
  2819981344–2819981347, sub-device indices 0–3. Channels 1/2 advertise 16 YUV
  output modes including 1080p29.97 and 1080i59.94; channels 3/4 advertise none
  in the current configuration. Firmware/active profile still need explicit
  verification; do not infer connector pairing from channel labels.
- Sandbox prevents the SDK's driver XPC connection; discovery succeeds with
  approved host access. Unit self-test and argument validation pass. Ten-minute
  scheduled playback probe started on channel 1 at 1080p29.97. Qualification
  result pending. Native code uses three immutable preroll frames with callback
  repetition and limited-range Rec.709 UYVY; no JavaScript producer involved.
- Production provider registration remains gated until the physical qualification
  results, failure transport and supported modes are settled.

Ruling: permit an opt-in development provider while physical picture/profile and
packaging acceptance remain outstanding. The native process boundary is proven
under Electron, hardware-clock scheduling is measured, and no plan STOP condition
has occurred. Default builds keep the provider disabled until full qualification;
this is not a declaration that Step 0 or hardware support is complete. Cost:
development users may encounter unqualified profile/mode behavior; never release
or enable key/fill on the strength of these preliminary tests.

### Qualification evidence and development preview

- Channel 1 1080p29.97 ten-minute frozen-frame run completed successfully:
  **18,043 completed, 0 late, 0 dropped, 2 flushed on shutdown, 0 errors**.
  Log: `/tmp/kairo-decklink-probe-1080p2997.log`. This run used the initial
  standalone immutable-frame prototype; physical monitor was not connected.
- Electron 33 producer/transport test on channel 2: held a scaled 1×1 green
  BGRA source while blocking JavaScript for five seconds; **148 completed,
  0 late, 0 dropped, 1 flushed, 0 errors**. Log:
  `/tmp/kairo-decklink-stream-probe.log`. Native callbacks were autonomous.
- Provider adapter inside the installed Electron runtime reads runtime 16.4,
  four stable ports, 14 HD modes on channels 1/2, and an explicit unavailable
  profile reason on channels 3/4. SD inventory was intentionally removed because
  its Rec.601 matrix differs from HD Rec.709. Key/fill is disabled pending profile
  and alpha qualification. Interlaced still needs moving-picture acceptance.
- Added optional vendor-neutral sink `onError` to carry helper/driver failures
  to service readiness and teardown. Transport bounds backpressure to the newest
  unsent immutable frame. Startup failures terminate the helper, escalating to
  SIGKILL if it ignores graceful termination; close releases the native port.
- Fresh review fixed missing startup force cleanup and wrong SD color matrix.
  No additional callback/frame-ownership blocker was reported.
- Kairo preview: build with `DECKLINK_SDK_PATH` then launch
  `KAIRO_ENABLE_DECKLINK=1 npm run dev`. Provider is disabled by default;
  preview looks for the helper in the repository, not a release package.
- Verification: 10 native/transport tests, 24 device-service tests, 492 main tests
  pass; typecheck/build pass; lint has 0 errors and 28 existing warnings.
  Physical picture, busy ownership with ProPresenter, hot-unplug/replug,
  firmware/profile mapping, x64 and signed packaging remain unverified.
- Final service→provider→helper smoke test ran under Electron on channel 2 at
  1080i59.94, reported ready with four ports, held a scaled BGRA frame across a
  five-second JavaScript stall and closed cleanly. It is an API/lifecycle check,
  not visual field-order or motion acceptance. Log:
  `/tmp/kairo-decklink-service-probe.log`.

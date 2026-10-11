# Plan 007: Hardware video outputs (DeckLink first, vendor-neutral)

> **Executor instructions**: Step 0 is a decision gate — record its findings in
> `docs/decisions/007-hardware-video-outputs.md` before writing runtime code.
> Ship DeckLink only; AJA is a follow-up that must fit the same interface
> without changing it. Honor the STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 87c09ff..HEAD -- src/main/services/output src/main/services/ndi src/lib/ipc.ts src/lib/overlay-outputs.ts src/lib/overlay-defaults.ts src/renderer/src/components/screens package.json`
> If these changed, reconcile the facts below with the live code first.

## Status

- **Execution**: IN PROGRESS (2026-10-11). User authorized hardware-independent
  implementation while deferring Desktop Video setup. Provider contract, lazy
  loader, device service, output routing/surfaces, IPC and Outputs UI implemented
  with fake-device tests. Native
  integration, hardware qualification and packaging remain gated by Step 0.
  Investigation and review recorded in `docs/decisions/007-hardware-video-outputs.md`.
  Desktop Video 16.4 and SDK 16.0 are now installed; card identified as DeckLink
  Duo 2. Native helper and opt-in provider implemented. Ten-minute frozen-frame
  1080p29.97 probe: 18,043 completed, zero late/dropped/errors. Electron producer
  stall test passed. Physical monitor/profile/key-fill/package qualification
  remains outstanding; the provider is disabled in normal builds.
- **Review prerequisite**: resolve native crash containment, asynchronous sink
  failure reporting, frame ownership and exclusive key/fill resources in the
  decision doc before integrating the native provider.
  The initial boundary follows the planned interface; asynchronous native failure
  reporting must be settled before connecting a real provider.

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH (native addon, real-time frame pacing, hardware-only testing)
- **Depends on**: 002 (provider pattern), 003 (native packaging)
- **Category**: feature / native
- **Planned at**: commit `87c09ff`, 2026-10-11

## Why this matters

Churches drive projectors, confidence monitors and switchers from SDI/HDMI I/O
cards — Blackmagic DeckLink / UltraStudio, AJA Kona / Io — often in a
Thunderbolt PCIe chassis (Sonnet Echo Express). These cards do **not** appear as
macOS displays; apps reach them through the vendor SDK. Kairo today only sees
`screen.getAllDisplays()` and NDI, so a card ProPresenter can use is invisible
to Kairo.

Field case that prompted this: Sonnet Echo Express SE-III (TB3) holding an
Aquantia 10GbE NIC, a Fresco USB card, and a Blackmagic card
(PCI `bdbd:a140`, model unconfirmed, Desktop Video not installed on the dev Mac).

## Design

One vendor-neutral output layer; each SDK is a provider behind it.

```
ProgramSurface (offscreen, 1920×1080 BGRA)   ← exists today for `ndi`
        │  latest frame
        ▼
VideoDeviceService      frame hold + hardware-clocked repeat, mode choice,
        │               port ↔ output mapping, status, hotplug
        ▼
VideoDeviceProvider     one per vendor SDK, lazily loaded, fail-soft
  ├─ decklink   (this plan)
  └─ aja        (follow-up plan; NTV2 SDK, MIT)
```

Devices that need no provider (document this in the Outputs UI help text):

| Device class | Already handled by |
|---|---|
| GPU / eGPU outputs, DisplayLink, Mac-fed HDMI matrices | `screen` (macOS display) |
| NDI decoders (Magewell Pro Convert, BirdDog, Kiloview), LED processors fed by them | `ndi` |
| Blackmagic DeckLink / UltraStudio / Intensity | `decklink` provider (new) |
| AJA Kona / Io / T-TAP | `aja` provider (future) |
| Matrox, Deltacast, Bluefish444 | Not planned — add a provider on demand |

### Provider boundary (`src/main/services/video-devices/provider.ts`)

```ts
export interface VideoMode {
  id: string                 // provider-stable, e.g. 'decklink:Hp30'
  label: string              // '1080p29.97'
  width: number
  height: number
  frameRateN: number         // 30000
  frameRateD: number         // 1001
  interlaced: boolean
}

export interface VideoPort {
  /** Provider-scoped stable id: persistent device id + sub-device/port index. */
  id: string
  provider: string           // 'decklink'
  deviceName: string         // 'DeckLink Duo 2'
  portName: string           // 'SDI 3'
  modes: VideoMode[]
  supportsKeyFill: boolean
  /** Null when usable; otherwise why not ("In use by another app"). */
  unavailableReason: string | null
}

export interface VideoOutputSink {
  /** Replace the frame the card repeats. BGRA, top-down, width×height×4. */
  setFrame(bgra: Buffer, width: number, height: number): void
  close(): Promise<void>
}

export interface VideoDeviceProvider {
  readonly name: string
  /** Driver/runtime present? Version string for logs and the status line. */
  status(): { available: boolean; version?: string; reason?: string }
  listPorts(): Promise<VideoPort[]>
  onPortsChanged?(listener: () => void): () => void
  openOutput(portId: string, modeId: string, opts: { keyFill: boolean }): Promise<VideoOutputSink>
}
```

Rules:

- **Hardware owns the clock.** The provider (not the service) holds and repeats
  the latest frame, and schedules frames on the card's
  reference (DeckLink scheduled playback), repeating the last `setFrame`
  buffer. Electron's `paint` is irregular (only on change, `OSR_FRAME_RATE`
  10/30fps) — never pace SDI from `paint`. This mirrors `NdiService`, which
  already repeats the last frame on its own loop.
- **Conversion lives in native code.** Prefer output pixel format 8-bit BGRA
  when the card accepts it; otherwise convert to 8-bit YUV (UYVY, Rec.709) in
  the addon, off the JS thread. Scale to the mode's raster there too if the
  mode is not 1920×1080.
- **Fail-soft like NDI.** Provider modules load lazily inside try/catch via a
  loader (copy `ndi/provider-loader.ts`); a missing Desktop Video install or a
  broken addon disables only that provider and surfaces a typed reason.
  This covers JavaScript exceptions, not native crashes. Qualify load/playback in
  an isolated process first; decide whether a supervised playback helper is
  required to meet the native-crash STOP condition before runtime implementation.
- **No driver redistribution.** The DeckLink SDK's dispatch code loads
  `DeckLinkAPI.framework` from the user's Desktop Video install at runtime.
  Kairo ships only its own addon.

### Output model (`src/lib/ipc.ts`)

Add `'device'` to `OverlayOutputKind` with fields (null/'' on other kinds):

```ts
// — kind: 'device' —
devicePortId: string          // VideoPort.id; '' = not chosen
devicePortLabel: string       // 'DeckLink Duo 2 · SDI 3' — re-match + UI
deviceModeId: string          // VideoMode.id
deviceKeyFill: boolean
```

`device` behaves like `screen` for routing: Kairo-rendered, not a PP layer
(`LAYER_OF.device = null`), honors `show`, `confidence`, `source`
(`program` | `playlist`). Rendering reuses an offscreen `ProgramSurface` with a
new sink kind `{ kind: 'device'; sink: VideoOutputSink }` — same capture path
as `ndi`, different destination.

## Current state (facts this plan relies on)

- `src/main/services/output/surface-manager.ts` — `reconcile` is the only place
  output windows open/close; displays come from Electron `screen` with
  debounced hotplug (`DISPLAY_CHANGE_DEBOUNCE_MS`).
- `src/main/services/output/program-surface.ts:30-40` — `SurfaceSink` is
  `ndi | display`; offscreen `paint` → `channel.updateFrame(bgra, 1920, 1080)`.
- `src/main/services/ndi/provider.ts`, `provider-loader.ts` — the pattern to copy.
- `src/lib/overlay-outputs.ts` — `OVERLAY_OUTPUT_KINDS`, `LAYER_OF`,
  `outputDestinationLabel`; all exhaustive over `OverlayOutputKind`.
- `src/renderer/src/components/screens/ScreenConfiguration.tsx` — Outputs UI.
- `package.json` `build.asarUnpack` already unpacks `**/*.node`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test && npm run test:main` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Card visible | `system_profiler SPPCIDataType \| grep -A8 -i bdbd` | `Driver Installed: Yes` |
| Package (mac arm64) | target script from Plan 003 | artifact launches, ports listed |

## Scope

**In scope**: `src/main/services/video-devices/**` (new), `native/decklink/**`
(new addon, if Step 0 picks a custom binding), `src/main/services/output/*`,
`src/lib/ipc.ts`, `src/lib/overlay-outputs.ts`, `src/lib/overlay-defaults.ts`,
IPC + preload + `env.d.ts` for port listing/status, Outputs UI, packaging
config, decision doc.

**Out of scope**: AJA (follow-up plan), video **input**/capture from cards,
audio embedding over SDI (follow-up; note the hook), Windows/Linux DeckLink
builds (interface stays portable; ship macOS first), changing NDI behavior.

## Steps

### Step 0: Decision gate — binding and hardware facts

1. Install a host/card-compatible Blackmagic Desktop Video on the dev Mac; approve the system
   extension; reboot. Record card model, firmware, and sub-device profile from
   Desktop Video Setup (Duo 2 / Quad 2 / 8K Pro expose profiles that change
   how many ports exist and whether key/fill is possible).
2. Evaluate bindings:
   - `macadam` (Streampunk, N-API DeckLink binding) — check last release, SDK
     version, arm64 + current Electron ABI, scheduled playback support, license.
   - Custom N-API addon (`node-addon-api`, DeckLink SDK headers +
     `DeckLinkAPIDispatch.cpp`) — scoped to: enumerate devices/ports/modes,
     hotplug (`IDeckLinkDiscovery`), scheduled playback with frame repeat,
     BGRA→UYVY, optional `IDeckLinkKeyer`.
3. Confirm the DeckLink SDK EULA permits shipping a compiled addon that links
   the dispatch code (no framework redistribution).
4. Prototype outside `src/`: put a solid-color 1080p29.97 frame out one port
   for 10 minutes; log dropped/late frames.
   Also freeze the frame producer and stall its JavaScript thread to prove the
   native scheduler repeats independently. Record actual completion counts and
   resolve the review prerequisites in the decision doc before passing the gate.

**Verify**: decision doc lists chosen binding, card facts, licensing answer,
prototype dropped-frame count (target 0 over 10 min).

### Step 1: Provider boundary + loader + fake provider

Create `video-devices/provider.ts` (interfaces above), `provider-loader.ts`
(per-tuple, lazy, typed unavailable result), and `__tests__/fake-provider.ts`.

**Verify**: tests cover loader success, missing driver, addon throw at require,
unsupported tuple — without loading native code.

### Step 2: `VideoDeviceService`

Singleton (`videoDeviceService`). Responsibilities: aggregate ports across
providers, debounce hotplug, open/close sinks, keep per-output status
(`ready` / `reason`), and close everything on quit. Exposes
`onPortsChanged` for the surface manager and IPC.

**Verify**: fake-provider tests — open, setFrame, port disappears (status
becomes "Device disconnected", sink closed), port returns (reopens), port busy
("In use by another app"), repeated reconcile is idempotent.

### Step 3: DeckLink provider

Implement `decklink` against the Step 0 binding. Port id = DeckLink persistent
id + sub-device index (survives replug; falls back to `deviceName + portName`
match like `displayLabel` re-matching). Map `E_ACCESSDENIED` on enable to
"In use by another app (ProPresenter?)". Pre-roll 3 frames before
`StartScheduledPlayback`; on late/dropped callbacks reschedule from the
hardware clock, never from wall time.

**Verify**: on the real card — ports listed, 1080p29.97 and 1080i59.94 both
clean on a monitor, ProPresenter holding the port yields the busy reason.

### Step 4: Output kind + surfaces

Add `'device'` to `OverlayOutputKind` and fields above; extend
`OVERLAY_OUTPUT_KINDS`, `LAYER_OF`, `outputDestinationLabel`, normalizer
defaults, `surfaceOutputs`. Add the `device` `SurfaceSink`; `reconcile` opens
one offscreen surface per enabled, bound, available device output and
`setFrame`s each paint. Key/fill: surface stays transparent; provider uses the
alpha channel for the key output.

**Verify**: typecheck catches every exhaustive switch; existing overlay-output
tests pass; new tests: device output is never a PP layer, honors `show`,
`playlist` source routes like `screen`.

### Step 5: IPC + Outputs UI

IPC: `videoDevices.listPorts()`, `videoDevices.status()`,
`videoDevices.onChanged`. UI in `ScreenConfiguration.tsx`: "Video card" option
when adding an output; port and mode pickers; key/fill switch only when
`supportsKeyFill`; status line with the reason. When no provider is available,
show one line: "Install Blackmagic Desktop Video to use DeckLink cards" — no
dead controls. Follow the flat, minimal-copy UI style.

**Verify**: manual pass on hardware; renderer tests for the empty / busy /
ready states.

### Step 6: Packaging

Build the addon per tuple (Plan 003 matrix; macOS arm64 + x64 first), sign it
with the app, confirm `asarUnpack` covers it, and that a machine **without**
Desktop Video launches cleanly with the provider reported unavailable.

**Verify**: packaged app on (a) dev Mac with card, (b) Mac with no Desktop
Video — both launch; (a) outputs picture.

## Done criteria

- [ ] Decision doc recorded; binding and licensing settled.
- [ ] Vendor-specific runtime code stays inside `video-devices/providers/<vendor>`
      and the loader; UI driver guidance and documentation may name vendors.
- [ ] Missing driver / broken addon disables only hardware outputs.
- [ ] 10-minute run, 0 dropped frames at 1080p29.97 on the test card.
- [ ] Port busy, unplug, and replug produce correct status and recovery.
- [ ] Typecheck, lint, tests, build pass; packaged app verified on both machines.
- [ ] README status row updated.

## Hardware-independent implementation record (2026-10-11)

- Tests cover loader selection/failures; service idempotency, port busy,
  disconnect/reconnect, invalid BGRA input, duplicate assignment, mode changes,
  provider isolation, debounced hotplug, close idempotency, port swaps,
  in-flight acquisition during shutdown and synchronous playback failure.
- Device outputs normalize persisted bindings, remain outside PP layers, honor
  content filters and confidence layers, and support independent playlists.
- Offscreen capture is shared with NDI without adding device audio embedding.
  Replug retains the current slide. Tests exercise the real surface/manager with
  Electron window doubles; they do not qualify actual Chromium painting or SDI.
- IPC exposes inventory/status/change subscription. Outputs offers Video card,
  port/mode selection, supported key/fill and refresh; renderer tests cover
  unavailable, busy and ready states.
- Review fixed failed-frame readiness, port-swap collisions and lost replug content.
- No native provider is registered yet. Label re-matching, asynchronous provider
  failure notification, profile-dependent key/fill resource ownership and native
  alpha/conversion semantics must be qualified with the binding in Step 0/3.
- Final check results are recorded in `docs/decisions/007-hardware-video-outputs.md`.

## STOP conditions

- No binding can do scheduled playback on arm64 + current Electron.
- DeckLink SDK license forbids shipping the addon.
- Frame pacing requires driving SDI from Electron `paint` timing.
- Supporting DeckLink requires changing the provider interface in a way AJA
  could not also implement (re-plan the interface instead of special-casing).
- Native failure can crash main before the loader catches it.

## Follow-ups (separate plans)

- AJA provider (libajantv2, MIT) — must implement the interface unchanged.
- SDI embedded audio from the program audio tap (same source as `ndiAudio`).
- Windows/Linux DeckLink builds.
- Video input from cards as a camera source.

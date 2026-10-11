# Plan 008: GPU shared-texture frame capture for offscreen outputs

> **Executor instructions**: Step 0 is a measurement and feasibility gate.
> Record its results in `docs/decisions/008-gpu-frame-capture.md` before writing
> runtime code. If the baseline shows the current CPU path already meets the
> targets for the outputs churches actually run, stop and mark this plan
> `REJECTED (not needed)`. The CPU capture path stays as the fallback in every
> step — never remove it. Honor the STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 87c09ff..HEAD -- src/main/services/output src/main/services/ndi src/main/services/video-devices native/decklink electron.vite.config.ts package.json`
> If these changed, reconcile the facts below with the live code first.

## Status

- **State**: IN PROGRESS — Steps 1–5 and 7 implemented 2026-10-11; Step 0 gate waived by the owner; Step 6 qualification outstanding. See `docs/decisions/008-gpu-frame-capture.md`.
- **Priority**: P3 (raise to P2 if Step 0 shows the CPU path cannot carry the
  required output count)
- **Effort**: L
- **Risk**: HIGH (experimental Electron API, native GPU code, real-time pacing)
- **Depends on**: 007 (hardware outputs qualified on a real card), 003 (native packaging)
- **Category**: performance / native
- **Planned at**: commit `87c09ff`, 2026-10-11

## Why this matters

Every offscreen output — each NDI feed and each video card — copies every frame
through the CPU several times. Per 1080p frame (~8 MB BGRA):

1. Chromium renders on the GPU, then reads the frame back to system memory.
2. `image.getBitmap()` copies it into a Node buffer on the main thread.
3. The DeckLink sink copies it into a transferable buffer for the playback worker.
4. The worker copies it into a pipe packet; the pipe adds kernel copies.
5. The helper converts BGRA → UYVY on the CPU, single-threaded.

That is ~40 MB of copying per frame, roughly 1 GB/s per output at 24–30 fps.
On 2026-10-11 a single video card output plus one NDI feed playing motion
backgrounds pushed Kairo's main process to ~150% CPU and made output choppy.
Two fixes since then (1× offscreen capture, DeckLink pipe moved to a worker)
removed the Retina resize and the pipe work from the main thread, but the cost
still grows linearly with every output.

With `webPreferences.offscreen.useSharedTexture`, the `paint` event delivers a
handle to the GPU texture instead of pixels. Conversion to the output format
happens on the GPU, and one readback of the already-converted frame (UYVY,
~4 MB) is all the CPU sees. The main thread touches only a handle, so output
count stops scaling CPU load and frame timing stops depending on main-thread
contention.

What this does **not** change: Chromium's own page rendering and video decode
cost, theme/blur behaviour, or physical signal problems (card firmware, profile,
cabling).

## Design

```
ProgramSurface (offscreen, useSharedTexture)
   │  paint → { texture.textureInfo.sharedTextureHandle }   (IOSurface on macOS)
   ▼
gpu-frames addon (N-API, in main process)
   │  Metal: BGRA (premultiplied) → composite on black → UYVY Rec.709 limited
   │  readback of converted frame into a frame slot, then texture.release()
   ▼
FrameSlot sinks
   ├─ DeckLink: shared-memory ring → decklink-helper --play-shm (out of process)
   └─ NDI:      NdiSender.sendVideo with FourCC UYVY (in process)
```

Rules:

- **Release textures fast.** Chromium keeps a small pool. The addon must finish
  the GPU conversion and the main thread must call `texture.release()` within
  one frame interval. If the converter is busy, release the new texture
  immediately and drop that frame — never queue textures.
- **No texture crosses a process.** Electron's docs say the texture object stays
  in the main process. Only converted pixels leave it, through shared memory.
  This keeps plan 007's crash containment: DeckLink SDK code still runs in the
  helper.
- **One colour path.** The GPU shader must produce byte-identical UYVY to the
  helper's CPU `uyvy()` for the helper's `--self-test` vectors (black, white,
  Rec.709 red). Premultiplied alpha is composited on black exactly as today.
  Key/fill (unpremultiplied alpha) stays out of scope, as in plan 007.
- **Per-surface fallback.** If shared textures are unavailable (Linux, older
  GPU, addon failed to load, or any conversion error), that surface falls back
  to the current CPU path and logs once. The operator never loses picture over
  this.

## Current state (facts this plan relies on)

- Electron `33.4.11`. `Offscreen.useSharedTexture` is marked `@experimental`.
  On macOS and Windows, `TextureInfo.sharedTextureHandle` is a `Buffer` holding
  the native handle (IOSurfaceRef on macOS, NT shared handle on Windows); Linux
  exposes dmabuf `planes` instead. `OffscreenSharedTexture.release()` must be
  called promptly.
- `src/main/services/output/program-surface.ts` — `createOffscreenWindow` builds
  the offscreen window at 1/scale size with `zoomFactor: 1/scale` so it paints
  1920×1080; the `paint` handler calls `getBitmap()` and hands BGRA to
  `sink.channel.updateFrame` (NDI) or `sink.sink.setFrame` (device).
- `src/main/services/video-devices/providers/decklink/worker-sink.ts` and
  `playback-worker.ts` — current CPU transport: copy → worker → stdin pipe.
- `native/decklink/helper.cpp` — `--play` reads BGRA packets from stdin and
  converts with `uyvy()`; `--self-test` holds the colour test vectors.
- `src/main/services/ndi/` — `NdiSender.sendVideo` takes an `NdiVideoFrame`
  with `fourCC` and `lineStrideBytes`, so UYVY frames need no binding change
  (verify in Step 0).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test && npm run test:main` | all pass |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Helper self-test | `native/decklink/build/decklink-helper --self-test` | `{"ok":true}` |
| Card preview | `KAIRO_ENABLE_DECKLINK=1 npm run dev` | card output live |
| CPU sample | `ps -o pcpu= -p <Kairo main pid>` and `sample <pid> 5` | recorded per scenario |

## Scope

**In scope**: `native/gpu-frames/**` (new addon), `program-surface.ts` capture
branch, a frame-slot sink interface, shared-memory transport plus a
`--play-shm` mode in `native/decklink/helper.cpp`, UYVY NDI send path,
fallback/telemetry logging, packaging for macOS arm64 + x64, decision doc.

**Out of scope**: Windows D3D11 implementation (keep the interface ready; ship
macOS first), Linux dmabuf, key/fill, 10-bit output, HDR, changing what the
overlay page renders, and replacing Electron.

## Steps

### Step 0: Gate — baseline and feasibility

1. **Baseline (CPU path, after the 1× and worker fixes).** On the M2 Pro with the
   Duo 2 showing picture, play a 1080p motion background and record main-process
   CPU, helper CPU, and visible smoothness for: 1 card; 1 card + 1 NDI; 2 cards +
   1 NDI; 4 cards (Duo 2 in a four-output profile) + 1 NDI. Run the helper's
   late/dropped counters for 10 minutes on the heaviest case that is still smooth.
2. **Decide.** If the output count a church needs (assume 2 cards + 1 NDI unless
   the user says otherwise) is smooth with main-process CPU under ~60%, record
   that and mark this plan `REJECTED (not needed)`.
3. **Spike outside `src/`.** A minimal Electron 33 script with
   `offscreen: { useSharedTexture: true }` on a transparent window: confirm
   `paint` delivers `texture`, the pixel format is `bgra`, the coded size is
   1920×1080 with the 1/scale window trick, alpha is premultiplied, and how many
   textures can be held before rendering stalls. Repeat with a playing `<video>`.
4. **Electron version check.** Note whether a newer Electron drops the
   `@experimental` tag or changes the paint/texture shape. If upgrading is
   needed, that is a separate change landed first.
5. **NDI check.** Confirm the grandi binding sends UYVY (`fourCC` UYVY,
   `lineStrideBytes = width * 2`) and that ProPresenter's NDI input accepts it.

**Verify**: decision doc lists baseline numbers, the go/no-go decision, the
spike results (pool size, format, alpha), and the NDI UYVY result.

### Step 1: Capture branch and sink interface

Add a frame-slot interface that both NDI and device sinks implement alongside
the existing BGRA `setFrame`:

```ts
interface ConvertedFrameSink {
  /** UYVY Rec.709 limited, width*2 stride. Must not retain `frame` after returning. */
  setConvertedFrame(frame: Buffer | FrameSlot, width: number, height: number): void
}
```

In `createOffscreenWindow`, enable `useSharedTexture` only when the addon
loaded and the platform is supported. The `paint` handler takes the texture
path when `event.texture` is present, otherwise the current bitmap path.

**Verify**: with the addon absent, every existing surface test passes unchanged
and the CPU path is used.

### Step 2: `gpu-frames` addon (macOS)

N-API addon in `native/gpu-frames`:
- `open({ width, height })` → converter with a Metal device, a compiled
  BGRA→UYVY compute pipeline, and 2–3 output slots.
- `convert(handle: Buffer, done: (slot | error) => void)` — wraps the IOSurface
  from the handle, encodes the conversion, and on GPU completion reads the UYVY
  result into a free slot and calls `done` on the JS thread (threadsafe function).
  Returns `false` immediately if all slots are busy.
- The main thread calls `texture.release()` as soon as `convert` returns
  `false`, or in `done`.

Golden tests: the shader output for the helper's `--self-test` vectors matches
the CPU `uyvy()` byte for byte; a 1920×1080 gradient matches within ±1.

**Verify**: addon unit tests pass; a 10-minute spike run shows no texture-pool
stalls and conversion latency well under one frame (record p50/p99).

### Step 3: Shared-memory transport to the DeckLink helper

- Kairo creates a POSIX shared-memory ring (3 UYVY slots + a header with an
  atomic sequence number per slot) and passes its name to the helper:
  `decklink-helper --play-shm PORT MODE SHM_NAME`.
- The addon's readback writes straight into the ring slot; the helper copies the
  newest complete slot into its DeckLink frame in `ScheduledFrameCompleted`,
  exactly where it now copies `latest`.
- The helper keeps repeating the last frame on the hardware clock if no new slot
  arrives — unchanged pacing.
- Keep `--play` (stdin BGRA) as the fallback transport.

**Verify**: helper tests for torn-read protection (sequence check), ring
wrap-around, and helper exit when Kairo dies (shm unlinked, port released).

### Step 4: NDI UYVY path

The NDI sink sends converted UYVY frames when the GPU path is active, and BGRA
otherwise. The extra NDI senders follow the same rule.

**Verify**: ProPresenter receives the feed with correct colours (compare a
colour bar slide on both paths).

### Step 5: Fallback and diagnostics

- Any addon/conversion error switches that surface back to the CPU path for the
  rest of the session and logs one warning with the reason.
- Log per-surface capture mode at window creation (`gpu` / `cpu` and why).
- No user-facing setting at first; add an off switch only if Step 6 finds a
  machine where the GPU path misbehaves.

**Verify**: forcing an addon error mid-run keeps picture on the output and
logs the fallback once.

### Step 6: Qualification

Repeat the Step 0 baseline matrix on the GPU path and record the numbers next to
the CPU ones. Targets:
- main-process CPU roughly flat as outputs are added (no ~linear growth);
- 4 cards + 1 NDI smooth on the M2 Pro;
- 10-minute run: zero late/dropped frames on the helper, zero texture-pool stalls;
- visible colour identical to the CPU path on a reference slide.

Also test: Retina and non-Retina primary display, an external display unplugged
mid-run, sleep/wake, and replug of the Echo Express.

### Step 7: Packaging

Build and sign the addon per macOS tuple with Plan 003's scripts; confirm
`asarUnpack` covers it and that a machine where it fails to load still renders
through the CPU path.

## Done criteria

- [ ] Step 0 decision recorded (go, with baseline numbers).
- [ ] GPU path active on macOS, CPU path intact and used automatically elsewhere.
- [ ] Shader output matches the helper's colour vectors byte for byte.
- [ ] Step 6 targets met and recorded in the decision doc.
- [ ] No texture ever held past its frame; no texture-pool stalls in qualification.
- [ ] Typecheck, lint, tests, build pass; packaged app verified with and without the addon.
- [ ] README status row updated.

## STOP conditions

- Step 0 shows the CPU path already meets the targets → mark `REJECTED (not needed)`.
- `useSharedTexture` on Electron 33 cannot deliver transparent 1920×1080
  textures reliably, and an Electron upgrade is not acceptable right now.
- Keeping up with Chromium's texture pool requires holding textures across
  frames.
- The design would require running DeckLink SDK code inside Electron's main
  process (breaks plan 007's crash containment).
- GPU and CPU colour output cannot be made to match.

## Follow-ups (separate plans)

- Windows: D3D11 shared-handle converter behind the same addon interface.
- Linux: dmabuf import, or stay on the CPU path.
- Key/fill on the GPU path (unpremultiply on the GPU, two output slots).
- Capture rate matched to the card's mode (23.98 / 29.97 / 50 / 59.94).

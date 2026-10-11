# 008 — GPU shared-texture frame capture

- **Date**: 2026-10-11
- **Plan**: `plans/008-gpu-frame-capture.md`
- **Status**: Implemented on macOS behind automatic fallback; physical qualification (Step 6) outstanding.

## Step 0 gate

The plan asks for a CPU-path baseline on the Duo 2 before any runtime code.
**The owner waived the gate on 2026-10-11 and asked for the plan to be
implemented.** The baseline matrix (1 card; 1 card + 1 NDI; 2 cards + 1 NDI;
4 cards + 1 NDI) has not been measured. It should be taken together with
Step 6 so the CPU and GPU columns sit side by side below.

### Drift check

`git diff --stat 87c09ff..HEAD` over the plan's paths: no commits since the plan.
Plan 007's DeckLink work was uncommitted in the working tree; the plan's facts
matched it (Electron 33.4.11, `getBitmap()` paint path, helper `uyvy()` and
`--self-test` vectors, `NdiSender.sendVideo` taking `fourCC` + `lineStrideBytes`).

### Feasibility spike (Step 0.3) — M2 Pro, Retina primary display (scale 2)

Script outside `src/`: offscreen transparent window, `useSharedTexture: true`,
the 1/scale window + `zoomFactor: 1/scale` trick, animated canvas page, 30 fps,
texture released inside the paint handler.

| Measurement | Result |
|---|---|
| `paint` delivers `event.texture` | yes; the `image` argument is empty |
| `widgetType` / `pixelFormat` | `frame` / `bgra` |
| `codedSize`, `visibleRect`, `contentRect` | 1920×1080, full frame |
| `sharedTextureHandle` | 8-byte `Buffer` (IOSurfaceRef) |
| Rate | 29.6 fps of 30 requested, no gap over 100 ms |
| Main-process CPU | 2.2 % |

Not measured: the `<video>` case and the texture-pool depth. The spike harness
quit after its first window closed (Electron's default `window-all-closed`),
which was fixed but not re-run before the go-ahead. The design does not depend
on the pool depth: textures are never held past the GPU conversion (see below).
Premultiplied alpha is assumed from Chromium's compositor and is handled exactly
as the CPU path handles it.

### Electron version (Step 0.4)

`useSharedTexture` and `OffscreenSharedTexture` remain `@experimental` in 33.4.11.
No upgrade was needed for this implementation.

### NDI (Step 0.5)

grandi 2.0.2 types list `FourCC.UYVA = 1096178005` and `FourCC.UYVY` as video
formats and pass `fourCC`/`lineStrideBytes` through. UYVA is a standard NDI
format, but receiver acceptance (ProPresenter, OBS, vMix, NDI Studio Monitor —
whatever the church uses) is **not yet verified**.

## Decisions

1. **NDI sends UYVA, not UYVY.** Kairo's NDI feeds are transparent overlays
   that receivers key over other video; plain UYVY would turn them into black full frames.
   UYVA is the UYVY plane (stride width×2) followed by a width×height alpha
   plane. Colour comes from the same premultiplied values the CPU path sends as
   BGRA today, so keying behaves as before.
2. **One colour path.** `uyvy()` and the nearest-neighbour scaler moved to
   `native/decklink/uyvy.h`. The helper uses it for `--play`; the gpu-frames
   golden tests compile it as the reference. The Metal kernel repeats the same
   integer maths and matches **byte for byte** — the self-test vectors (black,
   white, Rec.709 red), a 1080p premultiplied gradient, 1080p→720p scaling, and
   a 2× (3840×2160) paint scaled to 1080p. The plan allowed ±1; none was needed.
3. **Textures are never queued.** The converter has three output slots. When
   all are busy, `convert` returns false and the texture is released in the
   paint handler — the frame is dropped. Otherwise it is released in the GPU
   completion callback.
4. **The ring belongs to the sink, not the surface.** `DeckLinkProvider` creates
   the POSIX shm ring at the mode raster when it opens an output and starts the
   helper with `--play-shm`. The helper reports `{"event":"ring","ok":…}`
   before `started`; the sink only exposes `frameRing` when it attached.
   `closeRing` unlinks at once but keeps the mapping until every converter
   writing to it has drained, so a sink closing under a live surface cannot
   fault the GPU write. A converter on a closed ring drops frames silently.
5. **The helper keeps stdin BGRA in `--play-shm` mode.** That is the CPU
   fallback, so falling back never restarts the helper or the output.
6. **Fallback is per surface and permanent for the session.** Any addon or
   GPU error logs one warning and rebuilds that surface's window without
   shared textures (a shared-texture window paints no bitmap). The slide is
   restored by the normal recovery path.
7. **No user setting.** `KAIRO_GPU_CAPTURE=0` forces the CPU path for
   diagnosis; add a setting only if qualification finds a misbehaving machine.

## Measured so far (this machine, no card)

| Check | Result |
|---|---|
| `gpu-frames` golden + behaviour tests | 7/7 pass |
| 1080p UYVA convert + readback, submit → JS callback | p50 0.6 ms, p99 1.5–2.2 ms |
| Ring seqlock: in-progress slot, torn read, wrap-around (50 frames) | pass |
| Helper `--self-test` after the `uyvy.h` move | `{"ok":true}` |
| Packaged `--dir` build | addon at `Contents/Resources/gpu-frames/gpu_frames.node`, universal (arm64 + x86_64); `verify-package` PASS |

## Outstanding (Step 6 qualification)

These need the Duo 2, an NDI receiver, and someone watching the output. None
of this depends on ProPresenter: cards and NDI are Kairo's own outputs.

- [ ] CPU baseline matrix (Step 0.1) and the same matrix on the GPU path; main-process CPU roughly flat as outputs are added.
- [ ] 4 cards + 1 NDI smooth; 10-minute run with zero late/dropped helper frames.
- [ ] Colour identical to the CPU path on a reference slide (card and NDI).
- [ ] The NDI receivers in use (e.g. NDI Studio Monitor, OBS, vMix, ProPresenter) accept the UYVA feed and key it like the BGRA one.
- [ ] Real Electron paint → addon path running in the app (logs show `capture: gpu`).
- [ ] Forced addon error mid-run keeps picture and logs the fallback once.
- [ ] Retina / non-Retina primary, display unplug, sleep/wake, Echo Express replug.
- [ ] Signed package: addon signed and loaded; a build without it renders through the CPU path.

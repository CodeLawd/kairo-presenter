# gpu-frames native addon

Converts Chromium's offscreen shared textures (IOSurface, premultiplied BGRA)
to UYVY or UYVA on the GPU with Metal. Plan 008; decisions in
`docs/decisions/008-gpu-frame-capture.md`.

```sh
npm run build:gpu-frames   # universal arm64 + x86_64 → build/gpu_frames.node
npm run test:gpu-frames    # golden colour tests, ring seqlock, IOSurface path, latency
```

The addon is pure N-API, so one binary loads in Node (tests) and in Electron's
main process. The shader is compiled from source when the addon loads, so no
Metal toolchain is needed to package it. macOS only; other platforms keep the
CPU capture path.

- `open({ width, height, alpha?, ring? })` — a converter. `alpha` adds the UYVA
  alpha plane (NDI). `ring` writes UYVY straight into a shared-memory ring
  slot (video cards).
- `convert(converter, sharedTextureHandle, done)` — false when all three slots
  are busy; the caller releases the texture and the frame is dropped. On true,
  release the texture in `done`.
- `createRing(name, width, height)` / `closeRing(ring)` — the POSIX ring the
  DeckLink helper reads with `--play-shm`. Layout and seqlock: `ring.h`.

The colour maths matches `native/decklink/uyvy.h` byte for byte; the tests
compile that header as the reference.

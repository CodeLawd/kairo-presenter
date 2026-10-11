# DeckLink native helper

Build on macOS with an extracted Blackmagic DeckLink SDK (16.0):

```sh
DECKLINK_SDK_PATH='/path/to/Blackmagic DeckLink SDK 16.0' node native/decklink/build.mjs
node --test native/decklink/tests/probe.test.mjs
native/decklink/build/decklink-helper --list
native/decklink/build/decklink-helper --probe PORT_ID MODE_ID 600
```

The helper dynamically loads the user's installed Desktop Video framework. It
runs outside Electron so SDK failures cannot crash the main process. No vendor
framework or SDK sample implementation is redistributed. SDK headers and dispatch
source are inputs to compilation only; do not commit the downloaded SDK.

`--probe` emits a solid red image using three immutable UYVY preroll frames and
repeats frames on SDK completion callbacks. A blocked main thread or frozen
producer does not pace output. JSON progress records actual completed, late,
dropped and flushed frame counts. Exit 0 requires completed frames and no late,
dropped or scheduling errors. It does not certify what a physical monitor shows.

Only use a free output: the probe acquires it for the requested duration. This is
a qualification tool. `--play PORT MODE` accepts 12-byte little-endian
width/height/payload-length headers followed by immutable BGRA bytes. Conversion
and nearest-neighbor scaling run in the native helper. Chromium premultiplied RGB
is composited against black for opaque output; external key/fill stays disabled.
`--play-shm PORT MODE RING` does the same and also reads UYVY frames, already
at the mode raster, from Kairo's GPU frame ring (plan 008, `native/gpu-frames/ring.h`).
It prints `{"event":"ring","ok":...}` before `started`; stdin BGRA keeps working
as the CPU fallback, and the helper unlinks the ring when it exits. The BGRA→UYVY
conversion lives in `uyvy.h`, shared with the gpu-frames golden tests.
Only HD modes are advertised until SD Rec.601 is implemented. Key/fill,
source frame transport, profile changes and packaging remain to be qualified.

## Kairo development preview

After building the helper, run `KAIRO_ENABLE_DECKLINK=1 npm run dev`. Add a Video
card output, select an available channel and HD mode, and enable it. The provider
is opt-in until physical picture, profile/replug/busy behavior and signed package
qualification are complete. Normal releases do not enable this preview. The SDK
is a build-time requirement only; users need Desktop Video drivers.

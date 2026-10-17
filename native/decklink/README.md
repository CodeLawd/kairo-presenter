# DeckLink native helper

Build on macOS with an extracted Blackmagic DeckLink SDK (16.0):

```sh
DECKLINK_SDK_PATH='/path/to/Blackmagic DeckLink SDK 16.0' node native/decklink/build.mjs
node --test native/decklink/tests/probe.test.mjs
DECKLINK_SDK_PATH='/path/to/Blackmagic DeckLink SDK 16.0' node --test native/decklink/tests/compatibility.test.mjs
native/decklink/build/decklink-helper --list
native/decklink/build/decklink-helper --probe PORT_ID MODE_ID 600
```

The helper dynamically loads the user's installed Desktop Video framework. It
runs outside Electron so SDK failures cannot crash the main process. No vendor
framework or SDK sample implementation is redistributed. SDK headers and dispatch
source are inputs to compilation only; do not commit the downloaded SDK.

## Runtime compatibility

The helper negotiates current interfaces first, then the SDK's explicit
15.3.1 interfaces for output, profile attributes, and writable frame buffers.
The buffer interfaces have different vtable layouts and are called through
their own types. Drivers older than 15.3.1 are outside this compatibility target.
The same negotiation is used for discovery, test patterns, and live playback.
Inventory includes `compatibilityMode` from actual negotiated output/attribute
interfaces. `decklink-helper --version` reads the runtime version independently
of device enumeration, so an unsupported runtime can still receive update
guidance when its device interfaces fail. The Hardware tab offers downloads only
for missing/unsupported drivers; working compatibility mode is informational.

Every enumerated sub-device is listed, including unavailable ones. Inactive
channels show guidance to check connector mapping in Desktop Video Setup. A
Duo 2 configured with paired/full-duplex connectors may offer two independent
channels instead of four; Kairo does not change the card profile automatically.

Automated tests cover negotiation, frame-buffer writes, attribute access and
preservation of four-channel inventory/profile reasons. Physical playback on
Desktop Video 15.3.1 and 16.4 still needs hardware qualification. To qualify:
quit other apps using the card, refresh in Kairo, check all expected ports, run
color bars then live content on each available port, and confirm clean shutdown
and reopening. Record the driver version, model, connector mapping and mode.

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

## Kairo development

After building the helper, run `npm run dev`. Add a Video
card output, select an available channel and HD mode, and enable it. The provider
is enabled on macOS; `KAIRO_ENABLE_DECKLINK=0` disables it for diagnosis. The SDK
is a build-time requirement only; users need Desktop Video drivers. After source
changes, run `DECKLINK_SDK_PATH='/path/to/Blackmagic DeckLink SDK 16.0' npm run prepare:mac-natives`
to refresh the universal prebuilt helper and its source hash before packaging.

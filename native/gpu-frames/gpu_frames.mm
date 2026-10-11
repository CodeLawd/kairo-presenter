// gpu-frames — converts Chromium's offscreen shared textures (IOSurface, BGRA,
// premultiplied) to UYVY / UYVA on the GPU. Plan 008, Step 2.
//
// Pure N-API (no node-addon-api), so the same binary loads in Node for tests
// and in Electron's main process. The Metal shader is compiled from source at
// load time — no Metal toolchain is needed to package it.
//
// The colour maths is a copy of `uyvy()` in native/decklink/helper.cpp, in
// integers, so the GPU path is byte-identical to the CPU path.
#define NAPI_VERSION 8
#include <node_api.h>

#import <CoreFoundation/CoreFoundation.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <cstring>
#include <mutex>
#include <string>

#include "ring.h"

// ─── Shader ───────────────────────────────────────────────────────────────────

static const char* kShaderSource = R"METAL(
#include <metal_stdlib>
using namespace metal;

struct Params { uint srcW; uint srcH; uint dstW; uint dstH; uint alpha; uint pad; };

inline int clamp8(int x) { return clamp(x, 0, 255); }
inline int luma(int r, int g, int b) { return clamp8(((47 * r + 157 * g + 16 * b + 128) >> 8) + 16); }
inline int4 bytesOf(float4 c) { return int4(rint(c * 255.0)); }

// One thread per UYVY group (two output pixels). Nearest-neighbour scaling uses
// the helper's integer mapping, so equal-size input is copied pixel for pixel.
kernel void bgra_to_uyvy(texture2d<float, access::read> src [[texture(0)]],
                         device uchar* dst [[buffer(0)]],
                         constant Params& p [[buffer(1)]],
                         uint2 gid [[thread_position_in_grid]]) {
  const uint x = gid.x * 2, y = gid.y;
  if (x >= p.dstW || y >= p.dstH) return;
  const uint sy = y * p.srcH / p.dstH;
  const int4 a = bytesOf(src.read(uint2(x * p.srcW / p.dstW, sy)));
  const int4 c = bytesOf(src.read(uint2((x + 1) * p.srcW / p.dstW, sy)));
  // Metal reads BGRA8 as (r, g, b, a). Premultiplied RGB is the colour
  // composited on black, as the CPU path sends it.
  const int r = (a.r + c.r) / 2, g = (a.g + c.g) / 2, b = (a.b + c.b) / 2;
  const uint o = (y * p.dstW + x) * 2;
  dst[o + 0] = uchar(clamp8(((-26 * r - 87 * g + 112 * b + 128) >> 8) + 128));
  dst[o + 1] = uchar(luma(a.r, a.g, a.b));
  dst[o + 2] = uchar(clamp8(((112 * r - 102 * g - 10 * b + 128) >> 8) + 128));
  dst[o + 3] = uchar(luma(c.r, c.g, c.b));
  if (p.alpha != 0) {
    // NDI UYVA: the alpha plane follows the UYVY plane, one byte per pixel.
    const uint ao = p.dstW * p.dstH * 2 + y * p.dstW + x;
    dst[ao] = uchar(a.a);
    dst[ao + 1] = uchar(c.a);
  }
}
)METAL";

struct Params { uint32_t srcW, srcH, dstW, dstH, alpha, pad; };

// ─── Metal singleton ──────────────────────────────────────────────────────────

struct Gpu {
  id<MTLDevice> device = nil;
  id<MTLCommandQueue> queue = nil;
  id<MTLComputePipelineState> pipeline = nil;
  std::string error;
};

static Gpu& gpu() {
  static Gpu instance;
  static std::once_flag once;
  std::call_once(once, [] {
    @autoreleasepool {
      instance.device = MTLCreateSystemDefaultDevice();
      if (!instance.device) { instance.error = "No Metal device"; return; }
      NSError* err = nil;
      id<MTLLibrary> library = [instance.device newLibraryWithSource:@(kShaderSource) options:nil error:&err];
      if (!library) { instance.error = std::string("Shader compile failed: ") + (err ? err.localizedDescription.UTF8String : "unknown"); return; }
      id<MTLFunction> fn = [library newFunctionWithName:@"bgra_to_uyvy"];
      instance.pipeline = [instance.device newComputePipelineStateWithFunction:fn error:&err];
      if (!instance.pipeline) { instance.error = std::string("Pipeline failed: ") + (err ? err.localizedDescription.UTF8String : "unknown"); return; }
      instance.queue = [instance.device newCommandQueue];
      if (!instance.queue) instance.error = "No command queue";
    }
  });
  return instance;
}

static void encode(id<MTLCommandBuffer> cb, id<MTLTexture> src, id<MTLBuffer> dst, const Params& params) {
  id<MTLComputeCommandEncoder> enc = [cb computeCommandEncoder];
  [enc setComputePipelineState:gpu().pipeline];
  [enc setTexture:src atIndex:0];
  [enc setBuffer:dst offset:0 atIndex:0];
  [enc setBytes:&params length:sizeof(params) atIndex:1];
  const MTLSize group = MTLSizeMake(16, 16, 1);
  const MTLSize groups = MTLSizeMake((params.dstW / 2 + 15) / 16, (params.dstH + 15) / 16, 1);
  [enc dispatchThreadgroups:groups threadsPerThreadgroup:group];
  [enc endEncoding];
}

// ─── N-API helpers ────────────────────────────────────────────────────────────

#define CHECK(call) do { if ((call) != napi_ok) { return fail(env, "N-API call failed: " #call); } } while (0)

static napi_value fail(napi_env env, const std::string& message) {
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (!pending) napi_throw_error(env, nullptr, message.c_str());
  return nullptr;
}

static napi_value undefined(napi_env env) { napi_value v; napi_get_undefined(env, &v); return v; }

static bool getUint(napi_env env, napi_value obj, const char* key, uint32_t& out) {
  napi_value v; bool has = false;
  if (napi_has_named_property(env, obj, key, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, obj, key, &v) != napi_ok) return false;
  return napi_get_value_uint32(env, v, &out) == napi_ok;
}

static bool getBool(napi_env env, napi_value obj, const char* key) {
  napi_value v; bool has = false, out = false;
  if (napi_has_named_property(env, obj, key, &has) != napi_ok || !has) return false;
  napi_get_named_property(env, obj, key, &v);
  napi_get_value_bool(env, v, &out);
  return out;
}

static napi_value makeUint(napi_env env, double value) { napi_value v; napi_create_double(env, value, &v); return v; }

static void setProp(napi_env env, napi_value obj, const char* key, napi_value value) {
  napi_set_named_property(env, obj, key, value);
}

static bool validRaster(uint32_t w, uint32_t h) {
  return w >= 2 && h >= 1 && w % 2 == 0 && w <= 4096 && h <= 2160;
}

// ─── Ring ─────────────────────────────────────────────────────────────────────

struct Ring {
  std::string name;
  void* base = nullptr;
  size_t bytes = 0;
  kairo_ring::Header* header = nullptr;
  uint32_t width = 0, height = 0;
  size_t slotBytes = 0;
  std::atomic<bool> closed{false};
  /** Converters writing here. The mapping outlives `close()` until they drain. */
  std::atomic<int> attached{0};
  std::mutex mapLock;

  /** Unlinks now; unmaps once no converter can still be writing. */
  void close() {
    if (closed.exchange(true)) return;
    shm_unlink(name.c_str()); // ENOENT is fine: the helper may have unlinked it.
    if (attached.load() == 0) unmap();
  }
  void detach() {
    if (--attached == 0 && closed.load()) unmap();
  }
  void unmap() {
    std::lock_guard<std::mutex> guard(mapLock);
    if (base) munmap(base, bytes);
    base = nullptr; header = nullptr;
  }
};

static void finalizeRing(napi_env, void* data, void*) {
  auto* ring = static_cast<Ring*>(data);
  ring->close();
  ring->unmap();
  delete ring;
}

static Ring* unwrapRing(napi_env env, napi_value value) {
  void* data = nullptr;
  if (napi_get_value_external(env, value, &data) != napi_ok || !data) return nullptr;
  return static_cast<Ring*>(data);
}

// createRing(name, width, height) → external
static napi_value CreateRing(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (argc < 3) return fail(env, "createRing(name, width, height)");
  char name[64]; size_t len = 0;
  if (napi_get_value_string_utf8(env, argv[0], name, sizeof(name), &len) != napi_ok || len == 0 || len > 30 || name[0] != '/') {
    return fail(env, "Ring name must start with / and be at most 30 characters");
  }
  uint32_t w = 0, h = 0;
  napi_get_value_uint32(env, argv[1], &w);
  napi_get_value_uint32(env, argv[2], &h);
  if (!validRaster(w, h)) return fail(env, "Invalid ring raster");

  auto* ring = new Ring();
  ring->name = name; ring->width = w; ring->height = h;
  ring->slotBytes = kairo_ring::slotBytesFor(w, h);
  ring->bytes = kairo_ring::totalBytes(ring->slotBytes);
  shm_unlink(name); // A stale ring from a crashed run must not be reused.
  const int fd = shm_open(name, O_CREAT | O_EXCL | O_RDWR, 0600);
  if (fd < 0) { delete ring; return fail(env, std::string("shm_open failed: ") + strerror(errno)); }
  if (ftruncate(fd, static_cast<off_t>(ring->bytes)) != 0) {
    const std::string why = strerror(errno);
    ::close(fd); shm_unlink(name); delete ring;
    return fail(env, "ftruncate failed: " + why);
  }
  ring->base = mmap(nullptr, ring->bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  ::close(fd);
  if (ring->base == MAP_FAILED) { ring->base = nullptr; shm_unlink(name); delete ring; return fail(env, "mmap failed"); }
  ring->header = static_cast<kairo_ring::Header*>(ring->base);
  kairo_ring::initHeader(ring->header, w, h);

  napi_value external;
  CHECK(napi_create_external(env, ring, finalizeRing, nullptr, &external));
  return external;
}

static napi_value CloseRing(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Ring* ring = argc ? unwrapRing(env, argv[0]) : nullptr;
  if (!ring) return fail(env, "closeRing(ring)");
  ring->close();
  return undefined(env);
}

// readRing(ring) → { published, latest, seqs: number[], frame: Buffer | null } — tests and diagnostics.
static napi_value ReadRing(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Ring* ring = argc ? unwrapRing(env, argv[0]) : nullptr;
  if (!ring || ring->closed) return fail(env, "readRing(ring): ring closed");
  napi_value out, seqs;
  napi_create_object(env, &out);
  napi_create_array_with_length(env, kairo_ring::SLOTS, &seqs);
  for (uint32_t i = 0; i < kairo_ring::SLOTS; ++i) {
    napi_set_element(env, seqs, i, makeUint(env, double(ring->header->slots[i].seq.load())));
  }
  setProp(env, out, "published", makeUint(env, double(ring->header->published.load())));
  setProp(env, out, "latest", makeUint(env, ring->header->latest.load()));
  setProp(env, out, "seqs", seqs);
  const size_t bytes = kairo_ring::frameBytes(ring->width, ring->height);
  void* data = nullptr; napi_value frame;
  napi_create_buffer(env, bytes, &data, &frame);
  uint64_t last = 0;
  if (kairo_ring::readNewest(ring->header, ring->base, last, static_cast<uint8_t*>(data), bytes)) setProp(env, out, "frame", frame);
  else { napi_value nul; napi_get_null(env, &nul); setProp(env, out, "frame", nul); }
  return out;
}

// ─── Converter ────────────────────────────────────────────────────────────────

struct Converter;

struct Pending {
  Converter* converter;
  uint32_t slot;
  napi_ref done;
  std::string error;
  uint64_t sequence = 0;
};

struct Converter {
  uint32_t width = 0, height = 0;
  bool alpha = false;
  Ring* ring = nullptr;
  napi_ref ringRef = nullptr;
  size_t outBytes = 0;
  id<MTLBuffer> buffers[kairo_ring::SLOTS] = {nil, nil, nil};
  bool busy[kairo_ring::SLOTS] = {false, false, false};
  uint32_t inFlight = 0;
  std::mutex lock;
  napi_threadsafe_function tsfn = nullptr;
  id<MTLCommandBuffer> last = nil;
  bool closed = false;
  uint64_t converted = 0, skipped = 0, failed = 0;
  /** The JS handle and the threadsafe function each hold one; the last to let go frees it. */
  std::atomic<int> owners{2};
};

static void releaseOwner(Converter* c) {
  if (--c->owners == 0) delete c;
}

/** Picks a free slot; in ring mode never the newest complete one, which readers may be copying. */
static int takeSlot(Converter* c) {
  std::lock_guard<std::mutex> guard(c->lock);
  const uint32_t avoid = c->ring ? c->ring->header->latest.load(std::memory_order_acquire) : kairo_ring::SLOTS;
  const bool anyPublished = c->ring && c->ring->header->published.load(std::memory_order_acquire) > 0;
  for (uint32_t i = 0; i < kairo_ring::SLOTS; ++i) {
    if (c->busy[i] || (anyPublished && i == avoid)) continue;
    c->busy[i] = true; ++c->inFlight;
    return int(i);
  }
  return -1;
}

static void freeSlot(Converter* c, uint32_t slot) {
  std::lock_guard<std::mutex> guard(c->lock);
  c->busy[slot] = false;
  if (c->inFlight) --c->inFlight;
}

static void callJs(napi_env env, napi_value, void* context, void* data) {
  auto* pending = static_cast<Pending*>(data);
  auto* c = static_cast<Converter*>(context);
  if (!env) { freeSlot(c, pending->slot); delete pending; return; }
  napi_value done = nullptr, global, argv[2];
  napi_get_reference_value(env, pending->done, &done);
  napi_get_global(env, &global);
  if (!pending->error.empty()) {
    napi_value msg; napi_create_string_utf8(env, pending->error.c_str(), NAPI_AUTO_LENGTH, &msg);
    napi_create_error(env, nullptr, msg, &argv[0]);
    argv[1] = undefined(env);
  } else {
    napi_get_null(env, &argv[0]);
    if (c->ring) {
      napi_create_object(env, &argv[1]);
      setProp(env, argv[1], "slot", makeUint(env, pending->slot));
      setProp(env, argv[1], "sequence", makeUint(env, double(pending->sequence)));
    } else {
      void* copy = nullptr;
      napi_create_buffer_copy(env, c->outBytes, c->buffers[pending->slot].contents, &copy, &argv[1]);
    }
  }
  freeSlot(c, pending->slot);
  napi_delete_reference(env, pending->done);
  delete pending;
  bool idle;
  { std::lock_guard<std::mutex> guard(c->lock); idle = c->inFlight == 0; }
  if (idle && c->tsfn && !c->closed) napi_unref_threadsafe_function(env, c->tsfn);
  if (done) napi_call_function(env, global, done, 2, argv, nullptr);
}

static void finalizeTsfn(napi_env env, void* data, void*) {
  auto* c = static_cast<Converter*>(data);
  // All GPU work has drained by now, so the ring's memory may go.
  if (c->ring) c->ring->detach();
  if (c->ringRef && env) napi_delete_reference(env, c->ringRef);
  c->ringRef = nullptr;
  releaseOwner(c);
}

static void closeConverter(napi_env env, Converter* c) {
  if (c->closed) return;
  c->closed = true;
  // At most a frame of GPU work is outstanding; let it land so no slot or
  // texture is still in use once the caller tears the sink down.
  if (c->last) [c->last waitUntilCompleted];
  c->last = nil;
  if (c->tsfn) {
    napi_ref_threadsafe_function(env, c->tsfn); // drain queued completions, then finalize
    napi_release_threadsafe_function(c->tsfn, napi_tsfn_release);
  }
}

static void finalizeConverterHandle(napi_env env, void* data, void*) {
  auto* c = static_cast<Converter*>(data);
  closeConverter(env, c);
  releaseOwner(c);
}

static Converter* unwrapConverter(napi_env env, napi_value value) {
  void* data = nullptr;
  if (napi_get_value_external(env, value, &data) != napi_ok || !data) return nullptr;
  return static_cast<Converter*>(data);
}

// open({ width, height, alpha?, ring? }) → external
static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (!gpu().error.empty()) return fail(env, gpu().error);
  if (argc < 1) return fail(env, "open(options)");
  auto* c = new Converter();
  if (!getUint(env, argv[0], "width", c->width) || !getUint(env, argv[0], "height", c->height) || !validRaster(c->width, c->height)) {
    delete c; return fail(env, "open: invalid width/height");
  }
  c->alpha = getBool(env, argv[0], "alpha");
  c->outBytes = kairo_ring::frameBytes(c->width, c->height) + (c->alpha ? size_t(c->width) * c->height : 0);
  napi_value ringValue; bool hasRing = false;
  napi_has_named_property(env, argv[0], "ring", &hasRing);
  @autoreleasepool {
    if (hasRing) {
      napi_get_named_property(env, argv[0], "ring", &ringValue);
      c->ring = unwrapRing(env, ringValue);
      if (!c->ring || c->ring->closed || c->alpha || c->ring->width != c->width || c->ring->height != c->height) {
        delete c; return fail(env, "open: ring must be open, UYVY, and the converter's raster");
      }
      napi_create_reference(env, ringValue, 1, &c->ringRef);
      ++c->ring->attached;
      for (uint32_t i = 0; i < kairo_ring::SLOTS; ++i) {
        c->buffers[i] = [gpu().device newBufferWithBytesNoCopy:kairo_ring::slotData(c->ring->base, i, c->ring->slotBytes)
                                                        length:c->ring->slotBytes
                                                       options:MTLResourceStorageModeShared
                                                   deallocator:nil];
      }
    } else {
      for (uint32_t i = 0; i < kairo_ring::SLOTS; ++i) {
        c->buffers[i] = [gpu().device newBufferWithLength:c->outBytes options:MTLResourceStorageModeShared];
      }
    }
    for (auto& buffer : c->buffers) if (!buffer) {
      if (c->ring) c->ring->detach();
      if (c->ringRef) napi_delete_reference(env, c->ringRef);
      delete c; return fail(env, "open: could not allocate GPU output slots");
    }
  }
  napi_value name;
  napi_create_string_utf8(env, "kairo-gpu-frames", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, c, finalizeTsfn, c, callJs, &c->tsfn) != napi_ok) {
    if (c->ring) c->ring->detach();
    if (c->ringRef) napi_delete_reference(env, c->ringRef);
    delete c; return fail(env, "open: threadsafe function failed");
  }
  napi_unref_threadsafe_function(env, c->tsfn);
  napi_value external;
  CHECK(napi_create_external(env, c, finalizeConverterHandle, nullptr, &external));
  return external;
}

static napi_value Close(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Converter* c = argc ? unwrapConverter(env, argv[0]) : nullptr;
  if (!c) return fail(env, "close(converter)");
  closeConverter(env, c);
  return undefined(env);
}

/**
 * Starts converting one frame. Returns false at once when every slot is busy —
 * the caller releases the texture and the frame is dropped; textures are never
 * queued. On true, `done(err, result)` runs on the JS thread once the GPU is
 * finished with the texture, and only then may it be released.
 */
static bool startConvert(napi_env env, Converter* c, id<MTLTexture> src, napi_value done) {
  const int slot = takeSlot(c);
  if (slot < 0) { ++c->skipped; return false; }
  auto* pending = new Pending{c, uint32_t(slot), nullptr, {}, 0};
  napi_create_reference(env, done, 1, &pending->done);
  const Params params{uint32_t(src.width), uint32_t(src.height), c->width, c->height, c->alpha ? 1u : 0u, 0};
  Ring* ring = c->ring;
  if (ring) kairo_ring::beginWrite(ring->header, uint32_t(slot));
  id<MTLCommandBuffer> cb = [gpu().queue commandBuffer];
  encode(cb, src, c->buffers[slot], params);
  napi_threadsafe_function tsfn = c->tsfn;
  [cb addCompletedHandler:^(id<MTLCommandBuffer> finished) {
    // `src` is captured so the IOSurface stays wrapped until the GPU is done.
    (void)src;
    if (finished.status != MTLCommandBufferStatusCompleted) {
      pending->error = std::string("GPU conversion failed: ") +
        (finished.error ? finished.error.localizedDescription.UTF8String : "unknown");
    }
    if (ring && !ring->closed) {
      if (pending->error.empty()) {
        kairo_ring::endWrite(ring->header, pending->slot);
        pending->sequence = ring->header->published.load(std::memory_order_acquire);
      } else {
        ring->header->slots[pending->slot].seq.fetch_add(1, std::memory_order_release); // back to even, unpublished
      }
    }
    if (napi_call_threadsafe_function(tsfn, pending, napi_tsfn_nonblocking) != napi_ok) {
      // Only during teardown: the converter is closing and its slots go with
      // it. The callback reference cannot be deleted off the JS thread.
      delete pending;
    }
  }];
  napi_ref_threadsafe_function(env, tsfn);
  c->last = cb;
  [cb commit];
  ++c->converted;
  return true;
}

// convert(converter, handle: Buffer, done) → boolean
static napi_value Convert(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Converter* c = argc >= 3 ? unwrapConverter(env, argv[0]) : nullptr;
  if (!c || c->closed) return fail(env, "convert: converter closed");
  if (c->ring && c->ring->closed.load()) {
    // The sink let go of its ring (replug, output off); the surface is being
    // retargeted. Drop quietly rather than report a GPU failure.
    ++c->skipped;
    napi_value no; napi_get_boolean(env, false, &no);
    return no;
  }
  void* handleBytes = nullptr; size_t handleLength = 0;
  if (napi_get_buffer_info(env, argv[1], &handleBytes, &handleLength) != napi_ok || handleLength < sizeof(IOSurfaceRef)) {
    return fail(env, "convert: sharedTextureHandle must hold an IOSurfaceRef");
  }
  IOSurfaceRef surface = nullptr;
  std::memcpy(&surface, handleBytes, sizeof(surface));
  if (!surface) return fail(env, "convert: null IOSurface");
  if (IOSurfaceGetPixelFormat(surface) != 'BGRA') { ++c->failed; return fail(env, "convert: IOSurface is not BGRA"); }
  bool started = false;
  @autoreleasepool {
    MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                    width:IOSurfaceGetWidth(surface)
                                                                                   height:IOSurfaceGetHeight(surface)
                                                                                mipmapped:NO];
    desc.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> src = [gpu().device newTextureWithDescriptor:desc iosurface:surface plane:0];
    if (!src) { ++c->failed; return fail(env, "convert: could not wrap IOSurface"); }
    started = startConvert(env, c, src, argv[2]);
  }
  napi_value result; napi_get_boolean(env, started, &result);
  return result;
}

// stats(converter) → { converted, skipped, failed, inFlight }
static napi_value Stats(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Converter* c = argc ? unwrapConverter(env, argv[0]) : nullptr;
  if (!c) return fail(env, "stats(converter)");
  napi_value out; napi_create_object(env, &out);
  setProp(env, out, "converted", makeUint(env, double(c->converted)));
  setProp(env, out, "skipped", makeUint(env, double(c->skipped)));
  setProp(env, out, "failed", makeUint(env, double(c->failed)));
  setProp(env, out, "inFlight", makeUint(env, c->inFlight));
  return out;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

// convertPixels(bgra, srcW, srcH, dstW, dstH, alpha) → Buffer. Synchronous; golden tests.
static napi_value ConvertPixels(napi_env env, napi_callback_info info) {
  size_t argc = 6; napi_value argv[6];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (!gpu().error.empty()) return fail(env, gpu().error);
  if (argc < 6) return fail(env, "convertPixels(bgra, srcW, srcH, dstW, dstH, alpha)");
  void* bytes = nullptr; size_t length = 0;
  CHECK(napi_get_buffer_info(env, argv[0], &bytes, &length));
  uint32_t sw = 0, sh = 0, dw = 0, dh = 0; bool alpha = false;
  napi_get_value_uint32(env, argv[1], &sw); napi_get_value_uint32(env, argv[2], &sh);
  napi_get_value_uint32(env, argv[3], &dw); napi_get_value_uint32(env, argv[4], &dh);
  napi_get_value_bool(env, argv[5], &alpha);
  if (!sw || !sh || length != size_t(sw) * sh * 4 || !validRaster(dw, dh)) return fail(env, "convertPixels: bad dimensions");
  const size_t outBytes = kairo_ring::frameBytes(dw, dh) + (alpha ? size_t(dw) * dh : 0);
  napi_value result;
  @autoreleasepool {
    MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm width:sw height:sh mipmapped:NO];
    desc.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> src = [gpu().device newTextureWithDescriptor:desc];
    [src replaceRegion:MTLRegionMake2D(0, 0, sw, sh) mipmapLevel:0 withBytes:bytes bytesPerRow:sw * 4];
    id<MTLBuffer> dst = [gpu().device newBufferWithLength:outBytes options:MTLResourceStorageModeShared];
    id<MTLCommandBuffer> cb = [gpu().queue commandBuffer];
    encode(cb, src, dst, Params{sw, sh, dw, dh, alpha ? 1u : 0u, 0});
    [cb commit];
    [cb waitUntilCompleted];
    if (cb.status != MTLCommandBufferStatusCompleted) return fail(env, "convertPixels: GPU error");
    void* copy = nullptr;
    CHECK(napi_create_buffer_copy(env, outBytes, dst.contents, &copy, &result));
  }
  return result;
}

// createTestSurface(bgra, width, height) → Buffer holding a retained IOSurfaceRef, like Electron's handle.
static napi_value CreateTestSurface(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  void* bytes = nullptr; size_t length = 0;
  CHECK(napi_get_buffer_info(env, argv[0], &bytes, &length));
  uint32_t w = 0, h = 0;
  napi_get_value_uint32(env, argv[1], &w); napi_get_value_uint32(env, argv[2], &h);
  if (!w || !h || length != size_t(w) * h * 4) return fail(env, "createTestSurface: bad dimensions");
  NSDictionary* props = @{
    (id)kIOSurfaceWidth: @(w), (id)kIOSurfaceHeight: @(h), (id)kIOSurfaceBytesPerElement: @4,
    (id)kIOSurfaceBytesPerRow: @(w * 4), (id)kIOSurfacePixelFormat: @((unsigned int)'BGRA'),
  };
  IOSurfaceRef surface = IOSurfaceCreate((__bridge CFDictionaryRef)props);
  if (!surface) return fail(env, "IOSurfaceCreate failed");
  IOSurfaceLock(surface, 0, nullptr);
  auto* base = static_cast<uint8_t*>(IOSurfaceGetBaseAddress(surface));
  const size_t stride = IOSurfaceGetBytesPerRow(surface);
  for (uint32_t y = 0; y < h; ++y) std::memcpy(base + y * stride, static_cast<uint8_t*>(bytes) + size_t(y) * w * 4, size_t(w) * 4);
  IOSurfaceUnlock(surface, 0, nullptr);
  napi_value handle; void* data = nullptr;
  CHECK(napi_create_buffer(env, sizeof(surface), &data, &handle));
  std::memcpy(data, &surface, sizeof(surface));
  return handle;
}

static napi_value ReleaseTestSurface(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  void* data = nullptr; size_t length = 0;
  CHECK(napi_get_buffer_info(env, argv[0], &data, &length));
  IOSurfaceRef surface = nullptr;
  if (length >= sizeof(surface)) std::memcpy(&surface, data, sizeof(surface));
  if (surface) CFRelease(surface);
  return undefined(env);
}

// available() → { ok, reason?, device? }
static napi_value Available(napi_env env, napi_callback_info) {
  napi_value out, value;
  napi_create_object(env, &out);
  const bool ok = gpu().error.empty();
  napi_get_boolean(env, ok, &value); setProp(env, out, "ok", value);
  if (ok) {
    napi_create_string_utf8(env, gpu().device.name.UTF8String, NAPI_AUTO_LENGTH, &value);
    setProp(env, out, "device", value);
  } else {
    napi_create_string_utf8(env, gpu().error.c_str(), NAPI_AUTO_LENGTH, &value);
    setProp(env, out, "reason", value);
  }
  return out;
}

// ─── Module ───────────────────────────────────────────────────────────────────

static napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor props[] = {
    {"available", nullptr, Available, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"open", nullptr, Open, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"convert", nullptr, Convert, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"createRing", nullptr, CreateRing, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeRing", nullptr, CloseRing, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readRing", nullptr, ReadRing, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"convertPixels", nullptr, ConvertPixels, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"createTestSurface", nullptr, CreateTestSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"releaseTestSurface", nullptr, ReleaseTestSurface, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(gpu_frames, Init)

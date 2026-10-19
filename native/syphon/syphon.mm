// syphon — publishes Kairo's offscreen output frames as a Syphon server, so
// OBS, Resolume, vMix and friends on the same Mac can take them in (with the
// alpha channel: lyrics over a camera, lower thirds).
//
// Each frame arrives as Chromium's shared texture (an IOSurface, BGRA). It is
// copied on the GPU into the server's own IOSurface — a blit, no shaders — and
// published once the copy is done. As in gpu-frames, a frame that arrives
// while the previous copy is still running is dropped, never queued.
//
// Only Syphon's messaging and its base server/client classes are compiled in
// (vendor/Syphon, BSD licence): no Syphon.framework, and no Metal toolchain
// needed, because the copy needs no shader.

#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <Syphon/SyphonServerBase.h>
#import <Syphon/SyphonClientBase.h>
#import <Syphon/SyphonSubclassing.h>
#include <node_api.h>
#include <atomic>
#include <cstring>
#include <mutex>
#include <string>

// ─── GPU ──────────────────────────────────────────────────────────────────────

struct Gpu {
  id<MTLDevice> device = nil;
  id<MTLCommandQueue> queue = nil;
  std::string error;
};

static Gpu& gpu() {
  static Gpu instance = [] {
    Gpu g;
    g.device = MTLCreateSystemDefaultDevice();
    if (!g.device) { g.error = "no Metal device"; return g; }
    g.queue = [g.device newCommandQueue];
    if (!g.queue) g.error = "no Metal command queue";
    return g;
  }();
  return instance;
}

// ─── N-API helpers ────────────────────────────────────────────────────────────

#define CHECK(call) do { if ((call) != napi_ok) { napi_throw_error(env, nullptr, #call " failed"); return nullptr; } } while (0)

static napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

static napi_value undefined(napi_env env) {
  napi_value value; napi_get_undefined(env, &value); return value;
}

static void setProp(napi_env env, napi_value object, const char* key, napi_value value) {
  napi_set_named_property(env, object, key, value);
}

static IOSurfaceRef surfaceFromHandle(napi_env env, napi_value handle) {
  void* bytes = nullptr; size_t length = 0;
  if (napi_get_buffer_info(env, handle, &bytes, &length) != napi_ok || length < sizeof(IOSurfaceRef)) return nullptr;
  IOSurfaceRef surface = nullptr;
  std::memcpy(&surface, bytes, sizeof(surface));
  return surface;
}

static id<MTLTexture> wrap(IOSurfaceRef surface, MTLTextureUsage usage) {
  MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                  width:IOSurfaceGetWidth(surface)
                                                                                 height:IOSurfaceGetHeight(surface)
                                                                              mipmapped:NO];
  desc.usage = usage;
  return [gpu().device newTextureWithDescriptor:desc iosurface:surface plane:0];
}

// ─── Server ───────────────────────────────────────────────────────────────────

/** Syphon's base server; the frame copy is done here, in the addon. */
@interface KairoSyphonServer : SyphonServerBase
@end
@implementation KairoSyphonServer
@end

struct Pending;

struct Server {
  KairoSyphonServer* server = nil;
  napi_threadsafe_function tsfn = nullptr;
  std::mutex lock;
  bool busy = false;
  bool closed = false;
  id<MTLCommandBuffer> last = nil;
  uint64_t published = 0, skipped = 0, failed = 0;
  /** The JS handle and the threadsafe function each hold one; the last to let go frees it. */
  std::atomic<int> owners{2};
};

struct Pending {
  Server* s;
  napi_ref done;
  std::string error;
};

static void releaseOwner(Server* s) {
  if (--s->owners == 0) delete s;
}

/** Runs `done(err)` on the JS thread once the GPU copy finished. */
static void callJs(napi_env env, napi_value, void*, void* data) {
  auto* pending = static_cast<Pending*>(data);
  Server* s = pending->s;
  {
    std::lock_guard<std::mutex> guard(s->lock);
    s->busy = false;
  }
  if (env && pending->done) {
    napi_value done, global, arg;
    napi_get_reference_value(env, pending->done, &done);
    napi_get_global(env, &global);
    if (pending->error.empty()) {
      napi_get_null(env, &arg);
    } else {
      napi_value message;
      napi_create_string_utf8(env, pending->error.c_str(), NAPI_AUTO_LENGTH, &message);
      napi_create_error(env, nullptr, message, &arg);
    }
    napi_call_function(env, global, done, 1, &arg, nullptr);
    napi_delete_reference(env, pending->done);
  }
  if (env) napi_unref_threadsafe_function(env, s->tsfn);
  delete pending;
}

static void finalizeTsfn(napi_env, void* data, void*) {
  releaseOwner(static_cast<Server*>(data));
}

static void closeServer(Server* s) {
  if (s->closed) return;
  s->closed = true;
  id<MTLCommandBuffer> last = s->last;
  if (last) [last waitUntilCompleted];
  [s->server stop];
  s->server = nil;
  if (s->tsfn) napi_release_threadsafe_function(s->tsfn, napi_tsfn_release);
}

static void finalizeServerHandle(napi_env, void* data, void*) {
  auto* s = static_cast<Server*>(data);
  closeServer(s);
  releaseOwner(s);
}

static Server* unwrapServer(napi_env env, napi_value value) {
  void* data = nullptr;
  if (napi_get_value_external(env, value, &data) != napi_ok) return nullptr;
  return static_cast<Server*>(data);
}

// open({ name }) → server
static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (!gpu().error.empty()) return fail(env, gpu().error.c_str());
  std::string name = "Kairo";
  if (argc >= 1) {
    napi_value nameValue;
    bool has = false;
    napi_has_named_property(env, argv[0], "name", &has);
    if (has && napi_get_named_property(env, argv[0], "name", &nameValue) == napi_ok) {
      size_t length = 0;
      napi_get_value_string_utf8(env, nameValue, nullptr, 0, &length);
      std::string buffer(length + 1, '\0');
      napi_get_value_string_utf8(env, nameValue, buffer.data(), buffer.size(), &length);
      buffer.resize(length);
      if (!buffer.empty()) name = buffer;
    }
  }
  auto* s = new Server();
  @autoreleasepool {
    s->server = [[KairoSyphonServer alloc] initWithName:[NSString stringWithUTF8String:name.c_str()] options:nil];
  }
  if (!s->server) { delete s; return fail(env, "open: Syphon server could not start"); }
  napi_value resource;
  napi_create_string_utf8(env, "kairo-syphon", NAPI_AUTO_LENGTH, &resource);
  if (napi_create_threadsafe_function(env, nullptr, nullptr, resource, 0, 1, s, finalizeTsfn, s, callJs, &s->tsfn) != napi_ok) {
    [s->server stop];
    delete s;
    return fail(env, "open: threadsafe function failed");
  }
  napi_unref_threadsafe_function(env, s->tsfn);
  napi_value external;
  CHECK(napi_create_external(env, s, finalizeServerHandle, nullptr, &external));
  return external;
}

// publish(server, sharedTextureHandle: Buffer, done) → boolean
// False at once when the previous frame is still being copied: the caller
// releases the texture and the frame is dropped. On true, `done(err)` runs once
// the GPU is finished with the texture, and only then may it be released.
static napi_value Publish(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Server* s = argc >= 3 ? unwrapServer(env, argv[0]) : nullptr;
  if (!s || s->closed) return fail(env, "publish: server closed");
  IOSurfaceRef source = surfaceFromHandle(env, argv[1]);
  if (!source) return fail(env, "publish: sharedTextureHandle must hold an IOSurfaceRef");
  if (IOSurfaceGetPixelFormat(source) != 'BGRA') { ++s->failed; return fail(env, "publish: IOSurface is not BGRA"); }
  {
    std::lock_guard<std::mutex> guard(s->lock);
    if (s->busy) {
      ++s->skipped;
      napi_value no; napi_get_boolean(env, false, &no);
      return no;
    }
    s->busy = true;
  }
  bool started = false;
  @autoreleasepool {
    const size_t width = IOSurfaceGetWidth(source), height = IOSurfaceGetHeight(source);
    IOSurfaceRef target = [s->server newSurfaceForWidth:width height:height options:nil];
    id<MTLTexture> src = wrap(source, MTLTextureUsageShaderRead);
    id<MTLTexture> dst = target ? wrap(target, MTLTextureUsageShaderWrite | MTLTextureUsageRenderTarget) : nil;
    if (!src || !dst) {
      if (target) CFRelease(target);
      std::lock_guard<std::mutex> guard(s->lock);
      s->busy = false;
      ++s->failed;
      return fail(env, "publish: could not wrap IOSurface");
    }
    auto* pending = new Pending{s, nullptr, {}};
    napi_create_reference(env, argv[2], 1, &pending->done);
    id<MTLCommandBuffer> cb = [gpu().queue commandBuffer];
    id<MTLBlitCommandEncoder> blit = [cb blitCommandEncoder];
    [blit copyFromTexture:src sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0, 0, 0)
               sourceSize:MTLSizeMake(width, height, 1)
                toTexture:dst destinationSlice:0 destinationLevel:0 destinationOrigin:MTLOriginMake(0, 0, 0)];
    [blit endEncoding];
    KairoSyphonServer* server = s->server;
    napi_threadsafe_function tsfn = s->tsfn;
    [cb addCompletedHandler:^(id<MTLCommandBuffer> finished) {
      // `src` and `dst` are captured so both IOSurfaces stay wrapped until the GPU is done.
      (void)src; (void)dst;
      if (finished.status == MTLCommandBufferStatusCompleted) {
        [server publish];
      } else {
        pending->error = std::string("Syphon copy failed: ") +
          (finished.error ? finished.error.localizedDescription.UTF8String : "unknown");
      }
      CFRelease(target);
      if (napi_call_threadsafe_function(tsfn, pending, napi_tsfn_nonblocking) != napi_ok) {
        // Only during teardown; the callback reference can't be deleted off the JS thread.
        delete pending;
      }
    }];
    napi_ref_threadsafe_function(env, tsfn);
    s->last = cb;
    [cb commit];
    ++s->published;
    started = true;
  }
  napi_value result; napi_get_boolean(env, started, &result);
  return result;
}

// publishPixels(server, bgra: Buffer, width, height) → boolean
// The CPU capture path: pixels already in memory, copied straight into the
// server's IOSurface. False (frame dropped) while a GPU copy is still running.
static napi_value PublishPixels(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Server* s = argc >= 4 ? unwrapServer(env, argv[0]) : nullptr;
  if (!s || s->closed) return fail(env, "publishPixels: server closed");
  void* pixels = nullptr; size_t length = 0;
  uint32_t width = 0, height = 0;
  if (napi_get_buffer_info(env, argv[1], &pixels, &length) != napi_ok
      || napi_get_value_uint32(env, argv[2], &width) != napi_ok
      || napi_get_value_uint32(env, argv[3], &height) != napi_ok
      || width == 0 || height == 0 || length < size_t(width) * height * 4) {
    return fail(env, "publishPixels: needs a BGRA buffer of width × height × 4 bytes");
  }
  {
    std::lock_guard<std::mutex> guard(s->lock);
    if (s->busy) {
      ++s->skipped;
      napi_value no; napi_get_boolean(env, false, &no);
      return no;
    }
  }
  @autoreleasepool {
    IOSurfaceRef target = [s->server newSurfaceForWidth:width height:height options:nil];
    if (!target) { ++s->failed; return fail(env, "publishPixels: no server surface"); }
    IOSurfaceLock(target, 0, nullptr);
    auto* base = static_cast<uint8_t*>(IOSurfaceGetBaseAddress(target));
    const size_t stride = IOSurfaceGetBytesPerRow(target);
    for (uint32_t y = 0; y < height; ++y) {
      std::memcpy(base + y * stride, static_cast<const uint8_t*>(pixels) + size_t(y) * width * 4, size_t(width) * 4);
    }
    IOSurfaceUnlock(target, 0, nullptr);
    [s->server publish];
    CFRelease(target);
  }
  ++s->published;
  napi_value yes; napi_get_boolean(env, true, &yes);
  return yes;
}

// close(server)
static napi_value Close(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Server* s = argc ? unwrapServer(env, argv[0]) : nullptr;
  if (!s) return fail(env, "close(server)");
  closeServer(s);
  return undefined(env);
}

// stats(server) → { published, skipped, failed, hasClients }
static napi_value Stats(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Server* s = argc ? unwrapServer(env, argv[0]) : nullptr;
  if (!s) return fail(env, "stats(server)");
  napi_value out, value;
  napi_create_object(env, &out);
  napi_create_double(env, double(s->published), &value); setProp(env, out, "published", value);
  napi_create_double(env, double(s->skipped), &value); setProp(env, out, "skipped", value);
  napi_create_double(env, double(s->failed), &value); setProp(env, out, "failed", value);
  napi_get_boolean(env, s->server && !s->closed && s->server.hasClients, &value); setProp(env, out, "hasClients", value);
  return out;
}

// available() → { ok, reason? }
static napi_value Available(napi_env env, napi_callback_info) {
  napi_value out, value;
  napi_create_object(env, &out);
  const bool ok = gpu().error.empty();
  napi_get_boolean(env, ok, &value); setProp(env, out, "ok", value);
  if (!ok) {
    napi_create_string_utf8(env, gpu().error.c_str(), NAPI_AUTO_LENGTH, &value);
    setProp(env, out, "reason", value);
  }
  return out;
}

// ─── Test client ──────────────────────────────────────────────────────────────
// readLatest(server, timeoutMs) → { width, height, bgra: Buffer } | null
// Connects a Syphon client to the server, as OBS would, and reads the newest
// frame back off the GPU. Tests only.

@interface KairoSyphonTestClient : SyphonClientBase
@end
@implementation KairoSyphonTestClient
@end

static napi_value ReadLatest(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Server* s = argc >= 1 ? unwrapServer(env, argv[0]) : nullptr;
  if (!s || s->closed) return fail(env, "readLatest: server closed");
  double timeoutMs = 2000;
  if (argc >= 2) napi_get_value_double(env, argv[1], &timeoutMs);
  napi_value result = nullptr;
  @autoreleasepool {
    KairoSyphonTestClient* client = [[KairoSyphonTestClient alloc] initWithServerDescription:s->server.serverDescription options:nil newFrameHandler:nil];
    NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:timeoutMs / 1000.0];
    IOSurfaceRef surface = nullptr;
    while (!surface && [deadline timeIntervalSinceNow] > 0) {
      surface = [client newSurface];
      if (!surface) [NSThread sleepForTimeInterval:0.01];
    }
    if (surface) {
      const size_t width = IOSurfaceGetWidth(surface), height = IOSurfaceGetHeight(surface);
      void* data = nullptr;
      napi_value buffer;
      CHECK(napi_create_buffer(env, width * height * 4, &data, &buffer));
      IOSurfaceLock(surface, kIOSurfaceLockReadOnly, nullptr);
      const auto* base = static_cast<const uint8_t*>(IOSurfaceGetBaseAddress(surface));
      const size_t stride = IOSurfaceGetBytesPerRow(surface);
      for (size_t y = 0; y < height; ++y) std::memcpy(static_cast<uint8_t*>(data) + y * width * 4, base + y * stride, width * 4);
      IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, nullptr);
      CFRelease(surface);
      napi_value w, h;
      napi_create_object(env, &result);
      napi_create_uint32(env, uint32_t(width), &w); setProp(env, result, "width", w);
      napi_create_uint32(env, uint32_t(height), &h); setProp(env, result, "height", h);
      setProp(env, result, "bgra", buffer);
    }
    [client stop];
  }
  if (!result) napi_get_null(env, &result);
  return result;
}

// ─── Module ───────────────────────────────────────────────────────────────────

static napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor props[] = {
    {"available", nullptr, Available, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"open", nullptr, Open, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"publish", nullptr, Publish, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"publishPixels", nullptr, PublishPixels, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readLatest", nullptr, ReadLatest, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(syphon, Init)

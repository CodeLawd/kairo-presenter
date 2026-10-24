// recorder — records one of Kairo's outputs to a movie file (Live → Start
// Capture), with no other app involved: H.264, HEVC or ProRes through macOS's
// own encoders, plus sound from an audio input such as the sound desk.
//
// Frames arrive as Chromium's shared texture (an IOSurface, BGRA), or as a
// BGRA bitmap on the CPU path. Each is copied on the GPU into a pixel buffer at
// the recording's size — a blit, or Metal Performance Shaders' bilinear scale
// when the sizes differ (precompiled, so no Metal toolchain) — and becomes the
// "current" frame. A clock on its own queue writes the current frame on a
// fixed frame grid, so a slide that sits still for a minute is still a minute
// of video, and sound and picture share one timeline (the host clock).
//
// As with the other outputs, a frame that arrives while the previous copy is
// still running is dropped, never queued.

#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <MetalPerformanceShaders/MetalPerformanceShaders.h>
#include <node_api.h>
#include <atomic>
#include <cmath>
#include <cstring>
#include <mutex>
#include <string>

// ─── GPU ──────────────────────────────────────────────────────────────────────

struct Gpu {
  id<MTLDevice> device = nil;
  id<MTLCommandQueue> queue = nil;
  MPSImageBilinearScale* scale = nil;
  std::string error;
};

static Gpu& gpu() {
  static Gpu instance = [] {
    Gpu g;
    g.device = MTLCreateSystemDefaultDevice();
    if (!g.device) { g.error = "no Metal device"; return g; }
    g.queue = [g.device newCommandQueue];
    if (!g.queue) { g.error = "no Metal command queue"; return g; }
    if (MPSSupportsMTLDevice(g.device)) g.scale = [[MPSImageBilinearScale alloc] initWithDevice:g.device];
    return g;
  }();
  return instance;
}

static id<MTLTexture> wrap(IOSurfaceRef surface, MTLTextureUsage usage) {
  MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                  width:IOSurfaceGetWidth(surface)
                                                                                 height:IOSurfaceGetHeight(surface)
                                                                              mipmapped:NO];
  desc.usage = usage;
  return [gpu().device newTextureWithDescriptor:desc iosurface:surface plane:0];
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

static void setNumber(napi_env env, napi_value object, const char* key, double number) {
  napi_value value; napi_create_double(env, number, &value); setProp(env, object, key, value);
}

static void setString(napi_env env, napi_value object, const char* key, const std::string& text) {
  napi_value value; napi_create_string_utf8(env, text.c_str(), text.size(), &value); setProp(env, object, key, value);
}

static bool getString(napi_env env, napi_value object, const char* key, std::string& out) {
  bool has = false;
  napi_value value;
  napi_valuetype type;
  if (napi_has_named_property(env, object, key, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, object, key, &value) != napi_ok) return false;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::string buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);
  buffer.resize(length);
  out = buffer;
  return true;
}

static bool getNumber(napi_env env, napi_value object, const char* key, double& out) {
  bool has = false;
  napi_value value;
  napi_valuetype type;
  if (napi_has_named_property(env, object, key, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, object, key, &value) != napi_ok) return false;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return false;
  return napi_get_value_double(env, value, &out) == napi_ok;
}

static IOSurfaceRef surfaceFromHandle(napi_env env, napi_value handle) {
  void* bytes = nullptr; size_t length = 0;
  if (napi_get_buffer_info(env, handle, &bytes, &length) != napi_ok || length < sizeof(IOSurfaceRef)) return nullptr;
  IOSurfaceRef surface = nullptr;
  std::memcpy(&surface, bytes, sizeof(surface));
  return surface;
}

// ─── Recorder ─────────────────────────────────────────────────────────────────

struct Recorder;

/** Receives sound from the capture session and writes it on the recording's timeline. */
@interface KairoAudioTap : NSObject <AVCaptureAudioDataOutputSampleBufferDelegate>
@property(nonatomic, assign) Recorder* recorder;
@end

struct Recorder {
  AVAssetWriter* writer = nil;
  AVAssetWriterInput* video = nil;
  AVAssetWriterInputPixelBufferAdaptor* adaptor = nil;
  AVAssetWriterInput* audio = nil;
  AVCaptureSession* session = nil;
  KairoAudioTap* tap = nil;
  dispatch_queue_t clockQueue = nullptr;
  dispatch_queue_t audioQueue = nullptr;
  dispatch_source_t clock = nullptr;
  CVPixelBufferPoolRef pool = nullptr;
  napi_threadsafe_function tsfn = nullptr;
  int pendingCalls = 0;

  std::mutex lock;
  /** The newest copied frame; the clock writes it until a newer one replaces it. */
  CVPixelBufferRef current = nullptr;
  /** What is written before the first frame arrives: transparent black. */
  CVPixelBufferRef blank = nullptr;
  bool busy = false;
  bool stopping = false;
  bool closed = false;
  id<MTLCommandBuffer> last = nil;
  std::string error;

  std::string path;
  int width = 1920, height = 1080, fps = 30;
  /** Host time of frame 0. */
  CMTime start = kCMTimeInvalid;
  int64_t lastIndex = -1;
  uint64_t written = 0, late = 0, skipped = 0, failed = 0, audioBuffers = 0;
  /** The JS handle and the threadsafe function each hold one; the last to let go frees it. */
  std::atomic<int> owners{2};

  ~Recorder() {
    if (current) CVPixelBufferRelease(current);
    if (blank) CVPixelBufferRelease(blank);
    if (pool) CVPixelBufferPoolRelease(pool);
  }

  void setError(const std::string& message) {
    std::lock_guard<std::mutex> guard(lock);
    if (error.empty()) error = message;
  }

  std::string writerError() {
    NSError* e = writer.error;
    return e ? std::string(e.localizedDescription.UTF8String) : std::string("the movie file could not be written");
  }

  /** The newest frame becomes the one the clock writes. Takes ownership of `frame`. */
  void setCurrent(CVPixelBufferRef frame) {
    std::lock_guard<std::mutex> guard(lock);
    if (current) CVPixelBufferRelease(current);
    current = frame;
  }

  /** One clock tick, on `clockQueue`: writes the current frame at its slot on the frame grid. */
  void tick() {
    if (stopping) return;
    CMTime now = CMClockGetTime(CMClockGetHostTimeClock());
    const double elapsed = CMTimeGetSeconds(CMTimeSubtract(now, start));
    const int64_t index = std::max<int64_t>(0, llround(elapsed * fps));
    if (index <= lastIndex) return;
    append(index);
  }

  void append(int64_t index) {
    CVPixelBufferRef frame;
    {
      std::lock_guard<std::mutex> guard(lock);
      frame = CVPixelBufferRetain(current ? current : blank);
    }
    if (writer.status == AVAssetWriterStatusFailed) {
      setError(writerError());
    } else if (!video.readyForMoreMediaData) {
      // The encoder is behind; the slot stays empty and the previous frame holds.
      ++late;
    } else if ([adaptor appendPixelBuffer:frame withPresentationTime:CMTimeMake(index, fps)]) {
      ++written;
      lastIndex = index;
    } else {
      ++failed;
      setError(writerError());
    }
    CVPixelBufferRelease(frame);
  }

  void appendAudio(CMSampleBufferRef buffer) {
    if (stopping || !audio) return;
    CMClockRef sourceClock = nullptr;
    if (@available(macOS 12.3, *)) sourceClock = session.synchronizationClock;
    if (!sourceClock) sourceClock = session.masterClock;
    CMTime pts = CMSampleBufferGetPresentationTimeStamp(buffer);
    if (sourceClock) pts = CMSyncConvertTime(pts, sourceClock, CMClockGetHostTimeClock());
    CMTime at = CMTimeSubtract(pts, start);
    // Sound from before the first frame has no picture to sit under.
    if (CMTIME_COMPARE_INLINE(at, <, kCMTimeZero)) return;
    CMSampleTimingInfo timing = { CMSampleBufferGetDuration(buffer), at, kCMTimeInvalid };
    CMSampleBufferRef retimed = nullptr;
    if (CMSampleBufferCreateCopyWithNewTiming(kCFAllocatorDefault, buffer, 1, &timing, &retimed) != noErr || !retimed) return;
    if (writer.status == AVAssetWriterStatusWriting && audio.readyForMoreMediaData && [audio appendSampleBuffer:retimed]) {
      ++audioBuffers;
    }
    CFRelease(retimed);
  }
};

@implementation KairoAudioTap
- (void)captureOutput:(AVCaptureOutput*)output didOutputSampleBuffer:(CMSampleBufferRef)buffer fromConnection:(AVCaptureConnection*)connection {
  if (self.recorder) self.recorder->appendAudio(buffer);
}
@end

// ─── Pending calls back into JS ───────────────────────────────────────────────

struct Pending {
  Recorder* r;
  napi_ref done;
  std::string error;
  /** stop(): the finished recording, reported to `done(err, result)`. */
  bool finished = false;
  double seconds = 0;
};

static void releaseOwner(Recorder* r) {
  if (--r->owners == 0) delete r;
}

static void callJs(napi_env env, napi_value, void*, void* data) {
  auto* pending = static_cast<Pending*>(data);
  Recorder* r = pending->r;
  if (env && pending->done) {
    napi_value done, global, args[2];
    napi_get_reference_value(env, pending->done, &done);
    napi_get_global(env, &global);
    if (pending->error.empty()) {
      napi_get_null(env, &args[0]);
    } else {
      napi_value message;
      napi_create_string_utf8(env, pending->error.c_str(), NAPI_AUTO_LENGTH, &message);
      napi_create_error(env, nullptr, message, &args[0]);
    }
    size_t argc = 1;
    if (pending->finished) {
      napi_create_object(env, &args[1]);
      setString(env, args[1], "path", r->path);
      setNumber(env, args[1], "frames", double(r->written));
      setNumber(env, args[1], "seconds", pending->seconds);
      argc = 2;
    }
    napi_call_function(env, global, done, argc, args, nullptr);
    napi_delete_reference(env, pending->done);
  }
  if (env && --r->pendingCalls == 0) napi_unref_threadsafe_function(env, r->tsfn);
  delete pending;
}

/** On the JS thread: `done` will be called back from another thread. */
static Pending* expectCall(napi_env env, Recorder* r, napi_value done) {
  auto* pending = new Pending{r, nullptr, {}};
  napi_create_reference(env, done, 1, &pending->done);
  if (r->pendingCalls++ == 0) napi_ref_threadsafe_function(env, r->tsfn);
  return pending;
}

static void finalizeTsfn(napi_env, void* data, void*) {
  releaseOwner(static_cast<Recorder*>(data));
}

/** Stops the clock and the sound, and waits for any running frame copy. Idempotent. */
static void halt(Recorder* r) {
  if (r->stopping) return;
  r->stopping = true;
  if (r->clock) {
    dispatch_source_cancel(r->clock);
    dispatch_sync(r->clockQueue, ^{});
    r->clock = nullptr;
  }
  if (r->session) {
    [r->session stopRunning];
    dispatch_sync(r->audioQueue, ^{});
    r->tap.recorder = nullptr;
  }
  id<MTLCommandBuffer> last;
  {
    std::lock_guard<std::mutex> guard(r->lock);
    last = r->last;
  }
  if (last) [last waitUntilCompleted];
}

static void finalizeHandle(napi_env, void* data, void*) {
  auto* r = static_cast<Recorder*>(data);
  // Dropped without stop(): the file is abandoned rather than finished.
  if (!r->closed) {
    halt(r);
    if (r->writer.status == AVAssetWriterStatusWriting) [r->writer cancelWriting];
    r->closed = true;
    if (r->tsfn) napi_release_threadsafe_function(r->tsfn, napi_tsfn_release);
  }
  releaseOwner(r);
}

static Recorder* unwrap(napi_env env, napi_value value) {
  void* data = nullptr;
  if (napi_get_value_external(env, value, &data) != napi_ok) return nullptr;
  return static_cast<Recorder*>(data);
}

static CVPixelBufferRef newBuffer(Recorder* r) {
  CVPixelBufferRef buffer = nullptr;
  if (CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, r->pool, &buffer) != kCVReturnSuccess) return nullptr;
  // Rec. 709, like the encoder settings, so colours don't shift; Chromium's
  // pixels are premultiplied, which ProRes 4444 needs to know to key cleanly.
  CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, kCVAttachmentMode_ShouldPropagate);
  CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, kCVAttachmentMode_ShouldPropagate);
  CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, kCVAttachmentMode_ShouldPropagate);
  CVBufferSetAttachment(buffer, kCVImageBufferAlphaChannelModeKey, kCVImageBufferAlphaChannelMode_PremultipliedAlpha, kCVAttachmentMode_ShouldPropagate);
  return buffer;
}

static AVCaptureDevice* findAudioDevice(const std::string& id) {
  NSString* wanted = [NSString stringWithUTF8String:id.c_str()];
  for (AVCaptureDevice* device in [AVCaptureDevice devicesWithMediaType:AVMediaTypeAudio]) {
    if ([device.uniqueID isEqualToString:wanted]) return device;
  }
  return nil;
}

// open({ path, width, height, fps, codec, bitrate?, audioDeviceId? }) → recorder
// codec: 'h264' | 'hevc' | 'prores422' | 'prores4444'. Always a QuickTime
// movie, written in fragments so a crash mid-service still leaves a playable file.
static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  if (!gpu().error.empty()) return fail(env, gpu().error.c_str());
  if (argc < 1) return fail(env, "open(options)");

  std::string path, codec = "h264", audioId;
  double width = 1920, height = 1080, fps = 30, bitrate = 0;
  if (!getString(env, argv[0], "path", path) || path.empty()) return fail(env, "open: path is required");
  getString(env, argv[0], "codec", codec);
  getString(env, argv[0], "audioDeviceId", audioId);
  getNumber(env, argv[0], "width", width);
  getNumber(env, argv[0], "height", height);
  getNumber(env, argv[0], "fps", fps);
  getNumber(env, argv[0], "bitrate", bitrate);
  if (width < 16 || height < 16 || width > 7680 || height > 4320 || int(width) % 2 || int(height) % 2) return fail(env, "open: unsupported size");
  if (fps < 1 || fps > 120) return fail(env, "open: unsupported frame rate");

  AVVideoCodecType codecType =
    codec == "h264" ? AVVideoCodecTypeH264
    : codec == "hevc" ? AVVideoCodecTypeHEVC
    : codec == "prores422" ? AVVideoCodecTypeAppleProRes422
    : codec == "prores4444" ? AVVideoCodecTypeAppleProRes4444
    : nil;
  if (!codecType) return fail(env, "open: unknown codec");

  auto* r = new Recorder();
  r->path = path;
  r->width = int(width);
  r->height = int(height);
  r->fps = int(std::lround(fps));

  std::string problem;
  @autoreleasepool {
    NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
    NSError* error = nil;
    r->writer = [[AVAssetWriter alloc] initWithURL:url fileType:AVFileTypeQuickTimeMovie error:&error];
    if (!r->writer) problem = error ? error.localizedDescription.UTF8String : "could not create the movie file";

    if (problem.empty()) {
      r->writer.movieFragmentInterval = CMTimeMakeWithSeconds(5, 600);
      NSDictionary* color = @{
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
      };
      NSMutableDictionary* settings = [@{
        AVVideoCodecKey: codecType,
        AVVideoWidthKey: @(r->width),
        AVVideoHeightKey: @(r->height),
        AVVideoColorPropertiesKey: color,
      } mutableCopy];
      if (codec == "h264" || codec == "hevc") {
        NSMutableDictionary* compression = [@{
          AVVideoExpectedSourceFrameRateKey: @(r->fps),
          AVVideoMaxKeyFrameIntervalKey: @(r->fps * 2),
          AVVideoAllowFrameReorderingKey: @NO,
        } mutableCopy];
        if (bitrate > 0) compression[AVVideoAverageBitRateKey] = @(bitrate);
        if (codec == "h264") compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel;
        settings[AVVideoCompressionPropertiesKey] = compression;
      }
      r->video = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
      r->video.expectsMediaDataInRealTime = YES;
      NSDictionary* attributes = @{
        (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
        (id)kCVPixelBufferWidthKey: @(r->width),
        (id)kCVPixelBufferHeightKey: @(r->height),
        (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
        (id)kCVPixelBufferMetalCompatibilityKey: @YES,
      };
      r->adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:r->video sourcePixelBufferAttributes:attributes];
      if ([r->writer canAddInput:r->video]) [r->writer addInput:r->video];
      else problem = "this Mac cannot encode that codec at that size";

      // Our own pool: frames are copied in as they arrive, before the encoder asks.
      NSDictionary* poolOptions = @{ (id)kCVPixelBufferPoolMinimumBufferCountKey: @4 };
      if (problem.empty() && CVPixelBufferPoolCreate(kCFAllocatorDefault, (__bridge CFDictionaryRef)poolOptions, (__bridge CFDictionaryRef)attributes, &r->pool) != kCVReturnSuccess) {
        problem = "could not allocate frame buffers";
      }
      if (problem.empty()) {
        r->blank = newBuffer(r);
        if (!r->blank) problem = "could not allocate frame buffers";
        else {
          CVPixelBufferLockBaseAddress(r->blank, 0);
          std::memset(CVPixelBufferGetBaseAddress(r->blank), 0, CVPixelBufferGetDataSize(r->blank));
          CVPixelBufferUnlockBaseAddress(r->blank, 0);
        }
      }
    }

    if (problem.empty() && !audioId.empty()) {
      AVCaptureDevice* device = findAudioDevice(audioId);
      if (!device) problem = "the audio input is not connected";
      else if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] != AVAuthorizationStatusAuthorized) {
        problem = "Kairo is not allowed to use the microphone (System Settings → Privacy & Security → Microphone)";
      } else {
        AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
        AVCaptureAudioDataOutput* output = [[AVCaptureAudioDataOutput alloc] init];
        // One format whatever the device: 48 kHz stereo float, upmixed or downmixed here.
        output.audioSettings = @{
          AVFormatIDKey: @(kAudioFormatLinearPCM),
          AVSampleRateKey: @48000,
          AVNumberOfChannelsKey: @2,
          AVLinearPCMBitDepthKey: @32,
          AVLinearPCMIsFloatKey: @YES,
          AVLinearPCMIsNonInterleaved: @NO,
          AVLinearPCMIsBigEndianKey: @NO,
        };
        r->session = [[AVCaptureSession alloc] init];
        if (!input || ![r->session canAddInput:input] || ![r->session canAddOutput:output]) {
          problem = input ? "the audio input could not be opened" : (error ? error.localizedDescription.UTF8String : "the audio input could not be opened");
        } else {
          [r->session addInput:input];
          [r->session addOutput:output];
          AudioChannelLayout stereo = {};
          stereo.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo;
          NSData* layout = [NSData dataWithBytes:&stereo length:sizeof(stereo)];
          // AAC beside H.264/HEVC; uncompressed 24-bit beside ProRes, as an editor expects.
          NSDictionary* audioSettings = codec.rfind("prores", 0) == 0
            ? @{ AVFormatIDKey: @(kAudioFormatLinearPCM), AVSampleRateKey: @48000, AVNumberOfChannelsKey: @2,
                 AVChannelLayoutKey: layout, AVLinearPCMBitDepthKey: @24, AVLinearPCMIsFloatKey: @NO,
                 AVLinearPCMIsBigEndianKey: @NO, AVLinearPCMIsNonInterleaved: @NO }
            : @{ AVFormatIDKey: @(kAudioFormatMPEG4AAC), AVSampleRateKey: @48000, AVNumberOfChannelsKey: @2,
                 AVChannelLayoutKey: layout, AVEncoderBitRateKey: @256000 };
          r->audio = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:audioSettings];
          r->audio.expectsMediaDataInRealTime = YES;
          if ([r->writer canAddInput:r->audio]) [r->writer addInput:r->audio];
          else problem = "the audio could not be added to the recording";
          r->tap = [[KairoAudioTap alloc] init];
          r->tap.recorder = r;
          r->audioQueue = dispatch_queue_create("kairo.recorder.audio", DISPATCH_QUEUE_SERIAL);
          [output setSampleBufferDelegate:r->tap queue:r->audioQueue];
        }
      }
    }

    if (problem.empty() && ![r->writer startWriting]) problem = r->writerError();
  }
  if (!problem.empty()) {
    r->session = nil;
    delete r;
    return fail(env, ("open: " + problem).c_str());
  }

  napi_value resource;
  napi_create_string_utf8(env, "kairo-recorder", NAPI_AUTO_LENGTH, &resource);
  if (napi_create_threadsafe_function(env, nullptr, nullptr, resource, 0, 1, r, finalizeTsfn, r, callJs, &r->tsfn) != napi_ok) {
    [r->writer cancelWriting];
    delete r;
    return fail(env, "open: threadsafe function failed");
  }
  napi_unref_threadsafe_function(env, r->tsfn);

  [r->writer startSessionAtSourceTime:kCMTimeZero];
  r->start = CMClockGetTime(CMClockGetHostTimeClock());
  if (r->session) [r->session startRunning];
  r->clockQueue = dispatch_queue_create("kairo.recorder.clock", DISPATCH_QUEUE_SERIAL);
  r->clock = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, r->clockQueue);
  const uint64_t interval = uint64_t(1e9 / r->fps);
  dispatch_source_set_timer(r->clock, dispatch_time(DISPATCH_TIME_NOW, 0), interval, interval / 10);
  Recorder* captured = r;
  dispatch_source_set_event_handler(r->clock, ^{ captured->tick(); });
  dispatch_resume(r->clock);

  napi_value external;
  CHECK(napi_create_external(env, r, finalizeHandle, nullptr, &external));
  return external;
}

// pushTexture(recorder, sharedTextureHandle: Buffer, done) → boolean
// False at once when the previous frame is still being copied: the caller
// releases the texture and the frame is dropped. On true, `done(err)` runs once
// the GPU is finished with the texture, and only then may it be released.
static napi_value PushTexture(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Recorder* r = argc >= 3 ? unwrap(env, argv[0]) : nullptr;
  if (!r || r->stopping) return fail(env, "pushTexture: recorder stopped");
  IOSurfaceRef source = surfaceFromHandle(env, argv[1]);
  if (!source) return fail(env, "pushTexture: sharedTextureHandle must hold an IOSurfaceRef");
  if (IOSurfaceGetPixelFormat(source) != 'BGRA') return fail(env, "pushTexture: IOSurface is not BGRA");
  const size_t sw = IOSurfaceGetWidth(source), sh = IOSurfaceGetHeight(source);
  const bool sameSize = sw == size_t(r->width) && sh == size_t(r->height);
  if (!sameSize && !gpu().scale) return fail(env, "pushTexture: this GPU cannot scale frames");
  napi_value no; napi_get_boolean(env, false, &no);
  {
    std::lock_guard<std::mutex> guard(r->lock);
    if (r->busy) { ++r->skipped; return no; }
    r->busy = true;
  }
  CVPixelBufferRef target = newBuffer(r);
  if (!target) {
    // Every buffer is still with the encoder: drop this frame.
    std::lock_guard<std::mutex> guard(r->lock);
    r->busy = false;
    ++r->skipped;
    return no;
  }
  @autoreleasepool {
    id<MTLTexture> src = wrap(source, MTLTextureUsageShaderRead);
    id<MTLTexture> dst = wrap(CVPixelBufferGetIOSurface(target), MTLTextureUsageShaderWrite | MTLTextureUsageRenderTarget);
    if (!src || !dst) {
      CVPixelBufferRelease(target);
      std::lock_guard<std::mutex> guard(r->lock);
      r->busy = false;
      ++r->failed;
      return fail(env, "pushTexture: could not wrap IOSurface");
    }
    Pending* pending = expectCall(env, r, argv[2]);
    id<MTLCommandBuffer> cb = [gpu().queue commandBuffer];
    if (sameSize) {
      id<MTLBlitCommandEncoder> blit = [cb blitCommandEncoder];
      [blit copyFromTexture:src sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0, 0, 0)
                 sourceSize:MTLSizeMake(sw, sh, 1)
                  toTexture:dst destinationSlice:0 destinationLevel:0 destinationOrigin:MTLOriginMake(0, 0, 0)];
      [blit endEncoding];
    } else {
      [gpu().scale encodeToCommandBuffer:cb sourceTexture:src destinationTexture:dst];
    }
    napi_threadsafe_function tsfn = r->tsfn;
    [cb addCompletedHandler:^(id<MTLCommandBuffer> finished) {
      // `src` and `dst` are captured so both IOSurfaces stay wrapped until the GPU is done.
      (void)src; (void)dst;
      if (finished.status == MTLCommandBufferStatusCompleted) {
        r->setCurrent(target);
      } else {
        CVPixelBufferRelease(target);
        pending->error = std::string("frame copy failed: ") +
          (finished.error ? finished.error.localizedDescription.UTF8String : "unknown");
      }
      {
        std::lock_guard<std::mutex> guard(r->lock);
        r->busy = false;
      }
      if (napi_call_threadsafe_function(tsfn, pending, napi_tsfn_nonblocking) != napi_ok) delete pending;
    }];
    {
      std::lock_guard<std::mutex> guard(r->lock);
      r->last = cb;
    }
    [cb commit];
  }
  napi_value yes; napi_get_boolean(env, true, &yes);
  return yes;
}

// pushPixels(recorder, bgra: Buffer, width, height) → boolean
// The CPU path: a bitmap already in memory, scaled on the CPU when its size
// differs from the recording's. False (frame dropped) while a GPU copy runs.
static napi_value PushPixels(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Recorder* r = argc >= 4 ? unwrap(env, argv[0]) : nullptr;
  if (!r || r->stopping) return fail(env, "pushPixels: recorder stopped");
  void* pixels = nullptr; size_t length = 0;
  uint32_t width = 0, height = 0;
  if (napi_get_buffer_info(env, argv[1], &pixels, &length) != napi_ok
      || napi_get_value_uint32(env, argv[2], &width) != napi_ok
      || napi_get_value_uint32(env, argv[3], &height) != napi_ok
      || width == 0 || height == 0 || length < size_t(width) * height * 4) {
    return fail(env, "pushPixels: needs a BGRA buffer of width × height × 4 bytes");
  }
  napi_value no; napi_get_boolean(env, false, &no);
  {
    std::lock_guard<std::mutex> guard(r->lock);
    if (r->busy) { ++r->skipped; return no; }
  }
  CVPixelBufferRef target = newBuffer(r);
  if (!target) { ++r->skipped; return no; }
  CVPixelBufferLockBaseAddress(target, 0);
  auto* base = static_cast<uint8_t*>(CVPixelBufferGetBaseAddress(target));
  const size_t stride = CVPixelBufferGetBytesPerRow(target);
  if (width == uint32_t(r->width) && height == uint32_t(r->height)) {
    for (uint32_t y = 0; y < height; ++y) {
      std::memcpy(base + y * stride, static_cast<const uint8_t*>(pixels) + size_t(y) * width * 4, size_t(width) * 4);
    }
  } else {
    vImage_Buffer src = { pixels, height, width, size_t(width) * 4 };
    vImage_Buffer dst = { base, vImagePixelCount(r->height), vImagePixelCount(r->width), stride };
    vImageScale_ARGB8888(&src, &dst, nullptr, kvImageHighQualityResampling);
  }
  CVPixelBufferUnlockBaseAddress(target, 0);
  r->setCurrent(target);
  napi_value yes; napi_get_boolean(env, true, &yes);
  return yes;
}

// stop(recorder, done(err, { path, frames, seconds }))
// Writes out what is buffered and closes the file. The recorder takes no more frames.
static napi_value Stop(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Recorder* r = argc >= 2 ? unwrap(env, argv[0]) : nullptr;
  if (!r || r->closed) return fail(env, "stop: recorder already stopped");
  const CMTime ended = CMClockGetTime(CMClockGetHostTimeClock());
  halt(r);
  r->closed = true;
  // A recording stopped before the clock's first tick still gets its first frame.
  if (r->written == 0 && r->writer.status == AVAssetWriterStatusWriting) r->append(0);
  Pending* pending = expectCall(env, r, argv[1]);
  pending->finished = true;
  pending->seconds = CMTimeGetSeconds(CMTimeSubtract(ended, r->start));
  [r->video markAsFinished];
  [r->audio markAsFinished];
  // End on the last frame slot, so a still slide lasts until Stop was pressed.
  [r->writer endSessionAtSourceTime:CMTimeMake(std::max<int64_t>(r->lastIndex + 1, 1), r->fps)];
  napi_threadsafe_function tsfn = r->tsfn;
  AVAssetWriter* writer = r->writer;
  [writer finishWritingWithCompletionHandler:^{
    if (writer.status != AVAssetWriterStatusCompleted) pending->error = r->writerError();
    napi_call_threadsafe_function(tsfn, pending, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  }];
  return undefined(env);
}

// stats(recorder) → { frames, late, skipped, failed, audioBuffers, seconds, error? }
static napi_value Stats(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  Recorder* r = argc ? unwrap(env, argv[0]) : nullptr;
  if (!r) return fail(env, "stats(recorder)");
  napi_value out;
  napi_create_object(env, &out);
  setNumber(env, out, "frames", double(r->written));
  setNumber(env, out, "late", double(r->late));
  setNumber(env, out, "skipped", double(r->skipped));
  setNumber(env, out, "failed", double(r->failed));
  setNumber(env, out, "audioBuffers", double(r->audioBuffers));
  setNumber(env, out, "seconds", CMTimeGetSeconds(CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), r->start)));
  std::string error;
  {
    std::lock_guard<std::mutex> guard(r->lock);
    error = r->error;
  }
  if (!error.empty()) setString(env, out, "error", error);
  return out;
}

// audioInputs() → [{ id, name }]
static napi_value AudioInputs(napi_env env, napi_callback_info) {
  napi_value list;
  napi_create_array(env, &list);
  @autoreleasepool {
    uint32_t index = 0;
    for (AVCaptureDevice* device in [AVCaptureDevice devicesWithMediaType:AVMediaTypeAudio]) {
      napi_value item;
      napi_create_object(env, &item);
      setString(env, item, "id", device.uniqueID.UTF8String);
      setString(env, item, "name", device.localizedName.UTF8String);
      napi_set_element(env, list, index++, item);
    }
  }
  return list;
}

// available() → { ok, reason? }
static napi_value Available(napi_env env, napi_callback_info) {
  napi_value out, value;
  napi_create_object(env, &out);
  const bool ok = gpu().error.empty();
  napi_get_boolean(env, ok, &value); setProp(env, out, "ok", value);
  if (!ok) setString(env, out, "reason", gpu().error);
  return out;
}

// ─── Test helper ──────────────────────────────────────────────────────────────
// probe(path) → { seconds, width, height, frames, codec, audio, firstFrame, lastFrame (BGRA Buffers) } | null
// Reads a finished recording back with AVFoundation. Tests only.

static napi_value Probe(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
  size_t length = 0;
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length);
  std::string path(length + 1, '\0');
  napi_get_value_string_utf8(env, argv[0], path.data(), path.size(), &length);
  path.resize(length);
  napi_value out = nullptr;
  @autoreleasepool {
    AVURLAsset* asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]] options:nil];
    AVAssetTrack* track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
    if (track) {
      napi_create_object(env, &out);
      setNumber(env, out, "seconds", CMTimeGetSeconds(asset.duration));
      setNumber(env, out, "width", track.naturalSize.width);
      setNumber(env, out, "height", track.naturalSize.height);
      CMFormatDescriptionRef format = (__bridge CMFormatDescriptionRef)track.formatDescriptions.firstObject;
      const FourCharCode code = format ? CMFormatDescriptionGetMediaSubType(format) : 0;
      char fourcc[5] = { char(code >> 24), char(code >> 16), char(code >> 8), char(code), 0 };
      setString(env, out, "codec", fourcc);
      napi_value audio;
      napi_get_boolean(env, [asset tracksWithMediaType:AVMediaTypeAudio].count > 0, &audio);
      setProp(env, out, "audio", audio);

      NSError* error = nil;
      AVAssetReader* reader = [AVAssetReader assetReaderWithAsset:asset error:&error];
      AVAssetReaderTrackOutput* output = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:track outputSettings:@{
        (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
      }];
      [reader addOutput:output];
      [reader startReading];
      uint32_t frames = 0;
      while (CMSampleBufferRef sample = [output copyNextSampleBuffer]) {
        CVImageBufferRef image = CMSampleBufferGetImageBuffer(sample);
        if (image) {
          const size_t w = CVPixelBufferGetWidth(image), h = CVPixelBufferGetHeight(image);
          void* data = nullptr;
          napi_value buffer;
          napi_create_buffer(env, w * h * 4, &data, &buffer);
          CVPixelBufferLockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
          const auto* base = static_cast<const uint8_t*>(CVPixelBufferGetBaseAddress(image));
          const size_t stride = CVPixelBufferGetBytesPerRow(image);
          for (size_t y = 0; y < h; ++y) std::memcpy(static_cast<uint8_t*>(data) + y * w * 4, base + y * stride, w * 4);
          CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
          if (frames == 0) setProp(env, out, "firstFrame", buffer);
          setProp(env, out, "lastFrame", buffer);
          ++frames;
        }
        CFRelease(sample);
      }
      setNumber(env, out, "frames", frames);
    }
  }
  if (!out) napi_get_null(env, &out);
  return out;
}

// ─── Module ───────────────────────────────────────────────────────────────────

static napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor props[] = {
    {"available", nullptr, Available, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"audioInputs", nullptr, AudioInputs, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"open", nullptr, Open, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"pushTexture", nullptr, PushTexture, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"pushPixels", nullptr, PushPixels, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stats", nullptr, Stats, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"probe", nullptr, Probe, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(recorder, Init)

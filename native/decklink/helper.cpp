// Kairo-owned implementation. SDK headers/dispatch are supplied at build time;
// the user's Desktop Video installation supplies the runtime framework.
#include "DeckLinkAPI.h"
#include "frame-input.h"
#include "uyvy.h"
#include "../gpu-frames/ring.h"
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <iostream>
#include <mutex>
#include <memory>
#include <limits>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <sstream>

static std::mutex eventLock;
static void emitEvent(const std::string& event) {
 std::lock_guard<std::mutex> guard(eventLock);
 std::cout << event << std::endl;
}
template<class T> struct Ref {
 T* p = nullptr;
 ~Ref() { if (p) p->Release(); }
 T** out() { return &p; }
 T* operator->() const { return p; }
};
static void check(HRESULT hr, const char* action) {
 if (hr != S_OK) throw std::runtime_error(std::string(action) + (hr == E_ACCESSDENIED ? ": In use by another app (ProPresenter?)" : ": SDK error " + std::to_string(hr)));
}
static std::string str(CFStringRef value) {
 if (!value) return "";
 std::vector<char> bytes(CFStringGetMaximumSizeForEncoding(CFStringGetLength(value), kCFStringEncodingUTF8) + 1);
 CFStringGetCString(value, bytes.data(), bytes.size(), kCFStringEncodingUTF8);
 CFRelease(value); return bytes.data();
}
static std::string quote(const std::string& s) {
 std::string r = "\"";
 for (unsigned char c : s) { if (c == '"' || c == '\\') r += '\\'; if (c < 32) { const char* h="0123456789abcdef"; r += "\\u00"; r += h[c>>4]; r += h[c&15]; } else r += c; }
 return r + "\"";
}
static std::string id(IDeckLink* device) {
 Ref<IDeckLinkProfileAttributes> attrs;
 check(device->QueryInterface(IID_IDeckLinkProfileAttributes, reinterpret_cast<void**>(attrs.out())), "Read device attributes");
 int64_t persistent=0, sub=0;
 check(attrs->GetInt(BMDDeckLinkPersistentID, &persistent), "Read persistent device id");
 check(attrs->GetInt(BMDDeckLinkSubDeviceIndex, &sub), "Read sub-device index");
 return "decklink:" + std::to_string(persistent) + ":" + std::to_string(sub);
}
// Never schedule into the past after a late callback. Time is SDK stream time.
static int64_t nextTime(int64_t next, int64_t now, int64_t duration) {
 return std::max(next, ((now / duration) + 1) * duration);
}
static void list() {
 Ref<IDeckLinkIterator> iter; iter.p=CreateDeckLinkIteratorInstance();
 if (!iter.p) throw std::runtime_error("Blackmagic Desktop Video runtime unavailable");
 Ref<IDeckLinkAPIInformation> info; info.p=CreateDeckLinkAPIInformationInstance();
 CFStringRef version=nullptr; if (info.p) info->GetString(BMDDeckLinkAPIVersion, &version);
 std::cout << "{\"version\":" << quote(str(version)) << ",\"ports\":[";
 bool comma=false;
 for (;;) {
  Ref<IDeckLink> device; if (iter->Next(device.out()) != S_OK) break;
  Ref<IDeckLinkOutput> output;
  if (device->QueryInterface(IID_IDeckLinkOutput, reinterpret_cast<void**>(output.out())) != S_OK) continue;
  CFStringRef model=nullptr, name=nullptr; device->GetModelName(&model); device->GetDisplayName(&name);
  if (comma) std::cout << ','; comma=true;
  std::cout << "{\"id\":" << quote(id(device.p)) << ",\"provider\":\"decklink\",\"deviceName\":" << quote(str(model))
    << ",\"portName\":" << quote(str(name)) << ",\"supportsKeyFill\":false,\"modes\":[";
  Ref<IDeckLinkDisplayModeIterator> modes; check(output->GetDisplayModeIterator(modes.out()), "Read modes");
  bool modeComma=false;
  for (;;) {
   Ref<IDeckLinkDisplayMode> mode; if (modes->Next(mode.out()) != S_OK) break;
   bool supported=false; BMDDisplayMode actual;
   output->DoesSupportVideoMode(bmdVideoConnectionUnspecified, mode->GetDisplayMode(), bmdFormat8BitYUV, bmdNoVideoOutputConversion, bmdSupportedVideoModeDefault, &actual, &supported);
   // Initial qualification is HD only; SD requires a Rec.601 conversion path.
   if (!supported || mode->GetHeight()<720) continue;
   CFStringRef label=nullptr; mode->GetName(&label); BMDTimeValue duration; BMDTimeScale scale; mode->GetFrameRate(&duration,&scale);
   if (modeComma) std::cout << ','; modeComma=true;
   std::cout << "{\"id\":" << quote("decklink:"+std::to_string(mode->GetDisplayMode())) << ",\"label\":" << quote(str(label))
    << ",\"width\":" << mode->GetWidth() << ",\"height\":" << mode->GetHeight() << ",\"frameRateN\":" << scale
    << ",\"frameRateD\":" << duration << ",\"interlaced\":" << (mode->GetFieldDominance()==bmdUpperFieldFirst || mode->GetFieldDominance()==bmdLowerFieldFirst ? "true" : "false") << '}';
  }
  std::cout << "],\"unavailableReason\":" << (modeComma ? "null" : quote("No output modes available in the current device profile")) << "}";
 }
 std::cout << "]}" << std::endl;
}
// Read side of the gpu-frames ring (plan 008): UYVY frames Kairo converted on
// the GPU, already at the output raster. Unlinked here too, so a Kairo crash
// cannot leave the segment behind once the helper exits.
class ShmInput {
 std::string name;
 void* base=nullptr; size_t bytes=0;
public:
 const kairo_ring::Header* header=nullptr;
 ShmInput(const std::string& n, long width, long height):name(n) {
  const int fd=shm_open(name.c_str(),O_RDONLY,0);
  if (fd<0) throw std::runtime_error("Frame ring not found");
  struct stat info{};
  if (fstat(fd,&info)!=0 || info.st_size<static_cast<off_t>(kairo_ring::HEADER_BYTES)) { ::close(fd); throw std::runtime_error("Frame ring too small"); }
  bytes=static_cast<size_t>(info.st_size);
  base=mmap(nullptr,bytes,PROT_READ,MAP_SHARED,fd,0); ::close(fd);
  if (base==MAP_FAILED) { base=nullptr; throw std::runtime_error("Frame ring map failed"); }
  header=static_cast<const kairo_ring::Header*>(base);
  if (!kairo_ring::compatible(header,uint32_t(width),uint32_t(height)) || bytes<kairo_ring::totalBytes(header->slotBytes)) {
   munmap(base,bytes); base=nullptr; throw std::runtime_error("Frame ring raster does not match the output mode");
  }
 }
 ~ShmInput() { if (base) munmap(base,bytes); shm_unlink(name.c_str()); }
 const void* data() const { return base; }
};
class Playback : public IDeckLinkVideoOutputCallback {
 std::atomic<ULONG> refs{1};
 std::mutex lock; std::condition_variable stopped;
 bool stopping=false, didStop=false;
 std::shared_ptr<const std::vector<uint8_t>> latest;
 int64_t next=0;
 uint64_t lastScheduledVersion=0;
public:
 Ref<IDeckLinkOutput> output;
 std::vector<IDeckLinkMutableVideoFrame*> frames;
 std::unique_ptr<ShmInput> shm;
 uint64_t shmPublished=0;
 BMDTimeValue duration=0; BMDTimeScale scale=0;
 std::atomic<uint64_t> completed{0}, late{0}, dropped{0}, flushed{0}, errors{0}, received{0}, repeated{0};
 ~Playback() { for (auto* f: frames) f->Release(); }
 HRESULT QueryInterface(REFIID iid, LPVOID* ppv) override {
  if (!ppv) return E_INVALIDARG; *ppv=nullptr;
  const auto unknown = CFUUIDGetUUIDBytes(IUnknownUUID);
  if (std::memcmp(&iid, &IID_IDeckLinkVideoOutputCallback, sizeof(iid)) == 0 || std::memcmp(&iid, &unknown, sizeof(iid)) == 0) { *ppv=this; AddRef(); return S_OK; }
  return E_NOINTERFACE;
 }
 ULONG AddRef() override { return ++refs; }
 ULONG Release() override { auto n=--refs; if (!n) delete this; return n; }
 HRESULT ScheduledFrameCompleted(IDeckLinkVideoFrame* frame, BMDOutputFrameCompletionResult result) override {
  std::lock_guard<std::mutex> guard(lock);
  if (result==bmdOutputFrameCompleted) ++completed;
  else if (result==bmdOutputFrameDisplayedLate) ++late;
  else if (result==bmdOutputFrameDropped) ++dropped;
  else ++flushed;
  if (stopping || result==bmdOutputFrameFlushed) return S_OK;
  BMDTimeValue now=0; double speed=0;
  if (output->GetScheduledStreamTime(scale,&now,&speed)!=S_OK) { fail(); return S_OK; }
  if (shm) {
   // Newest complete GPU frame, if one arrived. A slot being rewritten is
   // skipped and the previous frame repeats, on the hardware clock as ever.
   auto fresh=std::make_shared<std::vector<uint8_t>>(kairo_ring::frameBytes(uint32_t(frames[0]->GetWidth()),uint32_t(frames[0]->GetHeight())));
   if (kairo_ring::readNewest(shm->header,shm->data(),shmPublished,fresh->data(),fresh->size())) { latest=fresh; ++received; }
  }
  if (latest) {
   const auto version=received.load();
   if (version==lastScheduledVersion) ++repeated;
   lastScheduledVersion=version;
   Ref<IDeckLinkVideoBuffer> buffer;
   HRESULT hr=frame->QueryInterface(IID_IDeckLinkVideoBuffer,reinterpret_cast<void**>(buffer.out()));
   if (hr==S_OK) hr=buffer->StartAccess(bmdBufferAccessWrite);
   if (hr!=S_OK) { fail(); return S_OK; }
   void* bytes=nullptr; hr=buffer->GetBytes(&bytes);
   if (hr==S_OK) std::memcpy(bytes,latest->data(),latest->size());
   HRESULT end=buffer->EndAccess(bmdBufferAccessWrite);
   if (hr!=S_OK || end!=S_OK) { fail(); return S_OK; }
  }
  next=nextTime(next,now,duration);
  if (output->ScheduleVideoFrame(frame,next,duration,scale)!=S_OK) fail();
  next+=duration; return S_OK;
 }
 std::mutex& frameLock() { return lock; }
 void fail() {
  if (++errors==1) emitEvent("{\"event\":\"error\",\"reason\":\"DeckLink playback failed\"}");
 }
 void update(const std::vector<uint8_t>& bgra, uint32_t width, uint32_t height) {
  if (frames.empty()) throw std::runtime_error("Output not started");
  const long w=frames[0]->GetWidth(), h=frames[0]->GetHeight();
  auto converted=std::make_shared<std::vector<uint8_t>>(w*h*2);
  convertFrame(bgra.data(),width,height,converted->data(),w,h);
  std::lock_guard<std::mutex> guard(lock); latest=converted; ++received;
 }
 HRESULT ScheduledPlaybackHasStopped() override {
  std::lock_guard<std::mutex> guard(lock); didStop=true; if (!stopping) fail(); stopped.notify_all(); return S_OK;
 }
 void start(IDeckLink* device, BMDDisplayMode selected, bool red=true) {
  check(device->QueryInterface(IID_IDeckLinkOutput, reinterpret_cast<void**>(output.out())), "Acquire output");
  Ref<IDeckLinkDisplayMode> mode; check(output->GetDisplayMode(selected,mode.out()), "Read selected mode");
  check(mode->GetFrameRate(&duration,&scale), "Read frame rate");
  if (duration<=0 || scale<=0 || mode->GetWidth()<=0 || mode->GetWidth()%2 || mode->GetHeight()<720) throw std::runtime_error("Invalid output raster or clock");
  bool supported=false; BMDDisplayMode actual;
  check(output->DoesSupportVideoMode(bmdVideoConnectionUnspecified,selected,bmdFormat8BitYUV,bmdNoVideoOutputConversion,bmdSupportedVideoModeDefault,&actual,&supported),"Check selected mode");
  if (!supported || actual!=selected) throw std::runtime_error("Unsupported video mode");
  check(output->EnableVideoOutput(selected,bmdVideoOutputFlagDefault), "Enable video output");
  check(output->SetScheduledFrameCompletionCallback(this), "Install scheduler");
  for (int i=0;i<3;++i) {
   IDeckLinkMutableVideoFrame* frame=nullptr;
   check(output->CreateVideoFrame(mode->GetWidth(),mode->GetHeight(),mode->GetWidth()*2,bmdFormat8BitYUV,bmdFrameFlagDefault,&frame), "Create preroll frame");
   frames.push_back(frame); Ref<IDeckLinkVideoBuffer> buffer;
   check(frame->QueryInterface(IID_IDeckLinkVideoBuffer,reinterpret_cast<void**>(buffer.out())),"Acquire frame buffer");
   check(buffer->StartAccess(bmdBufferAccessWrite),"Access frame buffer"); void* data=nullptr;
   check(buffer->GetBytes(&data),"Read frame buffer");
   const uint8_t color[8]={0,0,static_cast<uint8_t>(red?255:0),255,0,0,static_cast<uint8_t>(red?255:0),255}; uint8_t pixel[4]; uyvy(color,pixel);
   auto* bytes=static_cast<uint8_t*>(data);
   for (long n=0;n<mode->GetWidth()*mode->GetHeight()*2;n+=4) std::memcpy(bytes+n,pixel,4);
   check(buffer->EndAccess(bmdBufferAccessWrite),"Finish frame access");
   check(output->ScheduleVideoFrame(frame,next,duration,scale), "Preroll frame"); next+=duration;
  }
  check(output->StartScheduledPlayback(0,scale,1.0),"Start scheduled playback");
 }
 void close() {
  if (!output.p) return;
  { std::lock_guard<std::mutex> guard(lock); stopping=true; }
  output->StopScheduledPlayback(0,nullptr,scale);
  { std::unique_lock<std::mutex> guard(lock); stopped.wait_for(guard,std::chrono::seconds(3),[&]{return didStop;}); }
  output->SetScheduledFrameCompletionCallback(nullptr); output->DisableVideoOutput();
 }
};
// Reports SDK counters even when the producer is idle. RAII joins before playback closes.
static long frames0Width(Playback& p) { return p.frames.at(0)->GetWidth(); }
static long frames0Height(Playback& p) { return p.frames.at(0)->GetHeight(); }
class PlaybackReporter {
 Playback& playback;
 std::atomic<bool> stopping{false};
 std::thread thread;
public:
 explicit PlaybackReporter(Playback& p):playback(p),thread([this] {
  auto last=std::chrono::steady_clock::now(); uint64_t delivered=0;
  while (!stopping) {
   for (int i=0;i<10 && !stopping;++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
   if (stopping) break;
   const auto now=std::chrono::steady_clock::now();
   const auto total=playback.completed.load()+playback.late.load();
   const double fps=(total-delivered)/std::chrono::duration<double>(now-last).count();
   std::ostringstream event;
   event << "{\"event\":\"stats\",\"completed\":" << playback.completed
    << ",\"late\":" << playback.late << ",\"dropped\":" << playback.dropped
    << ",\"repeated\":" << playback.repeated << ",\"received\":" << playback.received
    << ",\"outputFps\":" << fps << '}';
   emitEvent(event.str()); delivered=total; last=now;
  }
 }) {}
 ~PlaybackReporter() { stopping=true; thread.join(); }
};
int main(int argc,char** argv) {
 try {
  if (argc==2 && std::string(argv[1])=="--self-test") {
   if (nextTime(3003,9009,1001)!=10010 || nextTime(12012,9009,1001)!=12012) throw std::runtime_error("Clock recovery failed");
   uint8_t black[8]={0,0,0,255,0,0,0,255}, white[8]={255,255,255,255,255,255,255,255}, pixel[4];
   uyvy(black,pixel); if (pixel[0]!=128 || pixel[1]!=16 || pixel[2]!=128 || pixel[3]!=16) throw std::runtime_error("Black conversion failed");
   const uint8_t red[8]={0,0,255,255,0,0,255,255};
   uyvy(red,pixel); if (pixel[0]!=102 || pixel[1]!=63 || pixel[2]!=240) throw std::runtime_error("Rec.709 red conversion failed");
   uyvy(white,pixel); if (pixel[1]!=235 || pixel[3]!=235) throw std::runtime_error("White conversion failed");
   std::cout << "{\"ok\":true}" << std::endl; return 0;
  }
  if (argc==2 && std::string(argv[1])=="--list") { list(); return 0; }
  const bool shmMode=argc==5 && std::string(argv[1])=="--play-shm";
  const bool stream=(argc==4 && std::string(argv[1])=="--play") || shmMode;
  const bool probe=argc==5 && std::string(argv[1])=="--probe";
  if ((!stream && !probe) || std::string(argv[2]).rfind("decklink:",0)!=0 || std::string(argv[3]).rfind("decklink:",0)!=0) { std::cerr << "Invalid arguments: --list, --play PORT MODE, --play-shm PORT MODE RING, or --probe PORT MODE SECONDS\n"; return 2; }
  int seconds=0; BMDDisplayMode selected;
  try {
   size_t used=0; std::string modeText=std::string(argv[3]).substr(9);
   unsigned long number=std::stoul(modeText,&used);
   if (used!=modeText.size() || number>std::numeric_limits<uint32_t>::max()) throw std::invalid_argument("mode");
   selected=static_cast<BMDDisplayMode>(number);
   if (shmMode && (argv[4][0]!='/' || std::string(argv[4]).size()>30)) throw std::invalid_argument("ring");
   if (probe) { std::string text=argv[4]; seconds=std::stoi(text,&used); if (used!=text.size() || seconds<1 || seconds>3600) throw std::invalid_argument("duration"); }
  } catch (...) { std::cerr << "Invalid mode, ring name or probe duration\n"; return 2; }
  Ref<IDeckLinkIterator> iter; iter.p=CreateDeckLinkIteratorInstance(); if (!iter.p) throw std::runtime_error("Blackmagic Desktop Video runtime unavailable");
  Ref<IDeckLink> found;
  for (;;) { Ref<IDeckLink> device; if (iter->Next(device.out())!=S_OK) break; if (id(device.p)==argv[2]) { found.p=device.p; device.p=nullptr; break; } }
  if (!found.p) throw std::runtime_error("Device disconnected");
  Playback* playback=new Playback();
  try {
   playback->start(found.p,selected,!stream);
   if (shmMode) {
    // stdin BGRA keeps working either way: it is Kairo's CPU fallback.
    try {
     auto input=std::make_unique<ShmInput>(argv[4],frames0Width(*playback),frames0Height(*playback));
     { std::lock_guard<std::mutex> guard(playback->frameLock()); playback->shm=std::move(input); }
     emitEvent("{\"event\":\"ring\",\"ok\":true}");
    } catch (const std::exception& e) {
     emitEvent("{\"event\":\"ring\",\"ok\":false,\"reason\":"+quote(e.what())+"}");
    }
   }
   std::cout << "{\"event\":\"started\",\"port\":" << quote(argv[2]) << "}" << std::endl;
   if (stream) {
    PlaybackReporter reporter(*playback);
    for (;;) {
     uint8_t header[12]; const auto headerSize=readFrameInput(header,sizeof(header));
     if (headerSize==0) break;
     if (headerSize!=sizeof(header)) throw std::runtime_error("Truncated frame header");
     auto word=[&](int i) { return uint32_t(header[i]) | uint32_t(header[i+1])<<8 | uint32_t(header[i+2])<<16 | uint32_t(header[i+3])<<24; };
     uint32_t width=word(0),height=word(4),size=word(8);
     if (!width || !height || width>4096 || height>2160 || uint64_t(width)*height*4!=size) throw std::runtime_error("Invalid BGRA frame packet");
     std::vector<uint8_t> bytes(size);
     if (readFrameInput(bytes.data(),size)!=size) throw std::runtime_error("Truncated frame payload");
     playback->update(bytes,width,height);
    }
   }
   // No producer updates: SDK callbacks repeat immutable preroll frames.
   for (int n=0;n<seconds;++n) { std::this_thread::sleep_for(std::chrono::seconds(1)); if ((n+1)%10==0) std::cout << "{\"event\":\"progress\",\"seconds\":" << n+1 << ",\"completed\":" << playback->completed << ",\"late\":" << playback->late << ",\"dropped\":" << playback->dropped << "}" << std::endl; }
   playback->close();
   std::cout << "{\"event\":\"stopped\",\"completed\":" << playback->completed << ",\"late\":" << playback->late << ",\"dropped\":" << playback->dropped << ",\"flushed\":" << playback->flushed << ",\"errors\":" << playback->errors << "}" << std::endl;
   bool ok=playback->completed>0 && playback->late==0 && playback->dropped==0 && playback->errors==0;
   playback->Release(); return ok ? 0 : 1;
  } catch (...) { playback->close(); playback->Release(); throw; }
 } catch (const std::exception& e) { std::cerr << e.what() << std::endl; return 1; }
}

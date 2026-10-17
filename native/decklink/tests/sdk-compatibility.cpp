#include "../sdk-compatibility.h"
#define main helperMain
#include "../helper.cpp"
#undef main
#include <cassert>
#include <cstring>

static bool same(REFIID a, REFIID b) { return std::memcmp(&a,&b,sizeof(a))==0; }

template<class Interface> class Buffer : public Interface {
public:
 ULONG refs=1;
 int starts=0, ends=0;
 uint8_t bytes[4]={};
 HRESULT QueryInterface(REFIID, void**) override { return E_NOINTERFACE; }
 ULONG AddRef() override { return ++refs; }
 ULONG Release() override { return --refs; }
 HRESULT GetBytes(void** data) override { *data=bytes; return S_OK; }
 // Only the modern interface has GetSize. In the legacy interface the next
 // vtable slot is StartAccess: treating it as modern would corrupt playback.
 HRESULT GetSize(uint64_t* size) { *size=sizeof(bytes); return S_OK; }
 HRESULT StartAccess(BMDBufferAccessFlags flags) override { assert(flags==bmdBufferAccessWrite); ++starts; return S_OK; }
 HRESULT EndAccess(BMDBufferAccessFlags flags) override { assert(flags==bmdBufferAccessWrite); ++ends; return S_OK; }
};

class Frame : public IDeckLinkVideoFrame {
public:
 bool modern;
 Buffer<IDeckLinkVideoBuffer> current;
 Buffer<IDeckLinkVideoBuffer_v15_3_1> old;
 explicit Frame(bool enabled):modern(enabled) {}
 HRESULT QueryInterface(REFIID iid, void** value) override {
  *value=nullptr;
  if (modern && same(iid,IID_IDeckLinkVideoBuffer)) { current.AddRef(); *value=&current; return S_OK; }
  if (same(iid,IID_IDeckLinkVideoBuffer_v15_3_1)) { old.AddRef(); *value=&old; return S_OK; }
  return E_NOINTERFACE;
 }
 ULONG AddRef() override { return 1; }
 ULONG Release() override { return 1; }
 long GetWidth() override { return 2; }
 long GetHeight() override { return 1; }
 long GetRowBytes() override { return 4; }
 BMDPixelFormat GetPixelFormat() override { return bmdFormat8BitYUV; }
 BMDFrameFlags GetFlags() override { return bmdFrameFlagDefault; }
 HRESULT GetTimecode(BMDTimecodeFormat, IDeckLinkTimecode**) override { return E_NOTIMPL; }
 HRESULT GetAncillaryData(IDeckLinkVideoFrameAncillary**) override { return E_NOTIMPL; }
};

template<class Interface> class Attributes : public Interface {
public:
 ULONG refs=1;
 int64_t sub=3;
 bool inactive=true;
 HRESULT QueryInterface(REFIID, void**) override { return E_NOINTERFACE; }
 ULONG AddRef() override { return ++refs; }
 ULONG Release() override { return --refs; }
 HRESULT GetFlag(BMDDeckLinkAttributeID, bool*) override { return E_NOTIMPL; }
 HRESULT GetInt(BMDDeckLinkAttributeID id, int64_t* value) override {
  if (id==BMDDeckLinkPersistentID) *value=123;
  else if (id==BMDDeckLinkSubDeviceIndex) *value=sub;
  else if (id==BMDDeckLinkDuplex) *value=inactive?bmdDuplexInactive:bmdDuplexHalf;
  else return E_NOTIMPL;
  return S_OK;
 }
 HRESULT GetFloat(BMDDeckLinkAttributeID, double*) override { return E_NOTIMPL; }
 HRESULT GetString(BMDDeckLinkAttributeID, CFStringRef*) override { return E_NOTIMPL; }
 HRESULT GetStringWithParam(BMDDeckLinkAttributeID, uint64_t, CFStringRef*) { return E_NOTIMPL; }
};

class Device : public IDeckLink {
public:
 bool modern;
 Attributes<IDeckLinkProfileAttributes> current;
 Attributes<IDeckLinkProfileAttributes_v15_3_1> old;
 explicit Device(bool enabled):modern(enabled) {}
 HRESULT QueryInterface(REFIID iid, void** value) override {
  *value=nullptr;
  if (modern && same(iid,IID_IDeckLinkProfileAttributes)) { current.AddRef(); *value=&current; return S_OK; }
  if (same(iid,IID_IDeckLinkProfileAttributes_v15_3_1)) { old.AddRef(); *value=&old; return S_OK; }
  return E_NOINTERFACE;
 }
 ULONG AddRef() override { return 1; }
 ULONG Release() override { return 1; }
 HRESULT GetModelName(CFStringRef* name) override { *name=CFStringCreateCopy(nullptr,CFSTR("DeckLink Duo 2")); return S_OK; }
 HRESULT GetDisplayName(CFStringRef* name) override { *name=CFStringCreateWithFormat(nullptr,nullptr,CFSTR("DeckLink Duo 2 (%lld)"),current.sub+1); return S_OK; }
};

class Iterator : public IDeckLinkIterator {
 size_t next=0;
public:
 std::vector<Device*> devices;
 HRESULT QueryInterface(REFIID, void**) override { return E_NOINTERFACE; }
 ULONG AddRef() override { return 1; }
 ULONG Release() override { return 1; }
 HRESULT Next(IDeckLink** device) override {
  *device=nullptr;
  if (next==devices.size()) return S_FALSE;
  *device=devices[next++]; (*device)->AddRef(); return S_OK;
 }
};

int main() {
 for (bool modern : {true,false}) {
  Frame frame(modern);
  Device device(modern);
  {
   FrameBufferAPI buffer;
   assert(buffer.acquire(&frame)==S_OK);
   assert(buffer.legacy()==!modern);
   assert(buffer.StartAccess()==S_OK);
   void* bytes=nullptr;
   assert(buffer.GetBytes(&bytes)==S_OK);
   std::memset(bytes,42,4);
   assert(buffer.EndAccess()==S_OK);
   assert(modern ? frame.current.starts==1 && frame.current.ends==1 && frame.current.bytes[0]==42
                 : frame.old.starts==1 && frame.old.ends==1 && frame.old.bytes[0]==42);
   AttributesAPI attrs;
   assert(attrs.acquire(&device)==S_OK);
   int64_t value=0;
   assert(attrs.GetInt(BMDDeckLinkPersistentID,&value)==S_OK && value==123);
   assert(attrs.GetInt(BMDDeckLinkSubDeviceIndex,&value)==S_OK && value==3);
   assert(attrs.GetInt(BMDDeckLinkDuplex,&value)==S_OK && value==bmdDuplexInactive);
  }
  assert(frame.current.refs==1 && frame.old.refs==1);
  assert(device.current.refs==1 && device.old.refs==1);

  // Exercise the production enumerator: even channels without a compatible
  // output interface must appear with a reason, rather than disappear.
  Device a(modern), b(modern), c(modern), d(modern);
  Iterator iterator;
  iterator.devices={&a,&b,&c,&d};
  for (size_t i=0;i<iterator.devices.size();++i) {
   auto* dev=iterator.devices[i];
   dev->current.sub=dev->old.sub=static_cast<int64_t>(i);
   dev->current.inactive=dev->old.inactive=i>=2;
  }
  std::ostringstream captured;
  auto* previous=std::cout.rdbuf(captured.rdbuf());
  listPorts(iterator,modern?"16.4":"15.3.1");
  std::cout.rdbuf(previous);
  const auto json=captured.str();
  for (int i=0;i<4;++i) assert(json.find("decklink:123:"+std::to_string(i))!=std::string::npos);
  assert(json.find("Inactive in the current card profile")!=std::string::npos);
  assert(json.find("No compatible video-output interface")!=std::string::npos);
 }
}

#include "../compatibility.h"
#include <cassert>
#include <cstring>
#include <iostream>

// Minimal COM boundary: the real adapter must use each interface's own vtable.
struct Modern { int refs=0; void Release() { --refs; } int value() { return 16; } };
struct Legacy { int refs=0; void Release() { --refs; } int value() { return 15; } };
struct Device {
 Modern modern; Legacy legacy;
 bool current, old;
 int queries=0;
 int QueryInterface(int iid, void** out) {
  ++queries; *out=nullptr;
  if (iid==16 && current) { ++modern.refs; *out=&modern; return 0; }
  if (iid==15 && old) { ++legacy.refs; *out=&legacy; return 0; }
  return -1;
 }
};
int main() {
 for (const auto& flags : {std::pair<bool,bool>{true,true}, {false,true}, {false,false}}) {
  Device device{{},{},flags.first,flags.second};
  {
   CompatibleInterface<Modern,Legacy> api;
   const int hr=api.acquire(&device,16,15);
   assert(api.available()==(flags.first || flags.second));
   if (api.available()) {
    assert(hr==0);
    assert(api.call([](auto* p) { return p->value(); })==(flags.first?16:15));
    assert(api.legacy()==!flags.first);
   } else assert(hr!=0);
   assert(device.queries==(flags.first?1:2));
  }
  assert(device.modern.refs==0 && device.legacy.refs==0);
 }
 assert(outputUnavailable(true, false, false)=="Inactive in the current card profile. Check connector mapping in Desktop Video Setup.");
 assert(outputUnavailable(false, false, false).find("compatible video-output interface")!=std::string::npos);
 assert(outputUnavailable(false, true, false).find("No HD output modes")!=std::string::npos);
 assert(outputUnavailable(false, true, true).empty());
 std::cout << "compatibility negotiation and profile diagnostics passed\n";
}

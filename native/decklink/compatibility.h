#pragma once
#include <string>

// Keep distinct COM interfaces typed: their method layouts may differ even
// when the calls we use have the same names. Never cast one vtable to another.
template<class Current, class Legacy> class CompatibleInterface {
 Current* current=nullptr;
 Legacy* previous=nullptr;
public:
 CompatibleInterface()=default;
 CompatibleInterface(const CompatibleInterface&)=delete;
 CompatibleInterface& operator=(const CompatibleInterface&)=delete;
 ~CompatibleInterface() { reset(); }
 void reset() {
  if (current) { current->Release(); current=nullptr; }
  if (previous) { previous->Release(); previous=nullptr; }
 }
 template<class Device, class IID> auto acquire(Device* device, const IID& modernID, const IID& legacyID) {
  reset();
  auto hr=device->QueryInterface(modernID,reinterpret_cast<void**>(&current));
  if (hr==0) return hr;
  return device->QueryInterface(legacyID,reinterpret_cast<void**>(&previous));
 }
 bool available() const { return current || previous; }
 bool legacy() const { return previous!=nullptr; }
 template<class Fn> auto call(Fn fn) { return current ? fn(current) : fn(previous); }
};

inline std::string outputUnavailable(bool inactive, bool hasOutput, bool hasModes) {
 if (inactive) return "Inactive in the current card profile. Check connector mapping in Desktop Video Setup.";
 if (!hasOutput) return "No compatible video-output interface. Check Desktop Video version and connector mapping.";
 if (!hasModes) return "No HD output modes available in the current card profile.";
 return "";
}

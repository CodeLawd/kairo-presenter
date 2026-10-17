#pragma once
#include "DeckLinkAPI.h"
#include "DeckLinkAPIVideoOutput_v15_3_1.h"
#include "compatibility.h"

class OutputAPI : public CompatibleInterface<IDeckLinkOutput,IDeckLinkOutput_v15_3_1> {
public:
 HRESULT acquire(IDeckLink* device) { return CompatibleInterface::acquire(device,IID_IDeckLinkOutput,IID_IDeckLinkOutput_v15_3_1); }
 OutputAPI* operator->() { return this; }
 // The SDK interfaces share these signatures, but not their vtable layout.
#define KAIRO_OUTPUT_METHOD(name, params, args) HRESULT name params { return call([&](auto* p) { return p->name args; }); }
 KAIRO_OUTPUT_METHOD(GetDisplayMode, (BMDDisplayMode mode, IDeckLinkDisplayMode** result), (mode,result))
 KAIRO_OUTPUT_METHOD(GetDisplayModeIterator, (IDeckLinkDisplayModeIterator** result), (result))
 KAIRO_OUTPUT_METHOD(DoesSupportVideoMode, (BMDVideoConnection connection, BMDDisplayMode mode, BMDPixelFormat pixel, BMDVideoOutputConversionMode conversion, BMDSupportedVideoModeFlags flags, BMDDisplayMode* actual, bool* supported), (connection,mode,pixel,conversion,flags,actual,supported))
 KAIRO_OUTPUT_METHOD(EnableVideoOutput, (BMDDisplayMode mode, BMDVideoOutputFlags flags), (mode,flags))
 KAIRO_OUTPUT_METHOD(DisableVideoOutput, (), ())
 KAIRO_OUTPUT_METHOD(SetScheduledFrameCompletionCallback, (IDeckLinkVideoOutputCallback* callback), (callback))
 KAIRO_OUTPUT_METHOD(CreateVideoFrame, (int32_t width, int32_t height, int32_t stride, BMDPixelFormat pixel, BMDFrameFlags flags, IDeckLinkMutableVideoFrame** frame), (width,height,stride,pixel,flags,frame))
 KAIRO_OUTPUT_METHOD(ScheduleVideoFrame, (IDeckLinkVideoFrame* frame, BMDTimeValue time, BMDTimeValue duration, BMDTimeScale scale), (frame,time,duration,scale))
 KAIRO_OUTPUT_METHOD(StartScheduledPlayback, (BMDTimeValue start, BMDTimeScale scale, double speed), (start,scale,speed))
 KAIRO_OUTPUT_METHOD(StopScheduledPlayback, (BMDTimeValue stop, BMDTimeValue* actual, BMDTimeScale scale), (stop,actual,scale))
 KAIRO_OUTPUT_METHOD(GetScheduledStreamTime, (BMDTimeScale scale, BMDTimeValue* time, double* speed), (scale,time,speed))
#undef KAIRO_OUTPUT_METHOD
};

class AttributesAPI : public CompatibleInterface<IDeckLinkProfileAttributes,IDeckLinkProfileAttributes_v15_3_1> {
public:
 HRESULT acquire(IDeckLink* device) { return CompatibleInterface::acquire(device,IID_IDeckLinkProfileAttributes,IID_IDeckLinkProfileAttributes_v15_3_1); }
 HRESULT GetInt(BMDDeckLinkAttributeID id, int64_t* value) { return call([&](auto* p) { return p->GetInt(id,value); }); }
};

class FrameBufferAPI : public CompatibleInterface<IDeckLinkVideoBuffer,IDeckLinkVideoBuffer_v15_3_1> {
public:
 HRESULT acquire(IDeckLinkVideoFrame* frame) { return CompatibleInterface::acquire(frame,IID_IDeckLinkVideoBuffer,IID_IDeckLinkVideoBuffer_v15_3_1); }
 HRESULT GetBytes(void** bytes) { return call([&](auto* p) { return p->GetBytes(bytes); }); }
 HRESULT StartAccess() { return call([](auto* p) { return p->StartAccess(bmdBufferAccessWrite); }); }
 HRESULT EndAccess() { return call([](auto* p) { return p->EndAccess(bmdBufferAccessWrite); }); }
};

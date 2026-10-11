#pragma once
// BGRA → UYVY, Rec.709 limited range. The single CPU definition: the helper
// uses it for `--play`, and the gpu-frames golden tests compile it as the
// reference the Metal shader must match byte for byte (plan 008).
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

static inline uint8_t clamp8(int x) { return static_cast<uint8_t>(std::clamp(x, 0, 255)); }

// Limited-range Rec.709 from opaque/composited BGRA, two pixels per UYVY group.
static inline void uyvy(const uint8_t* p, uint8_t* d) {
 auto y=[](const uint8_t* v) { return clamp8(((47*v[2]+157*v[1]+16*v[0]+128)>>8)+16); };
 int b=(p[0]+p[4])/2, g=(p[1]+p[5])/2, r=(p[2]+p[6])/2;
 d[0]=clamp8(((-26*r-87*g+112*b+128)>>8)+128); d[1]=y(p);
 d[2]=clamp8(((112*r-102*g-10*b+128)>>8)+128); d[3]=y(p+4);
}

// Nearest-neighbour scale `width`×`height` BGRA into a `w`×`h` UYVY frame.
static inline void convertFrame(const uint8_t* bgra, uint32_t width, uint32_t height, uint8_t* out, long w, long h) {
 for (long y=0;y<h;++y) for (long x=0;x<w;x+=2) {
  uint8_t pair[8];
  for (int p=0;p<2;++p) {
   const size_t offset=((y*height/h)*width+((x+p)*width/w))*4;
   std::memcpy(pair+p*4,bgra+offset,4);
  }
  uyvy(pair,out+(y*w+x)*2);
 }
}

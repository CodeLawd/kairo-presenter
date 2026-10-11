// Seqlock ring checks (plan 008, Step 3): torn reads, in-progress slots,
// wrap-around, and incompatible rasters. Exit 0 and prints "ok" on success.
#include "../ring.h"
#include <cstdio>
#include <cstdlib>
#include <vector>

#define EXPECT(cond) do { if (!(cond)) { std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #cond); std::exit(1); } } while (0)

using namespace kairo_ring;

static void write(Header* h, void* base, uint32_t slot, uint8_t value) {
  beginWrite(h, slot);
  std::memset(slotData(base, slot, h->slotBytes), value, frameBytes(h->width, h->height));
  endWrite(h, slot);
}

int main() {
  const uint32_t w = 64, hgt = 8;
  std::vector<uint8_t> memory(totalBytes(slotBytesFor(w, hgt)) + PAGE);
  // Page-align like mmap does.
  void* base = reinterpret_cast<void*>((reinterpret_cast<uintptr_t>(memory.data()) + PAGE - 1) / PAGE * PAGE);
  auto* h = static_cast<Header*>(base);
  initHeader(h, w, hgt);
  EXPECT(compatible(h, w, hgt));
  EXPECT(!compatible(h, w * 2, hgt));
  std::vector<uint8_t> out(frameBytes(w, hgt));
  uint64_t last = 0;

  // Nothing published yet.
  EXPECT(!readNewest(h, base, last, out.data(), out.size()));

  // A slot mid-write is skipped.
  beginWrite(h, 0);
  h->published.fetch_add(1); // a reader that saw a stale bump must still not take it
  EXPECT(!readNewest(h, base, last, out.data(), out.size()));
  h->published.fetch_sub(1);
  endWrite(h, 0);
  EXPECT((h->slots[0].seq.load() & 1) == 0);

  // A complete frame is taken once.
  write(h, base, 1, 7);
  EXPECT(readNewest(h, base, last, out.data(), out.size()));
  EXPECT(out[0] == 7 && out.back() == 7);
  EXPECT(!readNewest(h, base, last, out.data(), out.size()));

  // Torn read: the writer starts on the slot during the copy → rejected, `last` unchanged.
  write(h, base, 2, 9);
  const uint64_t before = last;
  EXPECT(!readNewest(h, base, last, out.data(), out.size(), [&] { beginWrite(h, 2); }));
  EXPECT(last == before);
  std::memset(slotData(base, 2, h->slotBytes), 11, frameBytes(w, hgt));
  endWrite(h, 2);
  EXPECT(readNewest(h, base, last, out.data(), out.size()));
  EXPECT(out[0] == 11);

  // Wrap-around: many frames through three slots; the reader always gets the newest.
  for (int n = 0; n < 50; ++n) {
    const uint32_t slot = (h->latest.load() + 1) % SLOTS;
    write(h, base, slot, uint8_t(n));
    if (n % 3 == 0) {
      EXPECT(readNewest(h, base, last, out.data(), out.size()));
      EXPECT(out[0] == uint8_t(n) && out.back() == uint8_t(n));
    }
  }
  EXPECT(readNewest(h, base, last, out.data(), out.size()));
  EXPECT(out[0] == 49);
  EXPECT(last == h->published.load());
  std::puts("ok");
  return 0;
}

#pragma once
// Shared-memory frame ring between Kairo (writer: the gpu-frames addon) and the
// DeckLink helper (reader). Plan 008, Step 3.
//
// Layout: one 16 KiB header page, then SLOTS frame slots, each a whole number
// of 16 KiB pages so the writer can hand a slot to Metal without copying.
// Every slot carries a sequence number used as a seqlock: odd while the GPU is
// writing it, even once complete. A reader copies a slot only when the number
// is even and unchanged across the copy, so a frame is never shown torn.
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace kairo_ring {

constexpr uint32_t MAGIC = 0x3146474B; // "KGF1"
constexpr uint32_t VERSION = 1;
constexpr uint32_t SLOTS = 3;
/** Page size both Apple Silicon (16 KiB) and Intel (4 KiB) Macs divide. */
constexpr size_t PAGE = 16384;
constexpr size_t HEADER_BYTES = PAGE;

static_assert(sizeof(std::atomic<uint64_t>) == 8 && std::atomic<uint64_t>::is_always_lock_free,
  "ring atomics must be lock-free to work across processes");

struct Slot {
  std::atomic<uint64_t> seq;
  uint64_t reserved[7];
};

struct Header {
  uint32_t magic;
  uint32_t version;
  uint32_t width;
  uint32_t height;
  uint32_t slotCount;
  uint32_t slotBytes;
  /** Bumped once per completed frame; a reader compares it to what it last took. */
  std::atomic<uint64_t> published;
  /** Index of the newest complete slot. */
  std::atomic<uint32_t> latest;
  uint32_t reserved;
  Slot slots[SLOTS];
};

static_assert(sizeof(Header) <= HEADER_BYTES, "ring header must fit its page");

/** Bytes in one UYVY frame (two bytes per pixel). */
inline size_t frameBytes(uint32_t width, uint32_t height) {
  return size_t(width) * height * 2;
}

inline size_t slotBytesFor(uint32_t width, uint32_t height) {
  return (frameBytes(width, height) + PAGE - 1) / PAGE * PAGE;
}

inline size_t totalBytes(size_t slotBytes) {
  return HEADER_BYTES + SLOTS * slotBytes;
}

inline uint8_t* slotData(void* base, uint32_t index, size_t slotBytes) {
  return static_cast<uint8_t*>(base) + HEADER_BYTES + index * slotBytes;
}

inline const uint8_t* slotData(const void* base, uint32_t index, size_t slotBytes) {
  return static_cast<const uint8_t*>(base) + HEADER_BYTES + index * slotBytes;
}

inline void initHeader(Header* header, uint32_t width, uint32_t height) {
  header->magic = MAGIC;
  header->version = VERSION;
  header->width = width;
  header->height = height;
  header->slotCount = SLOTS;
  header->slotBytes = static_cast<uint32_t>(slotBytesFor(width, height));
  header->published.store(0, std::memory_order_relaxed);
  header->latest.store(0, std::memory_order_relaxed);
  for (auto& slot : header->slots) slot.seq.store(0, std::memory_order_relaxed);
  std::atomic_thread_fence(std::memory_order_release);
}

/** True when `header` is a ring this build can read at the given raster. */
inline bool compatible(const Header* header, uint32_t width, uint32_t height) {
  return header->magic == MAGIC && header->version == VERSION && header->slotCount == SLOTS &&
    header->width == width && header->height == height &&
    header->slotBytes == slotBytesFor(width, height);
}

// ─── Writer ──────────────────────────────────────────────────────────────────

/** Marks `index` as being written. Readers skip it until `endWrite`. */
inline void beginWrite(Header* header, uint32_t index) {
  header->slots[index].seq.fetch_add(1, std::memory_order_acq_rel);
}

/** Publishes `index` as the newest complete frame. */
inline void endWrite(Header* header, uint32_t index) {
  header->slots[index].seq.fetch_add(1, std::memory_order_release);
  header->latest.store(index, std::memory_order_release);
  header->published.fetch_add(1, std::memory_order_release);
}

// ─── Reader ──────────────────────────────────────────────────────────────────

/**
 * Copies the newest complete frame into `out` if one arrived since
 * `lastPublished`. Returns false when there is nothing new or the slot was
 * being rewritten during the copy (the caller keeps showing what it had).
 * `duringCopy` exists for tests: it runs between the copy and the check.
 */
template <class DuringCopy>
inline bool readNewest(const Header* header, const void* base, uint64_t& lastPublished,
                       uint8_t* out, size_t bytes, DuringCopy duringCopy) {
  const uint64_t published = header->published.load(std::memory_order_acquire);
  if (published == lastPublished) return false;
  const uint32_t index = header->latest.load(std::memory_order_acquire);
  if (index >= SLOTS) return false;
  const uint64_t before = header->slots[index].seq.load(std::memory_order_acquire);
  if (before & 1) return false;
  std::memcpy(out, slotData(base, index, header->slotBytes), bytes);
  duringCopy();
  std::atomic_thread_fence(std::memory_order_acquire);
  const uint64_t after = header->slots[index].seq.load(std::memory_order_relaxed);
  if (before != after) return false;
  lastPublished = published;
  return true;
}

inline bool readNewest(const Header* header, const void* base, uint64_t& lastPublished,
                       uint8_t* out, size_t bytes) {
  return readNewest(header, base, lastPublished, out, bytes, [] {});
}

} // namespace kairo_ring

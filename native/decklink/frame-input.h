#pragma once
#include <cstddef>
#include <cerrno>
#include <unistd.h>
#include <stdexcept>

// Read a complete packet component, or the bytes available before EOF.
inline std::size_t readFrameInput(void* bytes, std::size_t size) {
 // libc++'s synchronized cin reads through getc with a lock per byte.
 // Read directly from the pipe in bulk, handling fragmented writes and signals.
 std::size_t total=0;
 while (total<size) {
  const auto count=::read(STDIN_FILENO,static_cast<char*>(bytes)+total,size-total);
  if (count<0 && errno==EINTR) continue;
  if (count<0) throw std::runtime_error("Read frame input failed");
  if (count==0) break;
  total+=static_cast<std::size_t>(count);
 }
 return total;
}

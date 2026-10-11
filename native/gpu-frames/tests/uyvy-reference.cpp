// The CPU reference for the gpu-frames golden tests: the helper's own
// conversion, from native/decklink/uyvy.h. stdin: BGRA. argv: srcW srcH dstW dstH.
#include "../../decklink/uyvy.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
int main(int argc, char** argv) {
 if (argc != 5) return 2;
 const uint32_t sw = std::atoi(argv[1]), sh = std::atoi(argv[2]);
 const long dw = std::atol(argv[3]), dh = std::atol(argv[4]);
 std::vector<uint8_t> in(size_t(sw) * sh * 4), out(size_t(dw) * dh * 2);
 if (std::fread(in.data(), 1, in.size(), stdin) != in.size()) return 3;
 convertFrame(in.data(), sw, sh, out.data(), dw, dh);
 std::fwrite(out.data(), 1, out.size(), stdout);
 return 0;
}

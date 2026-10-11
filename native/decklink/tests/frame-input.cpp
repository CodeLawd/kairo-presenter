#include "../frame-input.h"
#include <cstdint>
#include <cstdio>
#include <vector>
#include <ctime>
int main() {
 std::vector<uint8_t> bytes(1920*1080*4);
 std::size_t size=0;
 uint64_t count=0, sum=0;
 const auto start=std::clock();
 while ((size=readFrameInput(bytes.data(),bytes.size()))>0) {
  count+=size;
  for (std::size_t i=0;i<size;++i) sum+=bytes[i];
 }
 std::printf("%llu %llu\n",static_cast<unsigned long long>(count),static_cast<unsigned long long>(sum));
 std::fprintf(stderr,"%.3f\n",1000.0*(std::clock()-start)/CLOCKS_PER_SEC);
}

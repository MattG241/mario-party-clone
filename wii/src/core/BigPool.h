// Wii only: big allocations get their own memory pool so the heap can't fragment (see BigPool.cpp).
#pragma once
#include <cstddef>

#ifdef HW_RVL
// Take most of MEM2 for the pool, leaving keepForHeap bytes for the ordinary heap. Call once video is up.
void bigPoolInit(size_t keepForHeap);
void bigPoolStats(size_t& total, size_t& used, size_t& largestFree);
#endif

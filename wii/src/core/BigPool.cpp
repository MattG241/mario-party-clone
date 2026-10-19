// Wii only: a separate memory pool for big allocations (textures, decoded images, minigame arenas).
//
// The Wii has little memory and newlib's malloc never gives any back. Freeing and reloading big images
// (3 MB character sheets, 1.6 MB backdrops) while small allocations (text, fonts) land in the holes
// fragments the heap until a big image no longer fits anywhere, and then textures fail to load. Here
// every allocation of BIG bytes or more (once the pool is switched on) comes from its own region of MEM2
// instead, where only big blocks live and freed neighbours merge back together. malloc, calloc, realloc,
// memalign and free are wrapped at link time (-Wl,--wrap=..., see CMakeLists.txt).
#ifdef HW_RVL
#include "BigPool.h"

#include <ogc/mutex.h>
#include <ogc/system.h>

#include <cstddef>
#include <cstdint>
#include <cstring>

extern "C" {
void* __real_malloc(size_t n);
void __real_free(void* p);
void* __real_calloc(size_t c, size_t n);
void* __real_realloc(void* p, size_t n);
void* __real_memalign(size_t a, size_t n);
}

namespace {

constexpr size_t BIG = 160 * 1024;  // allocations at least this big go to the pool
constexpr size_t ALIGN = 32;
constexpr uint32_t MAGIC = 0xB16B10C5u;  // "big block"

// Every block, free or used, starts with a 32-byte header; free blocks are kept in an address-ordered
// list so neighbours can be merged.
struct Block {
  size_t size;  // whole block, header included
  Block* next;  // next free block (free blocks only)
  uint32_t magic;
  uint32_t used;
  char pad[ALIGN - sizeof(size_t) - sizeof(Block*) - 2 * sizeof(uint32_t)];
};
static_assert(sizeof(Block) == ALIGN, "header must keep payloads 32-byte aligned");

char* g_base = nullptr;
char* g_end = nullptr;
Block* g_free = nullptr;
size_t g_inUse = 0;
bool g_on = false;
mutex_t g_lock;

inline size_t roundUp(size_t n) { return (n + ALIGN - 1) & ~(ALIGN - 1); }
inline bool owns(const void* p) { return g_on && (const char*)p >= g_base && (const char*)p < g_end; }

void* poolAlloc(size_t n) {
  size_t need = roundUp(n) + sizeof(Block);
  LWP_MutexLock(g_lock);
  // best fit: the smallest free block that's big enough
  Block **bestLink = nullptr, **link = &g_free;
  for (Block* b = g_free; b; link = &b->next, b = b->next)
    if (b->size >= need && (!bestLink || b->size < (*bestLink)->size)) bestLink = link;
  if (!bestLink) {
    LWP_MutexUnlock(g_lock);
    return nullptr;
  }
  Block* b = *bestLink;
  if (b->size - need >= BIG / 2) {
    // split: the tail stays free
    Block* rest = (Block*)((char*)b + need);
    rest->size = b->size - need;
    rest->next = b->next;
    rest->magic = MAGIC;
    rest->used = 0;
    *bestLink = rest;
    b->size = need;
  } else
    *bestLink = b->next;
  b->used = 1;
  b->magic = MAGIC;
  b->next = nullptr;
  g_inUse += b->size;
  LWP_MutexUnlock(g_lock);
  return (char*)b + sizeof(Block);
}

void poolFree(void* p) {
  Block* b = (Block*)((char*)p - sizeof(Block));
  if (b->magic != MAGIC || !b->used) return;  // not ours, or freed twice: leave it alone
  LWP_MutexLock(g_lock);
  b->used = 0;
  g_inUse -= b->size;
  // insert in address order, then merge with the free neighbours on either side
  Block* prev = nullptr;
  Block* cur = g_free;
  while (cur && cur < b) prev = cur, cur = cur->next;
  b->next = cur;
  if (prev) prev->next = b;
  else g_free = b;
  if (cur && (char*)b + b->size == (char*)cur) {
    b->size += cur->size;
    b->next = cur->next;
  }
  if (prev && (char*)prev + prev->size == (char*)b) {
    prev->size += b->size;
    prev->next = b->next;
  }
  LWP_MutexUnlock(g_lock);
}

size_t payload(const void* p) { return ((const Block*)((const char*)p - sizeof(Block)))->size - sizeof(Block); }

}  // namespace

void bigPoolInit(size_t keepForHeap) {
  if (g_on) return;
  char* lo = (char*)SYS_GetArena2Lo();
  char* hi = (char*)SYS_GetArena2Hi();
  char* base = (char*)(((uintptr_t)lo + ALIGN - 1) & ~(uintptr_t)(ALIGN - 1));
  if (hi - base < (ptrdiff_t)(keepForHeap + 8 * 1024 * 1024)) return;  // not enough MEM2 to be worth it
  size_t size = (size_t)(hi - base - keepForHeap) & ~(ALIGN - 1);
  // newlib's heap continues in MEM2 above the pool
  SYS_SetArena2Lo(base + size);
  LWP_MutexInit(&g_lock, false);
  g_base = base;
  g_end = base + size;
  g_free = (Block*)base;
  g_free->size = size;
  g_free->next = nullptr;
  g_free->magic = MAGIC;
  g_free->used = 0;
  g_on = true;
}

void bigPoolStats(size_t& total, size_t& used, size_t& largestFree) {
  total = (size_t)(g_end - g_base);
  used = g_inUse;
  largestFree = 0;
  if (!g_on) return;
  LWP_MutexLock(g_lock);
  for (Block* b = g_free; b; b = b->next)
    if (b->size > largestFree) largestFree = b->size;
  LWP_MutexUnlock(g_lock);
}

extern "C" {

void* __wrap_malloc(size_t n) {
  if (g_on && n >= BIG)
    if (void* p = poolAlloc(n)) return p;
  return __real_malloc(n);
}

void* __wrap_calloc(size_t c, size_t n) {
  size_t t = c * n;
  if (g_on && t >= BIG && (n == 0 || t / n == c))
    if (void* p = poolAlloc(t)) {
      memset(p, 0, t);
      return p;
    }
  return __real_calloc(c, n);
}

void* __wrap_memalign(size_t a, size_t n) {
  if (g_on && n >= BIG && a <= ALIGN)
    if (void* p = poolAlloc(n)) return p;
  return __real_memalign(a, n);
}

void* __wrap_realloc(void* p, size_t n) {
  if (p && owns(p)) {
    size_t old = payload(p);
    if (n <= old) return p;
    void* q = __wrap_malloc(n);
    if (!q) return nullptr;
    memcpy(q, p, old);
    poolFree(p);
    return q;
  }
  return __real_realloc(p, n);
}

void __wrap_free(void* p) {
  if (!p) return;
  if (owns(p)) poolFree(p);
  else __real_free(p);
}
}
#endif

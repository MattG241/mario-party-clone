#pragma once
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

// The web game's seeded generator (mulberry32), so behaviour matches.
class Random {
 public:
  explicit Random(uint32_t seed = 1) : s_(seed) {}
  uint32_t state() const { return s_; }
  void setState(uint32_t s) { s_ = s; }
  double next() {
    s_ += 0x6d2b79f5u;
    uint32_t t = s_;
    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + (t ^ (t >> 7)) * (t | 61u);
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
  int range(int lo, int hi) {  // inclusive
    if (hi < lo) std::swap(lo, hi);
    return lo + (int)(next() * (hi - lo + 1));
  }
  float frange(float lo, float hi) { return lo + (float)next() * (hi - lo); }
  bool chance(double p) { return next() < p; }
  template <typename T>
  const T& pick(const std::vector<T>& v) {
    return v[(size_t)(next() * v.size())];
  }
  template <typename T>
  void shuffle(std::vector<T>& v) {
    for (int i = (int)v.size() - 1; i > 0; i--) {
      int j = (int)(next() * (i + 1));
      std::swap(v[i], v[j]);
    }
  }
  // weighted pick: returns an index
  int weighted(const std::vector<float>& w) {
    float tot = 0;
    for (float x : w) tot += x > 0 ? x : 0;
    if (tot <= 0) return 0;
    float r = (float)next() * tot;
    for (size_t i = 0; i < w.size(); i++) {
      r -= w[i] > 0 ? w[i] : 0;
      if (r < 0) return (int)i;
    }
    return (int)w.size() - 1;
  }

 private:
  uint32_t s_;
};

inline float clampf(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }
inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
inline float easeOut(float t) { return 1 - (1 - t) * (1 - t); }
inline float easeInOut(float t) { return t < 0.5f ? 2 * t * t : 1 - std::pow(-2 * t + 2, 2) / 2; }
inline float easeBack(float t) {
  const float c1 = 1.70158f, c3 = c1 + 1;
  return 1 + c3 * std::pow(t - 1, 3) + c1 * std::pow(t - 1, 2);
}
inline float approach(float v, float target, float rate, float dt) { return target + (v - target) * std::exp(-rate * dt); }

inline std::string fmt(const char* f, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, f);
  vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
  return buf;
}

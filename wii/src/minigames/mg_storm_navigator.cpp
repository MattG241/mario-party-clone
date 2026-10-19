// Storm Navigator (Nami, Pirate Seas): dinghies on a stormy bay. The wind shifts (the weather vane and
// the streaks on the water show where it blows); a boat sails fast across or with it and stalls heading
// into it, so players tack. Scoop floating treasure, pump the sail (A) for a burst - ramming a rival
// knocks treasure loose - and dodge telegraphed lightning and a roaming whirlpool. Most treasure in 50 s.
//
// The simulation runs in the web game's 1920x1080 units (x right, y toward the camera, squashed by K on
// screen); everything is scaled by S when drawn.
#include <algorithm>
#include <array>
#include <cmath>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float PI = 3.14159265f;
constexpr float S = 854.0f / 1920.0f;
constexpr float DURATION = 50;
constexpr float K = 0.819f, UP = 57.4f, MAST_TOP = 1.95f * UP, MAST_FOOT = 0.32f * UP, MAST_FWD = 12, BOOM = 78;
constexpr float BASE_SPEED = 330, TURN_RATE = 3.1f, LEEWAY = 24, BOOST_T = 0.7f, BOOST_K = 1.6f, BOOST_CD = 2.6f;
constexpr float BOAT_R = 52, PICK_R = 62, RAM_SPEED = 330;
constexpr float STRIKE_WARN = 1.4f, STRIKE_R = 115, STRIKE_STUN = 1.1f, WHIRL_R = 180, WHIRL_CORE = 46, WHIRL_ALPHA = 0.82f;
constexpr float CHAR_SCALE = 0.62f;
// the open water (a superellipse in screen px) and the lighthouse lamp room where the vane turns
constexpr float BAY_X0 = 170, BAY_Y0 = 180, BAY_X1 = 1750, BAY_Y1 = 1000;
constexpr float BAY_MX = (BAY_X0 + BAY_X1) / 2, BAY_MY = (BAY_Y0 + BAY_Y1) / 2;
constexpr float LIGHT_X = 1822, LIGHT_Y = 318;

enum Kind { POUCH, CHEST, GOLDCHEST };
constexpr int VALUE[3] = {1, 3, 5};
constexpr float LOOT_W[3] = {62, 80, 86};

struct Frame {
  SDL_Rect r;
  float ox, oy;
};
// frames in mg/pirates_storm.png
constexpr Frame BOAT_FR[16] = {
    {{830, 0, 63, 61}, 0.5f, 0.854f},  {{710, 0, 59, 65}, 0.5f, 0.774f},   {{487, 0, 50, 68}, 0.518f, 0.714f}, {{410, 0, 37, 73}, 0.524f, 0.663f},
    {{381, 0, 28, 73}, 0.5f, 0.652f},  {{448, 0, 38, 73}, 0.471f, 0.663f}, {{539, 0, 50, 68}, 0.487f, 0.714f}, {{770, 0, 59, 65}, 0.5f, 0.774f},
    {{0, 172, 63, 61}, 0.5f, 0.854f},  {{590, 0, 59, 68}, 0.5f, 0.786f},   {{278, 0, 50, 75}, 0.482f, 0.738f}, {{201, 0, 38, 81}, 0.471f, 0.696f},
    {{172, 0, 28, 83}, 0.5f, 0.679f},  {{240, 0, 37, 81}, 0.524f, 0.696f}, {{330, 0, 50, 75}, 0.518f, 0.738f}, {{650, 0, 59, 68}, 0.5f, 0.786f}};
constexpr Frame LOOT_FR[3] = {{{149, 172, 33, 35}, 0.493f, 0.756f}, {{64, 172, 41, 41}, 0.5f, 0.699f}, {{107, 172, 41, 41}, 0.5f, 0.699f}};
constexpr Frame VANE_FR = {{184, 172, 77, 27}, 0.471f, 0.5f};
constexpr Frame WHIRL_FR = {{0, 0, 170, 170}, 0.5f, 0.5f};

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{0.52f, 0.55f, 0.24f, 0.55f, 0.70f}, {0.30f, 0.78f, 0.11f, 0.28f, 0.42f}, {0.17f, 0.90f, 0.05f, 0.13f, 0.24f}};

float angleDelta(float a, float b) {
  float d = std::fmod(a - b, PI * 2);
  if (d > PI) d -= PI * 2;
  if (d <= -PI) d += PI * 2;
  return d;
}
// the sail's pull by the angle off the wind (0 = wind right behind, 180 = straight into it)
float sailEfficiency(float heading, float wind) {
  static const float POLAR[8][2] = {{0, 0.72f}, {45, 0.96f}, {90, 1.0f}, {120, 0.86f}, {135, 0.62f}, {145, 0.28f}, {155, 0.1f}, {180, 0.06f}};
  float deg = std::fabs(angleDelta(heading, wind)) * 180 / PI;
  for (int i = 1; i < 8; i++)
    if (deg <= POLAR[i][0]) {
      float t = (deg - POLAR[i - 1][0]) / (POLAR[i][0] - POLAR[i - 1][0]), s = t * t * (3 - 2 * t);
      return POLAR[i - 1][1] + (POLAR[i][1] - POLAR[i - 1][1]) * s;
    }
  return POLAR[7][1];
}
bool inIrons(float h, float w) { return sailEfficiency(h, w) < 0.3f; }
struct Tack {
  float heading = 0;
  int tack = 0;
};
Tack tackHeading(float bearing, float wind, int prefer) {
  float off = angleDelta(bearing, wind + PI), limit = 40 * PI / 180;
  if (std::fabs(off) >= limit) return {bearing, 0};
  int side = prefer != 0 ? prefer : (off >= 0 ? 1 : -1);
  return {wind + PI + side * limit * 1.25f, side};
}
// pull a screen point back inside the bay (with margin to spare); true if it had strayed
bool keepInBay(float& x, float& y, float margin = 0) {
  float rx = (BAY_X1 - BAY_X0) / 2 - margin, ry = (BAY_Y1 - BAY_Y0) / 2 - margin;
  float u = (x - BAY_MX) / rx, v = (y - BAY_MY) / ry;
  float m = u * u * u * u + v * v * v * v;
  if (m <= 1) return false;
  float k = 1 / std::pow(m, 0.25f);
  x = BAY_MX + u * k * rx;
  y = BAY_MY + v * k * ry;
  return true;
}
bool shoreAhead(float x, float y, float heading) {
  float lx = x + std::cos(heading) * 170, ly = (y + std::sin(heading) * 170) * K;
  return keepInBay(lx, ly, 55);
}
Tack tackClear(float bearing, float wind, int prefer, float x, float y) {
  Tack t = tackHeading(bearing, wind, prefer);
  if (t.tack == 0 || !shoreAhead(x, y, t.heading)) return t;
  int keep = t.tack;
  t = tackHeading(bearing, wind, -keep);
  if (shoreAhead(x, y, t.heading)) t = tackHeading(bearing, wind, keep);
  return t;
}
float boomAngle(float heading, float wind, float flutter) {
  float rel = angleDelta(wind, heading), alpha = std::fabs(rel);
  if (inIrons(heading, wind)) return heading + PI + flutter * 0.35f;
  float out = clampf((PI - alpha) * 0.5f, 0.18f, 1.35f);
  return heading + PI - (rel < 0 ? -1.0f : 1.0f) * out;
}
int strikeLoss(int held) { return held <= 0 ? 0 : std::clamp((int)std::lround(held * 0.3f), 1, 4); }

// screen (canvas) from world
float SX(float x) { return x * S; }
float SY(float y) { return y * K * S; }

struct Boat {
  float x = 0, y = 0, h = 0, v = 0, kx = 0, ky = 0;
  float boostT = 0, boostCd = 0, stunT = 0, spin = 0, flutter = 0, eff = 1, wakeT = 0, spd = 0, stuckT = 0;
  int tack = 0, score = 0;
  const char* anim = "wave";
  float animT = 0, animLeft = 1.2f, flashT = 0;
  bool flip = false;
  // input
  float mx = 0, my = 0;
  bool pressA = false;
  // CPU
  float timer = 0, wait = 0, tx = 0, ty = 0;
  bool hasTarget = false, unstick = false;
};
struct Loot {
  bool active = false;
  int kind = POUCH;
  float x = 0, y = 0, vx = 0, vy = 0, bob = 0, rise = 0;
};
struct Strike {
  bool active = false;
  float x = 0, y = 0, t = 0;
  int seen = 0, dodge = 0;
};
struct Particle {
  float x, y, vx, vy, t, life, r, g;  // screen web px; g = gravity
  Color c;
};
struct RingFx {
  float x, y, t, life, r0, r1;
  Color c;
};
struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size;
};
struct Streak {
  float x = 0, y = 0, t = 9, len = 1;
};

class StormNavigator : public Minigame {
 public:
  void start() override {
    wind_ = -PI / 2 + ((float)rng.next() - 0.5f) * 1.2f;
    windTo_ = wind_;
    static const float SPOTS[4][2] = {{420, 360}, {1500, 360}, {420, 820}, {1500, 820}};
    for (int i = 0; i < count(); i++) {
      int spot = count() == 2 ? (i == 0 ? 0 : 3) : i;
      Boat b;
      b.x = SPOTS[spot][0];
      b.y = SPOTS[spot][1] / K;
      b.h = std::atan2(600 - SPOTS[spot][1], 960 - SPOTS[spot][0]);
      boats_.push_back(b);
    }
    for (int i = 0; i < 30; i++) rain_[i] = {(float)rng.next() * 1920, (float)rng.next() * 1080, 0.5f + (float)rng.next() * 0.4f};
    int n = 6 + count();
    for (int i = 0; i < n; i++) spawnLoot(true);
  }

  // --- treasure ----------------------------------------------------------------------------------
  Loot* placeLoot(int kind, float x, float y, float vx, float vy, float rise) {
    for (auto& l : loot_)
      if (!l.active) {
        l = Loot();
        l.active = true;
        l.kind = kind;
        l.x = x;
        l.y = y;
        l.vx = vx;
        l.vy = vy;
        l.bob = (float)rng.next() * 6;
        l.rise = rise;
        return &l;
      }
    return nullptr;
  }
  void spawnLoot(bool initial) {
    bool gold = false;
    for (auto& l : loot_) gold = gold || (l.active && l.kind == GOLDCHEST);
    double roll = rng.next();
    int kind = (!(gold || time_ < 6) && roll < 0.08) ? GOLDCHEST : (roll < 0.4 ? CHEST : POUCH);
    float bx = 960, by = 600 / K, bestD = -1;
    for (int tries = 0; tries < 12; tries++) {
      float x = BAY_X0 + 90 + (float)rng.next() * (BAY_X1 - BAY_X0 - 180);
      float y = (BAY_Y0 + 80 + (float)rng.next() * (BAY_Y1 - BAY_Y0 - 160)) / K;
      float tx = x, ty = y * K;
      if (keepInBay(tx, ty, 80)) continue;
      float d = 1e9f;
      for (auto& b : boats_) d = std::min(d, std::hypot(b.x - x, b.y - y));
      for (auto& l : loot_)
        if (l.active) d = std::min(d, std::hypot(l.x - x, l.y - y) * 1.6f);
      if (whirlOn_) d = std::min(d, std::hypot(whirlX_ - x, whirlY_ - y) - WHIRL_R * 0.5f);
      if (d > bestD) {
        bestD = d;
        bx = x;
        by = y;
      }
    }
    if (!placeLoot(kind, bx, by, 0, 0, initial ? 0 : 0.6f) || initial) return;
    ring(bx, by * K, 10, 70, kind == GOLDCHEST ? col::gold : Color(232, 246, 255), 0.52f);
    spray(bx, by * K, 6, 80, 200);
  }

  void collect(int i, Loot& l) {
    Boat& b = boats_[i];
    int v = VALUE[l.kind];
    b.score += v;
    float sx = l.x, sy = l.y * K;
    l.active = false;
    app.audio.sfx("coin", 0.6f);
    ring(sx, sy, 14, 80, v >= 5 ? col::gold : color(i), 0.38f);
    pop("+" + std::to_string(v), SX(sx), SX(sy) - 26, v >= 5 ? col::gold : col::white, 24);
    if (v >= 5) {
      pop("GOLDEN!", SX(sx), SX(sy) - 50, Color::hex(0xffc83a), 22);
      setAnim(b, "victory", 1.0f);
    } else if (v >= 3)
      setAnim(b, "celebrate", 0.8f);
  }

  // knock treasure overboard: lost from the score, it floats out round the boat for anyone
  void spill(Boat& b, int points, float speed) {
    int n = std::min(points, b.score);
    if (n <= 0) return;
    b.score -= n;
    std::vector<int> parts;
    int left = n;
    while (left >= 3 && parts.size() < 2) {
      parts.push_back(CHEST);
      left -= 3;
    }
    while (left-- > 0) parts.push_back(POUCH);
    for (size_t i = 0; i < parts.size(); i++) {
      float a = (float)i / parts.size() * PI * 2 + (float)rng.next() * 0.6f;
      placeLoot(parts[i], b.x + std::cos(a) * 40, b.y + std::sin(a) * 40, std::cos(a) * speed, std::sin(a) * speed, 0);
    }
    app.audio.sfx("bad", 0.55f);
  }

  // --- effects -----------------------------------------------------------------------------------
  void ring(float x, float y, float r0, float r1, Color c, float life) { rings_.push_back({x, y, 0, life, r0, r1, c}); }
  void spray(float x, float y, int n, float spMin, float spMax) {
    for (int i = 0; i < n && parts_.size() < 120; i++) {
      float a = -PI / 2 + ((float)rng.next() - 0.5f) * 1.6f, sp = spMin + (float)rng.next() * (spMax - spMin);
      parts_.push_back({x, y, std::cos(a) * sp, std::sin(a) * sp, 0, 0.36f + (float)rng.next() * 0.26f, 2.2f, 700, Color(223, 244, 255)});
    }
  }
  void pop(const std::string& t, float x, float y, Color c, int size) { pops_.push_back({t, x, y, 0, 0.9f, c, size}); }
  void banner(const char* t, Color c) {
    banner_ = t;
    bannerC_ = c;
    bannerT_ = 0;
    bannerUntil_ = time_ + 1.4f;
  }
  void setAnim(Boat& b, const char* a, float len) {
    b.anim = a;
    b.animT = 0;
    b.animLeft = len;
  }
  void liftGloom(float to, float dur) {
    liftTo_ = to;
    liftT_ = 0;
    liftDur_ = dur;
  }

  // --- update ------------------------------------------------------------------------------------
  void update(float dt) override {
    time_ += dt;
    if (time_ >= DURATION) {
      for (auto& st : strikes_) st.active = false;
      return;
    }
    if (!tide_ && time_ >= DURATION - 10) {
      tide_ = true;
      banner("TREASURE TIDE!", col::gold);
      bannerUntil_ = time_ + 1.9f;
      tideSpawn_ = 6;
      tideT_ = 0;
    }
    if (tideSpawn_ > 0) {
      tideT_ -= dt;
      if (tideT_ <= 0) {
        tideT_ = 0.12f;
        tideSpawn_--;
        spawnLoot(false);
      }
    }
    updateWind(dt);
    updateWhirl(dt);
    for (int i = 0; i < count(); i++) {
      Boat& b = boats_[i];
      b.pressA = false;
      if (isCpu(i))
        cpuThink(i, dt);
      else {
        b.mx = pad(i).x;
        b.my = pad(i).y;
        b.pressA = pad(i).press(B_A);
      }
      updateBoat(i, dt);
    }
    collideBoats();
    updateLoot(dt);
    // pickups
    for (int i = 0; i < count(); i++) {
      if (boats_[i].stunT > 0) continue;
      for (auto& l : loot_)
        if (l.active && l.rise <= 0.15f && std::hypot(l.x - boats_[i].x, l.y - boats_[i].y) < PICK_R) collect(i, l);
    }
    updateStrikes(dt);
    spawnT_ -= dt;
    int cap = 6 + (int)std::lround(count() * 1.5f) + (tide_ ? 5 : 0);
    if (spawnT_ <= 0) {
      spawnT_ = tide_ ? 0.45f : 1.1f;
      int out = 0;
      for (auto& l : loot_) out += l.active;
      if (out < cap) spawnLoot(false);
    }
    // ambience: thunder, rain, streaks, effects
    thunderT_ -= dt;
    if (thunderT_ <= 0) {
      thunderT_ = 5 + (float)rng.next() * 4;
      flash(0.12f, 0.16f);
      liftGloom(0.08f, 0.3f);
    }
    liftT_ += dt;
    flashT_ += dt;
    boltT_ -= dt;
    bannerT_ += dt;
    float wx = std::cos(wind_) * 260 * windS_;
    for (auto& r : rain_) {
      r[0] += wx * dt;
      r[1] += 900 * dt;
      if (r[1] > 1100) {
        r[1] = -20;
        r[0] = (float)rng.next() * 2100 - 90;
      }
      if (r[0] < -100) r[0] += 2100;
      if (r[0] > 2020) r[0] -= 2100;
    }
    updateStreaks(dt);
    for (auto& p : parts_) {
      p.t += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    std::erase_if(parts_, [](const Particle& p) { return p.t >= p.life; });
    for (auto& r : rings_) r.t += dt;
    std::erase_if(rings_, [](const RingFx& r) { return r.t >= r.life; });
    for (auto& p : pops_) {
      p.t += dt;
      p.y -= 30 * dt;
    }
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
  }
  void flash(float a, float dur) {
    flashA_ = a;
    flashDur_ = dur;
    flashT_ = 0;
  }

  void updateWind(float dt) {
    shiftT_ -= dt;
    if (shiftT_ <= 0) {
      shiftT_ = (tide_ ? 5.2f : 7.0f) + (float)rng.next() * 2.5f;
      float turn = (0.9f + (float)rng.next() * 1.4f) * (rng.chance(0.5) ? -1 : 1);
      windTo_ = wind_ + turn;
      windS_ = 0.85f + (float)rng.next() * 0.35f;
      if (time_ >= bannerUntil_) banner("WIND SHIFT!", Color::hex(0xdff4ff));
      app.audio.sfx("whoosh", 0.5f);
    }
    wind_ += angleDelta(windTo_, wind_) * (1 - std::exp(-1.8f * dt));
  }

  void updateStreaks(float dt) {
    float dx = std::cos(wind_), dy = std::sin(wind_) * K;
    streakT_ -= dt;
    if (streakT_ <= 0) {
      streakT_ = 0.1f;
      for (auto& s : streaks_)
        if (s.t >= 0.9f) {
          s = {BAY_X0 + (float)rng.next() * (BAY_X1 - BAY_X0), BAY_Y0 + (float)rng.next() * (BAY_Y1 - BAY_Y0), 0, 0.8f + (float)rng.next() * 0.8f};
          break;
        }
    }
    float sp = 420 * windS_ * dt;
    for (auto& s : streaks_) {
      if (s.t >= 0.9f) continue;
      s.t += dt;
      s.x += dx * sp;
      s.y += dy * sp;
    }
  }

  void updateBoat(int i, float dt) {
    Boat& b = boats_[i];
    b.boostCd = std::max(0.0f, b.boostCd - dt);
    b.boostT = std::max(0.0f, b.boostT - dt);
    b.flutter += dt * 18;
    b.animT += dt;
    b.animLeft -= dt;
    b.flashT -= dt;
    if (b.animLeft <= 0) b.anim = b.stunT > 0 ? "stunned" : "idle";
    if (b.stunT > 0) {
      b.stunT -= dt;
      b.spin *= std::exp(-2 * dt);
      b.h += b.spin * dt;
      b.v *= std::exp(-2.5f * dt);
    } else {
      if (std::hypot(b.mx, b.my) > 0.35f) {
        float want = std::atan2(b.my / K, b.mx);
        float d = angleDelta(want, b.h);
        b.h += (d < 0 ? -1 : 1) * std::min(std::fabs(d), TURN_RATE * dt);
      }
      if (b.pressA && b.boostCd <= 0) {
        // a pump of the sail: a burst of speed, stronger with the wind in the sail
        b.boostT = BOOST_T * (0.5f + 0.5f * b.eff);
        b.boostCd = BOOST_CD;
        b.v += 80 * b.eff;
        app.audio.sfx("whoosh", 0.5f);
        spray(b.x - std::cos(b.h) * 40, (b.y - std::sin(b.h) * 40) * K, 8, 120, 260);
      }
    }
    b.eff = sailEfficiency(b.h, wind_);
    float target = BASE_SPEED * windS_ * b.eff * (b.boostT > 0 ? BOOST_K : 1) * (b.stunT > 0 ? 0.2f : 1);
    b.v += (target - b.v) * (1 - std::exp(-(target > b.v ? 1.9f : 1.2f) * dt));
    float vx = std::cos(b.h) * b.v + std::cos(wind_) * LEEWAY * windS_ + b.kx;
    float vy = std::sin(b.h) * b.v + std::sin(wind_) * LEEWAY * windS_ + b.ky;
    b.kx *= std::exp(-2.4f * dt);
    b.ky *= std::exp(-2.4f * dt);
    if (whirlOn_) {
      float fx, fy;
      whirlForce(b.x, b.y, fx, fy);
      vx += fx;
      vy += fy;
    }
    float px = b.x, py = b.y;
    b.x += vx * dt;
    b.y += vy * dt;
    float tx = b.x, ty = b.y * K;
    if (keepInBay(tx, ty, 30)) {
      b.x = tx;
      b.y = ty / K;
      b.v *= 0.6f;
      b.kx *= -0.3f;
      b.ky *= -0.3f;
      if (std::hypot(vx, vy) > 160 && rng.chance(0.3)) spray(b.x, b.y * K, 5, 80, 180);
    }
    if (dt > 0) b.spd += (std::hypot(b.x - px, b.y - py) / dt - b.spd) * (1 - std::exp(-4 * dt));
    b.wakeT -= dt;
    float speed = std::hypot(vx, vy);
    if (b.wakeT <= 0 && speed > 70 && parts_.size() < 120) {
      b.wakeT = 0.09f * (b.boostT > 0 ? 0.5f : 1);
      float wx = b.x - std::cos(b.h) * 44, wy = (b.y - std::sin(b.h) * 44) * K;
      float a = b.h + PI + ((float)rng.next() - 0.5f) * 0.7f;
      parts_.push_back({wx, wy, std::cos(a) * 30, std::sin(a) * 30 * K, 0, 0.6f + (float)rng.next() * 0.4f, 3.0f, 0, Color(232, 246, 255, 150)});
      if (speed > 220 && rng.chance(0.5)) ring(wx, wy, 8, 34, Color(255, 255, 255, 90), 0.5f);
    }
    if (b.eff < 0.3f && b.stunT <= 0 && !isCpu(i) && rng.chance(dt / 2.2f)) pop("NO WIND!", SX(b.x), SY(b.y) - 54, Color::hex(0xc8d4e6), 16);
  }

  void collideBoats() {
    for (int i = 0; i < count(); i++)
      for (int j = i + 1; j < count(); j++) {
        Boat& a = boats_[i];
        Boat& b = boats_[j];
        float dx = b.x - a.x, dy = b.y - a.y, d = std::hypot(dx, dy);
        if (d >= BOAT_R * 2 || d == 0) continue;
        float nx = dx / d, ny = dy / d, push = (BOAT_R * 2 - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        float va = std::cos(a.h) * a.v * nx + std::sin(a.h) * a.v * ny;
        float vb = -(std::cos(b.h) * b.v * nx + std::sin(b.h) * b.v * ny);
        int rammer = a.boostT > 0 && va > RAM_SPEED * 0.6f ? i : (b.boostT > 0 && vb > RAM_SPEED * 0.6f ? j : -1);
        a.kx -= nx * 160;
        a.ky -= ny * 160;
        b.kx += nx * 160;
        b.ky += ny * 160;
        if (rammer >= 0 && std::max(va, vb) > RAM_SPEED * 0.6f)
          ram(rammer, rammer == i ? j : i);
        else
          app.audio.sfx("bump", 0.3f);
      }
  }
  void ram(int ri, int vi) {
    Boat& r = boats_[ri];
    Boat& v = boats_[vi];
    if (v.stunT > 0) return;
    v.stunT = 0.52f;
    v.spin = (rng.chance(0.5) ? -1 : 1) * 7.0f;
    setAnim(v, "stunned", 0.52f);
    r.boostT = 0;
    spill(v, 1, 180);
    float x = (r.x + v.x) / 2, y = (r.y + v.y) / 2 * K;
    pop("RAM!", SX(x), SX(y) - 44, Color::hex(0xff7a4a), 24);
    spray(x, y, 14, 150, 360);
    app.audio.sfx("hit", 0.6f);
  }

  void updateLoot(float dt) {
    for (auto& l : loot_) {
      if (!l.active) continue;
      l.bob += dt * 2.6f;
      if (l.rise > 0) l.rise -= dt;
      l.vx *= std::exp(-1.6f * dt);
      l.vy *= std::exp(-1.6f * dt);
      l.x += (l.vx + std::cos(wind_) * 10 * windS_) * dt;
      l.y += (l.vy + std::sin(wind_) * 10 * windS_) * dt;
      if (whirlOn_) {
        float fx, fy;
        whirlForce(l.x, l.y, fx, fy);
        l.x += fx * dt;
        l.y += fy * dt;
        if (std::hypot(l.x - whirlX_, l.y - whirlY_) < WHIRL_CORE * 0.8f) {
          float a = (float)rng.next() * PI * 2;
          l.x = whirlX_ + std::cos(a) * WHIRL_R * 0.9f;
          l.y = whirlY_ + std::sin(a) * WHIRL_R * 0.9f;
          l.vx = std::cos(a) * 280;
          l.vy = std::sin(a) * 280;
          spray(l.x, l.y * K, 6, 100, 240);
        }
      }
      float tx = l.x, ty = l.y * K;
      if (keepInBay(tx, ty, 40)) {
        l.x = tx;
        l.y = ty / K;
        l.vx *= -0.4f;
        l.vy *= -0.4f;
      }
    }
  }

  // --- lightning ---------------------------------------------------------------------------------
  void updateStrikes(float dt) {
    strikeT_ -= dt;
    if (strikeT_ <= 0) {
      float p = time_ / DURATION;
      strikeT_ = (tide_ ? 1.5f : 2.9f - 1.1f * p) + (float)rng.next() * 0.9f;
      startStrike();
      if (tide_ && rng.chance(0.5)) startStrike();
    }
    for (auto& st : strikes_) {
      if (!st.active) continue;
      st.t += dt;
      if (st.t >= STRIKE_WARN) strike(st);
    }
  }
  void startStrike() {
    Strike* st = nullptr;
    for (auto& q : strikes_)
      if (!q.active) {
        st = &q;
        break;
      }
    if (!st) return;
    float x, y;
    int vi = std::min(count() - 1, (int)(rng.next() * count()));
    if (rng.chance(0.55)) {
      const Boat& v = boats_[vi];
      x = v.x + std::cos(v.h) * v.v * 0.6f + ((float)rng.next() - 0.5f) * 120;
      y = v.y + std::sin(v.h) * v.v * 0.6f + ((float)rng.next() - 0.5f) * 120;
    } else {
      x = BAY_X0 + 120 + (float)rng.next() * (BAY_X1 - BAY_X0 - 240);
      y = (BAY_Y0 + 100 + (float)rng.next() * (BAY_Y1 - BAY_Y0 - 200)) / K;
    }
    float tx = x, ty = y * K;
    keepInBay(tx, ty, 70);
    *st = Strike();
    st->active = true;
    st->x = tx;
    st->y = ty / K;
    app.audio.sfx("warn", 0.3f);
  }
  void strike(Strike& st) {
    st.active = false;
    float x = st.x, y = st.y * K;
    // the bolt
    float px = x + ((float)rng.next() - 0.5f) * 200;
    for (int i = 0; i < 12; i++) {
      float u = i / 11.0f;
      px += ((float)rng.next() - 0.5f) * 70 * (1 - u * 0.7f);
      bolt_[i][0] = i == 11 ? x : px * (1 - u) + x * u + ((float)rng.next() - 0.5f) * 30 * (1 - u);
      bolt_[i][1] = -40 + (y + 40) * u;
    }
    boltT_ = 0.18f;
    flash(0.3f, 0.2f);
    liftGloom(0.02f, 0.42f);
    app.audio.sfx("hit", 0.7f);
    ring(x, y, 20, STRIKE_R * 1.5f, Color(255, 243, 160), 0.42f);
    spray(x, y, 16, 160, 420);
    for (int i = 0; i < count(); i++) {
      Boat& b = boats_[i];
      if (std::hypot(b.x - st.x, b.y - st.y) > STRIKE_R + 20) continue;
      b.stunT = STRIKE_STUN;
      b.spin = (rng.chance(0.5) ? -1 : 1) * 9.0f;
      b.boostT = 0;
      spill(b, strikeLoss(b.score), 240);
      setAnim(b, "stunned", STRIKE_STUN);
      b.flashT = 0.09f;
      pop("ZAP!", SX(b.x), SY(b.y) - 64, Color::hex(0xffe14a), 26);
    }
    for (auto& l : loot_) {
      if (!l.active) continue;
      float dx = l.x - st.x, dy = l.y - st.y, d = std::hypot(dx, dy);
      if (d > STRIKE_R * 1.4f || d == 0) continue;
      l.vx += dx / d * 260;
      l.vy += dy / d * 260;
    }
  }

  // --- the whirlpool -----------------------------------------------------------------------------
  void whirlForce(float x, float y, float& fx, float& fy) const {
    float dx = x - whirlX_, dy = y - whirlY_, d = std::hypot(dx, dy);
    fx = fy = 0;
    if (d > WHIRL_R || d == 0) return;
    float k = 1 - d / WHIRL_R, nx = dx / d, ny = dy / d;
    fx = -ny * 170 * k - nx * 120 * k;
    fy = nx * 170 * k - ny * 120 * k;
  }
  void updateWhirl(float dt) {
    if (!whirlOn_) {
      if (time_ > 9 && time_ >= bannerUntil_) {
        whirlOn_ = true;
        whirlT_ = 0;
        banner("WHIRLPOOL!", Color::hex(0xbff0ff));
        app.audio.sfx("warn", 0.5f);
      }
      return;
    }
    whirlT_ += dt;
    whirlX_ = 960 + std::sin(whirlT_ * 0.21f + 0.6f) * 520;
    whirlY_ = (600 + std::sin(whirlT_ * 0.33f) * 260) / K;
    whirlRot_ += dt * 2.4f;
    for (auto& b : boats_) {
      if (b.stunT > 0) continue;
      if (std::hypot(b.x - whirlX_, b.y - whirlY_) < WHIRL_CORE) {
        float a = std::atan2(b.y - whirlY_, b.x - whirlX_) + 0.8f;
        b.stunT = 0.9f;
        b.spin = 12;
        b.kx = std::cos(a) * 520;
        b.ky = std::sin(a) * 520;
        b.boostT = 0;
        spill(b, std::min(2, b.score), 200);
        setAnim(b, "stunned", 0.9f);
        pop("WHIRLED!", SX(b.x), SY(b.y) - 56, Color::hex(0x5ce1ff), 22);
        app.audio.sfx("bad", 0.6f);
      }
    }
  }

  // --- CPU ---------------------------------------------------------------------------------------
  void cpuThink(int i, float dt) {
    Boat& b = boats_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    b.timer -= dt;
    if (b.timer <= 0 || !b.hasTarget) {
      b.timer = sk.think * (0.7f + (float)rng.next() * 0.6f);
      cpuTarget(i);
    }
    float bearing = std::atan2(b.ty - b.y, b.tx - b.x);
    bool fleeing = false;
    int bit = 1 << i;
    for (auto& st : strikes_) {
      if (!st.active || st.t < sk.reaction + 0.2f) continue;
      float d = std::hypot(b.x - st.x, b.y - st.y);
      if (d < STRIKE_R + 60 && !(st.seen & bit)) {
        st.seen |= bit;
        if (rng.chance(sk.accuracy)) st.dodge |= bit;
      }
      if ((st.dodge & bit) && d < STRIKE_R + 70) {
        bearing = std::atan2(b.y - st.y, b.x - st.x);
        fleeing = true;
      }
    }
    if (whirlOn_ && std::hypot(b.x - whirlX_, b.y - whirlY_) < WHIRL_R * (0.55f + 0.45f * sk.accuracy)) {
      bearing = std::atan2(b.y - whirlY_, b.x - whirlX_) + 0.5f;
      fleeing = true;
    }
    if (b.stunT <= 0 && b.spd < 55)
      b.stuckT += dt;
    else
      b.stuckT = std::max(0.0f, b.stuckT - dt * 2);
    if (b.stuckT > 1.3f) {
      b.stuckT = 0;
      b.tack = b.tack ? -b.tack : (rng.chance(0.5) ? -1 : 1);
      b.unstick = true;
      b.wait = 1.1f;
    }
    if (b.unstick) {
      b.wait -= dt;
      if (b.wait <= 0) {
        b.unstick = false;
        b.timer = 0;
      } else if (!fleeing)
        bearing = std::atan2(BAY_MY / K - b.y, BAY_MX - b.x);
    }
    Tack tk = tackClear(bearing, wind_, b.tack, b.x, b.y);
    b.tack = tk.tack;
    float noise = (std::sin(time_ / 0.7f + i * 2) * 0.5f + ((float)rng.next() - 0.5f)) * sk.aimNoise * 0.35f;
    float h = tk.heading + noise;
    b.mx = std::cos(h);
    b.my = std::sin(h) * K;
    float dist = std::hypot(b.tx - b.x, b.ty - b.y);
    if (b.boostCd <= 0 && (fleeing || (dist > 260 && b.eff > 0.75f)) && rng.chance(dt / (sk.reaction * 2.5f) * sk.accuracy)) b.pressA = true;
  }
  // the best treasure for the time it takes to sail there (wind included), clear of storms
  void cpuTarget(int i) {
    Boat& b = boats_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    const Loot* best = nullptr;
    float bestScore = -1e9f;
    for (auto& l : loot_) {
      if (!l.active) continue;
      float d = std::hypot(l.x - b.x, l.y - b.y), bearing = std::atan2(l.y - b.y, l.x - b.x);
      float eff = std::max(0.55f, sailEfficiency(tackHeading(bearing, wind_, 0).heading, wind_));
      float eta = d / (BASE_SPEED * windS_ * eff);
      float score = VALUE[l.kind] * 10 / (eta + 0.8f);
      for (int o = 0; o < count(); o++)
        if (o != i && std::hypot(l.x - boats_[o].x, l.y - boats_[o].y) < d * 0.6f) score -= 3;
      for (auto& st : strikes_)
        if (st.active && std::hypot(l.x - st.x, l.y - st.y) < STRIKE_R + 30) score -= 8 * sk.accuracy;
      if (whirlOn_ && std::hypot(l.x - whirlX_, l.y - whirlY_) < WHIRL_R * 0.7f) score -= 6 * sk.accuracy;
      score += ((float)rng.next() - 0.5f) * 16 * sk.mistake;
      if (score > bestScore) {
        bestScore = score;
        best = &l;
      }
    }
    b.tx = best ? best->x : BAY_MX;
    b.ty = best ? best->y : BAY_MY / K;
    b.hasTarget = true;
  }

  // --- drawing -----------------------------------------------------------------------------------
  static void ellipseRing(float x, float y, float rx, float ry, float w, Color c, int segs = 12) {
    float px = x + rx, py = y;
    for (int i = 1; i <= segs; i++) {
      float a = i * PI * 2 / segs, nx = x + std::cos(a) * rx, ny = y + std::sin(a) * ry;
      app.gfx.line(px, py, nx, ny, w, c);
      px = nx;
      py = ny;
    }
  }

  void drawBoat(Tex* sheet, int i) const {
    const Boat& b = boats_[i];
    float sx = b.x, sy = b.y * K;
    float bob = std::sin(time_ / 0.3f + player(i).slot) * 2.5f;
    float deg = std::fmod(std::fmod(b.h * 180 / PI, 360.0f) + 360, 360.0f);
    const Frame& f = BOAT_FR[(int)std::lround(deg / 22.5f) % 16];
    app.gfx.ellipse(SX(sx), SX(sy + 4), 30, 9, Color(5, 20, 30, 70));
    app.gfx.sprite(sheet, f.r, SX(sx), SX(sy + bob), 1, 1, f.ox, f.oy);
    // the sail: a fan of strokes from the mast foot out to the bellied leech
    float mx = sx + std::cos(b.h) * MAST_FWD, my = (b.y + std::sin(b.h) * MAST_FWD) * K + bob;
    float boom = boomAngle(b.h, wind_, std::sin(b.flutter));
    float ex = mx + std::cos(boom) * BOOM, ey = my + std::sin(boom) * BOOM * K - MAST_FOOT;
    float topY = my - MAST_TOP, footY = my - MAST_FOOT;
    bool irons = inIrons(b.h, wind_);
    float full = irons ? 0.05f : std::min(1.0f, b.eff) * (b.boostT > 0 ? 1.3f : 1);
    float nx = std::cos(wind_), ny = std::sin(wind_) * K;
    const int n = 11;
    float pts[n][2];
    for (int k = 0; k < n; k++) {
      float u = (float)k / (n - 1);
      float belly = std::sin(u * PI) * 30 * full + (irons ? std::sin(b.flutter * 2 + u * 6) * 5 : 0);
      pts[k][0] = SX(mx + (ex - mx) * u + nx * belly);
      pts[k][1] = SX(topY + (ey - topY) * u + ny * belly);
    }
    bool lit = std::cos(angleDelta(boom, -2.2f)) > 0;
    Color sail = lit ? Color::hex(0xfbf3e2) : Color::hex(0xe0d4be);
    float fx = SX(mx), fy = SX(footY);
    for (int k = 0; k + 1 < n; k++) {
      float qx = (pts[k][0] + pts[k + 1][0]) * 0.5f, qy = (pts[k][1] + pts[k + 1][1]) * 0.5f;
      float w = std::hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) * 1.25f + 0.5f;
      app.gfx.line(fx, fy, qx, qy, w, sail);
    }
    // a stripe in the player's colour, the mast and the boom
    float ax = fx, ay = SX(topY + (footY - topY) * 0.55f);
    app.gfx.line(ax, ay, pts[5][0] * 0.6f + ax * 0.4f, pts[5][1] * 0.6f + ay * 0.4f + 4, 4, color(i));
    app.gfx.line(fx, SX(topY), fx, fy + 2.7f, 1.4f, Color::hex(0x6b4428));
    app.gfx.line(fx, fy, SX(ex), SX(ey), 1.4f, Color::hex(0x6b4428));
    if (b.boostT > 0)
      for (int k = 0; k < 3; k++) {
        float o = (k - 1) * 16;
        float bx = sx - std::cos(b.h) * (60 + k * 8) - std::sin(b.h) * o;
        float by = (b.y - std::sin(b.h) * (60 + k * 8) + std::cos(b.h) * o) * K;
        app.gfx.line(SX(bx), SX(by), SX(bx - std::cos(b.h) * 40), SX(by - std::sin(b.h) * 40 * K), 1.4f, Color(255, 255, 255, 150));
      }
    // the sailor at the stern
    float cx = sx - std::cos(b.h) * 14, cy = (b.y - std::sin(b.h) * 14) * K - 8 + bob;
    Color tint = b.flashT > 0 ? Color(255, 255, 160) : col::white;
    spr::character(player(i).character, b.anim, b.animT, SX(cx), SX(cy), CHAR_SCALE, b.stunT > 0 ? b.flip : std::cos(b.h) < 0, tint);
    drawPlayerTag(i, SX(cx), SX(cy) - 58);
  }

  void draw() override {
    drawArena();
    Tex* sheet = app.gfx.tex("mg/pirates_storm.png");
    // wind streaks racing across the water
    float wdx = std::cos(wind_), wdy = std::sin(wind_) * K, wl = std::hypot(wdx, wdy);
    for (auto& s : streaks_) {
      if (s.t >= 0.9f) continue;
      float a = std::sin(std::min(1.0f, s.t / 0.9f) * PI) * 0.4f, L = 30 * s.len;
      app.gfx.line(SX(s.x - wdx / wl * L), SX(s.y - wdy / wl * L), SX(s.x + wdx / wl * L), SX(s.y + wdy / wl * L), 1.6f, Color(232, 246, 255, (unsigned char)(255 * a)));
    }
    // the whirlpool
    if (whirlOn_) {
      float a = std::min(1.0f, whirlT_ / 0.9f) * WHIRL_ALPHA;
      float sc = WHIRL_R * 2 * S / WHIRL_FR.r.w;
      app.gfx.sprite(sheet, WHIRL_FR.r, SX(whirlX_), SY(whirlY_), sc, sc * 0.92f, 0.5f, 0.5f, whirlRot_ * 180 / PI, false, col::white.alpha(a));
    }
    // lightning warnings
    for (auto& st : strikes_) {
      if (!st.active) continue;
      float u = std::min(1.0f, st.t / STRIKE_WARN), throb = 0.5f + 0.5f * std::sin(st.t / (0.08f - 0.05f * u));
      float x = SX(st.x), y = SY(st.y), R = STRIKE_R * S;
      app.gfx.ellipse(x, y, R * 1.3f, R * 1.3f * K, Color(5, 16, 26, (unsigned char)(255 * (0.14f + 0.3f * u))));
      app.gfx.ellipse(x, y, R, R * K, Color(255, 243, 160, (unsigned char)(255 * (0.08f + 0.14f * u * throb))));
      float rr = R * (1.5f - 0.5f * u);
      ellipseRing(x, y, rr, rr * K, 2.2f, Color(255, 243, 160, (unsigned char)(255 * (0.5f + 0.5f * throb))));
      ellipseRing(x, y, R, R * K, 1.4f, Color(255, 255, 255, 230));
    }
    for (auto& r : rings_) {
      float u = r.t / r.life, rad = (r.r0 + (r.r1 - r.r0) * easeOut(u)) * S;
      app.gfx.ellipse(SX(r.x), SX(r.y), rad, rad * K, r.c.alpha(0.35f * (1 - u)));
    }
    // treasure and boats, back to front
    struct Item {
      float y;
      int idx;  // >= 0 boat, < 0 loot -(i+1)
    };
    std::vector<Item> items;
    for (int i = 0; i < count(); i++) items.push_back({boats_[i].y * K, i});
    for (int i = 0; i < (int)loot_.size(); i++) {
      const Loot& l = loot_[i];
      if (!l.active) continue;
      items.push_back({l.y * K, -(i + 1)});
      float rs = (l.kind == POUCH ? 0.62f : 0.78f) + 0.06f * std::sin(l.bob);
      app.gfx.ellipse(SX(l.x), SX(l.y * K + 2), 26 * rs, 26 * rs * K * 0.5f, Color(220, 240, 255, 70));
    }
    std::sort(items.begin(), items.end(), [](const Item& a, const Item& b) { return a.y < b.y; });
    for (auto& it : items) {
      if (it.idx >= 0) {
        drawBoat(sheet, it.idx);
        continue;
      }
      const Loot& l = loot_[-it.idx - 1];
      float risen = l.rise > 0 ? 1 - l.rise / 0.6f : 1;
      float bob = std::sin(l.bob) * 3;
      float x = SX(l.x), y = SX(l.y * K - 6 + bob + (1 - risen) * 18);
      const Frame& f = LOOT_FR[l.kind];
      float sc = LOOT_W[l.kind] * S / f.r.w;
      if (l.kind == GOLDCHEST) spr::star(x, y - 12, 0.5f, time_ * 60, Color(255, 210, 58, (unsigned char)(160 * risen)));
      app.gfx.sprite(sheet, f.r, x, y, sc, sc, f.ox, f.oy, 0, false, col::white.alpha(clampf(risen, 0, 1)));
    }
    for (auto& p : parts_) {
      float u = p.t / p.life;
      app.gfx.circle(SX(p.x), SX(p.y), p.r * (1 - 0.5f * u), p.c.alpha(1 - u));
    }
    // the bolt
    if (boltT_ > 0) {
      float a = boltT_ / 0.18f;
      const float widths[3] = {11, 5.3f, 2.2f};
      const Color cols[3] = {Color(92, 168, 255, 90), Color(191, 228, 255, 230), col::white};
      for (int l = 0; l < 3; l++)
        for (int i = 0; i + 1 < 12; i++)
          app.gfx.line(SX(bolt_[i][0]), SX(bolt_[i][1]), SX(bolt_[i + 1][0]), SX(bolt_[i + 1][1]), widths[l], cols[l].alpha(a));
    }
    // rain and the storm's gloom
    float wx = std::cos(wind_) * 260 * windS_, rl = std::hypot(wx, 900.0f);
    for (auto& r : rain_) {
      float L = 26 * r[2];
      app.gfx.line(SX(r[0]), SX(r[1]), SX(r[0] - wx / rl * L), SX(r[1] - 900 / rl * L), 1, Color(207, 228, 244, 90));
    }
    float gloom = 0.16f;
    if (liftT_ < liftDur_) {
      float u = liftT_ / liftDur_;
      gloom = lerpf(liftTo_, 0.16f, u * u);
    }
    app.gfx.rect(0, 0, VW, VH, Color(10, 26, 42, (unsigned char)(255 * gloom)));
    if (flashT_ < flashDur_) app.gfx.rect(0, 0, VW, VH, Color(232, 244, 255, (unsigned char)(255 * flashA_ * (1 - flashT_ / flashDur_))));
    // the weather vane on the lighthouse, and the wind dial
    float sa = std::atan2(std::sin(wind_) * K, std::cos(wind_)), sl = std::hypot(std::cos(wind_), std::sin(wind_) * K);
    app.gfx.sprite(sheet, VANE_FR.r, SX(LIGHT_X), SX(LIGHT_Y), 0.8f * sl, 0.8f, VANE_FR.ox, VANE_FR.oy, sa * 180 / PI + std::sin(time_ / 0.18f) * 3);
    app.gfx.panel(12, 10, 150, 40, Color(10, 17, 32, 150), 20);
    app.gfx.text("WIND", 26, 19, 18, Color::hex(0xffe08a), LEFT, false);
    app.gfx.sprite(sheet, VANE_FR.r, 105, 30, 0.62f * sl, 0.62f, VANE_FR.ox, VANE_FR.oy, sa * 180 / PI);
    int strength = (int)std::lround((windS_ - 0.7f) * 6);
    for (int i = 0; i < 3; i++) app.gfx.circle(150, 22 + i * 8, i < strength ? 3 : 1.6f, Color::hex(0xe0a93f));
    for (auto& p : pops_) {
      float a = p.t < p.life * 0.7f ? 1 : 1 - (p.t - p.life * 0.7f) / (p.life * 0.3f);
      app.gfx.text(p.text, p.x, p.y, p.size, p.c.alpha(a), CENTER);
    }
    if (bannerT_ < 1.4f && !banner_.empty()) {
      float a = bannerT_ < 1.1f ? 1 : 1 - (bannerT_ - 1.1f) / 0.3f;
      app.gfx.text(banner_, VW / 2, 190, 40, bannerC_.alpha(a), CENTER, true, 0.7f + 0.3f * easeBack(std::min(1.0f, bannerT_ / 0.25f)));
    }
    drawTimer(DURATION - time_);
    std::vector<int> sc;
    for (auto& b : boats_) sc.push_back(b.score);
    drawScores(sc, "loot");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& b : boats_) s.push_back(b.score);
    return s;
  }
  std::string scoreLabel(int i) const override { return std::to_string(boats_[i].score) + " treasure"; }

 private:
  std::vector<Boat> boats_;
  std::array<Loot, 26> loot_{};
  std::array<Strike, 4> strikes_{};
  std::array<Streak, 16> streaks_{};
  std::array<std::array<float, 3>, 30> rain_{};
  std::vector<Particle> parts_;
  std::vector<RingFx> rings_;
  std::vector<Pop> pops_;
  float bolt_[12][2] = {};
  std::string banner_;
  Color bannerC_ = col::white;
  float bannerT_ = 9, bannerUntil_ = 0;
  float time_ = 0, wind_ = 0, windTo_ = 0, windS_ = 1, shiftT_ = 7.5f;
  float strikeT_ = 5, spawnT_ = 0, thunderT_ = 3.5f, streakT_ = 0, boltT_ = 0;
  float liftT_ = 9, liftDur_ = 1, liftTo_ = 0.16f, flashT_ = 9, flashDur_ = 1, flashA_ = 0;
  bool tide_ = false;
  int tideSpawn_ = 0;
  float tideT_ = 0;
  bool whirlOn_ = false;
  float whirlX_ = 960, whirlY_ = 600 / K, whirlT_ = 0, whirlRot_ = 0;
};

}  // namespace

REGISTER_MINIGAME("storm-navigator", StormNavigator);

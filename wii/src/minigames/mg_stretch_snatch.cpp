// Stretch & Snatch (Luffy, Pirate Seas): a feast table spins on a pirate ship's deck. Aim a stretchy
// rubber arm with the stick, hold A to reach across the table and let go to snap back with up to three
// items (fruit 1, drumstick 2, golden roast 5, +1 for a full hand). Crossed arms tangle and drop their
// haul, the octopus cook slams a rolling pin on arms left out, and gulls swoop on full fists.
// Most food after 45 seconds wins.
#include <algorithm>
#include <array>
#include <cmath>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float PI = 3.14159265f;
constexpr float S = 854.0f / 1920.0f;  // web px -> canvas px
constexpr float DURATION = 45;
// Layout (the table is painted into the arena; this is its centre, depth squash and radius)
constexpr float TX = 960 * S, TY = 589 * S, K = 0.766f, TABLE_R = 290 * S;
constexpr float FOOD_R_MIN = 70 * S, FOOD_R_MAX = 236 * S, FOOD_SCALE = 1.35f;
constexpr float GROUND_Y = 650 * S, SEAT_R = 435 * S, SHOULDER_R = 395 * S;
constexpr float COOK_X = 960 * S, COOK_Y = 351 * S, HAND_X = 1012 * S, HAND_Y = 262 * S;
// Tuning
constexpr float REACH_SPEED = 960 * S, SNAP_SPEED = 1750 * S, L_MAX = 640 * S;
constexpr float HOLD_T = 0.95f, COOL_T = 0.18f, GRAB_R = 60 * S, AIM_DEV = 1.22f, AIM_RATE = 12;
constexpr float TANGLE_T = 0.9f, BONK_T = 0.65f, ARM_Z = 16 * S, CHAR_SCALE = 1.0f;
constexpr float SLAM_WARN = 0.95f, SLAM_R = 78 * S, SLAM_LIFT = 0.42f;
constexpr int MAX_HAUL = 3;
constexpr int POOL = 32;

enum Kind { APPLE, ORANGE, GRAPES, BANANA, PINEAPPLE, MEAT, ROAST };
constexpr int VALUE[7] = {1, 1, 1, 1, 1, 2, 5};
// frames in mg/pirates_snatch.png
constexpr SDL_Rect FOOD_FR[7] = {{820, 0, 28, 28}, {850, 0, 26, 25}, {877, 0, 25, 24}, {105, 260, 29, 19},
                                 {797, 0, 21, 30}, {0, 260, 41, 23},  {555, 0, 47, 43}};
constexpr SDL_Rect COOK_FR[3] = {{260, 0, 97, 112}, {359, 0, 97, 112}, {457, 0, 97, 105}};  // idle shout happy
constexpr SDL_Rect GULL_FR[3] = {{604, 0, 63, 40}, {668, 0, 63, 32}, {733, 0, 63, 32}};
constexpr SDL_Rect PIN_FR = {42, 260, 62, 20};
constexpr float FOOD_OY[7] = {0.758f, 0.804f, 0.741f, 0.786f, 0.821f, 0.804f, 0.598f};

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{0.52f, 0.55f, 0.24f, 0.55f, 0.70f}, {0.30f, 0.78f, 0.11f, 0.28f, 0.42f}, {0.17f, 0.90f, 0.05f, 0.13f, 0.24f}};

struct Pt {
  float x = 0, y = 0;
};

float angleDelta(float a, float b) {
  float d = std::fmod(a - b, PI * 2);
  if (d > PI) d -= PI * 2;
  if (d <= -PI) d += PI * 2;
  return d;
}
float clampAim(float ang, float toC, float dev) {
  float d = angleDelta(ang, toC);
  return toC + clampf(d, -dev, dev);
}
float distToSeg(float px, float py, float ax, float ay, float bx, float by) {
  float vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
  float t = l2 > 0 ? clampf(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1) : 0;
  return std::hypot(px - (ax + vx * t), py - (ay + vy * t));
}
bool segsCross(float ax, float ay, float bx, float by, float cx, float cy, float dx, float dy, Pt& out) {
  float rX = bx - ax, rY = by - ay, sX = dx - cx, sY = dy - cy;
  float den = rX * sY - rY * sX;
  if (std::fabs(den) < 1e-6f) return false;
  float qx = cx - ax, qy = cy - ay;
  float t = (qx * sY - qy * sX) / den, u = (qx * rY - qy * rX) / den;
  const float e = 1e-4f;
  if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return false;
  out.x = ax + rX * t;
  out.y = ay + rY * t;
  return true;
}
int haulPoints(const std::vector<int>& kinds) {
  int n = 0;
  for (int k : kinds) n += VALUE[k];
  return n + ((int)kinds.size() >= MAX_HAUL ? 1 : 0);
}
float spinSpeed(float p, bool frenzy) { return (0.42f + 0.3f * clampf(p, 0, 1)) * (frenzy ? 1.3f : 1); }
int tableTarget(int players) { return 7 + 2 * std::clamp(players, 1, 4); }
float scrX(float x) { return TX + x; }
float scrY(float y, float z = 0) { return TY + y * K - z; }

enum FState { F_FREE, F_TOSS, F_TABLE, F_HELD, F_GULL, F_GONE };
struct Food {
  int kind = APPLE;
  FState st = F_FREE;
  float r = 0, a = 0, x = 0, y = 0, z = 0, vz = 0;
  float fx = 0, fy = 0, tossT = 0, tossLen = 1, bob = 0;
  float gx = 0, gy = 0, gt = 0;  // eaten: flying into the mouth
};

enum AState { A_READY, A_REACH, A_HOLD, A_SNAP, A_TANGLE, A_BONK };
struct Arm {
  AState st = A_READY;
  float aim = 0, dirX = 1, dirY = 0, len = 0, holdT = 0, t = 0, knotX = 0, knotY = 0, wob = 0, phase = 0, safeT = 0;
  std::vector<int> haul;  // food indices
  int startHaul = 0;
  bool primed = false;
};

enum CpuMode { M_AIM, M_REACH, M_BAIL, M_BRAVE };
struct Snatcher {
  float gx = 0, gy = 0, sx = 0, sy = 0, toC = 0;
  Arm arm;
  bool flip = false;
  float animT = 0, cheerT = 0;
  bool gold = false;
  int score = 0;
  // input (pad or CPU)
  float mx = 0, my = 0;
  bool held = false, pressed = false, prevHeld = false;
  // CPU brain
  float timer = 0, n = 0, wait = L_MAX;
  bool hasTarget = false;
  Pt target;
  CpuMode mode = M_AIM;
};

enum GState { G_OFF, G_ENTER, G_CIRCLE, G_DIVE, G_FLEE };
struct Gull {
  GState st = G_OFF;
  float x = 0, y = 0, h = 0, t = 0, x0 = 0, y0 = 0, h0 = 0, x1 = 0, y1 = 0, h1 = 0, ang = 0, flap = 0;
  int preyS = -1, preyF = -1, loot = -1;
};
constexpr float DIVE_T = 0.85f, ENTER_T = 1.3f, CIRCLE_T = 1.1f, FLEE_T = 1.2f, BOP_R = 58 * S;

struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size;
};
struct Burst {
  float x, y, t, life, r;
  Color c;
};
struct Pending {
  float delay;
  int kind;
  bool spot;
  float r, a;
};

class StretchSnatch : public Minigame {
 public:
  void start() override {
    int n = count();
    static const float SEATS[5][4] = {{90, 0, 0, 0}, {90, 0, 0, 0}, {180, 0, 0, 0}, {180, 90, 0, 0}, {195, 125, 55, -15}};
    for (int i = 0; i < n; i++) {
      Snatcher s;
      float th = SEATS[std::clamp(n, 1, 4)][i] * PI / 180;
      s.gx = TX + std::cos(th) * SEAT_R;
      s.gy = GROUND_Y + std::sin(th) * SEAT_R * K;
      s.sx = std::cos(th) * SHOULDER_R;
      s.sy = std::sin(th) * SHOULDER_R;
      s.toC = std::atan2(-s.sy, -s.sx);
      s.arm.aim = s.toC;
      s.flip = s.gx > TX + 5;
      s.cheerT = 1.0f;  // wave hello
      sn_.push_back(s);
    }
    food_.resize(POOL);
    flipAt_ = 21 + (float)rng.next() * 6;
    omega_ = spinSpeed(0, false);
    // a first spread of food so nobody reaches for an empty table
    int m = tableTarget(n) - 2;
    for (int i = 0; i < m; i++) {
      int k = serveKind(0);
      int f = take(k);
      if (f < 0) break;
      food_[f].st = F_TABLE;
      food_[f].r = FOOD_R_MIN + (float)rng.next() * (FOOD_R_MAX - FOOD_R_MIN);
      food_[f].a = (float)i / m * PI * 2 + (float)rng.next() * 0.5f;
    }
    setMood(2, 0.9f);
  }

  // --- rules -------------------------------------------------------------------------------------
  int serveKind(float progress) {
    float roll = (float)rng.next(), pick = (float)rng.next();
    float meat = 0.24f + 0.08f * clampf(progress, 0, 1);
    if (roll < meat) return MEAT;
    return std::min(4, (int)(pick * 5));
  }
  int take(int kind) {
    for (int i = 0; i < POOL; i++)
      if (food_[i].st == F_FREE) {
        Food& f = food_[i];
        f = Food();
        f.kind = kind;
        f.bob = (float)rng.next() * 6;
        return i;
      }
    return -1;
  }
  int onTableCount() const {
    int c = 0;
    for (auto& f : food_) c += (f.st == F_TABLE || f.st == F_TOSS);
    return c;
  }
  bool hasRoast() const {
    for (auto& f : food_)
      if (f.kind == ROAST && (f.st == F_TABLE || f.st == F_TOSS)) return true;
    return false;
  }
  void freeSpot(float rMin, float rMax, float& outR, float& outA) {
    outR = (rMin + rMax) / 2;
    outA = 0;
    float bestD = -1;
    for (int tries = 0; tries < 10; tries++) {
      float r = std::sqrt(rMin * rMin + (float)rng.next() * (rMax * rMax - rMin * rMin));
      float a = (float)rng.next() * PI * 2;
      float px = r * std::cos(a), py = r * std::sin(a), d = 1e9f;
      for (auto& f : food_)
        if (f.st == F_TABLE || f.st == F_TOSS) d = std::min(d, std::hypot(f.r * std::cos(f.a) - px, f.r * std::sin(f.a) - py));
      if (d > 90 * S) {
        outR = r;
        outA = a;
        return;
      }
      if (d > bestD) {
        bestD = d;
        outR = r;
        outA = a;
      }
    }
  }
  void toss(int kind, bool spot = false, float sr = 0, float sa = 0) {
    int i = take(kind);
    if (i < 0) return;
    Food& f = food_[i];
    if (!spot) freeSpot(FOOD_R_MIN, FOOD_R_MAX, sr, sa);
    f.st = F_TOSS;
    f.r = sr;
    f.a = sa;
    f.fx = HAND_X + ((float)rng.next() - 0.5f) * 60 * S;
    f.fy = HAND_Y;
    f.tossT = 0;
    f.tossLen = 0.64f + (float)rng.next() * 0.16f;
    app.audio.sfx("whoosh", 0.25f);
    if (mood_ == 0) setMood(2, 0.38f);
  }
  void tossRoast() {
    toss(ROAST, true, 150 * S + (float)rng.next() * 70 * S, (float)rng.next() * PI * 2);
    if (time_ >= bannerUntil_) banner("GOLDEN ROAST!", col::gold, 1.4f);
    app.audio.sfx("item");
    setMood(2, 0.9f);
  }
  void drop(int i, float x, float y) {
    Food& f = food_[i];
    float px = x + ((float)rng.next() - 0.5f) * 70 * S, py = y + ((float)rng.next() - 0.5f) * 70 * S;
    float r = std::hypot(px, py);
    if (r > FOOD_R_MAX) {
      px *= FOOD_R_MAX / r;
      py *= FOOD_R_MAX / r;
    }
    f.st = F_TABLE;
    f.r = std::max(FOOD_R_MIN * 0.5f, std::hypot(px, py));
    f.a = std::atan2(py, px) - angle_;
    f.z = 40 * S;
    f.vz = (300 + (float)rng.next() * 200) * S;
  }
  void hop(float x, float y, float radius) {
    float d0 = std::hypot(x, y);
    for (auto& f : food_) {
      if (f.st != F_TABLE) continue;
      float d = std::hypot(f.x - x, f.y - y);
      if (d > radius) continue;
      f.vz = (420 + (1 - d / radius) * 380) * S;
      f.z = std::max(f.z, 1.0f);
      f.r = clampf(f.r + (f.r > d0 ? 26 : -18) * S, FOOD_R_MIN * 0.6f, FOOD_R_MAX);
    }
  }
  void setMood(int m, float t) {
    mood_ = m;
    moodT_ = t;
  }
  void banner(const char* text, Color c, float hold) {
    banner_ = text;
    bannerC_ = c;
    bannerT_ = 0;
    bannerUntil_ = time_ + hold;
  }
  void pop(const std::string& text, float x, float y, Color c, int size = 24) { pops_.push_back({text, x, y, 0, 0.9f, c, size}); }
  void burst(float x, float y, float r, Color c, float life = 0.32f) { bursts_.push_back({x, y, 0, life, r, c}); }

  // --- update ------------------------------------------------------------------------------------
  void update(float dt) override {
    time_ += dt;
    float prog = time_ / DURATION;
    if (time_ >= DURATION) {
      if (!wrapped_) wrap();
      return;
    }
    if (!frenzy_ && time_ >= DURATION - 10) startFrenzy();
    if (flipAt_ > 0 && time_ >= flipAt_ && time_ >= bannerUntil_) {
      flipAt_ = 0;
      spinDir_ = -spinDir_;
      banner("THE TABLE TURNS!", Color::hex(0xffe9a8), 1.4f);
      app.audio.sfx("whoosh", 0.5f);
    }
    float want = spinDir_ * spinSpeed(prog, frenzy_);
    omega_ += (want - omega_) * (1 - std::exp(-2.5f * dt));
    angle_ += omega_ * dt;
    updateFood(dt);
    updateCook(dt);
    for (int i = 0; i < count(); i++) {
      Snatcher& s = sn_[i];
      if (isCpu(i)) {
        cpuThink(i, dt);
        s.pressed = s.held && !s.prevHeld;
        s.prevHeld = s.held;
      } else {
        s.mx = pad(i).x;
        s.my = pad(i).y;
        s.held = pad(i).down(B_A);
        s.pressed = pad(i).press(B_A);
      }
      updateArm(i, dt);
    }
    checkTangles();
    updateGulls(dt);
    for (auto& p : pops_) {
      p.t += dt;
      p.y -= 40 * dt;
    }
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
    for (auto& b : bursts_) b.t += dt;
    std::erase_if(bursts_, [](const Burst& b) { return b.t >= b.life; });
    bannerT_ += dt;
  }

  void startFrenzy() {
    frenzy_ = true;
    banner("FEAST FRENZY!", Color::hex(0xff9a3c), 1.9f);
    setMood(2, 1.2f);
    serveT_ = 0;
    tossRoast();
    for (int i = 0; i < 4; i++) pending_.push_back({i * 0.14f, serveKind(1), false, 0, 0});
  }

  // the buzzer: fists still out are eaten as they are
  void wrap() {
    wrapped_ = true;
    for (int i = 0; i < count(); i++)
      if (sn_[i].arm.st != A_READY) bank(i);
    slamSt_ = 0;
    for (auto& g : gulls_)
      if (g.st != G_OFF) hideGull(g);
  }

  void updateFood(float dt) {
    for (auto& f : food_) {
      if (f.st == F_GONE) {
        f.gt += dt;
        if (f.gt >= 0.16f) f.st = F_FREE;
        continue;
      }
      if (f.st == F_TOSS) {
        f.tossT += dt;
        float u = std::min(1.0f, f.tossT / f.tossLen);
        f.x = f.r * std::cos(f.a + angle_);
        f.y = f.r * std::sin(f.a + angle_);
        if (u >= 1) {
          f.st = F_TABLE;
          f.z = 0;
          f.vz = 180 * S;
          app.audio.sfx("pop", 0.3f);
          burst(scrX(f.x), scrY(f.y), 110 * S, Color(255, 242, 208), 0.32f);
          if (f.kind == ROAST) burst(scrX(f.x), scrY(f.y), 90 * S, col::gold, 0.4f);
        }
        continue;
      }
      if (f.st != F_TABLE) continue;
      f.x = f.r * std::cos(f.a + angle_);
      f.y = f.r * std::sin(f.a + angle_);
      if (f.z > 0 || f.vz != 0) {
        f.vz -= 2600 * S * dt;
        f.z += f.vz * dt;
        if (f.z <= 0) {
          f.z = 0;
          f.vz = std::fabs(f.vz) > 260 * S ? -f.vz * 0.3f : 0;
        }
      }
      f.bob += dt * 2.2f;
    }
  }

  void updateCook(float dt) {
    if (moodT_ > 0) {
      moodT_ -= dt;
      if (moodT_ <= 0 && slamSt_ == 0) mood_ = 0;
    }
    for (auto& p : pending_) {
      p.delay -= dt;
      if (p.delay <= 0) toss(p.kind, p.spot, p.r, p.a);
    }
    std::erase_if(pending_, [](const Pending& p) { return p.delay <= 0; });
    serveT_ -= dt;
    int target = tableTarget(count()) + (frenzy_ ? 3 : 0);
    if (serveT_ <= 0) {
      serveT_ = frenzy_ ? 0.42f : 0.75f + (float)rng.next() * 0.35f;
      int shortBy = target - onTableCount();
      if (shortBy > 0) {
        int n = std::min(shortBy, frenzy_ ? 3 : shortBy > 6 ? 4 : shortBy > 3 ? 3 : 2);
        for (int i = 0; i < n; i++) pending_.push_back({i * 0.15f, serveKind(time_ / DURATION), false, 0, 0});
      }
    }
    if (roastIdx_ < 2 && time_ >= ROAST_AT[roastIdx_]) {
      roastIdx_++;
      if (!hasRoast()) tossRoast();
    }
    updateSlam(dt);
  }

  // --- the cook's rolling pin ----------------------------------------------------------------------
  void startSlam() {
    int best = -1;
    float bestV = 0;
    for (int i = 0; i < count(); i++) {
      const Arm& a = sn_[i].arm;
      if ((a.st != A_REACH && a.st != A_HOLD) || a.len < 180 * S) continue;
      float v = 1 + a.haul.size() * 2 + a.len / (300 * S);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    if (best >= 0 && rng.chance(0.75)) {
      const Snatcher& s = sn_[best];
      float k = std::min(s.arm.len, L_MAX) * (0.55f + (float)rng.next() * 0.3f);
      slamX_ = s.sx + s.arm.dirX * k;
      slamY_ = s.sy + s.arm.dirY * k;
    } else {
      float r, a;
      freeSpot(90 * S, 220 * S, r, a);
      slamX_ = r * std::cos(a + angle_);
      slamY_ = r * std::sin(a + angle_);
    }
    float r = std::hypot(slamX_, slamY_), lim = TABLE_R - 40 * S;
    if (r > lim) {
      slamX_ *= lim / r;
      slamY_ *= lim / r;
    }
    slamSt_ = 1;
    slamT_ = 0;
    setMood(1, SLAM_WARN + 0.5f);
    app.audio.sfx("warn", 0.5f);
  }

  void updateSlam(float dt) {
    if (slamSt_ == 0) {
      slamNext_ -= dt;
      if (slamNext_ <= 0) {
        float p = time_ / DURATION;
        slamNext_ = (frenzy_ ? 2.6f : 4.6f - 1.4f * p) + (float)rng.next() * 1.2f;
        startSlam();
      }
      return;
    }
    slamT_ += dt;
    if (slamSt_ == 1) {
      float u = std::min(1.0f, slamT_ / SLAM_WARN);
      slamH_ = (30 + 170 * std::min(1.0f, u * 2.2f) + std::sin(slamT_ / 0.045f) * 6 * u) * S;
      if (u >= 1) {
        slamSt_ = 2;
        slamT_ = 0;
      }
    } else if (slamSt_ == 2) {
      float u = std::min(1.0f, slamT_ / 0.07f);
      slamH_ = 200 * S * (1 - u * u);
      if (u >= 1) {
        slamImpact();
        slamSt_ = 3;
        slamT_ = 0;
      }
    } else {
      float u = std::min(1.0f, slamT_ / SLAM_LIFT);
      slamH_ = u < 0.35f ? 0 : 240 * S * ((u - 0.35f) / 0.65f);
      if (u >= 1) slamSt_ = 0;
    }
  }

  void slamImpact() {
    app.audio.sfx("hit", 0.8f);
    burst(scrX(slamX_), scrY(slamY_), SLAM_R * 2.2f, Color(255, 224, 176), 0.4f);
    for (int i = 0; i < count(); i++) {
      Snatcher& s = sn_[i];
      AState st = s.arm.st;
      if (st != A_REACH && st != A_HOLD && st != A_SNAP) continue;
      Pt f = fistPos(s);
      if (distToSeg(slamX_, slamY_, s.sx, s.sy, f.x, f.y) > SLAM_R) continue;
      bonk(i);
    }
    hop(slamX_, slamY_, SLAM_R * 1.6f);
  }

  // --- arms --------------------------------------------------------------------------------------
  Pt fistPos(const Snatcher& s) const {
    const Arm& a = s.arm;
    if (a.st == A_TANGLE) return {a.knotX, a.knotY};
    return {s.sx + a.dirX * a.len, s.sy + a.dirY * a.len};
  }
  static bool armOut(const Arm& a) { return a.st == A_REACH || a.st == A_HOLD || a.st == A_SNAP; }

  void updateArm(int i, float dt) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    s.animT += dt;
    s.cheerT -= dt;
    a.phase += dt * 22;
    a.wob *= std::exp(-6 * dt);
    a.safeT = std::max(0.0f, a.safeT - dt);
    switch (a.st) {
      case A_READY: {
        a.t -= dt;
        if (std::hypot(s.mx, s.my) > 0.35f) {
          float want = clampAim(std::atan2(s.my, s.mx), s.toC, AIM_DEV);
          a.aim += angleDelta(want, a.aim) * (1 - std::exp(-AIM_RATE * dt));
        }
        if (s.pressed) a.primed = true;
        if (!s.held) a.primed = false;
        if (a.primed && a.t <= 0) reachOut(i);
        break;
      }
      case A_REACH:
        a.len = std::min(L_MAX, a.len + REACH_SPEED * dt);
        grabAlong(i);
        if (!s.held)
          snap(i);
        else if (a.len >= L_MAX) {
          a.st = A_HOLD;
          a.holdT = 0;
        }
        break;
      case A_HOLD:
        a.holdT += dt;
        a.wob = std::max(a.wob, (3 + 3 * std::sin(a.holdT / 0.06f)) * S);
        grabAlong(i);
        if (!s.held || a.holdT >= HOLD_T) snap(i);
        break;
      case A_SNAP:
        a.len -= SNAP_SPEED * dt;
        if (a.len <= 0) bank(i);
        break;
      case A_TANGLE:
      case A_BONK:
        a.t -= dt;
        if (a.t <= 0) {
          if (a.st == A_TANGLE) {
            a.len = std::hypot(a.knotX - s.sx, a.knotY - s.sy);
            a.safeT = 0.45f;
          }
          a.st = A_SNAP;
          a.wob = 16 * S;
        }
        break;
    }
  }

  void reachOut(int i) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    a.st = A_REACH;
    a.dirX = std::cos(a.aim);
    a.dirY = std::sin(a.aim);
    a.len = a.holdT = a.wob = 0;
    a.startHaul = (int)a.haul.size();
    a.primed = false;
    s.flip = a.dirX < 0;
    s.animT = 0;
    app.audio.sfx("whoosh", 0.5f);
  }
  void snap(int i) {
    sn_[i].arm.st = A_SNAP;
    sn_[i].arm.wob = 20 * S;
  }

  void grabAlong(int i) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    if ((int)a.haul.size() >= MAX_HAUL) return;
    Pt fp = fistPos(s);
    for (int k = 0; k < POOL; k++) {
      Food& f = food_[k];
      if (f.st != F_TABLE || f.z > 26 * S) continue;
      if (std::hypot(f.x - fp.x, f.y - fp.y) > GRAB_R) continue;
      f.st = F_HELD;
      a.haul.push_back(k);
      bool gold = f.kind == ROAST;
      app.audio.sfx(gold ? "item" : "pop", gold ? 0.8f : 0.5f);
      burst(scrX(fp.x), scrY(fp.y), (gold ? 130 : 84) * S, gold ? col::gold : color(i).mix(col::white, 0.4f), 0.3f);
      if ((int)a.haul.size() >= MAX_HAUL) {
        pop("FULL HAND!", scrX(fp.x), scrY(fp.y) - 30, Color::hex(0xffc83a), 20);
        break;
      }
    }
  }

  void bank(int i) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    a.st = A_READY;
    a.len = 0;
    a.t = COOL_T;
    if (a.haul.empty()) return;
    std::vector<int> kinds;
    for (int k : a.haul) {
      Food& f = food_[k];
      kinds.push_back(f.kind);
      f.st = F_GONE;
      f.gt = 0;
      f.gx = s.gx;
      f.gy = s.gy - 60 * CHAR_SCALE;
      f.x = scrX(s.sx);
      f.y = scrY(s.sy, ARM_Z);
    }
    a.haul.clear();
    int pts = haulPoints(kinds);
    bool gold = std::find(kinds.begin(), kinds.end(), (int)ROAST) != kinds.end();
    s.score += pts;
    pop("+" + std::to_string(pts), s.gx + (s.gx > TX ? -24 : 24), s.gy - 90, pts >= 5 || gold ? col::gold : col::white, 26);
    app.audio.sfx("coin", 0.55f);
    if (pts >= 5 || gold) {
      s.cheerT = 1.0f;
      s.gold = gold;
      s.animT = 0;
      pop("FEAST!", s.gx, s.gy - 112, Color::hex(0xff9a3c), 22);
    } else if (pts >= 3)
      pop("YUM!", s.gx, s.gy - 108, Color::hex(0xffe08a), 20);
  }

  void checkTangles() {
    for (int i = 0; i < count(); i++) {
      Snatcher& A = sn_[i];
      if (!armOut(A.arm) || A.arm.len < 40 * S || A.arm.safeT > 0) continue;
      Pt fa = fistPos(A);
      for (int j = i + 1; j < count(); j++) {
        Snatcher& B = sn_[j];
        if (!armOut(B.arm) || B.arm.len < 40 * S || B.arm.safeT > 0) continue;
        Pt fb = fistPos(B), x;
        if (segsCross(A.sx, A.sy, fa.x, fa.y, B.sx, B.sy, fb.x, fb.y, x)) {
          tangle(i, x);
          tangle(j, x);
          app.audio.sfx("bump", 0.6f);
          pop("TANGLE!", scrX(x.x), scrY(x.y, ARM_Z) - 26, Color::hex(0xff9a3c), 24);
          burst(scrX(x.x), scrY(x.y), 160 * S, Color::hex(0xffe9a8), 0.38f);
          break;
        }
      }
    }
  }
  void tangle(int i, Pt at) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    Pt fp = fistPos(s);
    for (int k : a.haul) drop(k, fp.x, fp.y);
    a.haul.clear();
    a.st = A_TANGLE;
    a.t = TANGLE_T;
    a.knotX = at.x;
    a.knotY = at.y;
    s.animT = 0;
  }
  void bonk(int i) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    Pt fp = fistPos(s);
    for (int k : a.haul) drop(k, fp.x, fp.y);
    a.haul.clear();
    a.st = A_BONK;
    a.t = BONK_T;
    a.wob = 0;
    s.animT = 0;
    pop("BONK!", scrX(fp.x), scrY(fp.y) - 30, Color::hex(0xff5a4a), 24);
  }

  // --- gulls -------------------------------------------------------------------------------------
  void updateGulls(float dt) {
    spawnT_ -= dt;
    if (spawnT_ <= 0) {
      spawnT_ = 6.5f + (float)rng.next() * 3.5f - (frenzy_ ? 2 : 0);
      int active = 0;
      for (auto& g : gulls_) active += g.st != G_OFF;
      bool busy = count() >= 3 && time_ > 20;
      if (active < (busy ? 2 : 1)) spawnGull();
    }
    for (auto& g : gulls_) {
      if (g.st == G_OFF) continue;
      g.t += dt;
      g.flap += dt;
      if (g.st == G_ENTER) {
        float u = std::min(1.0f, g.t / ENTER_T), e = 1 - (1 - u) * (1 - u);
        g.x = g.x0 + (g.x1 - g.x0) * e;
        g.y = g.y0 + (g.y1 - g.y0) * e;
        g.h = g.h0 + (g.h1 - g.h0) * e;
        if (u >= 1) {
          g.st = G_CIRCLE;
          g.t = 0;
        }
      } else if (g.st == G_CIRCLE) {
        g.ang += dt * 1.6f;
        g.x = std::cos(g.ang) * 180 * S;
        g.y = std::sin(g.ang) * 150 * S;
        g.h = (240 + std::sin(g.t / 0.2f) * 8) * S;
        if (g.t > CIRCLE_T) {
          pickPrey(g);
          if (g.preyS < 0 && g.preyF < 0)
            flee(g);
          else {
            g.st = G_DIVE;
            g.t = 0;
            g.x0 = g.x;
            g.y0 = g.y;
            g.h0 = g.h;
            g.x1 = g.x;
            g.y1 = g.y;
            app.audio.sfx("warn", 0.45f);
          }
        }
      } else if (g.st == G_DIVE) {
        float u = std::min(1.0f, g.t / DIVE_T);
        Pt p;
        bool ok = preyAt(g, p);
        if (ok) {
          g.x1 = p.x;
          g.y1 = p.y;
        }
        float e = u * u;
        g.x = g.x0 + (g.x1 - g.x0) * e;
        g.y = g.y0 + (g.y1 - g.y0) * e;
        g.h = g.h0 * (1 - e) + 24 * S * e;
        if (bopped(g)) continue;
        if (u >= 1) {
          if (ok) {
            g.loot = snatchFrom(g);
            if (g.loot >= 0) {
              app.audio.sfx("bad", 0.5f);
              pop("SQUAWK!", scrX(g.x), scrY(g.y, g.h) - 24, Color::hex(0xb8d8ff), 20);
            }
          }
          flee(g);
        }
      } else if (g.st == G_FLEE) {
        float u = std::min(1.0f, g.t / FLEE_T);
        g.x = g.x0 + (g.x1 - g.x0) * u * u;
        g.y = g.y0 + (g.y1 - g.y0) * u * u;
        g.h = g.h0 + (g.h1 - g.h0) * u;
        if (g.t < 0.35f && g.loot >= 0 && bopped(g)) continue;
        if (u >= 1) hideGull(g);
      }
    }
  }
  void spawnGull() {
    for (auto& g : gulls_) {
      if (g.st != G_OFF) continue;
      bool left = rng.chance(0.5);
      g = Gull();
      g.st = G_ENTER;
      g.x0 = (left ? -1150 : 1150) * S;
      g.y0 = (-520 + (float)rng.next() * 200) * S;
      g.h0 = 420 * S;
      g.ang = (float)rng.next() * PI * 2;
      g.x1 = std::cos(g.ang) * 180 * S;
      g.y1 = std::sin(g.ang) * 150 * S;
      g.h1 = 240 * S;
      app.audio.sfx("warn", 0.3f);
      return;
    }
  }
  void pickPrey(Gull& g) {
    g.preyS = g.preyF = -1;
    float bestV = 0;
    for (int i = 0; i < count(); i++) {
      const Arm& a = sn_[i].arm;
      if (!armOut(a) || a.haul.empty() || a.st == A_SNAP) continue;
      float v = 1.5f;
      for (int k : a.haul) v += VALUE[food_[k].kind];
      if (v > bestV) {
        bestV = v;
        g.preyS = i;
      }
    }
    if (g.preyS >= 0) return;
    for (int k = 0; k < POOL; k++) {
      if (food_[k].st != F_TABLE) continue;
      float v = VALUE[food_[k].kind] + (float)rng.next() * 0.5f;
      if (v > bestV) {
        bestV = v;
        g.preyF = k;
      }
    }
  }
  bool preyAt(const Gull& g, Pt& out) const {
    if (g.preyS >= 0) {
      const Snatcher& s = sn_[g.preyS];
      if (!armOut(s.arm) || s.arm.haul.empty()) return false;
      out = fistPos(s);
      return true;
    }
    if (g.preyF < 0 || food_[g.preyF].st != F_TABLE) return false;
    out = {food_[g.preyF].x, food_[g.preyF].y};
    return true;
  }
  int snatchFrom(const Gull& g) {
    int loot = -1;
    if (g.preyS >= 0) {
      auto& haul = sn_[g.preyS].arm.haul;
      if (haul.empty()) return -1;
      size_t bi = 0;
      for (size_t i = 1; i < haul.size(); i++)
        if (VALUE[food_[haul[i]].kind] > VALUE[food_[haul[bi]].kind]) bi = i;
      loot = haul[bi];
      haul.erase(haul.begin() + bi);
    } else if (g.preyF >= 0 && food_[g.preyF].st == F_TABLE)
      loot = g.preyF;
    if (loot >= 0) food_[loot].st = F_GULL;
    return loot;
  }
  void flee(Gull& g) {
    g.st = G_FLEE;
    g.t = 0;
    g.x0 = g.x;
    g.y0 = g.y;
    g.h0 = g.h;
    g.x1 = (g.x > 0 ? 1 : -1) * 1250 * S;
    g.y1 = -600 * S;
    g.h1 = 460 * S;
  }
  // a fist passing close to a low gull bops it: it drops its loot back onto the table
  bool bopped(Gull& g) {
    if (g.h > 110 * S) return false;
    bool hit = false;
    for (auto& s : sn_) {
      if (s.arm.st != A_REACH && s.arm.st != A_HOLD) continue;
      Pt fp = fistPos(s);
      if (std::hypot(fp.x - g.x, fp.y - g.y) <= BOP_R) hit = true;
    }
    if (!hit) return false;
    app.audio.sfx("bump", 0.5f);
    pop("BOP!", scrX(g.x), scrY(g.y, g.h) - 24, Color::hex(0x5ce1ff), 20);
    if (g.loot >= 0) {
      drop(g.loot, g.x, g.y);
      g.loot = -1;
    }
    g.preyS = g.preyF = -1;
    flee(g);
    return true;
  }
  void hideGull(Gull& g) {
    g.st = G_OFF;
    if (g.loot >= 0) food_[g.loot].st = F_FREE;
    g.loot = -1;
  }

  // --- CPU ---------------------------------------------------------------------------------------
  void cpuThink(int i, float dt) {
    Snatcher& s = sn_[i];
    Arm& a = s.arm;
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    if (a.st == A_REACH || a.st == A_HOLD) {
      bool release = a.len >= s.wait;
      if ((int)a.haul.size() > a.startHaul && !foodAhead(s)) release = true;
      if ((int)a.haul.size() >= MAX_HAUL) release = true;
      if (s.mode != M_BRAVE && armThreatened(i)) {
        if (s.mode != M_BAIL) s.mode = rng.chance(0.25 + sk.accuracy * 0.7) ? M_BAIL : M_BRAVE;
        if (s.mode == M_BAIL) release = true;
      }
      s.held = !release;
      return;
    }
    s.held = false;
    if (a.st != A_READY) {
      s.hasTarget = false;
      return;
    }
    s.timer -= dt;
    if (!s.hasTarget || s.timer <= 0) {
      s.timer = sk.think * (0.7f + (float)rng.next() * 0.6f);
      s.mode = M_AIM;
      s.n = sk.reaction * (0.6f + (float)rng.next() * 0.5f);
      pickTarget(i);
    }
    if (!s.hasTarget) {
      s.mx = s.my = 0;
      return;
    }
    float want = std::atan2(s.target.y - s.sy, s.target.x - s.sx);
    s.mx = std::cos(want);
    s.my = std::sin(want);
    s.n -= dt;
    if (s.n <= 0 && a.t <= 0 && std::fabs(angleDelta(clampAim(want, s.toC, AIM_DEV), a.aim)) < 0.08f) {
      s.held = true;
      s.mode = M_REACH;
      s.hasTarget = false;
    }
  }

  // where a fist from the shoulder meets an item riding the turning table (null if out of reach)
  bool leadTarget(const Snatcher& s, const Food& f, float delay, float maxLen, Pt& out, float& len, float& t) const {
    t = delay;
    float x = 0, y = 0;
    len = 0;
    for (int k = 0; k < 3; k++) {
      float ang = f.a + angle_ + omega_ * t;
      x = f.r * std::cos(ang);
      y = f.r * std::sin(ang);
      len = std::hypot(x - s.sx, y - s.sy);
      t = delay + len / REACH_SPEED;
    }
    if (len > maxLen) return false;
    out = {x, y};
    return true;
  }

  void pickTarget(int i) {
    Snatcher& s = sn_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    bool found = false;
    Pt best;
    float bestLen = 0, bestScore = -1e9f;
    for (auto& f : food_) {
      if (f.st != F_TABLE) continue;
      Pt lead;
      float len, t;
      if (!leadTarget(s, f, 0.25f, L_MAX - 16 * S, lead, len, t)) continue;
      float ang = std::atan2(lead.y - s.sy, lead.x - s.sx);
      if (std::fabs(angleDelta(ang, s.toC)) > AIM_DEV) continue;
      float score = VALUE[f.kind] * 10 / (t + 0.6f);
      for (auto& o : food_) {
        if (&o == &f || o.st != F_TABLE) continue;
        if (distToSeg(o.x, o.y, s.sx, s.sy, lead.x, lead.y) < GRAB_R * 0.8f) score += VALUE[o.kind] * 3;
      }
      for (int q = 0; q < count(); q++)
        if (q != i && sn_[q].hasTarget && std::hypot(sn_[q].target.x - lead.x, sn_[q].target.y - lead.y) < 60 * S) {
          score -= 5;
          break;
        }
      if (slamSt_ == 1 && distToSeg(slamX_, slamY_, s.sx, s.sy, lead.x, lead.y) < SLAM_R + 20 * S) score -= 12 * sk.accuracy;
      for (int q = 0; q < count(); q++) {
        if (q == i || !armOut(sn_[q].arm)) continue;
        Pt of = fistPos(sn_[q]), x;
        if (segsCross(s.sx, s.sy, lead.x, lead.y, sn_[q].sx, sn_[q].sy, of.x, of.y, x)) score -= 9 * sk.accuracy;
      }
      score += ((float)rng.next() - 0.5f) * 12 * sk.mistake;
      if (score > bestScore) {
        bestScore = score;
        found = true;
        best = lead;
        bestLen = len;
      }
    }
    if (!found) {
      s.hasTarget = false;
      return;
    }
    float miss = sk.aimNoise * 95 * S * ((float)rng.next() - 0.5f) * 2;
    float ang = std::atan2(best.y - s.sy, best.x - s.sx) + PI / 2;
    s.target = {best.x + std::cos(ang) * miss, best.y + std::sin(ang) * miss};
    s.hasTarget = true;
    s.wait = bestLen + 20 * S + (rng.chance(sk.mistake) ? 140 * S : 0);
  }

  bool foodAhead(const Snatcher& s) const {
    Pt fp = fistPos(s);
    float ex = fp.x + s.arm.dirX * 110 * S, ey = fp.y + s.arm.dirY * 110 * S;
    for (auto& f : food_)
      if (f.st == F_TABLE && distToSeg(f.x, f.y, fp.x, fp.y, ex, ey) < GRAB_R * 0.8f) return true;
    return false;
  }
  bool armThreatened(int i) const {
    const Snatcher& s = sn_[i];
    if (slamSt_ == 1 && slamT_ > SLAM_WARN * 0.35f) {
      Pt fp = fistPos(s);
      if (distToSeg(slamX_, slamY_, s.sx, s.sy, fp.x, fp.y) < SLAM_R + 30 * S) return true;
    }
    for (auto& g : gulls_)
      if (g.st == G_DIVE && g.preyS == i && g.t / DIVE_T > 0.3f) return true;
    return false;
  }

  // --- drawing -----------------------------------------------------------------------------------
  static void thickPoly(const Pt* p, int n, float w, Color c) {
    for (int i = 0; i + 1 < n; i++) app.gfx.line(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, w, c);
    for (int i = 0; i < n; i++) app.gfx.circle(p[i].x, p[i].y, w * 0.5f, c);
  }
  void drawFood(Tex* t, int kind, float x, float y, float scale, float angle = 0) const {
    const SDL_Rect& r = FOOD_FR[kind];
    if (kind == ROAST) spr::star(x, y - 10, 0.5f * scale, time_ * 60, Color(255, 210, 58, 150));
    app.gfx.sprite(t, r, x, y, scale, scale, 0.5f, FOOD_OY[kind], angle);
  }

  void draw() override {
    drawArena();
    Tex* sheet = app.gfx.tex("mg/pirates_snatch.png");
    // the cook behind the table
    float bob = std::sin(time_ / 0.26f) * 3 * S;
    const SDL_Rect& cf = COOK_FR[mood_];
    app.gfx.sprite(sheet, cf, COOK_X, COOK_Y + bob, 1, 1, 0.5f, mood_ == 2 ? 0.762f : 0.71f);
    // gold studs round the rim turn with the table
    for (int k = 0; k < 12; k++) {
      float a = angle_ + k * PI / 6, r = TABLE_R * 0.92f;
      float x = scrX(r * std::cos(a)), y = scrY(r * std::sin(a));
      app.gfx.circle(x, y, 3.2f, Color(110, 70, 30, 200));
      app.gfx.circle(x, y - 0.6f, 2.2f, Color::hex(0xffd36a));
    }
    // the slam target and the pin's shadow
    if (slamSt_ != 0) {
      float tx = scrX(slamX_), ty = scrY(slamY_);
      if (slamSt_ <= 2) {
        float u = slamSt_ == 1 ? std::min(1.0f, slamT_ / SLAM_WARN) : 1;
        float throb = 0.5f + 0.5f * std::sin(slamT_ / (0.09f - 0.05f * u));
        float r = SLAM_R * (1.6f - 0.6f * u);
        app.gfx.ellipse(tx, ty, r, r * K, Color(255, 58, 42, (unsigned char)(255 * (0.12f + 0.18f * u))));
        app.gfx.ellipse(tx, ty, SLAM_R + 2, (SLAM_R + 2) * K, Color(255, 255, 255, (unsigned char)(120 + 120 * throb)));
        app.gfx.ellipse(tx, ty, SLAM_R, SLAM_R * K, Color(255, 58, 42, 150));
      }
      float k = 1 - std::min(1.0f, slamH_ / (220 * S));
      float w = (70 + 40 * (1 - k)) * S * 0.5f;
      app.gfx.ellipse(tx, ty + 2, w, w * K * 0.55f, Color(26, 16, 16, (unsigned char)(255 * (0.18f + 0.32f * k))));
    }
    for (auto& b : bursts_) {
      float u = b.t / b.life;
      app.gfx.ellipse(b.x, b.y, b.r * (0.3f + 0.7f * u) * 0.5f, b.r * (0.3f + 0.7f * u) * 0.5f * K, b.c.alpha(0.55f * (1 - u)));
    }
    // food on the table (back to front), then tosses in flight
    std::array<int, POOL> order{};
    int no = 0;
    for (int k = 0; k < POOL; k++)
      if (food_[k].st == F_TABLE) order[no++] = k;
    std::sort(order.begin(), order.begin() + no, [&](int a, int b) { return food_[a].y < food_[b].y; });
    for (int j = 0; j < no; j++) {
      const Food& f = food_[order[j]];
      float x = scrX(f.x), y = scrY(f.y);
      app.gfx.ellipse(x, y + 1, f.kind == ROAST ? 15 : 10, f.kind == ROAST ? 5 : 3.5f, Color(20, 10, 5, 100));
      float lift = f.kind == ROAST ? (2 + std::sin(f.bob) * 2) * S : 0;
      drawFood(sheet, f.kind, x, y - f.z - lift, FOOD_SCALE);
    }
    for (auto& f : food_) {
      if (f.st != F_TOSS) continue;
      float u = std::min(1.0f, f.tossT / f.tossLen);
      float lx = scrX(f.x), ly = scrY(f.y);
      float x = f.fx + (lx - f.fx) * u, y = f.fy + (ly - f.fy) * u - std::sin(u * PI) * 170 * S;
      app.gfx.ellipse(lx, ly + 1, 9, 3, Color(20, 10, 5, (unsigned char)(255 * (0.2f + 0.3f * u))));
      drawFood(sheet, f.kind, x, y, FOOD_SCALE, f.kind == ROAST ? 0 : u * 360);
    }
    drawArms(sheet);
    drawTentacle(sheet);
    // eaten food flies into the mouth
    for (auto& f : food_) {
      if (f.st != F_GONE) continue;
      float u = std::min(1.0f, f.gt / 0.16f), e = u * u;
      drawFood(sheet, f.kind, lerpf(f.x, f.gx, e), lerpf(f.y, f.gy, e), FOOD_SCALE * (1 - 0.8f * e));
    }
    // characters, back to front
    std::vector<int> ord;
    for (int i = 0; i < count(); i++) ord.push_back(i);
    std::sort(ord.begin(), ord.end(), [&](int a, int b) { return sn_[a].gy < sn_[b].gy; });
    for (int i : ord) {
      const Snatcher& s = sn_[i];
      const char* anim = "idle";
      AState st = s.arm.st;
      if (st == A_TANGLE || st == A_BONK)
        anim = "stunned";
      else if (st == A_REACH || st == A_HOLD)
        anim = "throw";
      else if (s.cheerT > 0)
        anim = time_ < 1.2f ? "wave" : (s.gold ? "victory" : "celebrate");
      float t = st == A_REACH || st == A_HOLD ? std::min(s.animT, 0.12f) : s.animT;
      spr::shadow(s.gx, s.gy, 44);
      spr::character(player(i).character, anim, t, s.gx, s.gy, CHAR_SCALE, s.flip);
      drawPlayerTag(i, s.gx, s.gy - 88);
    }
    drawGulls(sheet);
    for (auto& p : pops_) {
      float a = p.t < p.life * 0.7f ? 1 : 1 - (p.t - p.life * 0.7f) / (p.life * 0.3f);
      app.gfx.text(p.text, p.x, p.y, p.size, p.c.alpha(a), CENTER);
    }
    if (bannerT_ < 1.4f && !banner_.empty()) {
      float a = bannerT_ < 1.1f ? 1 : 1 - (bannerT_ - 1.1f) / 0.3f;
      float sc = 0.7f + 0.3f * easeBack(std::min(1.0f, bannerT_ / 0.25f));
      app.gfx.text(banner_, VW / 2, 190, 40, bannerC_.alpha(a), CENTER, true, sc);
    }
    drawTimer(DURATION - time_);
    std::vector<int> sc;
    for (auto& s : sn_) sc.push_back(s.score);
    drawScores(sc, "food");
  }

  void drawArms(Tex* sheet) const {
    Pt pts[9];
    for (int i = 0; i < count(); i++) {
      const Snatcher& s = sn_[i];
      const Arm& a = s.arm;
      Color pc = color(i), dark = pc.mix(col::black, 0.45f);
      float x0 = scrX(s.sx), y0 = scrY(s.sy, ARM_Z);
      if (a.st == A_READY) {
        if (isCpu(i) || time_ >= DURATION) continue;
        // a human's aim: a dotted line out to full reach, with a ring where the fist would stop
        float cx = std::cos(a.aim), cy = std::sin(a.aim);
        Color dc = pc.alpha(a.t <= 0 ? 0.85f : 0.35f);
        for (float d = 40 * S; d <= L_MAX; d += 34 * S) app.gfx.circle(scrX(s.sx + cx * d), scrY(s.sy + cy * d), d > L_MAX - 30 * S ? 3.2f : 2, dc);
        app.gfx.ellipse(scrX(s.sx + cx * L_MAX), scrY(s.sy + cy * L_MAX), 9, 9 * K, pc.alpha(0.4f));
        continue;
      }
      Pt fp = fistPos(s);
      float fx = scrX(fp.x), fy = scrY(fp.y, a.st == A_BONK ? 2 : ARM_Z);
      float dx = fx - x0, dy = fy - y0, len = std::max(1.0f, std::hypot(dx, dy));
      float nx = -dy / len, ny = dx / len;
      float wob = a.st == A_SNAP ? a.wob : a.st == A_HOLD ? a.wob * 0.4f : 0;
      const int n = 9;
      for (int k = 0; k < n; k++) {
        float u = (float)k / (n - 1);
        float off = wob * std::sin(u * PI * 3 + a.phase) * std::sin(u * PI);
        pts[k] = {x0 + dx * u + nx * off, y0 + dy * u + ny * off};
      }
      // shadow on the table, the rubbery tube and its stretch bands
      app.gfx.line(pts[0].x, pts[0].y + ARM_Z, pts[n - 1].x, pts[n - 1].y + ARM_Z, 9, Color(26, 14, 8, 56));
      float w = (a.st == A_BONK ? 30 : 22) * S;
      thickPoly(pts, n, w + 3.5f, dark);
      thickPoly(pts, n, w, pc);
      for (int k = 1; k <= 5; k++) {
        const Pt& p = pts[k + 1];
        app.gfx.line(p.x - nx * w * 0.45f, p.y - ny * w * 0.45f, p.x + nx * w * 0.45f, p.y + ny * w * 0.45f, 1.8f, dark);
      }
      float ang = std::atan2(dy, dx);
      if (a.st == A_TANGLE) {
        float t = time_ / 0.09f;
        app.gfx.circle(fx + std::cos(t) * 3.5f, fy + std::sin(t) * 2.2f, 9, dark);
        app.gfx.circle(fx + std::cos(t) * 3.5f, fy + std::sin(t) * 2.2f, 7, pc);
        app.gfx.circle(fx + std::cos(t) * 3.5f, fy + std::sin(t) * 2.2f, 4, dark);
      } else {
        // the glove fist
        float sq = a.st == A_BONK ? 0.7f : 1;
        float gx = fx + std::cos(ang) * 2, gy = fy + std::sin(ang) * 2;
        app.gfx.ellipse(gx, gy, 12.5f, 10.5f * sq, Color::hex(0x2a2233));
        app.gfx.ellipse(gx, gy, 11, 9 * sq, col::white);
        app.gfx.ellipse(gx - 1, gy + 2, 8, 5 * sq, Color::hex(0xe1e6ef));
        app.gfx.circle(fx - std::cos(ang) * 10, fy - std::sin(ang) * 10, w * 0.62f, pc);
      }
      for (size_t k = 0; k < a.haul.size(); k++) {
        float ox = ((float)k - (a.haul.size() - 1) / 2.0f) * 11.5f;
        drawFood(sheet, food_[a.haul[k]].kind, fx + nx * ox, fy - 9 - (k % 2) * 2.7f, FOOD_SCALE * 0.82f);
      }
    }
  }

  void drawTentacle(Tex* sheet) const {
    if (slamSt_ == 0) return;
    float px = scrX(slamX_), py = scrY(slamY_) - slamH_ - 16 * S;
    float mx = (HAND_X + px) / 2 + (px > HAND_X ? 18 : -18), my = std::min(HAND_Y, py) - 40;
    Pt pts[10];
    const int n = 10;
    for (int i = 0; i < n; i++) {
      float u = (float)i / (n - 1), a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      pts[i] = {a * HAND_X + b * mx + c * px, a * HAND_Y + b * my + c * py};
    }
    thickPoly(pts, n, 30 * S, Color::hex(0x8f3a2a));
    thickPoly(pts, n, 22 * S, Color::hex(0xf07a5a));
    for (int i = 2; i < n - 1; i += 2) app.gfx.circle(pts[i].x, pts[i].y + 3, 1.8f, Color::hex(0xffd7c4));
    app.gfx.sprite(sheet, PIN_FR, px, py + 10 * S, 1, 1, 0.475f, 0.159f);
  }

  void drawGulls(Tex* sheet) const {
    for (auto& g : gulls_) {
      if (g.st == G_OFF) continue;
      float x = scrX(g.x), y = scrY(g.y);
      float k = std::max(0.25f, 1 - g.h / (420 * S));
      float sw = 20 * (1.3f - k * 0.3f);
      app.gfx.ellipse(x, y + 1, sw, sw * 0.33f, Color(20, 20, 30, (unsigned char)(255 * (0.15f + 0.5f * k))));
      int f = (int)(g.flap / (g.st == G_DIVE ? 0.07f : 0.11f)) % 4;
      const SDL_Rect& fr = GULL_FR[f == 0 ? 0 : (f == 2 ? 2 : 1)];
      float sc = 1 + g.h / (900 * S);
      app.gfx.sprite(sheet, fr, x, y - g.h, sc, sc, 0.5f, 0.5f, 0, g.x1 - g.x0 < 0);
      if (g.loot >= 0) drawFood(sheet, food_[g.loot].kind, x, y - g.h + 34 * S, FOOD_SCALE, std::sin(g.flap / 0.08f) * 12);
    }
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& x : sn_) s.push_back(x.score);
    return s;
  }
  std::string scoreLabel(int i) const override { return std::to_string(sn_[i].score) + " food"; }

 private:
  static constexpr float ROAST_AT[2] = {11.5f, 27.0f};
  std::vector<Snatcher> sn_;
  std::vector<Food> food_;
  std::array<Gull, 2> gulls_{};
  std::vector<Pop> pops_;
  std::vector<Burst> bursts_;
  std::vector<Pending> pending_;
  std::string banner_;
  Color bannerC_ = col::white;
  float bannerT_ = 9, bannerUntil_ = 0;
  float time_ = 0, angle_ = 0, omega_ = 0.42f, spinDir_ = 1, flipAt_ = 0;
  bool frenzy_ = false, wrapped_ = false;
  float serveT_ = 0.3f;
  int roastIdx_ = 0;
  int mood_ = 0;  // 0 idle 1 shout 2 happy
  float moodT_ = 0;
  int slamSt_ = 0;  // 0 idle 1 wind 2 drop 3 lift
  float slamT_ = 0, slamNext_ = 5.5f, slamX_ = 0, slamY_ = 0, slamH_ = 0;
  float spawnT_ = 8;
};

}  // namespace

REGISTER_MINIGAME("stretch-snatch", StretchSnatch);

// Free Throw Frenzy (Capitol Gardens): shoot hoops on a sunny garden court. Press A to stop the power bar in the
// green, then A again to stop the aim needle in the green: a basket scores 2, a swish 3, and the golden last ball
// of every five-ball rack doubles it. In the final 10 seconds the hoop slides along its track and every basket is
// worth one more. Most points after 45 seconds wins.
// (Port of src/game/worlds/capitol/games/FreeThrow.ts + freeThrowRules.ts.)
#include <algorithm>
#include <array>
#include <cmath>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float PI_F = 3.14159265f;
constexpr float K = VW / 1920.0f;  // web canvas -> Wii canvas
// The court is seen from 34 degrees up: ground depth is squashed by COSB, heights lift by SINB.
constexpr float COSB = 0.5591929f, SINB = 0.8290376f;

// --- Rules (freeThrowRules.ts): web screen px for ground points, world px for heights, ms ---
constexpr float HOOP_X = 960, HOOP_GY = 560, RIM_Z = 305, RIM_R = 40;
constexpr float BOARD_BACK = 52;
constexpr float BALL_R = 17, SHOOT_R = 520;
constexpr float FLIGHT_MS = 900, ARC_H = 290;
constexpr float ROUND_MS = 45000, FINAL_MS = 10000;
constexpr int RACK = 5;
constexpr float SLIDE_AMP = 230, SLIDE_PERIOD = 4000, SLIDE_RAMP = 900;
constexpr float POWER_MS = 900, AIM_MS = 800, GOLD_SPEED = 1.2f;
constexpr float POWER_MAKE = 0.075f, POWER_SWISH = 0.026f, AIM_MAKE = 0.16f, AIM_SWISH = 0.055f;
constexpr float SWISH_K = POWER_SWISH / POWER_MAKE;
constexpr float AIM_RANGE = 32;
constexpr float POWER_BASE = 0.6f, POWER_PER_PX = 0.0011f;

// --- Scene (FreeThrow.ts) ---
constexpr float CHAR_SCALE = 0.95f;
constexpr float GRAVITY = 1800;
constexpr float RIM_SY = HOOP_GY - RIM_Z * SINB;
constexpr float NET_DROP = 80;
constexpr int NET_N = 10;
constexpr float RELOAD_MS = 520, REFILL_MS = 900, RELEASE_AT = 130;

enum Outcome { SWISH, RIM_IN, BANK, RIM_OUT, BOARD_OUT, SHORT, WIDE };

struct Skill {
  float reaction, mistake, aimNoise;
};
const Skill SKILL[3] = {{520, 0.24f, 0.55f}, {300, 0.11f, 0.28f}, {170, 0.05f, 0.13f}};

float spotAngle(int i, int n) {
  if (n <= 1) return 0;
  if (n == 2) return i == 0 ? -30.0f : 30.0f;
  if (n == 3) return i == 0 ? -50.0f : (i == 1 ? 0.0f : 50.0f);
  const float a[4] = {-60, -20, 20, 60};
  return a[i];
}

float pingPong(float u) {
  float m = std::fmod(std::fmod(u, 2.0f) + 2.0f, 2.0f);
  return m <= 1 ? m : 2 - m;
}

float hoopXAt(float t, float t0) {
  if (t0 < 0 || t <= t0) return HOOP_X;
  float tau = t - t0;
  float amp = SLIDE_AMP * std::min(1.0f, tau / SLIDE_RAMP);
  return HOOP_X + amp * std::sin(tau / SLIDE_PERIOD * PI_F * 2);
}

float hoopDistance(float sx, float sgy, float hx) { return std::hypot(hx - sx, (HOOP_GY - sgy) / COSB); }
float powerTarget(float dist, float jitter) { return clampf(POWER_BASE + jitter + (dist - SHOOT_R) * POWER_PER_PX, 0.14f, 0.88f); }
float aimTarget(float sx, float sgy, float hx) {
  float d = (sgy - HOOP_GY) / COSB;
  float rest = std::atan2(HOOP_X - sx, d), now = std::atan2(hx - sx, d);
  return clampf((now - rest) * 180 / PI_F / AIM_RANGE, -0.84f, 0.84f);
}

// What a shot does from each meter's error, in units of its green half-width.
Outcome shotOutcome(float ep, float ea) {
  float ap = std::fabs(ep), aa = std::fabs(ea);
  if (ap <= SWISH_K && aa <= SWISH_K) return SWISH;
  if (ap <= 1 && aa <= 1) return RIM_IN;
  if (ep > 1 && ep <= 1.9f && aa <= 0.6f) return BANK;
  if (ap <= 1.9f && aa <= 1.9f) return RIM_OUT;
  if (ep > 1.9f && aa <= 1.9f) return BOARD_OUT;
  if (ep < -1.9f) return SHORT;
  return WIDE;
}
bool isBasket(Outcome o) { return o == SWISH || o == RIM_IN || o == BANK; }
int shotPoints(Outcome o, bool golden, bool finalStretch) {
  int base = o == SWISH ? 3 : (isBasket(o) ? 2 : 0);
  if (!base) return 0;
  return (base + (finalStretch ? 1 : 0)) * (golden ? 2 : 1);
}

enum Stage { READY, POWER, AIM, THROW, RELOAD };

struct Shooter {
  float x = 0, gy = 0;
  float face = 1, side = 1;
  Stage stage = READY;
  float t = 0, mt = 0;
  float pVal = 0, aVal = -1, pLock = 0, pErr = 0, pShown = POWER_BASE;
  float jitter = 0, pTarget = POWER_BASE, aTarget = 0;
  int shots = 0, streak = 0;
  bool golden = false, holding = true;
  std::array<bool, RACK> rack{};
  float flash = 0;
  Color flashCol = col::white;
  float fade = 0;
  const char* anim = "carry";
  float animT = 0, emoteT = 0;
  // CPU: where it means to stop the current meter (in green half-widths), when it may press, last value seen
  float goal = 0, readyAt = 0, last = 0;
};

enum Phase { FLY, RATTLE, BANKP, DROP, LOOSE };

struct Ball {
  bool on = false;
  int s = -1;
  bool golden = false;
  Outcome outcome = SWISH;
  int points = 0;
  Phase phase = FLY;
  float t = 0;
  float x0 = 0, g0 = 0, z0 = 0, x1 = 0, g1 = 0, z1 = 0;
  float x = 0, g = 0, z = 0, vx = 0, vg = 0, vz = 0;
  float ra = 0, rot = 0, spin = 0;
  int bounces = 0;
  float life = 0, alpha = 1;
  bool scored = false, inNet = false;
  std::array<float, 8> trx{}, try_{};
  int tn = 0;
};

struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size;
};

// A standard normal sample (Box-Muller) from the minigame's generator.
float gauss(Random& r) {
  float u = std::max(1e-6f, (float)r.next());
  return std::sqrt(-2 * std::log(u)) * std::cos(PI_F * 2 * (float)r.next());
}

class FreeThrow : public Minigame {
 public:
  void start() override {
    int n = count();
    for (int i = 0; i < n; i++) {
      Shooter s;
      float a = spotAngle(i, n) * PI_F / 180;
      s.x = HOOP_X + std::sin(a) * SHOOT_R;
      s.gy = HOOP_GY + std::cos(a) * SHOOT_R * COSB;
      s.face = s.x <= HOOP_X ? 1.0f : -1.0f;
      s.side = s.x < HOOP_X ? -1.0f : 1.0f;
      s.rack.fill(true);
      s.rack[0] = false;
      sh_.push_back(s);
    }
    score_.assign(n, 0);
    balls_.resize(12);
  }

  float arrivalX() const { return hoopXAt(ms_ + RELEASE_AT + FLIGHT_MS, slideAt_); }

  void pop(const std::string& s, float x, float y, Color c, int size = 20, float life = 0.9f) { pops_.push_back({s, x, y, 0, life, c, size}); }

  void beginPower(int i) {
    Shooter& s = sh_[i];
    s.stage = POWER;
    s.t = s.mt = 0;
    s.pVal = 0;
    s.aVal = -1;
    s.fade = 1;
    s.golden = s.shots % RACK == RACK - 1;
    s.jitter = ((float)rng.next() - 0.5f) * 0.28f;
    s.holding = true;
    cpuArm(i);
    if (s.golden) pop("GOLDEN BALL!", s.x * K, s.gy * K - 110, Color::hex(0xffb020), 18, 1.0f);
  }

  void updateTargets(Shooter& s) {
    float hx = arrivalX();
    s.pTarget = powerTarget(hoopDistance(s.x, s.gy, hx), s.jitter);
    s.aTarget = aimTarget(s.x, s.gy, hx);
  }

  void lockFeedback(Shooter& s, int quality) {
    s.flash = 260;
    s.flashCol = quality == 2 ? col::white : (quality == 1 ? Color::hex(0x7dff8a) : Color::hex(0xffb347));
    app.audio.sfx("tick", 0.4f);
  }

  void updateShooter(int i, float dt) {
    Shooter& s = sh_[i];
    s.t += dt;
    s.flash = std::max(0.0f, s.flash - dt);
    bool press = isCpu(i) ? cpuPress(i) : pad(i).press(B_A);
    float speed = s.golden ? GOLD_SPEED : 1.0f;
    switch (s.stage) {
      case POWER:
        updateTargets(s);
        if (press) {
          s.pLock = s.pVal;
          s.pShown = s.pTarget;
          float e = (s.pLock - s.pTarget) / POWER_MAKE;
          s.pErr = e;
          lockFeedback(s, std::fabs(e) <= SWISH_K ? 2 : (std::fabs(e) <= 1 ? 1 : 0));
          s.stage = AIM;
          s.t = s.mt = 0;
          cpuArm(i);
          break;
        }
        s.mt += dt * speed;
        s.pVal = pingPong(s.mt / POWER_MS);
        break;
      case AIM:
        updateTargets(s);
        if (press) {
          shoot(i);
          break;
        }
        s.mt += dt * speed;
        s.aVal = pingPong(s.mt / AIM_MS) * 2 - 1;
        break;
      case THROW:
        if (s.t >= RELEASE_AT && s.holding) release(i);
        s.fade = std::max(0.0f, s.fade - dt / 220);
        if (s.t >= 380) {
          s.stage = RELOAD;
          s.t = 0;
          if (s.shots % RACK == 0) s.rack.fill(true);  // a fresh rack rolls in
        }
        break;
      case RELOAD: {
        float wait = s.shots % RACK == 0 ? REFILL_MS : RELOAD_MS - 380;
        if (s.t >= wait) {
          s.rack[s.shots % RACK] = false;
          beginPower(i);
        }
        break;
      }
      default:
        break;
    }
  }

  // The aim is set: work out the shot, jump and throw.
  void shoot(int i) {
    Shooter& s = sh_[i];
    float ep = s.pErr, ea = (s.aVal - s.aTarget) / AIM_MAKE;
    lockFeedback(s, std::fabs(ea) <= SWISH_K ? 2 : (std::fabs(ea) <= 1 ? 1 : 0));
    Outcome o = shotOutcome(ep, ea);
    s.stage = THROW;
    s.t = 0;
    s.shots++;
    Ball* b = nullptr;
    for (auto& q : balls_)
      if (!q.on && q.s < 0) {
        b = &q;
        break;
      }
    if (!b) {
      balls_.emplace_back();
      b = &balls_.back();
    }
    b->s = i;
    b->golden = s.golden;
    b->outcome = o;
    b->points = shotPoints(o, s.golden, bonus_);
    b->ra = arrivalX();
    planArrival(*b, s, ep, ea);
    app.audio.sfx("dash", 0.4f);
  }

  // The flight's end point for this outcome, relative to the hoop where it will be on arrival.
  void planArrival(Ball& b, const Shooter& s, float ep, float ea) {
    float hx = b.ra;
    float dx = hx - s.x, dd = (HOOP_GY - s.gy) / COSB;
    float L = std::max(1e-3f, std::hypot(dx, dd));
    float ux = dx / L, ud = dd / L;
    auto at = [&](float along, float lat, float z) {
      b.x1 = hx + ux * along - ud * lat;
      b.g1 = HOOP_GY + (ud * along + ux * lat) * COSB;
      b.z1 = z;
    };
    const float r = RIM_R;
    auto ce = [](float e) { return clampf(e, -3, 3); };
    switch (b.outcome) {
      case SWISH:
        at(0, 0, RIM_Z + 4);
        break;
      case RIM_IN:
        at(ce(ep) * r * 0.55f, ce(ea) * r * 0.55f, RIM_Z + 6);
        break;
      case BANK:
      case BOARD_OUT:
        b.x1 = hx - clampf(ea, -1.6f, 1.6f) * r * 0.9f * ud;
        b.g1 = HOOP_GY - BOARD_BACK * COSB;
        b.z1 = RIM_Z + (b.outcome == BANK ? 46 : 70 + std::min(40.0f, (ep - 1.9f) * 20));
        break;
      case RIM_OUT: {
        float m = std::hypot(ep, ea);
        if (m == 0) m = 1;
        at(ep / m * r, ea / m * r, RIM_Z + 4);
        break;
      }
      case SHORT:
        at(-r - 30 - std::min(60.0f, (-ep - 1.9f) * 25), ce(ea) * r * 0.6f, RIM_Z - 50);
        break;
      default:
        at(ce(ep) * r * 0.6f, (ea < 0 ? -1.0f : 1.0f) * (r + 28 + std::min(50.0f, (std::fabs(ea) - 1.9f) * 20)), RIM_Z - 20);
        break;
    }
  }

  float jumpY(const Shooter& s) const {
    if (s.stage != THROW || s.t > 340) return 0;
    float u = s.t < 170 ? easeOut(s.t / 170) : easeOut(1 - (s.t - 170) / 170);
    return -40 * u;
  }
  // The ball in the hands, web px: (x, screen y).
  float handX(const Shooter& s) const { return s.x + s.face * 28; }
  float handY(const Shooter& s) const { return s.gy + jumpY(s) * 0.7f - 77; }

  // The ball leaves the hands at the top of the jump.
  void release(int i) {
    Shooter& s = sh_[i];
    s.holding = false;
    for (auto& b : balls_) {
      if (b.s != i || b.on) continue;
      b.on = true;
      b.phase = FLY;
      b.t = 0;
      b.x0 = handX(s);
      b.g0 = s.gy - 6;
      b.z0 = (b.g0 - handY(s)) / SINB;
      b.x = b.x0;
      b.g = b.g0;
      b.z = b.z0;
      b.spin = s.face * (5 + 3 * (float)rng.next());
      b.bounces = 0;
      b.life = 0;
      b.alpha = 1;
      b.scored = false;
      b.inNet = false;
      b.tn = 0;
      return;
    }
  }

  void updateBall(Ball& b, float dt) {
    b.t += dt;
    b.life += dt;
    float s = dt / 1000;
    switch (b.phase) {
      case FLY: {
        float u = std::min(1.0f, b.t / FLIGHT_MS);
        b.x = b.x0 + (b.x1 - b.x0) * u;
        b.g = b.g0 + (b.g1 - b.g0) * u;
        b.z = b.z0 + (b.z1 - b.z0) * u + 4 * ARC_H * u * (1 - u);
        if (u >= 1) arrive(b);
        break;
      }
      case RATTLE: {
        float u = std::min(1.0f, b.t / 380);
        float face = b.s >= 0 ? sh_[b.s].face : 1.0f;
        float a = b.ra + u * PI_F * 1.2f * face;
        float rr = RIM_R - 10;
        b.x = hx_ + std::cos(a) * rr;
        b.g = HOOP_GY + std::sin(a) * rr * COSB;
        b.z = RIM_Z + 6 + std::fabs(std::sin(u * PI_F * 2)) * 22 * (1 - u);
        if (u >= 1) drop(b, 0.75f);
        break;
      }
      case BANKP: {
        float u = std::min(1.0f, b.t / 220);
        b.x = b.x1 + (hx_ - b.x1) * u;
        b.g = b.g1 + (HOOP_GY - b.g1) * u;
        b.z = b.z1 + (RIM_Z + 4 - b.z1) * u + std::sin(u * PI_F) * 10;
        if (u >= 1) drop(b, 0.8f);
        break;
      }
      case DROP:
        b.vz -= GRAVITY * s;
        b.z += b.vz * s;
        if (b.z > RIM_Z - 100) {
          b.x += (hx_ - b.x) * std::min(1.0f, s * 12);
          b.g += (HOOP_GY - b.g) * std::min(1.0f, s * 12);
        } else {
          b.inNet = false;
          b.vx = ((float)rng.next() - 0.5f) * 60;
          b.vg = 40 + (float)rng.next() * 50;
          b.phase = LOOSE;
        }
        break;
      case LOOSE:
        b.vz -= GRAVITY * s;
        b.x += b.vx * s;
        b.g += b.vg * s;
        b.z += b.vz * s;
        if (b.z <= 0) {
          b.z = 0;
          if (b.vz < -160 && b.bounces < 3) {
            b.vz = -b.vz * 0.52f;
            b.vx *= 0.78f;
            b.vg *= 0.78f;
            b.bounces++;
          } else {
            b.vz = 0;
            b.vx *= 1 - std::min(1.0f, s * 3);
            b.vg *= 1 - std::min(1.0f, s * 3);
          }
        }
        if (b.life > 1900) {
          b.alpha = std::max(0.0f, 1 - (b.life - 1900) / 300);
          if (b.alpha <= 0) {
            b.on = false;
            b.s = -1;
          }
        }
        break;
    }
    b.rot += b.spin * s * 180 / PI_F;
  }

  // The ball reaches the hoop: what happens next depends on the shot.
  void arrive(Ball& b) {
    float side = b.s >= 0 ? (sh_[b.s].x < HOOP_X ? -1.0f : 1.0f) : 1.0f;
    float wx = (hx_ + side * 96) * K, wy = (RIM_SY - 70) * K;
    b.t = 0;
    switch (b.outcome) {
      case SWISH:
        drop(b, 1);
        break;
      case RIM_IN:
        b.phase = RATTLE;
        b.ra = std::atan2((b.g - HOOP_GY) / COSB, b.x - hx_);
        clank(0.55f);
        break;
      case BANK:
        b.phase = BANKP;
        b.x1 = b.x;
        b.g1 = b.g;
        b.z1 = b.z;
        boardT_ = 180;
        pop("OFF THE GLASS!", wx, wy, Color::hex(0x7fdcff), 16, 0.8f);
        break;
      case RIM_OUT: {
        clank(1);
        float ox = b.x - hx_, od = (b.g - HOOP_GY) / COSB, m = std::hypot(ox, od);
        if (m == 0) m = 1;
        loose(b, ox / m * 230, od / m * 230 * COSB, 280);
        pop("RIMMED OUT", wx, wy, Color::hex(0xc9d2dc), 16, 0.8f);
        missed(b);
        break;
      }
      case BOARD_OUT:
        boardT_ = 180;
        loose(b, (b.x - hx_) * 1.5f, 240 * COSB, 120);
        pop("OFF THE BOARD", wx, wy, Color::hex(0xc9d2dc), 16, 0.8f);
        missed(b);
        break;
      default: {
        const float T = FLIGHT_MS / 1000;
        loose(b, (b.x1 - b.x0) / T, (b.g1 - b.g0) / T, (b.z1 - b.z0 - 4 * ARC_H) / T);
        pop(b.outcome == SHORT ? "SHORT!" : "WIDE!", wx, wy + 18, Color::hex(0xc9d2dc), 16, 0.8f);
        missed(b);
        break;
      }
    }
  }

  void loose(Ball& b, float vx, float vg, float vz) {
    b.phase = LOOSE;
    b.vx = vx;
    b.vg = vg;
    b.vz = vz;
    b.life = std::min(b.life, 900.0f);
  }

  void drop(Ball& b, float strength) {
    b.phase = DROP;
    b.t = 0;
    b.inNet = true;
    b.vz = -260;
    b.x = hx_ + (b.x - hx_) * 0.5f;
    netK_ = std::max(netK_, strength);
    netT_ = 0;
    scoreBall(b);
  }

  void clank(float amount) {
    rimT_ = 160;
    app.audio.sfx("bump", 0.35f * amount + 0.15f);
  }

  void missed(Ball& b) {
    if (b.s >= 0) sh_[b.s].streak = 0;
  }

  // A basket: points, words, the crowd.
  void scoreBall(Ball& b) {
    if (b.scored || b.s < 0) return;
    b.scored = true;
    Shooter& s = sh_[b.s];
    score_[b.s] += b.points;
    s.streak++;
    s.emoteT = 700;
    bool swish = b.outcome == SWISH;
    float side = s.x < HOOP_X ? -1.0f : 1.0f;
    float bx = hx_ * K, by = RIM_SY * K;
    if (swish) pop("SWISH!", bx + side * 50, by - 36, Color::hex(0xffc93a), 22, 0.9f);
    pop("+" + std::to_string(b.points), bx + side * 28, by - 6, color(b.s), 22, 0.9f);
    if (s.streak >= 3 && s.streak % 2 == 1) pop("HOT HAND!", s.x * K, s.gy * K - 130, Color::hex(0xff8a5c), 18, 1.0f);
    app.audio.sfx("coin", 0.8f);
  }

  // --- CPU ---
  // Where to stop the meter now starting: its read of the zone plus its error.
  void cpuArm(int i) {
    if (!isCpu(i)) return;
    Shooter& s = sh_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    float sigma = 0.45f + 1.0f * sk.aimNoise;
    float e = gauss(rng) * sigma;
    if (rng.next() < sk.mistake) e += (rng.next() < 0.5 ? -1.0f : 1.0f) * (1.4f + 1.6f * (float)rng.next());
    s.goal = e;
    s.readyAt = sk.reaction * (0.6f + 0.8f * (float)rng.next());
    s.last = s.stage == AIM ? s.aVal : s.pVal;
  }

  bool cpuPress(int i) {
    Shooter& s = sh_[i];
    if (s.stage != POWER && s.stage != AIM) return false;
    bool aiming = s.stage == AIM;
    float v = aiming ? s.aVal : s.pVal;
    float goal = aiming ? clampf(s.aTarget + s.goal * AIM_MAKE, -0.97f, 0.97f) : clampf(s.pTarget + s.goal * POWER_MAKE, 0.03f, 0.97f);
    bool crossed = (s.last - goal) * (v - goal) <= 0 && s.last != v;
    s.last = v;
    return s.t >= s.readyAt && crossed;
  }

  // --- Frame ---
  void update(float dt) override {
    float dms = dt * 1000;
    if (!started_) {
      started_ = true;
      for (int i = 0; i < count(); i++) beginPower(i);
    }
    ms_ += dms;
    if (!bonus_ && ms_ >= ROUND_MS - FINAL_MS) {
      bonus_ = true;
      slideAt_ = ms_;
      bannerT_ = 1.8f;
      app.audio.sfx("fanfare", 0.6f);
    }
    bannerT_ -= dt;
    hx_ = hoopXAt(ms_, slideAt_);
    for (int i = 0; i < count(); i++) {
      updateShooter(i, dms);
      Shooter& s = sh_[i];
      s.emoteT -= dms;
      const char* want = s.stage == THROW ? "throw" : (s.holding ? "carry" : (s.emoteT > 0 ? "celebrate" : "idle"));
      if (want != s.anim) {
        s.anim = want;
        s.animT = 0;
      }
      s.animT += dt;
    }
    for (auto& b : balls_)
      if (b.on) updateBall(b, dms);
    netT_ += dms;
    netK_ = std::max(0.0f, netK_ - dms / 520);
    rimT_ = std::max(0.0f, rimT_ - dms);
    boardT_ = std::max(0.0f, boardT_ - dms);
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
  }

  // --- Drawing ---
  void drawBall(Ball& b, bool trail) {
    float sx = b.x * K, sy = (b.g - b.z * SINB) * K;
    if (trail) {
      for (int k = 7; k > 0; k--) {
        b.trx[k] = b.trx[k - 1];
        b.try_[k] = b.try_[k - 1];
      }
      b.trx[0] = sx;
      b.try_[0] = sy;
      b.tn = std::min(8, b.tn + 1);
      Color c = b.golden ? Color::hex(0xffd23a) : color(std::max(0, b.s));
      for (int k = 1; k < b.tn; k++) {
        float f = 1 - k / 8.0f;
        app.gfx.line(b.trx[k - 1], b.try_[k - 1], b.trx[k], b.try_[k], 7 * f + 1, c.alpha(0.45f * f));
      }
    } else {
      b.tn = 0;
    }
    Tex* t = app.gfx.tex(b.golden ? "mg/capitol_ball_gold.png" : "mg/capitol_ball.png");
    SDL_Rect src{0, 0, t->w, t->h};
    float sc = 2 * BALL_R * K / t->w;
    app.gfx.sprite(t, src, sx, sy, sc, sc, 0.5f, 0.5f, b.rot, false, col::white.alpha(b.alpha));
  }

  void netRing(int L, float r, float y, float dx, float off) {
    for (int i = 0; i < NET_N; i++) {
      float a = (i + off) / NET_N * PI_F * 2;
      nx_[L][i] = (hx_ + dx + std::cos(a) * r) * K;
      ny_[L][i] = (y + std::sin(a) * r * COSB) * K;
    }
  }

  void drawNet(bool frontHalf) {
    if (!frontHalf) {
      float k = netK_;
      float sway = std::sin(netT_ / 70) * 7 * k;
      float drop = NET_DROP + 26 * k;
      netRing(0, RIM_R, RIM_SY, 0, 0);
      netRing(1, RIM_R * (0.8f + 0.22f * k), RIM_SY + drop * 0.48f, sway * 0.5f, 0.5f);
      netRing(2, RIM_R * (0.56f + 0.34f * k), RIM_SY + drop, sway, 0);
    }
    Color c = frontHalf ? Color(255, 255, 255, 230) : Color(225, 230, 238, 150);
    for (int i = 0; i < NET_N; i++) {
      int j = (i + 1) % NET_N;
      float midA = (i + 0.5f) / NET_N * PI_F * 2;
      if ((std::sin(midA) >= 0) != frontHalf) continue;
      app.gfx.line(nx_[0][i], ny_[0][i], nx_[1][i], ny_[1][i], 1.2f, c);
      app.gfx.line(nx_[0][j], ny_[0][j], nx_[1][i], ny_[1][i], 1.2f, c);
      app.gfx.line(nx_[1][i], ny_[1][i], nx_[2][i], ny_[2][i], 1.2f, c);
      app.gfx.line(nx_[1][i], ny_[1][i], nx_[2][j], ny_[2][j], 1.2f, c);
      app.gfx.line(nx_[2][i], ny_[2][i], nx_[2][j], ny_[2][j], 1.2f, c);
    }
  }

  void drawShooter(int i) {
    const Shooter& s = sh_[i];
    float x = s.x * K, y = s.gy * K;
    // the ball rack beside the spot
    float rx = (s.x - s.face * 70) * K;
    app.gfx.ellipse(rx, y + 4, 26, 6, Color(10, 17, 32, 70));
    app.gfx.rect(rx - 25, y - 1, 50, 4, Color::hex(0x6b6f7a));
    app.gfx.rect(rx - 24, y - 1, 48, 1.5f, Color::hex(0xc9ced8));
    Tex* bt = app.gfx.tex("mg/capitol_ball.png");
    Tex* gt = app.gfx.tex("mg/capitol_ball_gold.png");
    SDL_Rect src{0, 0, bt->w, bt->h};
    for (int k = 0; k < RACK; k++) {
      if (!s.rack[k]) continue;
      float sc = 24 * K / bt->w;
      app.gfx.sprite(k == RACK - 1 ? gt : bt, src, rx + (k - 2) * 22 * K * -s.face, y - 12 * K, sc, sc);
    }
    spr::shadow(x, y, 40);
    spr::character(player(i).character, s.anim, s.animT, x, y + jumpY(s) * K, CHAR_SCALE, s.face < 0);
    if (s.holding && s.stage != READY) {
      Tex* t = s.golden ? gt : bt;
      float sc = 2 * BALL_R * K / t->w;
      app.gfx.sprite(t, src, handX(s) * K, handY(s) * K, sc, sc);
    }
    drawPlayerTag(i, x, y - 76);
  }

  // Power gauge beside the shooter and the aim bar over their head (only while in use).
  void drawMeters(int i) {
    const Shooter& s = sh_[i];
    bool showPower = s.stage == POWER || s.stage == AIM || (s.stage == THROW && s.fade > 0);
    if (!showPower || finished()) return;
    float alpha = s.stage == THROW ? s.fade : 1.0f;
    Color pc = color(i);
    bool gold = s.golden;
    const float w = 36 * K, h = 226 * K;
    float gx = (s.x + s.side * 88) * K, top = (s.gy - 26) * K - h, bot = top + h;
    app.gfx.panel(gx - w / 2 - 3, top - 3, w + 6, h + 6, (gold ? Color::hex(0xb8860b) : pc).alpha(alpha), 7);
    app.gfx.panel(gx - w / 2, top, w, h, Color(16, 24, 40, (unsigned char)(230 * alpha)), 5);
    float pT = s.stage == POWER ? s.pTarget : s.pShown;
    app.gfx.rect(gx - w / 2, bot - (pT + POWER_MAKE) * h, w, 2 * POWER_MAKE * h, Color(62, 195, 92, (unsigned char)(230 * alpha)));
    app.gfx.rect(gx - w / 2, bot - (pT + POWER_SWISH) * h, w, 2 * POWER_SWISH * h, Color(234, 255, 208, (unsigned char)(255 * alpha)));
    float pv = s.stage == POWER ? s.pVal : s.pLock;
    float my = bot - pv * h;
    Color mc = (s.stage != POWER && s.flash > 0) ? s.flashCol : (gold ? Color::hex(0xffd23a) : col::white);
    app.gfx.rect(gx - w / 2 - 4, my - 2, w + 8, 4, Color(10, 17, 32, (unsigned char)(160 * alpha)));
    app.gfx.rect(gx - w / 2 - 4, my - 1.5f, w + 8, 3, mc.alpha(alpha));
    if (s.stage == POWER && !isCpu(i)) drawPrompt(gx, top - 14);
    if (s.stage == POWER) return;
    // the aim needle bar above the head
    const float bw = 250 * K, bh = 30 * K, half = bw / 2;
    float cx = s.x * K, cy = s.gy * K - 66 * CHAR_SCALE - 92 * K;
    app.gfx.panel(cx - half - 3, cy - bh / 2 - 3, bw + 6, bh + 6, (gold ? Color::hex(0xb8860b) : pc).alpha(alpha), 7);
    app.gfx.panel(cx - half, cy - bh / 2, bw, bh, Color(16, 24, 40, (unsigned char)(230 * alpha)), 5);
    float aT = s.aTarget, a0 = std::max(-1.0f, aT - AIM_MAKE), a1 = std::min(1.0f, aT + AIM_MAKE);
    app.gfx.rect(cx + a0 * half, cy - bh / 2, (a1 - a0) * half, bh, Color(62, 195, 92, (unsigned char)(230 * alpha)));
    app.gfx.rect(cx + (aT - AIM_SWISH) * half, cy - bh / 2, AIM_SWISH * bw, bh, Color(234, 255, 208, (unsigned char)(255 * alpha)));
    float nxp = cx + s.aVal * half;
    Color nc = (s.stage == THROW && s.flash > 0) ? s.flashCol : (gold ? Color::hex(0xffd23a) : col::white);
    app.gfx.rect(nxp - 2, cy - bh / 2 - 4, 4, bh + 8, Color(10, 17, 32, (unsigned char)(160 * alpha)));
    app.gfx.rect(nxp - 1.5f, cy - bh / 2 - 4, 3, bh + 8, nc.alpha(alpha));
    if (s.stage == AIM && !isCpu(i)) drawPrompt(cx + s.side * (half + 18), cy);
  }

  void drawPrompt(float x, float y) {
    float k = 1 + 0.12f * std::sin(ms_ / 120);
    app.gfx.circle(x, y, 10 * k, Color::hex(0x2fb84a));
    app.gfx.text("A", x, y - 8, 15, col::white, CENTER, false);
  }

  void draw() override {
    drawArena();
    if (bonus_) {
      float a = 0.35f + 0.25f * std::sin(ms_ / 140);
      app.gfx.panel((HOOP_X - SLIDE_AMP - 90) * K, (HOOP_GY - 118 * COSB - 10) * K, (2 * SLIDE_AMP + 180) * K, 20 * K, Color(255, 224, 138, (unsigned char)(255 * a)), 4);
    }
    // ball shadows on the ground
    for (const auto& b : balls_) {
      if (!b.on) continue;
      float k = std::max(0.35f, 1 - b.z / 700);
      app.gfx.ellipse(b.x * K, b.g * K, 9 * k, 3.2f * k, Color(10, 17, 32, (unsigned char)(110 * b.alpha)));
    }
    // the hoop: backboard and pole, the net's back, balls in the net, the net's front, the rim
    Tex* hoop = app.gfx.tex("mg/capitol_hoop.png");
    SDL_Rect hs{0, 0, hoop->w, hoop->h};
    app.gfx.sprite(hoop, hs, hx_ * K, HOOP_GY * K - (boardT_ > 0 ? 1 : 0), 1, 1, 180.0f / 540, 410.0f / 440);
    drawNet(false);
    for (auto& b : balls_)
      if (b.on && b.inNet) drawBall(b, false);
    drawNet(true);
    Tex* rim = app.gfx.tex("mg/capitol_rim.png");
    SDL_Rect rs{0, 0, rim->w, rim->h};
    app.gfx.sprite(rim, rs, hx_ * K, RIM_SY * K + (rimT_ > 0 ? 1.5f : 0), 1, 1, 0.5f, 27.0f / 60);
    for (auto& b : balls_)
      if (b.on && (b.phase == RATTLE || b.phase == BANKP)) drawBall(b, false);
    // shooters and loose balls, back to front
    order_.clear();
    for (int i = 0; i < count(); i++) order_.push_back({sh_[i].gy, i});
    for (int k = 0; k < (int)balls_.size(); k++)
      if (balls_[k].on && balls_[k].phase == LOOSE) order_.push_back({balls_[k].g, 100 + k});
    std::sort(order_.begin(), order_.end());
    for (auto& o : order_) {
      if (o.second < 100) drawShooter(o.second);
      else drawBall(balls_[o.second - 100], false);
    }
    for (auto& b : balls_)
      if (b.on && b.phase == FLY) drawBall(b, true);
    for (int i = 0; i < count(); i++) drawMeters(i);
    for (const auto& p : pops_) {
      float k = p.t / p.life;
      float a = k < 0.7f ? 1.0f : 1 - (k - 0.7f) / 0.3f;
      app.gfx.text(p.text, p.x, p.y - 22 * easeOut(std::min(1.0f, k * 2)), p.size, p.c.alpha(a), CENTER, true);
    }
    if (bannerT_ > 0) {
      float a = std::min(1.0f, bannerT_ / 0.3f);
      app.gfx.panel(VW / 2 - 190, 60, 380, 44, Color::hex(0xee7a2f).alpha(0.92f * a), 22);
      app.gfx.text("MOVING HOOP! +1 A BASKET", VW / 2, 68, 26, col::white.alpha(a), CENTER, true);
    }
    drawTimer((ROUND_MS - ms_) / 1000);
    drawScores(score_, "pts");
  }

  bool finished() const override { return ms_ >= ROUND_MS; }
  std::vector<int> scores() const override { return score_; }
  std::string scoreLabel(int i) const override { return std::to_string(score_[i]) + " points"; }

 private:
  std::vector<Shooter> sh_;
  std::vector<Ball> balls_;
  std::vector<Pop> pops_;
  std::vector<int> score_;
  std::vector<std::pair<float, int>> order_;
  float nx_[3][NET_N] = {}, ny_[3][NET_N] = {};
  float ms_ = 0, hx_ = HOOP_X, slideAt_ = -1, bannerT_ = 0;
  float netK_ = 0, netT_ = 0, rimT_ = 0, boardT_ = 0;
  bool bonus_ = false, started_ = false;
};

}  // namespace

REGISTER_MINIGAME("free-throw", FreeThrow);

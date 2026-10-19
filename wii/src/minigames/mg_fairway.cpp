// Fairway Frenzy (Capitol Gardens): pitch and putt on a rolling green. The stick turns the aim; hold A to power
// up and let go to hit. The tee shot is a chip that rides the wind, then the ball rolls with the slopes (dots
// drifting downhill show them); off the tee you putt on the green and chip from the rough or sand. Hole out in 1
// stroke for 5, 2 for 3, 3 for 2 (then a fresh ball at the tee); when a hole's time runs out the ball resting
// closest to the pin scores 2. Three holes; the last 10 seconds score double.
// (Port of src/game/worlds/capitol/games/Fairway.ts + fairwayRules.ts.)
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
// The green is seen from 55 degrees up: world y (depth) is squashed by COSB on screen, heights lift by SINB.
constexpr float COSB = 0.8191520f, SINB = 0.5735764f;

// --- Rules (fairwayRules.ts): world px (x = screen x, y = depth), seconds ---
constexpr float GREEN_CX = 960, GREEN_CY = 616, GREEN_RX = 500, GREEN_RY = 255, FRINGE_K = 1.075f;
constexpr float BOUNDS_CX = 960, BOUNDS_CY = 616, BOUNDS_RX = 830, BOUNDS_RY = 410;
struct Ell {
  float cx, cy, rx, ry;
};
const Ell BUNKERS[2] = {{505, 862, 104, 50}, {1425, 364, 110, 50}};
struct Bump {
  float x, sy, amp, sx, sw;
};
const Bump BUMPS[4] = {{700, 520, 16, 190, 150}, {1215, 700, -14, 220, 160}, {990, 440, 9, 300, 110}, {820, 790, -8, 160, 120}};
constexpr float TILT = 0.018f, G_SLOPE = 1000, STOP_V = 7;
constexpr float BALL_R = 9, CUP_R = 16, CAPTURE_V = 225, CAPTURE_R = CUP_R - 3, DUNK_R = CUP_R - 6;
constexpr float BITE = 0.5f, BOUNCE_TURN = 0.34f, BOUNCE_SPEED = 0.24f, WIND_ACCEL = 40;
constexpr int MAX_STROKES = 3, CLOSEST_POINTS = 2;
constexpr float ROUND_MS = 50000, FINAL_MS = 10000;
struct Window {
  float start, end;
};
const Window HOLES[3] = {{0, 15500}, {17000, 32500}, {34000, 50000}};
const float CUPS[3][2] = {{960, 616}, {1070, 660}, {850, 575}};
constexpr float TEE_DIST = 540;
const float TEE_ANGLES[4] = {205, 335, 155, 25};

// --- Scene (Fairway.ts) ---
constexpr float CHAR_SCALE = 0.85f;
constexpr float AIM_RATE = 1.35f, POWER_MS = 1100, SUB = 1.0f / 120, RUN_SPEED = 720, RESPAWN_MS = 1000;
// CPU shot search: a coarse sweep of aims x powers then a finer one; a few simulations a frame (Wii CPU budget)
constexpr int NA0 = 9, NP0 = 13, SIMS_PER_CPU = 4, SIMS_PER_FRAME = 12;

enum Surface { GREEN, FRINGE, ROUGH, SAND };
enum Kind { CHIP, PUTT };

struct Vec {
  float x, y;
};

struct Skill {
  float accuracy, mistake, aimNoise, think;
};
const Skill SKILL[3] = {{0.55f, 0.24f, 0.55f, 700}, {0.78f, 0.11f, 0.28f, 420}, {0.9f, 0.05f, 0.13f, 240}};

float outlineK(float a) { return 1 + 0.05f * std::sin(3 * a + 0.6f) + 0.035f * std::sin(5 * a + 2.1f); }

Surface surfaceAt(float x, float y) {
  float sy = y * COSB;
  for (const auto& b : BUNKERS) {
    float dx = (x - b.cx) / b.rx, dy = (sy - b.cy) / b.ry;
    if (dx * dx + dy * dy <= 1) return SAND;
  }
  float dx = (x - GREEN_CX) / GREEN_RX, dy = (sy - GREEN_CY) / GREEN_RY;
  float r = std::sqrt(dx * dx + dy * dy), k = outlineK(std::atan2(dy, dx));
  if (r <= k) return GREEN;
  if (r <= k * FRINGE_K) return FRINGE;
  return ROUGH;
}

float friction(Surface s) { return s == GREEN ? 190.0f : (s == FRINGE ? 330.0f : (s == ROUGH ? 560.0f : 1500.0f)); }

Vec gradAt(float x, float y) {
  float gx = 0, gy = -TILT;
  for (const auto& b : BUMPS) {
    float sw = b.sw / COSB, dx = x - b.x, dy = y - b.sy / COSB;
    float e = b.amp * std::exp(-0.5f * ((dx * dx) / (b.sx * b.sx) + (dy * dy) / (sw * sw)));
    gx -= e * dx / (b.sx * b.sx);
    gy -= e * dy / (sw * sw);
  }
  return {gx, gy};
}

float chipCarry(float p) { return 60 + p * 720; }
float chipTime(float c) { return 0.5f + c / 1500; }
float chipApex(float c) { return 40 + c * 0.32f; }
float puttDistance(float p) { return 20 + p * 700; }
float puttSpeed(float p) { return std::sqrt(2 * friction(GREEN) * puttDistance(p)); }

struct RollBall {
  float x, y, vx, vy;
};

// The lawn's edge: a ball rolling off it is turned back in, losing most of its speed.
template <typename B>
void keepInBounds(B& b) {
  float dx = (b.x - BOUNDS_CX) / BOUNDS_RX, dy = (b.y * COSB - BOUNDS_CY) / BOUNDS_RY;
  float r = std::sqrt(dx * dx + dy * dy);
  if (r <= 1) return;
  b.x = BOUNDS_CX + dx / r * BOUNDS_RX;
  b.y = (BOUNDS_CY + dy / r * BOUNDS_RY) / COSB;
  float nx = dx / BOUNDS_RX, ny = dy / BOUNDS_RY * COSB, nl = std::hypot(nx, ny);
  if (nl == 0) nl = 1;
  nx /= nl;
  ny /= nl;
  float vn = b.vx * nx + b.vy * ny;
  if (vn > 0) {
    b.vx = (b.vx - 1.3f * vn * nx) * 0.5f;
    b.vy = (b.vy - 1.3f * vn * ny) * 0.5f;
  }
}

// One rolling step: the slope's pull, rolling friction for the surface, the lawn's edge. False once at rest.
template <typename B>
bool rollStep(B& b, float dt, float slopeK = 1) {
  Vec g = gradAt(b.x, b.y);
  float ax = -G_SLOPE * slopeK * g.x, ay = -G_SLOPE * slopeK * g.y;
  float f = friction(surfaceAt(b.x, b.y));
  float sp = std::hypot(b.vx, b.vy);
  if (sp < STOP_V && std::hypot(ax, ay) < f) {
    b.vx = b.vy = 0;
    return false;
  }
  b.vx += ax * dt;
  b.vy += ay * dt;
  float sp2 = std::hypot(b.vx, b.vy), dec = f * dt;
  if (sp2 <= dec) {
    b.vx = b.vy = 0;
  } else {
    b.vx -= b.vx / sp2 * dec;
    b.vy -= b.vy / sp2 * dec;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  keepInBounds(b);
  return true;
}

Kind shotKind(int strokes, float x, float y) {
  if (strokes == 0) return CHIP;
  Surface s = surfaceAt(x, y);
  return s == GREEN || s == FRINGE ? PUTT : CHIP;
}

struct SimResult {
  bool holed;
  float x, y, t;
};

// Where a shot ends up (ignoring the other balls), the green read through slopeK and windK (1 = a perfect read).
SimResult simulateShot(float x, float y, Kind kind, float angle, float power, Vec wind, Vec cup, float slopeK, float windK, float step) {
  float dx = std::cos(angle), dy = std::sin(angle), t = 0;
  RollBall sim;
  if (kind == CHIP) {
    float C = chipCarry(power), T = chipTime(C), v = C / T;
    float wx = wind.x * windK, wy = wind.y * windK;
    sim.x = x + dx * C + 0.5f * wx * T * T;
    sim.y = y + dy * C + 0.5f * wy * T * T;
    sim.vx = (dx * v + wx * T) * BITE;
    sim.vy = (dy * v + wy * T) * BITE;
    t = T;
    if (std::hypot(sim.x - cup.x, sim.y - cup.y) < DUNK_R) return {true, cup.x, cup.y, t};
    keepInBounds(sim);
  } else {
    float v = puttSpeed(power);
    sim = {x, y, dx * v, dy * v};
  }
  for (int i = 0; i < 600; i++) {
    bool moving = rollStep(sim, step, slopeK);
    t += step;
    if (std::hypot(sim.x - cup.x, sim.y - cup.y) < CAPTURE_R && std::hypot(sim.vx, sim.vy) < CAPTURE_V) return {true, cup.x, cup.y, t};
    if (!moving) break;
  }
  return {false, sim.x, sim.y, t};
}

int holePoints(int strokes, bool dbl) {
  int base = strokes <= 1 ? 5 : (strokes == 2 ? 3 : (strokes == 3 ? 2 : 0));
  return base * (dbl ? 2 : 1);
}

Vec cupOf(int h) { return {CUPS[h][0], CUPS[h][1] / COSB}; }
Vec teeOf(int h, int i) {
  Vec c = cupOf(h);
  float a = TEE_ANGLES[(i + h) % 4] * PI_F / 180;
  return {c.x + std::cos(a) * TEE_DIST, c.y + std::sin(a) * TEE_DIST};
}

float pingPong(float u) {
  float m = std::fmod(std::fmod(u, 2.0f) + 2.0f, 2.0f);
  return m <= 1 ? m : 2 - m;
}
float angleDiff(float a, float b) {
  float d = std::fmod(a - b, PI_F * 2);
  if (d > PI_F) d -= PI_F * 2;
  if (d <= -PI_F) d += PI_F * 2;
  return d;
}
float gauss(Random& r) {
  float u = std::max(1e-6f, (float)r.next());
  return std::sqrt(-2 * std::log(u)) * std::cos(PI_F * 2 * (float)r.next());
}

enum GState { WAIT, WALK, ADDRESS, CHARGE, SWING, WATCH };

struct GBall {
  float x = 0, y = 0, vx = 0, vy = 0;
  bool air = false;
  float z = 0, at = 0, ax0 = 0, ay0 = 0, avx = 0, avy = 0, aT = 1, apex = 0;
  bool moving = false, holed = false, hidden = false;
  float lipT = 0, hop = 0, goneT = 0, spawnT = 0;
  std::array<float, 8> trx{}, try_{};
  int tn = 0;
};

// The CPU's shot search in progress (spread over frames).
struct Search {
  bool active = false;
  Kind kind = CHIP;
  float x = 0, y = 0, readK = 1;
  int pass = 0, i = 0, j = 0;
  float base = 0, a0 = 0, p0 = 0.5f, bestA = 0, bestP = 0.5f, bestS = -1e30f;
};

struct Golfer {
  GBall ball;
  GState state = WAIT;
  float t = 0, aim = 0, power = 0, chargeT = 0;
  int strokes = 0;
  float face = 1;
  float cx = 0, cy = 0, walkX = 0, walkY = 0;  // character feet, web screen px
  float swingK = 0, respawnT = 0;
  float mx = 0;
  bool held = false, pressed = false;
  const char* anim = "idle";
  float animT = 0, animRet = 0;
  // CPU
  bool hasPlan = false;
  float planA = 0, planP = 0;
  Search search;
  float thinkT = 0, last = 0;
};

struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size;
};

struct Dot {
  float x, y, dx, dy, k;
};

struct Gust {
  float x, y, dx, dy, t, life, len;
};

class Fairway : public Minigame {
 public:
  void start() override {
    // the slopes made visible: dots over the green that drift slowly downhill
    const float step = 78;
    for (float sy = GREEN_CY - GREEN_RY; sy <= GREEN_CY + GREEN_RY; sy += step * 0.8f)
      for (float x = GREEN_CX - GREEN_RX; x <= GREEN_CX + GREEN_RX; x += step) {
        float ox = x + ((int)std::lround(sy / step) % 2) * step / 2;
        float y = sy / COSB;
        if (surfaceAt(ox, y) != GREEN) continue;
        Vec g = gradAt(ox, y);
        float ax = -g.x, ay = -g.y, m = std::hypot(ax, ay);
        if (m < 1e-4f) continue;
        dots_.push_back({ox, sy, ax / m, ay / m * COSB, std::min(1.0f, m / 0.05f)});
      }
    for (int i = 0; i < count(); i++) gf_.emplace_back();
    score_.assign(count(), 0);
    setupHole(0, true);
  }

  void pop(const std::string& s, float x, float y, Color c, int size = 18, float life = 0.9f) { pops_.push_back({s, x * K, y * K, 0, life, c, size}); }
  void banner(const std::string& s, Color c) {
    bannerText_ = s;
    bannerCol_ = c;
    bannerT_ = 1.4f;
  }
  void play(Golfer& g, const char* a, float ret = 0) {
    g.anim = a;
    g.animT = 0;
    g.animRet = ret;
  }

  // --- Holes ---
  void setupHole(int h, bool first = false) {
    hole_ = h;
    cup_ = cupOf(h);
    wAngle_ = (float)rng.next() * PI_F * 2;
    wStrength_ = h == 2 ? 2 + (int)(rng.next() * 2) : (int)(rng.next() * 3.2);
    wind_ = {std::cos(wAngle_) * wStrength_ * WIND_ACCEL, std::sin(wAngle_) * wStrength_ * WIND_ACCEL};
    closestDone_ = -1;
    float cx = cup_.x, cy = cup_.y * COSB;
    if (first) {
      flagFromX_ = flagToX_ = cx;
      flagFromY_ = flagToY_ = cy;
      flagT_ = 1;
    } else {
      flagFromX_ = flagX();
      flagFromY_ = flagY();
      flagToX_ = cx;
      flagToY_ = cy;
      flagT_ = 0;
    }
    for (int i = 0; i < count(); i++) {
      resetBall(i, true);
      if (first) {
        Golfer& g = gf_[i];
        g.aim = std::atan2(cup_.y - g.ball.y, cup_.x - g.ball.x);
        placeGolfer(g);
      } else {
        snapToTee(i);
      }
    }
  }
  float flagX() const { return lerpf(flagFromX_, flagToX_, easeInOut(std::min(1.0f, flagT_))); }
  float flagY() const { return lerpf(flagFromY_, flagToY_, easeInOut(std::min(1.0f, flagT_))); }

  void resetBall(int i, bool instant) {
    Golfer& g = gf_[i];
    Vec tee = teeOf(hole_, i);
    GBall& b = g.ball;
    b.x = tee.x;
    b.y = tee.y;
    b.vx = b.vy = 0;
    b.air = false;
    b.z = 0;
    b.moving = b.holed = b.hidden = false;
    b.lipT = 0;
    b.tn = 0;
    b.goneT = 0;
    b.spawnT = instant ? 1 : 0;
    g.strokes = 0;
    g.hasPlan = false;
    g.search.active = false;
    if (!instant) walkTo(g);
  }

  void snapToTee(int i) {
    Golfer& g = gf_[i];
    g.aim = std::atan2(cup_.y - g.ball.y, cup_.x - g.ball.x);
    placeGolfer(g);
    g.state = WAIT;
    g.respawnT = 0;
    play(g, "jump", 0.5f);
  }

  // Where the golfer stands to hit: beside the ball, facing the aim.
  Vec standPoint(Golfer& g) {
    float dx = std::cos(g.aim);
    if (std::fabs(dx) > 0.2f) g.face = dx > 0 ? 1.0f : -1.0f;
    return {g.ball.x - g.face * 40, g.ball.y * COSB + 5};
  }
  void placeGolfer(Golfer& g) {
    Vec s = standPoint(g);
    g.cx = s.x;
    g.cy = s.y;
  }
  void walkTo(Golfer& g) {
    g.aim = std::atan2(cup_.y - g.ball.y, cup_.x - g.ball.x);
    Vec s = standPoint(g);
    g.walkX = s.x;
    g.walkY = s.y;
    g.state = WALK;
    g.t = 0;
    play(g, "run");
  }
  void address(int i) {
    Golfer& g = gf_[i];
    g.state = ADDRESS;
    g.t = 0;
    g.power = 0;
    g.chargeT = 0;
    g.aim = std::atan2(cup_.y - g.ball.y, cup_.x - g.ball.x);
    placeGolfer(g);
    play(g, "idle");
    g.hasPlan = false;
    g.search.active = false;
    g.thinkT = SKILL[std::clamp(cpuLevel(i), 0, 2)].think * (0.5f + 0.6f * (float)rng.next());
  }

  void hit(Golfer& g) {
    GBall& b = g.ball;
    Kind kind = shotKind(g.strokes, b.x, b.y);
    g.strokes++;
    g.state = SWING;
    g.t = 0;
    g.swingK = 0;
    play(g, "throw", 0.45f);
    float dx = std::cos(g.aim), dy = std::sin(g.aim);
    if (kind == CHIP) {
      float C = chipCarry(g.power);
      b.aT = chipTime(C);
      b.apex = chipApex(C);
      b.air = true;
      b.at = 0;
      b.ax0 = b.x;
      b.ay0 = b.y;
      b.avx = dx * C / b.aT;
      b.avy = dy * C / b.aT;
      app.audio.sfx("dash", 0.45f);
    } else {
      float v = puttSpeed(g.power);
      b.vx = dx * v;
      b.vy = dy * v;
      app.audio.sfx("move", 0.45f);
    }
    b.moving = true;
  }

  void updateGolfer(int i, float dt) {
    Golfer& g = gf_[i];
    GBall& b = g.ball;
    g.t += dt;
    switch (g.state) {
      case WALK: {
        float dx = g.walkX - g.cx, dy = g.walkY - g.cy, d = std::hypot(dx, dy), step = RUN_SPEED * dt / 1000;
        if (d <= step) {
          g.cx = g.walkX;
          g.cy = g.walkY;
          if (holePlaying_) address(i);
          else {
            g.state = WAIT;
            play(g, "idle");
          }
        } else {
          g.cx += dx / d * step;
          g.cy += dy / d * step;
          if (std::fabs(dx) > 1) g.face = dx > 0 ? 1.0f : -1.0f;
        }
        break;
      }
      case ADDRESS:
      case CHARGE: {
        if (b.moving) {
          g.state = WATCH;
          break;
        }
        float mx = g.mx;
        if (std::fabs(mx) > 0.15f) g.aim += (mx > 0 ? 1 : -1) * std::pow(std::fabs(mx), 1.6f) * AIM_RATE * (dt / 1000);
        if (g.state == ADDRESS) {
          placeGolfer(g);
          if (g.pressed) {
            g.state = CHARGE;
            g.chargeT = 0;
            g.power = 0;
            play(g, "crouch");
            app.audio.sfx("tick", 0.3f);
          }
        } else {
          g.chargeT += dt;
          g.power = pingPong(g.chargeT / POWER_MS);
          placeGolfer(g);
          if (!g.held) hit(g);
        }
        break;
      }
      case SWING:
        g.swingK = std::min(1.0f, g.t / 110);
        if (g.t > 260) g.state = WATCH;
        break;
      case WATCH:
        if (!b.moving && !b.holed) settled(i);
        break;
      case WAIT:
        if (g.respawnT > 0) {
          g.respawnT -= dt;
          if (g.respawnT <= 0 && holePlaying_) resetBall(i, false);
        }
        break;
    }
  }

  // The ball has stopped: out of strokes sends it back to the tee, otherwise walk up for the next one.
  void settled(int i) {
    Golfer& g = gf_[i];
    if (g.strokes >= MAX_STROKES) {
      pop("BACK TO THE TEE", g.ball.x, g.ball.y * COSB - 60, col::white, 14, 0.9f);
      play(g, "disappointed", 0.9f);
      g.ball.hidden = true;
      g.ball.goneT = 0;
      g.state = WAIT;
      g.respawnT = RESPAWN_MS;
      return;
    }
    if (holePlaying_) walkTo(g);
    else g.state = WAIT;
  }

  void stepBalls(float dt) {
    float s = dt / 1000;
    for (int i = 0; i < count(); i++) {
      GBall& b = gf_[i].ball;
      if (!b.air) continue;
      b.at = std::min(b.aT, b.at + s);
      float u = b.at / b.aT;
      b.x = b.ax0 + b.avx * b.at + 0.5f * wind_.x * b.at * b.at;
      b.y = b.ay0 + b.avy * b.at + 0.5f * wind_.y * b.at * b.at;
      b.z = 4 * b.apex * u * (1 - u);
      if (u >= 1) land(i);
    }
    int n = std::max(1, (int)std::ceil(s / SUB));
    float sub = s / n;
    for (int k = 0; k < n; k++) {
      for (int i = 0; i < count(); i++) {
        GBall& b = gf_[i].ball;
        if (!b.moving || b.air || b.holed || b.hidden) continue;
        b.lipT = std::max(0.0f, b.lipT - sub);
        if (!rollStep(b, sub)) {
          b.moving = false;
          continue;
        }
        checkCup(i);
      }
      collideBalls();
    }
  }

  void land(int i) {
    GBall& b = gf_[i].ball;
    b.air = false;
    b.z = 0;
    float T = b.aT;
    b.vx = (b.avx + wind_.x * T) * BITE;
    b.vy = (b.avy + wind_.y * T) * BITE;
    // the landing kick: up to BOUNCE_TURN off line and +-BOUNCE_SPEED
    float a = ((float)rng.next() * 2 - 1) * BOUNCE_TURN, k = 1 + ((float)rng.next() * 2 - 1) * BOUNCE_SPEED;
    float c = std::cos(a), sn = std::sin(a);
    float vx = b.vx * c - b.vy * sn, vy = b.vx * sn + b.vy * c;
    b.vx = vx * k;
    b.vy = vy * k;
    b.hop = 1;
    if (surfaceAt(b.x, b.y) == SAND) pop("SAND!", b.x, b.y * COSB - 50, Color::hex(0xe8c173), 16, 0.7f);
    if (std::hypot(b.x - cup_.x, b.y - cup_.y) < DUNK_R) holeOut(i);
  }

  void checkCup(int i) {
    GBall& b = gf_[i].ball;
    float d = std::hypot(b.x - cup_.x, b.y - cup_.y);
    if (d >= CUP_R) return;
    float sp = std::hypot(b.vx, b.vy);
    if ((d < CAPTURE_R && sp < CAPTURE_V) || sp < 70) {
      holeOut(i);
      return;
    }
    if (b.lipT > 0) return;
    b.lipT = 0.25f;
    float side = (b.x - cup_.x) * b.vy - (b.y - cup_.y) * b.vx >= 0 ? 1.0f : -1.0f;
    float turn = side * (0.35f + 0.5f * (1 - d / CUP_R));
    float cs = std::cos(turn), sn = std::sin(turn);
    float vx = b.vx * cs - b.vy * sn, vy = b.vx * sn + b.vy * cs;
    b.vx = vx * 0.72f;
    b.vy = vy * 0.72f;
    pop("LIPPED OUT", cup_.x + (b.x < cup_.x ? -90 : 90), cup_.y * COSB - 60, Color::hex(0xc9d2dc), 15, 0.8f);
  }

  void collideBalls() {
    const float mn = BALL_R * 2;
    for (int i = 0; i < count(); i++) {
      GBall& a = gf_[i].ball;
      if (a.air || a.holed || a.hidden) continue;
      for (int j = i + 1; j < count(); j++) {
        GBall& b = gf_[j].ball;
        if (b.air || b.holed || b.hidden) continue;
        float dx = b.x - a.x, dy = b.y - a.y, d = std::hypot(dx, dy);
        if (d >= mn || d < 1e-6f) continue;
        float nx = dx / d, ny = dy / d, push = (mn - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        float rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rv <= 0) continue;
        float imp = rv * 0.95f;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
        a.moving = b.moving = true;
        if (rv > 200) pop("KNOCK!", (a.x + b.x) / 2, (a.y + b.y) / 2 * COSB - 50, Color::hex(0xffd0a8), 15, 0.6f);
      }
    }
  }

  // In the cup! Points by this attempt's strokes (the owner's, even if someone else knocked it in).
  void holeOut(int i) {
    Golfer& g = gf_[i];
    GBall& b = g.ball;
    b.holed = true;
    b.moving = b.air = false;
    b.vx = b.vy = 0;
    b.goneT = 0;
    int strokes = std::max(1, g.strokes);
    int pts = holePoints(strokes, double_);
    score_[i] += pts;
    float cx = cup_.x, cy = cup_.y * COSB, side = g.cx < cx ? -1.0f : 1.0f;
    pop(strokes == 1 ? "HOLE IN ONE!" : (strokes == 2 ? "NICE PUTT!" : "IN THE HOLE!"), cx + side * 70, cy - 120, strokes == 1 ? Color::hex(0xffc93a) : Color::hex(0x9be86f), strokes == 1 ? 22 : 18, 1.0f);
    pop("+" + std::to_string(pts), cx + side * 60, cy - 70, color(i), 22, 1.0f);
    app.audio.sfx("coin", 0.8f);
    play(g, strokes <= 2 ? "celebrate" : "cheer", 0.9f);
    g.state = WAIT;
    g.respawnT = RESPAWN_MS;
  }

  void updateHoles() {
    int hole = 2;
    bool playing = false;
    for (int h = 0; h < 3; h++)
      if (ms_ < HOLES[h].end) {
        hole = h;
        playing = ms_ >= HOLES[h].start;
        break;
      }
    if (holePlaying_ && (!playing || hole != hole_)) endHole();
    if (!holePlaying_ && playing) {
      if (hole != hole_) setupHole(hole);
      holePlaying_ = true;
      banner(hole == 2 ? "FINAL HOLE" : "HOLE " + std::to_string(hole + 1), col::gold);
      app.audio.sfx("go", 0.4f);
      for (int i = 0; i < count(); i++)
        if (gf_[i].state == WAIT && !gf_[i].ball.hidden) walkTo(gf_[i]);
    }
  }

  // Time's up on this hole: the ball resting closest to the pin scores, then everyone lines up for the next.
  void endHole() {
    holePlaying_ = false;
    for (auto& g : gf_) {
      GBall& b = g.ball;
      b.vx = b.vy = 0;
      b.air = false;
      b.z = 0;
      b.moving = false;
    }
    awardClosest(hole_);
    for (auto& g : gf_)
      if (g.state == ADDRESS || g.state == CHARGE) {
        g.state = WAIT;
        play(g, "idle");
      }
    if (hole_ + 1 < 3) {
      nextHoleT_ = 900;
      nextHole_ = hole_ + 1;
    }
  }

  void awardClosest(int h) {
    if (closestDone_ == h) return;
    closestDone_ = h;
    int best = -1;
    float bestD = 1e30f;
    for (int i = 0; i < count(); i++) {
      const Golfer& g = gf_[i];
      if (g.ball.holed || g.ball.hidden || g.strokes < 1) continue;
      float d = std::hypot(g.ball.x - cup_.x, g.ball.y - cup_.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    int pts = CLOSEST_POINTS * (double_ ? 2 : 1);
    score_[best] += pts;
    const GBall& b = gf_[best].ball;
    pop("CLOSEST TO THE PIN!", b.x, b.y * COSB - 70, Color::hex(0xffb020), 16, 1.3f);
    pop("+" + std::to_string(pts), b.x, b.y * COSB - 30, color(best), 20, 1.2f);
    tapeT_ = 1.1f;
    tapeX_ = b.x;
    tapeY_ = b.y * COSB;
    tapeCol_ = color(best);
    app.audio.sfx("coin", 0.6f);
  }

  // --- CPU ---
  void cpuInput(int i, float dt, int& budget) {
    Golfer& g = gf_[i];
    g.pressed = false;
    if (g.state != ADDRESS && g.state != CHARGE) {
      g.mx = 0;
      g.held = false;
      return;
    }
    if (g.state == ADDRESS) {
      g.held = false;
      if (!g.hasPlan) {
        if (!g.search.active) beginSearch(i);
        int n = std::min(SIMS_PER_CPU, budget);
        budget -= n;
        if (n > 0 && searchStep(g.search, n)) finishPlan(i);
      }
      g.thinkT -= dt;
      if (g.thinkT > 0 || !g.hasPlan) {
        g.mx = 0;
        return;
      }
      float err = angleDiff(g.planA, g.aim);
      if (std::fabs(err) > 0.008f) {
        float x = clampf(err / 0.25f, -1, 1);
        g.mx = (x > 0 ? 1 : -1) * std::max(0.3f, std::pow(std::fabs(x), 0.625f));
        return;
      }
      g.mx = 0;
      g.held = true;
      g.pressed = true;
      g.last = 0;
      return;
    }
    g.mx = 0;
    if (!g.hasPlan) {
      g.held = false;
      return;
    }
    bool rising = g.power >= g.last;
    bool release = rising && g.power >= g.planP;
    g.last = g.power;
    g.held = !release;
  }

  void beginSearch(int i) {
    Golfer& g = gf_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    Search& S = g.search;
    S.active = true;
    S.kind = shotKind(g.strokes, g.ball.x, g.ball.y);
    S.x = g.ball.x;
    S.y = g.ball.y;
    S.readK = clampf((sk.accuracy - 0.45f) * 1.6f + 0.25f, 0.3f, 1.0f);
    S.pass = S.i = S.j = 0;
    S.base = std::atan2(cup_.y - S.y, cup_.x - S.x);
    S.a0 = S.bestA = S.base;
    S.p0 = S.bestP = 0.5f;
    S.bestS = -1e30f;
  }

  // Simulate up to n candidate shots; true when the search is complete.
  bool searchStep(Search& S, int n) {
    float span = S.kind == CHIP ? 0.35f : 0.42f;
    while (n-- > 0) {
      int na = S.pass == 0 ? NA0 : 5, np = S.pass == 0 ? NP0 : 7;
      float angle = S.pass == 0 ? S.base - span + 2 * span * S.i / (na - 1) : S.a0 + (S.i - 2) * 0.016f;
      float power = S.pass == 0 ? 0.04f + 0.96f * S.j / (np - 1) : clampf(S.p0 + (S.j - 3) * 0.012f, 0.02f, 1.0f);
      SimResult r = simulateShot(S.x, S.y, S.kind, angle, power, wind_, cup_, S.readK, S.readK, S.pass == 0 ? 1.0f / 40 : 1.0f / 60);
      float sc = r.holed ? 10000 - r.t * 10 : -std::hypot(r.x - cup_.x, r.y - cup_.y) - (surfaceAt(r.x, r.y) == SAND ? 160 : 0);
      if (sc > S.bestS) {
        S.bestS = sc;
        S.bestA = angle;
        S.bestP = power;
      }
      if (++S.j >= np) {
        S.j = 0;
        if (++S.i >= na) {
          S.i = 0;
          if (++S.pass >= 2) return true;
          S.a0 = S.bestA;
          S.p0 = S.bestP;
        }
      }
    }
    return false;
  }

  // Spoil the best shot a little by skill: weaker CPUs execute less precisely (and misread the green above).
  void finishPlan(int i) {
    Golfer& g = gf_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    bool chip = g.search.kind == CHIP;
    float angle = g.search.bestA + gauss(rng) * (chip ? 0.014f + sk.aimNoise * 0.12f : sk.aimNoise * 0.085f);
    float power = g.search.bestP + gauss(rng) * (chip ? 0.018f + sk.aimNoise * 0.07f : sk.aimNoise * 0.05f);
    if (rng.next() < sk.mistake) {
      angle += ((float)rng.next() - 0.5f) * 0.3f;
      power += ((float)rng.next() - 0.5f) * 0.3f;
    }
    g.planA = angle;
    g.planP = clampf(power, 0.03f, 0.98f);
    g.hasPlan = true;
    g.search.active = false;
  }

  // --- Frame ---
  void update(float dt) override {
    float dms = dt * 1000;
    if (!started_) {
      started_ = true;
      holePlaying_ = true;
      for (int i = 0; i < count(); i++) address(i);
    }
    ms_ += dms;
    if (!double_ && ms_ >= ROUND_MS - FINAL_MS) {
      double_ = true;
      banner("DOUBLE POINTS!", Color::hex(0xff7a3a));
    }
    if (nextHoleT_ > 0) {
      nextHoleT_ -= dms;
      if (nextHoleT_ <= 0 && hole_ + 1 == nextHole_ && ms_ < ROUND_MS) setupHole(nextHole_);
    }
    int budget = SIMS_PER_FRAME;
    for (int i = 0; i < count(); i++) {
      Golfer& g = gf_[i];
      if (isCpu(i)) cpuInput(i, dms, budget);
      else {
        g.mx = pad(i).x;
        g.held = pad(i).down(B_A);
        g.pressed = pad(i).press(B_A);
      }
    }
    if (ms_ < ROUND_MS) updateHoles();
    for (int i = 0; i < count(); i++) updateGolfer(i, dms);
    stepBalls(dms);
    if (ms_ >= ROUND_MS && holePlaying_) {
      holePlaying_ = false;
      awardClosest(hole_);
    }
    // visuals
    float want = 0;
    for (auto& g : gf_) {
      GBall& b = g.ball;
      b.hop = std::max(0.0f, b.hop - dms / 260);
      b.goneT += dt;
      b.spawnT = std::min(1.0f, b.spawnT + dt / 0.22f);
      g.animT += dt;
      if (g.animRet > 0) {
        g.animRet -= dt;
        if (g.animRet <= 0 && g.state != WALK && g.state != CHARGE) play(g, "idle");
      }
      if (!b.moving || b.air || b.holed) continue;
      float d = std::hypot(b.x - cup_.x, b.y - cup_.y), sp = std::hypot(b.vx, b.vy);
      if (d < 150 && sp < 420) want = std::max(want, (1 - d / 150) * (1 - sp / 420 * 0.5f));
    }
    tension_ += (want - tension_) * std::min(1.0f, dms / 90);
    flagT_ += dt / 0.7f;
    tapeT_ -= dt;
    bannerT_ -= dt;
    // wind streaks across the lawn
    if (wStrength_ >= 1) {
      gustT_ -= dms;
      if (gustT_ <= 0) {
        gustT_ = 600.0f / wStrength_;
        float dx = std::cos(wAngle_), dy = std::sin(wAngle_) * COSB, m = std::hypot(dx, dy);
        gusts_.push_back({300 + (float)rng.next() * 1320, 300 + (float)rng.next() * 600, dx / m, dy / m, 0, 0.9f, 40.0f + wStrength_ * 14});
      }
    }
    for (auto& g : gusts_) {
      g.t += dt;
      g.x += g.dx * (260 + wStrength_ * 90) * dt;
      g.y += g.dy * (260 + wStrength_ * 90) * dt;
    }
    std::erase_if(gusts_, [](const Gust& g) { return g.t >= g.life; });
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
  }

  // --- Drawing ---
  void drawBallItem(int i) {
    Golfer& g = gf_[i];
    GBall& b = g.ball;
    float sx = b.x * K, sy = b.y * COSB * K;
    float lift = (b.z * SINB + std::sin(b.hop * PI_F) * 10 * b.hop) * K;
    Tex* t = app.gfx.tex("mg/capitol_golfball.png");
    SDL_Rect src{0, 0, t->w, t->h};
    float sc = 2 * BALL_R * K * 1.5f / t->w;  // a touch bigger than true size so it reads at 480p
    if (b.holed) {
      float u = std::min(1.0f, b.goneT / 0.17f);
      if (u >= 1) return;
      float x = lerpf(sx, cup_.x * K, u), y = lerpf(sy - 2, cup_.y * COSB * K, u);
      app.gfx.sprite(t, src, x, y, sc * (1 - 0.75f * u), sc * (1 - 0.75f * u), 0.5f, 0.5f, 0, false, col::white.alpha(1 - 0.8f * u));
      return;
    }
    if (b.hidden) {
      float u = std::min(1.0f, b.goneT / 0.22f);
      if (u >= 1) return;
      app.gfx.sprite(t, src, sx, sy - lift - 2, sc * (1 - 0.8f * u), sc * (1 - 0.8f * u), 0.5f, 0.5f, 0, false, col::white.alpha(1 - u));
      return;
    }
    float k = b.spawnT < 1 ? easeBack(b.spawnT) : 1.0f;
    app.gfx.sprite(t, src, sx, sy - lift - 2, sc * k, sc * k);
  }

  void drawGolfer(int i) {
    Golfer& g = gf_[i];
    float x = g.cx * K, y = g.cy * K;
    spr::shadow(x, y, 36);
    spr::character(player(i).character, g.anim, g.animT, x, y, CHAR_SCALE, g.face < 0);
    bool aiming = (g.state == ADDRESS || g.state == CHARGE) && holePlaying_;
    if (aiming || g.state == SWING) {
      // the club, from the hands to the head behind (or through) the ball
      float dx = std::cos(g.aim), dy = std::sin(g.aim) * COSB;
      float bx = g.ball.x, by = g.ball.y * COSB;
      float back = g.state == CHARGE ? g.power * 46 : 0, through = g.state == SWING ? g.swingK * 40 : 0;
      float kx = (bx - dx * (12 + back) + dx * through) * K, ky = (by - dy * (12 + back) + dy * through - 3) * K;
      float hx = x + g.face * 16 * K, hy = y - 52 * K;
      app.gfx.line(hx, hy, kx, ky, 2.6f, Color::hex(0x2a2f3a));
      app.gfx.line(hx, hy, kx, ky, 1.2f, Color::hex(0xc9ced8));
      app.gfx.rect(kx - 4, ky - 1.8f, 8, 3.6f, Color::hex(0x3a3f4a));
    }
    drawPlayerTag(i, x, y - 70);
  }

  // The aim line and landing ring, and the power bar.
  void drawAim(int i) {
    Golfer& g = gf_[i];
    bool aiming = (g.state == ADDRESS || g.state == CHARGE) && holePlaying_ && ms_ < ROUND_MS;
    if (!aiming) return;
    const GBall& b = g.ball;
    Kind kind = shotKind(g.strokes, b.x, b.y);
    float a = isCpu(i) ? 0.55f : 1.0f;
    Color c = color(i);
    float bx = b.x, by = b.y * COSB, dx = std::cos(g.aim), dy = std::sin(g.aim);
    float dist, roll = 0;
    if (g.state == CHARGE) {
      if (kind == CHIP) {
        dist = chipCarry(g.power);
        float v = dist / chipTime(dist) * BITE;
        roll = v * v / (2 * friction(GREEN));
      } else dist = puttDistance(g.power);
    } else dist = kind == CHIP ? 160.0f : 120.0f;
    float ex = bx + dx * dist, ey = by + dy * dist * COSB;
    int dots = std::max(3, (int)(dist / 36));
    for (int k = 1; k <= dots; k++) {
      float u = (float)k / (dots + 1);
      app.gfx.circle((bx + (ex - bx) * u) * K, (by + (ey - by) * u) * K, 1.5f, col::white.alpha(0.85f * a));
    }
    if (g.state == CHARGE) {
      float rx = 27 * K, ry = 27 * COSB * K;
      app.gfx.ellipse(ex * K, ey * K + 1, rx + 2, ry + 2, Color(10, 17, 32, (unsigned char)(70 * a)));
      app.gfx.ellipse(ex * K, ey * K, rx, ry, c.alpha(0.85f * a));
      app.gfx.ellipse(ex * K, ey * K, rx - 2.5f, ry - 2.5f, col::white.alpha(0.55f * a));
      if (roll > 0) app.gfx.circle((ex + dx * roll) * K, (ey + dy * roll * COSB) * K, 2.2f, col::white.alpha(0.7f * a));
    } else {
      float sdx = dx, sdy = dy * COSB, m = std::max(1e-4f, std::hypot(sdx, sdy)), ux = sdx / m, uy = sdy / m;
      float tx = ex * K, ty = ey * K;
      app.gfx.line(tx + ux * 7, ty + uy * 7, tx - uy * 4.5f, ty + ux * 4.5f, 2.5f, col::white.alpha(a));
      app.gfx.line(tx + ux * 7, ty + uy * 7, tx + uy * 4.5f, ty - ux * 4.5f, 2.5f, col::white.alpha(a));
      if (!isCpu(i)) {
        float k = 1 + 0.12f * std::sin(ms_ / 120);
        float px = g.cx * K, py = g.cy * K - 90;
        app.gfx.circle(px, py, 10 * k, Color::hex(0x2fb84a));
        app.gfx.text("A", px, py - 8, 15, col::white, CENTER, false);
      }
    }
  }

  void drawGauge(int i) {
    Golfer& g = gf_[i];
    if (g.state != CHARGE || !holePlaying_) return;
    float gx = (g.cx - g.face * 54) * K, top = (g.cy - 150) * K;
    const float h = 120 * K, w = 16 * K;
    app.gfx.panel(gx - w / 2 - 2, top - 2, w + 4, h + 4, Color(16, 24, 40, 220), 5);
    float fill = h * g.power;
    Color c = g.power > 0.85f ? Color::hex(0xff6b5e) : (g.power > 0.5f ? col::gold : color(i));
    app.gfx.panel(gx - w / 2, top + h - fill, w, fill, c, 3);
  }

  void drawFlag() {
    float x = flagX() * K, y0 = flagY();
    float lift = flagT_ < 1 ? std::sin(flagT_ * PI_F) * 120 : 0;
    float y = (y0 - lift) * K;
    bool near = false;
    for (auto& g : gf_)
      if (std::fabs(g.cx * K - x) < 70 * K && std::fabs(g.cy - y0) < 60) near = true;
    float a = near ? 0.4f : 1.0f;
    Tex* t = app.gfx.tex("mg/capitol_flag.png");
    SDL_Rect src{0, 0, t->w, t->h};
    app.gfx.sprite(t, src, x, y, 1, 1, 22.0f / 180, 172.0f / 180, 0, false, col::white.alpha(a));
    // the pennant, fluttering downwind
    float top = y - (172 - 12) * K;
    float dir = std::cos(wAngle_) >= 0 ? 1.0f : -1.0f;
    float droop = wStrength_ == 0 ? 0.55f : 0.1f, len = 58 * K * (1 - droop * 0.5f);
    float wave = ms_ / (wStrength_ > 1 ? 110.0f : 200.0f);
    constexpr int SEG = 6;
    for (int k = 0; k < SEG; k++) {
      float u = (k + 0.5f) / SEG;
      float px = x + 1.5f + dir * len * u;
      float yt = top + (std::sin(wave + u * 3) * 4 * u + droop * 30 * u) * K;
      float yb = yt + (34 - 17 * u) * K;
      app.gfx.line(px, yt, px, yb, len / SEG + 0.8f, Color::hex(0xe63d4d).alpha(a));
    }
  }

  void drawHud() {
    // wind chip (top left) and hole chip (top right)
    float y = 62 * K;
    app.gfx.panel(142 * K - 56, y - 12, 112, 24, Color(16, 32, 44, 225), 12);
    app.gfx.text("WIND", 142 * K - 48, y - 9, 14, col::white, LEFT, false);
    float ax = 142 * K + 10;
    if (wStrength_ == 0) app.gfx.circle(ax, y, 3, col::white.alpha(0.8f));
    else {
      float dx = std::cos(wAngle_), dy = std::sin(wAngle_) * COSB, m = std::max(1e-4f, std::hypot(dx, dy)), ux = dx / m, uy = dy / m;
      float L = 10;
      app.gfx.line(ax - ux * L, y - uy * L, ax + ux * L, y + uy * L, 3, col::white);
      app.gfx.line(ax + ux * (L + 4), y + uy * (L + 4), ax + ux * L - uy * 5, y + uy * L + ux * 5, 2.5f, col::white);
      app.gfx.line(ax + ux * (L + 4), y + uy * (L + 4), ax + ux * L + uy * 5, y + uy * L - ux * 5, 2.5f, col::white);
    }
    for (int k = 0; k < 3; k++) app.gfx.panel(142 * K + 26 + k * 8, y - 5, 5, 10, k < wStrength_ ? col::gold : col::white.alpha(0.25f), 2);
    float hx = VW - 142 * K;
    app.gfx.panel(hx - 56, y - 12, 112, 24, Color(44, 30, 20, 225), 12);
    app.gfx.text(fmt("HOLE %d/3", hole_ + 1), hx - 48, y - 9, 14, col::white, LEFT, false);
    float left = holePlaying_ ? std::max(0.0f, (HOLES[hole_].end - ms_) / (HOLES[hole_].end - HOLES[hole_].start)) : 0;
    app.gfx.panel(hx + 17, y - 4, 32, 8, col::white.alpha(0.25f), 4);
    app.gfx.panel(hx + 17, y - 4, std::max(4.0f, 32 * left), 8, left < 0.3f ? Color::hex(0xff6b5e) : col::gold, 4);
  }

  void draw() override {
    drawArena();
    // slope dots drifting downhill
    float ph = std::fmod(ms_ / 1600, 1.0f);
    for (const auto& d : dots_) {
      float u = std::fmod(ph + d.x * 0.013f + d.y * 0.021f, 1.0f);
      float off = u * 16 * (0.5f + d.k);
      float al = std::sin(u * PI_F) * (0.18f + 0.32f * d.k);
      app.gfx.circle((d.x + d.dx * off) * K, (d.y + d.dy * off) * K, 1.3f, col::white.alpha(al));
    }
    // tee mats
    for (int i = 0; i < count(); i++) {
      Vec tee = teeOf(hole_, i);
      float x = tee.x * K, y = tee.y * COSB * K, rx = 42 * K, ry = 42 * COSB * 0.6f * K;
      app.gfx.ellipse(x, y + 2, rx + 2, ry + 2, Color(10, 17, 32, 56));
      app.gfx.ellipse(x, y, rx + 1.3f, ry + 1.3f, col::white.alpha(0.75f));
      app.gfx.ellipse(x, y, rx, ry, color(i).mix(Color::hex(0x5fae4a), 0.4f));
    }
    // the cup and its glow
    float cx = cup_.x * K, cy = cup_.y * COSB * K;
    if (tension_ > 0.02f) {
      float pulse = 0.75f + 0.25f * std::sin(ms_ / 70);
      float r = (22 + tension_ * 16) * K * 2.2f;
      app.gfx.ellipse(cx, cy, r, r * COSB, Color(255, 241, 168, (unsigned char)(150 * tension_ * pulse)));
    }
    app.gfx.ellipse(cx, cy, (CUP_R + 4) * K, (CUP_R + 4) * COSB * K, col::white.alpha(0.9f));
    app.gfx.ellipse(cx, cy, CUP_R * K, CUP_R * COSB * K, Color::hex(0x1b2a1c));
    app.gfx.ellipse(cx, cy + 1, CUP_R * 0.75f * K, CUP_R * 0.6f * COSB * K, Color::hex(0x0b140c));
    if (tapeT_ > 0) app.gfx.line(tapeX_ * K, tapeY_ * K, cx, cy, 2.5f, tapeCol_.alpha(std::min(1.0f, tapeT_ / 0.4f)));
    // ball shadows, colour rings and trails
    for (int i = 0; i < count(); i++) {
      GBall& b = gf_[i].ball;
      if (b.holed || b.hidden) continue;
      float sx = b.x * K, sy = b.y * COSB * K;
      app.gfx.ellipse(sx, sy, 15 * K, 15 * COSB * K, color(i).alpha(0.5f));
      float k = std::max(0.35f, 1 - b.z / 500);
      app.gfx.ellipse(sx, sy + 1, 4.5f * k, 1.8f * k, Color(10, 17, 32, 110));
      bool fast = b.moving && (b.air || std::hypot(b.vx, b.vy) > 160);
      if (!fast) {
        b.tn = 0;
        continue;
      }
      float lift = (b.z * SINB + std::sin(b.hop * PI_F) * 10 * b.hop) * K;
      for (int k2 = 7; k2 > 0; k2--) {
        b.trx[k2] = b.trx[k2 - 1];
        b.try_[k2] = b.try_[k2 - 1];
      }
      b.trx[0] = sx;
      b.try_[0] = sy - lift - 2;
      b.tn = std::min(8, b.tn + 1);
      for (int k2 = 1; k2 < b.tn; k2++) {
        float f = 1 - k2 / 8.0f;
        app.gfx.line(b.trx[k2 - 1], b.try_[k2 - 1], b.trx[k2], b.try_[k2], 4 * f + 1, color(i).alpha(0.5f * f));
      }
    }
    for (int i = 0; i < count(); i++) drawAim(i);
    for (const auto& g : gusts_) {
      float a = std::sin(g.t / g.life * PI_F) * 0.5f;
      app.gfx.line(g.x * K, g.y * K, (g.x - g.dx * g.len) * K, (g.y - g.dy * g.len) * K, 2, col::white.alpha(a));
    }
    // golfers, balls and the flag back to front
    order_.clear();
    for (int i = 0; i < count(); i++) {
      order_.push_back({gf_[i].cy, i});
      order_.push_back({gf_[i].ball.y * COSB + (gf_[i].ball.air ? 30 : 0), 100 + i});
    }
    order_.push_back({flagY() + 2, 200});
    std::sort(order_.begin(), order_.end());
    for (auto& o : order_) {
      if (o.second < 100) drawGolfer(o.second);
      else if (o.second < 200) drawBallItem(o.second - 100);
      else drawFlag();
    }
    for (int i = 0; i < count(); i++) drawGauge(i);
    for (const auto& p : pops_) {
      float k = p.t / p.life;
      float a = k < 0.7f ? 1.0f : 1 - (k - 0.7f) / 0.3f;
      app.gfx.text(p.text, p.x, p.y - 20 * easeOut(std::min(1.0f, k * 2)), p.size, p.c.alpha(a), CENTER, true);
    }
    if (bannerT_ > 0) {
      float a = std::min(1.0f, bannerT_ / 0.3f);
      app.gfx.panel(VW / 2 - 130, 60, 260, 44, Color(30, 60, 40, (unsigned char)(220 * a)), 22);
      app.gfx.text(bannerText_, VW / 2, 67, 28, bannerCol_.alpha(a), CENTER, true);
    }
    drawHud();
    drawTimer((ROUND_MS - ms_) / 1000);
    drawScores(score_, "pts");
  }

  bool finished() const override { return ms_ >= ROUND_MS; }
  std::vector<int> scores() const override { return score_; }
  std::string scoreLabel(int i) const override { return std::to_string(score_[i]) + " points"; }

 private:
  std::vector<Golfer> gf_;
  std::vector<int> score_;
  std::vector<Dot> dots_;
  std::vector<Gust> gusts_;
  std::vector<Pop> pops_;
  std::vector<std::pair<float, int>> order_;
  int hole_ = 0, closestDone_ = -1, nextHole_ = -1, wStrength_ = 0;
  Vec cup_{0, 0}, wind_{0, 0};
  float wAngle_ = 0;
  bool holePlaying_ = false, double_ = false, started_ = false;
  float ms_ = 0, nextHoleT_ = 0, tension_ = 0, gustT_ = 0;
  float flagFromX_ = 0, flagFromY_ = 0, flagToX_ = 0, flagToY_ = 0, flagT_ = 1;
  float tapeT_ = 0, tapeX_ = 0, tapeY_ = 0;
  Color tapeCol_ = col::white;
  std::string bannerText_;
  Color bannerCol_ = col::gold;
  float bannerT_ = 0;
};

}  // namespace

REGISTER_MINIGAME("fairway", Fairway);

// Rooftop Glide (Hero Heights at night): hold A to glide on your cape, let go to dive and open it again
// to swoop; ride the hot air rising from the vents, collect glowing clues (gold ones are worth 3) and
// keep out of the sweeping searchlights: held in a beam you're spotted, dazed, and a clue drops loose for
// anyone to grab. The last 10 seconds are a clue storm. Most clues after 45 seconds wins.
// The flight model, searchlights and CPU pilot follow the web game's glideRules.ts, in its 1920x1080
// stage coordinates (drawn scaled by S) and milliseconds.
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "../game/Data.h"
#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float S = VW / 1920.0f;
constexpr float PI = 3.14159265f;
constexpr float DURATION = 45;
constexpr float CHAR_SCALE = 0.77f;  // the web's 0.55
constexpr float CANOPY_Y = -104, CANOPY_W = 210;
constexpr float STREAK_MS = 3000, CLUE_LIFE = 9000, GOLD_LIFE = 7000, DROP_LIFE = 5000;

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{520, 0.55f, 0.24f, 0.55f, 700}, {300, 0.78f, 0.11f, 0.28f, 420}, {170, 0.9f, 0.05f, 0.13f, 240}};

// --- The skyline (matches the rendered arena) ---------------------------------------------------
struct Roof {
  float x0, x1, y;
};
constexpr Roof ROOFS[] = {{-200, 232, 604}, {232, 522, 826}, {522, 760, 700}, {760, 1152, 884}, {1152, 1400, 722}, {1400, 1690, 834}, {1690, 2120, 620}};
constexpr int NROOFS = 7;
struct Vent {
  float x, y, half;
};
constexpr Vent VENTS[] = {{377, 826, 74}, {956, 884, 78}, {1545, 834, 74}};
constexpr int NVENTS = 3;
struct Lamp {
  float x, y, sweep, period, phase;
};
constexpr Lamp LAMPS[] = {{641, 662, 0.95f, 13, 0.6f}, {1276, 684, 0.95f, 11.5f, 3.4f}};
constexpr int NLAMPS = 2;

namespace G {
constexpr float CEIL = 238, WALL_L = 70, WALL_R = 1850, GRAV = 1500, DIVE_MAX = 950, SINK = 88, GLIDE_K = 4.6f, GLIDE_MIN = 175, GLIDE_MAX = 440,
                HOVER_MIN = 40, DIVE_H = 540, STEER_K = 3.2f, DIVE_STEER_K = 1.5f, SWOOP_MIN = 270, SWOOP_K = 0.8f, SWOOP_MAX = 720, UPDRAFT_ACC = 3000,
                UPDRAFT_VMAX = 560, UPDRAFT_DIVE_ACC = 650, LEAP_VY = 760, LEAP_VX = 280, RUN = 380, HARD_LAND = 700, LAND_STUN_MS = 240, STUN_MS = 850,
                INVULN_MS = 1500, REACH = 60, BODY = 62;
}
constexpr float BEAM_HALF = 0.085f, CATCH_MS = 300, BEAM_LEN = 1300, BODY_R = 26;
constexpr float GLIDE_SLOPE = G::SINK / G::GLIDE_MAX;

float roofAt(float x) {
  for (const Roof& r : ROOFS)
    if (x >= r.x0 && x < r.x1) return r.y;
  return ROOFS[x < 0 ? 0 : NROOFS - 1].y;
}

int ventAt(float x, float y) {
  for (int i = 0; i < NVENTS; i++)
    if (std::fabs(x - VENTS[i].x) <= VENTS[i].half && y <= VENTS[i].y && y >= G::CEIL - 10) return i;
  return -1;
}

float updraftStrength(float y) {
  float u = (y - G::CEIL) / 240;
  return u >= 1 ? 1 : std::max(0.3f, 0.3f + 0.7f * u);
}

float kf(float rate, float s) { return 1 - std::exp(-rate * s); }
float clampAbs(float v, float m) { return v > m ? m : (v < -m ? -m : v); }
float sgn(float v) { return v > 0 ? 1.0f : (v < 0 ? -1.0f : 0.0f); }

enum Mode { GLIDE, DIVE, ROOF, STUN };

struct Flyer {
  float x = 0, y = 0, vx = 0, vy = 0;
  int face = 1;
  Mode mode = ROOF;
  float stunT = 0, invuln = 0, landStun = 0;
  int lifted = -1;
  bool rise = false;
};

struct FlyInput {
  float stickX = 0;
  bool holdA = false, pressA = false;
};

struct FlyEvents {
  bool leap = false, openCape = false, closeCape = false, hardLand = false, bonk = false;
  float swoop = 0, land = 0;
  int updraft = 0;
};

Flyer newFlyer(float x) {
  Flyer f;
  f.x = x;
  f.y = roofAt(x) - G::BODY;
  f.face = x < 960 ? 1 : -1;
  return f;
}

void stepRoof(Flyer& f, const FlyInput& inp, float dt, float s, FlyEvents& out) {
  f.lifted = -1;
  if (f.stunT > 0) {
    f.stunT = std::max(0.0f, f.stunT - dt);
    f.vx *= std::exp(-8 * s);
  } else if (f.landStun > 0) {
    f.landStun = std::max(0.0f, f.landStun - dt);
    f.vx *= std::exp(-10 * s);
  } else {
    f.vx += (inp.stickX * G::RUN - f.vx) * kf(12, s);
    if (std::fabs(inp.stickX) > 0.2f) f.face = inp.stickX > 0 ? 1 : -1;
    if (inp.pressA) {
      f.vy = -G::LEAP_VY;
      f.vx = f.face * std::max(std::fabs(f.vx), G::LEAP_VX);
      f.mode = inp.holdA ? GLIDE : DIVE;
      f.rise = true;
      out.leap = true;
      f.y -= 2;
      return;
    }
  }
  float px = f.x;
  float nx = std::max(G::WALL_L, std::min(G::WALL_R, f.x + f.vx * s));
  float here = roofAt(px), there = roofAt(nx);
  if (there < here - 2) {
    nx = px;
    f.vx = 0;
  }
  f.x = nx;
  if (there > here + 2) {
    f.mode = f.stunT > 0 ? STUN : (inp.holdA ? GLIDE : DIVE);
    f.vy = 60;
  } else f.y = roofAt(f.x) - G::BODY;
}

// One step: holding A keeps the cape open (a slow glide the stick steers); letting go folds it (a dive
// that builds speed); opening it mid-dive swoops you up. Updrafts lift an open cape; roofs are landed on.
void stepFlyer(Flyer& f, const FlyInput& inp, float dt, FlyEvents& out) {
  out = FlyEvents();
  float s = dt / 1000;
  if (f.invuln > 0) f.invuln = std::max(0.0f, f.invuln - dt);
  if (f.mode == ROOF) {
    stepRoof(f, inp, dt, s, out);
    return;
  }
  float px = f.x, py = f.y;
  if (f.mode == STUN) {
    f.rise = false;
    f.stunT -= dt;
    f.vy = std::min(G::DIVE_MAX * 0.8f, f.vy + G::GRAV * 0.8f * s);
    f.vx *= std::exp(-1.6f * s);
  } else {
    bool glide = inp.holdA;
    if (glide && f.mode == DIVE) {
      out.openCape = true;
      if (f.vy > G::SWOOP_MIN) {
        float up = std::min(G::SWOOP_MAX, G::SWOOP_K * f.vy);
        f.vy = -up;
        f.rise = false;
        f.vx = clampAbs(f.vx + f.face * up * 0.18f, G::GLIDE_MAX * 1.3f);
        out.swoop = up;
      }
      f.mode = GLIDE;
    } else if (!glide && f.mode == GLIDE) {
      out.closeCape = true;
      f.mode = DIVE;
    }
    if (std::fabs(inp.stickX) > 0.25f) f.face = inp.stickX > 0 ? 1 : -1;
    int vent = ventAt(f.x, f.y);
    if (f.rise && f.vy >= 0) f.rise = false;
    if (f.mode == GLIDE) {
      float slow = vent >= 0 ? G::HOVER_MIN : G::GLIDE_MIN;
      float spd = slow + (G::GLIDE_MAX - slow) * std::min(1.0f, std::fabs(inp.stickX));
      f.vx += (f.face * spd - f.vx) * kf(G::STEER_K, s);
      if (f.rise) f.vy += G::GRAV * s;
      else f.vy += (G::SINK - f.vy) * kf(G::GLIDE_K, s);
    } else {
      float target = std::fabs(inp.stickX) > 0.25f ? f.face * G::DIVE_H : f.vx;
      f.vx += (target - f.vx) * kf(G::DIVE_STEER_K, s);
      f.vy = std::min(G::DIVE_MAX, f.vy + G::GRAV * s);
    }
    if (vent >= 0) {
      float lift = updraftStrength(f.y);
      if (f.mode == GLIDE) f.vy = std::max(-G::UPDRAFT_VMAX, f.vy - G::UPDRAFT_ACC * lift * s);
      else f.vy -= G::UPDRAFT_DIVE_ACC * lift * s;
      if (f.lifted != vent) out.updraft = vent + 1;
    }
    f.lifted = vent;
  }
  float nx = f.x + f.vx * s, ny = f.y + f.vy * s;
  if (ny < G::CEIL) {
    ny = G::CEIL;
    if (f.vy < 0) f.vy = 0;
  }
  if (nx < G::WALL_L) {
    nx = G::WALL_L;
    f.vx = std::fabs(f.vx) * 0.35f;
    f.face = 1;
    out.bonk = true;
  } else if (nx > G::WALL_R) {
    nx = G::WALL_R;
    f.vx = -std::fabs(f.vx) * 0.35f;
    f.face = -1;
    out.bonk = true;
  }
  float floorNew = roofAt(nx);
  if (ny + G::BODY >= floorNew) {
    if (py + G::BODY <= floorNew + 3) {
      ny = floorNew - G::BODY;
      out.land = std::max(1.0f, f.vy);
      if (f.vy > G::HARD_LAND && f.mode != STUN) {
        out.hardLand = true;
        f.landStun = G::LAND_STUN_MS;
      }
      if (f.mode == STUN) f.vx *= 0.3f;
      f.vy = 0;
      f.mode = ROOF;
    } else {
      // flew into the side of a taller building: bounce back off its wall
      nx = px;
      f.vx = -f.vx * 0.3f;
      f.face = f.vx >= 0 ? 1 : -1;
      out.bonk = true;
      if (ny + G::BODY >= roofAt(nx)) {
        ny = roofAt(nx) - G::BODY;
        out.land = std::max(1.0f, f.vy);
        f.vy = 0;
        f.mode = ROOF;
      }
    }
  }
  f.x = nx;
  f.y = ny;
  if (f.mode == STUN && f.stunT <= 0) {
    f.stunT = 0;
    f.mode = inp.holdA ? GLIDE : DIVE;
  }
}

// --- Searchlights ----------------------------------------------------------------------------------
struct Beam {
  const Lamp* lamp;
  float phase, angle;
};

float beamOmega(const Beam& b, float speed) { return PI * 2 / b.lamp->period * speed; }
float beamAngleAhead(const Beam& b, float ahead, float speed) { return b.lamp->sweep * std::sin(b.phase + beamOmega(b, speed) * ahead); }

bool inBeam(const Lamp& lamp, float angle, float x, float y, float margin = 0) {
  float dx = x - lamp.x, dy = y - lamp.y;
  float d = std::hypot(dx, dy);
  if (d < 50 || d > BEAM_LEN) return false;
  float pa = std::atan2(dx, -dy);
  return std::fabs(pa - angle) < BEAM_HALF + BODY_R / d + margin;
}

void spotted(Flyer& f) {
  f.stunT = G::STUN_MS;
  f.invuln = G::STUN_MS + G::INVULN_MS;
  f.landStun = 0;
  if (f.mode != ROOF) {
    f.mode = STUN;
    f.vy = std::min(f.vy, -160.0f);
  }
}

// --- CPU pilot --------------------------------------------------------------------------------------
struct ClueView {
  int id;
  float x, y;
  int value;
  float life;
};

struct View {
  std::vector<ClueView> clues;
  const std::vector<Beam>* beams = nullptr;
  float beamSpeed = 1;
  std::vector<int> claimed;
  std::vector<std::pair<float, float>> rivals;
  float lock = 0;
  bool isClaimed(int id) const { return std::find(claimed.begin(), claimed.end(), id) != claimed.end(); }
};

struct Brain {
  float think = 0;
  int tid = -1;
  float tx = 960, ty = 400;
  bool climb = false;
  int vent = -1;
  bool diving = false;
  float evade = 0;
  bool evadeDive = false;
  float evadeFace = 1, evadeStick = 1;
  float notice = -1, ignore = 0, wary = 0, roofWait = -1, wobble = 0;
};

struct Cost {
  float t;
  int vent;
};

// Rough seconds to reach a clue: the flight, plus a climb in an updraft if it is above the glide line.
Cost clueCost(float x, float y, float cx, float cy) {
  float dx = std::fabs(cx - x);
  float glideY = y + GLIDE_SLOPE * dx;
  if (cy >= glideY - 40) return {dx / G::GLIDE_MAX + std::max(0.0f, cy - glideY) / 900, -1};
  Cost best{1e9f, -1};
  for (int i = 0; i < NVENTS; i++) {
    const Vent& v = VENTS[i];
    float toVent = std::fabs(v.x - x) / G::GLIDE_MAX;
    float atVentY = std::min(v.y - 40, y + GLIDE_SLOPE * std::fabs(v.x - x));
    float climbTo = cy - 70 - GLIDE_SLOPE * std::fabs(cx - v.x);
    float climb = std::max(0.0f, atVentY - std::max(G::CEIL, climbTo)) / (G::UPDRAFT_VMAX * 0.8f);
    float t = toVent + climb + std::fabs(cx - v.x) / G::GLIDE_MAX + 0.4f;
    if (t < best.t) best = {t, i};
  }
  return best;
}

float exposure(const View& v, float x, float y, float eta) {
  const float spread[3] = {-0.3f, 0, 0.3f};
  int n = 0;
  for (const Beam& bm : *v.beams)
    for (float d : spread)
      if (inBeam(*bm.lamp, beamAngleAhead(bm, std::max(0.0f, eta + d), v.beamSpeed), x, y, 0.05f)) n++;
  return (float)n;
}

float ventExposure(const View& v, int vi, float fromX, float fromY, float toY) {
  const Vent& vent = VENTS[vi];
  float top = std::max(G::CEIL, toY - 70);
  float start = std::min(fromY, vent.y - 60);
  float climb = std::max(0.2f, (start - top) / (G::UPDRAFT_VMAX * 0.85f));
  int n = 0;
  for (int i = 0; i <= 4; i++) {
    float u = i / 4.0f;
    float y = start + (top - start) * u;
    float t = std::fabs(vent.x - fromX) / G::GLIDE_MAX + climb * u;
    for (const Beam& bm : *v.beams)
      if (inBeam(*bm.lamp, beamAngleAhead(bm, t, v.beamSpeed), vent.x, y, 0.05f)) n++;
  }
  return n * 0.6f;
}

int nearestVent(float x) {
  int best = 0;
  for (int i = 1; i < NVENTS; i++)
    if (std::fabs(VENTS[i].x - x) < std::fabs(VENTS[best].x - x)) best = i;
  return best;
}

void pickClue(Brain& b, const Flyer& f, const View& v, const Skill& sk, Random& rng) {
  const ClueView* best = nullptr;
  float bestScore = -1e9f;
  int bestVent = -1;
  bool blunder = rng.next() < sk.mistake;
  for (const ClueView& c : v.clues) {
    Cost cost = clueCost(f.x, f.y, c.x, c.y);
    if (cost.t * 1000 > c.life - 200) continue;
    float rival = 9999;
    for (auto& r : v.rivals) rival = std::min(rival, std::hypot(r.first - c.x, r.second - c.y));
    float mine = std::hypot(f.x - c.x, f.y - c.y);
    float risk = exposure(v, c.x, c.y, cost.t) + (cost.vent >= 0 ? ventExposure(v, cost.vent, f.x, f.y, c.y) : 0);
    float score = c.value * 1.6f - cost.t - (rival < mine * 0.7f ? 0.9f : 0) - (v.isClaimed(c.id) ? 1.2f : 0) - risk * sk.accuracy * 0.9f;
    if (blunder) score = (float)rng.next();
    if (c.id == b.tid) score += 0.7f;
    if (score > bestScore) {
      bestScore = score;
      best = &c;
      bestVent = cost.vent;
    }
  }
  if (!best) {
    // nothing worth chasing: drift towards the middle, high up
    b.tid = -1;
    b.tx = 960;
    b.ty = 420;
    b.climb = f.y > 560;
    b.vent = f.y > 560 ? nearestVent(f.x) : -1;
    return;
  }
  if (best->id != b.tid) b.diving = false;
  b.tid = best->id;
  b.tx = best->x;
  b.ty = best->y;
  b.climb = bestVent >= 0;
  b.vent = bestVent;
}

void steerTo(Brain& b, const Flyer& f, bool hasTarget, const Skill& sk, FlyInput& inp) {
  float gx = b.tx;
  if (b.climb && b.vent >= 0) {
    const Vent& v = VENTS[b.vent];
    float need = b.ty - 60 - GLIDE_SLOPE * std::fabs(b.tx - v.x);
    if (f.y <= std::max(G::CEIL + 8, need) || !hasTarget) b.climb = false;
    else {
      gx = v.x;
      float dx = gx - f.x;
      inp.stickX = std::fabs(dx) < 16 ? -f.face * 0.15f : sgn(dx) * std::min(1.0f, std::fabs(dx) / 60 + 0.25f);
      inp.holdA = true;
      return;
    }
  }
  float dx = gx - f.x, dy = b.ty - f.y;
  inp.stickX = std::fabs(dx) < 10 ? 0 : std::max(-1.0f, std::min(1.0f, sgn(dx) * (0.35f + std::fabs(dx) / 160) + b.wobble));
  // dive when the clue is well under the glide line; swoop up into ones just above (weaker pilots are timid divers)
  float run = std::max(40.0f, std::fabs(dx));
  float need = dy / run;
  float slope = G::SINK / std::max(120.0f, std::fabs(f.vx));
  float nerve = 0.8f + std::max(0.0f, 0.78f - sk.accuracy) * 4;
  if (b.diving) {
    if (need < slope + 0.12f || (dy < 40 && f.vy > G::SWOOP_MIN)) b.diving = false;
  } else if (need > slope + nerve && dy > 90) b.diving = true;
  inp.holdA = !b.diving;
}

// Fly a plan forward in coarse steps against the beams' future sweeps: the longest time (ms) it would
// sit in a beam (CATCH_MS or more = caught).
float courseLock(const Flyer& f, const View& v, float face, bool dive, float stick, float horizon, float lock0) {
  float x = f.x, y = f.y, vx = f.vx, vy = f.vy, lock = lock0, worst = lock0;
  const float h = 0.04f;
  for (float t = h; t <= horizon + 1e-6f; t += h) {
    int vent = ventAt(x, y);
    if (dive) {
      vx += ((stick > 0.25f ? face * G::DIVE_H : vx) - vx) * kf(G::DIVE_STEER_K, h);
      vy = std::min(G::DIVE_MAX, vy + G::GRAV * h);
    } else {
      float slow = vent >= 0 ? G::HOVER_MIN : G::GLIDE_MIN;
      vx += ((slow + (G::GLIDE_MAX - slow) * stick) * face - vx) * kf(G::STEER_K, h);
      vy += (G::SINK - vy) * kf(G::GLIDE_K, h);
      if (vent >= 0) vy = std::max(-G::UPDRAFT_VMAX, vy - G::UPDRAFT_ACC * updraftStrength(y) * h);
    }
    x = std::max(G::WALL_L, std::min(G::WALL_R, x + vx * h));
    y = std::max(G::CEIL, std::min(roofAt(x) - G::BODY, y + vy * h));
    bool lit = false;
    for (const Beam& bm : *v.beams)
      if (inBeam(*bm.lamp, beamAngleAhead(bm, t, v.beamSpeed), x, y, 0.02f)) lit = true;
    lock = lit ? lock + h * 1000 : 0;
    worst = std::max(worst, lock);
    if (worst >= CATCH_MS) return worst;
  }
  return worst;
}

struct Plan {
  bool turn, dive;
  float stick;
};
constexpr Plan PLANS[6] = {{false, false, 1}, {true, false, 1}, {false, true, 1}, {true, true, 1}, {false, false, 0}, {true, false, 0}};

void planEvade(Brain& b, const Flyer& f, const View& v, float look) {
  Plan pick = PLANS[0];
  float best = 1e9f;
  int toward = b.tx >= f.x ? 1 : -1;
  for (const Plan& o : PLANS) {
    int face = o.turn ? -f.face : f.face;
    float lock = courseLock(f, v, (float)face, o.dive, o.stick, look + 0.45f, v.lock);
    bool safe = lock < CATCH_MS * 0.7f;
    float cost = (safe ? lock * 0.1f : 1000 + lock) + (face != toward ? 100 : 0) + (o.dive ? 40 : 0) + (o.stick < 0.5f ? 20 : 0);
    if (cost < best) {
      best = cost;
      pick = o;
    }
  }
  b.evade = 240;
  b.evadeDive = pick.dive;
  b.evadeFace = (float)(pick.turn ? -f.face : f.face);
  b.evadeStick = pick.stick;
}

// The CPU pilot: chooses a clue worth the trip (climbing an updraft first when it sits above the glide
// line), glides or dives to meet it, leaps off roofs, and dodges the searchlights it sees coming.
FlyInput glideCpu(Brain& b, const Flyer& f, const View& v, const Skill& sk, float dt, Random& rng) {
  FlyInput inp;
  b.think -= dt;
  const ClueView* target = nullptr;
  for (const ClueView& c : v.clues)
    if (c.id == b.tid) target = &c;
  if (b.think <= 0 || !target) {
    b.think = sk.think * (0.8f + 0.4f * (float)rng.next());
    b.wobble = ((float)rng.next() - 0.5f) * sk.aimNoise * 0.5f;
    pickClue(b, f, v, sk, rng);
    target = nullptr;
    for (const ClueView& c : v.clues)
      if (c.id == b.tid) target = &c;
  }
  if (target) {
    b.tx = target->x;
    b.ty = target->y;
  }
  if (f.mode == ROOF) {
    b.diving = false;
    b.evade = 0;
    inp.stickX = b.tx >= f.x ? 1 : -1;
    if (b.roofWait < 0) b.roofWait = sk.reaction * (0.6f + 0.6f * (float)rng.next());
    b.roofWait -= dt;
    if (b.roofWait <= 0) {
      b.roofWait = -1;
      inp.pressA = inp.holdA = true;
    }
    return inp;
  }
  b.roofWait = -1;
  steerTo(b, f, target != nullptr, sk, inp);
  if (f.mode == STUN || f.invuln > 0) return inp;
  float look = 0.25f + sk.accuracy * 0.55f;
  if (b.ignore > 0) b.ignore -= dt;
  if (b.wary > 0) b.wary -= dt;
  if (b.evade > 0) {
    b.evade -= dt;
    inp.stickX = b.evadeFace * std::max(0.3f, b.evadeStick);
    inp.holdA = !b.evadeDive;
    return inp;
  }
  if (b.ignore > 0) return inp;
  float face = std::fabs(inp.stickX) > 0.25f ? sgn(inp.stickX) : (float)f.face;
  bool hanging = ventAt(f.x, f.y) >= 0 && inp.holdA;
  float lock = courseLock(f, v, face, !inp.holdA, hanging ? std::fabs(inp.stickX) : std::max(0.35f, std::fabs(inp.stickX)), hanging ? look + 0.5f : look, v.lock);
  if (lock < CATCH_MS * 0.85f) {
    b.notice = -1;
    return inp;
  }
  if (b.notice < 0) b.notice = b.wary > 0 ? 0 : sk.reaction * (0.5f + 0.5f * (float)rng.next());
  b.notice -= dt;
  if (b.notice > 0) return inp;
  b.notice = -1;
  if (b.wary <= 0 && rng.next() < sk.mistake * 1.4f) {
    b.ignore = 900;
    return inp;
  }
  planEvade(b, f, v, look);
  b.wary = 900;
  inp.stickX = b.evadeFace * std::max(0.3f, b.evadeStick);
  inp.holdA = !b.evadeDive;
  return inp;
}

// Draw a character turned by `angle` (radians) about its body centre (x, y), `body` px above its feet.
void characterRot(int c, const char* anim, int frame, float t, float x, float y, float scale, bool flip, float angle, float body, Color tint) {
  const data::CharacterDef& d = data::CHARACTERS[c];
  const data::AnimDef* a = &d.anims[0];
  for (int i = 0; i < d.animCount; i++)
    if (!std::strcmp(d.anims[i].name, anim)) {
      a = &d.anims[i];
      break;
    }
  int f = frame >= 0 ? frame : (int)(t * (a->fps > 0 ? a->fps : 8));
  f = a->loop ? f % a->count : std::min(f, a->count - 1);
  if (f < 0) f = 0;
  int cell = a->cells[f];
  Tex* tex = app.gfx.tex(std::string("chars/") + d.id + ".png");
  SDL_Rect src{(cell % d.cols) * spr::CELL, (cell / d.cols) * spr::CELL, spr::CELL, spr::CELL};
  float ox = (flip ? spr::CELL - spr::FEET_X : spr::FEET_X) / spr::CELL;
  float oy = (spr::FEET_Y - body / scale) / spr::CELL;
  app.gfx.sprite(tex, src, x, y, scale, scale, ox, oy, angle * 57.29578f, flip, tint);
}

// --- The game ----------------------------------------------------------------------------------------
struct Clue {
  int id = 0;
  float x = 0, y = 0, baseY = 0, age = 0, life = 0, vx = 0, vy = 0, wait = 0, phase = 0;
  int value = 1, owner = -1;
  bool gold = false, drop = false, gone = false;
};

struct Glider {
  Flyer f;
  FlyEvents ev;
  Brain brain;
  FlyInput input;
  float cape = 0, tilt = 0, spin = -1, markY = -96, lock = 0;
  float lastCatch = -1e9f;
  int streak = 0;
  bool prevA = false;
};

struct Word {
  std::string text;
  float x, y, t, hold;
  int size;
  Color c;
};

struct Wave {
  float x, y, r0, r1, t, dur;
  Color c;
};

struct Streak {
  float x, y, v;
};

class RooftopGlide : public Minigame {
 public:
  void start() override {
    const float spots[4] = {300, 1620, 860, 1060};
    int off = rng.range(0, 3);
    for (int i = 0; i < count(); i++) {
      Glider g;
      g.f = newFlyer(spots[(i + off) % 4]);
      gl_.push_back(g);
      score_.push_back(0);
    }
    for (const Lamp& l : LAMPS) beams_.push_back(Beam{&l, l.phase, l.sweep * std::sin(l.phase)});
    for (int v = 0; v < NVENTS; v++)
      for (int i = 0; i < 6; i++) streaks_.push_back(Streak{VENTS[v].x + ((float)rng.next() - 0.5f) * VENTS[v].half * 1.5f, VENTS[v].y - (float)rng.next() * (VENTS[v].y - G::CEIL), 340 + 260 * (float)rng.next()});
    for (int i = 0; i < 2 + count(); i++) spawnClue(i == 2);
  }

  void update(float dt) override {
    float ms = dt * 1000;
    time_ += dt;
    int n = count();
    if (!storm_ && time_ >= DURATION - 10) {
      // the final stretch: a clue storm, and the searchlights sweep faster
      storm_ = true;
      beamSpeed_ = 1.3f;
      word("CLUE STORM!", VW / 2, 420, 40, Color::hex(0xffe08a), 1200);
      for (int i = 0; i < 3; i++) spawnClue(i == 1);
    }
    for (Beam& b : beams_) {
      b.phase += beamOmega(b, beamSpeed_) * dt;
      b.angle = b.lamp->sweep * std::sin(b.phase);
    }
    for (int i = 0; i < (int)beamHeat_.size(); i++) {
      beamHeat_[i] = std::max(0.0f, beamHeat_[i] - ms / 500);
      beamFlash_[i] = std::max(0.0f, beamFlash_[i] - ms);
    }
    spawnT_ -= ms;
    if (spawnT_ <= 0) {
      spawnT_ = (1350 - (n - 2) * 110) * (storm_ ? 0.5f : 1);
      int live = 0;
      for (auto& c : clues_)
        if (!c.drop) live++;
      if (live < 4 + n + (storm_ ? 3 : 0)) spawnClue(rng.chance(storm_ ? 0.22 : 0.12));
    }
    updateClues(ms);
    for (int i = 0; i < n; i++) {
      Glider& g = gl_[i];
      if (isCpu(i)) {
        FlyInput c = cpuInput(i, ms);
        bool hold = c.holdA || c.pressA;
        g.input.stickX = c.stickX;
        g.input.pressA = hold && !g.prevA;
        g.input.holdA = hold;
        g.prevA = hold;
      } else {
        g.input.stickX = pad(i).x;
        g.input.holdA = pad(i).down(B_A);
        g.input.pressA = pad(i).press(B_A);
      }
      Mode was = g.f.mode;
      stepFlyer(g.f, g.input, ms, g.ev);
      flightFx(i, was);
      searchlights(i, ms);
      syncGlider(g, dt);
    }
    // pick-ups
    for (auto& c : clues_) {
      if (c.gone || c.wait > 0) continue;
      int best = -1;
      float bestD = G::REACH + (c.gold ? 10 : 0);
      for (int i = 0; i < n; i++) {
        const Flyer& f = gl_[i].f;
        if (f.mode == STUN || (f.mode == ROOF && f.stunT > 0) || (c.owner == i && c.age < 800)) continue;
        float d = std::hypot(c.x - f.x, c.y - f.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) collect(best, c);
    }
    std::erase_if(clues_, [](const Clue& c) { return c.gone; });
    for (auto& s : streaks_) {
      s.y -= s.v * dt;
      if (s.y < G::CEIL) {
        int v = (int)(&s - &streaks_[0]) / 6;
        s.y = VENTS[v].y - 10;
        s.x = VENTS[v].x + ((float)rng.next() - 0.5f) * VENTS[v].half * 1.5f;
        s.v = 340 + 260 * (float)rng.next();
      }
    }
    for (auto& w : words_) w.t += ms;
    std::erase_if(words_, [](const Word& w) { return w.t > w.hold + 250; });
    for (auto& w : waves_) w.t += ms;
    std::erase_if(waves_, [](const Wave& w) { return w.t >= w.dur; });
  }

  FlyInput cpuInput(int i, float ms) {
    Glider& g = gl_[i];
    View& v = view_;
    v.clues.clear();
    for (auto& c : clues_)
      if (!c.gone && (c.owner != i || c.age > 800)) v.clues.push_back(ClueView{c.id, c.x, c.y, c.value, c.life});
    v.claimed.clear();
    v.rivals.clear();
    for (int j = 0; j < count(); j++) {
      if (j == i) continue;
      v.rivals.push_back({gl_[j].f.x, gl_[j].f.y});
      if (isCpu(j) && gl_[j].brain.tid >= 0) v.claimed.push_back(gl_[j].brain.tid);
    }
    v.beams = &beams_;
    v.beamSpeed = beamSpeed_;
    v.lock = g.lock;
    return glideCpu(g.brain, g.f, v, SKILL[cpuLevel(i)], ms, rng);
  }

  void spawnClue(bool gold) {
    // where a new clue may appear: open sky, clear of the others and the lamps' lenses
    float bx = 960, by = 360, bestGap = -1;
    for (int tries = 0; tries < 12; tries++) {
      float x = 150 + (float)rng.next() * 1620;
      float top = G::CEIL + 36, bottom = gold ? 380 : roofAt(x) - 120;
      float y = top + (float)rng.next() * std::max(10.0f, bottom - top);
      float gap = 9999;
      for (auto& o : clues_) gap = std::min(gap, std::hypot(o.x - x, o.y - y));
      for (const Lamp& l : LAMPS) gap = std::min(gap, std::hypot(l.x - x, l.y - y) + 60);
      if (gap > 150) {
        bx = x;
        by = y;
        break;
      }
      if (gap > bestGap) {
        bestGap = gap;
        bx = x;
        by = y;
      }
    }
    Clue c;
    c.id = nextId_++;
    c.x = bx;
    c.y = c.baseY = by;
    c.gold = gold;
    c.value = gold ? 3 : 1;
    c.life = gold ? GOLD_LIFE : CLUE_LIFE;
    c.phase = (float)rng.next() * PI * 2;
    clues_.push_back(c);
    wave(bx * S, by * S, 4, (gold ? 80 : 56) * S, 360, gold ? Color::hex(0xffd24a) : Color::hex(0x7fe8ff));
  }

  // A clue shaken loose by a searchlight: it pops out and flutters down for anyone to catch.
  void dropClue(int i) {
    const Flyer& f = gl_[i].f;
    Clue c;
    c.id = nextId_++;
    c.x = f.x;
    c.y = f.y - 20;
    c.drop = true;
    c.life = DROP_LIFE;
    c.vx = (rng.chance(0.5) ? -1 : 1) * (90 + 80 * (float)rng.next());
    c.vy = -330;
    c.wait = 380;
    c.owner = i;
    c.phase = (float)rng.next() * PI * 2;
    clues_.push_back(c);
    app.audio.sfx("bad", 0.6f);
  }

  void updateClues(float ms) {
    float s = ms / 1000;
    for (auto& c : clues_) {
      c.age += ms;
      c.life -= ms;
      if (c.wait > 0) c.wait -= ms;
      if (c.drop) {
        c.vy = c.vy < 70 ? c.vy + 1100 * s : 70;
        c.vx *= std::exp(-2.2f * s);
        c.x = clampf(c.x + (c.vx + std::sin(c.age / 260) * 60) * s, 90, 1830);
        c.y += c.vy * s;
        float floor = roofAt(c.x) - 30;
        if (c.y > floor) {
          c.y = floor;
          c.vy = 0;
        }
      } else c.y = c.baseY + std::sin(c.age / 420 + c.phase) * 7;
      if (c.life <= 0) c.gone = true;
    }
  }

  void collect(int i, Clue& c) {
    Glider& g = gl_[i];
    score_[i] += c.value;
    g.streak = time_ * 1000 - g.lastCatch < STREAK_MS ? g.streak + 1 : 1;
    g.lastCatch = time_ * 1000;
    c.gone = true;
    Color gold = Color::hex(0xffe36b);
    word(c.gold ? "+3" : "+1", c.x * S + (c.x < 960 ? 26 : -26), c.y * S - 26, 24, c.gold ? gold : col::white, 600);
    wave(c.x * S, c.y * S, 6, (c.gold ? 120 : 70) * S, c.gold ? 420 : 320, c.gold ? Color::hex(0xffd24a) : Color::hex(0x7fe8ff));
    if (c.gold) word("BIG CLUE!", c.x * S, c.y * S - 52, 24, Color::hex(0xffbf2a), 520);
    const char* streak = g.streak == 3 ? "x3 STREAK!" : g.streak == 5 ? "x5 STREAK!" : g.streak == 8 ? "x8 STREAK!" : nullptr;
    if (streak) word(streak, g.f.x * S, (g.f.y - 150) * S, 22, Color::hex(0xc8f6ff), 560);
    app.audio.sfx("coin", c.gold ? 1.0f : 0.7f);
  }

  // The beam's hold on a glider builds (an alarm ring closes in); held long enough, they're spotted.
  void searchlights(int i, float ms) {
    Glider& g = gl_[i];
    Flyer& f = g.f;
    if (f.invuln > 0 || f.mode == STUN) {
      g.lock = 0;
      return;
    }
    int lit = -1;
    for (int b = 0; b < (int)beams_.size(); b++)
      if (inBeam(*beams_[b].lamp, beams_[b].angle, f.x, f.y)) lit = b;
    if (lit < 0) {
      g.lock = std::max(0.0f, g.lock - ms * 2);
      return;
    }
    g.lock += ms;
    beamHeat_[lit] = std::min(1.0f, beamHeat_[lit] + ms / 200);
    if (g.lock < CATCH_MS) return;
    // caught: dazed, spun round, and a clue shaken loose
    g.lock = 0;
    spotted(f);
    g.streak = 0;
    beamFlash_[lit] = 320;
    g.spin = 0;
    word("SPOTTED!", f.x * S, (f.y - 140) * S, 26, Color::hex(0xff7a5c), 620);
    wave(f.x * S, f.y * S, 6, 110 * S, 380, Color::hex(0xff6a4a));
    app.audio.sfx("bump", 0.7f);
    if (score_[i] > 0) {
      score_[i]--;
      dropClue(i);
    }
  }

  void flightFx(int i, Mode was) {
    const FlyEvents& e = gl_[i].ev;
    const Flyer& f = gl_[i].f;
    if (e.leap) app.audio.sfx("dash", 0.5f);
    if (e.swoop > 380) {
      wave(f.x * S, f.y * S, 6, 90 * S, 320, color(i));
      if (e.swoop > 540) word("SWOOP!", f.x * S, (f.y - 150) * S, 20, Color::hex(0x8fe6ff), 360);
    }
    if (e.hardLand) app.audio.sfx("bump", 0.5f);
    if (e.bonk && was != ROOF) wave((f.x + f.face * 30) * S, f.y * S, 2, 14, 200, col::white);
  }

  void syncGlider(Glider& g, float s) {
    const Flyer& f = g.f;
    float target = 0;
    if (f.mode == DIVE) target = f.face * clampf(std::atan2(f.vy, std::fabs(f.vx) + 1) * 0.75f, -0.2f, 0.95f);
    else if (f.mode == GLIDE) target = f.face * clampf(f.vx / 2400 + f.vy / 1800, -0.18f, 0.2f);
    g.tilt += (target - g.tilt) * (1 - std::exp(-12 * s));
    if (g.spin >= 0 && (g.spin += s * 1000) > 520) g.spin = -1;
    bool open = f.mode == GLIDE && !(f.rise && f.vy < -200);
    g.cape += ((open ? 1 : 0) - g.cape) * (1 - std::exp(-(open ? 16 : 20) * s));
    float want = g.cape > 0.5f ? CANOPY_Y + 2 : -96;
    g.markY += (want - g.markY) * (1 - std::exp(-10 * s));
  }

  void word(const std::string& text, float x, float y, int size, Color c, float hold) { words_.push_back(Word{text, x, y, 0, hold, size, c}); }
  void wave(float x, float y, float r0, float r1, float dur, Color c) { waves_.push_back(Wave{x, y, r0, r1, 0, dur, c}); }

  // --- Drawing ------------------------------------------------------------------------------------
  void draw() override {
    drawArena();
    // the hot air rising from each vent: a faint column with streaks climbing it
    for (int v = 0; v < NVENTS; v++) {
      const Vent& vt = VENTS[v];
      float a = 0.06f + 0.02f * std::sin(time_ * 3.3f + v);
      app.gfx.rect((vt.x - vt.half * 1.1f) * S, (G::CEIL - 10) * S, vt.half * 2.2f * S, (vt.y - 20 - G::CEIL + 10) * S, Color(191, 230, 255, (unsigned char)(255 * a)));
    }
    for (auto& st : streaks_) {
      int v = (int)(&st - &streaks_[0]) / 6;
      float u = (VENTS[v].y - st.y) / (VENTS[v].y - G::CEIL);
      float a = 0.42f * std::sin(std::min(1.0f, u) * PI);
      float x = st.x + std::sin(st.y / 60) * 6;
      app.gfx.line(x * S, st.y * S, x * S, (st.y + 34) * S, 2, Color(230, 246, 255, (unsigned char)(255 * a)));
    }
    // searchlights: a stepped cone along the beam, the lamp head turning with it and its glowing lens
    Tex* head = app.gfx.tex("mg/heroes_lamp_head.png");
    for (int b = 0; b < (int)beams_.size(); b++) {
      const Beam& bm = beams_[b];
      float hot = beamFlash_[b] > 0 ? 1 : beamHeat_[b];
      Color tint = beamFlash_[b] > 0 ? Color::hex(0xff7a5a) : (hot > 0.05f ? Color::hex(0xffd9a0) : Color::hex(0xfff1c4));
      float sa = std::sin(bm.angle), ca = std::cos(bm.angle);
      float lx = bm.lamp->x + sa * 4, ly = bm.lamp->y - ca * 4;
      const int segs = 9;
      for (int k = 0; k < segs; k++) {
        float d0 = 40 + (BEAM_LEN - 40) * k / segs, d1 = 40 + (BEAM_LEN - 40) * (k + 1) / segs, dm = (d0 + d1) / 2;
        float w = 2 * std::tan(BEAM_HALF) * dm * 1.2f;
        float along = std::min(1.0f, (1 - dm / BEAM_LEN) / 0.15f);
        Color c = tint.alpha((0.16f + 0.12f * hot) * along);
        app.gfx.line((lx + sa * d0) * S, (ly - ca * d0) * S, (lx + sa * d1) * S, (ly - ca * d1) * S, w * S, c);
        app.gfx.line((lx + sa * d0) * S, (ly - ca * d0) * S, (lx + sa * d1) * S, (ly - ca * d1) * S, w * 0.4f * S, col::white.alpha(0.12f * along));
      }
      SDL_Rect src{0, 0, head->w, head->h};
      app.gfx.sprite(head, src, bm.lamp->x * S, (bm.lamp->y + 18) * S, 1, 1, 0.5f, 44.0f / 60, bm.angle * 57.29578f);
      app.gfx.circle(lx * S, ly * S, 10 + 4 * hot, tint.alpha(0.45f));
      app.gfx.circle(lx * S, ly * S, 4, col::white);
    }
    // clues: a glowing badge with a magnifying glass on it
    for (auto& c : clues_) {
      if (c.life < 1500 && (int)(c.life / 110) % 2) continue;
      float x = c.x * S, y = c.y * S, r = c.gold ? 15 : 11.5f;
      float pulse = 0.5f + 0.5f * std::sin(c.age / 180 + c.phase);
      Color body = c.gold ? Color::hex(0xffd24a) : Color::hex(0x5ce1ff);
      app.gfx.circle(x, y, r * 2.1f, body.alpha(0.18f + 0.12f * pulse));
      app.gfx.circle(x, y + 1.5f, r + 2, Color(10, 20, 40, 90));
      app.gfx.circle(x, y, r + 2, col::white);
      app.gfx.circle(x, y, r, body);
      app.gfx.circle(x, y - r * 0.3f, r * 0.6f, body.mix(col::white, 0.4f));
      app.gfx.ring(x - r * 0.1f, y - r * 0.1f, r * 0.42f, col::white);
      app.gfx.line(x + r * 0.15f, y + r * 0.15f, x + r * 0.5f, y + r * 0.5f, 2.5f, col::white);
    }
    // gliders: shadow on the roof below, then the cape and the body
    for (int i = 0; i < count(); i++) {
      const Flyer& f = gl_[i].f;
      float floor = roofAt(f.x);
      float u = std::min(1.0f, std::max(0.0f, floor - (f.y + G::BODY)) / 520);
      spr::shadow(f.x * S, floor * S + 1, 40 * (0.9f - 0.5f * u), 0.5f - 0.38f * u);
    }
    for (int i = 0; i < count(); i++) drawGlider(i);
    // the searchlight alarm: a ring closing in on a glider the beam is holding
    for (int i = 0; i < count(); i++) {
      const Glider& g = gl_[i];
      if (g.lock <= 0) continue;
      float u = std::min(1.0f, g.lock / CATCH_MS);
      Color c = u > 0.6f ? Color::hex(0xff5a3c) : Color::hex(0xffc24a);
      float r = (86 - 44 * u) * S;
      app.gfx.ring(g.f.x * S, g.f.y * S, r, c.alpha(0.55f + 0.45f * u));
      for (int k = 0; k < 4; k++) {
        float a = k * PI / 2 + time_ * 3.3f;
        app.gfx.circle(g.f.x * S + std::cos(a) * r, g.f.y * S + std::sin(a) * r, 3, c);
      }
    }
    for (auto& w : waves_) {
      float u = w.t / w.dur;
      app.gfx.ring(w.x, w.y, lerpf(w.r0, w.r1, easeOut(u)), w.c.alpha(0.9f * (1 - u)));
    }
    for (int i = 0; i < count(); i++) {
      const Glider& g = gl_[i];
      float m = g.markY - 6;
      drawPlayerTag(i, (g.f.x - m * std::sin(g.tilt)) * S, (g.f.y + m * std::cos(g.tilt)) * S - 6);
    }
    for (auto& w : words_) {
      float pop = std::min(1.0f, w.t / 160);
      float a = w.t > w.hold ? std::max(0.0f, 1 - (w.t - w.hold) / 250) : 1;
      app.gfx.text(w.text, w.x, w.y - w.t * 0.018f, w.size, w.c.alpha(a), CENTER, true, 0.6f + 0.4f * easeBack(pop));
    }
    drawTimer(DURATION - time_);
    drawScores(score_, "clues");
  }

  void drawGlider(int i) {
    const Glider& g = gl_[i];
    const Flyer& f = g.f;
    int c = player(i).character;
    float x = f.x * S, y = f.y * S;
    float tilt = g.tilt + (g.spin >= 0 ? 2 * PI * f.face * (1 - std::pow(1 - g.spin / 520, 3.0f)) : 0);
    Color pc = color(i);
    float alpha = (f.invuln > 0 && f.mode != STUN) ? ((int)(time_ * 11) % 2 ? 0.45f : 1) : 1;
    // the folded cape streaming out behind while diving
    bool air = f.mode == GLIDE || f.mode == DIVE;
    float trail = air ? clampf((0.6f - g.cape) / 0.6f, 0, 1) : 0;
    if (trail > 0.05f) {
      float sp = 0.8f + std::min(0.4f, std::hypot(f.vx, f.vy) / 1800);
      float bx = f.x - std::sin(tilt) * -40, by = f.y + std::cos(tilt) * -40;
      float ex = bx - f.face * 70 * sp * std::cos(tilt), ey = by - f.face * 70 * sp * std::sin(tilt) + 8;
      app.gfx.line(bx * S, by * S, ex * S, ey * S, 7, pc.mix(col::black, 0.2f).alpha(trail * alpha));
    }
    // the open canopy over the raised hands
    if (g.cape > 0.03f) {
      float a = std::min(1.0f, g.cape * 1.6f) * alpha;
      float cy0 = CANOPY_Y + (1 - g.cape) * 30;
      float cx = f.x - cy0 * std::sin(tilt), cy = f.y + cy0 * std::cos(tilt);
      float rx = CANOPY_W / 2 * (0.35f + 0.65f * g.cape) * S, ry = 26 * (0.6f + 0.4f * g.cape) * S;
      float hx = f.x - (-50) * std::sin(tilt), hy = f.y + (-50) * std::cos(tilt);
      app.gfx.line(cx * S - rx * 0.8f, cy * S + ry * 0.4f, hx * S, hy * S, 1.5f, col::white.alpha(0.7f * a));
      app.gfx.line(cx * S + rx * 0.8f, cy * S + ry * 0.4f, hx * S, hy * S, 1.5f, col::white.alpha(0.7f * a));
      app.gfx.ellipse(cx * S, cy * S + 3, rx, ry, Color(8, 14, 30, (unsigned char)(80 * a)));
      app.gfx.ellipse(cx * S, cy * S, rx + 2, ry + 2, col::white.alpha(a));
      app.gfx.ellipse(cx * S, cy * S, rx, ry, pc.mix(col::black, 0.25f).alpha(a));
      app.gfx.ellipse(cx * S, cy * S - ry * 0.25f, rx * 0.92f, ry * 0.7f, pc.alpha(a));
      app.gfx.ellipse(cx * S, cy * S - ry * 0.45f, rx * 0.6f, ry * 0.35f, pc.mix(col::white, 0.3f).alpha(a));
    }
    const char* anim = "idle";
    int frame = -1;
    if (f.mode == ROOF) {
      if (f.stunT > 0) {
        anim = "stunned";
        frame = 1;
      } else anim = std::fabs(f.vx) > 60 ? "run" : "idle";
    } else if (f.mode == STUN) {
      anim = "fall";
      frame = 0;
    } else if (f.mode == DIVE) {
      anim = "dash";
      frame = 0;
    } else {
      anim = "jump";
      frame = f.rise && f.vy < -200 ? 1 : 2;
    }
    characterRot(c, anim, frame, time_, x, y, CHAR_SCALE, f.face < 0, f.mode == ROOF ? 0 : tilt, G::BODY * S, col::white.alpha(alpha));
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override { return score_; }
  std::string scoreLabel(int i) const override { return std::to_string(score_[i]) + (score_[i] == 1 ? " clue" : " clues"); }

 private:
  std::vector<Glider> gl_;
  std::vector<int> score_;
  std::vector<Clue> clues_;
  std::vector<Beam> beams_;
  std::vector<float> beamHeat_ = std::vector<float>(NLAMPS, 0.0f), beamFlash_ = std::vector<float>(NLAMPS, 0.0f);
  std::vector<Streak> streaks_;
  std::vector<Word> words_;
  std::vector<Wave> waves_;
  View view_;
  float time_ = 0, spawnT_ = 900, beamSpeed_ = 1;
  bool storm_ = false;
  int nextId_ = 1;
};

}  // namespace

REGISTER_MINIGAME("rooftop-glide", RooftopGlide);

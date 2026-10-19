// Slapshot Showdown (Showtime Strip): a four-sided ice rink where everyone guards the goal on their side. Skate
// into the puck to pick it up, hold A to wind up a slapshot and let go to fire it into a rival goal (+2); every
// goal you let in costs 1. Without the puck, A is a body check that knocks a carrier's puck loose. A second puck
// drops in for the last 10 seconds. (Port of src/game/worlds/rink/games/Slapshot.ts + slapshotRules.ts.)
#include <algorithm>
#include <array>
#include <cmath>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "../game/Ui.h"
#include "Minigame.h"

namespace {

constexpr float PI_F = 3.14159265f;
constexpr float K = VW / 1920.0f;  // web canvas -> Wii canvas
// The rink is seen from 62 degrees up: world y (depth) is squashed by COSB on screen, heights lift by SINB.
constexpr float COSB = 0.8829476f, SINB = 0.4694716f;

// --- Rules (slapshotRules.ts), world px / seconds ---
constexpr float RINK_CX = 960, RINK_CY = 628 / COSB, RINK_HALF = 450, RINK_CORNER = 130;
constexpr float GOAL_W = 180, GOAL_D = 52, GOAL_INSET = 60, GOAL_POST = 8;
constexpr float PUCK_R = 13, SKATER_R = 34;
constexpr float ASSIST = 0.24f;
constexpr float WINDUP_MS = 750, PUCK_FRICTION = 95, PUCK_DRAG = 0.22f, PUCK_BOUNCE = 0.82f;
constexpr float ROUND_MS = 60000, FINAL_MS = 10000;

// --- Scene tuning (Slapshot.ts) ---
constexpr float CHAR_SCALE = 0.8f;
constexpr float SKATE_MAX = 440, SKATE_ACCEL = 1150, GLIDE_DRAG = 0.85f;
constexpr float CHECK_MS = 190, CHECK_SPEED = 780, CHECK_CD = 950, STUN_MS = 440;
constexpr float CATCH_V = 950, SHOT_COOL = 260;
constexpr float STICK_REACH = SKATER_R + PUCK_R + 4, PICK_R = SKATER_R + PUCK_R + 14;
constexpr float SUB = 1.0f / 120;
constexpr float DROP_Z = 420, RESPAWN_MS = 1200;

enum Side { LEFT_S = 0, RIGHT_S = 1, TOP_S = 2, BOTTOM_S = 3 };

struct Vec {
  float x, y;
};

struct Skill {
  float accuracy, mistake, aimNoise, think;
};
const Skill SKILL[3] = {{0.55f, 0.24f, 0.55f, 700}, {0.78f, 0.11f, 0.28f, 420}, {0.9f, 0.05f, 0.13f, 240}};

std::vector<int> goalSides(int n) {
  if (n <= 2) return {LEFT_S, RIGHT_S};
  if (n == 3) return {LEFT_S, RIGHT_S, BOTTOM_S};
  return {LEFT_S, RIGHT_S, TOP_S, BOTTOM_S};
}

struct GoalGeom {
  int side;
  float mx, my, nx, ny, tx, ty;
  Vec posts[2];
  Vec walls[3][2];
};

GoalGeom goalGeom(int side) {
  GoalGeom g;
  g.side = side;
  float off = RINK_HALF - GOAL_INSET;
  g.nx = side == LEFT_S ? -1.0f : (side == RIGHT_S ? 1.0f : 0.0f);
  g.ny = side == TOP_S ? -1.0f : (side == BOTTOM_S ? 1.0f : 0.0f);
  g.tx = -g.ny;
  g.ty = g.nx;
  g.mx = RINK_CX + g.nx * off;
  g.my = RINK_CY + g.ny * off;
  float hw = GOAL_W / 2;
  Vec p1{g.mx + g.tx * hw, g.my + g.ty * hw}, p2{g.mx - g.tx * hw, g.my - g.ty * hw};
  Vec b1{p1.x + g.nx * GOAL_D, p1.y + g.ny * GOAL_D}, b2{p2.x + g.nx * GOAL_D, p2.y + g.ny * GOAL_D};
  g.posts[0] = p1;
  g.posts[1] = p2;
  g.walls[0][0] = b1;
  g.walls[0][1] = b2;
  g.walls[1][0] = p1;
  g.walls[1][1] = b1;
  g.walls[2][0] = p2;
  g.walls[2][1] = b2;
  return g;
}

float sgn(float v) { return v > 0 ? 1.0f : (v < 0 ? -1.0f : 0.0f); }

// Keep a circle inside the rounded-square boards, reflecting its velocity. Returns the impact speed.
template <typename B>
float boards(B& b, float r, float e) {
  float lim = RINK_HALF - r, cr = RINK_CORNER - r, inner = RINK_HALF - RINK_CORNER;
  float dx = b.x - RINK_CX, dy = b.y - RINK_CY, hit = 0;
  if (std::fabs(dx) > inner && std::fabs(dy) > inner) {
    float ox = sgn(dx) * inner, oy = sgn(dy) * inner;
    float qx = dx - ox, qy = dy - oy, d = std::hypot(qx, qy);
    if (d > cr && d > 0) {
      float nx = qx / d, ny = qy / d;
      dx = ox + nx * cr;
      dy = oy + ny * cr;
      float vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
        hit = vn;
      }
    }
  } else {
    if (dx > lim || dx < -lim) {
      dx = sgn(dx) * lim;
      if (b.vx * sgn(dx) > 0) {
        hit = std::fabs(b.vx);
        b.vx = -b.vx * e;
      }
    }
    if (dy > lim || dy < -lim) {
      dy = sgn(dy) * lim;
      if (b.vy * sgn(dy) > 0) {
        hit = std::max(hit, std::fabs(b.vy));
        b.vy = -b.vy * e;
      }
    }
  }
  b.x = RINK_CX + dx;
  b.y = RINK_CY + dy;
  return hit;
}

// Push a circle out of a segment, reflecting its velocity. Returns the impact speed.
template <typename B>
float segment(B& b, float r, Vec a, Vec c, float e) {
  float sx = c.x - a.x, sy = c.y - a.y;
  float L2 = sx * sx + sy * sy;
  if (L2 == 0) L2 = 1;
  float u = clampf(((b.x - a.x) * sx + (b.y - a.y) * sy) / L2, 0, 1);
  float px = a.x + sx * u, py = a.y + sy * u;
  float dx = b.x - px, dy = b.y - py, d = std::hypot(dx, dy);
  if (d >= r || d < 1e-6f) return 0;
  float nx = dx / d, ny = dy / d;
  b.x = px + nx * r;
  b.y = py + ny * r;
  float vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  return -vn;
}

template <typename B>
float goalFrame(B& b, float r, const GoalGeom& g, float e) {
  float hit = 0;
  for (const Vec& p : g.posts) hit = std::max(hit, segment(b, r + GOAL_POST, p, p, e));
  for (const auto& w : g.walls) hit = std::max(hit, segment(b, r + 3, w[0], w[1], e));
  return hit;
}

bool crossedGoal(float px, float py, float x, float y, const GoalGeom& g) {
  float before = (px - g.mx) * g.nx + (py - g.my) * g.ny;
  float after = (x - g.mx) * g.nx + (y - g.my) * g.ny;
  if (before > 0 || after <= 0) return false;
  float along = (x - g.mx) * g.tx + (y - g.my) * g.ty;
  return std::fabs(along) < GOAL_W / 2 - PUCK_R * 0.5f;
}

// The gentle aim assist: a shot missing a rival mouth by less than ASSIST radians is turned onto it.
Vec assistAim(Vec aim, float px, float py, const std::vector<GoalGeom>& goals, int own) {
  float ax = aim.x, ay = aim.y, best = ASSIST, tx = 0, ty = 0;
  for (const auto& g : goals) {
    if (g.side == own) continue;
    float inset = GOAL_W / 2 - 26;
    float x1 = g.mx + g.tx * inset - px, y1 = g.my + g.ty * inset - py;
    float x2 = g.mx - g.tx * inset - px, y2 = g.my - g.ty * inset - py;
    float c12 = x1 * y2 - y1 * x2;
    bool between = (x1 * ay - y1 * ax) * c12 >= 0 && (ax * y2 - ay * x2) * c12 >= 0 && ax * (x1 + x2) + ay * (y1 + y2) > 0;
    if (between) return aim;
    for (int k = 0; k < 2; k++) {
      float ex = k ? x2 : x1, ey = k ? y2 : y1;
      float d = std::hypot(ex, ey);
      if (d == 0) d = 1;
      float off = std::acos(clampf((ax * ex + ay * ey) / d, -1, 1));
      if (off < best) {
        best = off;
        tx = ex / d;
        ty = ey / d;
      }
    }
  }
  return best < ASSIST ? Vec{tx, ty} : aim;
}

float shotSpeed(float charge) { return 620 + 1180 * clampf(charge, 0, 1); }

// Where a sliding puck will be after t seconds (constant friction plus drag), for CPUs leading a loose puck.
Vec predict(float x, float y, float vx, float vy, float t) {
  float sp = std::hypot(vx, vy);
  if (sp < 1) return {x, y};
  const float F = PUCK_FRICTION, D = PUCK_DRAG;
  float tStop = std::log(1 + (D * sp) / F) / D;
  float tt = std::min(t, tStop);
  float dist = ((sp + F / D) * (1 - std::exp(-D * tt))) / D - (F / D) * tt;
  return {x + (vx / sp) * dist, y + (vy / sp) * dist};
}

enum Mode { CHASE, CARRY, CHARGE, DEFEND, HUNT, IDLE };

struct Input {
  float mx = 0, my = 0;
  bool held = false, pressed = false;
};

struct Skater {
  GoalGeom goal;
  float x = 0, y = 0, vx = 0, vy = 0, fx = 1, fy = 0;
  int carry = -1;
  bool charging = false;
  float charge = 0;
  float checkT = 0, checkCd = 0, stunT = 0, swingT = 0, hitImm = 0;
  float emoteT = 0;
  const char* emote = "celebrate";
  Input in;
  bool faceLeft = false;
  const char* anim = "idle";
  float animT = 0;
  // CPU
  Mode mode = IDLE;
  float aiT = 0, tx = 0, ty = 0, aimX = RINK_CX, aimY = RINK_CY, chargeGoal = 0.6f;
  bool checkWish = false;
};

struct Puck {
  bool on = false;
  float x = RINK_CX, y = RINK_CY, vx = 0, vy = 0, z = 0, vz = 0, px = 0, py = 0;
  int holder = -1, last = -1;
  float cool = 0, respawn = -1;
  std::array<float, 8> trx{}, try_{};
  int tn = 0;
};

struct GoalView {
  GoalGeom g;
  int owner = -1;
  float lampT = 0, flashT = 0;
};

struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size;
};

void normalizeFacing(Skater& s) {
  float m = std::hypot(s.fx, s.fy);
  if (m < 1e-6f) {
    s.fx = 1;
    s.fy = 0;
    return;
  }
  s.fx /= m;
  s.fy /= m;
}

inline float SX(float x) { return x * K; }
inline float SY(float y, float z = 0) { return (y * COSB - z * SINB) * K; }

class Slapshot : public Minigame {
 public:
  void start() override {
    std::vector<int> sides = goalSides(count());
    for (int i = 0; i < count(); i++) {
      Skater s;
      s.goal = goalGeom(sides[i]);
      s.x = s.goal.mx - s.goal.nx * 170;
      s.y = s.goal.my - s.goal.ny * 170;
      s.fx = -s.goal.nx;
      if (s.fx == 0) s.fx = (s.x > RINK_CX ? -1 : 1) * 0.001f;
      s.fy = -s.goal.ny;
      normalizeFacing(s);
      s.aiT = 300 + i * 90;
      s.tx = s.x;
      s.ty = s.y;
      s.faceLeft = s.fx < 0;
      sk_.push_back(s);
    }
    for (int side : sides) {
      GoalView gv;
      gv.g = goalGeom(side);
      for (int i = 0; i < count(); i++)
        if (sk_[i].goal.side == side) gv.owner = i;
      goals_.push_back(gv);
      geoms_.push_back(gv.g);
    }
    score_.assign(count(), 0);
    pk_.resize(2);
  }

  // --- Pucks ---
  void faceOff(Puck& p, float delay) {
    p.on = true;
    p.holder = -1;
    p.last = -1;
    p.x = RINK_CX + ((float)rng.next() - 0.5f) * 30;
    p.y = RINK_CY + ((float)rng.next() - 0.5f) * 30;
    p.px = p.x;
    p.py = p.y;
    p.vx = p.vy = 0;
    p.z = DROP_Z + delay * 0.6f;
    p.vz = 0;
    p.cool = 0;
    p.tn = 0;
    p.respawn = -1;
  }

  void pop(const std::string& s, float x, float y, Color c, int size = 20, float life = 0.9f) { pops_.push_back({s, x, y, 0, life, c, size}); }

  Vec aimOf(const Skater& s, const Puck& p) const {
    float ax = s.in.mx, ay = s.in.my / COSB;
    float am = std::hypot(ax, ay);
    if (am < 0.3f) {
      ax = s.fx;
      ay = s.fy;
    } else {
      ax /= am;
      ay /= am;
    }
    return assistAim({ax, ay}, p.x, p.y, geoms_, s.goal.side);
  }

  void shoot(Skater& s) {
    s.charging = false;
    if (s.carry < 0) return;
    Puck& p = pk_[s.carry];
    Vec aim = aimOf(s, p);
    float v = shotSpeed(s.charge);
    p.holder = -1;
    p.last = (int)(&s - &sk_[0]);
    p.cool = SHOT_COOL;
    p.vx = aim.x * v + s.vx * 0.3f;
    p.vy = aim.y * v + s.vy * 0.3f;
    s.carry = -1;
    s.fx = aim.x;
    s.fy = aim.y;
    s.swingT = 170;
    app.audio.sfx("dash", 0.4f + 0.4f * s.charge);
    if (s.charge > 0.7f) pop("SLAPSHOT!", SX(p.x), SY(p.y) - 34, Color::hex(0xffb020), 18, 0.7f);
    s.charge = 0;
  }

  void pickUp(int si, int pi) {
    Puck& p = pk_[pi];
    p.holder = si;
    p.last = si;
    p.vx = p.vy = 0;
    sk_[si].carry = pi;
    app.audio.sfx("move", 0.3f);
  }

  void knockLoose(Skater& s, float dx, float dy, float speed) {
    if (s.carry < 0) return;
    Puck& p = pk_[s.carry];
    s.carry = -1;
    s.charging = false;
    s.charge = 0;
    p.holder = -1;
    p.cool = 0;
    p.vx = dx * speed + s.vx * 0.4f;
    p.vy = dy * speed + s.vy * 0.4f;
  }

  void goalScored(Puck& p, GoalView& gv) {
    int si = p.last, oi = gv.owner;
    std::vector<int> before = score_;
    if (si >= 0 && si != oi) score_[si] += 2;
    if (oi >= 0) score_[oi] = std::max(0, score_[oi] - 1);
    p.on = false;
    p.holder = -1;
    p.respawn = RESPAWN_MS;
    gv.lampT = 900;
    gv.flashT = 700;
    float sx = SX(gv.g.mx), sy = SY(gv.g.my);
    if (si >= 0 && si != oi) {
      pop("GOAL!", sx - gv.g.nx * 50, sy - 50, color(si), 30, 1.1f);
      pop("+2", sx - gv.g.nx * 50, sy - 24, color(si), 22, 1.0f);
      sk_[si].emoteT = 900;
      sk_[si].emote = "celebrate";
      app.audio.sfx("coin");
    } else {
      pop("OWN GOAL!", sx - gv.g.nx * 50, sy - 50, col::gold, 26, 1.1f);
    }
    if (oi >= 0 && before[oi] > score_[oi]) {
      pop("-1", sx - gv.g.nx * 20, sy - 4, Color::hex(0xff8a7a), 22, 1.0f);
      if (oi != si) {
        sk_[oi].emoteT = 900;
        sk_[oi].emote = "disappointed";
      }
      app.audio.sfx("bad", 0.6f);
    }
  }

  // --- Frame ---
  void update(float dt) override {
    float dms = dt * 1000;
    if (ms_ == 0) faceOff(pk_[0], 0);
    ms_ += dms;
    if (!final_ && ms_ >= ROUND_MS - FINAL_MS) {
      final_ = true;
      bannerT_ = 1.6f;
      for (auto& p : pk_)
        if (!p.on && p.respawn < 0) {
          faceOff(p, 350);
          break;
        }
    }
    bannerT_ -= dt;
    for (auto& p : pk_)
      if (!p.on && p.respawn > 0) {
        p.respawn -= dms;
        if (p.respawn <= 0) faceOff(p, 0);
      }
    for (int i = 0; i < count(); i++) {
      Skater& s = sk_[i];
      if (isCpu(i)) cpuThink(i, dms);
      else {
        s.in.mx = pad(i).x;
        s.in.my = pad(i).y;
        s.in.held = pad(i).down(B_A);
        s.in.pressed = pad(i).press(B_A);
      }
    }
    for (auto& s : sk_) control(s, dms);
    int n = std::max(1, (int)std::ceil(dt / SUB));
    for (int k = 0; k < n; k++) stepPhysics(dt / n);
    for (auto& gv : goals_) {
      gv.lampT = std::max(0.0f, gv.lampT - dms);
      gv.flashT = std::max(0.0f, gv.flashT - dms);
    }
    for (auto& s : sk_) animate(s, dt);
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
  }

  void control(Skater& s, float dt) {
    s.checkCd = std::max(0.0f, s.checkCd - dt);
    s.swingT = std::max(0.0f, s.swingT - dt);
    s.hitImm -= dt;
    s.emoteT -= dt;
    if (s.stunT > 0) {
      s.stunT -= dt;
      s.charging = false;
      return;
    }
    if (s.checkT > 0) s.checkT -= dt;
    if (s.charging) {
      if (s.carry < 0) s.charging = false;
      else {
        s.charge = std::min(1.0f, s.charge + dt / WINDUP_MS);
        if (!s.in.held) shoot(s);
      }
      return;
    }
    if (s.in.pressed) {
      if (s.carry >= 0) {
        s.charging = true;
        s.charge = 0;
      } else if (s.checkCd <= 0) startCheck(s);
    }
  }

  void startCheck(Skater& s) {
    float dx = s.in.mx, dy = s.in.my / COSB, m = std::hypot(dx, dy);
    if (m < 0.3f) {
      dx = s.fx;
      dy = s.fy;
    } else {
      dx /= m;
      dy /= m;
    }
    s.fx = dx;
    s.fy = dy;
    s.vx = dx * CHECK_SPEED;
    s.vy = dy * CHECK_SPEED;
    s.checkT = CHECK_MS;
    s.checkCd = CHECK_CD;
    app.audio.sfx("dash", 0.5f);
  }

  void turnToward(Skater& s, float x, float y, float k) {
    float m = std::hypot(x, y);
    if (m < 1e-4f) return;
    float t = std::min(1.0f, k);
    s.fx += (x / m - s.fx) * t;
    s.fy += (y / m - s.fy) * t;
    normalizeFacing(s);
  }

  void stepPhysics(float dt) {
    for (auto& s : sk_) {
      if (s.stunT > 0 || s.checkT > 0) {
        float d = std::exp(-(s.stunT > 0 ? 2.2f : 0.6f) * dt);
        s.vx *= d;
        s.vy *= d;
      } else {
        float mx = s.in.mx, my = s.in.my / COSB, m = std::hypot(mx, my);
        float mx2 = mx, my2 = my;
        float max = SKATE_MAX * (s.charging ? 0.35f : (s.carry >= 0 ? 0.9f : 1.0f));
        if (m > 0.2f) {
          mx2 /= std::max(1.0f, m);
          my2 /= std::max(1.0f, m);
          float tvx = mx2 * max, tvy = my2 * max;
          float dvx = tvx - s.vx, dvy = tvy - s.vy, dl = std::hypot(dvx, dvy);
          float step = SKATE_ACCEL * dt;
          if (dl <= step) {
            s.vx = tvx;
            s.vy = tvy;
          } else {
            s.vx += dvx / dl * step;
            s.vy += dvy / dl * step;
          }
          if (!s.charging) turnToward(s, mx2, my2, dt * 9);
        } else {
          float d = std::exp(-(s.charging ? 3 : GLIDE_DRAG) * dt);
          s.vx *= d;
          s.vy *= d;
        }
        if (s.charging && m > 0.3f) turnToward(s, mx2, my2, dt * 14);
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      boards(s, SKATER_R, 0.35f);
      for (auto& gv : goals_) {
        goalFrame(s, SKATER_R, gv.g, 0.3f);
        segment(s, SKATER_R, gv.g.posts[0], gv.g.posts[1], 0.3f);
      }
    }
    for (int i = 0; i < count(); i++)
      for (int j = i + 1; j < count(); j++) bump(i, j);
    for (auto& p : pk_) {
      if (!p.on) continue;
      p.cool = std::max(0.0f, p.cool - dt * 1000);
      if (p.z > 0) {
        p.vz -= 2200 * dt;
        p.z = std::max(0.0f, p.z + p.vz * dt);
        if (p.z == 0) p.vz = 0;
        continue;
      }
      p.px = p.x;
      p.py = p.y;
      if (p.holder >= 0) {
        Skater& h = sk_[p.holder];
        p.x = h.x + h.fx * STICK_REACH;
        p.y = h.y + h.fy * STICK_REACH;
        p.vx = h.vx;
        p.vy = h.vy;
        if (std::fabs(p.x - RINK_CX) > RINK_HALF - PUCK_R || std::fabs(p.y - RINK_CY) > RINK_HALF - PUCK_R) boards(p, PUCK_R, 0.5f);
        for (auto& gv : goals_) {
          const GoalGeom& g = gv.g;
          bool inFront = std::fabs((h.x - g.mx) * g.tx + (h.y - g.my) * g.ty) < GOAL_W / 2 + 10;
          if (!inFront || !crossedGoal(p.px, p.py, p.x, p.y, g)) continue;
          h.carry = -1;
          h.charging = false;
          h.charge = 0;
          p.last = p.holder;
          p.holder = -1;
          goalScored(p, gv);
          break;
        }
      } else {
        // slide: constant friction plus a little drag
        float sp = std::hypot(p.vx, p.vy);
        if (sp > 0) {
          float k = std::max(0.0f, sp - PUCK_FRICTION * dt) / sp * std::exp(-PUCK_DRAG * dt);
          p.vx *= k;
          p.vy *= k;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        boards(p, PUCK_R, PUCK_BOUNCE);
        for (auto& gv : goals_) {
          if (crossedGoal(p.px, p.py, p.x, p.y, gv.g)) {
            goalScored(p, gv);
            break;
          }
          float fh = goalFrame(p, PUCK_R, gv.g, 0.6f);
          if (fh > 600) pop("POST!", SX(p.x), SY(p.y) - 26, col::white, 16, 0.6f);
        }
        if (!p.on) continue;
        puckVsSkaters((int)(&p - &pk_[0]));
      }
    }
  }

  void bump(int ia, int ib) {
    Skater &a = sk_[ia], &b = sk_[ib];
    float dx = b.x - a.x, dy = b.y - a.y, d = std::hypot(dx, dy), mn = SKATER_R * 2;
    if (d >= mn || d < 1e-6f) return;
    float nx = dx / d, ny = dy / d, push = (mn - d) / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
    float rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rv <= 0) return;
    float imp = rv * 1.3f / 2;
    a.vx -= imp * nx;
    a.vy -= imp * ny;
    b.vx += imp * nx;
    b.vy += imp * ny;
    bool aHits = a.checkT > 0, bHits = b.checkT > 0;
    if (aHits || bHits || rv > 340) {
      Skater* victim = aHits ? &b : (bHits ? &a : (a.carry >= 0 ? &a : (b.carry >= 0 ? &b : nullptr)));
      if (victim && victim->carry >= 0) {
        Skater* hitter = victim == &a ? &b : &a;
        float kx = victim == &a ? -nx : nx, ky = victim == &a ? -ny : ny;
        knockLoose(*victim, kx, ky, 380);
        pop("CHECK!", SX((a.x + b.x) / 2), SY((a.y + b.y) / 2) - 60, Color::hex(0xffb3d9), 18, 0.7f);
        if (hitter->checkT > 0) daze(*victim, kx, ky);
      } else if (aHits || bHits) {
        daze(aHits ? b : a, aHits ? nx : -nx, aHits ? ny : -ny);
      }
      app.audio.sfx("bump", std::min(0.7f, rv / 700 + 0.25f));
    }
  }

  void daze(Skater& s, float kx, float ky) {
    if (s.hitImm > 0) return;
    s.hitImm = STUN_MS + 500;
    s.stunT = STUN_MS;
    s.charging = false;
    s.charge = 0;
    s.vx += kx * 260;
    s.vy += ky * 260;
  }

  // A slow loose puck is gathered in by the stick; a fast one only stops if it hits the body, and bounces off.
  void puckVsSkaters(int pi) {
    Puck& p = pk_[pi];
    for (int i = 0; i < count(); i++) {
      Skater& s = sk_[i];
      if (s.carry >= 0 || s.stunT > 0) continue;
      if (p.cool > 0 && p.last == i) continue;
      float sp = std::hypot(p.vx - s.vx, p.vy - s.vy);
      if (sp < CATCH_V) {
        float d = std::hypot(p.x - (s.x + s.fx * 18), p.y - (s.y + s.fy * 18));
        if (d <= PICK_R) {
          pickUp(i, pi);
          return;
        }
        continue;
      }
      float dx = p.x - s.x, dy = p.y - s.y, d = std::hypot(dx, dy), body = SKATER_R + PUCK_R - 6;
      if (d > body) continue;
      float nx = dx / (d > 0 ? d : 1), ny = dy / (d > 0 ? d : 1);
      float vn = (p.vx - s.vx) * nx + (p.vy - s.vy) * ny;
      if (vn < 0) {
        p.vx -= 1.5f * vn * nx;
        p.vy -= 1.5f * vn * ny;
        p.vx *= 0.7f;
        p.vy *= 0.7f;
        p.x = s.x + nx * body;
        p.y = s.y + ny * body;
        p.last = i;
        pop("BLOCKED!", SX(s.x), SY(s.y) - 70, Color::hex(0x7fdcff), 18, 0.7f);
        app.audio.sfx("bump", 0.5f);
      }
    }
  }

  void animate(Skater& s, float dt) {
    if (std::fabs(s.fx) > 0.15f) s.faceLeft = s.fx < 0;
    float speed = std::hypot(s.vx, s.vy);
    const char* want;
    if (s.stunT > 0) want = "stunned";
    else if (s.swingT > 0) want = "throw";
    else if (s.charging) want = "crouch";
    else if (s.checkT > 0) want = "dash";
    else if (s.emoteT > 0) want = s.emote;
    else if (speed < 50) want = "idle";
    else want = std::hypot(s.in.mx, s.in.my) > 0.2f ? "run" : "dash";
    if (want != s.anim) {
      s.anim = want;
      s.animT = 0;
    }
    s.animT += dt;
  }

  // --- CPU ---
  int nearestRival(int si, float& dOut) const {
    int best = -1;
    dOut = 1e9f;
    for (int j = 0; j < count(); j++) {
      if (j == si) continue;
      float d = std::hypot(sk_[j].x - sk_[si].x, sk_[j].y - sk_[si].y);
      if (d < dOut) {
        dOut = d;
        best = j;
      }
    }
    return best;
  }

  int carrierNear(int si, float r) const {
    for (int j = 0; j < count(); j++)
      if (j != si && sk_[j].carry >= 0 && std::hypot(sk_[j].x - sk_[si].x, sk_[j].y - sk_[si].y) < r) return j;
    return -1;
  }

  void setMove(Skater& s, float x, float y) {
    float m = std::hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    s.in.mx = x;
    s.in.my = y;
  }

  void cpuThink(int i, float dt) {
    Skater& s = sk_[i];
    s.in.pressed = false;
    if (s.stunT > 0) {
      setMove(s, 0, 0);
      s.in.held = false;
      return;
    }
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    s.aiT -= dt;
    if (s.aiT <= 0) {
      s.aiT = sk.think * (0.55f + 0.5f * (float)rng.next());
      cpuDecide(i);
    }
    if (s.charging) {
      setMove(s, s.aimX - s.x, (s.aimY - s.y) * COSB);
      float rd;
      bool rushed = nearestRival(i, rd) >= 0 && rd < 90;
      s.in.held = !(s.charge >= s.chargeGoal || rushed);
      return;
    }
    if (s.mode == CHARGE && s.carry >= 0) {
      s.in.pressed = true;
      s.in.held = true;
      setMove(s, s.aimX - s.x, (s.aimY - s.y) * COSB);
      return;
    }
    s.in.held = false;
    if (s.checkWish && s.checkCd <= 0 && s.carry < 0) {
      s.checkWish = false;
      int t = carrierNear(i, 125);
      if (t >= 0) {
        setMove(s, sk_[t].x - s.x, (sk_[t].y - s.y) * COSB);
        s.in.pressed = true;
        return;
      }
    }
    float dx = s.tx - s.x, dy = s.ty - s.y, d = std::hypot(dx, dy);
    if (d < 16) setMove(s, 0, 0);
    else {
      float k = std::min(1.0f, d / 120);
      setMove(s, dx / d * k, dy / d * k * COSB);
    }
  }

  // The CPU's plan for the next moment: shoot, chase, defend or hunt the carrier.
  void cpuDecide(int i) {
    Skater& s = sk_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    s.checkWish = false;
    if (rng.next() < sk.mistake * 0.5f) {
      s.mode = IDLE;
      s.tx = RINK_CX + ((float)rng.next() - 0.5f) * 500;
      s.ty = RINK_CY + ((float)rng.next() - 0.5f) * 500;
      return;
    }
    const GoalGeom& mine = s.goal;
    if (s.carry >= 0) {
      const GoalView* best = nullptr;
      float bestS = -1e9f;
      for (auto& gv : goals_) {
        if (gv.owner == i) continue;
        const GoalGeom& g = gv.g;
        float dx = s.x - g.mx, dy = s.y - g.my, dist = std::max(1.0f, std::hypot(dx, dy));
        float front = -(dx * g.nx + dy * g.ny) / dist;
        float keeper = gv.owner >= 0 ? std::min(400.0f, std::hypot(sk_[gv.owner].x - g.mx, sk_[gv.owner].y - g.my)) : 400;
        float sc = keeper * 0.8f + front * 260 - dist * 0.45f + (float)rng.next() * 60;
        if (sc > bestS) {
          bestS = sc;
          best = &gv;
        }
      }
      if (!best) return;
      const GoalGeom& g = best->g;
      float side = rng.next() < 0.5 ? -1.0f : 1.0f;
      if (best->owner >= 0) side = (sk_[best->owner].x - g.mx) * g.tx + (sk_[best->owner].y - g.my) * g.ty > 0 ? -1.0f : 1.0f;
      float off = side * (GOAL_W / 2 - 34) + ((float)rng.next() - 0.5f) * 60 * sk.aimNoise * 3;
      s.aimX = g.mx + g.tx * off;
      s.aimY = g.my + g.ty * off;
      float dist = std::hypot(s.x - g.mx, s.y - g.my);
      float front = -((s.x - g.mx) * g.nx + (s.y - g.my) * g.ny) / std::max(1.0f, dist);
      float rd;
      int rival = nearestRival(i, rd);
      if ((dist < 640 && front > 0.12f) || (rival >= 0 && rd < 110)) {
        s.mode = CHARGE;
        float base = 0.45f + sk.accuracy * 0.45f;
        s.chargeGoal = std::min(1.0f, base + ((float)rng.next() - 0.5f) * 0.3f * (1 - sk.accuracy + 0.3f));
        float err = ((float)rng.next() - 0.5f) * 2 * sk.aimNoise * 90;
        s.aimX += g.tx * err;
        s.aimY += g.ty * err;
        s.aiT = std::max(s.aiT, 520.0f);
      } else {
        s.mode = CARRY;
        s.tx = g.mx - g.nx * 270 + g.tx * ((float)rng.next() - 0.5f) * 200;
        s.ty = g.my - g.ny * 270 + g.ty * ((float)rng.next() - 0.5f) * 200;
      }
      return;
    }
    // a shot bearing down on my goal: get in front of it
    for (auto& p : pk_) {
      if (!p.on || p.holder >= 0 || p.z > 60) continue;
      float toX = mine.mx - p.x, toY = mine.my - p.y, dist = std::hypot(toX, toY), sp = std::hypot(p.vx, p.vy);
      if (sp > 300 && dist < 700 && (p.vx * toX + p.vy * toY) / (sp * dist) > 0.85f && rng.next() < sk.accuracy + 0.1f) {
        s.mode = DEFEND;
        float k = std::min(1.0f, 140 / dist);
        s.tx = mine.mx - mine.nx * 45 + (p.x - mine.mx) * k * 0.6f;
        s.ty = mine.my - mine.ny * 45 + (p.y - mine.my) * k * 0.6f;
        return;
      }
    }
    // a carrier closing on my goal
    int threat = -1;
    for (int j = 0; j < count(); j++)
      if (j != i && sk_[j].carry >= 0 && std::hypot(sk_[j].x - mine.mx, sk_[j].y - mine.my) < 480) {
        threat = j;
        break;
      }
    if (threat >= 0 && rng.next() < 0.45f + sk.accuracy * 0.5f) {
      s.mode = DEFEND;
      float dx = sk_[threat].x - mine.mx, dy = sk_[threat].y - mine.my, d = std::max(1.0f, std::hypot(dx, dy));
      float k = std::min(0.4f, 60 / d);
      s.tx = mine.mx - mine.nx * 40 + dx * k;
      s.ty = mine.my - mine.ny * 40 + dy * k;
      s.checkWish = std::hypot(sk_[threat].x - s.x, sk_[threat].y - s.y) < 150 && rng.next() < sk.accuracy;
      return;
    }
    // chase a loose puck I can reach first (or one on my side)
    int target = -1;
    float bestD = 1e9f;
    for (int pi = 0; pi < (int)pk_.size(); pi++) {
      const Puck& p = pk_[pi];
      if (!p.on || p.holder >= 0) continue;
      float d = std::hypot(p.x - s.x, p.y - s.y);
      bool closer = false;
      for (int j = 0; j < count(); j++)
        if (j != i && sk_[j].carry < 0 && sk_[j].stunT <= 0 && std::hypot(p.x - sk_[j].x, p.y - sk_[j].y) < d * 0.7f) closer = true;
      bool ourSide = std::hypot(p.x - mine.mx, p.y - mine.my) < 430;
      if (closer && !ourSide) continue;
      if (d < bestD) {
        bestD = d;
        target = pi;
      }
    }
    if (target < 0) {
      for (auto& p : pk_)
        if (p.on && p.holder < 0) {
          s.mode = DEFEND;
          float dx = p.x - mine.mx, dy = p.y - mine.my, d = std::max(1.0f, std::hypot(dx, dy));
          s.tx = mine.mx - mine.nx * 40 + dx / d * 150;
          s.ty = mine.my - mine.ny * 40 + dy / d * 150;
          return;
        }
    } else {
      const Puck& p = pk_[target];
      float d = std::hypot(p.x - s.x, p.y - s.y);
      Vec v = predict(p.x, p.y, p.vx, p.vy, std::min(1.2f, d / SKATE_MAX) * (0.4f + sk.accuracy * 0.5f));
      s.mode = CHASE;
      s.tx = v.x;
      s.ty = v.y;
      return;
    }
    // someone has it: hunt them (or hang back if a team-mate of the moment is nearer)
    int carrier = -1;
    for (int j = 0; j < count(); j++)
      if (j != i && sk_[j].carry >= 0) {
        carrier = j;
        break;
      }
    if (carrier >= 0) {
      const Skater& c = sk_[carrier];
      float myD = std::hypot(s.x - c.x, s.y - c.y);
      bool nearer = false;
      for (int j = 0; j < count(); j++)
        if (j != i && j != carrier && std::hypot(sk_[j].x - c.x, sk_[j].y - c.y) < myD) nearer = true;
      if (nearer) {
        s.mode = DEFEND;
        float dx = c.x - mine.mx, dy = c.y - mine.my, d = std::max(1.0f, std::hypot(dx, dy));
        s.tx = mine.mx - mine.nx * 40 + dx / d * 120;
        s.ty = mine.my - mine.ny * 40 + dy / d * 120;
        return;
      }
      s.mode = HUNT;
      s.tx = c.x + c.vx * 0.25f;
      s.ty = c.y + c.vy * 0.25f;
      s.checkWish = myD < 170 && rng.next() < 0.3f + sk.accuracy * 0.6f;
      return;
    }
    s.mode = IDLE;
    s.tx = mine.mx - mine.nx * 140;
    s.ty = mine.my - mine.ny * 140;
  }

  // --- Drawing ---
  void drawGoal(const GoalView& gv) const {
    static const char* const ART[4] = {"mg/rink_goal_l.png", "mg/rink_goal_r.png", "mg/rink_goal_t.png", "mg/rink_goal_b.png"};
    static const float AX[4] = {80.0f / 130, 50.0f / 130, 110.0f / 220, 110.0f / 220};
    static const float AY[4] = {168.0f / 280, 168.0f / 280, 114.0f / 140, 72.0f / 150};
    Tex* t = app.gfx.tex(ART[gv.g.side]);
    SDL_Rect src{0, 0, t->w, t->h};
    app.gfx.sprite(t, src, SX(gv.g.mx), SY(gv.g.my), 1, 1, AX[gv.g.side], AY[gv.g.side]);
  }

  void drawStick(const Skater& s, float sx, float sy) const {
    if (s.stunT > 0) return;
    float face = s.faceLeft ? -1.0f : 1.0f;
    float hx = sx + face * 6 * CHAR_SCALE, hy = sy - 30 * CHAR_SCALE;
    float bx, by, lift = 0;
    if (s.charging) {
      float back = 26 + 34 * s.charge;
      bx = s.x - s.fx * back + s.fy * 10;
      by = s.y - s.fy * back - s.fx * 10;
      lift = 40 * s.charge;
    } else if (s.swingT > 0) {
      float u = 1 - s.swingT / 170;
      bx = s.x + s.fx * (STICK_REACH + 20 * u);
      by = s.y + s.fy * (STICK_REACH + 20 * u);
      lift = 16 * u;
    } else {
      bx = s.x + s.fx * (STICK_REACH - 12);
      by = s.y + s.fy * (STICK_REACH - 12);
    }
    float ex = SX(bx), ey = SY(by, lift);
    app.gfx.line(hx, hy, ex, ey, 3.5f, Color::hex(0x2a1c12));
    app.gfx.line(hx, hy, ex, ey, 1.6f, Color::hex(0xc79a5c));
    float bl = 8 * -face * s.fy + face * 6 * std::fabs(s.fx);
    app.gfx.line(ex, ey, ex + bl, ey + 1, 4, Color::hex(0x1c1c22));
  }

  void drawSkater(int i) const {
    const Skater& s = sk_[i];
    float sx = SX(s.x), sy = SY(s.y);
    spr::shadow(sx, sy, 34);
    bool behind = s.fy < -0.3f;
    if (behind) drawStick(s, sx, sy);
    Color tint = s.stunT > 0 ? Color(255, 220, 220) : col::white;
    spr::character(player(i).character, s.anim, s.animT, sx, sy, CHAR_SCALE, s.faceLeft, tint);
    if (!behind) drawStick(s, sx, sy);
    drawPlayerTag(i, sx, sy - 66);
  }

  void drawPuck(const Puck& p) const {
    Tex* t = app.gfx.tex("mg/rink_puck.png");
    SDL_Rect src{0, 0, t->w, t->h};
    float sc = 2 * PUCK_R * K * 1.15f / t->w;
    app.gfx.sprite(t, src, SX(p.x), SY(p.y, p.z) - 1, sc, sc);
  }

  void drawMeter(int i) const {
    const Skater& s = sk_[i];
    if (!s.charging || s.carry < 0) return;
    Color c = color(i);
    float sx = SX(s.x), sy = SY(s.y);
    constexpr int DOTS = 16;
    int lit = (int)std::ceil(s.charge * DOTS);
    float rr = 52 * K;
    for (int k = 0; k < DOTS; k++) {
      float a = -PI_F / 2 + (k + 0.5f) / DOTS * 2 * PI_F;
      app.gfx.circle(sx + std::cos(a) * rr, sy + std::sin(a) * rr * COSB, k < lit ? 2.6f : 1.6f, k < lit ? c : Color(10, 17, 32, 90));
    }
    const Puck& p = pk_[s.carry];
    Vec aim = aimOf(s, p);
    float L = (70 + 150 * s.charge) * K;
    float x0 = SX(p.x), y0 = SY(p.y);
    float dx = aim.x, dy = aim.y * COSB, m = std::max(1e-4f, std::hypot(dx, dy));
    float ux = dx / m, uy = dy / m;
    float x1 = x0 + aim.x * L, y1 = y0 + aim.y * L * COSB;
    bool full = s.charge >= 1;
    Color ac = full ? Color::hex(0xffe08a) : c;
    app.gfx.line(x0, y0 + 1, x1, y1 + 1, 4, Color(10, 17, 32, 80));
    app.gfx.line(x0, y0, x1, y1, 3, ac);
    app.gfx.line(x1 + ux * 8, y1 + uy * 8, x1 - uy * 5, y1 + ux * 5, 3, ac);
    app.gfx.line(x1 + ux * 8, y1 + uy * 8, x1 + uy * 5, y1 - ux * 5, 3, ac);
  }

  void draw() override {
    drawArena();
    // creases in each owner's colour, flashing red when a goal goes in
    for (const auto& gv : goals_) {
      Color c = gv.owner >= 0 ? color(gv.owner) : col::white;
      float cx = SX(gv.g.mx - gv.g.nx * 6), cy = SY(gv.g.my - gv.g.ny * 6);
      float r = 60 * K;
      app.gfx.ellipse(cx, cy, r + 2, (r + 2) * COSB, c.alpha(0.8f));
      app.gfx.ellipse(cx, cy, r - 1, (r - 1) * COSB, Color(235, 245, 255, 235));
      app.gfx.ellipse(cx, cy, r - 1, (r - 1) * COSB, c.alpha(0.32f));
      if (gv.flashT > 0) app.gfx.ellipse(cx, cy, r, r * COSB, Color(255, 82, 82, (unsigned char)(220 * gv.flashT / 700)));
      app.gfx.circle(SX(gv.g.mx - gv.g.nx * 40), SY(gv.g.my - gv.g.ny * 40), 6, c);
    }
    // puck shadows and trails on the ice
    for (const auto& p : pk_) {
      if (!p.on) continue;
      float k = std::max(0.35f, 1 - p.z / 500);
      app.gfx.ellipse(SX(p.x), SY(p.y) + 1, 8 * k, 3 * k, Color(10, 17, 32, 110));
    }
    for (auto& p : pk_) {
      bool fast = p.on && p.holder < 0 && p.z == 0 && std::hypot(p.vx, p.vy) > 520;
      if (!fast) {
        p.tn = 0;
        continue;
      }
      for (int k = 7; k > 0; k--) {
        p.trx[k] = p.trx[k - 1];
        p.try_[k] = p.try_[k - 1];
      }
      p.trx[0] = SX(p.x);
      p.try_[0] = SY(p.y) - 1;
      p.tn = std::min(8, p.tn + 1);
      Color c = p.last >= 0 ? color(p.last) : col::white;
      for (int k = 1; k < p.tn; k++) {
        float f = 1 - k / 8.0f;
        app.gfx.line(p.trx[k - 1], p.try_[k - 1], p.trx[k], p.try_[k], 9 * f + 1.5f, c.alpha(0.5f * f));
      }
    }
    // goals, skaters and pucks back to front
    items_.clear();
    for (int g = 0; g < (int)goals_.size(); g++) {
      int side = goals_[g].g.side;
      float sy = SY(goals_[g].g.my);
      items_.push_back({side == BOTTOM_S ? 1e6f : (side == TOP_S ? sy - 14 : sy + 9), 0, g});
    }
    for (int i = 0; i < count(); i++) items_.push_back({SY(sk_[i].y), 1, i});
    for (int p = 0; p < (int)pk_.size(); p++) {
      if (!pk_[p].on) continue;
      float key = pk_[p].holder >= 0 ? SY(sk_[pk_[p].holder].y) + (sk_[pk_[p].holder].fy < -0.3f ? -0.5f : 0.5f) : SY(pk_[p].y) + 0.5f;
      items_.push_back({key, 2, p});
    }
    std::sort(items_.begin(), items_.end(), [](const Item& a, const Item& b) { return a.key < b.key; });
    for (const auto& it : items_) {
      if (it.kind == 0) drawGoal(goals_[it.idx]);
      else if (it.kind == 1) drawSkater(it.idx);
      else drawPuck(pk_[it.idx]);
    }
    for (int i = 0; i < count(); i++) drawMeter(i);
    // goal lamps
    for (const auto& gv : goals_) {
      float lx = SX(gv.g.mx + gv.g.nx * 40), ly = SY(gv.g.my + gv.g.ny * 40) - 86 * K;
      float a = gv.lampT > 0 ? (0.6f + 0.4f * (((int)(gv.lampT / 110)) % 2)) : 0.35f;
      app.gfx.circle(lx, ly, gv.lampT > 0 ? 9 : 6, Color(255, 64, 64, (unsigned char)(255 * a)));
      app.gfx.circle(lx, ly, 3, Color(255, 220, 220, (unsigned char)(255 * a)));
    }
    for (const auto& p : pops_) {
      float k = p.t / p.life;
      float a = k < 0.7f ? 1.0f : 1 - (k - 0.7f) / 0.3f;
      app.gfx.text(p.text, p.x, p.y - 26 * easeOut(std::min(1.0f, k * 2)), p.size, p.c.alpha(a), CENTER, true);
    }
    if (bannerT_ > 0) {
      float a = std::min(1.0f, bannerT_ / 0.3f);
      app.gfx.panel(VW / 2 - 140, 60, 280, 44, Color::hex(0x3aa7e0).alpha(0.9f * a), 22);
      app.gfx.text("SECOND PUCK!", VW / 2, 66, 30, col::white.alpha(a), CENTER, true);
    }
    drawTimer((ROUND_MS - ms_) / 1000);
    drawSideScores();
  }

  // The score chips sit in the stands either side of the rink (the usual bottom strip would cover the near goal):
  // the left and far goals' keepers on the left, the right and near goals' keepers on the right.
  void drawSideScores() const {
    for (int i = 0; i < count(); i++) {
      int side = sk_[i].goal.side;
      bool left = side == LEFT_S || side == TOP_S;
      float x = left ? 34 : VW - 34 - 150, y = (side == LEFT_S || side == RIGHT_S) ? 196 : (side == TOP_S ? 140 : 252);
      ui::card(x, y, 150, 38, col::cream.alpha(0.95f), 19);
      app.gfx.circle(x + 19, y + 19, 17, color(i));
      spr::portrait(player(i).character, x + 19, y + 19, 32);
      app.gfx.text(std::to_string(score_[i]) + " pts", x + 44, y + 8, 20, col::ink, LEFT, false);
    }
  }

  bool finished() const override { return ms_ >= ROUND_MS; }
  std::vector<int> scores() const override { return score_; }
  std::string scoreLabel(int i) const override { return std::to_string(score_[i]) + " points"; }

 private:
  struct Item {
    float key;
    int kind, idx;
  };
  std::vector<Skater> sk_;
  std::vector<Puck> pk_;
  std::vector<GoalView> goals_;
  std::vector<GoalGeom> geoms_;
  std::vector<Pop> pops_;
  std::vector<int> score_;
  std::vector<Item> items_;
  float ms_ = 0, bannerT_ = 0;
  bool final_ = false;
};

}  // namespace

REGISTER_MINIGAME("slapshot", Slapshot);

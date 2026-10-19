// Cloud Rider (Dojo): everyone surfs a little golden cloud through a sky course between the peaks. Steer
// up and down through ring trails (+1) and energy orbs (+3); hold A to charge and let go to burst ahead -
// ramming rivals knocks rings loose. Storm clouds zap and wind gusts shove, both announced first. The
// last ten seconds are a ring rush. Most rings after 45 seconds wins.
//
// The simulation runs in the web game's 1920x1080 units; everything is scaled by S when drawn.
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
constexpr float DURATION = 45, GW = 1920;
constexpr float CRUISE_X = 470, MIN_X = 240, MAX_X = 1160, TOP = 250, BOTTOM = 870, HIT_DY = -52;
constexpr float MAX_VY = 640, STEER = 9, CHARGE_T = 0.8f, BURST_V = 1750, RAM_MIN = 0.26f, RAM_MAX = 0.56f, RECHARGE = 1.05f;
constexpr float X_DAMP = 3.2f, X_SPRING = 2.6f, DIZZY_BUMP = 0.72f, DIZZY_ZAP = 0.9f, GUARD_BUMP = 1.0f, GUARD_ZAP = 1.3f;
constexpr float RIDER_R = 58, JOSTLE_DY = 122, STORM_RX = 150, STORM_RY = 76;
constexpr float GUST_WARN = 1.3f, GUST_BLOW = 2.1f, GUST_V = 390;
constexpr float CLOUD_SCALE = 0.68f, CHAR_SCALE = 0.85f, FEET_DY = -24, GAUGE_R = 70;
constexpr float RING_SCALE = 0.78f, ORB_SCALE = 0.72f, STORM_SCALE = 0.86f;
// the course
constexpr float C_TOP = 200, C_BOTTOM = 800, C_STORM_TOP = 230, C_STORM_BOTTOM = 780, SPAWN_X = 2780, GAP = 108, STORM_GAP = 185;
constexpr float C_MID = (C_TOP + C_BOTTOM) / 2;
constexpr int WORTH_RING = 1, WORTH_ORB = 3, DROP_BUMP = 3, DROP_ZAP = 2, PERFECT_BONUS = 2, PERFECT_MIN = 5;
const Color STORM_TINT = Color::hex(0xa9a3cc);

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{0.52f, 0.55f, 0.24f, 0.55f, 0.70f}, {0.30f, 0.78f, 0.11f, 0.28f, 0.42f}, {0.17f, 0.90f, 0.05f, 0.13f, 0.24f}};

float courseSpeed(float t, bool rush) { return 560 + 150 * clampf(t, 0, 1) + (rush ? 50 : 0); }

// --- course patterns -----------------------------------------------------------------------------
enum CKind { CK_RING, CK_ORB, CK_STORM };
struct CItem {
  int kind;
  float dx, y;
  int trail;
};
struct GustPlan {
  float y, half;
  int dir;
  float atDx;
};
struct Pattern {
  int name = 0;
  std::vector<CItem> items;
  float length = 0;
  bool hasGust = false;
  GustPlan gust{};
};
enum PName { P_PAIR, P_ARCS, P_WAVE, P_DIVE, P_ORBTRAIL, P_STORM, P_STORMGAP, P_GUST, P_ORBSTORM, P_RUSH, P_NONE };
bool isHazard(int n) { return n == P_STORM || n == P_STORMGAP || n == P_ORBSTORM || n == P_GUST; }

void trailPts(std::vector<CItem>& out, const std::vector<float>& ys, int trail, float dx0) {
  for (size_t i = 0; i < ys.size(); i++) out.push_back({CK_RING, dx0 + i * GAP, clampf(ys[i], C_TOP, C_BOTTOM), trail});
}
void line(std::vector<CItem>& out, float y, int n, int trail, float dx0 = 0) { trailPts(out, std::vector<float>(n, y), trail, dx0); }
void arc(std::vector<CItem>& out, float y, int n, float amp, int trail, float dx0 = 0) {
  std::vector<float> ys;
  for (int i = 0; i < n; i++) ys.push_back(y - amp * std::sin(PI * i / (n - 1)));
  trailPts(out, ys, trail, dx0);
}
void wave(std::vector<CItem>& out, float y, int n, float amp, float periods, int trail, float dx0 = 0) {
  std::vector<float> ys;
  for (int i = 0; i < n; i++) ys.push_back(y + amp * std::sin(PI * 2 * periods * i / (n - 1)));
  trailPts(out, ys, trail, dx0);
}
void dive(std::vector<CItem>& out, float y0, float y1, int n, int trail, float dx0 = 0) {
  std::vector<float> ys;
  for (int i = 0; i < n; i++) ys.push_back(y0 + (y1 - y0) * i / (n - 1));
  trailPts(out, ys, trail, dx0);
}
std::vector<float> lanes(Random& rng, int k) {
  std::vector<float> out;
  for (int i = 0; i < k; i++) out.push_back(C_TOP + (i + 0.5f) / k * (C_BOTTOM - C_TOP) + rng.frange(-40, 40));
  return out;
}

Pattern buildPattern(Random& rng, int name) {
  Pattern p;
  p.name = name;
  auto& it = p.items;
  switch (name) {
    case P_PAIR: {
      auto l = lanes(rng, 2);
      line(it, l[0], 5, 0);
      line(it, l[1], 5, 1, rng.chance(0.5) ? 0 : GAP * 2);
      break;
    }
    case P_ARCS: {
      auto l = lanes(rng, 2);
      bool up = rng.chance(0.5);
      arc(it, l[0] + 60, 6, up ? 150 : -120, 0);
      line(it, l[1], 5, 1, GAP);
      break;
    }
    case P_WAVE: {
      float y = rng.frange(C_MID - 80, C_MID + 80);
      wave(it, y, 8, rng.frange(170, 230), 1, 0);
      break;
    }
    case P_DIVE: {
      bool down = rng.chance(0.5);
      float a = down ? C_TOP + 20 : C_BOTTOM - 20, b = down ? C_BOTTOM - 20 : C_TOP + 20;
      dive(it, a, b, 7, 0);
      line(it, down ? C_BOTTOM - 60 : C_TOP + 60, 3, 1, 0);
      break;
    }
    case P_ORBTRAIL: {
      float y = rng.frange(C_TOP + 40, C_BOTTOM - 40);
      line(it, y, 5, 0);
      it.push_back({CK_ORB, 5 * GAP + 30, y, -1});
      float other = y < C_MID ? rng.frange(C_MID + 120, C_BOTTOM) : rng.frange(C_TOP, C_MID - 120);
      arc(it, other, 5, 90, 1, GAP);
      break;
    }
    case P_STORM: {
      float y = rng.frange(C_STORM_TOP, C_STORM_BOTTOM);
      bool above = y - C_TOP > C_BOTTOM - y;
      it.push_back({CK_STORM, 2 * GAP, y, -1});
      arc(it, above ? y - 250 : y + 250, 5, above ? 70 : -70, 0);
      float far = above ? y + 260 : y - 260;
      if (far >= C_TOP && far <= C_BOTTOM) line(it, far, 3, 1, GAP);
      break;
    }
    case P_STORMGAP: {
      float g = rng.frange(C_STORM_TOP + STORM_GAP, C_STORM_BOTTOM - STORM_GAP);
      it.push_back({CK_STORM, 2 * GAP, g - STORM_GAP, -1});
      it.push_back({CK_STORM, 2 * GAP, g + STORM_GAP, -1});
      line(it, g, 5, 0);
      if (rng.chance(0.5)) it.push_back({CK_ORB, 5 * GAP + 30, g, -1});
      break;
    }
    case P_GUST: {
      float y = rng.frange(C_TOP + 150, C_BOTTOM - 150);
      int dir = y < C_MID ? 1 : -1;
      line(it, y, 6, 0);
      float far = dir > 0 ? std::max(C_TOP, y - 280) : std::min(C_BOTTOM, y + 280);
      line(it, far, 3, 1, GAP * 2);
      p.hasGust = true;
      p.gust = {y, 150, dir, 0};
      break;
    }
    case P_ORBSTORM: {
      float y = rng.frange(C_STORM_TOP + STORM_GAP, C_STORM_BOTTOM - STORM_GAP);
      line(it, y, 3, 0);
      it.push_back({CK_STORM, 3.5f * GAP, y - STORM_GAP, -1});
      it.push_back({CK_STORM, 4.6f * GAP, y + STORM_GAP, -1});
      it.push_back({CK_ORB, 4.05f * GAP, y, -1});
      break;
    }
    default: {  // rush
      auto ys = lanes(rng, 3);
      line(it, ys[0], 5, 0);
      wave(it, ys[1], 6, 60, 1, 1, GAP / 2);
      line(it, ys[2], 5, 2);
      if (rng.chance(0.6)) {
        float dx = 6 * GAP + 20;
        it.push_back({CK_ORB, dx, ys[std::min(2, (int)(rng.next() * 3))], -1});
      }
      break;
    }
  }
  return p;
}

Pattern nextPattern(Random& rng, float t, bool rush, int prev) {
  std::vector<int> names;
  std::vector<float> w;
  auto add = [&](int n, float wt) {
    names.push_back(n);
    w.push_back(wt);
  };
  if (rush) {
    add(P_RUSH, 5);
    add(P_ORBTRAIL, 2);
    add(P_WAVE, 1);
    add(P_GUST, 1);
  } else {
    add(P_PAIR, 3);
    add(P_ARCS, 2);
    if (t >= 0.12f) {
      add(P_WAVE, 2);
      add(P_DIVE, 1.5f);
      add(P_ORBTRAIL, 1.5f);
      add(P_STORM, 2);
    }
    if (t >= 0.32f) {
      add(P_GUST, 1.6f);
      add(P_STORMGAP, 1.4f);
    }
    if (t >= 0.5f) add(P_ORBSTORM, 1.2f);
  }
  std::vector<int> fn;
  std::vector<float> fw;
  for (size_t i = 0; i < names.size(); i++)
    if (names[i] != prev && !(prev != P_NONE && isHazard(prev) && isHazard(names[i]))) {
      fn.push_back(names[i]);
      fw.push_back(w[i]);
    }
  if (fn.empty()) {
    fn = names;
    fw = w;
  }
  int name = fn[rng.weighted(fw)];
  Pattern p = buildPattern(rng, name);
  float span = 0;
  for (auto& i : p.items) span = std::max(span, i.dx);
  p.length = span + (isHazard(name) ? 640 : rush ? 430 : 520);
  return p;
}

// --- the scene -----------------------------------------------------------------------------------
enum IKind { I_RING, I_ORB, I_LOOSE };
struct Item {
  int kind = I_RING;
  bool active = false;
  float x = 0, y = 0, vx = 0, vy = 0, wait = 0, life = 0, phase = 0;
  int trail = -1;
};
struct Storm {
  bool active = false;
  int warning = 0;  // 0 off, 1 on, 2 fading
  float warnT = 0, x = 0, y = 0, phase = 0, flick = 0, flashT = 0, seenAt = 0;
};
struct Gust {
  float y, half;
  int dir;
  float at;
  int state;  // 0 wait 1 warn 2 blow 3 done
  float t;
};
struct Trail {
  int total = 0, taken = 0, by = -2;
  bool missed = false;
};
struct Rider {
  float x = 0, y = 0, vx = 0, vy = 0, charge = 0, ramT = 0, recharge = 0, dizzy = 0, guard = 0, bob = 0;
  bool charging = false;
  int chimes = 0, streak = 0, score = 0;
  float lastRing = -1e9f, ghostT = 0, gustV = 0, home = 0, nextRam = 0, flashT = 0, animT = 0, tilt = 0;
  bool burstOnce = false;
  // input
  float moveY = 0;
  bool held = false;
  // CPU
  float timer = 0, wait = 0, targetY = 0;
  bool hasTarget = false, chargeMode = false;
};
struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size, owner, value;
};
struct Particle {
  float x, y, vx, vy, t, life, r;
  Color c;
};
struct Ghost {
  float x, y, t;
  int rider;
};
struct Line {
  float x = 0, y = 0, v = 0, len = 1, a = 0;
  bool active = false;
};

class CloudRider : public Minigame {
 public:
  void start() override {
    int n = count();
    for (int i = 0; i < n; i++) {
      Rider r;
      r.y = n == 1 ? (TOP + BOTTOM) / 2 : TOP + 50 + i * (BOTTOM - TOP - 100) / (n - 1);
      r.x = CRUISE_X - (i % 2) * 40;
      r.bob = i * 1.7f;
      r.home = r.y;
      r.nextRam = 2.5f + i * 0.7f;
      r.vx = 380;
      riders_.push_back(r);
    }
    for (auto& w : wisps_) {
      w[0] = (float)rng.next() * GW;
      w[1] = rng.frange(150, 700);
    }
    for (int i = 0; i < 7; i++) wisps_[i][2] = 0.45f + (i % 3) * 0.12f;
    for (int i = 0; i < 5; i++) {
      near_[i][0] = i * 470.0f + rng.frange(0, 200);
      near_[i][1] = 1020 + rng.frange(0, 60);
    }
    speed_ = courseSpeed(0, false);
    spawnPattern(nextPattern(rng, 0, false, P_NONE), 2020);
    nextAt_ = scroll_ + 900;
  }

  void spawnPattern(const Pattern& pat, float x0) {
    prev_ = pat.name;
    int ids[3] = {-1, -1, -1};
    for (auto& it : pat.items) {
      if (it.kind == CK_STORM) {
        spawnStorm(x0 + it.dx, it.y);
        continue;
      }
      int trail = -1;
      if (it.trail >= 0) {
        if (ids[it.trail] < 0) {
          ids[it.trail] = (int)trails_.size();
          trails_.push_back(Trail());
        }
        trail = ids[it.trail];
        trails_[trail].total++;
      }
      spawnItem(it.kind == CK_ORB ? I_ORB : I_RING, x0 + it.dx, it.y, trail);
    }
    if (pat.hasGust && !hasGust_) {
      float lead = (x0 + pat.gust.atDx - (CRUISE_X + 330)) / speed_;
      gust_ = {pat.gust.y, pat.gust.half, pat.gust.dir, time_ + std::max(GUST_WARN + 0.2f, lead), 0, 0};
      hasGust_ = true;
    }
  }
  Item& spawnItem(int kind, float x, float y, int trail) {
    Item* it = nullptr;
    for (auto& q : items_)
      if (!q.active) {
        it = &q;
        break;
      }
    if (!it) {
      items_.push_back(Item());
      it = &items_.back();
    }
    *it = Item();
    it->kind = kind;
    it->active = true;
    it->x = x;
    it->y = y;
    it->life = 1e9f;
    it->trail = trail;
    it->phase = rng.frange(0, PI * 2);
    return *it;
  }
  void spawnStorm(float x, float y) {
    Storm* s = nullptr;
    for (auto& q : storms_)
      if (!q.active) {
        s = &q;
        break;
      }
    if (!s) {
      storms_.push_back(Storm());
      s = &storms_.back();
    }
    *s = Storm();
    s->active = true;
    s->x = x;
    s->y = y;
    s->phase = rng.frange(0, 6);
    s->flick = rng.frange(0.5f, 1.4f);
    s->seenAt = time_;
    s->warning = 1;
    app.audio.sfx("warn", 0.35f);
  }

  void pop(const std::string& t, float x, float y, Color c, int size, int owner = -1, int value = 0) { pops_.push_back({t, x, y, 0, 0.9f, c, size, owner, value}); }
  void popScore(int i, float x, float y, int value, Color c) {
    if (value < 3)
      for (auto& p : pops_)
        if (p.owner == i && p.t < 0.4f) {
          p.value += value;
          p.text = "+" + std::to_string(p.value);
          p.t = 0;
          return;
        }
    pop("+" + std::to_string(value), SX(x + 30), SX(y - 60), c, 24, i, value);
  }
  void sparks(float x, float y, int n, Color c) {
    for (int k = 0; k < n && parts_.size() < 100; k++) {
      float a = (float)rng.next() * PI * 2, sp = rng.frange(60, 240);
      parts_.push_back({x, y, std::cos(a) * sp, std::sin(a) * sp, 0, rng.frange(0.26f, 0.52f), 5, c});
    }
  }
  static float SX(float v) { return v * S; }

  // --- update ------------------------------------------------------------------------------------
  void update(float dt) override {
    time_ += dt;
    clock_ += dt;
    if (time_ >= DURATION) return;
    float t = time_ / DURATION;
    if (!rush_ && time_ >= DURATION - 10) {
      rush_ = true;
      bannerT_ = 0;
      spawnPattern(nextPattern(rng, 1, true, prev_), SPAWN_X - 700);
    }
    bannerT_ += dt;
    speed_ = courseSpeed(t, rush_);
    scrollWorld(dt);
    if (scroll_ >= nextAt_) {
      Pattern pat = nextPattern(rng, t, rush_, prev_);
      spawnPattern(pat, SPAWN_X - (scroll_ - nextAt_));
      nextAt_ += pat.length;
    }
    updateGust(dt);
    for (int i = 0; i < count(); i++) {
      Rider& r = riders_[i];
      if (isCpu(i))
        cpuThink(i, dt);
      else {
        r.moveY = pad(i).y;
        r.held = pad(i).down(B_A);
      }
      moveRider(i, dt);
    }
    contacts();
    collect();
    hazards();
    effects(dt);
  }

  void scrollWorld(float dt) {
    float ds = speed_ * dt;
    scroll_ += ds;
    for (auto& w : wisps_) {
      w[0] -= ds * w[2];
      if (w[0] < -260) {
        w[0] = GW + 260;
        w[1] = rng.frange(150, 700);
      }
    }
    for (auto& n : near_) {
      n[0] -= ds * 1.35f;
      if (n[0] < -300) n[0] += 5 * 470;
    }
    for (auto& it : items_) {
      if (!it.active) continue;
      it.x -= ds;
      if (it.kind == I_LOOSE) {
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        float k = std::exp(-2.4f * dt);
        it.vx *= k;
        it.vy = it.vy * k + 60 * dt;
        it.wait -= dt;
        it.life -= dt;
        if (it.life <= 0) {
          it.active = false;
          continue;
        }
      }
      if (it.x < -120) {
        if (it.trail >= 0) trails_[it.trail].missed = true;
        it.active = false;
      }
    }
    for (auto& st : storms_) {
      if (!st.active) continue;
      st.x -= ds;
      if (st.x < -260) st.active = false;
    }
  }

  int inGust(float y) const {
    if (!hasGust_ || gust_.state != 2) return 0;
    return std::fabs(y + HIT_DY - gust_.y) < gust_.half ? gust_.dir : 0;
  }
  void updateGust(float dt) {
    if (!hasGust_) return;
    Gust& g = gust_;
    if (g.state == 0 && time_ >= g.at - GUST_WARN) {
      g.state = 1;
      g.t = 0;
      app.audio.sfx("warn", 0.45f);
      pop("WIND!", SX(GW - 170), SX(g.y - g.half - 34) - 14, Color::hex(0x9fdcff), 26);
    } else if (g.state == 1 && time_ >= g.at) {
      g.state = 2;
      g.t = 0;
      app.audio.sfx("whoosh", 0.8f);
    } else if (g.state == 2) {
      g.t += dt;
      if (g.t >= GUST_BLOW) {
        g.state = 3;
        hasGust_ = false;
      }
    }
  }

  void moveRider(int i, float dt) {
    Rider& r = riders_[i];
    r.guard = std::max(0.0f, r.guard - dt);
    r.recharge = std::max(0.0f, r.recharge - dt);
    r.ramT = std::max(0.0f, r.ramT - dt);
    r.flashT -= dt;
    r.animT += dt;
    r.bob += dt;
    r.gustV = inGust(r.y) * GUST_V;
    if (r.dizzy > 0) {
      r.dizzy -= dt;
      r.charging = false;
      r.charge = 0;
      float k = std::exp(-4 * dt);
      r.vy = r.vy * k + r.gustV * (1 - k);
    } else {
      if (!r.charging && r.recharge <= 0 && r.held && r.ramT <= 0) {
        r.charging = true;
        r.charge = 0;
        r.chimes = 0;
      }
      if (r.charging) {
        r.charge = std::min(1.0f, r.charge + dt / CHARGE_T);
        int q = (int)(r.charge * 4);
        if (q > r.chimes) {
          r.chimes = q;
          app.audio.sfx("tick", 0.25f);
        }
        if (!r.held) burst(i);
      }
      float steer = r.charging ? 0.55f : 1;
      float target = r.moveY * MAX_VY * steer + r.gustV;
      r.vy += (target - r.vy) * (1 - std::exp(-STEER * dt));
    }
    r.y += r.vy * dt;
    if (r.y < TOP) {
      r.y = TOP;
      r.vy = std::max(0.0f, r.vy);
    } else if (r.y > BOTTOM) {
      r.y = BOTTOM;
      r.vy = std::min(0.0f, r.vy);
    }
    float ax = -X_DAMP * r.vx + X_SPRING * (CRUISE_X - r.x) - (r.charging ? 160 : 0);
    r.vx += ax * dt;
    r.x += r.vx * dt;
    if (r.x < MIN_X) {
      r.x = MIN_X;
      r.vx = std::max(0.0f, r.vx);
    } else if (r.x > MAX_X) {
      r.x = MAX_X;
      r.vx = std::min(0.0f, r.vx);
    }
    r.tilt = clampf(r.vy * 0.014f, -12, 12);
    // after-images while bursting
    if (r.ramT > 0) {
      r.ghostT -= dt;
      if (r.ghostT <= 0) {
        r.ghostT = 0.06f;
        ghosts_.push_back({r.x, r.y + std::sin(r.bob * 3.1f + player(i).slot) * 6, 0, i});
      }
    }
  }

  // let go: shoot forward, ramming anyone in the way while the burst is hot
  void burst(int i) {
    Rider& r = riders_[i];
    float k = r.charge;
    float power = 0.42f + 0.58f * clampf(k, 0, 1);
    r.charging = false;
    r.charge = 0;
    r.vx = std::max(r.vx, 0.0f) + BURST_V * power;
    r.ramT = RAM_MIN + (RAM_MAX - RAM_MIN) * k;
    r.recharge = RECHARGE;
    r.ghostT = 0;
    r.burstOnce = true;
    app.audio.sfx("dash", 0.55f + 0.4f * k);
    sparks(r.x - 70, r.y + 6, (int)std::lround(6 * (0.6f + 0.6f * k)), Color::hex(0xffd24a));
  }

  void contacts() {
    for (int i = 0; i < count(); i++)
      for (int j = i + 1; j < count(); j++) {
        Rider& a = riders_[i];
        Rider& b = riders_[j];
        float dx = b.x - a.x, dy = b.y - a.y;
        if (std::fabs(dx) > RIDER_R * 2.1f || std::fabs(dy) > JOSTLE_DY) continue;
        bool touching = std::fabs(dy) < RIDER_R * 1.6f;
        int who = 0;  // 1 a rams, 2 b rams, 3 clash
        if (touching) {
          bool ab = a.ramT > 0, bb = b.ramT > 0;
          if (ab && bb)
            who = 3;
          else if (ab && b.guard <= 0)
            who = 1;
          else if (bb && a.guard <= 0)
            who = 2;
        }
        if (who == 1)
          bump(i, j);
        else if (who == 2)
          bump(j, i);
        else if (who == 3)
          clash(i, j);
        else {
          float push = (JOSTLE_DY - std::fabs(dy)) / 2, sy = dy >= 0 ? 1.0f : -1.0f;
          a.y -= sy * push * 0.35f;
          b.y += sy * push * 0.35f;
          a.vy -= sy * 40;
          b.vy += sy * 40;
        }
      }
  }
  void bump(int ai, int vi) {
    Rider& a = riders_[ai];
    Rider& v = riders_[vi];
    float sy = v.y >= a.y ? 1.0f : -1.0f;
    v.vy = sy * 860;
    v.vx = std::min(v.vx, 0.0f) - 420;
    v.dizzy = DIZZY_BUMP;
    v.guard = GUARD_BUMP;
    v.charging = false;
    v.charge = 0;
    a.vx *= 0.4f;
    a.ramT = std::min(a.ramT, 0.06f);
    a.vy -= sy * 180;
    loseRings(vi, std::max(0, std::min(v.score, DROP_BUMP)), a.x < v.x ? 1 : -1);
    float mx = (a.x + v.x) / 2, my = (a.y + v.y) / 2 + HIT_DY;
    app.audio.sfx("hit", 0.85f);
    bursts_.push_back({mx, my, 0, 0.36f, 150, Color::hex(0xffe08a)});
    pop("BONK!", SX(mx), SX(my - 90), Color::hex(0xffb52e), 26);
    stun(v);
  }
  void clash(int ai, int bi) {
    Rider& a = riders_[ai];
    Rider& b = riders_[bi];
    float sy = b.y >= a.y ? 1.0f : -1.0f;
    a.vx = b.vx = -260;
    a.vy = -sy * 520;
    b.vy = sy * 520;
    a.ramT = b.ramT = 0;
    a.guard = b.guard = 0.6f;
    float mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + HIT_DY;
    app.audio.sfx("bump", 0.6f);
    bursts_.push_back({mx, my, 0, 0.38f, 190, col::white});
    sparks(mx, my, 16, Color::hex(0xffd23f));
    pop("CLASH!", SX(mx), SX(my - 90), Color::hex(0xffd23f), 26);
  }
  void stun(Rider& r) {
    r.flashT = 0.07f;
    r.animT = 0;
  }
  void loseRings(int i, int n, int dir) {
    if (n <= 0) return;
    Rider& r = riders_[i];
    r.score -= n;
    pop("-" + std::to_string(std::min(3, n)), SX(r.x - 70), SX(r.y + 40), Color::hex(0xff6b5e), 24);
    app.audio.sfx("bad", 0.6f);
    for (int k = 0; k < n; k++) {
      Item& it = spawnItem(I_LOOSE, r.x, r.y + HIT_DY, -1);
      it.vx = -dir * rng.frange(80, 220) - 120;
      it.vy = (k % 2 ? 1 : -1) * rng.frange(160, 320) - 60;
      it.wait = 0.38f;
      it.life = 3.2f;
    }
  }

  void collect() {
    for (auto& it : items_) {
      if (!it.active || (it.kind == I_LOOSE && it.wait > 0)) continue;
      int best = -1;
      float bestD = 1e9f;
      for (int i = 0; i < count(); i++) {
        const Rider& r = riders_[i];
        if (r.dizzy > 0 && it.kind != I_ORB) continue;
        float dx = std::fabs(it.x - (r.x + 12)), dy = std::fabs(it.y - (r.y + HIT_DY));
        bool hit = it.kind == I_ORB ? dx * dx + dy * dy < 80 * 80 : (dx < 46 && dy < 74);
        if (hit && dx + dy < bestD) {
          bestD = dx + dy;
          best = i;
        }
      }
      if (best >= 0) take(best, it);
    }
  }
  void take(int i, Item& it) {
    Rider& r = riders_[i];
    bool orb = it.kind == I_ORB;
    int value = orb ? WORTH_ORB : WORTH_RING;
    r.score += value;
    r.streak = time_ - r.lastRing < 0.65f ? r.streak + 1 : 1;
    r.lastRing = time_;
    if (orb) {
      app.audio.sfx("item", 0.9f);
      sparks(it.x, it.y, 14, Color::hex(0x9cf0ff));
      bursts_.push_back({it.x, it.y, 0, 0.36f, 120, Color::hex(0x9cf0ff)});
    } else {
      app.audio.sfx("coin", 0.6f);
      sparks(it.x, it.y, 5, Color::hex(0xffe27a));
    }
    popScore(i, it.x, it.y, value, orb ? Color::hex(0xbff4ff) : col::white);
    fades_.push_back({it.x, it.y, 0, it.kind});
    it.active = false;
    if (it.trail >= 0) {
      // every ring of a trail, alone: PERFECT TRAIL! (+2)
      Trail& tr = trails_[it.trail];
      tr.taken++;
      tr.by = tr.by == -2 || tr.by == i ? i : -1;
      if (tr.taken == tr.total && tr.by == i && !tr.missed && tr.total >= PERFECT_MIN) {
        r.score += PERFECT_BONUS;
        popScore(i, r.x + 40, r.y + HIT_DY - 60, PERFECT_BONUS, Color::hex(0xffe36b));
        pop("PERFECT TRAIL!", SX(r.x + 60), SX(r.y + HIT_DY - 150), Color::hex(0xffcf3a), 20);
        bursts_.push_back({r.x, r.y + HIT_DY, 0, 0.38f, 130, color(i)});
        app.audio.sfx("item", 0.7f);
      }
    }
  }

  void hazards() {
    for (auto& st : storms_) {
      if (!st.active) continue;
      if (st.warning == 1 && st.x - STORM_RX * 1.2f < GW) {
        st.warning = 2;
        st.warnT = 0;
      }
      for (int i = 0; i < count(); i++) {
        Rider& r = riders_[i];
        if (r.guard > 0) continue;
        float dx = (r.x + 10 - st.x) / (STORM_RX + 36), dy = (r.y + HIT_DY - st.y) / (STORM_RY + 48);
        if (dx * dx + dy * dy < 1) zap(i, st);
      }
    }
  }
  void zap(int i, Storm& st) {
    Rider& r = riders_[i];
    float sy = r.y + HIT_DY >= st.y ? 1.0f : -1.0f;
    r.dizzy = DIZZY_ZAP;
    r.guard = GUARD_ZAP;
    r.vx = std::min(r.vx, 0.0f) - 320;
    r.vy = sy * 520;
    r.ramT = 0;
    loseRings(i, std::max(0, std::min(r.score, DROP_ZAP)), -1);
    // a jagged bolt from the cloud to the rider
    float x0 = st.x - 10, y0 = st.y + 30, x1 = r.x + 8, y1 = r.y + HIT_DY;
    for (int k = 0; k <= 7; k++) {
      float u = k / 7.0f, j = k == 0 || k == 7 ? 0 : ((float)rng.next() - 0.5f) * 60;
      bolt_[k][0] = x0 + (x1 - x0) * u + j;
      bolt_[k][1] = y0 + (y1 - y0) * u;
    }
    boltT_ = 0.26f;
    st.flashT = 0.09f;
    flashT_ = 0;
    stun(r);
    app.audio.sfx("hit", 0.6f);
    pop("ZAP!", SX(r.x + 20), SX(r.y + HIT_DY - 110), Color::hex(0xa47bff), 26);
  }

  void effects(float dt) {
    for (auto& st : storms_) {
      if (!st.active) continue;
      st.phase += dt;
      st.flick -= dt;
      st.flashT -= dt;
      st.warnT += dt;
      if (st.flick <= 0) {
        st.flick = 0.7f + (float)rng.next() * 1.3f;
        st.flashT = 0.06f;
      }
    }
    boltT_ -= dt;
    flashT_ += dt;
    for (auto& p : parts_) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    std::erase_if(parts_, [](const Particle& p) { return p.t >= p.life; });
    for (auto& g : ghosts_) g.t += dt;
    std::erase_if(ghosts_, [](const Ghost& g) { return g.t >= 0.22f; });
    for (auto& f : fades_) f.t += dt;
    std::erase_if(fades_, [](const Fade& f) { return f.t >= 0.22f; });
    for (auto& b : bursts_) b.t += dt;
    std::erase_if(bursts_, [](const Burst& b) { return b.t >= b.life; });
    for (auto& p : pops_) {
      p.t += dt;
      p.y -= 30 * dt;
    }
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
    // golden vapour off the back of every cloud
    vapourT_ -= dt;
    if (vapourT_ <= 0) {
      vapourT_ = 0.085f;
      for (int i = 0; i < count() && vapour_.size() < 30; i++) {
        const Rider& r = riders_[i];
        bool hot = r.ramT > 0;
        float cy = r.y + std::sin(r.bob * 3.1f + player(i).slot) * 6;
        vapour_.push_back({r.x - 78 + (float)rng.next() * 10, cy + 8 + ((float)rng.next() - 0.5f) * 22, -speed_ * (0.35f + (float)rng.next() * 0.2f), 0, 0,
                           hot ? 0.52f : 0.42f, 0, hot ? Color::hex(0xfff1a8) : Color::hex(0xffd45e)});
      }
    }
    for (auto& v : vapour_) {
      v.t += dt;
      v.x += v.vx * dt;
    }
    std::erase_if(vapour_, [](const Particle& p) { return p.t >= p.life; });
    // speed lines
    lineT_ -= dt;
    if (lineT_ <= 0) {
      lineT_ = 0.08f * (620 / speed_);
      for (auto& l : lines_)
        if (!l.active) {
          l = {GW + 100, rng.frange(130, 1000), speed_ * rng.frange(1.5f, 2.2f), rng.frange(2, 4.5f), rng.frange(0.12f, 0.3f), true};
          break;
        }
    }
    for (auto& l : lines_) {
      if (!l.active) continue;
      l.x -= l.v * dt;
      if (l.x < -300) l.active = false;
    }
    // gust streaks
    if (hasGust_ && (gust_.state == 1 || gust_.state == 2)) {
      bool warn = gust_.state == 1;
      int n = warn ? 5 : 16;
      float top = gust_.y - gust_.half;
      for (int k = 0; k < 16; k++) {
        Line& l = gustLines_[k];
        if (k >= n) {
          l.active = false;
          continue;
        }
        if (!l.active || l.x < -300) {
          l = {GW + rng.frange(0, 600), top + rng.frange(10, gust_.half * 2 - 10), speed_ * rng.frange(2, 3), 1, 0, true};
        }
        l.x -= l.v * dt;
        l.y += gust_.dir * (warn ? 20 : 260) * dt;
        if (l.y < top || l.y > top + gust_.half * 2) l.y = gust_.dir > 0 ? top + 8 : top + gust_.half * 2 - 8;
      }
    } else
      for (auto& l : gustLines_) l.active = false;
  }

  // --- CPU ---------------------------------------------------------------------------------------
  void cpuThink(int i, float dt) {
    Rider& r = riders_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    r.timer -= dt;
    if (r.timer <= 0) {
      r.timer = sk.think * (0.55f + (float)rng.next() * 0.4f);
      r.targetY = cpuTarget(i, sk) + ((float)rng.next() - 0.5f) * sk.aimNoise * 60;
      r.hasTarget = true;
      if (!r.chargeMode && !r.charging && r.recharge <= 0 && r.dizzy <= 0) {
        float hold = cpuBurstWish(i, sk);
        if (hold > 0) {
          r.chargeMode = true;
          r.wait = hold;
        }
      }
    }
    if (r.dizzy > 0) {
      r.moveY = 0;
      r.held = false;
      r.chargeMode = false;
      return;
    }
    float ty = r.hasTarget ? r.targetY : r.y;
    float my = clampf((ty - r.y) / 70, -1, 1);
    if (r.gustV != 0) my -= (r.gustV > 0 ? 1 : -1) * (0.2f + 0.5f * sk.accuracy);
    r.moveY = clampf(my, -1, 1);
    if (r.chargeMode) {
      r.held = true;
      if (r.charging)
        r.wait -= dt;
      else if (r.recharge > 0 || r.ramT > 0)
        r.chargeMode = false;
      if (r.chargeMode && r.wait <= 0) {
        r.held = false;
        r.chargeMode = false;
      }
    } else
      r.held = false;
  }
  // the height a CPU heads for: the best reachable catch ahead, steering round storms it has seen
  float cpuTarget(int i, const Skill& sk) {
    const Rider& r = riders_[i];
    float hitY = r.y + HIT_DY, bestY = r.y, bestScore = -1e9f;
    float pace = speed_ + std::max(0.0f, r.vx);
    for (auto& it : items_) {
      if (!it.active) continue;
      float ahead = it.x - (r.x + 12);
      if (ahead < -20 || ahead > 1050) continue;
      float tArrive = std::max(0.05f, ahead / pace), dy = std::fabs(it.y - hitY);
      if (dy / (MAX_VY * 0.85f) > tArrive + 0.1f) continue;
      float worth = it.kind == I_ORB ? WORTH_ORB : WORTH_RING, needY = it.y - HIT_DY;
      float score = worth * 100 - tArrive * 55 - dy * 0.06f - std::fabs(needY - r.home) * 0.05f;
      for (int o = 0; o < count(); o++) {
        if (o == i) continue;
        const Rider& q = riders_[o];
        float oy = isCpu(o) && q.hasTarget ? q.targetY : q.y;
        if (std::fabs(oy - needY) < 115) score -= std::fabs(q.y - needY) < std::fabs(r.y - needY) ? 95 : 45;
      }
      for (auto& st : storms_)
        if (st.active && std::fabs(st.x - it.x) < 280 && std::fabs(st.y - it.y) < 170) score -= 150;
      if (score > bestScore) {
        bestScore = score;
        bestY = needY;
      }
    }
    for (auto& st : storms_) {
      if (!st.active || time_ - st.seenAt < sk.reaction) continue;
      float ahead = st.x - r.x;
      if (ahead < -STORM_RX || ahead > pace * 1.7f) continue;
      if (rng.chance(sk.mistake * 0.5f)) continue;
      float band = STORM_RY + 110;
      if (std::fabs(bestY + HIT_DY - st.y) < band) {
        float up = st.y - band - HIT_DY, down = st.y + band - HIT_DY;
        bool upOk = up >= TOP, downOk = down <= BOTTOM;
        bestY = upOk && (!downOk || std::fabs(up - r.y) < std::fabs(down - r.y)) ? up : down;
      }
    }
    return clampf(bestY, TOP, BOTTOM);
  }
  // how long to charge a burst for right now (0 = don't): ram a rival lined up ahead, or race to a catch
  float cpuBurstWish(int i, const Skill& sk) {
    Rider& r = riders_[i];
    float aggression = std::max(0.12f, sk.accuracy * 0.7f - 0.2f);
    if (time_ >= r.nextRam)
      for (int o = 0; o < count(); o++) {
        const Rider& q = riders_[o];
        if (o == i || q.guard > 0 || q.dizzy > 0 || q.score <= 0) continue;
        float dx = q.x - r.x, dy = std::fabs(q.y - r.y);
        if (dx > 70 && dx < 430 && dy < 60 && rng.chance(aggression)) {
          r.nextRam = time_ + 2.4f + (1 - sk.accuracy) * 7 + (float)rng.next() * 1.5f;
          return 0.22f + (float)rng.next() * 0.48f;
        }
      }
    for (auto& it : items_) {
      if (!it.active) continue;
      float dx = it.x - r.x;
      if (dx < 150 || dx > 460 || std::fabs(it.y - (r.y + HIT_DY)) > 45) continue;
      bool contested = false;
      for (int o = 0; o < count(); o++)
        if (o != i && std::fabs(riders_[o].y - r.y) < 120 && riders_[o].x > r.x - 60) contested = true;
      if ((it.kind == I_ORB || contested) && rng.chance(aggression * 0.8f)) return 0.15f + (float)rng.next() * 0.25f;
    }
    return 0;
  }

  // --- drawing -----------------------------------------------------------------------------------
  void drawRing(Tex* t, float x, float y, float scale, bool front, float angle, Color tint) const {
    SDL_Rect half = front ? SDL_Rect{t->w / 2, 0, t->w - t->w / 2, t->h} : SDL_Rect{0, 0, t->w / 2, t->h};
    app.gfx.sprite(t, half, SX(x), SX(y), scale, scale, front ? 0.0f : 1.0f, 0.5f, angle, false, tint);
  }
  float itemY(const Item& it) const { return it.y + std::sin(clock_ / 0.26f + it.phase) * (it.kind == I_ORB ? 8 : 4); }
  float riderCy(int i) const { return riders_[i].y + std::sin(riders_[i].bob * 3.1f + player(i).slot) * 6; }

  void draw() override {
    drawArena();
    Tex* cloudT = app.gfx.tex("mg/dojo_cloud.png");
    Tex* ringT = app.gfx.tex("mg/dojo_ring.png");
    Tex* orbT = app.gfx.tex("mg/dojo_orb.png");
    Tex* stormT = app.gfx.tex("mg/dojo_storm.png");
    Tex* puffT = app.gfx.tex("mg/dojo_puff.png");
    SDL_Rect puffR{0, 0, puffT->w, puffT->h};
    for (auto& w : wisps_) app.gfx.sprite(puffT, puffR, SX(w[0]), SX(w[1]), 0.35f + w[2] * 0.6f, 0.25f + w[2] * 0.45f, 0.5f, 0.5f, 0, false, Color(255, 255, 255, 70));
    // storm clouds
    SDL_Rect stormR{0, 0, stormT->w, stormT->h};
    for (auto& st : storms_) {
      if (!st.active || st.x > GW + 300) continue;
      Color tint = st.flashT > 0 ? Color::hex(0xf4ecff) : STORM_TINT;
      app.gfx.sprite(stormT, stormR, SX(st.x), SX(st.y + std::sin(st.phase * 1.7f) * 6), STORM_SCALE, STORM_SCALE, 0.5f, 0.5f, 0, false, tint);
    }
    // the backs of the rings (behind the riders), and the orbs
    for (auto& it : items_) {
      if (!it.active || it.kind == I_ORB || it.x > GW + 100) continue;
      float y = itemY(it), sc = RING_SCALE * (it.kind == I_LOOSE ? 0.8f : 1);
      float ang = it.kind == I_LOOSE ? std::sin(clock_ / 0.09f + it.phase) * 25 : 0;
      app.gfx.ellipse(SX(it.x), SX(y), 22 * sc, 26 * sc, Color(255, 210, 74, 50));
      Color tint = it.kind == I_LOOSE && it.life < 0.9f && (int)(it.life / 0.11f) % 2 ? col::white.alpha(0.35f) : col::white;
      drawRing(ringT, it.x, y, sc, false, ang, tint);
    }
    SDL_Rect orbR{0, 0, orbT->w, orbT->h};
    for (auto& it : items_) {
      if (!it.active || it.kind != I_ORB || it.x > GW + 100) continue;
      float y = itemY(it);
      spr::star(SX(it.x), SX(y), 0.55f, clock_ * 50, Color(156, 240, 255, 120));
      app.gfx.circle(SX(it.x), SX(y), 22 + 3 * std::sin(clock_ / 0.18f + it.phase), Color(111, 224, 255, 70));
      app.gfx.sprite(orbT, orbR, SX(it.x), SX(y), ORB_SCALE, ORB_SCALE);
    }
    // vapour, after-images
    for (auto& v : vapour_) {
      float u = v.t / v.life;
      app.gfx.circle(SX(v.x), SX(v.y), (2.2f * (1 - u) + 0.4f) * 4, v.c.alpha(0.42f * (1 - u)));
    }
    SDL_Rect cloudR{0, 0, cloudT->w, cloudT->h};
    for (auto& g : ghosts_) {
      float a = 0.4f * (1 - g.t / 0.22f), x = g.x - 40 * (g.t / 0.22f);
      Color c = color(g.rider);
      app.gfx.sprite(cloudT, cloudR, SX(x), SX(g.y), CLOUD_SCALE, CLOUD_SCALE, 0.5f, 0.5f, 0, false, c.alpha(a));
      spr::character(player(g.rider).character, "dash", 0, SX(x + 4), SX(g.y + FEET_DY), CHAR_SCALE, false, c.alpha(a));
    }
    // riders, back to front
    std::vector<int> ord;
    for (int i = 0; i < count(); i++) ord.push_back(i);
    std::sort(ord.begin(), ord.end(), [&](int a, int b) { return riders_[a].y < riders_[b].y; });
    for (int i : ord) {
      const Rider& r = riders_[i];
      float cy = riderCy(i);
      Color pc = color(i);
      app.gfx.ellipse(SX(r.x), SX(cy + 26), 30, 11, pc.alpha(0.3f + 0.12f * std::sin(r.bob * 5)));
      if (r.charging || r.ramT > 0) {
        float k = r.charging ? r.charge : 1;
        bool full = r.charging && r.charge >= 1;
        float rad = (5 + 5 * k + (full ? std::sin(clock_ / 0.05f) * 0.8f : 0)) * 3.6f;
        app.gfx.circle(SX(r.x), SX(cy + HIT_DY + 10), rad, (full || r.ramT > 0 ? Color::hex(0xffe27a) : pc).alpha(0.18f + 0.3f * k));
      }
      app.gfx.sprite(cloudT, cloudR, SX(r.x), SX(cy), CLOUD_SCALE, CLOUD_SCALE, 0.5f, 0.5f, r.tilt);
      const char* anim = r.dizzy > 0 ? "stunned" : r.charging ? "crouch" : r.ramT > 0 ? "dash" : "idle";
      float at = r.dizzy > 0 ? r.animT : (r.charging || r.ramT > 0 ? 0 : r.bob);
      Color tint = r.flashT > 0 ? Color(255, 255, 210) : col::white;
      spr::character(player(i).character, anim, at, SX(r.x + 4), SX(cy + FEET_DY), CHAR_SCALE, false, tint);
      drawPlayerTag(i, SX(r.x + 4), SX(cy + FEET_DY) - 78);
      if (r.charging) {
        // the charge gauge round the rider
        bool full = r.charge >= 1;
        float gx = SX(r.x), gy = SX(cy + HIT_DY - 4), R = SX(GAUGE_R);
        const int segs = 20;
        int lit = (int)(r.charge * segs + 0.5f);
        for (int k = 0; k < segs; k++) {
          float a0 = -PI / 2 + k * PI * 2 / segs, a1 = a0 + PI * 2 / segs;
          Color c = k < lit ? (full ? Color::hex(0xffe27a) : pc) : Color(10, 17, 32, 90);
          app.gfx.line(gx + std::cos(a0) * R, gy + std::sin(a0) * R, gx + std::cos(a1) * R, gy + std::sin(a1) * R, k < lit ? 2.7f : 3.5f, c);
        }
      }
      if (!isCpu(i) && !r.burstOnce && time_ > 0.6f && time_ < 9) app.gfx.text("HOLD A", SX(r.x + 96), SX(cy - 150) + std::sin(clock_ / 0.16f) * 2, 14, col::white, LEFT);
    }
    // ring fronts (over the riders) and loose rings
    for (auto& it : items_) {
      if (!it.active || it.kind == I_ORB || it.x > GW + 100) continue;
      float y = itemY(it), sc = RING_SCALE * (it.kind == I_LOOSE ? 0.8f : 1);
      float ang = it.kind == I_LOOSE ? std::sin(clock_ / 0.09f + it.phase) * 25 : 0;
      Color tint = it.kind == I_LOOSE && it.life < 0.9f && (int)(it.life / 0.11f) % 2 ? col::white.alpha(0.35f) : col::white;
      drawRing(ringT, it.x, y, sc, true, ang, tint);
    }
    // caught rings and orbs swell and fade
    for (auto& f : fades_) {
      float u = f.t / 0.22f, sc = 1 + 0.45f * u;
      Color c = Color(255, 246, 200, (unsigned char)(255 * (1 - u)));
      if (f.kind == I_ORB)
        app.gfx.sprite(orbT, orbR, SX(f.x), SX(f.y), ORB_SCALE * sc, ORB_SCALE * sc, 0.5f, 0.5f, 0, false, c);
      else {
        drawRing(ringT, f.x, f.y, RING_SCALE * sc, false, 0, c);
        drawRing(ringT, f.x, f.y, RING_SCALE * sc, true, 0, c);
      }
    }
    for (auto& p : parts_) {
      float u = p.t / p.life;
      app.gfx.circle(SX(p.x), SX(p.y), p.r * (1 - u) * 0.75f, p.c.alpha(1 - u));
    }
    for (auto& b : bursts_) {
      float u = b.t / b.life, rad = SX(b.r) * (0.3f + 0.7f * easeOut(u));
      app.gfx.circle(SX(b.x), SX(b.y), rad, b.c.alpha(0.45f * (1 - u)));
    }
    // the gust band
    if (hasGust_ && (gust_.state == 1 || gust_.state == 2)) {
      bool warn = gust_.state == 1;
      float pulse = 0.5f + 0.5f * std::sin(clock_ / 0.07f), top = SX(gust_.y - gust_.half), h = SX(gust_.half * 2);
      app.gfx.rect(0, top, VW, h, Color(223, 244, 255, (unsigned char)(255 * (warn ? 0.05f + 0.05f * pulse : 0.12f))));
      Color lc = Color(255, 255, 255, (unsigned char)(255 * (warn ? 0.25f + 0.35f * pulse : 0.3f)));
      app.gfx.line(0, top, VW, top, 1.4f, lc);
      app.gfx.line(0, top + h, VW, top + h, 1.4f, lc);
      Color ac = Color(255, 255, 255, (unsigned char)(255 * (warn ? 0.5f + 0.45f * pulse : 0.35f)));
      for (int k = 0; k < 3; k++) {
        float cx = SX(GW - 90), cy = SX(gust_.y + (k - 1) * 70 * gust_.dir), d = SX(gust_.dir * 18);
        app.gfx.line(cx - 11.5f, cy - d, cx, cy + d, 3, ac);
        app.gfx.line(cx + 11.5f, cy - d, cx, cy + d, 3, ac);
      }
      for (auto& l : gustLines_)
        if (l.active) app.gfx.line(SX(l.x), SX(l.y), SX(l.x + 90), SX(l.y - gust_.dir * 12), 1.6f, Color(255, 255, 255, warn ? 64 : 150));
    }
    // the bolt
    if (boltT_ > 0) {
      float a = boltT_ / 0.26f * ((int)(boltT_ / 0.04f) % 2 ? 0.6f : 1);
      const float widths[3] = {7, 3.1f, 1.4f};
      const Color cols[3] = {Color(143, 109, 255, 128), Color(217, 204, 255, 230), col::white};
      for (int l = 0; l < 3; l++)
        for (int k = 0; k < 7; k++) app.gfx.line(SX(bolt_[k][0]), SX(bolt_[k][1]), SX(bolt_[k + 1][0]), SX(bolt_[k + 1][1]), widths[l], cols[l].alpha(a));
    }
    // storm warnings at the right edge
    for (auto& st : storms_) {
      if (!st.active || st.warning == 0) continue;
      float a = st.warning == 1 ? std::min(1.0f, st.warnT / 0.22f) : 1 - st.warnT / 0.2f;
      if (a <= 0) continue;
      float sc = st.warning == 1 ? (st.warnT < 0.22f ? 0.6f + 0.4f * easeBack(st.warnT / 0.22f) : 1 + 0.08f * std::sin(clock_ / 0.09f)) : 1 - 0.4f * (st.warnT / 0.2f);
      float x = VW - 31, y = SX(st.y), R = 20 * sc;
      app.gfx.circle(x + 1.3f, y + 2.2f, R, Color(10, 8, 32, (unsigned char)(90 * a)));
      app.gfx.circle(x, y, R, Color(75, 47, 154, (unsigned char)(255 * a)));
      app.gfx.ring(x, y, R * 0.92f, col::white.alpha(a));
      Color yc = Color(255, 228, 92, (unsigned char)(255 * a));
      app.gfx.line(x + 3.5f * sc, y - 13 * sc, x - 4 * sc, y + 1.5f * sc, 3.5f * sc, yc);
      app.gfx.line(x - 4 * sc, y + 1.5f * sc, x + 4 * sc, y - 1.5f * sc, 3.5f * sc, yc);
      app.gfx.line(x + 4 * sc, y - 1.5f * sc, x - 4 * sc, y + 13 * sc, 3.5f * sc, yc);
      Color wc = col::white.alpha(0.95f * a);
      for (int k = 0; k < 2; k++) {
        float cx = x - (26 + k * 11) * sc;
        app.gfx.line(cx, y, cx + 6 * sc, y - 7 * sc, 2.5f * sc, wc);
        app.gfx.line(cx, y, cx + 6 * sc, y + 7 * sc, 2.5f * sc, wc);
      }
    }
    // cloud tops rushing past in front, and speed lines
    for (auto& n : near_) app.gfx.sprite(puffT, puffR, SX(n[0]), SX(n[1]), 1.6f, 1.0f, 0.5f, 0.5f, 0, false, Color(255, 255, 255, 235));
    for (auto& l : lines_)
      if (l.active) app.gfx.line(SX(l.x), SX(l.y), SX(l.x + 60 * l.len), SX(l.y), 1.2f, Color(255, 255, 255, (unsigned char)(255 * l.a)));
    if (flashT_ < 0.18f) app.gfx.rect(0, 0, VW, VH, Color(217, 204, 255, (unsigned char)(255 * 0.16f * (1 - flashT_ / 0.18f))));
    for (auto& p : pops_) {
      float a = p.t < p.life * 0.7f ? 1 : 1 - (p.t - p.life * 0.7f) / (p.life * 0.3f);
      app.gfx.text(p.text, p.x, p.y, p.size, p.c.alpha(a), CENTER);
    }
    if (rush_ && bannerT_ < 1.5f) {
      float a = bannerT_ < 1.2f ? 1 : 1 - (bannerT_ - 1.2f) / 0.3f;
      app.gfx.text("RING RUSH!", VW / 2, 380, 40, col::gold.alpha(a), CENTER, true, 0.7f + 0.3f * easeBack(std::min(1.0f, bannerT_ / 0.25f)));
    }
    drawTimer(DURATION - time_);
    std::vector<int> sc;
    for (auto& r : riders_) sc.push_back(r.score);
    drawScores(sc, "rings");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& r : riders_) s.push_back(r.score);
    return s;
  }
  std::string scoreLabel(int i) const override { return std::to_string(riders_[i].score) + (riders_[i].score == 1 ? " ring" : " rings"); }

 private:
  struct Fade {
    float x, y, t;
    int kind;
  };
  struct Burst {
    float x, y, t, life, r;
    Color c;
  };
  std::vector<Rider> riders_;
  std::vector<Item> items_;
  std::vector<Storm> storms_;
  std::vector<Trail> trails_;
  Gust gust_{0, 0, 1, 0, 3, 0};
  bool hasGust_ = false;
  std::vector<Pop> pops_;
  std::vector<Particle> parts_, vapour_;
  std::vector<Ghost> ghosts_;
  std::vector<Fade> fades_;
  std::vector<Burst> bursts_;
  std::array<std::array<float, 3>, 7> wisps_{};
  std::array<std::array<float, 2>, 5> near_{};
  std::array<Line, 20> lines_{};
  std::array<Line, 16> gustLines_{};
  float bolt_[8][2] = {};
  float time_ = 0, clock_ = 0, scroll_ = 0, speed_ = 560, nextAt_ = 0, bannerT_ = 9;
  float boltT_ = 0, flashT_ = 9, vapourT_ = 0, lineT_ = 0;
  int prev_ = P_NONE;
  bool rush_ = false;
};

}  // namespace

REGISTER_MINIGAME("cloud-rider", CloudRider);

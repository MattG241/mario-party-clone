// Repulsor Range (Hero Heights test range at dusk): hover on your pad and aim a reticle with the stick.
// Tap A for a quick blast, or hold A and let go for a big charged one. Pop drones (zippers, armoured
// heavies, pop-up discs, the rare gold drone) for points and keep hitting for a combo multiplier, but
// never hit the passenger balloons: that costs 3 points. The last 10 seconds are a drone swarm. Top
// score after 45 seconds wins.
// Targets, blasts, scoring and the CPU marksman follow the web game's rangeRules.ts, in its 1920x1080
// stage coordinates (drawn scaled by S) and milliseconds.
#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float S = VW / 1920.0f;
constexpr float PI = 3.14159265f;
constexpr float DURATION = 45;
constexpr float CHAR_SCALE = 0.84f;  // the web's 0.6
constexpr float HAND_X = 40, HAND_Y = -122;

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{520, 0.55f, 0.24f, 0.55f, 700}, {300, 0.78f, 0.11f, 0.28f, 420}, {170, 0.9f, 0.05f, 0.13f, 240}};

namespace R {
constexpr float X0 = 110, X1 = 1810, Y0 = 170, Y1 = 740, DECK_Y = 770, PAD_Y = 900, RET_MAX = 1250, RET_K = 13, RET_CHARGE_K = 0.6f, RX0 = 60, RX1 = 1860,
                RY0 = 150, RY1 = 820, QUICK_R = 30, QUICK_CD = 230, CHARGE_DELAY = 160, CHARGE_MS = 900, CHARGE_MIN = 0.35f, BIG_R0 = 90, BIG_R1 = 200,
                BIG_CD = 450, COMBO_MS = 2600, BALLOON_SAFE_MS = 700;
constexpr int COMBO_STEP = 6, COMBO_MAX = 3, BALLOON_COST = 3;
}  // namespace R

enum Kind { DRONE, ZIP, HEAVY, DISC, GOLD, BALLOON };
struct KindDef {
  float r;
  int hp, pts;
};
constexpr KindDef KINDS[6] = {{42, 1, 1}, {36, 1, 2}, {62, 3, 4}, {52, 1, 1}, {40, 1, 5}, {58, 99, -R::BALLOON_COST}};

struct Target {
  int id = 0, kind = DRONE, hp = 1, hops = 0, art = 0;
  float x = 0, y = 0, vx = 0, vy = 0, r = 0, age = 0, life = 99999, baseY = 0, amp = 0, freq = 0, phase = 0, wait = 0, tx = 0, ty = 0, safe = 0;
  float flash = 0;
  bool dead = false;
};

float padX(int i, int n) {
  static const float x1[1] = {960}, x2[2] = {720, 1200}, x3[3] = {560, 960, 1360}, x4[4] = {480, 800, 1120, 1440};
  const float* xs = n == 1 ? x1 : n == 2 ? x2 : n == 3 ? x3 : x4;
  return xs[std::min(i, std::max(0, std::min(n, 4) - 1))];
}

int pickKind(float roll, bool storm) {
  const int kinds[5] = {DRONE, DISC, ZIP, HEAVY, GOLD};
  const float w[5] = {40, 18, 16, 10, storm ? 7.0f : 2.0f};
  float total = 0;
  for (float x : w) total += x;
  float x = roll * total;
  for (int k = 0; k < 5; k++) {
    x -= w[k];
    if (x < 0) return kinds[k];
  }
  return DRONE;
}

Target makeTarget(int kind, int id, Random& rng) {
  const KindDef& k = KINDS[kind];
  Target t;
  t.id = id;
  t.kind = kind;
  t.r = k.r;
  t.hp = k.hp;
  t.phase = (float)rng.next() * PI * 2;
  bool fromLeft = rng.next() < 0.5;
  switch (kind) {
    case DRONE:
    case HEAVY:
    case GOLD: {
      float speed = kind == HEAVY ? 90 + 35 * (float)rng.next() : kind == GOLD ? 360 + 60 * (float)rng.next() : 170 + 90 * (float)rng.next();
      t.x = fromLeft ? R::X0 - 80 : R::X1 + 80;
      t.baseY = R::Y0 + 40 + (float)rng.next() * (R::Y1 - R::Y0 - 120);
      t.y = t.baseY;
      t.vx = fromLeft ? speed : -speed;
      t.amp = kind == HEAVY ? 14 : 30 + 50 * (float)rng.next();
      t.freq = kind == GOLD ? 1.2f : 0.5f + 0.45f * (float)rng.next();
      break;
    }
    case ZIP:
      t.x = R::X0 + 120 + (float)rng.next() * (R::X1 - R::X0 - 240);
      t.y = R::Y0 + 60 + (float)rng.next() * (R::Y1 - R::Y0 - 160);
      t.tx = t.x;
      t.ty = t.y;
      t.wait = 700 + 400 * (float)rng.next();
      t.hops = 3 + (int)(rng.next() * 2);
      break;
    case DISC:
      t.x = R::X0 + 140 + (float)rng.next() * (R::X1 - R::X0 - 280);
      t.baseY = R::Y1 - 100 - 110 * (float)rng.next();
      t.y = R::DECK_Y + 40;
      t.life = 2600;
      break;
    case BALLOON:
      t.x = R::X0 + 100 + (float)rng.next() * (R::X1 - R::X0 - 200);
      t.y = 1150;
      t.vy = -(70 + 40 * (float)rng.next());
      t.amp = 26 + 20 * (float)rng.next();
      t.freq = 0.35f + 0.2f * (float)rng.next();
      t.baseY = t.x;
      break;
  }
  return t;
}

// Move a target along its path; false once it has left the range.
bool stepTarget(Target& t, float dt, Random& rng) {
  float s = dt / 1000;
  t.age += dt;
  if (t.safe > 0) t.safe -= dt;
  switch (t.kind) {
    case DRONE:
    case HEAVY:
    case GOLD:
      t.x += t.vx * s;
      t.y = t.baseY + std::sin(t.age / 1000 * PI * 2 * t.freq + t.phase) * t.amp;
      return t.vx > 0 ? t.x < R::X1 + 120 : t.x > R::X0 - 120;
    case ZIP: {
      if (t.wait > 0) {
        t.wait -= dt;
        t.vx = t.vy = 0;
        t.y += std::sin(t.age / 180) * 0.4f;
        if (t.wait <= 0) {
          if (t.hops <= 0) return false;
          t.hops--;
          t.tx = std::max(R::X0 + 80, std::min(R::X1 - 80, t.x + ((float)rng.next() - 0.5f) * 700));
          t.ty = std::max(R::Y0 + 50, std::min(R::Y1 - 80, t.y + ((float)rng.next() - 0.5f) * 420));
        }
        return true;
      }
      float dx = t.tx - t.x, dy = t.ty - t.y, d = std::hypot(dx, dy), step = 1900 * s;
      if (d <= step) {
        t.x = t.tx;
        t.y = t.ty;
        t.wait = 650 + 450 * (float)rng.next();
        t.vx = t.vy = 0;
      } else {
        t.vx = dx / d * 1900;
        t.vy = dy / d * 1900;
        t.x += dx / d * step;
        t.y += dy / d * step;
      }
      return true;
    }
    case DISC: {
      t.life -= dt;
      float rise = std::min(1.0f, t.age / 320);
      float sink = t.life < 320 ? std::max(0.0f, t.life / 320) : 1;
      float k = std::min(rise, sink);
      t.y = R::DECK_Y + 40 + (t.baseY - R::DECK_Y - 40) * (1 - (1 - k) * (1 - k));
      t.vy = 0;
      return t.life > 0;
    }
    default:
      t.y += t.vy * s;
      t.x = t.baseY + std::sin(t.age / 1000 * PI * 2 * t.freq + t.phase) * t.amp;
      return t.y > -160;
  }
}

bool blastHits(const Target& t, float x, float y, float r) {
  if (t.dead || (t.kind == BALLOON && t.safe > 0)) return false;
  float reach = t.kind == BALLOON ? t.r * 0.85f : t.r * 0.9f;
  return std::hypot(t.x - x, t.y - y) < r + reach;
}

bool isBullseye(const Target& t, float x, float y) { return t.kind == DISC && std::hypot(t.x - x, t.y - y) < 18; }
int comboMult(int combo) { return std::min(R::COMBO_MAX, 1 + combo / R::COMBO_STEP); }
float chargeLevel(float held) { return std::max(0.0f, std::min(1.0f, (held - R::CHARGE_DELAY) / R::CHARGE_MS)); }
float bigRadius(float c) { return R::BIG_R0 + (R::BIG_R1 - R::BIG_R0) * c; }

// --- The marksman (shared by people and CPUs) -----------------------------------------------------
struct Gunner {
  float x = 0, y = 460, vx = 0, vy = 0, cd = 0, held = 0;
  bool charging = false;
  int combo = 0;
  float comboT = 0;
};

struct RangeInput {
  float stickX = 0, stickY = 0;
  bool holdA = false, pressA = false;
};

struct Shot {
  bool big = false;
  float x = 0, y = 0, r = 0, charge = 0;
};

// Move the reticle and work the trigger: a quick blast on the press, a charged one on release.
bool stepGunner(Gunner& g, const RangeInput& inp, float dt, Shot& shot) {
  float s = dt / 1000;
  float slow = g.charging && g.held > R::CHARGE_DELAY ? R::RET_CHARGE_K : 1;
  float ix = inp.stickX, iy = inp.stickY, m = std::hypot(ix, iy);
  if (m > 1) {
    ix /= m;
    iy /= m;
  }
  float k = 1 - std::exp(-R::RET_K * s);
  g.vx += (ix * R::RET_MAX * slow - g.vx) * k;
  g.vy += (iy * R::RET_MAX * slow - g.vy) * k;
  g.x = std::max(R::RX0, std::min(R::RX1, g.x + g.vx * s));
  g.y = std::max(R::RY0, std::min(R::RY1, g.y + g.vy * s));
  if (g.cd > 0) g.cd -= dt;
  if (g.comboT > 0) {
    g.comboT -= dt;
    if (g.comboT <= 0) g.combo = 0;
  }
  if (inp.pressA) {
    g.held = 0;
    g.charging = true;
    if (g.cd <= 0) {
      g.cd = R::QUICK_CD;
      shot = Shot{false, g.x, g.y, R::QUICK_R, 0};
      return true;
    }
  } else if (inp.holdA && g.charging) {
    g.held += dt;
  } else if (!inp.holdA && g.charging) {
    float c = chargeLevel(g.held);
    g.charging = false;
    g.held = 0;
    if (c >= R::CHARGE_MIN) {
      g.cd = R::BIG_CD;
      shot = Shot{true, g.x, g.y, bigRadius(c), c};
      return true;
    }
  }
  return false;
}

// --- CPU marksman -----------------------------------------------------------------------------------
struct Brain {
  float think = 0, ox = 0, oy = 0, settle = 0;
  int tid = -1;
  bool charge = false, careless = false, holding = false;
};

bool balloonNear(const std::vector<Target>& ts, float x, float y, float r) {
  for (const Target& t : ts)
    if (t.kind == BALLOON && !t.dead && t.safe <= 0 && std::hypot(t.x - x, t.y - y) < r + t.r * 0.85f + 12) return true;
  return false;
}

int clusterAt(const std::vector<Target>& ts, float x, float y, float r) {
  int n = 0;
  for (const Target& t : ts)
    if (t.kind != BALLOON && !t.dead && std::hypot(t.x - x, t.y - y) < r) n++;
  return n;
}

const Target* choose(const std::vector<Target>& ts, const Gunner& g, const std::vector<int>& claimed, const Skill& sk, Random& rng, int current) {
  const Target* best = nullptr;
  float bestScore = -1e9f;
  bool blunder = rng.next() < sk.mistake;
  for (const Target& t : ts) {
    if (t.kind == BALLOON || t.dead) continue;
    if (t.x < R::RX0 || t.x > R::RX1 || t.y > R::RY1) continue;
    float d = std::hypot(t.x - g.x, t.y - g.y);
    bool cl = std::find(claimed.begin(), claimed.end(), t.id) != claimed.end();
    float score = (KINDS[t.kind].pts + 1) / (1 + d / 420) - (cl ? 0.9f : 0) - (balloonNear(ts, t.x, t.y, 20) ? 1.2f * sk.accuracy : 0);
    if (t.kind == DISC && t.life < 700) score -= 0.8f;
    if (t.kind != ZIP && t.kind != DISC && (t.vx > 0 ? t.x > R::X1 - 120 : t.x < R::X0 + 120)) score -= 0.6f;
    if (t.id == current) score += 0.3f;
    if (blunder) score = (float)rng.next();
    if (score > bestScore) {
      bestScore = score;
      best = &t;
    }
  }
  return best;
}

// Picks a target worth the reticle's trip (not one another CPU is on, not one behind a balloon), leads
// it, fires when on it, and charges a big blast for armoured heavies and tight clusters. Weaker
// marksmen aim wider, settle slower and sometimes forget the balloons.
RangeInput rangeCpu(Brain& b, const Gunner& g, const std::vector<Target>& ts, const std::vector<int>& claimed, const Skill& sk, float dt, Random& rng) {
  RangeInput inp;
  inp.holdA = b.holding;
  b.think -= dt;
  if (b.settle > 0) b.settle -= dt;
  const Target* t = nullptr;
  for (const Target& q : ts)
    if (q.id == b.tid && !q.dead) t = &q;
  if (b.think <= 0 || !t) {
    b.think = sk.think * (0.8f + 0.4f * (float)rng.next());
    float n = sk.aimNoise * 46;
    b.ox = ((float)rng.next() - 0.5f) * 2 * n;
    b.oy = ((float)rng.next() - 0.5f) * 2 * n;
    b.careless = rng.next() < sk.mistake * 1.3f;
    const Target* pick = choose(ts, g, claimed, sk, rng, b.tid);
    if (pick && (!t || pick->id != t->id)) {
      b.tid = pick->id;
      b.settle = sk.reaction * (0.3f + 0.3f * (float)rng.next());
      b.charge = pick->kind == HEAVY || clusterAt(ts, pick->x, pick->y, 130) >= 3;
    }
    t = pick;
  }
  if (!t) {
    b.holding = false;
    inp.holdA = false;
    return inp;
  }
  float lead = 0.1f + sk.reaction / 3000;
  float ax = t->x + t->vx * lead + b.ox, ay = t->y + t->vy * lead + b.oy;
  float dx = ax - g.x, dy = ay - g.y, d = std::hypot(dx, dy);
  float gain = std::min(1.0f, d / 150);
  if (d > 4) {
    inp.stickX = dx / d * gain;
    inp.stickY = dy / d * gain;
  }
  bool onTarget = std::hypot(t->x - g.x, t->y - g.y) < t->r * 0.8f + 8;
  if (b.charge) {
    if (!b.holding) {
      if (b.settle <= 0 && g.cd <= 0 && (b.careless || !balloonNear(ts, g.x, g.y, R::QUICK_R))) {
        inp.pressA = true;
        b.holding = true;
      }
    } else {
      float c = chargeLevel(g.held);
      if (c >= 0.85f && onTarget && (b.careless || !balloonNear(ts, g.x, g.y, bigRadius(c)))) b.holding = false;
      else if (c >= 1 && !onTarget && d > 300) b.holding = false;
    }
    inp.holdA = b.holding;
    return inp;
  }
  if (b.holding) {
    b.holding = false;
    inp.holdA = false;
    return inp;
  }
  if (b.settle <= 0 && g.cd <= 0 && onTarget && (b.careless || !balloonNear(ts, g.x, g.y, R::QUICK_R))) {
    inp.pressA = true;
    b.holding = true;
    inp.holdA = true;
    b.settle = 60;
  }
  return inp;
}

// --- The game ----------------------------------------------------------------------------------------
struct Pilot {
  Gunner g;
  Brain brain;
  RangeInput input;
  float x = 0, y = 0, bob = 0, throwT = -1, animT = 0;
  int lastMult = 1;
  bool prevA = false;
};

struct Beam {
  float x0, y0, x1, y1, thick, t, dur;
  Color c;
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

struct Pending {
  int pilot;
  Shot shot;
};

class RepulsorRange : public Minigame {
 public:
  void start() override {
    int n = count();
    for (int i = 0; i < n; i++) {
      Pilot p;
      p.x = padX(i, n);
      p.y = R::PAD_Y - 18;
      p.g.x = p.x;
      p.g.y = 470;
      p.bob = i * 1.7f;
      pilots_.push_back(p);
      score_.push_back(0);
    }
  }

  void update(float dt) override {
    float ms = dt * 1000;
    time_ += dt;
    int n = count();
    if (!storm_ && time_ >= DURATION - 10) {
      storm_ = true;
      word("DRONE SWARM!", VW / 2, 420, 40, Color::hex(0xffe08a), 1200);
      for (int i = 0; i < 3; i++) spawn(i == 1 ? GOLD : DRONE);
    }
    spawnT_ -= ms;
    balloonT_ -= ms;
    if (spawnT_ <= 0) {
      spawnT_ = (900 - (n - 2) * 70) * (storm_ ? 0.6f : 1);
      int live = 0;
      for (auto& t : targets_)
        if (t.kind != BALLOON) live++;
      if (live < 5 + n + (storm_ ? 3 : 0)) spawn(pickKind((float)rng.next(), storm_));
    }
    if (balloonT_ <= 0) {
      balloonT_ = 3600 + 1400 * (float)rng.next();
      int b = 0;
      for (auto& t : targets_)
        if (t.kind == BALLOON) b++;
      if (b < 3) spawn(BALLOON);
    }
    for (auto& t : targets_) {
      t.flash = std::max(0.0f, t.flash - ms);
      if (!t.dead && !stepTarget(t, ms, rng)) t.dead = true;
    }
    std::erase_if(targets_, [](const Target& t) { return t.dead; });
    // the reticles, and the shots fired this frame
    std::vector<Pending> shots;
    for (int i = 0; i < n; i++) {
      Pilot& pl = pilots_[i];
      pl.bob += dt * 2.2f;
      pl.animT += dt;
      if (pl.throwT >= 0 && (pl.throwT += dt) > 0.4f) pl.throwT = -1;
      if (isCpu(i)) {
        claimed_.clear();
        for (int j = 0; j < n; j++)
          if (j != i && isCpu(j) && pilots_[j].brain.tid >= 0) claimed_.push_back(pilots_[j].brain.tid);
        RangeInput c = rangeCpu(pl.brain, pl.g, targets_, claimed_, SKILL[cpuLevel(i)], ms, rng);
        bool hold = c.holdA || c.pressA;
        pl.input.stickX = c.stickX;
        pl.input.stickY = c.stickY;
        pl.input.pressA = hold && !pl.prevA;
        pl.input.holdA = hold;
        pl.prevA = hold;
      } else {
        pl.input.stickX = pad(i).x;
        pl.input.stickY = pad(i).y;
        pl.input.holdA = pad(i).down(B_A);
        pl.input.pressA = pad(i).press(B_A);
      }
      Shot shot;
      if (stepGunner(pl.g, pl.input, ms, shot)) shots.push_back(Pending{i, shot});
    }
    // two blasts at the same drone in one frame: the cleaner shot gets it (ties rotate seats)
    if (shots.size() > 1) {
      std::vector<float> key(shots.size());
      for (size_t k = 0; k < shots.size(); k++) {
        float best = 1e9f;
        for (auto& t : targets_)
          if (t.kind != BALLOON && blastHits(t, shots[k].shot.x, shots[k].shot.y, shots[k].shot.r)) best = std::min(best, std::hypot(t.x - shots[k].shot.x, t.y - shots[k].shot.y) / t.r);
        key[k] = best;
      }
      std::vector<int> order;
      for (size_t k = 0; k < shots.size(); k++) order.push_back((int)((k + frame_) % shots.size()));
      std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return key[a] < key[b]; });
      for (int k : order) fire(shots[k].pilot, shots[k].shot);
    } else if (shots.size() == 1) fire(shots[0].pilot, shots[0].shot);
    frame_++;
    for (auto& b : beams_) b.t += ms;
    std::erase_if(beams_, [](const Beam& b) { return b.t >= b.dur; });
    for (auto& w : words_) w.t += ms;
    std::erase_if(words_, [](const Word& w) { return w.t > w.hold + 250; });
    for (auto& w : waves_) w.t += ms;
    std::erase_if(waves_, [](const Wave& w) { return w.t >= w.dur; });
  }

  void spawn(int kind) {
    Target t = makeTarget(kind, nextId_++, rng);
    t.art = rng.range(0, 2);
    targets_.push_back(t);
    if (kind == GOLD) word("GOLD DRONE!", VW / 2, 300 * S, 22, Color::hex(0xffbf2a), 700);
    if (kind == ZIP) wave(t.x, t.y, 10, 60, 300, Color::hex(0xffb05a));
  }

  void fire(int i, const Shot& shot) {
    Pilot& pl = pilots_[i];
    Gunner& g = pl.g;
    float face = shot.x < pl.x ? -1.0f : 1.0f;
    pl.throwT = 0;
    float bob = std::sin(pl.bob) * 6;
    beams_.push_back(Beam{pl.x + HAND_X * face, pl.y + bob + HAND_Y, shot.x, shot.y, shot.big ? 46.0f : 18.0f, 0, shot.big ? 240.0f : 130.0f, color(i)});
    if (shot.big) {
      wave(shot.x, shot.y, 20, shot.r, 380, color(i));
      wave(shot.x, shot.y, 10, shot.r * 0.6f, 260, col::white);
      app.audio.sfx("bump", 0.6f);
    } else app.audio.sfx("dash", 0.3f);
    int points = 0, kills = 0;
    bool balloon = false;
    for (auto& t : targets_) {
      if (!blastHits(t, shot.x, shot.y, shot.r)) continue;
      if (t.kind == BALLOON) {
        // a passenger balloon: it wobbles (and can't be hit again for a moment); the shooter pays
        t.safe = R::BALLOON_SAFE_MS;
        t.vy -= 30;
        balloon = true;
        continue;
      }
      t.hp -= shot.big ? 3 : 1;
      bool killed = t.hp <= 0;
      bool bull = isBullseye(t, shot.x, shot.y);
      g.combo++;
      g.comboT = R::COMBO_MS;
      if (killed) {
        points += (KINDS[t.kind].pts + (bull ? 1 : 0)) * comboMult(g.combo);
        kills++;
        t.dead = true;
        wave(t.x, t.y, t.r * 0.5f, t.r * 1.8f, 320, t.kind == GOLD ? Color::hex(0xffd24a) : Color::hex(0xffc070));
        if (bull) word("BULLSEYE!", t.x * S, (t.y - 80) * S, 20, Color::hex(0xffbf2a), 460);
        if (t.kind == GOLD || t.kind == HEAVY) app.audio.sfx("coin");
      } else {
        t.flash = 90;
        t.x += ((float)rng.next() - 0.5f) * 16;
      }
    }
    if (balloon) {
      g.combo = 0;
      g.comboT = 0;
      points -= R::BALLOON_COST;
      word("OOPS! -3", shot.x * S, (shot.y - 100) * S, 24, Color::hex(0xff6b5e), 700);
      app.audio.sfx("bad", 0.6f);
      pl.lastMult = 1;
    }
    int before = score_[i];
    score_[i] = std::max(0, score_[i] + points);
    int gained = score_[i] - before;
    if (gained > 0) word("+" + std::to_string(gained), shot.x * S, (shot.y - 40) * S, 22, gained >= 5 ? Color::hex(0xffe36b) : col::white, 520);
    if (kills >= 3) word("MULTI-HIT!", shot.x * S, (shot.y - 90) * S, 24, Color::hex(0xffd05a), 520);
    int mult = comboMult(g.combo);
    if (mult > pl.lastMult) word(mult >= 3 ? "COMBO x3!" : "COMBO x2!", pl.x * S, (pl.y - 230) * S, 22, mult >= 3 ? Color::hex(0xffbf2a) : Color::hex(0x8fe6ff), 620);
    pl.lastMult = mult;
  }

  void word(const std::string& text, float x, float y, int size, Color c, float hold) { words_.push_back(Word{text, x, y, 0, hold, size, c}); }
  void wave(float x, float y, float r0, float r1, float dur, Color c) { waves_.push_back(Wave{x * S, y * S, r0 * S, r1 * S, 0, dur, c}); }

  // --- Drawing --------------------------------------------------------------------------------------
  void draw() override {
    drawArena();
    static const char* const ART[6] = {"mg/heroes_drone.png", "mg/heroes_zip.png", "mg/heroes_heavy.png", "mg/heroes_disc.png", "mg/heroes_gold.png", "mg/heroes_balloon.png"};
    static const char* const BALLOONS[3] = {"mg/heroes_balloon.png", "mg/heroes_balloon_b.png", "mg/heroes_balloon_c.png"};
    // balloons behind, then the targets
    for (int pass = 0; pass < 2; pass++)
      for (auto& t : targets_) {
        if ((t.kind == BALLOON) != (pass == 0)) continue;
        Tex* tex = app.gfx.tex(t.kind == BALLOON ? BALLOONS[t.art] : ART[t.kind]);
        SDL_Rect src{0, 0, tex->w, tex->h};
        float x = t.x * S, y = t.y * S;
        float ang = 0, sc = 0.95f, oy = 0.5f;
        bool flip = false;
        Color tint = col::white;
        switch (t.kind) {
          case BALLOON:
            ang = std::sin(t.age / 700 + t.phase) * 5 + (t.safe > 0 ? std::sin(t.age / 40) * 10 : 0);
            sc = 1;
            oy = 62.0f / 200;
            break;
          case ZIP:
            flip = t.vx < 0;
            ang = (t.vx != 0 || t.vy != 0) ? std::atan2(t.vy, std::fabs(t.vx) + 1) * 57.29578f * 0.3f : std::sin(t.age / 200) * 4;
            break;
          case DISC:
            y = (t.y + 22) * S;
            break;
          default:
            flip = t.vx < 0;
            ang = std::sin(t.age / 300 + t.phase) * 6;
            if (t.kind == HEAVY) {
              sc = 0.95f * (0.9f + 0.1f * t.hp / KINDS[HEAVY].hp);
              if (t.hp < KINDS[HEAVY].hp) tint = t.hp == 1 ? Color::hex(0xffa08a) : Color::hex(0xffd0b8);
            }
            if (t.kind == GOLD) app.gfx.circle(x, y, 26, Color(255, 210, 74, 70));
            break;
        }
        app.gfx.sprite(tex, src, x, y, sc, sc, 0.5f, oy, ang, flip, tint);
        if (t.flash > 0) app.gfx.circle(x, y, t.r * S * 0.8f, Color(255, 255, 255, 150));
      }
    // the pilots on their hover pads
    Tex* padTex = app.gfx.tex("mg/heroes_pad.png");
    for (int i = 0; i < count(); i++) {
      const Pilot& pl = pilots_[i];
      float x = pl.x * S, bob = std::sin(pl.bob) * 6;
      app.gfx.image(padTex, x - padTex->w / 2.0f, R::PAD_Y * S - padTex->h / 2.0f, (float)padTex->w, (float)padTex->h, col::white.alpha(0.95f));
      float charge = pl.g.charging ? chargeLevel(pl.g.held) : 0;
      float flick = 0.85f + 0.3f * (float)std::fabs(std::sin(time_ * 37 + i));
      for (int f = -1; f <= 1; f += 2) {
        float fx = (pl.x + f * 14) * S, fy = (pl.y + bob + 4) * S;
        float h = (0.8f + charge * 0.6f) * flick * 9;
        app.gfx.ellipse(fx, fy + h * 0.5f, 3.5f, h * 0.6f, color(i).alpha(0.8f));
        app.gfx.ellipse(fx, fy + h * 0.35f, 2, h * 0.35f, col::white.alpha(0.9f));
      }
      if (charge > 0) app.gfx.circle(x, (pl.y + bob - 70) * S, 14 + 10 * charge, color(i).alpha(0.35f * charge));
      bool flip = (pl.throwT >= 0 || charge > 0) ? pl.g.x < pl.x : pl.x > 960;
      spr::character(player(i).character, pl.throwT >= 0 ? "throw" : "idle", pl.throwT >= 0 ? pl.throwT : pl.animT, x, (pl.y + bob) * S, CHAR_SCALE, flip);
      drawPlayerTag(i, x, (pl.y + bob) * S - 66);
    }
    // repulsor beams
    for (auto& b : beams_) {
      float u = b.t / b.dur;
      float w = b.thick * S * (1 - 0.7f * u * u);
      app.gfx.line(b.x0 * S, b.y0 * S, b.x1 * S, b.y1 * S, w, b.c.alpha(0.85f * (1 - u * u)));
      app.gfx.line(b.x0 * S, b.y0 * S, b.x1 * S, b.y1 * S, w * 0.4f, col::white.alpha(1 - u * u));
    }
    for (auto& w : waves_) {
      float u = w.t / w.dur;
      app.gfx.ring(w.x, w.y, lerpf(w.r0, w.r1, easeOut(u)), w.c.alpha(0.9f * (1 - u)));
    }
    // reticles
    for (int i = 0; i < count(); i++) drawReticle(i);
    for (auto& w : words_) {
      float pop = std::min(1.0f, w.t / 160);
      float a = w.t > w.hold ? std::max(0.0f, 1 - (w.t - w.hold) / 250) : 1;
      app.gfx.text(w.text, w.x, w.y - w.t * 0.02f, w.size, w.c.alpha(a), CENTER, true, 0.6f + 0.4f * easeBack(pop));
    }
    drawTimer(DURATION - time_);
    drawScores(score_, "pts");
  }

  // The reticle in the player's colour; charging fills a ring of dots and previews the big blast.
  void drawReticle(int i) const {
    const Pilot& pl = pilots_[i];
    float x = pl.g.x * S, y = pl.g.y * S, r = 30 * S;
    Color c = color(i);
    float charge = pl.g.charging ? chargeLevel(pl.g.held) : 0;
    app.gfx.ring(x, y + 1, r, Color(10, 17, 32, 110));
    app.gfx.ring(x, y, r, c);
    app.gfx.ring(x, y, r - 2.5f, col::white.alpha(0.8f));
    for (int k = 0; k < 4; k++) {
      float a = k * PI / 2;
      app.gfx.line(x + std::cos(a) * (r + 3), y + std::sin(a) * (r + 3), x + std::cos(a) * (r + 8), y + std::sin(a) * (r + 8), 2.5f, c);
    }
    app.gfx.circle(x, y, 2, col::white);
    if (charge > 0) {
      int dots = (int)(charge * 16);
      for (int k = 0; k <= dots; k++) {
        float a = -PI / 2 + PI * 2 * k / 16;
        app.gfx.circle(x + std::cos(a) * (r + 4.5f), y + std::sin(a) * (r + 4.5f), 1.8f, col::white);
      }
      if (charge >= R::CHARGE_MIN) {
        float br = bigRadius(charge) * S;
        app.gfx.ring(x, y, br, c.alpha(0.35f + 0.4f * charge));
        if (charge >= 1) app.gfx.ring(x, y, br, col::white.alpha(0.5f + 0.5f * std::sin(time_ * 1000 / 60)));
      }
    }
    int mult = comboMult(pl.g.combo);
    if (mult > 1) {
      app.gfx.panel(x - 10, y + r + 5, 20, 10, c, 5);
      for (int k = 0; k < mult; k++) app.gfx.rect(x - 6.5f + k * 4.5f, y + r + 7.5f, 2.5f, 5, col::white);
    }
    drawPlayerTag(i, x + r + 9, y - r - 5);
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override { return score_; }
  std::string scoreLabel(int i) const override { return std::to_string(score_[i]) + (score_[i] == 1 ? " point" : " points"); }

 private:
  std::vector<Pilot> pilots_;
  std::vector<int> score_;
  std::vector<Target> targets_;
  std::vector<int> claimed_;
  std::vector<Beam> beams_;
  std::vector<Word> words_;
  std::vector<Wave> waves_;
  float time_ = 0, spawnT_ = 700, balloonT_ = 3000;
  bool storm_ = false;
  int nextId_ = 1;
  unsigned frame_ = 0;
};

}  // namespace

REGISTER_MINIGAME("repulsor-range", RepulsorRange);

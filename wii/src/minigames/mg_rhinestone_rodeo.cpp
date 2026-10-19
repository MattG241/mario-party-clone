// Rhinestone Rodeo (Showtime Strip): sparkly mechanical ponies in a pink honky-tonk ring. Every pony bucks to
// the same seeded schedule. Before each buck the pony winds up tipping one way (an arrow with a closing ring
// shows which): lean that way with the stick before it bucks to ride it out, or be thrown, lose 2 seconds and
// climb back on. The bucks get quicker and come in combinations; the last 10 s are the wild ride. The longest
// time in the saddle after 45 seconds wins. (Port of src/game/worlds/showtime/games/RhinestoneRodeo.ts.)
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "../game/Data.h"
#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float PI_F = 3.14159265f;
constexpr float K = VW / 1920.0f;  // web canvas -> Wii canvas

// --- Rules (rodeoRules.ts), times in ms ---
constexpr float ROUND_MS = 45000, WILD_MS = 10000;
constexpr float LEAN_MIN = 0.45f;
constexpr int FALL_PENALTY_MS = 2000;
constexpr float COMBO_GAP = 170, COMBO_WIND_MIN = 400, END_MARGIN = 700;

// --- Layout (web px scaled by K) ---
constexpr float PONY_Y = 812 * K, PIVOT_DY = -115 * K;
constexpr float SEAT_DX = -5 * K, SEAT_DY = -79 * K;
constexpr float RIDER_SCALE = 1.1f;
constexpr float HIP = 26 * RIDER_SCALE;  // feet -> hips (the hips sit on the saddle)
constexpr float LEAN_DEG = 20, FOLLOW = 0.7f, TIP_DEG = 15, SNAP_DEG = 27, SNAP_MS = 480;
constexpr float ARROW_DX = 176 * K, ARROW_Y = 452 * K;
constexpr float FLY_MS = 420, DOWN_MS = 1250, CLIMB_MS = 700, HOLD_AFTER_MS = 320;
const float GAPS[3] = {640, 500, 440};

struct Skill {
  float reaction, accuracy, mistake;
};
const Skill SKILL[3] = {{520, 0.55f, 0.24f}, {300, 0.78f, 0.11f}, {170, 0.9f, 0.05f}};

struct Buck {
  float windAt, snapAt;
  int dir;    // -1 tips back (lean left), +1 tips forward (lean right)
  int combo;  // place in a quick combination
};

float wildness(float t) {
  float wildAt = ROUND_MS - WILD_MS;
  return t >= wildAt ? 1.15f : std::max(0.0f, t / wildAt);
}
float windMs(float w) { return w > 1 ? 520 : std::round(1150 - 600 * w); }
float gapMs(float w) { return w > 1 ? 620 : std::round(1500 - 800 * w); }
float comboChance(float w) { return std::min(0.6f, 0.12f + 0.4f * w); }

// The shared schedule: random directions (never the same more than three times running), combinations of two
// (three once it's wild) with shorter wind-ups.
std::vector<Buck> buildBucks(uint32_t seed) {
  Random r(seed ^ 0x2b0du);
  std::vector<Buck> out;
  float t = 1400;
  int last = 1, run = 0;
  for (int guard = 0; guard < 400; guard++) {
    float w = wildness(t);
    int n = 1;
    if (r.next() < comboChance(w)) n = (w > 0.6f && r.next() < 0.35) ? 3 : 2;
    for (int k = 0; k < n; k++) {
      float wind = k == 0 ? windMs(w) : std::max(COMBO_WIND_MIN, std::round(windMs(w) * 0.62f));
      int dir = r.next() < 0.5 ? -1 : 1;
      if (dir == last && run >= 3) dir = -dir;
      run = dir == last ? run + 1 : 1;
      last = dir;
      float snapAt = t + wind;
      if (snapAt > ROUND_MS - END_MARGIN) return out;
      out.push_back({t, snapAt, dir, k});
      t = snapAt + (k < n - 1 ? COMBO_GAP : std::round(gapMs(w) * r.frange(0.8f, 1.2f)));
    }
  }
  return out;
}

float buckPressure(float wind) { return std::min(1.0f, std::max(0.0f, (900 - wind) / 500)); }
float cpuThrowChance(float mistake, float reaction, float wind, bool alreadyLeaning) {
  float slip = mistake * 0.25f;
  return alreadyLeaning ? slip : slip + (reaction / 1300) * buckPressure(wind);
}
int rideScore(float saddleMs, int falls) { return std::max(0, (int)std::lround(saddleMs) - falls * FALL_PENALTY_MS); }

float ease(float u) { return u * u * (3 - 2 * u); }

// A character drawn turned by `angle` degrees about its feet (spr::character cannot rotate).
void characterRot(int c, const char* anim, float t, float x, float y, float scale, bool flip, float angle) {
  if (c < 0 || c >= data::CHARACTER_COUNT) return;
  const data::CharacterDef& d = data::CHARACTERS[c];
  const data::AnimDef* a = &d.anims[0];
  for (int i = 0; i < d.animCount; i++)
    if (!std::strcmp(d.anims[i].name, anim)) {
      a = &d.anims[i];
      break;
    }
  int f = (int)(t * (a->fps > 0 ? a->fps : 8));
  f = a->loop ? f % a->count : std::min(f, a->count - 1);
  if (f < 0) f = 0;
  int cell = a->cells[f];
  Tex* tx = app.gfx.tex(std::string("chars/") + d.id + ".png");
  SDL_Rect src{(cell % d.cols) * spr::CELL, (cell / d.cols) * spr::CELL, spr::CELL, spr::CELL};
  float ox = (flip ? spr::CELL - spr::FEET_X : spr::FEET_X) / spr::CELL;
  app.gfx.sprite(tx, src, x, y, scale, scale, ox, spr::FEET_Y / spr::CELL, angle, flip);
}

enum State { RIDING, THROWN, DOWN, CLIMB };

struct Rider {
  float x = 0;
  State state = RIDING;
  float t = 0;
  float stick = 0, lean = 0;  // raw stick (the rules) and smoothed lean (the picture)
  float tilt = 0, bounce = 0;
  int from = 0;  // bucks from this index on count for this rider
  float saddleMs = 0;
  int falls = 0, comboRun = 0;
  float f0x = 0, f0y = 0, f1x = 0, f1y = 0;
  float anim = 0;
  // CPU
  int cpuFor = -1, cpuDir = 0;
  float cpuAt = 0, cpuWobble = 0, cpuX = 0;
};

struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
};

class RhinestoneRodeo : public Minigame {
 public:
  void start() override {
    bucks_ = buildBucks(rng.state());
    int n = count();
    float gap = GAPS[std::min(4, n) - 2];
    for (int i = 0; i < n; i++) {
      Rider r;
      r.x = (960 + (i - (n - 1) / 2.0f) * gap) * K;
      r.anim = i * 0.3f;
      rid_.push_back(r);
    }
    for (auto& r : rid_) ponyMotion(r);
  }

  void update(float dt) override {
    float dms = dt * 1000;
    ms_ += dms;
    vis_ += dms;
    if (!wild_ && ms_ >= ROUND_MS - WILD_MS) {
      wild_ = true;
      bannerT_ = 1.6f;
      app.audio.sfx("fanfare", 0.6f);
    }
    bannerT_ -= dt;
    for (int i = 0; i < count(); i++) {
      Rider& r = rid_[i];
      r.anim += dt;
      if (isCpu(i)) cpuThink(i, dms);
      r.stick = isCpu(i) ? r.cpuX : clampf(pad(i).x, -1, 1);
    }
    while (nextSnap_ < (int)bucks_.size() && bucks_[nextSnap_].snapAt <= ms_) {
      snap(nextSnap_);
      nextSnap_++;
    }
    for (auto& r : rid_) {
      r.lean += (r.stick - r.lean) * (1 - std::exp(-dms / 70));
      if (r.state == RIDING) r.saddleMs += dms;
      else updateFall(r, dms);
      ponyMotion(r);
    }
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
  }

  // --- The ride ---
  void pop(const std::string& s, float x, float y, Color c, float life = 0.8f) { pops_.push_back({s, x, y, 0, life, c}); }

  void snap(int i) {
    const Buck& b = bucks_[i];
    app.audio.sfx("bump", 0.5f);
    for (auto& r : rid_) {
      if (r.state != RIDING || i < r.from) continue;
      if (r.stick * b.dir >= LEAN_MIN) {
        r.comboRun = b.combo > 0 ? r.comboRun + 1 : 1;
        bool endOfCombo = i + 1 >= (int)bucks_.size() || bucks_[i + 1].combo == 0;
        bool big = endOfCombo && r.comboRun >= 2;
        float sx = seatX(r);
        pop(big ? "WHAT A RIDE!" : "STEADY!", sx, ARROW_Y - 40, big ? Color::hex(0xff7ab8) : col::white, big ? 1.0f : 0.6f);
      } else {
        throwOff(r, b.dir);
      }
    }
  }

  void throwOff(Rider& r, int dir) {
    r.state = THROWN;
    r.t = FLY_MS;
    r.falls++;
    r.comboRun = 0;
    int side = -dir;  // thrown the way the buck went
    r.f0x = seatX(r);
    r.f0y = seatY(r) + HIP;
    r.f1x = r.x + side * 175 * K;
    r.f1y = PONY_Y + 44 * K;
    pop("WHOA!", r.f0x, ARROW_Y - 40, Color::hex(0xff6b5e), 0.8f);
    app.audio.sfx("bad", 0.6f);
  }

  void updateFall(Rider& r, float dms) {
    r.t -= dms;
    if (r.state == THROWN) {
      if (r.t <= 0) {
        r.state = DOWN;
        r.t = DOWN_MS;
        r.anim = 0;
        pop("-2s", r.f1x, r.f1y - 70, Color::hex(0xff6b5e), 0.9f);
      }
    } else if (r.state == DOWN) {
      if (r.t <= 0) {
        r.state = CLIMB;
        r.t = CLIMB_MS;
        r.anim = 0;
      }
    } else if (r.state == CLIMB) {
      if (r.t <= 0) {
        r.state = RIDING;
        // bucks whose wind-up already began don't count for them
        int j = nextSnap_;
        while (j < (int)bucks_.size() && bucks_[j].windAt < ms_) j++;
        r.from = j;
        pop("BACK ON!", seatX(r), ARROW_Y - 40, Color::hex(0xaeefff), 0.6f);
        app.audio.sfx("confirm", 0.4f);
      }
    }
  }

  // The pony's tilt and bounce from the shared schedule (a rider who is off just gets the idle rock).
  void ponyMotion(Rider& r) {
    float rock = 3 * std::sin(vis_ / 190);
    float tilt = rock;
    float bounce = std::fabs(std::sin(vis_ / 190)) * -3;
    if (r.state == RIDING && ms_ > 0 && ms_ < ROUND_MS) {
      int i = nextSnap_;
      const Buck* b = i < (int)bucks_.size() ? &bucks_[i] : nullptr;
      const Buck* prev = i > 0 ? &bucks_[i - 1] : nullptr;
      float t = 0;
      bool moving = false;
      if (prev && i - 1 >= r.from && ms_ < prev->snapAt + SNAP_MS) {
        float v = (ms_ - prev->snapAt) / SNAP_MS;
        float k = v < 0.18f ? v / 0.18f : std::exp(-5 * (v - 0.18f)) * std::cos(11 * (v - 0.18f));
        t += -prev->dir * SNAP_DEG * k;
        bounce = -26 * std::max(0.0f, std::sin(std::min(1.0f, v * 2.2f) * PI_F));
        moving = true;
      }
      if (b && i >= r.from && ms_ >= b->windAt) {
        float u = std::min(1.0f, (ms_ - b->windAt) / (b->snapAt - b->windAt));
        t += b->dir * TIP_DEG * ease(u) + std::sin(ms_ / 11) * 2.2f * u * u;
        bounce = std::min(bounce, 6 * ease(u));
        moving = true;
      }
      if (moving) tilt = t + rock * 0.2f;
    }
    r.tilt = tilt;
    r.bounce = bounce;
  }

  float pivotY(const Rider& r) const { return PONY_Y + PIVOT_DY + r.bounce * K; }
  float seatX(const Rider& r) const {
    float a = r.tilt * PI_F / 180;
    return r.x + SEAT_DX * std::cos(a) - SEAT_DY * std::sin(a);
  }
  float seatY(const Rider& r) const {
    float a = r.tilt * PI_F / 180;
    return pivotY(r) + SEAT_DX * std::sin(a) + SEAT_DY * std::cos(a);
  }

  // --- CPU ---
  void cpuThink(int i, float dms) {
    Rider& r = rid_[i];
    if (r.state != RIDING) {
      r.cpuX = 0;
      return;
    }
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    int ix = nextSnap_;
    const Buck* b = ix < (int)bucks_.size() ? &bucks_[ix] : nullptr;
    const Buck* prev = ix > 0 ? &bucks_[ix - 1] : nullptr;
    // just after a buck: hold the lean a moment (a combination's follow-up may tip the same way)
    bool holding = prev && ms_ < prev->snapAt + HOLD_AFTER_MS;
    r.cpuWobble += dms;
    if (b && ix >= r.from && ms_ >= b->windAt) {
      if (r.cpuFor != ix) {
        r.cpuFor = ix;
        float wind = b->snapAt - b->windAt;
        bool leaning = holding && r.cpuX * b->dir >= LEAN_MIN;
        bool thrown = rng.next() < cpuThrowChance(sk.mistake, sk.reaction, wind, leaning);
        float react = std::min(wind - 70, sk.reaction * (0.7f + 0.4f * (float)rng.next()));
        r.cpuDir = b->dir;
        r.cpuAt = leaning ? ms_ : b->windAt + react;
        if (thrown) {
          double roll = rng.next();
          if (leaning || roll < 0.15) r.cpuDir = 0;  // lets go
          else if (roll < 0.4) r.cpuDir = -b->dir;   // misreads it
          else r.cpuAt = b->snapAt + 40 + (float)rng.next() * 120;  // too late
        }
      }
      if (ms_ >= r.cpuAt) r.cpuX = r.cpuDir * (0.85f + 0.1f * (float)rng.next());
      else if (!holding) r.cpuX = 0.12f * std::sin(r.cpuWobble / 300);
      return;
    }
    if (holding) return;
    r.cpuX = 0.15f * std::sin(r.cpuWobble / 350);  // settle back upright
  }

  // --- Drawing ---
  void drawPony(int i) {
    const Rider& r = rid_[i];
    Tex* base = app.gfx.tex("mg/showtime_pony_base.png");
    Tex* body = app.gfx.tex("mg/showtime_pony.png");
    Tex* front = app.gfx.tex("mg/showtime_pony_front.png");
    // the rider's colour round the mat
    app.gfx.ellipse(r.x, PONY_Y + 2, 80, 21, color(i).alpha(0.95f));
    app.gfx.ellipse(r.x, PONY_Y + 2, 84, 23, Color(255, 255, 255, 60));
    SDL_Rect bs{0, 0, base->w, base->h};
    app.gfx.sprite(base, bs, r.x, PONY_Y, 1, 1, 0.5f, 0.88f);
    float py = pivotY(r);
    SDL_Rect s{0, 0, body->w, body->h};
    app.gfx.sprite(body, s, r.x, py, 1, 1, 0.5f, 0.5916f, r.tilt);
    if (r.state == RIDING) {
      float ang = r.tilt * FOLLOW + r.lean * LEAN_DEG;
      float t = ang * PI_F / 180;
      float fx = seatX(r) - HIP * std::sin(t), fy = seatY(r) + HIP * std::cos(t);
      characterRot(player(i).character, "idle", r.anim, fx, fy, RIDER_SCALE, false, ang);
    }
    SDL_Rect fs{0, 0, front->w, front->h};
    app.gfx.sprite(front, fs, r.x, py, 1, 1, 0.5f, 0.5916f, r.tilt);
    // rosette in the rider's colour
    float a = r.tilt * PI_F / 180, rx = 92 * K, ry = -52 * K;
    float qx = r.x + rx * std::cos(a) - ry * std::sin(a), qy = py + rx * std::sin(a) + ry * std::cos(a);
    app.gfx.circle(qx, qy, 8, Color(40, 20, 40, 110));
    app.gfx.circle(qx, qy, 7, color(i));
    app.gfx.circle(qx, qy, 3, Color::hex(0xfff6d8));
    // a rhinestone glint
    float ph = std::fmod(vis_ / 700 + i * 0.37f, 1.0f);
    if (ph < 0.2f) {
      float gx = r.x + (-35 + (int)(vis_ / 700 + i) * 23 % 70) * K * 2, gy = py - 14;
      float k = std::sin(ph / 0.2f * PI_F);
      app.gfx.line(gx - 6 * k, gy, gx + 6 * k, gy, 2, col::white);
      app.gfx.line(gx, gy - 6 * k, gx, gy + 6 * k, 2, col::white);
    }
  }

  // The fallen rider: flying off, seeing stars on the mat, or hopping back on.
  void drawFallen(int i) {
    const Rider& r = rid_[i];
    int c = player(i).character;
    if (r.state == THROWN) {
      float u = 1 - std::max(0.0f, r.t) / FLY_MS;
      float x = r.f0x + (r.f1x - r.f0x) * u, y = r.f0y + (r.f1y - r.f0y) * u - std::sin(u * PI_F) * 110 * K;
      characterRot(c, "fall", u * 0.4f, x, y, RIDER_SCALE, r.f1x < r.f0x, (r.f1x > r.f0x ? 1 : -1) * 320 * u);
    } else if (r.state == DOWN) {
      spr::shadow(r.f1x, r.f1y, 50);
      spr::character(c, "stunned", r.anim, r.f1x, r.f1y, RIDER_SCALE, r.f1x < r.x);
      drawPlayerTag(i, r.f1x, r.f1y - 90);
    } else if (r.state == CLIMB) {
      float u = 1 - std::max(0.0f, r.t) / CLIMB_MS;
      float sx = seatX(r), sy = seatY(r) + HIP;
      float x = r.f1x + (sx - r.f1x) * ease(u), y = r.f1y + (sy - r.f1y) * ease(u) - std::sin(u * PI_F) * 120 * K;
      spr::character(c, "jump", r.anim, x, y, RIDER_SCALE, r.f1x > r.x);
    }
  }

  // The telegraph: an arrow on the side the pony tips, with a ring of lights running out before the buck.
  void drawCue(const Rider& r) {
    if (r.state != RIDING || nextSnap_ >= (int)bucks_.size() || nextSnap_ < r.from) return;
    const Buck& b = bucks_[nextSnap_];
    if (ms_ < b.windAt) return;
    float u = std::min(1.0f, (ms_ - b.windAt) / (b.snapAt - b.windAt));
    float ax = r.x + b.dir * ARROW_DX, ay = ARROW_Y;
    float beat = 0.5f + 0.5f * std::sin((ms_ - b.windAt) / (60 + 120 * (1 - u)));
    float sc = (0.9f + 0.12f * beat) * (u > 0.8f ? 1.1f : 1.0f);
    Color fill = (u > 0.78f && beat > 0.5f) ? col::white : Color::hex(0xffc2e0);
    Color dark = Color::hex(0x3a1030);
    // ring: a dark track and the lights still left
    constexpr int DOTS = 16;
    float rad = 26;
    app.gfx.circle(ax, ay, rad + 5, Color(42, 16, 48, 90));
    int lit = (int)std::ceil((1 - u) * DOTS);
    Color dotc = u > 0.78f ? col::white : Color::hex(0xff5fa8);
    for (int k = 0; k < lit; k++) {
      float a = -PI_F / 2 + (k + 0.5f) / DOTS * 2 * PI_F;
      app.gfx.circle(ax + std::cos(a) * rad, ay + std::sin(a) * rad, 3.2f, dotc);
    }
    // chevron arrow
    float d = (float)b.dir, L = 20 * sc;
    float tipX = ax + d * L, baseX = ax - d * L;
    float hx = ax + d * 2 * sc;
    app.gfx.line(baseX, ay, hx, ay, 13 * sc, dark);
    app.gfx.line(tipX, ay, hx - d * 4 * sc, ay - 15 * sc, 12 * sc, dark);
    app.gfx.line(tipX, ay, hx - d * 4 * sc, ay + 15 * sc, 12 * sc, dark);
    app.gfx.line(baseX + d * 2, ay, hx, ay, 8 * sc, fill);
    app.gfx.line(tipX - d * 2, ay, hx - d * 3 * sc, ay - 13 * sc, 7 * sc, fill);
    app.gfx.line(tipX - d * 2, ay, hx - d * 3 * sc, ay + 13 * sc, 7 * sc, fill);
  }

  void draw() override {
    drawArena();
    // disco-ball spots drifting over the ring
    float spin = wild_ ? 2.2f : 1.0f;
    for (int k = 0; k < 6; k++) {
      float a = k / 6.0f * 2 * PI_F + vis_ * (0.00022f + (k % 4) * 0.00004f) * spin;
      float rr = (380 + (k % 3) * 230) * K * 1.25f;
      float cy = (k % 2 ? 520 : 880) * K;
      Color c = k % 4 == 0 ? Color::hex(0xff9ed0) : (k % 4 == 1 ? col::white : (k % 4 == 2 ? Color::hex(0x9ff0ff) : Color::hex(0xffe39a)));
      app.gfx.ellipse(960 * K + std::cos(a) * rr, cy + std::sin(a) * (k % 2 ? 22 : 48), 20, 7, c.alpha(wild_ ? 0.32f : 0.2f));
    }
    for (int i = 0; i < count(); i++) drawPony(i);
    for (int i = 0; i < count(); i++)
      if (rid_[i].state != RIDING) drawFallen(i);
    bool playing = ms_ > 0 && ms_ < ROUND_MS;
    for (int i = 0; i < count(); i++) {
      const Rider& r = rid_[i];
      if (r.state == RIDING) drawPlayerTag(i, seatX(r) + r.lean * 10, seatY(r) - 70);
      if (playing) drawCue(r);
    }
    for (auto& p : pops_) {
      float k = p.t / p.life;
      float a = k < 0.75f ? 1.0f : 1 - (k - 0.75f) / 0.25f;
      app.gfx.text(p.text, p.x, p.y - 22 * easeOut(std::min(1.0f, k * 2)), p.text.size() > 8 ? 18 : 22, p.c.alpha(a), CENTER, true);
    }
    if (bannerT_ > 0) {
      float a = std::min(1.0f, bannerT_ / 0.3f);
      app.gfx.panel(VW / 2 - 130, 64, 260, 46, Color::hex(0xff5fa8).alpha(0.9f * a), 22);
      app.gfx.text("WILD RIDE!", VW / 2, 71, 32, col::white.alpha(a), CENTER, true);
    }
    drawTimer((ROUND_MS - ms_) / 1000);
    std::vector<int> sc;
    for (auto& r : rid_) sc.push_back(rideScore(r.saddleMs, r.falls) / 1000);
    drawScores(sc, "s");
  }

  bool finished() const override { return ms_ >= ROUND_MS; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& r : rid_) s.push_back(rideScore(r.saddleMs, r.falls));
    return s;
  }
  std::string scoreLabel(int i) const override {
    const Rider& r = rid_[i];
    return fmt("%.1fs, %d fall%s", rideScore(r.saddleMs, r.falls) / 1000.0, r.falls, r.falls == 1 ? "" : "s");
  }

 private:
  std::vector<Buck> bucks_;
  std::vector<Rider> rid_;
  std::vector<Pop> pops_;
  int nextSnap_ = 0;
  float ms_ = 0, vis_ = 0, bannerT_ = 0;
  bool wild_ = false;
};

}  // namespace

REGISTER_MINIGAME("rhinestone-rodeo", RhinestoneRodeo);

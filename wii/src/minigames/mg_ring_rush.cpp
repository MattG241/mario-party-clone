// Ring Rush (Sonic, Cartoon Coast): a four-lane auto-runner over checkered hills. Up/Down hops between
// lanes to follow the rings, A jumps the wind-up crawler bots, X spin-dashes through any bot (and
// rivals, knocking two of their rings loose) and springs launch you up tall ring arcs. A bot hit
// scatters half your rings for anyone to grab. Most rings after 45 seconds wins.
//
// The rules run in the web version's 1920x1080 space (so the course generator and hit boxes match
// it exactly) and are scaled onto the 854x480 canvas when drawn.
#include <SDL_image.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "../game/Ui.h"
#include "Minigame.h"

namespace {

constexpr float PI = 3.14159265f;
constexpr float S = VW / 1920.0f;  // web px -> canvas px
constexpr float DURATION = 45, FEVER_AT = 35;
constexpr int LANES = 4;
constexpr float LANE_Y[LANES] = {540, 665, 790, 915};
constexpr float FAR_PARALLAX = 0.32f;
constexpr float SPLIT_Y = 207;  // canvas row where the far hills give way to the scrolling track
constexpr float RUN_X = 520, X_MIN = 380, X_MAX = 820;
constexpr float JUMP_V = 1060, GRAVITY = 3000, SPRING_V = 1480;
constexpr float DASH_T = 0.46f, DASH_CD = 1.15f, INVULN = 1.4f, LANE_T = 0.15f;
constexpr float RING_DX = 50, RING_DZ = 78, BOT_DX = 50, CRAWLER_CLEAR = 58, RING_LIFT = 46, BUZZER_Z = 88, BUZZER_CLEAR = 175;
constexpr int BIG_RING = 5, MAX_SCATTER = 12;
constexpr float SPAWN_X = 2060, DESPAWN_X = -160;
constexpr float SCATTER_LIFE = 2.7f, SCATTER_BLINK = 0.9f, SCATTER_GRAB = 0.32f;
constexpr float CHAR_SCALE = 0.7f;

// CPU skill (web CPU_SKILL, seconds): reaction, mistake, aim noise, think time.
struct Skill {
  float reaction, mistake, aimNoise, think;
};
constexpr Skill SKILLS[3] = {{0.52f, 0.24f, 0.55f, 0.70f}, {0.30f, 0.11f, 0.28f, 0.42f}, {0.17f, 0.05f, 0.13f, 0.24f}};

// Sprite atlas mg/toons_rush.png
constexpr SDL_Rect R_BIGRING{4, 4, 60, 60}, R_SPRING{68, 4, 44, 46}, R_CRAWLER{116, 4, 60, 44}, R_BUZZER{180, 4, 36, 39}, R_RING{220, 4, 36, 36},
    R_GEAR{275, 4, 17, 15}, R_PROP{297, 4, 38, 10};

float scrollSpeed(float elapsed, bool fever) {
  float t = clampf(elapsed / DURATION, 0, 1);
  return (560 + 260 * t) * (fever ? 1.06f : 1.0f);
}
int ringsLost(int held) { return held <= 0 ? 0 : std::min({held, MAX_SCATTER, std::max(1, (held + 1) / 2)}); }
int ringsBumped(int held) { return std::min(held, 2); }

enum Kind { RING, BIGRING, CRAWLER, BUZZER, SPRING, SCATTER };
bool isHazard(Kind k) { return k == CRAWLER || k == BUZZER; }

struct CourseItem {
  Kind kind;
  int lane;
  float wx, z;
};

float minHazardGap(Kind k, Kind prev, float speed) {
  if (k == BUZZER && prev == BUZZER) return speed * DASH_CD * 1.25f;
  return speed * 0.72f + 140;
}

enum Pattern { P_LINE, P_TWIN, P_HOP, P_WALL, P_BUZZ, P_SPRING, P_ZIGZAG, P_GAUNTLET };

// Lays the course ahead one chunk at a time (web RushCourse): ring lines, crawlers to jump, buzzers
// to spin through, springs into ring arcs. Hazards in a lane keep their distance; no chunk walls off
// all four lanes.
class Course {
 public:
  float cursor = 1250;
  Random* rng = nullptr;

  void nextChunk(float speed, float intensity, bool fever, std::vector<CourseItem>& outAll) {
    int pattern = pickPattern(intensity, fever);
    lastPattern_ = pattern;
    std::vector<CourseItem> items;
    build(pattern, fever, intensity, speed, items);
    float shift = 0;
    for (auto& it : items) {
      if (!isHazard(it.kind)) continue;
      float need = lastHazard_[it.lane] + minHazardGap(it.kind, lastKind_[it.lane], speed) - (cursor + it.wx);
      if (need > shift) shift = need;
    }
    float end = cursor + shift;
    for (auto& it : items) {
      it.wx += cursor + shift;
      end = std::max(end, it.wx);
      if (isHazard(it.kind) && it.wx > lastHazard_[it.lane]) {
        lastHazard_[it.lane] = it.wx;
        lastKind_[it.lane] = it.kind;
      }
      outAll.push_back(it);
    }
    cursor = end + rng->frange(180, 300) * (fever ? 0.7f : 1.0f);
  }

 private:
  float lastHazard_[LANES] = {-1e9f, -1e9f, -1e9f, -1e9f};
  Kind lastKind_[LANES] = {RING, RING, RING, RING};
  int lastPattern_ = -1;

  int pickPattern(float in, bool fever) {
    auto w = [&](float base, float grow) { return std::max(0.0f, base + grow * in); };
    std::vector<float> wt = {fever ? 5 : w(3, -1),  fever ? 4 : w(1.5f, 0.5f), w(2.5f, 0.5f), w(0.6f, 1.4f),
                             w(1.6f, 1),            fever ? 2 : w(1, 0.4f),    w(1.4f, 0.2f), fever ? 0.5f : w(-0.2f, 2)};
    if (lastPattern_ >= 0) wt[lastPattern_] *= 0.15f;  // never the same pattern twice running
    return rng->weighted(wt);
  }
  int lane() { return rng->range(0, LANES - 1); }
  int otherLane(int a, int b = -1) {
    std::vector<int> free;
    for (int l = 0; l < LANES; l++)
      if (l != a && l != b) free.push_back(l);
    return rng->pick(free);
  }
  static void line(std::vector<CourseItem>& out, int lane, float x0, int n, float step = 70, float z = 0) {
    for (int i = 0; i < n; i++) out.push_back({RING, lane, x0 + i * step, z});
  }
  // Rings along a jump's flight (slightly under the true arc so an early or late jump still sweeps them).
  static void flight(std::vector<CourseItem>& out, int lane, float from, float speed, float v0, int n, float u0 = 0.1f, float u1 = 0.9f) {
    float T = 2 * v0 / GRAVITY;
    for (int i = 0; i < n; i++) {
      float t = T * (u0 + (u1 - u0) * i / std::max(1, n - 1));
      out.push_back({RING, lane, from + speed * t, (v0 * t - GRAVITY * t * t / 2) * 0.9f});
    }
  }
  static void hopArc(std::vector<CourseItem>& out, int lane, float at, float speed, int n) {
    float T = 2 * JUMP_V / GRAVITY;
    flight(out, lane, at - speed * T / 2, speed, JUMP_V, n, 0.08f, 0.92f);
  }

  void build(int p, bool fever, float intensity, float speed, std::vector<CourseItem>& out) {
    const float x = 0;
    switch (p) {
      case P_LINE: {
        int l = lane();
        line(out, l, x, rng->range(4, 7));
        if (fever) line(out, otherLane(l), x + 140, 5);
        break;
      }
      case P_TWIN: {
        int a = lane(), b = otherLane(a);
        line(out, a, x, 4);
        line(out, b, x + 60, 4);
        break;
      }
      case P_HOP: {
        int l = lane();
        out.push_back({CRAWLER, l, x + 260, 0});
        hopArc(out, l, x + 260, speed, 6);
        if (rng->chance(0.6)) line(out, otherLane(l), x + 120, 3);
        break;
      }
      case P_WALL: {
        int open = lane();
        std::vector<int> blocked;
        for (int l = 0; l < LANES; l++)
          if (l != open) blocked.push_back(l);
        rng->shuffle(blocked);
        int n = intensity > 0.5f && rng->chance(0.5) ? 3 : 2;
        for (int k = 0; k < n; k++) {
          out.push_back({CRAWLER, blocked[k], x + 240, 0});
          hopArc(out, blocked[k], x + 240, speed, 3);
        }
        line(out, open, x + 120, 3);
        break;
      }
      case P_BUZZ: {
        int l = lane();
        out.push_back({BUZZER, l, x + 160, BUZZER_Z});
        line(out, l, x + 250, 4);
        if (rng->chance(0.25 + 0.3 * intensity)) out.push_back({BIGRING, l, x + 540, 20});
        line(out, otherLane(l), x + 60, 3);
        break;
      }
      case P_SPRING: {
        int l = lane();
        float T = 2 * SPRING_V / GRAVITY, apex = SPRING_V * SPRING_V / (2 * GRAVITY);
        out.push_back({SPRING, l, x + 60, 0});
        out.push_back({CRAWLER, l, x + 60 + speed * T / 2, 0});
        flight(out, l, x + 60, speed, SPRING_V, 8, 0.12f, 0.88f);
        if (fever || rng->chance(0.45)) out.push_back({BIGRING, l, x + 60 + speed * T / 2, apex * 0.92f});
        break;
      }
      case P_ZIGZAG: {
        int l = lane();
        int d = l == 0 ? 1 : (l == LANES - 1 ? -1 : (rng->chance(0.5) ? 1 : -1));
        for (int i = 0; i < 8; i++) {
          out.push_back({RING, l, x + i * 95, 0});
          if (i % 2 == 1) {
            if (l + d < 0 || l + d >= LANES) d = -d;
            l += d;
          }
        }
        break;
      }
      default: {  // gauntlet: two lanes of staggered hazards, rings between
        int a = lane(), b = otherLane(a);
        out.push_back({CRAWLER, a, x + 200, 0});
        out.push_back({BUZZER, b, x + 360, BUZZER_Z});
        hopArc(out, a, x + 200, speed, 3);
        line(out, b, x + 450, 3);
        line(out, otherLane(a, b), x + 200, 4);
        break;
      }
    }
  }
};

struct Item {
  int id = 0;
  Kind kind = RING;
  bool active = true;
  int lane = 0;
  float laneF = 0, laneTo = 0, wx = 0, z = 0;
  float vx = 0, vz = 0, life = 0, grab = 0, phase = 0;
  float dying = -1;  // >= 0: smashed, flying off
  float squash = 0;  // springs: boing
};

struct Seen {
  int lane;
  float dx;
  Kind kind;
  float z;
};

struct Runner {
  int lane = 0;
  float laneF = 0, laneFrom = 0, laneT = 1;
  float x = RUN_X, x0 = RUN_X, xv = 0, z = 0, vz = 0;
  float jumpBuf = 0, dashT = 0, dashCd = 0, invuln = 0, stun = 0, hurtT = 0, anim = 0;
  int bumped = 0, streak = 0, score = 0;
  bool armed = true;
  // CPU plan
  int cpuLane = 0, cpuPlan = -1;
  float cpuTap = 0, think = 0, cpuPlanDx = 0;
  bool cpuSkip = false;
};

struct Pop {
  std::string text;
  float x, y, t;
  Color c;
};

// Swept overlap along the lane: the gap moved from lo to hi this frame and came within +-w of zero.
bool swept(float lo, float hi, float w) { return lo < w && hi > -w; }

class RingRush : public Minigame {
 public:
  ~RingRush() override {
    if (keyed_.t) SDL_DestroyTexture(keyed_.t);
  }

  void start() override {
    keySky();
    course_.rng = &rng;
    int n = count();
    for (int i = 0; i < n; i++) {
      Runner r;
      r.lane = n == 2 ? 1 + i : (n == 3 ? i : i);
      r.laneF = r.laneFrom = (float)r.lane;
      r.cpuLane = r.lane;
      r.x = r.x0 = RUN_X + (i % 2) * 18;
      r.anim = i * 0.13f;
      run_.push_back(r);
    }
    speed_ = scrollSpeed(0, false);
    layCourse();
    spawnDue();
  }

  void update(float dt) override {
    time_ += dt;
    clock_ += dt;
    if (!fever_ && time_ >= FEVER_AT) {
      fever_ = true;
      app.audio.sfx("cheer", 0.6f);
    }
    speedK_ = std::min(1.0f, speedK_ + dt / 0.7f);
    advanceWorld(dt);
    for (int i = 0; i < count(); i++) {
      Input in;
      if (isCpu(i)) cpuThink(i, dt, in);
      else {
        in.moveY = pad(i).y;
        in.jump = pad(i).press(B_A);
        in.dash = pad(i).press(B_X) || pad(i).press(B_B);
      }
      stepRunner(i, in, dt);
    }
    separate();
    collide();
    bumps();
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t > 0.8f; });
  }

  void draw() override {
    drawBackdrop();
    // everything on the track, back to front by ground line
    struct D {
      float depth;
      int idx;  // >= 0 item, < 0 runner -(i+1)
    };
    std::vector<D> order;
    order.reserve(items_.size() + run_.size());
    for (int k = 0; k < (int)items_.size(); k++) {
      const Item& it = items_[k];
      float sx = (it.wx - scroll_) * S;
      if (!it.active || sx < -40 || sx > VW + 40) continue;
      order.push_back({laneY(it.laneF) + (it.kind == BUZZER ? 7.0f : (it.z > 60 ? 8.0f : 1.0f)), k});
    }
    for (int i = 0; i < count(); i++) order.push_back({laneY(run_[i].laneF) + 5, -(i + 1)});
    std::sort(order.begin(), order.end(), [](const D& a, const D& b) { return a.depth < b.depth; });
    for (auto& d : order) {
      if (d.idx >= 0) drawItem(items_[d.idx]);
      else drawRunner(-d.idx - 1);
    }
    for (auto& p : pops_) {
      float k = p.t / 0.8f;
      app.gfx.text(p.text, p.x, p.y - 30 * k, 20, p.c.alpha(k < 0.7f ? 1 : (1 - k) / 0.3f), CENTER, true);
    }
    for (int i = 0; i < count(); i++)
      if (!isCpu(i)) drawHint(i);
    if (fever_ && time_ < FEVER_AT + 2.5f && std::fmod(time_, 0.4f) < 0.28f) app.gfx.text("RING FEVER!", VW / 2, 54, 28, col::gold, CENTER, true);
    drawTimer(DURATION - time_);
    drawScores(scores(), "rings");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& r : run_) s.push_back(r.score);
    return s;
  }
  std::string scoreLabel(int i) const override { return std::to_string(run_[i].score) + (run_[i].score == 1 ? " ring" : " rings"); }

 private:
  struct Input {
    float moveY = 0;
    bool jump = false, dash = false;
  };

  std::vector<Runner> run_;
  std::vector<Item> items_;
  std::vector<CourseItem> pending_;
  std::vector<Seen> seen_;
  std::vector<Pop> pops_;
  Course course_;
  Tex keyed_;
  float time_ = 0, clock_ = 0, scroll_ = 0, scroll0_ = 0, speed_ = 0, speedK_ = 0;
  bool fever_ = false;
  int nextId_ = 1;

  // The arena's sky was rendered black (and the JPEG blurs it a little): once, at load, clear the
  // near-black pixels connected to the top edge so the sky shows through. Never per frame.
  void keySky() {
    SDL_Surface* raw = IMG_Load(app.path("mg/arena_ring-rush.jpg").c_str());
    if (!raw) raw = IMG_Load(app.path("mg/arena_ring-rush.png").c_str());
    if (!raw) return;
    SDL_Surface* s = SDL_ConvertSurfaceFormat(raw, SDL_PIXELFORMAT_RGBA32, 0);
    SDL_FreeSurface(raw);
    if (!s) return;
    SDL_LockSurface(s);
    const int w = s->w, h = std::min(s->h, (int)SPLIT_Y);
    unsigned char* px = (unsigned char*)s->pixels;
    auto at = [&](int x, int y) { return px + y * s->pitch + x * 4; };
    auto dark = [&](int x, int y) {
      unsigned char* p = at(x, y);
      return p[3] != 0 && std::max({p[0], p[1], p[2]}) < 44;
    };
    std::vector<int> stack;
    for (int x = 0; x < w; x++)
      if (dark(x, 0)) stack.push_back(x);
    // sky enclosed by the loop-de-loops: seed from pure black up in the sky band too
    for (int y = 1; y < std::min(h, 110); y++)
      for (int x = 0; x < w; x++) {
        unsigned char* p = at(x, y);
        if (std::max({p[0], p[1], p[2]}) < 10) stack.push_back(y * w + x);
      }
    while (!stack.empty()) {
      int v = stack.back();
      stack.pop_back();
      int x = v % w, y = v / w;
      if (!dark(x, y)) continue;
      at(x, y)[3] = 0;
      if (x > 0) stack.push_back(v - 1);
      if (x < w - 1) stack.push_back(v + 1);
      if (y > 0) stack.push_back(v - w);
      if (y < h - 1) stack.push_back(v + w);
    }
    SDL_UnlockSurface(s);
    keyed_.t = SDL_CreateTextureFromSurface(app.gfx.renderer(), s);
    keyed_.w = s->w;
    keyed_.h = s->h;
    SDL_FreeSurface(s);
    if (keyed_.t) SDL_SetTextureBlendMode(keyed_.t, SDL_BLENDMODE_BLEND);
  }

  static float laneY(float f) {
    int i = std::max(0, std::min(LANES - 2, (int)std::floor(f)));
    float t = clampf(f - i, 0, 1);
    return LANE_Y[i] + (LANE_Y[i + 1] - LANE_Y[i]) * t;
  }
  static int laneOf(float f) { return (int)std::lround(f); }

  void pop(const std::string& s, float x, float y, Color c = col::white) {
    if (pops_.size() >= 14) pops_.erase(pops_.begin());
    pops_.push_back({s, x, y, 0, c});
  }

  // --- Course ----------------------------------------------------------------------------------
  void layCourse() {
    bool added = false;
    while (course_.cursor < scroll_ + SPAWN_X + 600) {
      float intensity = std::min(1.0f, time_ / DURATION);
      course_.nextChunk(scrollSpeed(time_, fever_), intensity, fever_, pending_);
      added = true;
    }
    if (added) std::sort(pending_.begin(), pending_.end(), [](const CourseItem& a, const CourseItem& b) { return a.wx < b.wx; });
  }

  void spawnDue() {
    size_t k = 0;
    while (k < pending_.size() && pending_[k].wx - scroll_ < SPAWN_X) {
      spawn(pending_[k].kind, pending_[k].lane, pending_[k].wx, pending_[k].z);
      k++;
    }
    if (k) pending_.erase(pending_.begin(), pending_.begin() + k);
  }

  Item& spawn(Kind kind, int lane, float wx, float z) {
    Item it;
    it.id = nextId_++;
    it.kind = kind;
    it.lane = lane;
    it.laneF = it.laneTo = (float)lane;
    it.wx = wx;
    it.z = z;
    it.phase = std::fmod(wx * 0.013f, PI * 2);
    items_.push_back(it);
    return items_.back();
  }

  void advanceWorld(float dt) {
    speed_ = scrollSpeed(time_, fever_) * speedK_;
    scroll0_ = scroll_;
    scroll_ += speed_ * dt;
    layCourse();
    spawnDue();
    for (auto& it : items_) {
      if (!it.active) continue;
      if (it.kind == SCATTER) stepScatter(it, dt);
      if (it.dying >= 0) {
        it.dying += dt;
        if (it.dying > 0.36f) it.active = false;
      }
      if (it.squash > 0) it.squash -= dt;
      if (it.wx - scroll_ < DESPAWN_X || (it.kind == SCATTER && it.life <= 0)) it.active = false;
    }
    std::erase_if(items_, [](const Item& it) { return !it.active; });
  }

  void stepScatter(Item& it, float dt) {
    it.life -= dt;
    it.grab -= dt;
    it.wx += it.vx * dt;
    it.vx *= std::exp(-2.4f * dt);
    if (it.z > 0 || it.vz > 0) {
      it.vz -= GRAVITY * 0.8f * dt;
      it.z += it.vz * dt;
      if (it.z <= 0) {
        it.z = 0;
        it.vz = std::fabs(it.vz) > 260 ? -it.vz * 0.5f : 0;
      }
    }
    it.laneF += (it.laneTo - it.laneF) * (1 - std::exp(-7 * dt));
    it.lane = laneOf(it.laneF);
  }

  // One loose ring bouncing out ahead along the lanes; sx fixes its forward speed (else random).
  void scatterOne(float wx, int lane, float z, float sx, float grab) {
    Item& it = spawn(SCATTER, lane, wx, z);
    float fwd = sx != 0 ? sx : 60 + rng.frange(0, 520);
    it.vx = speed_ + fwd;
    it.vz = 520 + rng.frange(0, 420);
    it.laneTo = (float)std::max(0, std::min(LANES - 1, lane + (sx != 0 ? 0 : rng.range(-1, 1))));
    it.life = SCATTER_LIFE;
    it.grab = grab;
    it.phase = rng.frange(0, PI * 2);
  }

  // --- Runners ---------------------------------------------------------------------------------
  void stepRunner(int i, const Input& in, float dt) {
    Runner& r = run_[i];
    r.x0 = r.x;
    r.anim += dt;
    r.dashCd = std::max(0.0f, r.dashCd - dt);
    r.invuln = std::max(0.0f, r.invuln - dt);
    r.stun = std::max(0.0f, r.stun - dt);
    r.hurtT -= dt;
    float my = in.moveY;
    if (std::fabs(my) < 0.35f) r.armed = true;
    else if (r.armed && std::fabs(my) > 0.55f && r.stun <= 0) {
      r.armed = false;
      int to = std::max(0, std::min(LANES - 1, r.lane + (my > 0 ? 1 : -1)));
      if (to != r.lane) {
        r.laneFrom = r.laneF;
        r.lane = to;
        r.laneT = 0;
        app.audio.sfx("whoosh", 0.2f);
      }
    }
    if (r.laneT < 1) {
      r.laneT = std::min(1.0f, r.laneT + dt / LANE_T);
      float e = 1 - (1 - r.laneT) * (1 - r.laneT);
      r.laneF = r.laneFrom + (r.lane - r.laneFrom) * e;
    }
    if (in.jump) r.jumpBuf = 0.11f;
    else r.jumpBuf = std::max(0.0f, r.jumpBuf - dt);
    bool grounded = r.z <= 0 && r.vz <= 0;
    if (grounded && r.jumpBuf > 0 && r.stun <= 0) {
      r.jumpBuf = 0;
      r.vz = JUMP_V;
      app.audio.sfx("jump", 0.5f);
    }
    if (in.dash && r.dashCd <= 0 && r.stun <= 0) {
      r.dashT = DASH_T;
      r.dashCd = DASH_CD;
      r.bumped = 0;
      r.xv = std::max(r.xv, 560.0f);
      app.audio.sfx("dash", 0.7f);
    }
    if (r.dashT > 0) r.dashT = std::max(0.0f, r.dashT - dt);
    if (!grounded || r.vz > 0) {
      r.vz -= GRAVITY * dt;
      r.z = std::max(0.0f, r.z + r.vz * dt);
      if (r.z <= 0 && r.vz < 0) r.vz = 0;
    }
    r.x += r.xv * dt;
    r.xv *= std::exp(-3.4f * dt);
    float back = RUN_X - r.x;
    r.x += (back > 0 ? 1 : -1) * std::min(std::fabs(back), 75 * dt);
    r.x = clampf(r.x, X_MIN, X_MAX);
  }

  // Runners sharing a lane are eased apart along it (the one in front meets the rings first).
  void separate() {
    int n = count();
    for (int i = 0; i < n; i++)
      for (int j = i + 1; j < n; j++) {
        Runner &a = run_[i], &b = run_[j];
        if (laneOf(a.laneF) != laneOf(b.laneF) || std::fabs(a.z - b.z) > 110) continue;
        float d = b.x - a.x, gap = 66;
        if (std::fabs(d) >= gap) continue;
        float push = (gap - std::fabs(d)) / 2;
        float dir = d > 0 || (d == 0 && player(i).slot < player(j).slot) ? 1 : -1;
        a.x = clampf(a.x - dir * push, X_MIN, X_MAX);
        b.x = clampf(b.x + dir * push, X_MIN, X_MAX);
      }
  }

  void collide() {
    for (int i = 0; i < count(); i++) {
      Runner& r = run_[i];
      int lane = laneOf(r.laneF);
      for (size_t k = 0; k < items_.size(); k++) {
        Item& it = items_[k];
        if (!it.active || it.dying >= 0 || it.lane != lane) continue;
        float dx = it.wx - scroll_ - r.x, dxa = it.wx - scroll0_ - r.x0;
        float lo = std::min(dx, dxa), hi = std::max(dx, dxa);
        if (lo > 90 || hi < -90) continue;
        switch (it.kind) {
          case RING:
          case BIGRING:
          case SCATTER: {
            bool big = it.kind == BIGRING;
            if (swept(lo, hi, RING_DX + (big ? 16 : 0)) && std::fabs(it.z - r.z) < RING_DZ + (big ? 30 : 0) && (it.kind != SCATTER || it.grab <= 0) && r.stun <= 0)
              collect(i, it);
            break;
          }
          case SPRING:
            if (swept(lo, hi, 46) && r.z < 14 && r.vz <= 0) {
              r.vz = SPRING_V;
              r.z = std::max(r.z, 1.0f);
              r.jumpBuf = 0;
              app.audio.sfx("bounce", 0.8f);
              if (it.squash <= 0.1f) pop("BOING!", (it.wx - scroll_) * S, laneY(it.laneF) * S - 40, Color::hex(0xff7ab8));
              it.squash = 0.3f;
            }
            break;
          case CRAWLER:
          case BUZZER: {
            if (!swept(lo, hi, BOT_DX)) break;
            if (r.dashT > 0) {
              smash(it);
              break;
            }
            bool clear = it.kind == CRAWLER ? r.z >= CRAWLER_CLEAR : r.z >= BUZZER_CLEAR;
            if (!clear && r.invuln <= 0) hurt(i);
            break;
          }
        }
      }
    }
  }

  void collect(int i, Item& it) {
    Runner& r = run_[i];
    int value = it.kind == BIGRING ? BIG_RING : 1;
    r.score += value;
    it.active = false;
    int before = r.streak;
    r.streak += value;
    app.audio.sfx("coin", it.kind == BIGRING ? 0.8f : 0.4f);
    float sx = (it.wx - scroll_) * S, sy = (laneY(it.laneF) - RING_LIFT - it.z) * S;
    if (it.kind == BIGRING) pop("+5 RINGS!", sx, sy - 24, col::gold);
    if (r.streak / 10 > before / 10) pop(std::to_string(r.streak / 10 * 10) + " IN A ROW!", r.x * S, (laneY(r.laneF) - 170 - r.z) * S, color(i).mix(col::white, 0.3f));
  }

  // A spin-dash through a bot: it bursts and drops two rings ahead.
  void smash(Item& it) {
    it.dying = 0;
    app.audio.sfx("crack", 0.6f);
    pop("BONK!", (it.wx - scroll_) * S, (laneY(it.laneF) - it.z) * S - 40, Color::hex(0xffd84a));
    float wx = it.wx;
    int lane = it.lane;
    for (int k = 0; k < 2; k++) scatterOne(wx + 30, lane, 30, 240 + k * 140.0f, 0.14f);
  }

  void hurt(int i) {
    Runner& r = run_[i];
    int lost = ringsLost(r.score);
    r.score -= lost;
    r.streak = 0;
    r.invuln = INVULN;
    r.xv = -680;
    r.jumpBuf = 0;
    r.dashT = 0;
    r.hurtT = 0.55f;
    app.audio.sfx("hit", 0.8f);
    pop("OUCH!", r.x * S, (laneY(r.laneF) - 160 - r.z) * S, Color::hex(0xff6b5e));
    for (int k = 0; k < lost; k++) scatterOne(scroll_ + r.x, laneOf(r.laneF), r.z + 30, 0, SCATTER_GRAB);
  }

  // A spin-dash into a rival in the same lane knocks two of their rings loose.
  void bumps() {
    for (int ai = 0; ai < count(); ai++) {
      Runner& a = run_[ai];
      if (a.dashT <= 0) continue;
      for (int bi = 0; bi < count(); bi++) {
        Runner& b = run_[bi];
        if (ai == bi || b.dashT > 0 || b.invuln > 0 || (a.bumped & (1 << bi))) continue;
        if (laneOf(a.laneF) != laneOf(b.laneF) || std::fabs(a.x - b.x) > 70 || std::fabs(a.z - b.z) > 90) continue;
        a.bumped |= 1 << bi;
        int lost = ringsBumped(b.score);
        b.score -= lost;
        b.streak = 0;
        b.stun = 0.26f;
        b.invuln = 0.7f;
        b.hurtT = 0.4f;
        b.xv = a.x < b.x ? 420.0f : -420.0f;
        a.xv = -160;
        app.audio.sfx("bump", 0.6f);
        pop("BUMP!", b.x * S, (laneY(b.laneF) - 160 - b.z) * S, Color::hex(0x6fc8ff));
        for (int k = 0; k < lost; k++) scatterOne(scroll_ + b.x, laneOf(b.laneF), b.z + 30, 0, 0.2f);
      }
    }
  }

  // --- CPU -------------------------------------------------------------------------------------
  void perceive(const Runner& r, float look) {
    seen_.clear();
    for (auto& it : items_) {
      if (!it.active || it.dying >= 0) continue;
      if (it.kind == SCATTER && it.grab > 0.15f) continue;
      float dx = it.wx - scroll_ - r.x;
      if (dx < -30 || dx > look) continue;
      seen_.push_back({it.lane, dx, it.kind, it.z});
    }
  }

  // How much a lane is worth looking `look` px ahead: rings pull, hazards push (a buzzer much harder
  // when the spin-dash won't be ready in time).
  float laneValue(int lane, float look, float dashReadyIn, float speed) const {
    float v = 0;
    for (auto& s : seen_) {
      if (s.lane != lane || s.dx < -20 || s.dx > look) continue;
      float near = 1 - (s.dx / look) * 0.6f;
      switch (s.kind) {
        case RING:
        case SCATTER: v += (s.z > 160 ? 0.5f : 1.0f) * near; break;
        case BIGRING: v += (s.z > 160 ? 1.5f : (float)BIG_RING) * near; break;
        case CRAWLER: v -= 1.2f * near; break;
        case BUZZER: {
          float arrive = s.dx / std::max(1.0f, speed);
          v -= (dashReadyIn < arrive - 0.06f ? 1.4f : 6.0f) * near;
          break;
        }
        case SPRING: v += 1.5f * near; break;
      }
    }
    return v;
  }

  void cpuThink(int i, float dt, Input& in) {
    Runner& r = run_[i];
    int level = std::max(0, std::min(2, cpuLevel(i)));
    const Skill& sk = SKILLS[level];
    float look = level == 2 ? 1150.0f : (level == 1 ? 920.0f : 680.0f);
    float speed = std::max(200.0f, speed_);
    perceive(r, look);
    r.think -= dt;
    if (r.think <= 0) {
      r.think = sk.think * (0.6f + rng.frange(0, 0.5f));
      int best = r.lane;
      float bestV = -1e9f;
      for (int l = std::max(0, r.lane - 2); l <= std::min(LANES - 1, r.lane + 2); l++) {
        float v = laneValue(l, look, r.dashCd, speed) - std::abs(l - r.lane) * 0.45f;
        for (int j = 0; j < count(); j++)
          if (j != i && laneOf(run_[j].laneF) == l) v -= run_[j].x > r.x - 40 ? 1.6f : 0.5f;
        if (v > bestV) {
          bestV = v;
          best = l;
        }
      }
      if (rng.chance(sk.mistake)) best = std::max(0, std::min(LANES - 1, r.lane + (rng.chance(0.5) ? -1 : 1)));
      r.cpuLane = best;
    }
    r.cpuTap -= dt;
    if (r.cpuLane != r.lane && r.cpuTap <= 0 && r.laneT >= 1) {
      in.moveY = r.cpuLane < r.lane ? -1.0f : 1.0f;
      r.cpuTap = 0.12f + sk.reaction * 0.35f;
    }
    int lane = laneOf(r.laneF);
    const Item* hz = nullptr;
    float hdx = 1e9f;
    for (auto& it : items_) {
      if (!it.active || it.dying >= 0 || !isHazard(it.kind) || it.lane != lane) continue;
      float dx = it.wx - scroll_ - r.x;
      if (dx > -BOT_DX && dx < hdx) {
        hdx = dx;
        hz = &it;
      }
    }
    // a rival just ahead in this lane with rings to spare: spin into them (when nothing's coming)
    bool clearAhead = !hz || hdx > speed * (DASH_CD + 0.25f);
    float bumpRate = level == 2 ? 0.9f : (level == 1 ? 0.3f : 0.0f);
    if (clearAhead && r.dashCd <= 0 && r.stun <= 0 && rng.chance(bumpRate * dt))
      for (int j = 0; j < count(); j++) {
        const Runner& o = run_[j];
        if (j != i && o.invuln <= 0 && o.score > 0 && laneOf(o.laneF) == lane && o.x - r.x > 20 && o.x - r.x < 130) {
          in.dash = true;
          break;
        }
      }
    if (!hz || hdx > 700) return;
    if (r.cpuPlan != hz->id) {
      r.cpuPlan = hz->id;
      r.cpuSkip = rng.chance(sk.mistake);
      float noise = (rng.frange(0, 1) - 0.5f) * sk.aimNoise * 0.5f;
      if (hz->kind == CRAWLER) {
        float T = 2 * JUMP_V / GRAVITY;
        r.cpuPlanDx = speed * (T / 2 + noise);
      } else {
        r.cpuPlanDx = BOT_DX + speed * (0.12f + noise * 0.6f);
        if (r.dashCd > hdx / speed - 0.08f) {  // no spin in time: dodge to a clear lane
          int out = -1;
          for (int l : {lane - 1, lane + 1}) {
            if (l < 0 || l >= LANES) continue;
            bool blocked = false;
            for (auto& s : seen_)
              if (s.lane == l && s.kind == BUZZER && std::fabs(s.dx - hdx) < 220) blocked = true;
            if (!blocked) out = l;
          }
          if (out >= 0) r.cpuLane = out;
        }
      }
    }
    if (r.cpuSkip) return;
    if (hz->kind == CRAWLER && hdx <= r.cpuPlanDx && r.z <= 0) {
      in.jump = true;
      r.cpuSkip = true;
    } else if (hz->kind == BUZZER && hdx <= r.cpuPlanDx && r.dashCd <= 0 && r.cpuLane == r.lane) {
      in.dash = true;
      r.cpuSkip = true;
    }
  }

  // --- Drawing ---------------------------------------------------------------------------------
  void band(Tex* t, int y0, int y1, float offset) const {
    int o = (int)std::fmod(offset, (float)VW);
    if (o < 0) o += VW;
    SDL_Rect a{o, y0, VW - o, y1 - y0};
    app.gfx.sprite(t, a, 0, (float)y0, 1, 1, 0, 0);
    if (o > 0) {
      SDL_Rect b{0, y0, o, y1 - y0};
      app.gfx.sprite(t, b, (float)(VW - o), (float)y0, 1, 1, 0, 0);
    }
  }

  void drawBackdrop() const {
    app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
    Tex* t = keyed_.t ? const_cast<Tex*>(&keyed_) : app.gfx.tex("mg/arena_ring-rush.png");
    // both layers tile every 1920 web px (= the canvas width): far hills drift, the track rushes by
    band(t, 0, (int)SPLIT_Y, scroll_ * FAR_PARALLAX * S);
    band(t, (int)SPLIT_Y, VH, scroll_ * S);
  }

  void drawItem(const Item& it) const {
    Tex* atlas = app.gfx.tex("mg/toons_rush.png");
    float x = (it.wx - scroll_) * S, gy = laneY(it.laneF) * S;
    switch (it.kind) {
      case RING:
      case BIGRING:
      case SCATTER: {
        float hs = std::max(0.25f, 1 - it.z / 360);
        bool big = it.kind == BIGRING;
        app.gfx.ellipse(x, gy + 1, (big ? 15 : 9) * hs, 3 * hs, Color(0, 0, 0, (unsigned char)(80 * hs)));
        float alpha = 1;
        if (it.kind == SCATTER && it.life < SCATTER_BLINK && (int)(it.life / 0.09f) % 2) alpha = 0.25f;
        float k = 0.22f + 0.78f * std::fabs(std::cos(clock_ * 6.5f + (it.kind == SCATTER ? it.phase : 0)));
        float y = gy - (RING_LIFT + it.z) * S;
        const SDL_Rect& src = big ? R_BIGRING : R_RING;
        app.gfx.sprite(atlas, src, x, y, k * (big ? 0.85f : 0.8f), big ? 0.85f : 0.8f, 0.5f, 0.5f, 0, false, col::white.alpha(alpha));
        break;
      }
      case CRAWLER: {
        if (it.dying >= 0) {
          drawSmashed(atlas, R_CRAWLER, x, gy - 12, it.dying);
          break;
        }
        float s = std::sin(clock_ * 14 + it.phase);
        app.gfx.ellipse(x + 2, gy + 1, 22, 5, Color(0, 0, 0, 80));
        app.gfx.sprite(atlas, R_CRAWLER, x, gy - std::fabs(s) * 2, 0.85f, 0.85f, 0.5f, 0.92f, s * 3, false);
        break;
      }
      case BUZZER: {
        float bob = std::sin(clock_ * 6 + it.phase) * 9;
        float y = gy - (it.z + bob) * S;
        if (it.dying >= 0) {
          drawSmashed(atlas, R_BUZZER, x, y, it.dying);
          break;
        }
        app.gfx.ellipse(x, gy + 1, 14, 4, Color(0, 0, 0, 60));
        app.gfx.sprite(atlas, R_BUZZER, x, y, 0.9f, 0.9f, 0.5f, 0.5f, std::sin(clock_ * 4 + it.phase) * 5, false);
        app.gfx.sprite(atlas, R_PROP, x, y - 17, std::fabs(std::cos(clock_ * 45 + it.phase)), 1, 0.5f, 0.5f);
        break;
      }
      case SPRING: {
        float sq = it.squash > 0 ? it.squash / 0.3f : 0;
        app.gfx.ellipse(x + 1, gy + 1, 18, 4, Color(0, 0, 0, 80));
        app.gfx.sprite(atlas, R_SPRING, x, gy, 0.8f * (1 + 0.15f * sq), 0.8f * (1 - 0.45f * sq), 0.5f, 0.9f);
        break;
      }
    }
  }

  void drawSmashed(Tex* atlas, const SDL_Rect& src, float x, float y, float t) const {
    float k = t / 0.36f;
    app.gfx.sprite(atlas, src, x, y - 40 * easeOut(k), 0.85f * (1 - 0.4f * k), 0.85f * (1 - 0.4f * k), 0.5f, 0.5f, 280 * k, false, col::white.alpha(1 - k));
    for (int g = 0; g < 4; g++) {
      float a = g * 1.57f + 0.6f;
      app.gfx.sprite(atlas, R_GEAR, x + std::cos(a) * 40 * k, y - 10 + std::sin(a) * 26 * k + 40 * k * k, 0.8f, 0.8f, 0.5f, 0.5f, 400 * k, false, col::white.alpha(1 - k));
    }
  }

  void drawRunner(int i) const {
    const Runner& r = run_[i];
    float x = r.x * S, gy = laneY(r.laneF) * S, y = gy - r.z * S;
    spr::shadow(x, gy, 38 * std::max(0.35f, 1 - r.z / 300));
    if (r.dashT > 0) {
      // spin-dash: a ring of the player's colour and speed streaks
      Color c = color(i);
      for (int k = 0; k < 3; k++) app.gfx.line(x - 26 - k * 10, y - 30 + (k - 1) * 9, x - 52 - k * 14, y - 30 + (k - 1) * 9, 3, c.alpha(0.6f));
      app.gfx.ring(x, y - 28, 30 + 3 * std::sin(clock_ * 40), c.alpha(0.85f));
    }
    const char* anim = (r.hurtT > 0 || r.stun > 0) ? "stunned" : (r.dashT > 0 ? "dash" : (r.z > 0 ? "jump" : "run"));
    bool blink = r.invuln > 0 && (int)(r.invuln / 0.08f) % 2;
    spr::character(player(i).character, anim, r.anim, x, y, CHAR_SCALE, false, col::white.alpha(blink ? 0.35f : 1));
    drawPlayerTag(i, x, y - 64);
  }

  // A human's button prompt while a bot closes in down their lane.
  void drawHint(int i) const {
    const Runner& r = run_[i];
    if (r.dashT > 0 || r.stun > 0) return;
    int lane = laneOf(r.laneF);
    float best = 1e9f;
    Kind kind = RING;
    for (auto& it : items_) {
      if (!it.active || it.dying >= 0 || it.lane != lane || !isHazard(it.kind)) continue;
      float dx = it.wx - scroll_ - r.x;
      if (dx > -BOT_DX && dx < best) {
        best = dx;
        kind = it.kind;
      }
    }
    if (best / std::max(1.0f, speed_) >= 0.75f) return;
    float x = r.x * S, y = (laneY(r.laneF) - r.z) * S - 92;
    if (kind == CRAWLER && r.z < CRAWLER_CLEAR) ui::prompt(x - 34, y, B_A, "JUMP!");
    else if (kind == BUZZER && r.dashCd <= 0) ui::prompt(x - 34, y, B_X, "SPIN!");
  }
};

}  // namespace

REGISTER_MINIGAME("ring-rush", RingRush);

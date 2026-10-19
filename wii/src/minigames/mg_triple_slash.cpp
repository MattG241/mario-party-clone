// Triple Slash (Zoro, Pirate Seas): barrels, crates and flying fish hurtle down each player's cargo chute
// in three lanes. Slice each as it crosses the line (X left, A centre, B right, or the D-pad): on the beat
// is PERFECT, and a combo multiplies the points. Let the fizzing bombs roll past. Top score after 40 s.
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
constexpr float DUR = 40000;           // ms
constexpr float BEAT = 60000.0f / 140, FAST_BEAT = BEAT / 1.12f, FAST_FROM = DUR - 10000, START = 2200;
constexpr float LEAD_START = 1750, LEAD_END = 1380;
constexpr float SPRITE_PPM = 300, OBJ_SIZE = 1.25f, CHAR_SCALE = 1.1f, FEET_Y = 430;
constexpr float WHIFF_MS = 150, STUN_MS = 750;
constexpr float WIN_PERFECT = 55, WIN_GOOD = 115, WIN_OK = 170, BOMB_WINDOW = 140;
constexpr int BOMB_PENALTY = 5, DODGE_POINTS = 1;
// the harbour camera and chutes (metres)
constexpr float CAM_H = 3.5f, FOCAL = 1300, FLOOR_Z = 0.3f, Y_NEAR = 4.62f, Y_CUT = 7.0f, Y_FAR = 32.3f, LANE_W = 0.6f;
constexpr float NEAR_X[4] = {-2.872f, -0.957f, 0.957f, 2.872f}, FAR_X[4] = {-3.548f, -1.183f, 1.183f, 3.548f};
const float COS_P = std::cos(15 * PI / 180), SIN_P = std::sin(15 * PI / 180);

enum Kind { BARREL, CRATE, FISH, BOMB, GOLD };
enum Grade { G_NONE, G_OK, G_GOOD, G_PERFECT };

// frames in mg/pirates_slash.png and their origins (the renders sit on a point near their base)
struct Frame {
  SDL_Rect r;
  float oy;
};
constexpr Frame CRATE_FR[4] = {{{86, 0, 85, 107}, 0.829f}, {{0, 0, 85, 110}, 0.891f}, {{172, 0, 85, 101}, 0.965f}, {{332, 0, 85, 88}, 1.02f}};
constexpr Frame BOMB_FR = {{258, 0, 73, 92}, 0.961f};
constexpr SDL_Rect BARREL_FR[8] = {{418, 0, 84, 86}, {503, 0, 84, 86}, {588, 0, 84, 86}, {673, 0, 84, 86},
                                   {757, 0, 84, 86}, {0, 111, 84, 86}, {85, 111, 84, 86}, {170, 111, 84, 86}};
constexpr SDL_Rect GOLD_FR[8] = {{255, 111, 84, 86}, {340, 111, 84, 86}, {425, 111, 84, 86}, {510, 111, 84, 86},
                                 {595, 111, 84, 86}, {680, 111, 84, 86}, {765, 111, 84, 86}, {0, 198, 84, 86}};
constexpr SDL_Rect FISH_FR[2] = {{85, 198, 133, 79}, {220, 198, 133, 79}};
constexpr Color PAD_COLORS[3] = {Color(59, 138, 230), Color(92, 195, 74), Color(232, 72, 62)};
constexpr Color TIER_COLORS[4] = {Color(255, 255, 255), Color(255, 216, 74), Color(92, 225, 255), Color(255, 122, 217)};
constexpr const char* PAD_LABELS[3] = {"X", "A", "B"};

Frame frameFor(int kind, int k) {
  k = std::abs(k);
  switch (kind) {
    case BARREL: return {BARREL_FR[k % 8], 0.922f};
    case GOLD: return {GOLD_FR[k % 8], 0.922f};
    case CRATE: return CRATE_FR[k % 4];
    case FISH: return {FISH_FR[k % 2], 0.629f};
    default: return BOMB_FR;
  }
}

struct Skill {
  float mistake, aimNoise;
};
constexpr Skill SKILL[3] = {{0.24f, 0.55f}, {0.11f, 0.28f}, {0.05f, 0.13f}};

struct Proj {
  float x, y, s;  // canvas px, canvas px per metre
};
Proj project(float X, float Y, float Z) {
  float dz = Z - CAM_H;
  float zc = Y * COS_P - dz * SIN_P, yc = Y * SIN_P + dz * COS_P;
  float k = FOCAL / zc;
  return {(960 + X * k) * S, (540 - yc * k) * S, k * S};
}
float laneX(int chute, float lane, float Y) {
  float t = (Y - Y_NEAR) / (Y_FAR - Y_NEAR);
  return NEAR_X[chute] + (FAR_X[chute] - NEAR_X[chute]) * t + (lane - 1) * LANE_W;
}
Grade judge(float dt) {
  float a = std::fabs(dt);
  return a <= WIN_PERFECT ? G_PERFECT : a <= WIN_GOOD ? G_GOOD : a <= WIN_OK ? G_OK : G_NONE;
}
int comboMult(int c) { return c >= 30 ? 4 : c >= 15 ? 3 : c >= 5 ? 2 : 1; }
int slicePoints(Grade g, int kind, int combo) {
  int base = g == G_PERFECT ? 3 : g == G_GOOD ? 2 : 1;
  int bonus = kind == GOLD ? 3 : kind == FISH ? 1 : 0;
  return (base + bonus) * comboMult(combo);
}

struct Note {
  float t;  // ms after GO when it crosses the cut line
  int lane, kind, from;
};
float laneAt(const Note& n, float u) {
  if (n.from == n.lane) return (float)n.lane;
  float k = clampf((u - 0.45f) / 0.2f, 0, 1), e = k * k * (3 - 2 * k);
  return n.from + (n.lane - n.from) * e;
}

struct Obj {
  bool active = false, judged = false, crashed = false;
  Note note{0, 1, BARREL, 1};
  float speed = 0, roll = 0;
  // placement (canvas)
  float Y = 0, x = 0, y = 0, gx = 0, gy = 0, k = 0, angle = 0;
  int frame = 0;
};
struct Half {
  bool active = false;
  SDL_Rect src{};
  float x = 0, y = 0, vx = 0, vy = 0, spin = 0, angle = 0, t = 0, k = 1;
};
struct Streak {
  float x = 0, y = 0, ang = 0, t = 9, k = 1;
  int tier = 0;
};
struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
  int size;
  int owner, value;
};
struct Word {
  const char* text = nullptr;
  Color c;
  float t = 9, scale = 1;
};
struct Slasher {
  int chute = 0;
  float x = 0;
  int combo = 0, best = 0, perfects = 0, score = 0;
  float stunT = 0, poseT = 0, tintT = 0;
  float whiff[3] = {0, 0, 0}, padFlash[3] = {0, 0, 0};
  std::array<Obj, 12> objs{};
  size_t next = 0;
  const char* anim = "wave";
  float animT = 0, animLeft = 1.2f;
  bool flip = false;
  Word word;
  float comboUpT = 9;
  int comboUpM = 1;
  std::vector<int> planLane;
  std::vector<float> planAt;
};

class TripleSlash : public Minigame {
 public:
  void start() override {
    buildChart();
    buildBeats();
    static const int CHUTES[5][4] = {{1, 0, 0, 0}, {1, 0, 0, 0}, {1, 2, 0, 0}, {0, 1, 2, 0}, {0, 1, 2, 3}};
    for (int i = 0; i < count(); i++) {
      Slasher s;
      s.chute = CHUTES[std::clamp(count(), 1, 4)][i];
      s.x = project(laneX(s.chute, 1, Y_NEAR), Y_NEAR, FLOOR_Z).x;
      used_[s.chute] = true;
      sl_.push_back(s);
    }
  }

  // --- the chart (shared by everyone, so it's a fair race of timing) ------------------------------
  void buildChart() {
    float lastInLane[3] = {-1e9f, -1e9f, -1e9f};
    float lastGold = -1e9f, t = START;
    int prevLane = 1;
    auto pickLane = [&](const std::vector<int>& avoid) -> int {
      int fr[3], nf = 0;
      for (int l = 0; l < 3; l++)
        if (std::find(avoid.begin(), avoid.end(), l) == avoid.end()) fr[nf++] = l;
      if (!nf) return -1;
      return fr[(int)(rng.next() * nf)];
    };
    auto kindAt = [&](float time, bool allowBomb) -> int {
      double r = rng.next();
      if (allowBomb && time > 4000 && r < 0.14) return BOMB;
      if (time > 5000 && time - lastGold > 4500 && r < 0.19) {
        lastGold = time;
        return GOLD;
      }
      if (time > 7000 && r < 0.36) return FISH;
      return r < 0.62 ? CRATE : BARREL;
    };
    auto add = [&](float time, int lane, int kind, float beat) -> bool {
      if (time - lastInLane[lane] < beat * 0.45f) return false;
      int from = lane;
      if (kind == FISH && time > 15000 && rng.chance(0.45)) {
        int side = lane == 0 ? 1 : lane == 2 ? -1 : (rng.chance(0.5) ? -1 : 1);
        from = lane + side;
      }
      chart_.push_back({std::round(time), lane, kind, from});
      lastInLane[lane] = time;
      return true;
    };
    while (t < DUR - 250) {
      float beat = t >= FAST_FROM ? FAST_BEAT : BEAT;
      float late = t / DUR;
      int phase = t < 10000 ? 0 : t < 20000 ? 1 : t < FAST_FROM ? 2 : 3;
      int cnt = 1;
      double r = rng.next();
      if (phase == 3 && r < 0.08)
        cnt = 3;
      else if ((phase == 1 && t > 14000 && r < 0.16) || (phase == 2 && r < 0.26) || (phase == 3 && r < 0.34))
        cnt = 2;
      std::vector<int> used;
      for (int k = 0; k < cnt; k++) {
        int lane = cnt == 1 && rng.chance(0.7) ? pickLane({prevLane}) : pickLane(used);
        if (lane < 0) break;
        bool allow = cnt < 3 && !(cnt == 2 && used.size() == 1 && !chart_.empty() && chart_.back().kind == BOMB);
        int kind = kindAt(t, allow);
        if (add(t, lane, kind, beat)) used.push_back(lane);
      }
      if (!used.empty()) prevLane = used.back();
      // an off-beat note in another lane, now and then, once the round has warmed up
      if (phase >= 2 && cnt == 1 && t + beat / 2 < DUR - 250 && rng.chance(0.2 + 0.1 * late)) {
        int lane = pickLane(used);
        if (lane >= 0) add(t + beat / 2, lane, kindAt(t + beat / 2, false), beat);
      }
      t += phase == 0 ? beat * 2 : beat;
    }
    std::sort(chart_.begin(), chart_.end(), [](const Note& a, const Note& b) { return a.t != b.t ? a.t < b.t : a.lane < b.lane; });
  }
  void buildBeats() {
    float t = START - 4 * BEAT;
    while (t < DUR + BEAT) {
      beats_.push_back(std::round(t));
      t += t >= FAST_FROM ? FAST_BEAT : BEAT;
    }
  }
  float leadAt(float t) const { return LEAD_START + (LEAD_END - LEAD_START) * clampf(t / DUR, 0, 1); }

  // --- update ------------------------------------------------------------------------------------
  void update(float dt) override {
    float dms = dt * 1000;
    el_ += dms;
    if (el_ >= DUR) {
      if (!wrapped_) {
        wrapped_ = true;
        for (auto& s : sl_)
          for (auto& o : s.objs) o.active = false;
      }
      return;
    }
    if (!fast_ && el_ >= FAST_FROM) {
      fast_ = true;
      bannerT_ = 0;
    }
    bannerT_ += dt;
    // the drum: a thump on every beat of the chart's grid, a heavier one each bar
    pulse_ *= std::exp(-dms / 120);
    while (beatNext_ < beats_.size() && el_ >= beats_[beatNext_]) {
      beatNext_++;
      beatIdx_++;
      bool accent = beatIdx_ % 4 == 1;
      app.audio.sfx("tick", accent ? 0.5f : 0.3f);
      pulse_ = accent ? 1 : 0.6f;
    }
    for (int i = 0; i < count(); i++) {
      Slasher& s = sl_[i];
      s.stunT = std::max(0.0f, s.stunT - dms);
      s.tintT -= dt;
      s.animT += dt;
      s.animLeft -= dt;
      if (s.animLeft <= 0 && s.stunT <= 0) s.anim = "idle";
      if (s.poseT > 0) s.poseT -= dms;
      s.word.t += dt;
      s.comboUpT += dt;
      for (int l = 0; l < 3; l++) {
        s.padFlash[l] = std::max(0.0f, s.padFlash[l] - dms / 160);
        s.whiff[l] = std::max(0.0f, s.whiff[l] - dms);
      }
      spawnNotes(i);
      if (isCpu(i))
        cpuThink(i);
      else
        readLanes(i);
      updateObjs(i);
    }
    for (auto& h : halves_) {
      if (!h.active) continue;
      h.t += dt;
      h.vy += 1500 * S * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.angle += h.spin * dt;
      if (h.t > 0.65f) h.active = false;
    }
    for (auto& st : streaks_) st.t += dt;
    for (auto& b : booms_) b.t += dt;
    std::erase_if(booms_, [](const Boom& b) { return b.t >= 0.5f; });
    for (auto& p : pops_) {
      p.t += dt;
      if (p.t > 0.35f) p.y -= 50 * dt;
    }
    std::erase_if(pops_, [](const Pop& p) { return p.t >= p.life; });
  }

  void setAnim(Slasher& s, const char* a, float len) {
    s.anim = a;
    s.animT = 0;
    s.animLeft = len;
  }
  void say(Slasher& s, const char* text, Color c, float scale = 0.8f) { s.word = {text, c, 0, scale}; }

  void spawnNotes(int i) {
    Slasher& s = sl_[i];
    while (s.next < chart_.size()) {
      const Note& n = chart_[s.next];
      float lead = leadAt(n.t);
      if (n.t - lead > el_) break;
      s.next++;
      Obj* o = nullptr;
      for (auto& q : s.objs)
        if (!q.active) {
          o = &q;
          break;
        }
      if (!o) continue;
      *o = Obj();
      o->active = true;
      o->note = n;
      o->speed = (Y_FAR - Y_CUT) / lead;
      placeObj(*o, s);
      if (isCpu(i)) planCpu(i, n);
    }
  }

  void placeObj(Obj& o, const Slasher& s) {
    const Note& n = o.note;
    float Y = Y_CUT + (n.t - el_) * o.speed;
    float u = (Y_FAR - Y) / (Y_FAR - Y_CUT);
    float lane = laneAt(n, u);
    o.Y = Y;
    o.roll = Y_FAR - Y;
    float z = 0, size = OBJ_SIZE;
    if (n.kind == FISH) {
      float leap = std::min(1.0f, u / 0.18f);
      z = 0.3f + 0.45f * std::sin(leap * PI * 0.5f) + 0.08f * std::sin(u * PI * 6);
      if (n.from != n.lane) z += 0.35f * std::sin(clampf((u - 0.45f) / 0.2f, 0, 1) * PI);
    } else if (n.kind == CRATE) {
      z = std::fabs(std::sin(o.roll * 1.9f)) * 0.12f;
      size = OBJ_SIZE * 1.05f;
    } else if (n.kind == BOMB)
      size = OBJ_SIZE * 0.92f;
    float fx = laneX(s.chute, lane, Y);
    if (n.kind == FISH && u < 0.18f) fx = laneX(s.chute, lane < 1 ? -0.8f : 2.8f, Y) * (1 - u / 0.18f) + fx * (u / 0.18f);
    Proj q = project(fx, Y, FLOOR_Z + z), g = project(fx, Y, FLOOR_Z);
    o.x = q.x;
    o.y = q.y;
    o.gx = g.x;
    o.gy = g.y;
    o.k = q.s / (SPRITE_PPM * S) * size;
    o.frame = n.kind == FISH ? (int)(el_ / 90) : (int)(o.roll * 3.2f);
    o.angle = n.kind == BOMB ? std::sin(o.roll * 4) * 8 : 0;
  }

  void updateObjs(int i) {
    Slasher& s = sl_[i];
    for (auto& o : s.objs) {
      if (!o.active) continue;
      const Note& n = o.note;
      float late = el_ - n.t;
      if (!o.judged && late > (n.kind == BOMB ? BOMB_WINDOW : WIN_OK)) {
        o.judged = true;
        if (n.kind == BOMB) {
          // a bomb rolls past untouched: its fuse fizzles out (a point for keeping your nerve)
          s.score += DODGE_POINTS;
          say(s, "DODGED!", Color::hex(0x7fe05a), 0.7f);
          app.audio.sfx("pop", 0.25f);
          o.active = false;
          continue;
        }
        if (s.combo > 0 || !isCpu(i)) say(s, "MISS", Color::hex(0x9aa3b8), 0.75f);
        breakCombo(s);
      }
      float Y = Y_CUT + (n.t - el_) * o.speed;
      if (o.judged && Y < Y_NEAR + 0.35f) {
        // a missed note slams into the end of the chute at the player's feet
        o.active = false;
        app.audio.sfx("hit", 0.4f);
        if (s.stunT <= 0) setAnim(s, "surprised", 0.4f);
        continue;
      }
      placeObj(o, s);
    }
  }

  void readLanes(int i) {
    const Pad& p = pad(i);
    if (p.press(B_X) || p.press(B_LEFT)) slash(i, 0);
    if (p.press(B_A) || p.press(B_Y) || p.press(B_UP) || p.press(B_DOWN)) slash(i, 1);
    if (p.press(B_B) || p.press(B_RIGHT)) slash(i, 2);
  }

  void slash(int i, int lane) {
    Slasher& s = sl_[i];
    if (s.stunT > 0 || s.whiff[lane] > 0) return;
    Obj* best = nullptr;
    float bestDt = 1e9f;
    for (auto& o : s.objs) {
      if (!o.active || o.judged || o.note.lane != lane) continue;
      float d = el_ - o.note.t;
      if (std::fabs(d) < std::fabs(bestDt)) {
        bestDt = d;
        best = &o;
      }
    }
    // pose
    s.poseT = 150;
    if (s.stunT <= 0) {
      setAnim(s, lane == 1 ? "throw" : "dash", 0.15f);
      if (lane != 1) s.flip = lane == 0;
    }
    s.padFlash[lane] = 1;
    Proj cut = project(laneX(s.chute, lane, Y_CUT), Y_CUT, FLOOR_Z + 0.3f);
    if (best && best->note.kind == BOMB && std::fabs(bestDt) <= BOMB_WINDOW) {
      boom(i, *best, cut.x, cut.y);
      return;
    }
    Grade g = best ? judge(bestDt) : G_NONE;
    if (!best || g == G_NONE || best->note.kind == BOMB) {
      s.whiff[lane] = WHIFF_MS;
      app.audio.sfx("whoosh", 0.25f);
      streak(cut.x, cut.y, lane, 0, 0.8f);
      if (s.combo > 0) {
        say(s, "WHIFF", Color::hex(0x9aa3b8), 0.7f);
        breakCombo(s);
      }
      return;
    }
    // a clean slice
    Obj& o = *best;
    o.judged = true;
    s.combo++;
    s.best = std::max(s.best, s.combo);
    if (g == G_PERFECT) s.perfects++;
    int pts = slicePoints(g, o.note.kind, s.combo);
    s.score += pts;
    streak(cut.x, cut.y, lane, comboMult(s.combo) - 1, o.k / 0.5f);
    splitObj(o, lane);
    app.audio.sfx(g == G_PERFECT ? "hit" : "pop", 0.4f);
    if (o.note.kind == GOLD) app.audio.sfx("coin", 0.7f);
    if (g == G_PERFECT)
      say(s, "PERFECT!", Color::hex(0xffc83a), 0.95f);
    else if (g == G_GOOD)
      say(s, "GOOD", Color::hex(0x5ce1ff));
    else
      say(s, "OK", Color::hex(0xd8e2ee));
    popScore(i, pts, cut.x, cut.y - 4);
    if (s.combo == 5 || s.combo == 15 || s.combo == 30) {
      s.comboUpT = 0;
      s.comboUpM = comboMult(s.combo);
      setAnim(s, "celebrate", 0.7f);
      app.audio.sfx("item", 0.6f);
    }
  }

  void splitObj(Obj& o, int lane) {
    Frame f = frameFor(o.note.kind, o.frame);
    float h = f.r.h * o.k;
    float top = o.y - f.oy * h;
    for (int i = 0; i < 2; i++) {
      Half* hf = nullptr;
      for (auto& q : halves_)
        if (!q.active) {
          hf = &q;
          break;
        }
      if (!hf) break;
      int mid = f.r.h / 2;
      hf->active = true;
      hf->t = 0;
      hf->k = o.k;
      hf->src = i == 0 ? SDL_Rect{f.r.x, f.r.y, f.r.w, mid} : SDL_Rect{f.r.x, f.r.y + mid, f.r.w, f.r.h - mid};
      hf->x = o.x;
      hf->y = top + (i == 0 ? h * 0.25f : h * 0.75f);
      float side = i == 0 ? -1.0f : 1.0f;
      hf->vx = (side * (160 + (float)rng.next() * 120) + (lane - 1) * 60) * S;
      hf->vy = (-260 - (float)rng.next() * 160 - (i == 0 ? 120 : 0)) * S;
      hf->spin = side * (240 + (float)rng.next() * 240);
      hf->angle = 0;
    }
    o.active = false;
  }

  void streak(float x, float y, int lane, int tier, float k) {
    for (auto& st : streaks_)
      if (st.t >= 0.21f) {
        st.x = x;
        st.y = y - 30 * S;
        st.ang = lane == 0 ? -28 : lane == 2 ? 28 : (rng.chance(0.5) ? -8 : 8);
        st.tier = std::min(3, tier);
        st.k = clampf(k * 0.9f, 0.7f, 1.4f);
        st.t = 0;
        return;
      }
  }

  // slices in quick succession add to the pop still gathering over the cut line
  void popScore(int i, int value, float x, float y) {
    for (auto& p : pops_)
      if (p.owner == i && p.t < 0.35f) {
        p.value += value;
        p.text = "+" + std::to_string(p.value);
        p.c = p.value >= 9 ? col::gold : col::white;
        return;
      }
    pops_.push_back({"+" + std::to_string(value), x, y, 0, 0.9f, value >= 9 ? col::gold : col::white, 24, i, value});
  }

  void breakCombo(Slasher& s) { s.combo = 0; }

  void boom(int i, Obj& o, float x, float y) {
    Slasher& s = sl_[i];
    o.judged = true;
    o.active = false;
    s.score = std::max(0, s.score - BOMB_PENALTY);
    breakCombo(s);
    s.stunT = STUN_MS;
    s.tintT = 0.42f;
    setAnim(s, "stunned", STUN_MS / 1000);
    say(s, "BOOM!", Color::hex(0xff5a4a), 1);
    booms_.push_back({x, y - 9, 0});
    app.audio.sfx("bad", 0.7f);
  }

  // --- CPU: plans each note once as it appears (when to slash, with its timing error, or let it pass)
  void planCpu(int i, const Note& n) {
    Slasher& s = sl_[i];
    const Skill& sk = SKILL[std::clamp(cpuLevel(i), 0, 2)];
    float sigma = 18 + sk.aimNoise * 120;
    float err = (float)(rng.next() + rng.next() + rng.next() - 1.5) * sigma * 1.4f;
    if (n.kind == BOMB) {
      if (rng.chance(sk.mistake * 0.5)) {
        s.planLane.push_back(n.lane);
        s.planAt.push_back(n.t + err * 0.5f);
      }
      return;
    }
    if (rng.chance(sk.mistake * 0.55)) return;
    s.planLane.push_back(n.lane);
    s.planAt.push_back(n.t + err);
  }
  void cpuThink(int i) {
    Slasher& s = sl_[i];
    if (s.stunT > 0) return;
    for (int k = (int)s.planAt.size() - 1; k >= 0; k--) {
      float at = s.planAt[k];
      if (el_ < at) continue;
      int lane = s.planLane[k];
      s.planAt[k] = s.planAt.back();
      s.planLane[k] = s.planLane.back();
      s.planAt.pop_back();
      s.planLane.pop_back();
      if (el_ - at > 200) continue;
      slash(i, lane);
    }
  }

  // --- drawing -----------------------------------------------------------------------------------
  void drawObj(Tex* t, const Obj& o) const {
    Frame f = frameFor(o.note.kind, o.frame);
    float k = o.k;
    app.gfx.ellipse(o.gx, o.gy + 1, 38 * k, 13 * k, Color(10, 10, 20, o.note.kind == FISH ? 60 : 110));
    if (o.note.kind == GOLD) spr::star(o.x, o.y - 40 * k, k * 0.9f, el_ * 0.08f, Color(255, 210, 58, 170));
    app.gfx.sprite(t, f.r, o.x, o.y, k, k, 0.5f, f.oy, o.angle);
    if (o.note.kind == BOMB) {
      // the fizzing fuse
      float fl = 0.5f + 0.5f * std::sin(el_ * 0.09f + o.note.t);
      float sx = o.x + 13 * k, sy = o.y - 88 * k;
      app.gfx.circle(sx, sy, (3 + 2 * fl) * k * 2, Color(255, 180, 70, 200));
      app.gfx.circle(sx, sy, (1.5f + fl) * k * 2, Color(255, 250, 200));
    }
  }

  void drawStreak(const Streak& st) const {
    float u = st.t / 0.21f;
    if (u >= 1) return;
    float a = u < 0.3f ? 1 : 1 - (u - 0.3f) / 0.7f;
    float grow = 0.5f + 0.5f * std::min(1.0f, u / 0.43f) * 1.25f;
    float R = 44 * st.k, ca = std::cos(st.ang * PI / 180), sa = std::sin(st.ang * PI / 180);
    Color c = TIER_COLORS[st.tier].alpha(a);
    const int n = 7;
    float px = 0, py = 0;
    for (int i = 0; i <= n; i++) {
      float v = (float)i / n, ang = PI * (1.22f + 0.56f * v);
      float lx = std::cos(ang) * R * grow, ly = std::sin(ang) * R * 0.5f + R * 0.42f;
      float x = st.x + lx * ca - ly * sa, y = st.y + lx * sa + ly * ca;
      if (i > 0) app.gfx.line(px, py, x, y, 1.5f + 5 * std::sin(v * PI) * st.k, c);
      px = x;
      py = y;
    }
  }

  void draw() override {
    drawArena();
    Tex* sheet = app.gfx.tex("mg/pirates_slash.png");
    // the cut lines and strike pads (they pulse on the beat and flash on a slash)
    for (int i = 0; i < count(); i++) {
      const Slasher& s = sl_[i];
      Proj L = project(laneX(s.chute, -0.5f, Y_CUT), Y_CUT, FLOOR_Z), R = project(laneX(s.chute, 2.5f, Y_CUT), Y_CUT, FLOOR_Z);
      app.gfx.line(L.x, L.y, R.x, R.y, 6, Color(255, 255, 255, (unsigned char)(255 * (0.12f + 0.12f * pulse_))));
      app.gfx.line(L.x, L.y, R.x, R.y, 2.2f, (s.stunT > 0 ? Color(154, 154, 164) : Color(255, 241, 200)).alpha(0.45f + 0.4f * pulse_));
      for (int l = 0; l < 3; l++) {
        Proj a = project(laneX(s.chute, (float)l, Y_CUT), Y_CUT, FLOOR_Z);
        float f = s.padFlash[l];
        float w = (LANE_W - 0.08f) * a.s * (1 + 0.12f * f), h = w * 0.34f;
        Color pc = PAD_COLORS[l];
        app.gfx.ellipse(a.x, a.y, w * 0.5f + 1.5f, h * 0.5f + 1.5f, f > 0.1f ? col::white : pc);
        app.gfx.ellipse(a.x, a.y, w * 0.5f, h * 0.5f, pc.mix(col::black, 0.35f).alpha(0.6f));
        app.gfx.ellipse(a.x, a.y, w * 0.5f, h * 0.5f, pc.alpha(clampf((isCpu(i) ? 0.22f : 0.34f) + 0.25f * pulse_ + 0.4f * f, 0, 1)));
        if (!isCpu(i)) {
          Proj g = project(laneX(s.chute, (float)l, Y_CUT - 0.62f), Y_CUT - 0.62f, FLOOR_Z);
          app.gfx.circle(g.x, g.y, 9, col::ink.alpha(0.8f));
          app.gfx.circle(g.x, g.y, 7.5f, pc);
          app.gfx.text(PAD_LABELS[l], g.x, g.y - 7, 13, col::white, CENTER, false);
        }
      }
    }
    // the chutes nobody is on are roped off
    for (int c = 0; c < 4; c++) {
      if (used_[c]) continue;
      Proj a = project(laneX(c, -0.6f, Y_CUT), Y_CUT, FLOOR_Z + 0.4f), b = project(laneX(c, 2.6f, Y_CUT), Y_CUT, FLOOR_Z + 0.4f);
      app.gfx.line(a.x, a.y, b.x, b.y + 4, 3.2f, Color::hex(0x6a5238));
      app.gfx.rect(a.x - 2.2f, a.y - 2.7f, 4.4f, 20, Color::hex(0x3a2e2a));
      app.gfx.rect(b.x - 2.2f, b.y - 2.7f, 4.4f, 20, Color::hex(0x3a2e2a));
    }
    // everything on the chutes, far to near
    std::vector<const Obj*> objs;
    for (auto& s : sl_)
      for (auto& o : s.objs)
        if (o.active) objs.push_back(&o);
    std::sort(objs.begin(), objs.end(), [](const Obj* a, const Obj* b) { return a->Y > b->Y; });
    for (const Obj* o : objs) drawObj(sheet, *o);
    for (auto& h : halves_) {
      if (!h.active) continue;
      float a = std::max(0.0f, 1 - h.t / 0.65f);
      app.gfx.sprite(sheet, h.src, h.x, h.y, h.k, h.k, 0.5f, 0.5f, h.angle, false, col::white.alpha(a));
    }
    for (auto& st : streaks_) drawStreak(st);
    for (auto& b : booms_) {
      float u = b.t / 0.5f;
      if (u >= 1) continue;
      app.gfx.ellipse(b.x, b.y + 9, 89 * (0.3f + 0.7f * u), 40 * (0.3f + 0.7f * u), Color(255, 176, 112, (unsigned char)(200 * (1 - u))));
      app.gfx.circle(b.x, b.y, 30 * (0.5f + 0.5f * u), Color(255, 220, 120, (unsigned char)(255 * (1 - u))));
      app.gfx.circle(b.x, b.y - 10 * u, 22 * (0.4f + 0.8f * u), Color(90, 90, 100, (unsigned char)(180 * (1 - u))));
    }
    // the players at the near end of their chutes
    for (int i = 0; i < count(); i++) {
      const Slasher& s = sl_[i];
      Color pc = color(i);
      app.gfx.ellipse(s.x, FEET_Y + 1, 39, 11, pc);
      app.gfx.ellipse(s.x, FEET_Y + 1, 36, 9, pc.mix(col::black, 0.2f).alpha(0.6f));
      Color tint = s.tintT > 0 ? Color(90, 90, 100) : col::white;
      spr::character(player(i).character, s.anim, s.animT, s.x, FEET_Y, CHAR_SCALE, s.flip, tint);
      drawPlayerTag(i, s.x - 46, FEET_Y - 22);
      if (s.combo > 0) {
        app.gfx.text(std::to_string(s.combo) + " COMBO", s.x + 30, FEET_Y - 40, 14, col::white, LEFT);
        int m = comboMult(s.combo);
        if (m > 1) app.gfx.text("x" + std::to_string(m), s.x + 30, FEET_Y - 25, 18, TIER_COLORS[m - 1], LEFT);
      }
      if (s.word.text && s.word.t < 0.75f) {
        float a = s.word.t < 0.5f ? 1 : 1 - (s.word.t - 0.5f) / 0.25f;
        float sc = s.word.scale * (0.8f + 0.2f * easeBack(std::min(1.0f, s.word.t / 0.15f)));
        app.gfx.text(s.word.text, s.x, 268 - 12 * s.word.t, 28, s.word.c.alpha(a), CENTER, true, sc);
      }
      if (s.comboUpT < 1.0f) {
        float a = s.comboUpT < 0.7f ? 1 : 1 - (s.comboUpT - 0.7f) / 0.3f;
        float sc = 0.3f + 0.7f * easeBack(std::min(1.0f, s.comboUpT / 0.22f));
        app.gfx.text("x" + std::to_string(s.comboUpM) + " COMBO!", s.x, 232 - (s.comboUpT > 0.7f ? (s.comboUpT - 0.7f) * 60 : 0), 24, pc.mix(col::white, 0.3f).alpha(a), CENTER, true, sc);
      }
    }
    for (auto& p : pops_) {
      float a = p.t < p.life * 0.7f ? 1 : 1 - (p.t - p.life * 0.7f) / (p.life * 0.3f);
      app.gfx.text(p.text, p.x, p.y, p.size, p.c.alpha(a), CENTER);
    }
    if (fast_ && bannerT_ < 1.5f) {
      float a = bannerT_ < 1.2f ? 1 : 1 - (bannerT_ - 1.2f) / 0.3f;
      app.gfx.text("SPEED UP!", VW / 2, 150, 44, col::gold.alpha(a), CENTER, true, 0.7f + 0.3f * easeBack(std::min(1.0f, bannerT_ / 0.25f)));
    }
    drawTimer((DUR - el_) / 1000);
    std::vector<int> sc;
    for (auto& s : sl_) sc.push_back(s.score);
    drawScores(sc, "pts");
  }

  bool finished() const override { return el_ >= DUR; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& x : sl_) s.push_back(x.score);
    return s;
  }
  std::string scoreLabel(int i) const override { return std::to_string(sl_[i].score) + " pts"; }

 private:
  struct Boom {
    float x, y, t;
  };
  std::vector<Note> chart_;
  std::vector<float> beats_;
  size_t beatNext_ = 0;
  int beatIdx_ = 0;
  std::vector<Slasher> sl_;
  std::array<Half, 28> halves_{};
  std::array<Streak, 12> streaks_{};
  std::vector<Pop> pops_;
  std::vector<Boom> booms_;
  bool used_[4] = {false, false, false, false};
  float el_ = 0, pulse_ = 0, bannerT_ = 9;
  bool fast_ = false, wrapped_ = false;
};

}  // namespace

REGISTER_MINIGAME("triple-slash", TripleSlash);

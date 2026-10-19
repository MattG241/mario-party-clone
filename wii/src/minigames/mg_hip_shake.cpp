// Hip-Shake Hustle (Showtime): a rock'n'roll dance-off on a 1950s bandshell. Moves fall down each
// dancer's spotlight in time with the band (120 bpm): push the stick / D-pad that way as an arrow
// reaches your target, press A for a star (a pose). PERFECT or GOOD on the beat; 8 in a row raises the
// multiplier (up to x4); a miss, a wrong move or a press with nothing to hit breaks the streak.
// Everybody dances the same seeded routine; the last 10 seconds are an encore worth double.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float PI = 3.14159265f;
constexpr float S = VW / 1920.0f;  // web px -> canvas px
constexpr float DURATION = 45, ENCORE_AT = 35;
constexpr float BEAT_MS = 500;  // 120 bpm
constexpr int FIRST_BEAT = 4, ROUND_BEATS = 90;
constexpr float STAGE_Y = 820 * S, HIT_Y = 466 * S, NOTE_Y0 = 162 * S, LANE_W = 150 * S;
constexpr float LEAD_MS = 1200, FALL_MS = 260;
constexpr float GAPS[3] = {640 * S, 490 * S, 420 * S};
constexpr float CHAR_SCALE = 1.3f;
// Timing windows (ms either side of the note) and the latency bias added to every note.
constexpr float J_PERFECT = 55, J_GOOD = 115, J_CATCH = 200, LATE_BIAS = 25, BOUNCE_MS = 110;
constexpr float POSE_MS = 300, SPIN_MS = 230;

enum Move { L, R, U, D, A, NONE = -1 };
constexpr unsigned MOVE_COLOR[5] = {0xff4fa3, 0xffae1f, 0x9b6bff, 0x1fb8ff, 0xf7b92b};

// CPU skill (web CPU_SKILL): mistake chance and timing noise.
struct Skill {
  float mistake, aimNoise;
};
constexpr Skill SKILLS[3] = {{0.24f, 0.55f}, {0.11f, 0.28f}, {0.05f, 0.13f}};

struct Note {
  float beat, t;  // t: ms after GO
  int move;
};

// --- The routine (web hipShakeRules.buildChart) -------------------------------------------------
enum Section { WARM, GROOVE, HOT, ENCORE };
Section sectionAt(float beat) { return beat >= 68 ? ENCORE : (beat >= 44 ? HOT : (beat >= 24 ? GROOVE : WARM)); }

const std::vector<std::vector<float>> RHYTHMS[4] = {
    {{0, 2}, {0, 1, 2}, {0, 2, 3}},
    {{0, 1, 2, 3}, {0, 1, 2}, {0, 2, 3}, {0, 1, 3}},
    {{0, 1, 1.5f, 2, 3}, {0, 0.5f, 1, 2, 3}, {0, 1, 2, 2.5f, 3}, {0, 1, 2, 3}},
    {{0, 0.5f, 1, 2, 2.5f, 3}, {0, 1, 1.5f, 2, 3}, {0, 0.5f, 1, 1.5f, 2, 3}, {0, 1, 2, 2.5f, 3}},
};
const std::vector<std::vector<int>> FIGURES[4] = {
    {{L, R, L, R}, {R, L, R, L}, {L, L, R, R}},
    {{L, R, L, R}, {U, D, U, D}, {L, U, R, D}, {R, U, L, D}, {L, L, R, R}, {U, U, D, D}},
    {{L, R, R, L, U}, {U, D, D, U, L}, {L, U, R, D, L}, {R, L, L, R, D}, {D, U, L, R, U}},
    {{L, L, R, U, U, D}, {R, R, L, D, D, U}, {L, R, U, D, L, R}, {U, D, L, L, R, R}},
};

bool poseBar(int bar, Section s, bool lastOfSection) {
  if (lastOfSection) return true;
  if (s == GROOVE) return bar % 3 == 1;
  if (s == HOT) return bar % 2 == 1;
  return s == ENCORE;
}

std::vector<Note> buildChart(uint32_t seed) {
  Random rng(seed ^ 0x51f7u);
  std::vector<Note> out;
  int lastBar = (ROUND_BEATS - 8 - FIRST_BEAT) / 4;
  for (int bar = 0; bar <= lastBar; bar++) {
    int start = FIRST_BEAT + bar * 4;
    Section sec = sectionAt((float)start);
    bool lastOfSection = sectionAt((float)start + 4) != sec || bar == lastBar;
    const std::vector<float>& rhythm = rng.pick(RHYTHMS[sec]);
    const std::vector<int>& figure = rng.pick(FIGURES[sec]);
    bool pose = poseBar(bar, sec, lastOfSection);
    for (size_t i = 0; i < rhythm.size(); i++) {
      int move = figure[std::min(i, figure.size() - 1)];
      if (i == rhythm.size() - 1 && pose) move = A;
      out.push_back({start + rhythm[i], (start + rhythm[i]) * BEAT_MS, move});
    }
  }
  int finale = FIRST_BEAT + (lastBar + 1) * 4 + 2;  // one last big pose
  if (finale <= ROUND_BEATS - 2) out.push_back({(float)finale, finale * BEAT_MS, A});
  return out;
}

int multiplier(int streak) { return 1 + std::min(3, std::max(0, streak) / 8); }

// One dancer's scorecard against the shared chart (web DanceCard).
struct Card {
  const std::vector<Note>* notes = nullptr;
  std::vector<uint8_t> state;  // 0 open, 1 hit, 2 missed
  size_t head = 0;
  int score = 0, streak = 0, best = 0;
  float lastHitAt = -1e9f;

  int nearest(float t) const {
    int bestI = -1;
    float bestD = 1e9f;
    for (size_t i = head; i < notes->size(); i++) {
      float d = t - ((*notes)[i].t + LATE_BIAS);
      if (d < -J_CATCH) break;
      if (state[i] != 0 || d > J_CATCH) continue;
      if (std::fabs(d) < bestD) {
        bestD = std::fabs(d);
        bestI = (int)i;
      }
    }
    return bestI;
  }
  void settle(size_t i, uint8_t s) {
    state[i] = s;
    while (head < notes->size() && state[head] != 0) head++;
  }
};

struct DirReader {
  int stick = NONE, lastDir = NONE;
  float lastAt = -1e9f;
  static bool opposite(int a, int b) { return (a == L && b == R) || (a == R && b == L) || (a == U && b == D) || (a == D && b == U); }
  int fire(int d, float now) {
    lastDir = d;
    lastAt = now;
    return d;
  }
  int read(const Pad& p, float now) {
    int dpad = p.press(B_LEFT) ? L : (p.press(B_RIGHT) ? R : (p.press(B_UP) ? U : (p.press(B_DOWN) ? D : NONE)));
    float m = std::hypot(p.x, p.y);
    int s = stick;
    if (m < 0.38f) s = NONE;
    else if (m > 0.62f) s = std::fabs(p.x) >= std::fabs(p.y) ? (p.x < 0 ? L : R) : (p.y < 0 ? U : D);
    if (dpad != NONE) {  // the D-pad also drives the stick axes: take the press once
      stick = s != NONE ? s : dpad;
      return fire(dpad, now);
    }
    int prev = stick;
    stick = s;
    if (s == NONE || s == prev) return NONE;
    if (lastDir != NONE && opposite(s, lastDir) && now - lastAt < 90) return NONE;
    return fire(s, now);
  }
};

struct Dancer {
  float x = 0;
  Card card;
  DirReader dir;
  int pose = NONE;
  float poseT = 0, stumbleT = 0, flare = 0, kick = 0, glow = 0, targetGlow = 0, anim = 0;
  int cpuFor = -1, cpuMove = NONE;
  float cpuAt = 0;
};

struct Pop {
  const char* text;
  float x, y, t, life;
  Color c;
  float size;
};

struct Spark {
  float x, y, vx, vy, life, max, r;
  Color c;
};

class HipShake : public Minigame {
 public:
  void start() override {
    notes_ = buildChart((uint32_t)(rng.next() * 4294967296.0));
    int n = count();
    float gap = GAPS[std::max(0, std::min(2, n - 2))];
    for (int i = 0; i < n; i++) {
      Dancer d;
      d.x = VW / 2.0f + (i - (n - 1) / 2.0f) * gap;
      d.card.notes = &notes_;
      d.card.state.assign(notes_.size(), 0);
      d.anim = i * 0.21f;
      dancers_.push_back(d);
    }
  }

  void update(float dt) override {
    time_ += dt;
    float t = time_ * 1000;
    if (!encore_ && time_ >= ENCORE_AT) {
      encore_ = true;
      app.audio.sfx("cheer", 0.6f);
      for (auto& d : dancers_) d.flare = 1;
    }
    // the band: a tick on every beat, the targets throb, the downbeat accented
    int beat = (int)(t / BEAT_MS);
    if (beat != lastBeat_) {
      lastBeat_ = beat;
      bool accent = beat % 4 == 0;
      app.audio.sfx(accent ? "land" : "tick", accent ? 0.6f : 0.35f);
      for (auto& d : dancers_) {
        d.kick = std::max(d.kick, accent ? 1.0f : 0.6f);
        d.flare = std::max(d.flare, accent ? 0.35f : 0.2f);
      }
    }
    for (int i = 0; i < count(); i++) {
      Dancer& d = dancers_[i];
      if (isCpu(i)) {
        int m = cpuThink(i, t);
        if (m != NONE) press(i, m, t);
      } else {
        int m = d.dir.read(pad(i), t);
        if (m != NONE) press(i, m, t);
        if (pad(i).press(B_A)) press(i, A, t);
      }
      sweep(i, t);
      d.anim += dt;
      if (d.poseT > 0 && (d.poseT -= dt * 1000) <= 0) d.pose = NONE;
      if (d.stumbleT > 0) d.stumbleT -= dt * 1000;
      d.flare = std::max(0.0f, d.flare - dt / 0.42f);
      d.kick = std::max(0.0f, d.kick - dt / 0.18f);
      d.glow = std::max(0.0f, d.glow - dt / 1.4f);
      d.targetGlow = std::max(0.0f, d.targetGlow - dt / 0.26f);
    }
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t > p.life; });
    for (auto& s : sparks_) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 60 * dt;
    }
    std::erase_if(sparks_, [](const Spark& s) { return s.life <= 0; });
  }

  void draw() override {
    drawArena();
    float t = time_ * 1000;
    // spotlights and pools
    for (int i = 0; i < count(); i++) {
      const Dancer& d = dancers_[i];
      Color beam = Color::hex(0xfff2dc).mix(color(i), 0.25f);
      if (encore_) beam = beam.mix(col::gold, 0.35f);
      float a = 0.10f + 0.16f * d.flare + 0.1f * d.glow;
      float top = NOTE_Y0 - 10, h = STAGE_Y + 12 - top;
      app.gfx.rect(d.x - LANE_W * 0.75f, top, LANE_W * 1.5f, h, beam.alpha(a * 0.45f));
      app.gfx.rect(d.x - LANE_W * 0.45f, top, LANE_W * 0.9f, h, beam.alpha(a * 0.6f));
      app.gfx.ellipse(d.x, STAGE_Y + 3, 64, 15, color(i).alpha(0.28f + 0.3f * d.flare + 0.3f * d.glow));
    }
    // dancers
    float phase = t >= 0 ? std::fmod(t, BEAT_MS) / BEAT_MS : 0;
    float bob = 4 * phase * (1 - phase);
    for (int i = 0; i < count(); i++) drawDancer(i, bob);
    // targets, then the falling moves
    for (int i = 0; i < count(); i++) {
      const Dancer& d = dancers_[i];
      Color c = color(i);
      if (d.targetGlow > 0) app.gfx.circle(d.x, HIT_Y, 30, c.alpha(0.5f * d.targetGlow));
      app.gfx.circle(d.x, HIT_Y, 19, Color(20, 12, 40, 110));
      app.gfx.ring(d.x, HIT_Y, 21 * (1 + 0.09f * d.kick), c);
      app.gfx.ring(d.x, HIT_Y, 15, col::white.alpha(0.55f));
      int m = multiplier(d.card.streak);
      if (m > 1) app.gfx.text("x" + std::to_string(m), d.x + 40, HIT_Y - 18, 22, m == 2 ? col::gold : (m == 3 ? Color::hex(0xff6fb0) : Color::hex(0x35d6ff)), CENTER, true);
    }
    for (size_t k = 0; k < notes_.size(); k++) {
      const Note& n = notes_[k];
      if (n.t - LEAD_MS > t) break;
      if (n.t + FALL_MS < t) continue;
      float y = HIT_Y - (n.t - t) / LEAD_MS * (HIT_Y - NOTE_Y0);
      float fadeIn = clampf((y - NOTE_Y0 + 6 * S) / (46 * S), 0, 1);
      float past = t > n.t ? (t - n.t) / FALL_MS : 0;
      for (auto& d : dancers_) {
        int st = d.card.state[k];
        if (st == 1) continue;
        float a = st == 2 ? std::max(0.0f, 0.6f - past * 0.6f) * fadeIn : fadeIn * (past > 0 ? std::max(0.0f, 1 - past) : 1);
        if (a > 0.01f) drawNote(d.x, y, n.move, a, st == 2);
      }
    }
    for (auto& s : sparks_) app.gfx.circle(s.x, s.y, s.r * (0.4f + 0.6f * s.life / s.max), s.c.alpha(std::min(1.0f, s.life / s.max * 2)));
    for (auto& p : pops_) {
      float k = p.t / p.life;
      app.gfx.text(p.text, p.x, p.y - 12 * easeOut(k), (int)p.size, p.c.alpha(k < 0.7f ? 1 : (1 - k) / 0.3f), CENTER, true);
    }
    if (encore_ && time_ < ENCORE_AT + 2.5f && std::fmod(time_, 0.4f) < 0.28f) app.gfx.text("ENCORE! DOUBLE POINTS", VW / 2, 52, 24, col::gold, CENTER, true);
    drawTimer(DURATION - time_);
    drawScores(scores(), "pts");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& d : dancers_) s.push_back(d.card.score);
    return s;
  }
  std::string scoreLabel(int i) const override {
    return std::to_string(dancers_[i].card.score) + " pts, best streak " + std::to_string(dancers_[i].card.best);
  }

 private:
  std::vector<Note> notes_;
  std::vector<Dancer> dancers_;
  std::vector<Pop> pops_;
  std::vector<Spark> sparks_;
  float time_ = 0;
  int lastBeat_ = -1;
  bool encore_ = false;

  void pop(const char* s, float x, float y, Color c, float size = 20, float life = 0.45f) {
    if (pops_.size() >= 16) pops_.erase(pops_.begin());
    pops_.push_back({s, x, y, 0, life, c, size});
  }
  void sparkle(float x, float y, int n, Color c, float spread, float up) {
    for (int k = 0; k < n && sparks_.size() < 90; k++) {
      float life = rng.frange(0.4f, 0.8f);
      sparks_.push_back({x + rng.frange(-spread, spread), y, rng.frange(-40, 40), -rng.frange(up * 0.5f, up), life, life, rng.frange(2, 4), c});
    }
  }

  // A press of `move` at band time t.
  void press(int i, int move, float t) {
    Dancer& d = dancers_[i];
    Card& c = d.card;
    int k = c.nearest(t);
    if (k < 0) {
      if (t - c.lastHitAt < BOUNCE_MS) return;
      c.streak = 0;  // mashing never pays
      return;
    }
    const Note& n = notes_[k];
    float off = t - (n.t + LATE_BIAS);
    if (n.move != move) {
      if (t - c.lastHitAt < BOUNCE_MS) return;
      c.settle(k, 2);
      flub(i);
      return;
    }
    float a = std::fabs(off);
    if (a <= J_GOOD) {
      bool perfect = a <= J_PERFECT;
      int pts = (perfect ? 3 : 1) * multiplier(c.streak) * (move == A ? 2 : 1) * (encore_ ? 2 : 1);
      c.settle(k, 1);
      c.streak++;
      c.best = std::max(c.best, c.streak);
      c.score += pts;
      c.lastHitAt = t;
      d.pose = move;
      d.poseT = move == A ? SPIN_MS + POSE_MS + 120 : POSE_MS;
      d.stumbleT = 0;
      d.flare = 1;
      d.kick = 1.3f;
      d.targetGlow = perfect ? 0.95f : 0.6f;
      pop(perfect ? "PERFECT" : "GOOD", d.x, HIT_Y + 30, perfect ? Color::hex(0xffbf2a) : Color::hex(0xaeefff));
      app.audio.sfx("pop", perfect ? 0.45f : 0.3f);
      if (move == A) {
        pop("POSE!", d.x, 396, Color::hex(0xffbf2a), 24, 0.6f);
        sparkle(d.x, STAGE_Y - 60, 10, Color::hex(0xffe08a), 30, 120);
      } else if (perfect) sparkle(d.x, HIT_Y, 4, col::white, 10, 60);
      if (c.streak % 8 == 0) swoon(i, c.streak / 8);
      return;
    }
    c.settle(k, 2);
    flub(i);
  }

  // Off the beat, the wrong move or a miss: the streak breaks and the dancer stumbles.
  void flub(int i) {
    Dancer& d = dancers_[i];
    d.card.streak = 0;
    d.stumbleT = 260;
    d.pose = NONE;
    d.poseT = 0;
    pop("MISS", d.x, HIT_Y + 30, Color(200, 205, 214), 18, 0.35f);
    if (!isCpu(i)) app.audio.sfx("cancel", 0.2f);
  }

  // A streak milestone: the crowd swoons for this dancer.
  void swoon(int i, int level) {
    Dancer& d = dancers_[i];
    const char* word = level == 1 ? "x2!" : (level == 2 ? "x3!" : (level == 3 ? "x4!" : "SWOON!"));
    pop(word, d.x, 410, Color::hex(0xff5fa8), 30, 0.8f);
    if (level >= 3) pop("SWOON!", d.x + (d.x < VW / 2 ? 60 : -60), 380, Color::hex(0xff5fa8), 24, 0.8f);
    d.glow = 1;
    app.audio.sfx("cheer", 0.35f);
    sparkle(d.x, VH - 50, level >= 3 ? 14 : 9, Color::hex(0xff6fb0), 90, 200);
  }

  void sweep(int i, float t) {
    Card& c = dancers_[i].card;
    for (size_t k = c.head; k < notes_.size(); k++) {
      if (notes_[k].t + LATE_BIAS + J_CATCH >= t) break;
      if (c.state[k] == 0) {
        c.settle(k, 2);
        flub(i);
      }
    }
  }

  float gauss() { return ((float)(rng.next() + rng.next() + rng.next() + rng.next()) - 2) * 1.73f; }

  int cpuThink(int i, float t) {
    Dancer& d = dancers_[i];
    const Skill& sk = SKILLS[std::max(0, std::min(2, cpuLevel(i)))];
    int k = d.cpuFor < 0 ? 0 : d.cpuFor;
    while (k < (int)notes_.size() && (d.card.state[k] != 0 || notes_[k].t + LATE_BIAS + J_GOOD < t)) k++;
    if (k >= (int)notes_.size()) return NONE;
    if (k != d.cpuFor) {
      d.cpuFor = k;
      const Note& n = notes_[k];
      float sigma = 16 + sk.aimNoise * 150;
      d.cpuAt = n.t + LATE_BIAS + gauss() * sigma;
      float r = (float)rng.next();
      if (r < sk.mistake * 0.4f) d.cpuMove = (n.move + rng.range(1, 4)) % 5;  // a wrong move
      else if (r < sk.mistake) d.cpuMove = NONE;                              // asleep at the wheel
      else d.cpuMove = n.move;
    }
    if (d.cpuMove != NONE && t >= d.cpuAt) {
      int m = d.cpuMove;
      d.cpuMove = NONE;
      return m;
    }
    return NONE;
  }

  void drawDancer(int i, float bob) const {
    const Dancer& d = dancers_[i];
    float dx = 0, dy = 0;
    bool flip = false;
    const char* anim = "idle";
    float at = d.anim;
    if (d.pose != NONE && d.poseT > 0) {
      if (d.pose == A) {
        float total = SPIN_MS + POSE_MS + 120, el = total - d.poseT;
        if (el < SPIN_MS) {  // a quick spin into arms-up
          int step = (int)(el / SPIN_MS * 3);
          anim = "walk";
          flip = step == 2;
          at = 0;
          dy = -18 * S * std::sin(el / SPIN_MS * PI);
          if (step == 1) anim = "dash";
        } else {
          anim = "victory";
          at = (el - SPIN_MS) / 1000;
        }
      } else {
        float k = std::max(0.0f, d.poseT / POSE_MS), e = k * k * (3 - 2 * k);
        at = (POSE_MS - d.poseT) / 1000;
        if (d.pose == L || d.pose == R) {
          anim = "throw";
          flip = d.pose == L;
          dx = (d.pose == L ? -16.0f : 16.0f) * S * e;
        } else if (d.pose == U) {
          anim = "celebrate";
          dy = -14 * S * e;
        } else {
          anim = "crouch";
          dy = 10 * S * e;
        }
      }
    } else if (d.stumbleT > 0) {
      anim = "surprised";
      dx = std::sin(d.stumbleT / 18) * 6 * S * (d.stumbleT / 260);
    } else if (time_ > 0) {
      dy = -bob * 7 * S;
    }
    spr::shadow(d.x, STAGE_Y, 54);
    spr::character(player(i).character, anim, at, d.x + dx, STAGE_Y + dy, CHAR_SCALE, flip);
    drawPlayerTag(i, d.x, STAGE_Y + 22);
  }

  void drawNote(float x, float y, int move, float a, bool missed) const {
    Color c = missed ? Color(138, 143, 156) : Color::hex(MOVE_COLOR[move]);
    if (move == A) {
      float pulse = 1 + 0.06f * std::sin(time_ * 11);
      spr::star(x, y, 0.62f * pulse, 0, (missed ? c : col::white).alpha(a));
      return;
    }
    app.gfx.circle(x, y, 16, Color(27, 20, 48, (unsigned char)(255 * a)));
    app.gfx.circle(x, y, 13.5f, c.alpha(a));
    float ux = move == L ? -1.0f : (move == R ? 1.0f : 0.0f), uy = move == U ? -1.0f : (move == D ? 1.0f : 0.0f);
    float px = -uy, py = ux;
    Color w = col::white.alpha(a);
    app.gfx.line(x - ux * 8, y - uy * 8, x + ux * 6, y + uy * 6, 4, w);
    float tx = x + ux * 9, ty = y + uy * 9;
    app.gfx.line(tx + ux * 1.5f, ty + uy * 1.5f, tx - ux * 7 + px * 7, ty - uy * 7 + py * 7, 4, w);
    app.gfx.line(tx + ux * 1.5f, ty + uy * 1.5f, tx - ux * 7 - px * 7, ty - uy * 7 - py * 7, 4, w);
  }
};

}  // namespace

REGISTER_MINIGAME("hip-shake", HipShake);

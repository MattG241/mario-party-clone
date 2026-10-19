// Web Swing (Hero Heights at sunset): a race across the skyline. Press A to web the nearest glowing
// anchor in reach, hold to swing, and let go as you swing up to fling yourself on (a PERFECT release
// flings furthest); chain swing after swing. Touch the street and you're down, then a web zips you back
// up, costing time. First to the finish tower wins, or whoever got furthest after 50 seconds.
// The course, pendulum and CPU swinger follow the web game's swingRules.ts, in its 1920x1080 stage
// coordinates (world x along the course, scrolled by camX and drawn scaled by S) and milliseconds.
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "../game/Data.h"
#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float S = VW / 1920.0f;
constexpr float PI = 3.14159265f;
constexpr float DURATION = 50;
constexpr float CHAR_SCALE = 0.77f;  // the web's 0.55
constexpr float BACK_K = 0.14f;
constexpr float STREET_TOP = 800;
constexpr float LEAD_X = 1120, CATCH_X = 40;
constexpr float HAND = 74, MARK = -104;

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{520, 0.55f, 0.24f, 0.55f, 700}, {300, 0.78f, 0.11f, 0.28f, 420}, {170, 0.9f, 0.05f, 0.13f, 240}};

namespace SW {
constexpr float GRAV = 1500, DRAG = 0.12f, MAX_SPEED = 1050, AIR_CTRL = 340, RANGE = 640, MIN_ROPE = 150, PUMP = 180, REEL = 300, REEL_TO = 420,
                PERFECT_LO = 5, PERFECT_HI = 28, GOOD_LO = 0, GOOD_HI = 45, PERFECT_BOOST = 1.1f, PERFECT_ADD = 90, GOOD_BOOST = 1.03f, STREET_Y = 985,
                DOWN_MS = 650, ZIP_MS = 560, ZIP_TO_Y = 560, ROOF_Y = 700, ROOF_END = 640, RUN = 520, JUMP_VY = 760, BODY = 60, FINISH_ROOF_Y = 520;
}
constexpr float COURSE_LEN = 29000;
constexpr float CAM_MAX = COURSE_LEN - 1250;

enum AnchorKind { CORNICE, MAST, TANK, CRANE };
struct Anchor {
  float x, y;
  int kind;
};

// A seeded course: anchors every 330..500 px at varied heights, now and then a long gap; the last ones
// lead up to the finish tower.
std::vector<Anchor> buildCourse(Random& rng) {
  std::vector<Anchor> a;
  float x = 760, prevY = 300;
  const float last = COURSE_LEN - 200;
  while (x < last - 340) {
    float y = (float)rng.range(215, 420);
    y = std::max(prevY - 170, std::min(prevY + 170, y));
    a.push_back(Anchor{std::round(x), y, rng.range(0, 3)});
    prevY = y;
    bool longGap = rng.chance(0.12);
    x += longGap ? rng.range(520, 580) : rng.range(330, 500);
  }
  const Anchor prev = a.back();
  if (last - prev.x > 540) a.push_back(Anchor{std::round((prev.x + last) / 2), std::round(std::max(215.0f, std::min(420.0f, (prev.y + 250) / 2))), rng.range(0, 3)});
  a.push_back(Anchor{last, 250, CORNICE});
  return a;
}

enum Mode { ROOF, AIR, SWING, DOWN, ZIP, DONE };
enum Release { R_NONE, PERFECT, GOOD, EARLY, LATE, BACK };

struct Swinger {
  float x = 0, y = 0, vx = 0, vy = 0;
  Mode mode = ROOF;
  int anchor = -1;
  float rope = 0, t = 0, zipX = 0, zipY = 0, zipDX = 140;
  int face = 1, chain = 0;
};

struct SwingInput {
  float stickX = 0;
  bool holdA = false, pressA = false;
};

struct SwingEvents {
  int attach = 0;
  bool miss = false, jump = false, zipped = false, up = false;
  Release release = R_NONE;
  float down = 0;
};

int firstAnchorAfter(const std::vector<Anchor>& A, float x, int hint) {
  int i = std::max(0, std::min((int)A.size() - 1, hint));
  while (i > 0 && A[i - 1].x >= x) i--;
  while (i < (int)A.size() && A[i].x < x) i++;
  return i;
}

// The anchor a web shot from (x, y) would catch: the nearest in reach, above and not behind you.
int pickAnchor(const std::vector<Anchor>& A, float x, float y, int hint = 0) {
  int best = -1;
  float bestScore = 1e9f;
  for (int i = std::max(0, firstAnchorAfter(A, x - SW::RANGE, hint)); i < (int)A.size(); i++) {
    const Anchor& a = A[i];
    if (a.x > x + SW::RANGE) break;
    if (a.x < x - 60 || a.y > y - 70) continue;
    float d = std::hypot(a.x - x, a.y - y);
    if (d < SW::MIN_ROPE || d > SW::RANGE) continue;
    float score = d - 0.55f * (a.x - x);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

Release judgeRelease(float vx, float vy) {
  if (vx <= 40) return BACK;
  float deg = std::atan2(-vy, vx) * 180 / PI;
  if (deg >= SW::PERFECT_LO && deg <= SW::PERFECT_HI) return PERFECT;
  if (deg >= SW::GOOD_LO && deg <= SW::GOOD_HI) return GOOD;
  return deg < SW::GOOD_LO ? EARLY : LATE;
}

void capSpeed(Swinger& s) {
  float v = std::hypot(s.vx, s.vy);
  if (v > SW::MAX_SPEED) {
    s.vx *= SW::MAX_SPEED / v;
    s.vy *= SW::MAX_SPEED / v;
  }
}

bool attach(Swinger& s, const std::vector<Anchor>& A, SwingEvents& out) {
  int i = pickAnchor(A, s.x, s.y, s.anchor >= 0 ? s.anchor : 0);
  if (i < 0) {
    out.miss = true;
    return false;
  }
  const Anchor& a = A[i];
  s.anchor = i;
  s.rope = std::hypot(a.x - s.x, a.y - s.y);
  s.mode = SWING;
  out.attach = i + 1;
  // the web's snap takes out some of the speed straight away from the anchor
  float nx = (s.x - a.x) / s.rope, ny = (s.y - a.y) / s.rope;
  float vr = s.vx * nx + s.vy * ny;
  if (vr > 0) {
    s.vx -= vr * nx * 0.7f;
    s.vy -= vr * ny * 0.7f;
  }
  return true;
}

void releaseBoost(Swinger& s, Release r) {
  if (r == PERFECT) {
    float v = std::max(1e-3f, std::hypot(s.vx, s.vy));
    s.vx = s.vx * SW::PERFECT_BOOST + s.vx / v * SW::PERFECT_ADD;
    s.vy = s.vy * SW::PERFECT_BOOST + s.vy / v * SW::PERFECT_ADD;
  } else if (r == GOOD) {
    s.vx *= SW::GOOD_BOOST;
    s.vy *= SW::GOOD_BOOST;
  }
  capSpeed(s);
}

// Pendulum on a web that can go slack, with pumping through the bottom of the arc and a reel-in.
void stepPendulum(Swinger& s, const Anchor& a, const SwingInput& inp, float sec) {
  s.vy += SW::GRAV * sec;
  float dx = s.x - a.x, dy = s.y - a.y, d = std::max(1e-3f, std::hypot(dx, dy));
  if (dy > 0) {
    float tx = -dy / d, ty = dx / d;
    float vt = s.vx * tx + s.vy * ty;
    if (std::fabs(vt) > 40) {
      float sv = vt > 0 ? 1.0f : -1.0f;
      float push = SW::PUMP * (dy / d) * (1 + 0.25f * std::max(0.0f, inp.stickX * (vt * tx > 0 ? 1.0f : (vt * tx < 0 ? -1.0f : 0.0f))));
      s.vx += sv * tx * push * sec;
      s.vy += sv * ty * push * sec;
    }
  }
  if (s.rope > SW::REEL_TO) s.rope = std::max(SW::REEL_TO, s.rope - SW::REEL * sec);
  capSpeed(s);
  s.x += s.vx * sec;
  s.y += s.vy * sec;
  dx = s.x - a.x;
  dy = s.y - a.y;
  d = std::max(1e-3f, std::hypot(dx, dy));
  if (d > s.rope) {
    float nx = dx / d, ny = dy / d;
    s.x = a.x + nx * s.rope;
    s.y = a.y + ny * s.rope;
    float vr = s.vx * nx + s.vy * ny;
    if (vr > 0) {
      s.vx -= vr * nx;
      s.vy -= vr * ny;
    }
  }
}

void stepSwinger(Swinger& s, const SwingInput& inp, const std::vector<Anchor>& A, float dt, SwingEvents& out) {
  out = SwingEvents();
  float sec = dt / 1000;
  if (std::fabs(inp.stickX) > 0.3f) s.face = inp.stickX > 0 ? 1 : -1;
  switch (s.mode) {
    case DONE:
      return;
    case DOWN:
      s.t -= dt;
      s.vx = s.vy = 0;
      if (s.t <= 0) {
        s.mode = ZIP;
        s.t = SW::ZIP_MS;
        s.zipX = s.x;
        s.zipY = s.y;
        s.zipDX = 140;
        out.zipped = true;
      }
      return;
    case ZIP: {
      s.t -= dt;
      float u = 1 - std::max(0.0f, s.t) / SW::ZIP_MS;
      float e = 1 - (1 - u) * (1 - u) * (1 - u);
      s.x = s.zipX + s.zipDX * e;
      s.y = s.zipY + (SW::ZIP_TO_Y - s.zipY) * e;
      if (s.t <= 0) {
        s.mode = AIR;
        s.vx = 420;
        s.vy = -260;
        s.anchor = -1;
        out.up = true;
      }
      return;
    }
    case ROOF:
      s.vx += (inp.stickX * SW::RUN - s.vx) * (1 - std::exp(-10 * sec));
      if (inp.pressA && !attach(s, A, out)) {
        s.mode = AIR;
        s.vy = -SW::JUMP_VY;
        s.vx = std::max(s.vx, 260.0f);
        out.jump = true;
        return;
      }
      if (s.mode == SWING) return;
      s.x += s.vx * sec;
      if (s.x > SW::ROOF_END) {
        s.mode = AIR;
        s.vy = 0;
      } else {
        s.x = std::max(60.0f, s.x);
        s.y = SW::ROOF_Y - SW::BODY;
      }
      return;
    case AIR: {
      if (inp.pressA && attach(s, A, out)) break;
      s.vx += inp.stickX * SW::AIR_CTRL * sec;
      s.vy += SW::GRAV * sec;
      float k = std::exp(-SW::DRAG * sec);
      s.vx *= k;
      s.vy *= k;
      capSpeed(s);
      s.x += s.vx * sec;
      s.y += s.vy * sec;
      if (s.y < 150) {
        s.y = 150;
        if (s.vy < 0) s.vy = 0;
      }
      break;
    }
    case SWING:
      break;
  }
  if (s.mode == SWING) {
    if (!inp.holdA) {
      out.release = judgeRelease(s.vx, s.vy);
      releaseBoost(s, out.release);
      s.mode = AIR;
      s.chain++;
      s.x += s.vx * sec;
      s.y += s.vy * sec;
    } else stepPendulum(s, A[s.anchor], inp, sec);
  }
  if (s.y + SW::BODY >= SW::STREET_Y && s.mode != ROOF) {
    out.down = std::max(1.0f, std::hypot(s.vx, s.vy));
    s.y = SW::STREET_Y - SW::BODY;
    s.mode = DOWN;
    s.t = SW::DOWN_MS;
    s.anchor = -1;
    s.chain = 0;
    s.vx = s.vy = 0;
  }
  if (s.x >= COURSE_LEN && s.mode != DOWN && s.mode != ZIP) s.mode = DONE;
}

// Pull a straggler back into the picture: a web zip from where they are to `toX`, up high.
void catchUp(Swinger& s, float toX) {
  s.mode = ZIP;
  s.t = SW::ZIP_MS;
  s.zipX = s.x;
  s.zipY = s.y;
  s.zipDX = toX - s.x;
  s.anchor = -1;
}

// --- CPU swinger --------------------------------------------------------------------------------------
struct Brain {
  float aim = 40, wait = -1, lateY = 0;
  bool planned = false, holding = false;
  int swingId = -1;
};

void press(Brain& b, SwingInput& inp) {
  if (!b.holding) inp.pressA = true;
  b.holding = true;
  inp.holdA = true;
}

// Webs the next anchor when it sits well ahead and above, and lets go near the top of the forward
// swing at an angle it aims for (worse swingers aim wider, react later and now and then slip).
SwingInput swingCpu(Brain& b, const Swinger& s, const std::vector<Anchor>& A, const Skill& sk, float dt, Random& rng) {
  SwingInput inp;
  inp.stickX = 1;
  inp.holdA = b.holding;
  if (s.mode != AIR) b.planned = false;
  switch (s.mode) {
    case ROOF: {
      if (b.wait < 0) b.wait = sk.reaction * (0.7f + 0.6f * (float)rng.next());
      b.wait -= dt;
      int i = pickAnchor(A, s.x, s.y);
      if (b.wait <= 0 && i >= 0 && A[i].x - s.x > 80) press(b, inp);
      return inp;
    }
    case SWING: {
      if (b.swingId != s.anchor) {
        b.swingId = s.anchor;
        float spread = 3 + sk.aimNoise * 28;
        b.aim = 24 - 14 * sk.accuracy + ((float)rng.next() - 0.5f) * 2 * spread;
        if (rng.next() < sk.mistake) b.aim = rng.next() < 0.5 ? -12 + 10 * (float)rng.next() : 50 + 14 * (float)rng.next();
      }
      float deg = std::atan2(-s.vy, s.vx) * 180 / PI;
      float lag = sk.reaction / 1000 * 0.25f * std::max(1.0f, std::hypot(s.vx, s.vy) / 900) * 40;
      bool ready = s.vx > 60 && deg >= b.aim - lag;
      const Anchor& a = A[s.anchor];
      bool low = s.y > SW::STREET_Y - 120 && s.vy > 0 && a.y > s.y - 200;
      if (ready || low) b.holding = false;
      inp.holdA = b.holding;
      return inp;
    }
    case AIR: {
      b.swingId = -1;
      int i = pickAnchor(A, s.x, s.y);
      if (i < 0) {
        b.holding = false;
        inp.holdA = false;
        return inp;
      }
      const Anchor& a = A[i];
      float angle = std::atan2(a.x - s.x, s.y - a.y);
      bool good = angle > 0.25f && angle < 1.05f && s.vy > -120;
      bool urgent = s.y > 700 && s.vy > 0;
      if (!b.planned) {
        b.planned = true;
        b.lateY = rng.next() < sk.mistake * 0.5f ? 800 + 120 * (float)rng.next() : 0;
      }
      bool slip = b.lateY > 0 && s.y < b.lateY;
      if ((good || urgent) && !slip) {
        b.lateY = 0;
        press(b, inp);
      } else {
        b.holding = false;
        inp.holdA = false;
      }
      return inp;
    }
    default:
      b.holding = false;
      inp.holdA = false;
      return inp;
  }
}

// --- Art -----------------------------------------------------------------------------------------------
// The rendered buildings atlas (heroes_towers.json): frame rects and the web anchor on each, in web px.
struct TowerArt {
  float x, y, w, h, ax, ay;
  int kind;
};
constexpr TowerArt ARTS[8] = {{0, 0, 326, 820, 313, 18, CORNICE},     {330, 0, 346, 820, 333, 18, CORNICE},  {680, 0, 320, 820, 160, 38, MAST},
                              {1004, 0, 310, 820, 155, 38, MAST},     {0, 824, 340, 820, 170, 39, TANK},     {344, 824, 320, 820, 160, 39, TANK},
                              {668, 824, 400, 820, 384, 86, CRANE},   {1072, 824, 400, 820, 384, 86, CRANE}};

void characterRot(int c, const char* anim, int frame, float t, float x, float y, float scale, bool flip, float angle, float body) {
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
  app.gfx.sprite(tex, src, x, y, scale, scale, ox, oy, angle * 57.29578f, flip);
}

struct Racer {
  Swinger s;
  SwingEvents ev;
  Brain brain;
  SwingInput input;
  float tilt = 0, flip = 0, shoot = 1, finishedAt = 0, animT = 0;
  int place = 0;
  bool landed = false, prevA = false;
  const char* landAnim = "idle";
};

struct Word {
  std::string text;
  float x, y, t, hold;  // x, y in world web px
  int size;
  Color c;
};

struct Wave {
  float x, y, r0, r1, t, dur;  // world web px
  Color c;
};

class WebSwing : public Minigame {
 public:
  void start() override {
    course_ = buildCourse(rng);
    std::vector<int> order{0, 1, 2, 3};
    rng.shuffle(order);
    for (int i = 0; i < count(); i++) {
      Racer r;
      r.s.x = 170.0f + order[i] * 105;
      r.s.y = SW::ROOF_Y - SW::BODY;
      racers_.push_back(r);
    }
    // the far skyline silhouettes (parallax), made once
    float x = 0;
    while (x < 1920 * 2) {
      float w = 70 + 90 * (float)rng.next();
      far_.push_back({x, w, 470 + 240 * (float)rng.next()});
      x += w + 10 + 40 * (float)rng.next();
    }
  }

  void update(float dt) override {
    float ms = dt * 1000;
    time_ += dt;
    std::vector<int> crossed;
    for (int i = 0; i < count(); i++) {
      Racer& r = racers_[i];
      r.animT += dt;
      if (r.s.mode == DONE) {
        landOnFinish(r, ms);
        continue;
      }
      if (isCpu(i)) {
        SwingInput c = swingCpu(r.brain, r.s, course_, SKILL[cpuLevel(i)], ms, rng);
        bool hold = c.holdA || c.pressA;
        r.input.stickX = c.stickX;
        r.input.pressA = hold && !r.prevA;
        r.input.holdA = hold;
        r.prevA = hold;
      } else {
        r.input.stickX = pad(i).x;
        r.input.holdA = pad(i).down(B_A);
        r.input.pressA = pad(i).press(B_A);
      }
      stepSwinger(r.s, r.input, course_, ms, r.ev);
      swingFx(i);
      if (r.s.mode == DONE) crossed.push_back(i);
      syncRacer(r, dt);
    }
    // two over the line in the same frame: whoever has been past it longer crossed first
    auto past = [&](int i) { return (racers_[i].s.x - COURSE_LEN) / std::max(60.0f, std::fabs(racers_[i].s.vx)); };
    std::sort(crossed.begin(), crossed.end(), [&](int a, int b) { return past(a) > past(b); });
    for (int i : crossed) finish(i);
    // the camera follows the leader, only ever forward
    float lead = -1e9f;
    for (auto& r : racers_)
      if (r.s.mode != DONE) lead = std::max(lead, r.s.x);
    if (lead < -1e8f) lead = COURSE_LEN + 200;
    float target = clampf(lead - LEAD_X, 0, CAM_MAX);
    if (target > camX_) camX_ += (target - camX_) * (1 - std::exp(-5 * dt));
    // stragglers who fall behind the picture are zipped back into it
    for (auto& r : racers_)
      if (r.s.mode != DONE && r.s.mode != ZIP && r.s.x < camX_ + CATCH_X) {
        catchUp(r.s, camX_ + 300);
        r.shoot = 0;
      }
    if (finished_ >= count()) endT_ += dt;
    hint_ = firstAnchorAfter(course_, camX_ - 500, hint_);
    for (auto& w : words_) w.t += ms;
    std::erase_if(words_, [](const Word& w) { return w.t > w.hold + 250; });
    for (auto& w : waves_) w.t += ms;
    std::erase_if(waves_, [](const Wave& w) { return w.t >= w.dur; });
  }

  void swingFx(int i) {
    Racer& r = racers_[i];
    const SwingEvents& e = r.ev;
    const Swinger& s = r.s;
    if (e.attach) {
      r.shoot = 0;
      const Anchor& a = course_[e.attach - 1];
      wave(a.x, a.y, 8, 40, 260, col::white);
      app.audio.sfx("dash", 0.3f);
    }
    if (e.release != R_NONE) {
      if (e.release == PERFECT) {
        word("PERFECT!", s.x, s.y - 120, isCpu(i) ? 18 : 24, Color::hex(0x8fe6ff), isCpu(i) ? 300 : 380);
        wave(s.x, s.y, 10, 100, 320, color(i));
        r.flip = 2 * PI;
      } else if (!isCpu(i) && e.release == GOOD) word("GOOD", s.x, s.y - 120, 20, Color::hex(0xc8f6ff), 300);
      else if (!isCpu(i) && (e.release == EARLY || e.release == LATE)) word(e.release == EARLY ? "EARLY" : "LATE", s.x, s.y - 120, 18, Color::hex(0x9aa6bd), 300);
      if (s.chain == 5 || s.chain == 10 || (s.chain > 10 && s.chain % 10 == 0))
        word(s.chain >= 10 ? "x10 CHAIN!" : "x5 CHAIN!", s.x, s.y - 190, 22, Color::hex(0xffe08a), 520);
    }
    if (e.down) {
      word("WHOOPS!", s.x, s.y - 150, 24, Color::hex(0xff8a5c), 520);
      wave(s.x, SW::STREET_Y, 10, 70, 360, Color(255, 240, 220));
      app.audio.sfx("bump", 0.6f);
    }
    if (e.zipped) r.shoot = 0;
  }

  // Crossing the finish: a place call-out, and a last fling up onto the tower roof.
  void finish(int i) {
    Racer& r = racers_[i];
    finished_++;
    r.place = finished_;
    float floor = SW::FINISH_ROOF_Y - SW::BODY;
    float rise = std::max(90.0f, r.s.y - floor + 90);
    r.s.vy = std::min(r.s.vy, -std::sqrt(2 * SW::GRAV * 0.8f * rise));
    r.s.vx = std::max(260.0f, r.s.vx * 0.6f);
    r.finishedAt = time_ * 1000;
    const char* w[4] = {"1ST!", "2ND!", "3RD!", "4TH!"};
    const unsigned cols[4] = {0xffbf2a, 0xc3cfdc, 0xe0965a, 0xd6dde8};
    word(w[std::min(3, r.place - 1)], r.s.x + 160, SW::FINISH_ROOF_Y - 220, 40, Color::hex(cols[std::min(3, r.place - 1)]), 900);
    app.audio.sfx("coin");
  }

  void landOnFinish(Racer& r, float ms) {
    if (r.landed) return;
    Swinger& s = r.s;
    float sec = ms / 1000;
    float spot = COURSE_LEN + 140 + (r.place - 1) * 105;
    s.vx += (std::max(120.0f, (spot - s.x) * 3) - s.vx) * (1 - std::exp(-4 * sec));
    s.vy += SW::GRAV * 0.8f * sec;
    s.x += s.vx * sec;
    s.y += s.vy * sec;
    float floor = SW::FINISH_ROOF_Y - SW::BODY;
    if (s.y >= floor && s.vy > 0) {
      s.y = floor;
      r.landed = true;
      r.tilt = r.flip = 0;
      r.landAnim = r.place == 1 ? "victory" : "celebrate";
      r.animT = 0;
    }
    syncRacer(r, sec);
  }

  void syncRacer(Racer& r, float sec) {
    const Swinger& s = r.s;
    float tilt = 0;
    if (s.mode == SWING) {
      const Anchor& a = course_[s.anchor];
      tilt = std::atan2(a.x - s.x, s.y - a.y);
    } else if (s.mode == AIR || s.mode == DONE) {
      tilt = clampf(std::atan2(s.vy, std::fabs(s.vx) + 1) * 0.5f, -0.5f, 0.7f) * (s.vx >= 0 ? 1 : -1);
    }
    if (r.flip > 0 && s.mode != SWING) r.flip = std::max(0.0f, r.flip - sec * 11);
    else if (s.mode == SWING) r.flip = 0;
    r.tilt += (tilt - r.tilt) * (1 - std::exp(-14 * sec));
    r.shoot = std::min(1.0f, r.shoot + sec * 14);
  }

  void word(const std::string& text, float x, float y, int size, Color c, float hold) { words_.push_back(Word{text, x, y, 0, hold, size, c}); }
  void wave(float x, float y, float r0, float r1, float dur, Color c) { waves_.push_back(Wave{x, y, r0, r1, 0, dur, c}); }

  // --- Drawing --------------------------------------------------------------------------------------
  float sx(float x) const { return (x - camX_) * S; }

  void drawTower(Tex* t, const TowerArt& art, float ax, float ay, bool flip, Color tint) const {
    const float kx = t->w / 1476.0f, ky = t->h / 1648.0f;
    SDL_Rect src{(int)std::lround(art.x * kx), (int)std::lround(art.y * ky), (int)std::lround(art.w * kx), (int)std::lround(art.h * ky)};
    float x0 = ax - (flip ? art.w - art.ax : art.ax);
    float left = sx(x0);
    if (left > VW || left + art.w * S < 0) return;
    app.gfx.sprite(t, src, left, (ay - art.ay) * S, art.w * S / src.w, art.h * S / src.h, 0, 0, 0, flip, tint);
  }

  // A row of flat-roofed buildings whose roof line sits at roofY from x0 to x1 (start roof, finish tower).
  void roofRow(Tex* t, float x0, float x1, float roofY) const {
    float x = x0;
    int k = 0;
    while (x < x1) {
      const TowerArt& art = ARTS[k % 2];
      drawTower(t, art, x + art.ax, roofY, false, col::white);
      x += art.w - 14;
      k++;
    }
  }

  void draw() override {
    // sunset sky (sampled from the arena card), drifting clouds and the far skyline
    static const unsigned SKY[] = {0x3d3b7a, 0x514186, 0x624794, 0x764e9a, 0x94569d, 0xb5619e, 0xd36e90, 0xf17d7b, 0xf8936e, 0xfaa66a};
    const int bands = 30;
    for (int b = 0; b < bands; b++) {
      float u = b / (float)(bands - 1) * 9;
      int k = std::min(8, (int)u);
      app.gfx.rect(0, b * 12.0f, VW, 13, Color::hex(SKY[k]).mix(Color::hex(SKY[k + 1]), u - k));
    }
    float cloudOff = std::fmod(camX_ * 0.06f * S + time_ * 4, (float)VW);
    for (int c = 0; c < 6; c++) {
      float cx = std::fmod(c * 190.0f + 60 - cloudOff + VW * 2, (float)VW + 200) - 100, cy = 40.0f + (c * 37) % 90;
      Color cc = Color(255, 196, 196, 110);
      app.gfx.ellipse(cx, cy, 70, 9, cc);
      app.gfx.ellipse(cx + 25, cy - 5, 40, 7, cc);
    }
    float farOff = std::fmod(camX_ * BACK_K, 1920 * 2);
    for (auto& f : far_) {
      float x = f.x - farOff;
      if (x + f.w < 0) x += 1920 * 2;
      if (x > 1920) continue;
      app.gfx.rect(x * S, f.top * S, f.w * S, (STREET_TOP + 40 - f.top) * S, Color(126, 74, 110, 255));
    }
    // the course's buildings, the start roof and the finish tower
    Tex* towers = app.gfx.tex("mg/heroes_towers.png");
    float x0 = camX_ - 500, x1 = camX_ + 1920 + 500;
    for (int parity = 0; parity < 2; parity++)
      for (int i = hint_; i < (int)course_.size() && course_[i].x <= x1; i++) {
        const Anchor& a = course_[i];
        if (a.x < x0 || i % 2 != parity) continue;
        const TowerArt& art = ARTS[a.kind * 2 + i % 2];
        bool flip = a.kind == CORNICE && i % 2 == 1;
        drawTower(towers, art, a.x, a.y, flip, i % 2 ? Color(216, 220, 240) : col::white);
      }
    if (camX_ < SW::ROOF_END + 400) roofRow(towers, -700, SW::ROOF_END - 40, SW::ROOF_Y);
    if (camX_ + 1920 > COURSE_LEN - 100) drawFinish(towers);
    // anchor hooks: a pulsing glow with a white ring
    float pulse = 0.75f + 0.25f * std::sin(time_ * 1000 / 260);
    for (int i = hint_; i < (int)course_.size() && course_[i].x <= x1; i++) {
      const Anchor& a = course_[i];
      float x = sx(a.x), y = a.y * S;
      if (x < -20 || x > VW + 20) continue;
      app.gfx.circle(x, y, 11 * (0.85f * pulse + 0.2f), Color(200, 246, 255, 90));
      app.gfx.circle(x, y, 3, col::white);
      app.gfx.ring(x, y, 5.5f, col::white);
    }
    // the street strip
    Tex* street = app.gfx.tex("mg/heroes_street.png");
    float so = -std::fmod(camX_, 1920.0f) * S;
    app.gfx.image(street, so, STREET_TOP * S, VW + 1, 300 * S);
    app.gfx.image(street, so + VW, STREET_TOP * S, VW + 1, 300 * S);
    // for people: a ring in their colour on the anchor their web would catch right now
    for (int i = 0; i < count(); i++) {
      const Racer& r = racers_[i];
      if (isCpu(i) || (r.s.mode != AIR && r.s.mode != ROOF)) continue;
      int aim = pickAnchor(course_, r.s.x, r.s.y, hint_);
      if (aim < 0) continue;
      const Anchor& a = course_[aim];
      float p = 0.5f + 0.5f * std::sin(time_ * 1000 / 140);
      app.gfx.line(sx(r.s.x), (r.s.y - HAND) * S, sx(a.x), a.y * S, 1.5f, color(i).alpha(0.35f));
      app.gfx.ring(sx(a.x), a.y * S, (30 + p * 5) * S, color(i));
    }
    // webs: from each swinger's hands to their anchor (shooting out as they fire), and zip lines
    for (int i = 0; i < count(); i++) {
      const Racer& r = racers_[i];
      const Swinger& s = r.s;
      float tx, ty;
      if (s.mode == SWING && s.anchor >= 0) {
        tx = course_[s.anchor].x;
        ty = course_[s.anchor].y;
      } else if (s.mode == ZIP) {
        tx = s.zipX + s.zipDX + 60;
        ty = 140;
      } else continue;
      float hx = s.x + std::sin(r.tilt) * HAND, hy = s.y - std::cos(r.tilt) * HAND;
      float ex = hx + (tx - hx) * r.shoot, ey = hy + (ty - hy) * r.shoot;
      app.gfx.line(sx(hx), hy * S + 1, sx(ex), ey * S + 1, 3, Color(13, 24, 48, 70));
      app.gfx.line(sx(hx), hy * S, sx(ex), ey * S, 2, col::white);
      app.gfx.line(sx(hx), hy * S, sx(ex), ey * S, 1, color(i));
    }
    // the racers
    for (int i = 0; i < count(); i++) drawRacer(i);
    for (auto& w : waves_) {
      float u = w.t / w.dur;
      app.gfx.ring(sx(w.x), w.y * S, lerpf(w.r0, w.r1, easeOut(u)) * S, w.c.alpha(0.9f * (1 - u)));
    }
    for (auto& w : words_) {
      float pop = std::min(1.0f, w.t / 160);
      float a = w.t > w.hold ? std::max(0.0f, 1 - (w.t - w.hold) / 250) : 1;
      app.gfx.text(w.text, sx(w.x), w.y * S - w.t * 0.018f, w.size, w.c.alpha(a), CENTER, true, 0.6f + 0.4f * easeBack(pop));
    }
    drawBar();
    drawTimer(DURATION - time_);
    std::vector<int> pct;
    for (auto& r : racers_) pct.push_back(r.place ? 100 : std::max(0, std::min(99, (int)(r.s.x / COURSE_LEN * 100))));
    drawScores(pct, "%");
  }

  void drawFinish(Tex* towers) const {
    const float x0 = COURSE_LEN, top = SW::FINISH_ROOF_Y;
    roofRow(towers, x0 - 6, x0 + 1100, top);
    for (int r = 0; r < 10; r++)
      for (int c = 0; c < 2; c++) app.gfx.rect(sx(x0 + 8 + c * 22), (top + 10 + r * 22) * S, 22 * S + 0.5f, 22 * S + 0.5f, (r + c) % 2 ? Color::hex(0x1d1d26) : Color::hex(0xfafafa));
    app.gfx.rect(sx(x0 + 60), (top - 150) * S, 10 * S, 150 * S, col::gold);
    app.gfx.rect(sx(x0 + 520), (top - 150) * S, 10 * S, 150 * S, col::gold);
    app.gfx.rect(sx(x0 + 64), (top - 110) * S, 460 * S, 8 * S, Color::hex(0xff6b5e));
    app.gfx.text("FINISH", sx(x0 + 295), (top - 150) * S - 6, 20, col::white, CENTER);
  }

  void drawRacer(int i) {
    const Racer& r = racers_[i];
    const Swinger& s = r.s;
    int c = player(i).character;
    float x = sx(s.x), y = s.y * S;
    if (x < -40 || x > VW + 40) return;
    if (r.landed) {
      spr::shadow(x, SW::FINISH_ROOF_Y * S, 40, 0.3f);
      spr::character(c, r.landAnim, r.animT, x, (s.y + SW::BODY) * S, CHAR_SCALE, false);
      drawPlayerTag(i, x, y + MARK * S - 4);
      return;
    }
    const char* anim = "idle";
    int frame = -1;
    switch (s.mode) {
      case ROOF:
        anim = std::fabs(s.vx) > 60 ? "run" : "idle";
        break;
      case SWING:
        anim = "jump";
        frame = 2;
        break;
      case AIR:
      case DONE:
        if (s.vy < -80) {
          anim = "jump";
          frame = 1;
        } else if (s.vy > 520) {
          anim = "fall";
          frame = 0;
        } else {
          anim = "dash";
          frame = 0;
        }
        break;
      case DOWN:
        anim = "stunned";
        frame = 1;
        break;
      case ZIP:
        anim = "jump";
        frame = 0;
        break;
    }
    bool flip = s.mode == ROOF ? s.face < 0 : s.vx < -60;
    float rot = s.mode == ROOF ? 0 : r.tilt + (s.vx >= 0 ? 1 : -1) * r.flip;
    if (s.mode == ROOF) spr::shadow(x, SW::ROOF_Y * S, 40, 0.3f);
    characterRot(c, anim, frame, r.animT, x, y, CHAR_SCALE, flip, rot, SW::BODY * S);
    drawPlayerTag(i, x, y + MARK * S - 4);
  }

  // The race bar under the timer: everyone's marker by how far along the course they are.
  void drawBar() const {
    const float bx0 = 260, bx1 = 594, by = 62;
    app.gfx.panel(bx0 - 50, by - 11, bx1 - bx0 + 76, 22, Color(13, 20, 40, 170), 11);
    app.gfx.text("RACE", bx0 - 44, by - 8, 13, Color::hex(0xe8d9b8), LEFT, false);
    app.gfx.rect(bx0, by - 1.5f, bx1 - bx0, 3, Color(255, 255, 255, 120));
    app.gfx.rect(bx1 - 2, by - 7, 4, 14, col::gold);
    std::vector<int> order;
    for (int i = 0; i < count(); i++) order.push_back(i);
    std::sort(order.begin(), order.end(), [&](int a, int b) { return racers_[a].s.x < racers_[b].s.x; });
    float prev = -1e9f;
    int level = 0;
    const float stack[4] = {0, -6, 6, -12};
    for (int i : order) {
      float f = clampf(racers_[i].s.x / COURSE_LEN, 0, 1);
      float px = bx0 + f * (bx1 - bx0);
      level = px - prev < 10 ? std::min(3, level + 1) : 0;
      prev = px;
      float my = by + stack[level];
      app.gfx.circle(px, my, 6.5f, col::white);
      app.gfx.circle(px, my, 5, color(i));
      if (racers_[i].place) app.gfx.circle(px + 5, my - 6, 2.5f, Color::hex(0xffd86a));
    }
  }

  bool finished() const override { return time_ >= DURATION || endT_ >= 1.2f; }

  std::vector<int> scores() const override {
    std::vector<int> sc;
    for (auto& r : racers_) sc.push_back(r.place ? 100000 - (int)r.finishedAt : std::max(0, (int)std::lround(r.s.x)));
    return sc;
  }

  std::string scoreLabel(int i) const override {
    const Racer& r = racers_[i];
    if (r.place) return fmt("%.1f s", r.finishedAt / 1000);
    // two racers whose rounded share of the way would read the same get a decimal
    int pct = std::max(0, std::min(99, (int)(r.s.x / COURSE_LEN * 100)));
    for (int j = 0; j < count(); j++) {
      const Racer& o = racers_[j];
      if (j != i && !o.place && (int)std::lround(o.s.x) != (int)std::lround(r.s.x) && std::max(0, std::min(99, (int)(o.s.x / COURSE_LEN * 100))) == pct)
        return fmt("%.1f%% of the way", std::max(0.0f, std::min(99.9f, r.s.x / COURSE_LEN * 100)));
    }
    return std::to_string(pct) + "% of the way";
  }

 private:
  struct Far {
    float x, w, top;
  };
  std::vector<Anchor> course_;
  std::vector<Racer> racers_;
  std::vector<Far> far_;
  std::vector<Word> words_;
  std::vector<Wave> waves_;
  float time_ = 0, camX_ = 0, endT_ = 0;
  int finished_ = 0, hint_ = 0;
};

}  // namespace

REGISTER_MINIGAME("web-swing", WebSwing);

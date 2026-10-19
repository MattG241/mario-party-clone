// Coffee Rush (Showtime): a pastel café counter. Hold A to pull an espresso shot and let go on the
// gold fill line, then tap A as the milk swirl passes the pink heart for latte art. Customers wait at
// the counter (the ring round their order bubble is their patience); serve them before they give
// up. A coffee is worth 3, +1 for a perfect shot, +1 for perfect art; the last 10 seconds are rush
// hour, worth double. Most points after 50 seconds wins.
#include <SDL.h>
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
constexpr float DURATION = 50, RUSH_AT = 40;
constexpr float COUNTER_TOP_Y = 579 * S, COUNTER_EDGE_Y = 598 * S, BARISTA_Y = 270, CUSTOMER_Y = 770 * S;
constexpr int COUNTER_ROW0 = 249, COUNTER_ROW1 = 308;  // the counter in the arena image, redrawn over the baristas
constexpr float GAPS[3] = {680 * S, 560 * S, 450 * S};
constexpr float MACHINE_DX = -112 * S, BARISTA_DX = 40 * S, CUSTOMER_DX = 70 * S, BUBBLE_DX = 70 * S, BUBBLE_DY = -178 * S;
constexpr float SPOUT_DX = -5 * S, SPOUT_DY = -21 * S, TRAY_DX = -5 * S, TRAY_DY = 3 * S;
constexpr float BARISTA_SCALE = 1.6f, CUSTOMER_SCALE = 1.1f, CS = S * 1.25f;  // cup px -> canvas px
// The gauge panel, a little bigger than the web's for the TV (PS: panel px -> canvas px).
constexpr float PS = S * 1.2f, PANEL_Y = 104, PANEL_W = 176, PANEL_H = 214;
constexpr float MUG_X0 = -40, MUG_X1 = 40, MUG_TOP = -66, MUG_BOTTOM = 70, ORBIT_R = 42;
// Grading: how close to the fill line (share of the cup) and to the heart (degrees).
constexpr float SHOT_PERFECT = 0.045f, SHOT_GOOD = 0.11f, SWIRL_PERFECT = 13, SWIRL_GOOD = 32;
constexpr float SWIRL_LAPS = 2, SWIRL_GRACE = 0.22f;

struct Skill {
  float reaction, mistake, aimNoise;
};
constexpr Skill SKILLS[3] = {{0.52f, 0.24f, 0.55f}, {0.30f, 0.11f, 0.28f}, {0.17f, 0.05f, 0.13f}};

enum Shot { PERFECT, GOOD, WEAK, OVER, SPILL };
enum Swirl { S_PERFECT, S_GOOD, S_MESSY, S_NONE };
enum CupState { REFILL, READY, POURING, GRADED, DUMP, SWIRLING, ART, SLIDE, WAIT_CUSTOMER, HANDOFF };
enum CustState { WALKIN, WAITING, HAPPY, LEAVING };

float lerpc(float a, float b, float t) { return a + (b - a) * clampf(t, 0, 1); }
float patienceFor(float e) { return lerpc(11.5f, 7.5f, e / DURATION); }
float pourRate(float e) { return 1 / lerpc(1.7f, 1.35f, e / DURATION); }  // share of the cup per second
float swirlPeriod(float e) { return lerpc(1.15f, 0.86f, e / DURATION); }
float angleDiff(float a, float b) {
  float d = std::fmod(std::fmod(a - b, 360.0f) + 360.0f, 360.0f);
  return d > 180 ? 360 - d : d;
}
Shot gradeShot(float level, float target) {
  if (level >= 1) return SPILL;
  float d = level - target;
  if (std::fabs(d) <= SHOT_PERFECT + 1e-6f) return PERFECT;
  if (std::fabs(d) <= SHOT_GOOD + 1e-6f) return GOOD;
  return d < 0 ? WEAK : OVER;
}
Swirl gradeSwirl(float dot, float heart) {
  float d = angleDiff(dot, heart);
  return d <= SWIRL_PERFECT ? S_PERFECT : (d <= SWIRL_GOOD ? S_GOOD : S_MESSY);
}
// Serving counts most: 3, +1 for a perfect shot, +1 for perfect latte art, double in rush hour.
int coffeePoints(Shot shot, Swirl swirl, bool rush) {
  int pts = 3 + (shot == PERFECT ? 1 : 0) + (swirl == S_PERFECT ? 1 : 0);
  return rush ? pts * 2 : pts;
}

void arc(float cx, float cy, float r, float a0, float a1, float w, Color c, int segs) {
  float step = (a1 - a0) / segs;
  for (int k = 0; k < segs; k++) {
    float t0 = a0 + k * step, t1 = t0 + step;
    app.gfx.line(cx + std::cos(t0) * r, cy + std::sin(t0) * r, cx + std::cos(t1) * r, cy + std::sin(t1) * r, w, c);
  }
}
void heart(float x, float y, float s, Color c) {
  app.gfx.circle(x - s * 0.48f, y - s * 0.25f, s * 0.55f, c);
  app.gfx.circle(x + s * 0.48f, y - s * 0.25f, s * 0.55f, c);
  app.gfx.line(x - s * 0.88f, y - s * 0.05f, x, y + s * 0.95f, s * 0.75f, c);
  app.gfx.line(x + s * 0.88f, y - s * 0.05f, x, y + s * 0.95f, s * 0.75f, c);
}

struct Customer {
  bool active = false;
  int cast = 0;
  CustState state = WALKIN;
  float t = 0, dur = 0, patience = 1, patienceMax = 1, fromX = 0, x = 0, y = 0, bubbleT = 0;
  bool impatient = false, angry = false;
};

struct Station {
  float x = 0, px = 0;
  CupState state = REFILL;
  float t = 0, level = 0, target = 0.6f, tilt = 0;
  Shot shot = GOOD;
  Swirl swirl = S_NONE;
  float swirlAng = 0, heartAng = 0, swirlT = 0, period = 1.15f;
  int band = 0;
  float slideT = 0, cupX = 0, cupY = 0;
  Customer cu;
  float nextCustomer = 0;
  int served = 0, cupsMade = 0, swirlsMade = 0, score = 0;
  // CPU
  float cpuWait = 0, cpuRelease = 0, cpuTapAt = 0;
  bool cpuPlanned = false;
  // barista
  const char* anim = "wave";
  float animT = 0;
  bool faceLeft = false;
};

struct Pop {
  std::string text;
  float x, y, t, life;
  Color c;
};

class CoffeeRush : public Minigame {
 public:
  ~CoffeeRush() override {
    if (keyed_.t) SDL_DestroyTexture(keyed_.t);
  }

  void start() override {
    keyWindows();
    int n = count();
    float gap = GAPS[std::max(0, std::min(2, n - 2))];
    for (int i = 0; i < n; i++) {
      Station s;
      s.x = VW / 2.0f + (i - (n - 1) / 2.0f) * gap;
      s.px = s.x + (MACHINE_DX + BARISTA_DX) / 2;
      s.nextCustomer = 0.25f + i * 0.22f;
      s.animT = i * 0.3f;
      st_.push_back(s);
      newCup(st_.back(), true);
    }
  }

  void update(float dt) override {
    time_ += dt;
    vis_ += dt;
    if (!rush_ && time_ >= RUSH_AT) {
      rush_ = true;
      app.audio.sfx("cheer", 0.5f);
    }
    for (int i = 0; i < count(); i++) {
      Station& s = st_[i];
      s.animT += dt;
      if (s.animT > 1.0f && s.state != POURING && s.state != SWIRLING && s.anim[0] != 'i') anim(s, "idle");  // one-shot reactions end
      bool pressed = false, held = false;
      if (isCpu(i)) cpuThink(i, dt, pressed, held);
      else {
        pressed = pad(i).press(B_A);
        held = pad(i).down(B_A);
      }
      s.t -= dt;
      switch (s.state) {
        case REFILL:
          if (s.t <= 0) s.state = READY;
          break;
        case READY:
          if (pressed) {
            s.state = POURING;
            s.t = 0;
            s.faceLeft = true;
            anim(s, "dial");
            app.audio.sfx("whoosh", 0.25f);
          }
          break;
        case POURING: {
          if (!held) {
            release(i);
            break;
          }
          s.level += dt * pourRate(time_);
          float d = std::fabs(s.level - s.target);
          int band = d <= SHOT_PERFECT ? 2 : (d <= SHOT_GOOD ? 1 : 0);
          if (band > s.band) app.audio.sfx("tick", 0.35f);
          s.band = band;
          if (s.level >= 1) {
            s.level = 1;
            release(i);
          }
          break;
        }
        case GRADED:
          if (s.t <= 0) startSwirl(s);
          break;
        case DUMP:
          s.tilt = std::min(1.0f, s.tilt + dt / 0.26f);
          if (s.t <= 0) {
            anim(s, "idle");
            newCup(s);
          }
          break;
        case SWIRLING:
          if (s.swirlT > SWIRL_GRACE && pressed) {
            tapSwirl(i, false);
            break;
          }
          s.swirlT += dt;
          s.swirlAng = std::fmod(s.swirlAng + dt / s.period * 360, 360.0f);
          if (s.swirlT > s.period * SWIRL_LAPS + SWIRL_GRACE) tapSwirl(i, true);  // gave up: a messy pour
          break;
        case ART:
          if (s.t <= 0) {
            s.state = SLIDE;
            s.slideT = 0;
            s.faceLeft = false;
            anim(s, "throw");
            app.audio.sfx("whoosh", 0.3f);
          }
          break;
        case SLIDE:
          s.slideT += dt;
          if (s.slideT >= 0.36f) s.state = WAIT_CUSTOMER;
          break;
        case HANDOFF:
          if (s.t <= 0) newCup(s);
          break;
        case WAIT_CUSTOMER: break;
      }
      updateCustomer(i, dt);
    }
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t > p.life; });
  }

  void draw() override {
    Tex* arena = keyed_.t ? &keyed_ : app.gfx.tex(def() && def()->arena[0] ? def()->arena : "mg/arena_coffee-rush.png");
    if (keyed_.t) app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
    app.gfx.image(arena, 0, 0, VW, VH);
    for (int i = 0; i < count(); i++) {
      const Station& s = st_[i];
      spr::character(player(i).character, s.anim, s.animT, s.x + BARISTA_DX, BARISTA_Y, BARISTA_SCALE, s.faceLeft);
    }
    // the counter hides the baristas' legs
    SDL_Rect counter{0, COUNTER_ROW0, VW, COUNTER_ROW1 - COUNTER_ROW0};
    app.gfx.sprite(arena, counter, 0, (float)COUNTER_ROW0, 1, 1, 0, 0);
    Tex* machine = app.gfx.tex("mg/showtime_espresso.png");
    for (int i = 0; i < count(); i++) {
      const Station& s = st_[i];
      float mx = s.x + MACHINE_DX;
      app.gfx.ellipse(mx, COUNTER_TOP_Y + 3, 30, 5, Color(0, 0, 0, 60));
      SDL_Rect src{0, 0, machine->w, machine->h};
      app.gfx.sprite(machine, src, mx, COUNTER_TOP_Y, 1, 1, 0.5f, 0.9f);
      drawCup(s);
      if (s.state == POURING) {  // the espresso stream
        float sx = mx + SPOUT_DX, sy = COUNTER_TOP_Y + SPOUT_DY, ey = s.cupY - 2 - s.level * 20 * CS;
        app.gfx.line(sx, sy, sx + std::sin(vis_ * 22) * 0.6f, ey, 2.5f, Color::hex(0x4a2a18));
      }
    }
    for (int i = 0; i < count(); i++) drawCustomer(i);
    for (int i = 0; i < count(); i++) {
      drawPanel(i);
    }
    for (auto& p : pops_) {
      float k = p.t / p.life;
      app.gfx.text(p.text, p.x, p.y - 22 * easeOut(k), 20, p.c.alpha(k < 0.7f ? 1 : (1 - k) / 0.3f), CENTER, true);
    }
    if (rush_ && time_ < RUSH_AT + 2.5f && std::fmod(time_, 0.4f) < 0.28f) app.gfx.text("RUSH HOUR! DOUBLE POINTS", VW / 2, 52, 24, col::coral, CENTER, true);
    drawTimer(DURATION - time_);
    drawScores(scores(), "pts");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> v;
    for (auto& s : st_) v.push_back(s.score);
    return v;
  }
  std::string scoreLabel(int i) const override {
    return std::to_string(st_[i].score) + " pts, " + std::to_string(st_[i].served) + (st_[i].served == 1 ? " coffee" : " coffees");
  }

 private:
  std::vector<Station> st_;
  std::vector<Pop> pops_;
  Tex keyed_;
  float time_ = 0, vis_ = 0;

  // The café's windows were rendered black (the sky went behind them): once, at load, clear the
  // black inside them so the sky shows through. Never per frame.
  void keyWindows() {
    SDL_Surface* raw = IMG_Load(app.path("mg/arena_coffee-rush.jpg").c_str());
    if (!raw) raw = IMG_Load(app.path("mg/arena_coffee-rush.png").c_str());
    if (!raw) return;
    SDL_Surface* sf = SDL_ConvertSurfaceFormat(raw, SDL_PIXELFORMAT_RGBA32, 0);
    SDL_FreeSurface(raw);
    if (!sf) return;
    SDL_LockSurface(sf);
    const int w = sf->w, h = std::min(sf->h, 220);
    unsigned char* px = (unsigned char*)sf->pixels;
    auto at = [&](int x, int y) { return px + y * sf->pitch + x * 4; };
    auto lum = [&](int x, int y) {
      unsigned char* p = at(x, y);
      return std::max({p[0], p[1], p[2]});
    };
    std::vector<int> stack;
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++)
        if (lum(x, y) < 10) stack.push_back(y * w + x);
    while (!stack.empty()) {
      int v = stack.back();
      stack.pop_back();
      int x = v % w, y = v / w;
      if (at(x, y)[3] == 0 || lum(x, y) >= 44) continue;
      at(x, y)[3] = 0;
      if (x > 0) stack.push_back(v - 1);
      if (x < w - 1) stack.push_back(v + 1);
      if (y > 0) stack.push_back(v - w);
      if (y < h - 1) stack.push_back(v + w);
    }
    SDL_UnlockSurface(sf);
    keyed_.t = SDL_CreateTextureFromSurface(app.gfx.renderer(), sf);
    keyed_.w = sf->w;
    keyed_.h = sf->h;
    SDL_FreeSurface(sf);
    if (keyed_.t) SDL_SetTextureBlendMode(keyed_.t, SDL_BLENDMODE_BLEND);
  }
  bool rush_ = false;

  static void anim(Station& s, const char* a) {
    s.anim = a;
    s.animT = 0;
  }
  void pop(const std::string& t, float x, float y, Color c, float life = 0.6f) {
    if (pops_.size() >= 16) pops_.erase(pops_.begin());
    pops_.push_back({t, x, y, 0, life, c});
  }
  float gauss() { return ((float)(rng.next() + rng.next() + rng.next() + rng.next()) - 2) * 1.73f; }
  float wordY() const { return PANEL_Y - PANEL_H * PS / 2 - 4; }

  void newCup(Station& s, bool first = false) {
    s.state = REFILL;
    s.t = first ? 0 : 0.32f;
    s.level = 0;
    s.swirl = S_NONE;
    s.band = 0;
    s.tilt = 0;
    s.target = std::round(rng.frange(0.42f, 0.86f) * 100) / 100;
    s.cupX = s.x + MACHINE_DX + TRAY_DX;
    s.cupY = COUNTER_TOP_Y + TRAY_DY;
    s.cpuPlanned = false;
  }

  void release(int i) {
    Station& s = st_[i];
    Shot g = gradeShot(s.level, s.target);
    s.shot = g;
    bool ok = g == PERFECT || g == GOOD;
    s.state = ok ? GRADED : DUMP;
    s.t = g == SPILL ? 0.95f : (ok ? 0.38f : 0.7f);
    s.cupsMade++;
    s.faceLeft = false;
    float wx = s.px, wy = wordY();
    switch (g) {
      case PERFECT:
        pop("PERFECT SHOT!", wx, wy, Color::hex(0xffbf2a));
        app.audio.sfx("coin", 0.5f);
        anim(s, "celebrate");
        break;
      case GOOD:
        pop("GOOD", wx, wy, Color::hex(0xaeefff));
        app.audio.sfx("pop", 0.4f);
        anim(s, "idle");
        break;
      case SPILL:
        pop("SPILL!", wx, wy, Color::hex(0xff6b5e));
        app.audio.sfx("splash", 0.45f);
        anim(s, "surprised");
        break;
      default:
        pop(g == WEAK ? "TOO WEAK" : "TOO STRONG", wx, wy, Color(200, 205, 214));
        app.audio.sfx("cancel", 0.3f);
        anim(s, "disappointed");
        break;
    }
  }

  void startSwirl(Station& s) {
    s.state = SWIRLING;
    s.heartAng = rng.frange(0, 360);
    s.swirlAng = std::fmod(s.heartAng + rng.frange(120, 240), 360.0f);  // always a wind-up
    s.swirlT = 0;
    s.period = swirlPeriod(time_);
    s.cpuPlanned = false;
    s.faceLeft = false;
    anim(s, "carry");
  }

  void tapSwirl(int i, bool autoMessy) {
    Station& s = st_[i];
    Swirl g = autoMessy ? S_MESSY : gradeSwirl(s.swirlAng, s.heartAng);
    s.swirl = g;
    s.state = ART;
    s.t = 0.44f;
    s.swirlsMade++;
    float wx = s.px, wy = wordY();
    if (g == S_PERFECT) {
      pop("LATTE ART!", wx, wy, Color::hex(0xff5fa8));
      app.audio.sfx("coin", 0.4f);
    } else if (g == S_GOOD) {
      pop("NICE!", wx, wy, Color::hex(0xaeefff));
      app.audio.sfx("pop", 0.35f);
    } else {
      pop("MESSY", wx, wy, Color(200, 205, 214));
      app.audio.sfx("cancel", 0.22f);
    }
  }

  // The customer takes their coffee: points, and a happy wiggle.
  void handOff(int i) {
    Station& s = st_[i];
    Customer& cu = s.cu;
    s.state = HANDOFF;
    s.t = 0.26f;
    Shot shot = s.shot == PERFECT ? PERFECT : GOOD;
    Swirl swirl = s.swirl == S_NONE ? S_MESSY : s.swirl;
    int pts = coffeePoints(shot, swirl, rush_);
    bool perfect = shot == PERFECT && swirl == S_PERFECT;
    s.served++;
    s.score += pts;
    cu.state = HAPPY;
    cu.t = 0.7f;
    app.audio.sfx("confirm", 0.5f);
    pop("+" + std::to_string(pts), cu.x, CUSTOMER_Y - 74, perfect ? col::gold : col::white, 0.8f);
    if (perfect) {
      pop("PERFECT BREW!", cu.x, CUSTOMER_Y - 100, Color::hex(0xff9f1a), 0.9f);
      anim(s, "celebrate");
    }
  }

  void updateCustomer(int i, float dt) {
    Station& s = st_[i];
    Customer& cu = s.cu;
    float x = s.x + CUSTOMER_DX;
    if (!cu.active) {
      s.nextCustomer -= dt;
      if (s.nextCustomer <= 0) {
        cu = Customer();
        cu.active = true;
        cu.cast = rng.range(0, 8);
        cu.fromX = x + (rng.chance(0.5) ? -1.0f : 1.0f) * 60 * S;
        cu.t = cu.dur = 0.62f;
        cu.patience = cu.patienceMax = patienceFor(time_);
        cu.x = cu.fromX;
        cu.y = VH + 60;
      }
      return;
    }
    cu.t -= dt;
    cu.bubbleT += dt;
    switch (cu.state) {
      case WALKIN: {
        float u = 1 - std::max(0.0f, cu.t) / cu.dur, e = 1 - (1 - u) * (1 - u);
        cu.x = cu.fromX + (x - cu.fromX) * e;
        cu.y = VH + 60 + (CUSTOMER_Y - VH - 60) * e - std::fabs(std::sin(u * PI * 3)) * 26 * S * (1 - u);
        if (cu.t <= 0) {
          cu.state = WAITING;
          cu.x = x;
          cu.y = CUSTOMER_Y;
          cu.bubbleT = 0;
          app.audio.sfx("pop", 0.25f);
        }
        break;
      }
      case WAITING:
        cu.patience -= dt * (rush_ ? 1.15f : 1.0f);
        if (!cu.impatient && cu.patience / cu.patienceMax < 0.35f) {
          cu.impatient = true;
          app.audio.sfx("warn", 0.35f);
        }
        cu.x = x + (cu.impatient ? std::sin(vis_ * 25) * 3 * S : 0);
        if (s.state == WAIT_CUSTOMER) handOff(i);
        else if (cu.patience <= 0) {  // too slow: they storm off
          cu.state = LEAVING;
          cu.angry = true;
          cu.t = cu.dur = 0.62f;
          pop("TOO SLOW...", cu.x, CUSTOMER_Y - 90, Color(200, 205, 214));
          app.audio.sfx("error", 0.35f);
          anim(s, "disappointed");
        }
        break;
      case HAPPY:
        if (cu.t <= 0) {
          cu.state = LEAVING;
          cu.t = cu.dur = 0.52f;
        }
        break;
      case LEAVING: {
        float u = 1 - std::max(0.0f, cu.t) / cu.dur;
        cu.x = x + (cu.angry ? -1.0f : 1.0f) * 40 * S * u;
        cu.y = CUSTOMER_Y + (VH + 70 - CUSTOMER_Y) * u * u;
        if (cu.t <= 0) {
          cu.active = false;
          s.nextCustomer = cu.angry ? 0.7f : 0.26f;
        }
        break;
      }
    }
  }

  void cpuThink(int i, float dt, bool& pressed, bool& held) {
    Station& s = st_[i];
    const Skill& sk = SKILLS[std::max(0, std::min(2, cpuLevel(i)))];
    if (s.state == READY) {
      if (!s.cpuPlanned) {
        s.cpuPlanned = true;
        s.cpuWait = sk.reaction * rng.frange(0.7f, 1.5f);
        s.cpuRelease = s.target + gauss() * (0.02f + sk.aimNoise * 0.1f);
        if (rng.chance(sk.mistake * 0.45f)) s.cpuRelease += (rng.chance(0.5) ? -1 : 1) * rng.frange(0.13f, 0.23f);
        s.cpuRelease = std::min(0.995f, s.cpuRelease);
      }
      s.cpuWait -= dt;
      if (s.cpuWait <= 0) pressed = held = true;
    } else if (s.state == POURING) {
      held = s.level + pourRate(time_) * dt * 0.5f < s.cpuRelease;
    } else if (s.state == SWIRLING) {
      if (!s.cpuPlanned) {
        s.cpuPlanned = true;
        float toHeart = std::fmod(std::fmod(s.heartAng - s.swirlAng, 360.0f) + 360.0f, 360.0f) / 360;
        float at = s.swirlT + toHeart * s.period;
        if (at < SWIRL_GRACE + 0.03f) at += s.period;
        s.cpuTapAt = at + gauss() * (0.014f + sk.aimNoise * 0.105f) + (rng.chance(sk.mistake * 0.5f) ? s.period * 0.3f : 0);
      }
      if (s.swirlT + dt * 0.5f >= s.cpuTapAt) pressed = true;
    }
  }

  // --- Drawing ---------------------------------------------------------------------------------
  void drawCup(const Station& s) const {
    float x = s.cupX, y = s.cupY, a = 1;
    if (s.state == SLIDE) {
      float k = std::min(1.0f, s.slideT / 0.36f);
      k = 1 - (1 - k) * (1 - k) * (1 - k);
      x = lerpf(s.cupX, s.x + CUSTOMER_DX, k);
      y = lerpf(s.cupY, COUNTER_EDGE_Y, k);
    } else if (s.state == WAIT_CUSTOMER) {
      x = s.x + CUSTOMER_DX;
      y = COUNTER_EDGE_Y;
    } else if (s.state == HANDOFF) {
      float k = 1 - std::max(0.0f, s.t) / 0.26f;
      x = lerpf(s.x + CUSTOMER_DX, s.cu.x, k);
      y = lerpf(COUNTER_EDGE_Y, CUSTOMER_Y - 70 * S, k);
      a = 1 - k;
    } else if (s.state == DUMP) {
      x += std::sin(vis_ * 50) * 1.5f * s.tilt;
      a = 1 - 0.6f * s.tilt;
    }
    if (a <= 0.02f) return;
    const float h = 24 * CS, w = 24 * CS;
    float lv = (s.state == ART || s.state == SLIDE || s.state == WAIT_CUSTOMER || s.state == HANDOFF) ? std::max(s.level, 0.5f) : s.level;
    if (s.state == DUMP) lv *= 1 - s.tilt;
    app.gfx.ellipse(x, y + 1, 15 * CS, 3.5f * CS, Color(0, 0, 0, (unsigned char)(46 * a)));
    app.gfx.ring(x + 13 * CS, y - h / 2, 5 * CS, col::white.alpha(0.8f * a));
    app.gfx.rect(x - w / 2, y - h, w, h, col::white.alpha(0.85f * a));
    app.gfx.rect(x - w / 2 + 2, y - h, w - 4, h - 2, Color(255, 240, 246, (unsigned char)(150 * a)));
    if (lv > 0) {
      float fh = std::min(1.0f, lv) * (h - 3);
      app.gfx.rect(x - w / 2 + 2, y - fh - 2, w - 4, fh, Color::hex(0x5a3521).alpha(a));
      app.gfx.rect(x - w / 2 + 2, y - fh - 2, w - 4, std::min(2.0f, fh), Color::hex(0xc98a4a).alpha(a));
      if (s.swirl != S_NONE) app.gfx.ellipse(x, y - fh, 6 * CS, 1.8f * CS, Color::hex(0xfff6ec).alpha(a));
    }
  }

  void drawCustomer(int i) const {
    const Station& s = st_[i];
    const Customer& cu = s.cu;
    if (!cu.active) return;
    int pose = cu.state == HAPPY ? 5 : (cu.state == WAITING ? (cu.impatient ? 4 : 3) : (cu.angry ? 4 : 0));
    spr::shadow(cu.x, std::min(cu.y, (float)VH), 40);
    spr::cast(cu.cast, pose, cu.x, cu.y, CUSTOMER_SCALE);
    if (cu.state != WAITING) return;
    // the order bubble and its patience ring: green, then amber, then red and throbbing
    float k = std::max(0.0f, cu.patience / cu.patienceMax);
    float bx = cu.x + BUBBLE_DX, by = CUSTOMER_Y + BUBBLE_DY;
    float grow = std::min(1.0f, cu.bubbleT / 0.22f), sc = 0.3f + 0.7f * easeBack(grow);
    float r = (44 + (k < 0.35f ? std::sin(vis_ * 14) * 2 : 0)) * S * sc;
    app.gfx.circle(bx - 9 * sc, by + 14 * sc, 4 * sc, col::white);
    app.gfx.circle(bx, by, 16 * sc, col::white);
    app.gfx.rect(bx - 6 * sc, by - 3 * sc, 12 * sc, 10 * sc, Color::hex(0xff8fb8));
    app.gfx.rect(bx - 6 * sc, by - 3 * sc, 12 * sc, 2.5f * sc, Color::hex(0x7a4a2c));
    app.gfx.ring(bx + 7 * sc, by + 1 * sc, 3 * sc, Color::hex(0xff8fb8));
    app.gfx.ring(bx, by, r + 1, Color(26, 15, 36, 140));
    Color c = k > 0.6f ? Color::hex(0x8bd346) : (k > 0.35f ? Color::hex(0xffb020) : Color::hex(0xff5a4a));
    if (k > 0) arc(bx, by, r, -PI / 2, -PI / 2 + k * PI * 2, 3.5f, c, std::max(1, (int)std::ceil(k * 18)));
  }

  void drawPanel(int i) const {
    const Station& s = st_[i];
    float x = s.px, y = PANEL_Y, w = PANEL_W * PS, h = PANEL_H * PS;
    Color c = color(i);
    app.gfx.panel(x - w / 2 + 2, y - h / 2 + 4, w, h, Color(10, 6, 20, 56), 12);
    app.gfx.panel(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4, c, 13);
    app.gfx.panel(x - w / 2, y - h / 2, w, h, Color(36, 20, 47, 235), 12);
    drawPlayerTag(i, x - w / 2 + 19, y - h / 2 + 13);
    CupState st = s.state;
    if (st == SWIRLING) drawSwirl(s, x, y + 4 * PS);
    else if (st == ART || st == SLIDE || st == WAIT_CUSTOMER || st == HANDOFF) drawArt(s, x, y + 4 * PS);
    else drawMug(s, x, y + 4 * PS);
    // humans get a reminder for their first couple of cups
    if (!isCpu(i) && ((st == READY && s.cupsMade < 2) || (st == SWIRLING && s.swirlsMade < 2))) {
      float hy = y + h / 2 + 6;
      app.gfx.panel(x - 38, hy, 76, 26, Color(26, 15, 36, 200), 13);
      ui::button(x - 22, hy + 13, B_A, 10);
      app.gfx.text(st == SWIRLING ? "TAP" : "HOLD", x + 10, hy + 4, 17, Color::hex(0xffe3a0), CENTER, false);
    }
  }

  void drawMug(const Station& s, float x, float y) const {
    auto X = [&](float lx) { return x + lx * PS; };
    auto LY = [&](float v) { return y + (MUG_BOTTOM - (MUG_BOTTOM - MUG_TOP) * v) * PS; };
    float gx = X(MUG_X0), gw = (MUG_X1 - MUG_X0) * PS, gTop = y + (MUG_TOP - 4) * PS, gBot = y + (MUG_BOTTOM + 6) * PS;
    // the handle, then the glass over it
    app.gfx.ring(X(MUG_X1 + 8), y + 4 * PS, 22 * PS, col::white.alpha(0.85f));
    app.gfx.panel(gx - 6 * PS - 2, gTop - 2, gw + 12 * PS + 4, gBot - gTop + 4, col::white.alpha(0.92f), 7);
    app.gfx.panel(gx - 6 * PS + 1, gTop + 1, gw + 12 * PS - 2, gBot - gTop - 2, Color(52, 34, 64), 6);
    float pulse = s.state == POURING && s.band > 0 ? 0.5f + 0.5f * std::sin(vis_ * 16) : 0;
    float t = s.target;
    app.gfx.rect(gx, LY(t + SHOT_GOOD), gw, (MUG_BOTTOM - MUG_TOP) * SHOT_GOOD * 2 * PS, Color(255, 210, 63, (unsigned char)(255 * (0.16f + 0.12f * pulse))));
    app.gfx.rect(gx, LY(t + SHOT_PERFECT), gw, (MUG_BOTTOM - MUG_TOP) * SHOT_PERFECT * 2 * PS, Color(255, 226, 122, (unsigned char)(255 * (0.32f + 0.2f * pulse))));
    float lv = std::min(1.0f, s.level);
    if (lv > 0) {
      float top = LY(lv), bot = y + MUG_BOTTOM * PS;
      app.gfx.rect(gx, top, gw, bot - top, Color::hex(0x5a3521));
      app.gfx.rect(gx, top, gw, std::min(4.0f, bot - top), Color::hex(0xc98a4a));
    }
    float ly = LY(t);
    app.gfx.line(gx - 2, ly, gx + gw + 2, ly, 2.5f, Color::hex(0xffe27a));
    app.gfx.line(gx - 11, ly - 5, gx - 4, ly, 3, Color::hex(0xffe27a));
    app.gfx.line(gx - 11, ly + 5, gx - 4, ly, 3, Color::hex(0xffe27a));
    app.gfx.line(gx + gw + 11, ly - 5, gx + gw + 4, ly, 3, Color::hex(0xffe27a));
    app.gfx.line(gx + gw + 11, ly + 5, gx + gw + 4, ly, 3, Color::hex(0xffe27a));
    if (s.state == POURING) {
      float wv = std::sin(vis_ * 25) * 0.8f;
      app.gfx.line(x + wv, y + (MUG_TOP - 22) * PS, x + wv * 0.5f, LY(lv), 4.5f, Color::hex(0x4a2a18));
    }
    app.gfx.rect(gx + 1, y + (MUG_TOP + 6) * PS, 3, (MUG_BOTTOM - MUG_TOP - 16) * PS, col::white.alpha(0.25f));
    if (s.state == DUMP || s.state == REFILL)
      app.gfx.panel(x - PANEL_W * PS / 2 + 2, PANEL_Y - PANEL_H * PS / 2 + 2, PANEL_W * PS - 4, PANEL_H * PS - 4, Color(36, 20, 47, 140), 11);
  }

  static void latte(float x, float y) {
    app.gfx.circle(x, y, 78 * PS, Color::hex(0xfff6ec));
    app.gfx.circle(x, y, 66 * PS, col::white);
    app.gfx.circle(x, y, 58 * PS, Color::hex(0xb87a4a));
  }

  void drawSwirl(const Station& s, float x, float y) const {
    latte(x, y);
    app.gfx.circle(x, y, 52 * PS, Color::hex(0x6a4028));
    float hr = s.heartAng * PI / 180, R = ORBIT_R * PS;
    float good = SWIRL_GOOD * PI / 180, perf = SWIRL_PERFECT * PI / 180;
    arc(x, y, R, hr - good, hr + good, 22 * PS, Color(255, 143, 192, 150), 6);
    arc(x, y, R, hr - perf, hr + perf, 22 * PS, Color(255, 208, 230, 245), 3);
    heart(x + std::cos(hr) * R, y + std::sin(hr) * R, 4, Color::hex(0xff5fa8));
    float a = s.swirlAng * PI / 180;
    arc(x, y, R, a - 1.0f, a, 9 * PS, col::white.alpha(0.4f), 4);
    app.gfx.circle(x + std::cos(a) * R, y + std::sin(a) * R, 13 * PS, Color::hex(0x6a4028));
    app.gfx.circle(x + std::cos(a) * R, y + std::sin(a) * R, 11 * PS, col::white);
  }

  void drawArt(const Station& s, float x, float y) const {
    latte(x, y);
    app.gfx.circle(x, y, 52 * PS, Color::hex(0x7a4a2c));
    Color milk = Color::hex(0xfff8f0);
    if (s.swirl == S_PERFECT) heart(x, y - 2, 34 * PS * 0.62f, milk);
    else if (s.swirl == S_GOOD) {
      app.gfx.circle(x, y, 26 * PS, milk);
      app.gfx.circle(x + 6 * PS, y - 4 * PS, 12 * PS, Color::hex(0x7a4a2c));
      app.gfx.circle(x + 6 * PS, y - 4 * PS, 6 * PS, milk);
    } else {
      app.gfx.circle(x - 14 * PS, y + 6 * PS, 14 * PS, milk);
      app.gfx.circle(x + 10 * PS, y - 8 * PS, 11 * PS, milk);
      app.gfx.circle(x + 16 * PS, y + 14 * PS, 8 * PS, milk);
    }
    app.gfx.line(x + 44 * PS, y + 54 * PS, x + 54 * PS, y + 66 * PS, 3, Color::hex(0x8bd346));
    app.gfx.line(x + 53 * PS, y + 66 * PS, x + 76 * PS, y + 40 * PS, 3, Color::hex(0x8bd346));
  }
};

}  // namespace

REGISTER_MINIGAME("coffee-rush", CoffeeRush);

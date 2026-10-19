// Patty Panic (SpongeBob, Cartoon Coast): an undersea diner. Every cook works through the same run of
// tickets; each shows a burger from the bottom bun up. Press each topping's button in order (X patty,
// A lettuce, B tomato, Y cheese) to stack it and serve the burger before the customer gives up. A
// wrong button topples the stack and it starts again from the bun. Most orders in 50 seconds wins.
//
// The D-pad / stick works too, in the face buttons' diamond (left X, down A, right B, up Y), so a bare
// Wii Remote (which has no Y) can still make cheese.
#include <SDL.h>

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
constexpr int MAX_LAYERS = 5, MENU_N = 48;
constexpr float COOK_FEET_Y = 372, FRONT_CUT = 355, PLATE_Y = 824 * S, TICKET_TOP = 126 * S, STATION_GAP = 450 * S;
constexpr float COOK_DX = -92 * S, PLATE_DX = 96 * S, COOK_SCALE = 1.5f;  // bigger and higher than the web so they read over the counter
constexpr float STACK_SCALE = 0.86f, SK = S * STACK_SCALE;  // web stack px -> canvas px
constexpr float TS = S * 1.05f;                              // ticket px -> canvas px (a touch bigger for the TV)
constexpr float TICKET_W = 262, PORTRAIT_Y = 64, PORTRAIT_R = 48, ROW_H = 42, TOPBUN_Y = PORTRAIT_Y + PORTRAIT_R + 26;
constexpr float TOPPLE_T = 0.65f;

enum Ing { PATTY, LETTUCE, TOMATO, CHEESE, BUN_BOTTOM, BUN_TOP };
constexpr Btn BUTTON_FOR[4] = {B_X, B_A, B_B, B_Y};
constexpr int DIR_FOR[4] = {0, 1, 2, 3};  // left, down, right, up: the face buttons' diamond
// How much each layer raises the stack (web px at stack scale 1).
constexpr float THICK[6] = {18, 9, 10, 7, 19, 0};
constexpr float PLATE_THICK = 6;
// Sprite atlas mg/toons_patty.png
constexpr SDL_Rect R_ING[6] = {{135, 69, 64, 31}, {203, 69, 68, 31}, {275, 69, 61, 18}, {73, 69, 58, 32}, {4, 69, 65, 32}, {276, 4, 66, 41}};
constexpr SDL_Rect R_PLATE{349, 4, 84, 37};
constexpr SDL_Rect R_CUSTOMER[4] = {{74, 4, 66, 59}, {4, 4, 66, 61}, {197, 4, 75, 46}, {144, 4, 49, 58}};  // fish narwhal turtle jelly

// CPU cooks: time per topping, chance a press goes wrong, time to read a new ticket (by difficulty).
struct CpuCook {
  float press, slip, read;
};
constexpr CpuCook CPU_COOK[3] = {{0.64f, 0.08f, 0.70f}, {0.42f, 0.035f, 0.48f}, {0.285f, 0.015f, 0.32f}};

int recipeLength(int k) { return k < 2 ? 2 : (k < 5 ? 3 : (k < 9 ? 4 : MAX_LAYERS)); }
// Customers wait less for small orders, and get less patient as the round goes on.
float patienceFor(int n, float elapsed) {
  float rush = clampf(elapsed / DURATION, 0, 1);
  return (5.6f + 1.5f * n) * (1 - 0.22f * rush);
}

Color mixc(Color a, Color b, float k) { return a.mix(b, clampf(k, 0, 1)); }

void chevron(float x, float y, int dir, float s, float w, Color c) {
  // dir: 0 left, 1 down, 2 right, 3 up; (x, y) is the tip
  float dx = dir == 0 ? 1.0f : (dir == 2 ? -1.0f : 0.0f), dy = dir == 3 ? 1.0f : (dir == 1 ? -1.0f : 0.0f);
  float px = -dy, py = dx;
  app.gfx.line(x, y, x + (dx + px) * s, y + (dy + py) * s, w, c);
  app.gfx.line(x, y, x + (dx - px) * s, y + (dy - py) * s, w, c);
}

void faceButton(float x, float y, Btn b, float r, float a = 1) {
  Color c = b == B_X ? Color::hex(0x8a5530) : (b == B_A ? Color::hex(0x4fae3a) : (b == B_B ? Color::hex(0xe0412f) : Color::hex(0xf0a818)));
  app.gfx.circle(x, y, r, col::white.alpha(a));
  app.gfx.circle(x, y, r - 1.8f, c.alpha(a));
  if (app.wii) {
    // a sideways Wii Remote adds toppings with the D-pad: show the direction instead of a button
    int k = 0;
    while (k < 3 && BUTTON_FOR[k] != b) k++;
    int dir = DIR_FOR[k];
    float o = r * 0.32f, tx = x + (dir == 0 ? -o : (dir == 2 ? o : 0)), ty = y + (dir == 3 ? -o : (dir == 1 ? o : 0));
    chevron(tx, ty, dir, r * 0.5f, std::max(2.0f, r * 0.26f), col::white.alpha(a));
    return;
  }
  const char* g = ui::glyph(b);
  int size = (int)(r * (g[1] ? 1.0f : 1.35f));
  app.gfx.text(g, x, y - size * 0.62f, size, col::white.alpha(a), CENTER, false);
}

enum State { COOKING, SERVING, TOPPLED, LEAVING };

struct Layer {
  int ing;
  float h;     // height of its base above the plate (web stack px)
  float t;     // seconds since it was added (toss / drop / land animation)
  bool toss;   // tossed from the cook's hand (else dropped from above)
  float tx, ty, ang;  // topple flight
};

struct Station {
  float x = 0;
  int k = 0, placed = 0, customer = 0, combo = 0;
  std::vector<int> recipe;
  float patience = 1, patienceMax = 1, busy = 0;
  State state = COOKING;
  float st = 0;          // seconds in this state
  bool topBun = false, served = false;
  std::vector<Layer> layers;
  float stackH = PLATE_THICK;
  float ticketT = 1;     // seconds since the ticket came down
  float cpuDelay = 0;
  const char* anim = "idle";
  float animT = 0, animHold = 0;
  bool armed = true;     // stick edge detection
  int score = 0;
};

struct Pop {
  std::string text;
  float x, y, t;
  Color c;
};

class PattyPanic : public Minigame {
 public:
  void start() override {
    // the menu: every cook's k-th order is the same burger, at least one patty, no topping twice
    // running except a double patty
    for (int k = 0; k < MENU_N; k++) {
      int n = recipeLength(k);
      std::vector<int> r;
      for (int i = 0; i < n; i++) {
        int pick = rng.range(0, 3);
        int guard = 0;
        while (i > 0 && pick == r[i - 1] && pick != PATTY && guard++ < 20) pick = rng.range(0, 3);
        r.push_back(pick);
      }
      if (std::find(r.begin(), r.end(), (int)PATTY) == r.end()) r[rng.range(0, n - 1)] = PATTY;
      menu_.push_back(r);
    }
    int n = count();
    for (int i = 0; i < n; i++) {
      Station s;
      s.x = VW / 2.0f + (i - (n - 1) / 2.0f) * STATION_GAP;
      s.customer = i;
      s.anim = "wave";
      s.animHold = 1.2f;
      st_.push_back(s);
      newOrder(i, false);
    }
  }

  void update(float dt) override {
    time_ += dt;
    clock_ += dt;
    if (!rush_ && time_ >= RUSH_AT) {
      rush_ = true;
      app.audio.sfx("alarm", 0.4f);
    }
    for (int i = 0; i < count(); i++) {
      Station& s = st_[i];
      s.animT += dt;
      if ((s.animHold -= dt) <= 0 && s.anim[0] != 'i') setAnim(s, "idle", 0);
      s.ticketT += dt;
      s.busy -= dt;
      for (auto& l : s.layers) l.t += dt;
      switch (s.state) {
        case COOKING: {
          s.patience -= dt * (rush_ ? 1.3f : 1.0f);
          if (s.patience <= 0) {
            leave(i);
            break;
          }
          int ing = isCpu(i) ? cpuPress(i, dt) : readInput(i);
          if (ing >= 0 && s.busy <= 0) press(i, ing);
          break;
        }
        case SERVING:
          s.st += dt;
          if (!s.topBun && s.st >= 0.17f) {
            s.topBun = true;
            addLayer(s, BUN_TOP, true, false);
            app.audio.sfx("confirm", 0.6f);
          }
          if (!s.served && s.st >= 0.70f) served(i);
          if (s.st >= 1.08f) {
            s.k++;
            newOrder(i, true);
          }
          break;
        case TOPPLED:
          s.st += dt;
          if (s.st >= TOPPLE_T - 0.08f) {
            resetStack(s, true);
            s.state = COOKING;
          }
          break;
        case LEAVING:
          s.st += dt;
          if (s.st >= 0.74f) {
            s.k++;
            newOrder(i, true);
          }
          break;
      }
    }
    for (auto& p : pops_) p.t += dt;
    std::erase_if(pops_, [](const Pop& p) { return p.t > 0.9f; });
  }

  void draw() override {
    drawArena();
    for (int i = 0; i < count(); i++) {
      const Station& s = st_[i];
      spr::character(player(i).character, s.anim, s.animT, s.x + COOK_DX, COOK_FEET_Y, COOK_SCALE, false);
    }
    // the counter (the arena from its top edge down) hides the cooks' legs
    Tex* arena = app.gfx.tex(def() && def()->arena[0] ? def()->arena : "mg/arena_patty-panic.png");
    SDL_Rect front{0, (int)FRONT_CUT, VW, VH - (int)FRONT_CUT};
    app.gfx.sprite(arena, front, 0, FRONT_CUT, 1, 1, 0, 0);
    Tex* atlas = app.gfx.tex("mg/toons_patty.png");
    for (int i = 0; i < count(); i++) {
      drawLegend(i, atlas);
      drawStack(st_[i], atlas);
      drawTicket(i, atlas);
      drawPlayerTag(i, st_[i].x + COOK_DX, COOK_FEET_Y - 106);
    }
    for (auto& p : pops_) {
      float k = p.t / 0.9f;
      app.gfx.text(p.text, p.x, p.y - 26 * easeOut(k), 22, p.c.alpha(k < 0.7f ? 1 : (1 - k) / 0.3f), CENTER, true);
    }
    if (rush_ && time_ < RUSH_AT + 2.5f && std::fmod(time_, 0.4f) < 0.28f) app.gfx.text("RUSH HOUR!", VW / 2, 52, 26, col::coral, CENTER, true);
    drawTimer(DURATION - time_);
    drawScores(scores(), "orders");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> v;
    for (auto& s : st_) v.push_back(s.score);
    return v;
  }
  std::string scoreLabel(int i) const override { return std::to_string(st_[i].score) + (st_[i].score == 1 ? " order" : " orders"); }

 private:
  std::vector<std::vector<int>> menu_;
  std::vector<Station> st_;
  std::vector<Pop> pops_;
  float time_ = 0, clock_ = 0;
  bool rush_ = false;

  static void setAnim(Station& s, const char* a, float hold) {
    s.anim = a;
    s.animT = 0;
    s.animHold = hold;
  }
  void pop(const std::string& t, float x, float y, Color c) {
    if (pops_.size() >= 12) pops_.erase(pops_.begin());
    pops_.push_back({t, x, y, 0, c});
  }
  float ticketH(const Station& s) const { return TOPBUN_Y + 36 + (s.recipe.size() - 1) * ROW_H + 40 + 30; }

  // Put up the station's next ticket (the k-th burger on the menu) and a fresh bottom bun.
  void newOrder(int i, bool animate) {
    Station& s = st_[i];
    s.recipe = menu_[std::min(s.k, MENU_N - 1)];
    s.placed = 0;
    s.patienceMax = s.patience = patienceFor((int)s.recipe.size(), time_);
    s.state = COOKING;
    s.st = 0;
    s.topBun = s.served = false;
    s.customer = (s.customer + 1 + s.k % 3) % 4;
    s.ticketT = animate ? 0 : 1;
    resetStack(s, animate);
    if (animate) app.audio.sfx("pop", 0.3f);
    s.cpuDelay = CPU_COOK[std::max(0, std::min(2, cpuLevel(i)))].read * rng.frange(0.8f, 1.3f);
  }

  static void resetStack(Station& s, bool animate) {
    s.layers.clear();
    s.stackH = PLATE_THICK;
    addLayer(s, BUN_BOTTOM, animate, false);
  }
  static void addLayer(Station& s, int ing, bool animate, bool toss) {
    if ((int)s.layers.size() >= MAX_LAYERS + 2) return;
    s.layers.push_back({ing, s.stackH, animate ? 0.0f : 1.0f, toss, 0, 0, 0});
    s.stackH += THICK[ing];
  }

  int readInput(int i) {
    const Pad& p = pad(i);
    for (int b = 0; b < 4; b++)
      if (p.press(BUTTON_FOR[b])) return b;
    if (p.press(B_LEFT)) return PATTY;
    if (p.press(B_DOWN)) return LETTUCE;
    if (p.press(B_RIGHT)) return TOMATO;
    if (p.press(B_UP)) return CHEESE;
    // the analogue stick, edge-triggered
    Station& s = st_[i];
    float m = std::hypot(p.x, p.y);
    if (m < 0.35f) s.armed = true;
    else if (s.armed && m > 0.6f) {
      s.armed = false;
      if (std::fabs(p.x) >= std::fabs(p.y)) return p.x < 0 ? PATTY : TOMATO;
      return p.y > 0 ? LETTUCE : CHEESE;
    }
    return -1;
  }

  int cpuPress(int i, float dt) {
    Station& s = st_[i];
    if (s.busy > 0) return -1;
    s.cpuDelay -= dt;
    if (s.cpuDelay > 0) return -1;
    const CpuCook& cfg = CPU_COOK[std::max(0, std::min(2, cpuLevel(i)))];
    int want = s.recipe[s.placed];
    if (rng.chance(cfg.slip)) want = (want + rng.range(1, 3)) % 4;
    s.cpuDelay = cfg.press * rng.frange(0.75f, 1.3f);
    return want;
  }

  void press(int i, int ing) {
    Station& s = st_[i];
    if (s.recipe[s.placed] != ing) {
      topple(i);
      return;
    }
    s.placed++;
    addLayer(s, ing, true, true);
    setAnim(s, "throw", 0.3f);
    app.audio.sfx("pop", 0.45f);
    if (s.placed >= (int)s.recipe.size()) {
      // the last topping is on: the top bun lands and the burger flies up to the customer
      s.state = SERVING;
      s.st = 0;
      s.topBun = s.served = false;
    }
  }

  void served(int i) {
    Station& s = st_[i];
    s.served = true;
    s.score++;
    s.combo++;
    app.audio.sfx("coin", 0.6f);
    float px = s.x, py = TICKET_TOP + PORTRAIT_Y * TS;
    pop("+1", px + 40, py, col::gold);
    if (s.combo >= 3 && s.combo % 3 == 0) pop(std::to_string(s.combo) + " IN A ROW!", s.x, PLATE_Y - 52, color(i).mix(col::white, 0.3f));
    setAnim(s, "celebrate", 0.8f);
  }

  // A wrong button: the stack topples off the plate and the burger starts again from the bun.
  void topple(int i) {
    Station& s = st_[i];
    s.state = TOPPLED;
    s.st = 0;
    s.busy = TOPPLE_T;
    s.combo = 0;
    s.placed = 0;
    app.audio.sfx("error", 0.7f);
    float dir = rng.chance(0.5) ? -1.0f : 1.0f;
    for (size_t k = 0; k < s.layers.size(); k++) {
      Layer& l = s.layers[k];
      l.t = 1;
      l.tx = (k + 1) * 30 * dir + rng.frange(-30, 30);
      l.ty = 260 + rng.frange(0, 80);
      l.ang = dir * (90 + rng.frange(0, 160));
    }
    pop("OOPS!", s.x + PLATE_DX, PLATE_Y - s.stackH * SK - 30, col::coral);
    setAnim(s, "surprised", TOPPLE_T);
  }

  // Out of patience: the customer storms off, the ticket drops and the half-built burger goes.
  void leave(int i) {
    Station& s = st_[i];
    s.state = LEAVING;
    s.st = 0;
    s.combo = 0;
    app.audio.sfx("cancel", 0.6f);
    pop("TOO SLOW!", s.x, TICKET_TOP + (PORTRAIT_Y + 60) * TS, Color(220, 224, 232));
    setAnim(s, "disappointed", 0.8f);
  }

  // --- Drawing ---------------------------------------------------------------------------------
  void drawLegend(int i, Tex* atlas) const {
    const Station& s = st_[i];
    float y = 898 * S;
    app.gfx.rect(s.x - 200 * S, 848 * S, 400 * S, 3, color(i));
    for (int b = 0; b < 4; b++) {
      float x = s.x + (b - 1.5f) * 96 * S;
      app.gfx.panel(x - 44 * S, y - 46 * S, 88 * S, 96 * S, Color(10, 42, 51, 82), 8);
      app.gfx.sprite(atlas, R_ING[b], x, y - 10 * S, 0.44f, 0.44f, 0.5f, 0.6f);
      faceButton(x - 7, y + 12, BUTTON_FOR[b], 8);
      if (!app.wii) chevron(x + (DIR_FOR[b] == 2 ? 15.0f : (DIR_FOR[b] == 0 ? 7.0f : 11.0f)), y + 12 + (DIR_FOR[b] == 1 ? 4.0f : (DIR_FOR[b] == 3 ? -4.0f : 0.0f)), DIR_FOR[b], 4,
              2, col::white.alpha(0.85f));
    }
  }

  void drawStack(const Station& s, Tex* atlas) const {
    float bx = s.x + PLATE_DX, by = PLATE_Y, m = 1, alpha = 1;
    if (s.state == SERVING) {
      if (s.st >= 0.70f) return;  // up with the customer
      float k = clampf((s.st - 0.36f) / 0.34f, 0, 1);
      k = k * k * k;
      float tx = s.x, ty = ticketY(s) + (PORTRAIT_Y + 20) * TS;
      bx = lerpf(bx, tx, k);
      by = lerpf(by, ty, k);
      m = lerpf(1, 0.33f, k);
    } else if (s.state == LEAVING) {
      float k = std::min(1.0f, s.st / 0.42f);
      bx += 260 * S * k * k;
      alpha = 1 - k;
    }
    if (alpha <= 0.01f) return;
    app.gfx.sprite(atlas, R_PLATE, bx, by, STACK_SCALE * m, STACK_SCALE * m, 0.5f, 0.7f, 0, false, col::white.alpha(alpha));
    float wobble = s.state == COOKING ? std::sin(clock_ * 4 + s.x) * std::min(3.0f, s.layers.size() * 0.5f) * PI / 180 : 0;
    float hx = s.x + COOK_DX + 46 * S - bx, hy = COOK_FEET_Y - 150 * S - by;  // the cook's hand
    for (auto& l : s.layers) {
      float rest = -l.h * SK;
      float x = std::sin(wobble) * l.h * SK, y = rest, ang = 0, a = alpha, sx = 1, sy = 1;
      if (s.state == TOPPLED) {
        float k = std::min(1.0f, s.st / 0.52f);
        k *= k;
        x = l.tx * SK * k;
        y = rest + l.ty * SK * k;
        ang = l.ang * k;
        a = 1 - k;
      } else if (l.toss && l.t < 0.17f) {
        float u = 1 - std::cos(l.t / 0.17f * PI / 2);
        x = hx * (1 - u);
        y = hy + (rest - hy) * u - 70 * SK * 4 * u * (1 - u);
        ang = -30 * (1 - u);
      } else if (!l.toss && l.t < 0.15f) {
        float u = l.t / 0.15f;
        y = rest - 150 * SK * (1 - u * u);
      } else {
        float land = (l.t - (l.toss ? 0.17f : 0.15f)) / 0.16f;
        if (land < 1) {
          float e = easeBack(land);
          sx = lerpf(1.12f, 1, e);
          sy = lerpf(0.8f, 1, e);
        }
      }
      app.gfx.sprite(atlas, R_ING[l.ing], bx + x * m, by + y * m, STACK_SCALE * m * sx, STACK_SCALE * m * sy, 0.5f, 0.8f, ang, false, col::white.alpha(a));
    }
  }

  float ticketY(const Station& s) const {
    float h = ticketH(s) * TS;
    float y = TICKET_TOP;
    if (s.ticketT < 0.38f) y = lerpf(-h - 20, TICKET_TOP, easeBack(s.ticketT / 0.38f));
    if (s.state == SERVING && s.st > 0.82f) y -= 60 * S * std::min(1.0f, (s.st - 0.82f) / 0.26f);
    if (s.state == LEAVING && s.st > 0.18f) {
      float k = std::min(1.0f, (s.st - 0.18f) / 0.56f);
      y += 520 * S * k * k;
    }
    return y;
  }

  void drawTicket(int i, Tex* atlas) const {
    const Station& s = st_[i];
    float a = 1;
    if (s.state == SERVING && s.st > 0.82f) a = 1 - std::min(1.0f, (s.st - 0.82f) / 0.26f);
    if (s.state == LEAVING && s.st > 0.18f) a = 1 - std::min(1.0f, (s.st - 0.18f) / 0.56f);
    if (a <= 0.01f) return;
    float cx = s.x, top = ticketY(s);
    auto X = [&](float lx) { return cx + lx * TS; };
    auto Y = [&](float ly) { return top + ly * TS; };
    const float w = TICKET_W;
    float h = ticketH(s);
    Color paper = Color::hex(0xfffaf0);
    app.gfx.panel(X(-w / 2 + 5), Y(8), w * TS, h * TS, Color(10, 17, 32, (unsigned char)(56 * a)), 7);
    app.gfx.panel(X(-w / 2), Y(0), w * TS, h * TS, paper.alpha(a), 7);
    app.gfx.panel(X(-w / 2), Y(0), w * TS, 30 * TS, color(i).alpha(a), 7);
    app.gfx.rect(X(-w / 2), Y(16), w * TS, 14 * TS, paper.alpha(a));
    app.gfx.panel(X(-24), Y(-16), 48 * TS, 26 * TS, Color::hex(0xc98a1b).alpha(a), 3);
    app.gfx.panel(X(-20), Y(-14), 40 * TS, 18 * TS, Color::hex(0xf2c14e).alpha(a), 3);
    int n = (int)s.recipe.size();
    // the next topping: a warm bar behind its row and an arrow at it
    if (s.state == COOKING && s.placed < n) {
      float ry = TOPBUN_Y + 36 + (n - 1 - s.placed) * ROW_H;
      app.gfx.panel(X(-w / 2 + 10), Y(ry - ROW_H / 2 + 2), (w - 20) * TS, (ROW_H - 4) * TS, Color(255, 224, 138, (unsigned char)(220 * a)), 6);
      chevron(X(-w / 2 + 30), Y(ry), 2, 5, 3, Color::hex(0xff8a3a).alpha(a));
    }
    // the customer and their patience ring: green, then amber, then red and throbbing
    float u = s.state == LEAVING ? 0 : std::max(0.0f, s.patience / s.patienceMax);
    float pcx = X(0), pcy = Y(PORTRAIT_Y), pr = (PORTRAIT_R + 7) * TS;
    app.gfx.ring(pcx, pcy, pr + 3, Color(10, 17, 32, (unsigned char)(70 * a)));
    app.gfx.circle(pcx, pcy, PORTRAIT_R * TS, Color::hex(0x0d5a8c).alpha(a));
    app.gfx.circle(pcx, Y(PORTRAIT_Y - 6), (PORTRAIT_R - 6) * TS, Color::hex(0x6fd6e8).alpha(a));
    bool low = u < 0.28f;
    if (u > 0) {
      Color c = u > 0.55f ? mixc(Color::hex(0xffd23f), Color::hex(0x3fcf6a), (u - 0.55f) / 0.45f)
                          : (u > 0.28f ? mixc(Color::hex(0xff5a4a), Color::hex(0xffd23f), (u - 0.28f) / 0.27f)
                                       : ((int)(clock_ / 0.14f) % 2 ? col::white : Color::hex(0xff4a3a)));
      int segs = std::max(1, (int)std::ceil(u * 22));
      float a0 = -PI / 2, step = u * PI * 2 / segs;
      for (int k = 0; k < segs; k++) {
        float t0 = a0 + k * step, t1 = t0 + step;
        app.gfx.line(pcx + std::cos(t0) * pr, pcy + std::sin(t0) * pr, pcx + std::cos(t1) * pr, pcy + std::sin(t1) * pr, 4, c.alpha(a));
      }
    }
    float shake = s.state == COOKING && low ? std::sin(clock_ * 70) * 3 * TS : 0;
    app.gfx.sprite(atlas, R_CUSTOMER[s.customer], pcx + shake, Y(PORTRAIT_Y + 10), 0.54f * (TS / S), 0.54f * (TS / S), 0.5f, 0.5f, 0, false,
                   (s.state == LEAVING ? Color::hex(0xff8a80) : col::white).alpha(a));
    // the burger, top bun first
    app.gfx.sprite(atlas, R_ING[BUN_TOP], X(0), Y(TOPBUN_Y), 0.5f * 0.82f * (TS / S), 0.5f * 0.82f * (TS / S), 0.5f, 0.62f, 0, false, col::white.alpha(a));
    for (int r = 0; r < n; r++) {
      float ry = TOPBUN_Y + 36 + r * ROW_H;
      int ing = s.recipe[n - 1 - r];
      bool done = r >= n - s.placed && s.state != TOPPLED;
      app.gfx.sprite(atlas, R_ING[ing], X(-38), Y(ry), 0.5f * (TS / S), 0.5f * (TS / S), 0.5f, 0.6f, 0, false, col::white.alpha(a * (done ? 0.55f : 1)));
      if (done) {
        app.gfx.circle(X(72), Y(ry), 18 * TS, Color::hex(0x3fcf6a).alpha(a));
        app.gfx.line(X(61), Y(ry), X(69), Y(ry + 8), 3, col::white.alpha(a));
        app.gfx.line(X(68), Y(ry + 8), X(83), Y(ry - 8), 3, col::white.alpha(a));
      } else faceButton(X(72), Y(ry), BUTTON_FOR[ing], 20 * TS, a);
    }
    app.gfx.sprite(atlas, R_ING[BUN_BOTTOM], X(0), Y(TOPBUN_Y + 36 + (n - 1) * ROW_H + 40), 0.5f * 0.9f * (TS / S), 0.5f * 0.9f * (TS / S), 0.5f, 0.6f, 0, false,
                   col::white.alpha(a));
  }
};

}  // namespace

REGISTER_MINIGAME("patty-panic", PattyPanic);

// Donut Dash (Homer, Cartoon Coast): donuts are tossed onto the factory floor; each lands on a ring
// in one player's colour (or a rainbow ring, good for anyone). Be on the ring when it lands to catch
// it. Burnt donuts cost a donut. A dashes and bumps rivals. Most donuts after 45 seconds wins.
#include <algorithm>
#include <cmath>

#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float DURATION = 45;
constexpr float FLOOR_TOP = 210, FLOOR_BOTTOM = 420, FLOOR_LEFT = 60, FLOOR_RIGHT = VW - 60;

struct Donut {
  float x, y;      // landing spot
  float t;         // time until it lands
  float total;
  int owner;       // player index, -1 rainbow, -2 burnt, -3 broccoli
  bool alive = true;
};

struct Runner {
  float x, y, vx = 0, vy = 0;
  float dash = 0, dashCd = 0, stun = 0, anim = 0;
  bool flip = false;
  int score = 0;
  // CPU
  float thinkT = 0, tx = 0, ty = 0;
};

class DonutDash : public Minigame {
 public:
  void start() override {
    for (int i = 0; i < count(); i++) {
      Runner r;
      r.x = FLOOR_LEFT + 120 + i * ((FLOOR_RIGHT - FLOOR_LEFT - 240) / std::max(1, count() - 1));
      r.y = 330;
      r.tx = r.x;
      r.ty = r.y;
      run_.push_back(r);
    }
  }

  void update(float dt) override {
    time_ += dt;
    // toss donuts faster as the belts speed up
    spawn_ -= dt;
    float every = 0.9f - 0.45f * (time_ / DURATION);
    if (spawn_ <= 0 && time_ < DURATION - 1) {
      spawn_ = every;
      Donut d;
      d.x = rng.frange(FLOOR_LEFT + 30, FLOOR_RIGHT - 30);
      d.y = rng.frange(FLOOR_TOP + 20, FLOOR_BOTTOM - 10);
      d.total = d.t = rng.frange(1.2f, 1.8f);
      float r = (float)rng.next();
      d.owner = r < 0.12f ? -1 : (r < 0.19f ? -2 : (r < 0.26f ? -3 : rng.range(0, count() - 1)));
      donuts_.push_back(d);
    }
    for (int i = 0; i < count(); i++) moveRunner(i, dt);
    // landings
    for (auto& d : donuts_) {
      if (!d.alive) continue;
      d.t -= dt;
      if (d.t > 0) continue;
      d.alive = false;
      int best = -1;
      float bestD = 34;
      for (int i = 0; i < count(); i++) {
        float dd = std::hypot(run_[i].x - d.x, (run_[i].y - d.y) * 1.4f);
        if (dd < bestD && run_[i].stun <= 0) {
          bestD = dd;
          best = i;
        }
      }
      if (best < 0) continue;
      if (d.owner <= -2) {
        // a burnt one or broccoli knocks a donut out of the box and leaves you dazed
        run_[best].score = std::max(0, run_[best].score - 1);
        run_[best].stun = 0.5f;
        app.audio.sfx("bad");
      } else if (d.owner == -1) {
        run_[best].score += 2;
        app.audio.sfx("coin");
      } else if (d.owner == best) {
        run_[best].score += 1;
        app.audio.sfx("coin");
      }
    }
    std::erase_if(donuts_, [](const Donut& d) { return !d.alive; });
  }

  void moveRunner(int i, float dt) {
    Runner& r = run_[i];
    r.anim += dt;
    r.dashCd -= dt;
    if (r.stun > 0) {
      r.stun -= dt;
      return;
    }
    float ix = 0, iy = 0;
    bool dashPress = false;
    if (isCpu(i)) {
      cpuThink(i, dt);
      float dx = r.tx - r.x, dy = r.ty - r.y, d = std::hypot(dx, dy);
      if (d > 6) {
        ix = dx / d;
        iy = dy / d;
      }
      dashPress = d > 140 && r.dashCd <= 0 && rng.chance(0.02 * (1 + cpuLevel(i)));
    } else {
      ix = pad(i).x;
      iy = pad(i).y;
      dashPress = pad(i).press(B_A);
    }
    if (dashPress && r.dashCd <= 0) {
      r.dash = 0.22f;
      r.dashCd = 1.2f;
      app.audio.sfx("dash", 0.6f);
    }
    float speed = r.dash > 0 ? 460 : 190;
    r.dash -= dt;
    r.vx = approach(r.vx, ix * speed, 14, dt);
    r.vy = approach(r.vy, iy * speed * 0.8f, 14, dt);
    r.x = clampf(r.x + r.vx * dt, FLOOR_LEFT, FLOOR_RIGHT);
    r.y = clampf(r.y + r.vy * dt, FLOOR_TOP, FLOOR_BOTTOM);
    if (std::fabs(r.vx) > 10) r.flip = r.vx < 0;
    // dashing into a rival bumps them
    if (r.dash > 0)
      for (int j = 0; j < count(); j++)
        if (j != i && run_[j].stun <= 0 && std::hypot(run_[j].x - r.x, run_[j].y - r.y) < 30) {
          run_[j].stun = 0.8f;
          run_[j].vx = r.vx * 0.6f;
          app.audio.sfx("bump");
        }
  }

  void cpuThink(int i, float dt) {
    Runner& r = run_[i];
    r.thinkT -= dt;
    if (r.thinkT > 0) return;
    r.thinkT = 0.25f + (2 - cpuLevel(i)) * 0.2f;
    // go for the most valuable reachable donut
    float best = -1e9f;
    for (auto& d : donuts_) {
      if (d.owner <= -2 || (d.owner >= 0 && d.owner != i)) continue;
      float dist = std::hypot(d.x - r.x, d.y - r.y);
      float reach = d.t * 200;
      float v = (d.owner == -1 ? 2.0f : 1.0f) * 100 - dist * 0.4f - (dist > reach ? 80 : 0);
      if (rng.chance(0.1 * (2 - cpuLevel(i)))) v -= 60;
      if (v > best) {
        best = v;
        r.tx = d.x;
        r.ty = d.y;
      }
    }
  }

  void draw() override {
    drawArena();
    // landing rings and falling donuts
    Tex* dt = app.gfx.tex("mg/toons_donut.png");
    for (auto& d : donuts_) {
      Color c = d.owner >= 0 ? color(d.owner) : (d.owner == -1 ? Color::hex(0xff7ad9) : (d.owner == -3 ? Color::hex(0x3f8f3a) : Color(70, 50, 40)));
      float k = 1 - d.t / d.total;
      app.gfx.ellipse(d.x, d.y, 22, 9, c.alpha(0.35f + 0.4f * k));
      app.gfx.ellipse(d.x, d.y, 14, 5.5f, Color(255, 255, 255, 120));
      float h = d.t * 260;
      SDL_Rect src{0, 0, dt->w, dt->h};
      if (d.owner == -3) {
        // broccoli: a stalk and three florets
        float bx = d.x, by = d.y - 8 - h;
        app.gfx.rect(bx - 3, by, 6, 12, Color::hex(0x9bd16a));
        app.gfx.circle(bx - 8, by - 2, 8, Color::hex(0x3f8f3a));
        app.gfx.circle(bx + 8, by - 2, 8, Color::hex(0x3f8f3a));
        app.gfx.circle(bx, by - 9, 9, Color::hex(0x4fa646));
        continue;
      }
      Color tint = d.owner == -2 ? Color(90, 70, 60) : (d.owner == -1 ? col::white : c.mix(col::white, 0.35f));
      app.gfx.sprite(dt, src, d.x, d.y - 8 - h, 34.0f / dt->w, 34.0f / dt->w, 0.5f, 0.5f, d.t * 400, false, tint);
    }
    // runners, back to front
    std::vector<int> order;
    for (int i = 0; i < count(); i++) order.push_back(i);
    std::sort(order.begin(), order.end(), [&](int a, int b) { return run_[a].y < run_[b].y; });
    for (int i : order) {
      Runner& r = run_[i];
      spr::shadow(r.x, r.y, 46);
      bool moving = std::hypot(r.vx, r.vy) > 30;
      const char* anim = r.stun > 0 ? "stunned" : (r.dash > 0 ? "dash" : (moving ? "run" : "idle"));
      spr::character(player(i).character, anim, r.anim, r.x, r.y, 0.9f, r.flip);
      drawPlayerTag(i, r.x, r.y - 82);
    }
    drawTimer(DURATION - time_);
    std::vector<int> sc;
    for (auto& r : run_) sc.push_back(r.score);
    drawScores(sc, "donuts");
  }

  bool finished() const override { return time_ >= DURATION; }
  std::vector<int> scores() const override {
    std::vector<int> s;
    for (auto& r : run_) s.push_back(r.score);
    return s;
  }
  std::string scoreLabel(int i) const override { return std::to_string(run_[i].score) + " donuts"; }

 private:
  std::vector<Runner> run_;
  std::vector<Donut> donuts_;
  float time_ = 0, spawn_ = 0.5f;
};

}  // namespace

REGISTER_MINIGAME("donut-dash", DonutDash);

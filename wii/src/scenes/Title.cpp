// Title screen: the island backdrop, the wordmark, and the main menu.
#include <algorithm>
#include <cmath>

#include "../core/Util.h"
#include "../game/Session.h"
#include "../game/Sprites.h"

namespace {

class Title : public ui::Scene {
 public:
  void enter() override {
    app.audio.music("title");
    t_ = 0;
  }
  void update(float dt) override {
    t_ += dt;
    if (!menu_) {
      if (app.input.anyPress(B_A) || app.input.anyPress(B_START)) {
        menu_ = true;
        app.audio.sfx("confirm");
      }
      return;
    }
    if (screen_.isOpen()) {
      screen_.update();
      return;
    }
    if (app.input.anyPress(B_UP)) sel_ = (sel_ + 4) % 5, app.audio.sfx("move");
    if (app.input.anyPress(B_DOWN)) sel_ = (sel_ + 1) % 5, app.audio.sfx("move");
    if (app.input.anyPress(B_B)) menu_ = false;
    if (app.input.anyPress(B_A)) {
      app.audio.sfx("confirm");
      if (sel_ == 0) ui::go(makeSetup(false));
      else if (sel_ == 1) ui::go(makeSetup(true));
      else if (sel_ == 2) ui::go(makeHowTo());
      else if (sel_ == 3) screen_.open();
      else app.input.quit = true;
    }
  }

  void draw() override {
    app.gfx.image(app.gfx.tex("ui/title.png"), 0, 0, VW, VH);
    // a few characters waving on the island
    static const int cast[4] = {11, 6, 3, 0};
    for (int i = 0; i < 4; i++) {
      float x = 470 + i * 78, y = 300 + (i % 2) * 8;
      spr::shadow(x, y, 46, 0.25f);
      spr::character(cast[i] % data::CHARACTER_COUNT, i % 2 ? "wave" : "idle", t_ + i * 0.37f, x, y, 0.95f);
    }
    Tex* logo = app.gfx.tex("ui/logo.png");
    float bob = std::sin(t_ * 1.6f) * 4;
    app.gfx.image(logo, 40, 34 + bob, logo->w * 0.95f, logo->h * 0.95f);
    app.gfx.text("The Crossover Board Game", 40 + logo->w * 0.475f, 34 + logo->h * 0.95f + 6 + bob, 22, col::white, CENTER, true);
    if (!menu_) {
      float a = 0.55f + 0.45f * std::sin(t_ * 3.2f);
      ui::card(VW / 2 - 150, 400, 300, 46, col::cream.alpha(0.95f), 23);
      ui::prompt(VW / 2 - 92, 410, B_A, "Press to start", col::ink.alpha(a));
      return;
    }
    static const char* items[5] = {"Board Game", "Minigames", "How to Play", "TV Borders", "Exit"};
    for (int i = 0; i < 5; i++) {
      float y = 214 + i * 44;
      bool on = i == sel_;
      ui::card(56, y, 260, 38, on ? col::gold : col::cream, 19);
      app.gfx.text(items[i], 56 + 130, y + 7, 22, col::ink, CENTER, false);
    }
    if (screen_.isOpen()) {
      screen_.draw();
      return;
    }
    ui::prompts(VW / 2, 440, {{B_A, "Select"}, {B_B, "Back"}});
  }

 private:
  float t_ = 0;
  bool menu_ = false;
  int sel_ = 0;
  ui::ScreenEditor screen_;
};

}  // namespace

std::unique_ptr<ui::Scene> makeTitle() { return std::make_unique<Title>(); }

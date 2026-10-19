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
    if (screen_) {
      updateScreen();
      return;
    }
    if (app.input.anyPress(B_UP)) sel_ = (sel_ + 3) % 4, app.audio.sfx("move");
    if (app.input.anyPress(B_DOWN)) sel_ = (sel_ + 1) % 4, app.audio.sfx("move");
    if (app.input.anyPress(B_B)) menu_ = false;
    if (app.input.anyPress(B_A)) {
      app.audio.sfx("confirm");
      if (sel_ == 0) ui::go(makeSetup(false));
      else if (sel_ == 1) ui::go(makeSetup(true));
      else if (sel_ == 2) screen_ = true, row_ = 0;
      else app.input.quit = true;
    }
  }

  // Screen options: picture size (for TVs that cut off the edges) and shape.
  void updateScreen() {
    static const int SIZES[] = {100, 97, 94, 91, 88};
    if (app.input.anyPress(B_UP) || app.input.anyPress(B_DOWN)) row_ ^= 1, app.audio.sfx("move");
    int d = app.input.anyPress(B_RIGHT) ? 1 : (app.input.anyPress(B_LEFT) ? -1 : 0);
    if (d) {
      if (row_ == 0) {
        int i = 0;
        while (i < 4 && SIZES[i] > app.screenSize) i++;
        // right makes the picture bigger
        i = std::max(0, std::min(4, i - d));
        app.screenSize = SIZES[i];
      } else app.screenShape = (app.screenShape + d + 3) % 3;
      app.applyScreen();
      app.audio.sfx("move");
    }
    if (app.input.anyPress(B_A) || app.input.anyPress(B_B)) {
      app.saveSettings();
      screen_ = false;
      app.audio.sfx("confirm");
    }
  }

  void drawScreen() {
    ui::fadeRect(0.45f);
    // corner marks at the very edge of the picture
    Color m = col::gold;
    for (int c = 0; c < 4; c++) {
      float x = c % 2 ? VW - 2 : 2, y = c / 2 ? VH - 2 : 2, dx = c % 2 ? -1 : 1, dy = c / 2 ? -1 : 1;
      app.gfx.rect(std::min(x, x + dx * 40), y - (dy < 0 ? 6 : 0), 40, 6, m);
      app.gfx.rect(x - (dx < 0 ? 6 : 0), std::min(y, y + dy * 40), 6, 40, m);
    }
    ui::card(VW / 2 - 250, 110, 500, 250, col::cream, 22);
    app.gfx.text("Screen", VW / 2, 122, 30, col::ink, CENTER, false);
    app.gfx.textBox("Pick the biggest size where you can see all four yellow corners.", VW / 2 - 220, 162, 440, 17, col::grey, CENTER);
    static const char* shapes[3] = {"Wii setting", "16:9", "4:3"};
    std::string shape = shapes[app.screenShape];
    if (app.screenShape == 0) shape += app.tvWide ? " (16:9)" : " (4:3)";
    std::string rows[2] = {app.screenSize == 100 ? std::string("Full screen") : std::to_string(app.screenSize) + "%", shape};
    static const char* labels[2] = {"Picture size", "Picture shape"};
    for (int i = 0; i < 2; i++) {
      float y = 214 + i * 60;
      if (i == row_) app.gfx.panel(VW / 2 - 230, y, 460, 48, col::gold.alpha(0.85f), 14);
      app.gfx.text(labels[i], VW / 2 - 210, y + 13, 20, col::ink, LEFT, false);
      app.gfx.text("<  " + rows[i] + "  >", VW / 2 + 210, y + 13, 20, col::ink, RIGHT, false);
    }
    ui::prompts(VW / 2, 372, {{B_A, "Done"}});
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
    static const char* items[4] = {"Board Game", "Minigames", "Screen", "Exit"};
    for (int i = 0; i < 4; i++) {
      float y = 228 + i * 52;
      bool on = i == sel_;
      ui::card(56, y, 260, 44, on ? col::gold : col::cream, 22);
      app.gfx.text(items[i], 56 + 130, y + 9, 24, col::ink, CENTER, false);
    }
    if (screen_) {
      drawScreen();
      return;
    }
    ui::prompts(VW / 2, 438, {{B_A, "Select"}, {B_B, "Back"}});
  }

 private:
  float t_ = 0;
  bool menu_ = false, screen_ = false;
  int sel_ = 0, row_ = 0;
};

}  // namespace

std::unique_ptr<ui::Scene> makeTitle() { return std::make_unique<Title>(); }

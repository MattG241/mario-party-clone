#include "Ui.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "../core/Util.h"

namespace ui {

const char* glyph(Btn b) {
  if (app.wii) {
    switch (b) {
      case B_A: return "2";
      case B_B: return "1";
      case B_X: return "B";
      case B_Y: return "Z";
      case B_START: return "+";
      case B_SELECT: return "-";
      case B_HOME: return "H";
      default: break;
    }
  }
  // the D-pad (or arrow keys)
  switch (b) {
    case B_UP: return "^";
    case B_DOWN: return "v";
    case B_LEFT: return "<";
    case B_RIGHT: return ">";
    default: break;
  }
  switch (b) {
    case B_A: return "Z";
    case B_B: return "X";
    case B_X: return "C";
    case B_Y: return "V";
    case B_START: return "Ent";
    case B_SELECT: return "Tab";
    default: return "?";
  }
}

void card(float x, float y, float w, float h, Color fill, float radius) {
  app.gfx.panel(x + 3, y + 5, w, h, Color(0, 0, 0, (unsigned char)(fill.a * 0.28f)), radius);
  app.gfx.panel(x, y, w, h, fill, radius);
}

void button(float x, float y, Btn b, float r) {
  Color c = b == B_A ? col::teal : (b == B_B ? col::coral : col::ink);
  app.gfx.circle(x, y + 2, r, Color(0, 0, 0, 90));
  app.gfx.circle(x, y, r, col::white);
  app.gfx.circle(x, y, r - 2.5f, c);
  const char* g = glyph(b);
  int size = (int)(r * (g[1] ? 1.0f : 1.35f));
  app.gfx.text(g, x, y - size * 0.62f, size, col::white, CENTER, false);
}

float prompt(float x, float y, Btn b, const std::string& label, Color c) {
  button(x + 13, y + 13, b);
  app.gfx.text(label, x + 32, y + 3, 18, c, LEFT, true);
  return 40 + app.gfx.textWidth(label, 18);
}

void prompts(float cx, float y, const std::vector<std::pair<Btn, std::string>>& items, Color c) {
  float total = 0;
  for (auto& it : items) total += 40 + app.gfx.textWidth(it.second, 18) + 18;
  float x = cx - total / 2;
  for (auto& it : items) x += prompt(x, y, it.first, it.second, c) + 18;
}

void banner(const std::string& title, const std::string& sub, Color accent, float t, float hold) {
  // slide in, hold, slide out
  float in = clampf(t / 0.35f, 0, 1), out = clampf((t - 0.35f - hold) / 0.3f, 0, 1);
  float k = easeBack(in) * (1 - easeOut(out));
  if (k <= 0.001f) return;
  float h = 92, y = VH * 0.36f;
  float w = VW * k;
  app.gfx.rect(VW / 2 - w / 2, y + 6, w, h, Color(0, 0, 0, 70));
  app.gfx.rect(VW / 2 - w / 2, y, w, h, accent);
  app.gfx.rect(VW / 2 - w / 2, y + h - 10, w, 10, accent.mix(col::black, 0.25f));
  if (k > 0.6f) {
    app.gfx.text(title, VW / 2, y + 12, 44, col::white, CENTER, true);
    if (!sub.empty()) app.gfx.text(sub, VW / 2, y + 60, 18, col::cream, CENTER, true);
  }
}

void fadeRect(float a) { app.gfx.rect(0, 0, VW, VH, Color(8, 20, 28, (unsigned char)(clampf(a, 0, 1) * 255))); }

// ---------------------------------------------------------------------------------------------
static std::unique_ptr<Scene> g_cur, g_next;
static float g_fade = 0;  // 0 clear .. 1 black
static int g_dir = 0;     // 1 fading out, -1 fading in

void go(std::unique_ptr<Scene> next) {
  g_next = std::move(next);
  g_dir = 1;
  if (!g_cur) {
    g_cur = std::move(g_next);
    g_cur->enter();
    g_fade = 1;
    g_dir = -1;
  }
}

Scene* current() { return g_cur.get(); }

void tick(float dt) {
  if (g_dir == 1) {
    g_fade += dt / 0.28f;
    if (g_fade >= 1) {
      g_fade = 1;
      g_cur = std::move(g_next);
      if (g_cur) g_cur->enter();
      g_dir = -1;
    }
  } else if (g_dir == -1) {
    g_fade -= dt / 0.3f;
    if (g_fade <= 0) {
      g_fade = 0;
      g_dir = 0;
    }
  }
  if (g_cur && g_dir != 1) g_cur->update(dt);
}

void render() {
  if (g_cur) g_cur->draw();
  if (g_fade > 0) fadeRect(g_fade);
}

// ---------------------------------------------------------------------------------------------
// TV borders

enum { SE_BX, SE_BY, SE_SX, SE_SY, SE_SHAPE, SE_RESET, SE_DONE, SE_ROWS };

void ScreenEditor::update() {
  if (!open_) return;
  auto& in = app.input;
  if (in.anyPress(B_UP)) row_ = (row_ + SE_ROWS - 1) % SE_ROWS, app.audio.sfx("move");
  if (in.anyPress(B_DOWN)) row_ = (row_ + 1) % SE_ROWS, app.audio.sfx("move");
  int d = in.anyPress(B_RIGHT) ? 1 : (in.anyPress(B_LEFT) ? -1 : 0);
  auto step = [d](int& v, int lo, int hi) {
    int n = std::max(lo, std::min(hi, v + d));
    bool changed = n != v;
    v = n;
    return changed;
  };
  bool changed = false;
  if (d) switch (row_) {
      case SE_BX: changed = step(app.borderX, 0, BORDER_MAX); break;
      case SE_BY: changed = step(app.borderY, 0, BORDER_MAX); break;
      case SE_SX: changed = step(app.shiftX, -SHIFT_MAX, SHIFT_MAX); break;
      case SE_SY: changed = step(app.shiftY, -SHIFT_MAX, SHIFT_MAX); break;
      case SE_SHAPE:
        app.screenShape = (app.screenShape + d + 3) % 3;
        changed = true;
        break;
    }
  if (in.anyPress(B_A) && row_ == SE_RESET) {
    app.borderX = app.borderY = app.shiftX = app.shiftY = 0;
    app.screenShape = 0;
    changed = true;
  }
  if (changed) {
    app.applyScreen();
    app.audio.sfx("move");
  }
  if ((in.anyPress(B_A) && row_ != SE_RESET) || in.anyPress(B_B)) {
    app.saveSettings();
    open_ = false;
    app.audio.sfx("confirm");
  }
}

void ScreenEditor::draw() {
  if (!open_) return;
  fadeRect(0.4f);
  // a frame along the very edge of the picture, with arrows pointing at the TV's edges
  Color m = col::gold;
  app.gfx.rect(0, 0, VW, 4, m);
  app.gfx.rect(0, VH - 4, VW, 4, m);
  app.gfx.rect(0, 0, 4, VH, m);
  app.gfx.rect(VW - 4, 0, 4, VH, m);
  app.gfx.text("^", VW / 2, 6, 30, m, CENTER, false);
  app.gfx.text("v", VW / 2, VH - 34, 26, m, CENTER, false);
  app.gfx.text("<", 10, VH / 2 - 18, 30, m, LEFT, false);
  app.gfx.text(">", VW - 10, VH / 2 - 18, 30, m, RIGHT, false);

  float w = 500, x = VW / 2 - w / 2, y = 52;
  card(x, y, w, 370, col::cream, 22);
  app.gfx.text(app.firstRun ? "First, fit the picture to your TV" : "TV borders", VW / 2, y + 10, app.firstRun ? 24 : 28, col::ink, CENTER, false);
  app.gfx.textBox("Line the yellow frame up with the edges of your TV: add borders until you can see all of it.", x + 30, y + 46, w - 60, 15,
                  col::grey, CENTER);
  static const char* shapes[3] = {"Wii setting", "16:9", "4:3"};
  std::string shape = shapes[app.screenShape];
  if (app.screenShape == 0) shape += app.tvWide ? " (16:9)" : " (4:3)";
  auto pct = [](int v) { return v == 0 ? std::string("None") : std::to_string(v) + "%"; };
  auto move = [](int v, const char* neg, const char* pos) {
    return v == 0 ? std::string("Centre") : std::to_string(std::abs(v)) + " " + (v < 0 ? neg : pos);
  };
  std::string values[SE_ROWS] = {pct(app.borderX), pct(app.borderY), move(app.shiftX, "left", "right"), move(app.shiftY, "up", "down"),
                                 shape, "", ""};
  static const char* labels[SE_ROWS] = {"Left & right borders", "Top & bottom borders", "Move left / right", "Move up / down",
                                        "Picture shape", "Reset to full screen", "Done"};
  for (int i = 0; i < SE_ROWS; i++) {
    float ry = y + 92 + i * 38;
    if (i == row_) app.gfx.panel(x + 20, ry, w - 40, 34, col::gold.alpha(0.85f), 12);
    bool action = i >= SE_RESET;
    app.gfx.text(labels[i], action ? VW / 2 : x + 38, ry + 7, 19, col::ink, action ? CENTER : LEFT, false);
    if (!action) app.gfx.text("<  " + values[i] + "  >", x + w - 38, ry + 7, 19, col::ink, RIGHT, false);
  }
  prompts(VW / 2, y + 374, {{B_A, "OK"}, {B_B, "Done"}});
}

}  // namespace ui

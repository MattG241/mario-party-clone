#include "Ui.h"

#include <cmath>

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
      default: return "?";
    }
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

}  // namespace ui

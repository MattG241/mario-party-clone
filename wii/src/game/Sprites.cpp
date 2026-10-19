#include "Sprites.h"

#include <cmath>
#include <cstring>
#include <string>

#include "Data.h"

using namespace data;

namespace spr {

static const AnimDef* findAnim(int c, const char* anim) {
  const CharacterDef& d = CHARACTERS[c];
  for (int i = 0; i < d.animCount; i++)
    if (!strcmp(d.anims[i].name, anim)) return &d.anims[i];
  return &d.anims[0];
}

int animIndex(int c, const char* anim) { return (int)(findAnim(c, anim) - CHARACTERS[c].anims); }
int animLength(int c, const char* anim) { return findAnim(c, anim)->count; }
float animSeconds(int c, const char* anim) {
  const AnimDef* a = findAnim(c, anim);
  return a->count / (float)(a->fps > 0 ? a->fps : 8);
}

void character(int c, const char* anim, float t, float x, float y, float scale, bool flip, Color tint) {
  if (c < 0 || c >= CHARACTER_COUNT) return;
  const AnimDef* a = findAnim(c, anim);
  int f = (int)(t * (a->fps > 0 ? a->fps : 8));
  f = a->loop ? f % a->count : (f < a->count ? f : a->count - 1);
  if (f < 0) f = 0;
  int cell = a->cells[f];
  int cols = CHARACTERS[c].cols;
  Tex* t_ = app.gfx.tex(std::string("chars/") + CHARACTERS[c].id + ".png");
  SDL_Rect src{(cell % cols) * CELL, (cell / cols) * CELL, CELL, CELL};
  app.gfx.sprite(t_, src, x, y, scale, scale, (flip ? CELL - FEET_X : FEET_X) / CELL, FEET_Y / CELL, 0, flip, tint);
}

void cast(int castIdx, int pose, float x, float y, float scale, bool flip, Color tint) {
  // the Wii edition's extra side characters (thief, banker, villain) have their own sheet
  bool extra = castIdx >= CAST_COUNT;
  Tex* t = app.gfx.tex(extra ? "cast_extra.png" : "cast.png");
  int cell = (extra ? castIdx - CAST_COUNT : castIdx) * 6 + pose;
  SDL_Rect src{(cell % 6) * CELL, (cell / 6) * CELL, CELL, CELL};
  app.gfx.sprite(t, src, x, y, scale, scale, (flip ? CELL - FEET_X : FEET_X) / CELL, FEET_Y / CELL, 0, flip, tint);
}

void portrait(int c, float x, float y, float size, Color tint) {
  Tex* t = app.gfx.tex(std::string("portraits/") + CHARACTERS[c].id + ".png");
  app.gfx.image(t, x - size / 2, y - size / 2, size, size, tint);
}

void space(int type, float x, float y, float scale, Color tint) {
  Tex* t = app.gfx.tex("spaces.png");
  SDL_Rect src{type * 64, 0, 64, 50};
  app.gfx.sprite(t, src, x, y, scale, scale, 0.5f, 0.5f, 0, false, tint);
}

void coin(float x, float y, float scale, float t) {
  Tex* tx = app.gfx.tex("items.png");
  int f = ((int)(t * 12)) % 6;
  SDL_Rect src{f * 48, 0, 48, 48};
  app.gfx.sprite(tx, src, x, y, scale, scale);
}

void star(float x, float y, float scale, float angle, Color tint) {
  Tex* t = app.gfx.tex("star.png");
  SDL_Rect src{0, 0, t->w, t->h};
  app.gfx.sprite(t, src, x, y, scale, scale, 0.5f, 0.5f, angle, false, tint);
}

void itemIcon(int item, float x, float y, float scale) {
  if (item < 0 || item >= ITEM_COUNT) return;
  int cell = ITEMS[item].icon;
  if (cell < 0) {
    app.gfx.circle(x, y, 18 * scale, col::gold);
    app.gfx.text(std::string(1, ITEMS[item].name[0]), x, y - 12 * scale, (int)(22 * scale), col::ink, CENTER, false);
    return;
  }
  Tex* t = app.gfx.tex("items.png");
  SDL_Rect src{cell * 48, 0, 48, 48};
  app.gfx.sprite(t, src, x, y, scale, scale);
}

void shadow(float x, float y, float w, float alpha) { app.gfx.ellipse(x, y, w * 0.5f, w * 0.17f, Color(0, 0, 0, (unsigned char)(alpha * 255))); }

}  // namespace spr

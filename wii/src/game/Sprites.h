// Drawing the game's sprites: characters (feet-anchored cells), the board cast, spaces, coins, items.
#pragma once
#include "../core/Platform.h"

namespace spr {
constexpr int CELL = 96;
constexpr float FEET_X = 48, FEET_Y = 75;

int animIndex(int character, const char* anim);
int animLength(int character, const char* anim);         // frames
float animSeconds(int character, const char* anim);      // one pass
// Draw a character with its feet at (x, y). t: seconds into the animation.
void character(int c, const char* anim, float t, float x, float y, float scale = 1.0f, bool flip = false, Color tint = col::white);
// A board cast member (data::CAST index) in one of its six poses.
void cast(int castIdx, int pose, float x, float y, float scale = 1.0f, bool flip = false, Color tint = col::white);
void portrait(int c, float x, float y, float size, Color tint = col::white);
void space(int type, float x, float y, float scale = 1.0f, Color tint = col::white);
void coin(float x, float y, float scale, float t);
void star(float x, float y, float scale, float angle = 0, Color tint = col::white);
void itemIcon(int item, float x, float y, float scale);
void shadow(float x, float y, float w, float alpha = 0.35f);
}  // namespace spr

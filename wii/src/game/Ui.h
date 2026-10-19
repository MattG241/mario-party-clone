// Shared UI pieces: cards, button prompts, banners, the dialogue box, list menus, the player HUD.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "../core/Platform.h"

namespace ui {

const char* glyph(Btn b);  // what the button is called on this platform (Wii Remote sideways: 2 / 1)
void card(float x, float y, float w, float h, Color fill = col::cream, float radius = 16);
void button(float x, float y, Btn b, float r = 13);
// "(2) Roll" style prompt; returns the width used.
float prompt(float x, float y, Btn b, const std::string& label, Color c = col::white);
// A row of prompts centred at x.
void prompts(float cx, float y, const std::vector<std::pair<Btn, std::string>>& items, Color c = col::white);
void banner(const std::string& title, const std::string& sub, Color accent, float t, float hold);
void fadeRect(float alpha);

// Scenes ------------------------------------------------------------------------------------------
class Scene {
 public:
  virtual ~Scene() = default;
  virtual void enter() {}
  virtual void update(float dt) = 0;
  virtual void draw() = 0;
};
void go(std::unique_ptr<Scene> next);  // fade to another scene
Scene* current();
void tick(float dt);  // update + transition
void render();

}  // namespace ui

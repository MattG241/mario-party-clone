#include "Minigame.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>

#include "../game/Sprites.h"
#include "../game/Ui.h"

static std::map<std::string, MinigameFactory>& registry() {
  static std::map<std::string, MinigameFactory> r;
  return r;
}

MinigameRegistrar::MinigameRegistrar(const char* id, MinigameFactory f) { registry()[id] = f; }

std::unique_ptr<Minigame> createMinigame(const char* id) {
  auto it = registry().find(id);
  return it == registry().end() ? nullptr : it->second();
}

bool hasMinigame(const char* id) { return registry().count(id) > 0; }

int minigameIndex(const char* id) {
  for (int i = 0; i < data::MINIGAME_COUNT; i++)
    if (!strcmp(data::MINIGAMES[i].id, id)) return i;
  return -1;
}

static const Pad kNoPad{};
const Pad& Minigame::pad(int i) const { return players_[i].cpu ? kNoPad : app.input.pad[players_[i].slot]; }

void Minigame::drawArena() const {
  if (def_ && def_->arena[0]) app.gfx.image(app.gfx.tex(def_->arena), 0, 0, VW, VH);
  else app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
}

void Minigame::drawTimer(float left) const {
  int s = (int)std::ceil(left < 0 ? 0 : left);
  ui::card(VW / 2 - 40, 12, 80, 40, s <= 5 ? col::coral : col::cream, 20);
  app.gfx.text(std::to_string(s), VW / 2, 16, 30, s <= 5 ? col::white : col::ink, CENTER, false);
}

void Minigame::drawScores(const std::vector<int>& sc, const char* unit) const {
  int n = count();
  float w = 150, gap = 10, total = n * w + (n - 1) * gap;
  float x0 = VW / 2 - total / 2;
  for (int i = 0; i < n; i++) {
    float x = x0 + i * (w + gap), y = VH - 52;
    ui::card(x, y, w, 38, col::cream.alpha(0.95f), 19);
    app.gfx.circle(x + 19, y + 19, 17, color(i));
    spr::portrait(player(i).character, x + 19, y + 19, 32);
    std::string label = std::to_string(i < (int)sc.size() ? sc[i] : 0) + (unit[0] ? std::string(" ") + unit : "");
    app.gfx.text(label, x + 44, y + 8, 20, col::ink, LEFT, false);
  }
}

void Minigame::drawPlayerTag(int i, float x, float y) const {
  Color c = color(i);
  app.gfx.panel(x - 15, y - 11, 30, 20, c, 10);
  app.gfx.text(isCpu(i) ? "CPU" : ("P" + std::to_string(player(i).slot + 1)), x, y - 9, isCpu(i) ? 12 : 15, col::white, CENTER, false);
}

// ---------------------------------------------------------------------------------------------

void MinigameHost::begin(const char* id, const std::vector<MgPlayer>& players, uint32_t seed) {
  id_ = id;
  players_ = players;
  int idx = minigameIndex(id);
  def_ = idx >= 0 ? &data::MINIGAMES[idx] : nullptr;
  // free the previous minigame's arena and props (texture memory is tight on the Wii)
  game_.reset();
  app.gfx.drop("mg/");
  game_ = createMinigame(id);
  logf("minigame %s at %.1f s", id, app.time);
  if (!game_) {
    // unknown minigame: everyone ties
    places_.assign(players.size(), 1);
    phase_ = DONE;
    return;
  }
  game_->setup(players, seed, def_);
  ready_.assign(players.size(), false);
  for (size_t i = 0; i < players.size(); i++) ready_[i] = players[i].cpu;
  phase_ = CARD;
  t_ = 0;
  app.audio.music("minigame");
}

void MinigameHost::update(float dt) {
  t_ += dt;
  switch (phase_) {
    case CARD: {
      bool all = true;
      for (size_t i = 0; i < players_.size(); i++) {
        if (!players_[i].cpu && app.input.pad[players_[i].slot].press(B_A)) {
          if (!ready_[i]) app.audio.sfx("confirm");
          ready_[i] = true;
        }
        all = all && ready_[i];
      }
      // all-CPU games (demo) wait a moment so the card can be read
      if (all && t_ > 2.5f) {
        phase_ = COUNTDOWN;
        t_ = 0;
      }
      break;
    }
    case COUNTDOWN:
      if ((int)(t_ - dt) != (int)t_ && t_ < 3) app.audio.sfx("tick");
      if (t_ >= 3.0f) {
        phase_ = PLAY;
        t_ = 0;
        app.audio.sfx("go");
      }
      break;
    case PLAY:
      game_->update(dt);
      if (game_->finished()) {
        phase_ = FINISH;
        t_ = 0;
        app.audio.sfx("finish");
      }
      break;
    case FINISH:
      if (t_ > 1.6f) {
        places_ = std::vector<int>(players_.size(), 1);
        auto sc = game_->scores();
        std::vector<int> order(sc.size());
        for (size_t i = 0; i < sc.size(); i++) order[i] = (int)i;
        // places from scores (ties share)
        for (size_t i = 0; i < sc.size(); i++) {
          int better = 0;
          for (size_t j = 0; j < sc.size(); j++)
            if (sc[j] > sc[i]) better++;
          places_[i] = better + 1;
        }
        phase_ = RESULTS;
        t_ = 0;
        app.audio.sfx("fanfare");
      }
      break;
    case RESULTS:
      if (t_ > 1.0f && (app.input.anyPress(B_A) || t_ > 5.0f)) {
        phase_ = DONE;
      }
      break;
    case DONE: break;
  }
}

void MinigameHost::draw() {
  if (!game_) return;
  if (phase_ == CARD) {
    game_->drawIntro();
    ui::fadeRect(0.45f);
    Color accent = def_ ? Color::hex(def_->color) : col::teal;
    ui::card(70, 40, VW - 140, VH - 80, col::cream, 22);
    app.gfx.panel(70, 40, VW - 140, 64, accent, 22);
    app.gfx.rect(70, 82, VW - 140, 22, accent);
    app.gfx.text(def_ ? def_->name : id_, VW / 2, 50, 34, col::white, CENTER, true);
    if (def_) {
      app.gfx.text(def_->tagline, VW / 2, 116, 20, accent.mix(col::ink, 0.4f), CENTER, false);
      float y = 152;
      for (int k = 0; k < 4; k++) {
        if (!def_->instructions[k] || !def_->instructions[k][0]) continue;
        app.gfx.circle(110, y + 11, 6, accent);
        y += app.gfx.textBox(def_->instructions[k], 126, y, VW - 260, 18, col::ink) + 8;
      }
    }
    // who's ready
    int n = (int)players_.size();
    for (int i = 0; i < n; i++) {
      float x = VW / 2 + (i - (n - 1) / 2.0f) * 120, y = VH - 150;
      app.gfx.circle(x, y + 20, 26, ready_[i] ? PLAYER_COLORS[players_[i].slot] : col::grey);
      spr::portrait(players_[i].character, x, y + 20, 44);
      app.gfx.text(ready_[i] ? "Ready!" : "...", x, y + 50, 16, ready_[i] ? col::green : col::grey, CENTER, false);
    }
    ui::prompts(VW / 2, VH - 76, {{B_A, "Ready"}}, col::ink);
    return;
  }
  game_->draw();
  if (phase_ == COUNTDOWN) {
    int n = 3 - (int)t_;
    float k = t_ - (int)t_;
    float s = 1.6f - easeOut(k) * 0.6f;
    app.gfx.text(std::to_string(n), VW / 2, VH / 2 - 60 * s, 96, col::white.alpha(1 - k * 0.5f), CENTER, true, s);
  } else if (phase_ == PLAY && t_ < 0.8f) {
    app.gfx.text("GO!", VW / 2, VH / 2 - 60, 96, col::gold.alpha(1 - t_ / 0.8f), CENTER, true);
  } else if (phase_ == FINISH) {
    float k = clampf(t_ / 0.3f, 0, 1);
    if (k > 0.05f) app.gfx.text("FINISH!", VW / 2, VH / 2 - 60 * easeBack(k), 80, col::white, CENTER, true, easeBack(k));
  } else if (phase_ == RESULTS) {
    ui::fadeRect(0.5f);
    int n = (int)players_.size();
    ui::card(VW / 2 - 230, 70, 460, 80 + n * 64, col::cream, 20);
    app.gfx.text("RESULTS", VW / 2, 84, 30, col::ink, CENTER, false);
    std::vector<int> order(n);
    for (int i = 0; i < n; i++) order[i] = i;
    std::sort(order.begin(), order.end(), [&](int a, int b) { return places_[a] < places_[b]; });
    static const char* ord[4] = {"1st", "2nd", "3rd", "4th"};
    for (int k = 0; k < n; k++) {
      int i = order[k];
      float y = 130 + k * 64;
      app.gfx.panel(VW / 2 - 210, y, 420, 54, places_[i] == 1 ? col::gold.alpha(0.6f) : col::white, 14);
      app.gfx.text(ord[std::min(3, places_[i] - 1)], VW / 2 - 190, y + 12, 26, col::ink, LEFT, false);
      app.gfx.circle(VW / 2 - 110, y + 27, 22, PLAYER_COLORS[players_[i].slot]);
      spr::portrait(players_[i].character, VW / 2 - 110, y + 27, 38);
      app.gfx.text(data::CHARACTERS[players_[i].character].name, VW / 2 - 80, y + 6, 20, col::ink, LEFT, false);
      app.gfx.text(game_->scoreLabel(i), VW / 2 - 80, y + 29, 16, col::grey, LEFT, false);
    }
  }
}

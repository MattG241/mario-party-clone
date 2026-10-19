// Minigames mode: pick any minigame from the list and play it with the players from the setup screen.
#include <cmath>

#include "../core/Util.h"
#include "../game/Session.h"
#include "../game/Sprites.h"
#include "../minigames/Minigame.h"

namespace {

constexpr int VISIBLE = 7;

class MinigameMenu : public ui::Scene {
 public:
  void enter() override {
    app.audio.music("board");
    if (!session.forceMinigame.empty()) {
      int i = minigameIndex(session.forceMinigame.c_str());
      if (i >= 0) sel_ = i;
      play();
    } else if (session.tour) nextTour();
  }

  std::vector<MgPlayer> players() const {
    std::vector<MgPlayer> v;
    for (int s : session.activeSlots()) {
      const Slot& sl = session.slots[s];
      v.push_back(MgPlayer{s, sl.character, !sl.human, sl.cpuLevel});
    }
    return v;
  }

  // tests: the next minigame that's been ported, or quit after the last
  void nextTour() {
    while (tour_ < data::MINIGAME_COUNT && !hasMinigame(data::MINIGAMES[tour_].id)) tour_++;
    if (tour_ >= data::MINIGAME_COUNT) {
      app.input.quit = true;
      return;
    }
    sel_ = tour_++;
    play();
  }

  void play() {
    playing_ = true;
    host_.begin(data::MINIGAMES[sel_].id, players(), (uint32_t)(SDL_GetTicks() * 2654435761u) ^ (uint32_t)sel_);
  }

  void update(float dt) override {
    t_ += dt;
    if (playing_) {
      host_.update(dt);
      if (host_.done()) {
        playing_ = false;
        app.audio.music("board");
        auto places = host_.places();
        auto act = session.activeSlots();
        for (size_t i = 0; i < places.size() && i < act.size(); i++)
          if (places[i] == 1) wins_[act[i]]++;
        // headless tests play one game and stop
        if (!session.forceMinigame.empty()) app.input.quit = true;
        if (session.tour) nextTour();
      }
      return;
    }
    int n = data::MINIGAME_COUNT;
    if (app.input.anyPress(B_UP)) sel_ = (sel_ + n - 1) % n, app.audio.sfx("move");
    if (app.input.anyPress(B_DOWN)) sel_ = (sel_ + 1) % n, app.audio.sfx("move");
    if (app.input.anyPress(B_LEFT)) sel_ = std::max(0, sel_ - VISIBLE), app.audio.sfx("move");
    if (app.input.anyPress(B_RIGHT)) sel_ = std::min(n - 1, sel_ + VISIBLE), app.audio.sfx("move");
    if (app.input.anyPress(B_X)) {
      std::vector<int> ok;
      for (int i = 0; i < n; i++)
        if (hasMinigame(data::MINIGAMES[i].id)) ok.push_back(i);
      if (!ok.empty()) sel_ = ok[rng_.range(0, (int)ok.size() - 1)], app.audio.sfx("move");
    }
    if (app.input.anyPress(B_A)) {
      if (hasMinigame(data::MINIGAMES[sel_].id)) {
        app.audio.sfx("confirm");
        play();
      } else app.audio.sfx("bad");
    }
    if (app.input.anyPress(B_B)) ui::go(makeTitle());
    // keep the selection on screen
    if (sel_ < top_) top_ = sel_;
    if (sel_ >= top_ + VISIBLE) top_ = sel_ - VISIBLE + 1;
  }

  void draw() override {
    if (playing_) {
      host_.draw();
      return;
    }
    app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
    app.gfx.text("Minigames", 34, 16, 38, col::white, LEFT, true);
    // win tally
    auto act = session.activeSlots();
    for (size_t k = 0; k < act.size(); k++) {
      int s = act[k];
      float x = VW - 40 - (act.size() - 1 - k) * 92, y = 36;
      ui::card(x - 40, y - 22, 84, 44, col::cream.alpha(0.95f), 22);
      app.gfx.circle(x - 18, y, 18, PLAYER_COLORS[s]);
      spr::portrait(session.slots[s].character, x - 18, y, 34);
      spr::star(x + 12, y, 0.4f);
      app.gfx.text(std::to_string(wins_[s]), x + 30, y - 12, 20, col::ink, CENTER, false);
    }

    // the list
    int n = data::MINIGAME_COUNT;
    for (int r = 0; r < VISIBLE && top_ + r < n; r++) {
      int i = top_ + r;
      const auto& m = data::MINIGAMES[i];
      float y = 80 + r * 50;
      bool on = i == sel_, ok = hasMinigame(m.id);
      ui::card(30, y, 300, 42, on ? col::gold : col::cream.alpha(ok ? 0.95f : 0.7f), 21);
      app.gfx.circle(52, y + 21, 11, Color::hex(m.color));
      app.gfx.text(m.name, 72, y + 9, 21, ok ? col::ink : col::grey, LEFT, false);
    }
    if (top_ > 0) app.gfx.text("^", 180, 64, 18, col::white, CENTER, true);
    if (top_ + VISIBLE < n) app.gfx.text("v", 180, 80 + VISIBLE * 50 - 6, 18, col::white, CENTER, true);

    // the detail card
    const auto& m = data::MINIGAMES[sel_];
    Color accent = Color::hex(m.color);
    float x = 350, y = 80, w = VW - 380, h = 344;
    ui::card(x, y, w, h, col::cream, 20);
    if (m.arena[0]) {
      Tex* a = app.gfx.tex(m.arena);
      app.gfx.image(a, x + 12, y + 12, w - 24, (w - 24) * VH / VW);
    }
    float ty = y + 12 + (w - 24) * VH / VW + 8;
    app.gfx.text(m.name, x + w / 2, ty, 26, accent.mix(col::ink, 0.35f), CENTER, false);
    app.gfx.textBox(m.tagline, x + 20, ty + 34, w - 40, 17, col::ink, CENTER);
    if (!hasMinigame(m.id)) app.gfx.text("Coming soon", x + w / 2, ty + 64, 18, col::grey, CENTER, false);
    else app.gfx.text(minigameControls(&m), x + w / 2, ty + 68, 17, col::teal, CENTER, false);

    ui::prompts(VW / 2, VH - 38, {{B_A, "Play"}, {B_X, "Random"}, {B_B, "Back"}});
  }

 private:
  MinigameHost host_;
  bool playing_ = false;
  int sel_ = 0, top_ = 0, tour_ = 0;
  int wins_[4] = {};
  float t_ = 0;
  Random rng_{(uint32_t)SDL_GetTicks() + 7};
};

}  // namespace

std::unique_ptr<ui::Scene> makeMinigameMenu() { return std::make_unique<MinigameMenu>(); }

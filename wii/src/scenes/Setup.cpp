// Character select: each controller presses A to join and picks a character; the empty seats are CPUs.
#include <algorithm>
#include <cmath>

#include "../core/Util.h"
#include "../game/Session.h"
#include "../game/Sprites.h"

namespace {

const char* LEVELS[3] = {"Easy", "Normal", "Hard"};

class Setup : public ui::Scene {
 public:
  explicit Setup(bool mg) : mg_(mg) {}

  void enter() override {
    app.audio.music("title");
    Random r(SDL_GetTicks() + 3);
    std::vector<int> pool;
    for (int c = 0; c < data::CHARACTER_COUNT; c++) pool.push_back(c);
    r.shuffle(pool);
    for (int i = 0; i < 4; i++) {
      Slot& s = session.slots[i];
      // keep the last picks when coming back from the board menu
      if (s.character < 0 || s.character >= data::CHARACTER_COUNT) s.character = pool[i];
      s.active = true;
      locked_[i] = false;
    }
    session.slots[0].human = true;
    level_ = std::max(0, std::min(2, session.slots[1].cpuLevel));
    session.minigameMode = mg_;
  }

  bool takenByOther(int c, int me) const {
    for (int i = 0; i < 4; i++)
      if (i != me && session.slots[i].human && session.slots[i].character == c) return true;
    return false;
  }

  void cycle(int i, int dir) {
    int c = session.slots[i].character;
    for (int k = 0; k < data::CHARACTER_COUNT; k++) {
      c = (c + dir + data::CHARACTER_COUNT) % data::CHARACTER_COUNT;
      if (!takenByOther(c, i)) break;
    }
    session.slots[i].character = c;
    anim_[i] = 0;
    app.audio.sfx("move");
  }

  // CPUs never wear a character a human (or an earlier CPU) already has
  void fixCpus() {
    std::vector<bool> used(data::CHARACTER_COUNT, false);
    for (int i = 0; i < 4; i++)
      if (session.slots[i].human) used[session.slots[i].character] = true;
    for (int i = 0; i < 4; i++) {
      Slot& s = session.slots[i];
      if (s.human) continue;
      while (used[s.character]) s.character = (s.character + 1) % data::CHARACTER_COUNT;
      used[s.character] = true;
    }
  }

  void update(float dt) override {
    t_ += dt;
    for (int i = 0; i < 4; i++) anim_[i] += dt;
    fixCpus();
    bool allLocked = true;
    for (int i = 0; i < 4; i++)
      if (session.slots[i].human && !locked_[i]) allLocked = false;

    for (int i = 0; i < 4; i++) {
      const Pad& p = app.input.pad[i];
      Slot& s = session.slots[i];
      if (!s.human) {
        if (p.press(B_A) || p.press(B_START)) {
          s.human = true;
          locked_[i] = false;
          if (takenByOther(s.character, i)) cycle(i, 1);
          app.audio.sfx("confirm");
        }
        continue;
      }
      if (!locked_[i]) {
        if (p.press(B_LEFT)) cycle(i, -1);
        if (p.press(B_RIGHT)) cycle(i, 1);
        if (p.press(B_UP)) cycle(i, -6);
        if (p.press(B_DOWN)) cycle(i, 6);
        if (p.press(B_A)) {
          locked_[i] = true;
          anim_[i] = 0;
          app.audio.sfx("confirm");
        }
        if (p.press(B_B)) {
          if (i == 0) {
            ui::go(makeTitle());
            return;
          }
          s.human = false;
          app.audio.sfx("back");
        }
      } else {
        if (p.press(B_B)) locked_[i] = false, app.audio.sfx("back");
        else if (i == 0 && allLocked && (p.press(B_A) || p.press(B_START))) {
          begin();
          return;
        }
      }
      if (i == 0 && p.press(B_X)) {
        level_ = (level_ + 1) % 3;
        app.audio.sfx("move");
      }
    }
  }

  void begin() {
    // CPUs take characters nobody else has
    std::vector<bool> used(data::CHARACTER_COUNT, false);
    for (int i = 0; i < 4; i++)
      if (session.slots[i].human) used[session.slots[i].character] = true;
    for (int i = 0; i < 4; i++) {
      Slot& s = session.slots[i];
      s.active = true;
      s.cpuLevel = level_;
      if (s.human) continue;
      int c = s.character;
      while (used[c]) c = (c + 1) % data::CHARACTER_COUNT;
      s.character = c;
      used[c] = true;
    }
    app.audio.sfx("confirm");
    ui::go(mg_ ? makeMinigameMenu() : makeBoardSelect());
  }

  void draw() override {
    app.gfx.image(app.gfx.tex("ui/select.png"), 0, 0, VW, VH);
    app.gfx.text(mg_ ? "Minigames: choose your characters" : "Choose your characters", VW / 2, 12, 30, col::white, CENTER, true);

    // the roster strip
    int n = data::CHARACTER_COUNT;
    float cell = std::min(46.0f, (VW - 40.0f) / n);
    float x0 = VW / 2 - cell * n / 2;
    for (int c = 0; c < n; c++) {
      float x = x0 + c * cell + cell / 2, y = 70;
      int who = -1;
      for (int i = 0; i < 4; i++)
        if (session.slots[i].human && session.slots[i].character == c) who = i;
      app.gfx.circle(x, y, cell / 2 - 1, who >= 0 ? PLAYER_COLORS[who] : col::cream.alpha(0.85f));
      spr::portrait(c, x, y, cell - 8);
    }

    // each seat stands on one of the four drums
    static const float DX[4] = {160, 337, 516, 693};
    for (int i = 0; i < 4; i++) {
      const Slot& s = session.slots[i];
      float cx = DX[i], fy = 258;
      Color pc = PLAYER_COLORS[i];
      app.gfx.panel(cx - 72, 98, 144, 28, s.human ? pc : col::grey.alpha(0.9f), 14);
      app.gfx.text(s.human ? ("Player " + std::to_string(i + 1)) : ("CPU  " + std::string(LEVELS[level_])), cx, 101, 19, col::white, CENTER, false);
      app.gfx.ellipse(cx, fy, 50, 12, pc.alpha(s.human ? 0.45f : 0.2f));
      const char* anim = s.human && locked_[i] ? "cheer" : "idle";
      spr::character(s.character, anim, anim_[i], cx, fy, 1.75f, false, s.human ? col::white : Color(215, 215, 215));
      std::string name = data::CHARACTERS[s.character].name;
      ui::card(cx - 82, 326, 164, 32, col::cream.alpha(0.95f), 16);
      app.gfx.text(name, cx, 331, name.size() > 14 ? 15 : 18, col::ink, CENTER, false);
      if (s.human && !locked_[i]) {
        float b = std::sin(t_ * 6) * 3;
        app.gfx.text("<", cx - 74 - b, 170, 34, col::white, CENTER, true);
        app.gfx.text(">", cx + 74 + b, 170, 34, col::white, CENTER, true);
        ui::card(cx - 52, 366, 104, 32, col::white.alpha(0.9f), 16);
        ui::prompt(cx - 40, 369, B_A, "OK", col::ink);
      } else if (s.human) {
        app.gfx.panel(cx - 52, 366, 104, 32, col::green, 16);
        app.gfx.text("Ready!", cx, 370, 19, col::white, CENTER, false);
      } else {
        ui::card(cx - 52, 366, 104, 32, col::white.alpha(0.75f), 16);
        ui::prompt(cx - 44, 369, B_A, "Join", col::grey);
      }
    }
    bool allLocked = true;
    for (int i = 0; i < 4; i++)
      if (session.slots[i].human && !locked_[i]) allLocked = false;
    if (allLocked) {
      float a = 0.6f + 0.4f * std::sin(t_ * 4);
      ui::card(VW / 2 - 130, 402, 260, 34, col::gold.alpha(a), 17);
      ui::prompt(VW / 2 - 70, 407, B_A, "Let's party!", col::ink);
    }
    ui::prompts(VW / 2, VH - 38, {{B_X, std::string("CPU: ") + LEVELS[level_]}, {B_B, "Back"}});
  }

 private:
  bool mg_;
  bool locked_[4] = {};
  float anim_[4] = {};
  int level_ = 1;
  float t_ = 0;
};

// ---------------------------------------------------------------------------------------------

const int ROUNDS[] = {5, 10, 15, 20};

class BoardSelect : public ui::Scene {
 public:
  void enter() override {
    sel_ = std::max(0, std::min(data::BOARD_COUNT - 1, session.board));
    for (int i = 0; i < 4; i++)
      if (ROUNDS[i] == session.rounds) r_ = i;
  }
  void update(float dt) override {
    t_ += dt;
    int n = data::BOARD_COUNT;
    if (app.input.anyPress(B_UP)) sel_ = (sel_ + n - 1) % n, app.audio.sfx("move");
    if (app.input.anyPress(B_DOWN)) sel_ = (sel_ + 1) % n, app.audio.sfx("move");
    if (app.input.anyPress(B_LEFT)) r_ = (r_ + 3) % 4, app.audio.sfx("move");
    if (app.input.anyPress(B_RIGHT)) r_ = (r_ + 1) % 4, app.audio.sfx("move");
    if (app.input.anyPress(B_B)) ui::go(makeSetup(false));
    if (app.input.anyPress(B_A) || app.input.anyPress(B_START)) {
      session.board = sel_;
      session.rounds = ROUNDS[r_];
      app.audio.sfx("confirm");
      ui::go(makeBoard());
    }
  }
  void draw() override {
    app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
    app.gfx.text("Choose a board", 34, 16, 34, col::white, LEFT, true);
    int n = data::BOARD_COUNT;
    for (int i = 0; i < n; i++) {
      const auto& b = data::BOARDS[i];
      float y = 72 + i * 50;
      bool on = i == sel_;
      ui::card(30, y, 260, 42, on ? col::gold : col::cream.alpha(0.92f), 21);
      app.gfx.text(b.name, 50, y + 9, 22, col::ink, LEFT, false);
    }
    const auto& b = data::BOARDS[sel_];
    float x = 310, y = 72, w = VW - 334;
    ui::card(x, y, w, 312, col::cream, 20);
    Tex* pv = app.gfx.tex(std::string("boards/") + b.id + "/preview.png");
    float ph = 186, pw = ph * 1.5f;
    app.gfx.image(pv, x + w / 2 - pw / 2, y + 10, pw, ph);
    app.gfx.text(b.subtitle, x + w / 2, y + ph + 14, 16, col::teal, CENTER, false);
    app.gfx.textBox(b.description, x + 16, y + ph + 38, w - 32, 14, col::ink);
    // rounds
    float ry = 392;
    ui::card(VW / 2 - 150, ry, 300, 36, col::cream, 18);
    app.gfx.text("<", VW / 2 - 130, ry + 3, 24, col::teal, CENTER, false);
    app.gfx.text(std::to_string(ROUNDS[r_]) + " rounds", VW / 2, ry + 5, 22, col::ink, CENTER, false);
    app.gfx.text(">", VW / 2 + 130, ry + 3, 24, col::teal, CENTER, false);
    ui::prompts(VW / 2, VH - 38, {{B_A, "Start"}, {B_B, "Back"}});
  }

 private:
  int sel_ = 0, r_ = 1;
  float t_ = 0;
};

}  // namespace

std::unique_ptr<ui::Scene> makeSetup(bool mg) { return std::make_unique<Setup>(mg); }
std::unique_ptr<ui::Scene> makeBoardSelect() { return std::make_unique<BoardSelect>(); }

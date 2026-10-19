// How to Play: the Wii Remote's buttons, the board game, and minigames / multiplayer, one page each.
#include <cmath>

#include "../core/Util.h"
#include "../game/Session.h"
#include "../game/Sprites.h"

namespace {

constexpr int PAGES = 4;

class HowTo : public ui::Scene {
 public:
  void update(float dt) override {
    t_ += dt;
    if (app.input.anyPress(B_RIGHT) || app.input.anyPress(B_A)) {
      if (page_ + 1 < PAGES) page_++, app.audio.sfx("move");
      else if (app.input.anyPress(B_A)) back();
    }
    if (app.input.anyPress(B_LEFT) && page_ > 0) page_--, app.audio.sfx("move");
    if (app.input.anyPress(B_B)) {
      if (page_ > 0) page_--, app.audio.sfx("back");
      else back();
    }
  }

  void back() {
    app.audio.sfx("back");
    ui::go(makeTitle());
  }

  // A Wii Remote held sideways, D-pad on the left, with its buttons labelled.
  void remote(float cx, float cy) {
    float w = 380, h = 92, x = cx - w / 2, y = cy - h / 2;
    app.gfx.panel(x - 3, y - 3, w + 6, h + 6, Color(170, 178, 190), 30);
    app.gfx.panel(x, y, w, h, col::white, 28);
    // the pointer end
    app.gfx.panel(x + 4, y + 18, 14, h - 36, Color(40, 44, 52), 6);
    // D-pad
    float dx = x + 70, dy = cy;
    app.gfx.rect(dx - 24, dy - 8, 48, 16, Color(60, 64, 72));
    app.gfx.rect(dx - 8, dy - 24, 16, 48, Color(60, 64, 72));
    // A (an extra OK)
    app.gfx.circle(x + 132, cy, 17, Color(200, 205, 212));
    app.gfx.text("A", x + 132, cy - 11, 18, Color(90, 96, 106), CENTER, false);
    // - HOME +
    app.gfx.circle(x + 192, cy - 22, 9, Color(210, 214, 220));
    app.gfx.text("-", x + 192, cy - 33, 18, Color(90, 96, 106), CENTER, false);
    app.gfx.circle(x + 192, cy, 10, Color(120, 170, 230));
    app.gfx.text("H", x + 192, cy - 9, 14, col::white, CENTER, false);
    app.gfx.circle(x + 192, cy + 22, 9, Color(210, 214, 220));
    app.gfx.text("+", x + 192, cy + 11, 18, Color(90, 96, 106), CENTER, false);
    // 1 and 2
    app.gfx.circle(x + 268, cy, 19, Color(200, 205, 212));
    app.gfx.text("1", x + 268, cy - 13, 22, Color(90, 96, 106), CENTER, false);
    app.gfx.circle(x + 322, cy, 19, Color(200, 205, 212));
    app.gfx.text("2", x + 322, cy - 13, 22, Color(90, 96, 106), CENTER, false);
    // the B trigger sits underneath, behind the D-pad
    app.gfx.panel(dx - 22, y + h + 4, 44, 12, Color(200, 205, 212), 6);
    app.gfx.text("B", dx, y + h + 14, 13, col::white, CENTER, true);
  }

  // one row of the button legend: a button icon, its name and what it does
  void legend(float x, float y, const char* icon, const std::string& name, const std::string& what, bool dpad = false) {
    if (dpad) {
      app.gfx.rect(x - 14, y - 5, 28, 10, Color(60, 64, 72));
      app.gfx.rect(x - 5, y - 14, 10, 28, Color(60, 64, 72));
    } else {
      app.gfx.circle(x, y, 16, col::white);
      app.gfx.circle(x, y, 14, Color(200, 205, 212));
      app.gfx.text(icon, x, y - 11, icon[1] ? 13 : 19, Color(70, 76, 86), CENTER, false);
    }
    app.gfx.text(name, x + 26, y - 20, 18, col::gold, LEFT, true);
    app.gfx.text(what, x + 26, y + 1, 15, col::white, LEFT, true);
  }

  void pageControls() {
    app.gfx.text("Hold the Wii Remote sideways, D-pad on the left", VW / 2, 78, 22, col::white, CENTER, true);
    remote(VW / 2, 170);
    float l = 120, r = 470, y = 268;
    legend(l, y, "", "D-pad", "Move, aim and choose", true);
    legend(l, y + 50, "2", "2", "OK, and each game's main action");
    legend(l, y + 100, "1", "1", "Back, and second actions");
    legend(r, y, "B", "B trigger (underneath)", "Extra: CPU level, zoom the map");
    legend(r, y + 50, "+", "+", "Pause the board game");
    legend(r, y + 100, "H", "HOME", "Quit to the Homebrew Channel");
    app.gfx.text("A Nunchuk (stick, A, B), Classic Controller or GameCube controller works too.", VW / 2, 404, 15, col::white, CENTER, true);
  }

  void pageBoard() {
    app.gfx.text("The board game", VW / 2, 76, 24, col::white, CENTER, true);
    float y = 116;
    auto line = [&](const std::string& s) {
      app.gfx.circle(64, y + 10, 5, col::gold);
      y += app.gfx.textBox(s, 78, y, 380, 16, col::white) + 8;
    };
    line("On your turn, press 2 to hit the Dice Block, then move that many spaces (1 to 10).");
    line("At a fork, choose the way with the D-pad and press 2.");
    line("Use items from your bag before you roll: pick them from your turn menu.");
    line("After every round everyone plays a minigame: 1st place wins 10 coins.");
    line("Most Star Coins at the end wins (coins break ties). Bonus Star Coins are handed out at the very end!");
    // the spaces
    struct S {
      int type;
      const char* what;
    };
    static const S spaces[] = {{data::SP_BLUE, "Blue: +3 coins"},
                               {data::SP_LUCKY, "Lucky: a good surprise"},
                               {data::SP_BADLUCK, "Bad luck: watch out!"},
                               {data::SP_HAPPENING, "!: the board's own event"},
                               {data::SP_SHOP, "Shop: buy items"},
                               {data::SP_WARP, "Warp: jump across the board"},
                               {data::SP_STAR, "Star Coin: 20 coins each"}};
    ui::card(484, 108, 330, 312, col::cream.alpha(0.95f), 18);
    for (int i = 0; i < 7; i++) {
      float sy = 130 + i * 41;
      spr::space(spaces[i].type, 520, sy + 10, 0.62f);
      app.gfx.text(spaces[i].what, 552, sy, 17, col::ink, LEFT, false);
    }
  }

  void pageRules() {
    app.gfx.text("Teams, surprises and bonus stars", VW / 2, 76, 24, col::white, CENTER, true);
    float y = 112;
    auto line = [&](Color dot, const std::string& s) {
      app.gfx.circle(70, y + 10, 7, dot);
      y += app.gfx.textBox(s, 88, y, VW - 170, 16, col::white) + 9;
    };
    line(Color::hex(0x3b7cf0), "Where your turn ends picks your side for the round's minigame: blue spaces make you blue, red spaces red, and any other space joins a side at random.");
    line(Color::hex(0xe5484d), "All one colour: everyone for themselves. Three and one: 1 vs 3. Two and two: 2 vs 2. Every team winner gets 10 coins.");
    line(col::coral, "Red spaces cost 3 coins (sometimes worse!). Lucky spaces can start CHANCE TIME, a DUEL or a BATTLE.");
    line(col::gold, "Chance Time: stop the three blocks with 2 to see who gives what to whom: coins, Star Coins, or a swap!");
    line(col::purple, "Battle: everyone pays into a pot; the winner takes 70% and second place 30%. Duel: bet coins against one rival.");
    line(col::green, "Last 5 turns: the trailing player gets a boost and the party wheel spins. At the end: Minigame Star, Coin Star and Happening Star!");
  }

  void pageParty() {
    app.gfx.text("Players and minigames", VW / 2, 76, 24, col::white, CENTER, true);
    float y = 118;
    auto line = [&](const std::string& s) {
      app.gfx.circle(84, y + 10, 5, col::gold);
      y += app.gfx.textBox(s, 98, y, VW - 200, 17, col::white) + 12;
    };
    line("Up to 4 players, one Wii Remote each: on the character screen, each player presses 2 to join and picks with the D-pad.");
    line("Seats nobody joins are played by CPUs. Press B (the trigger) there to make them easier or harder.");
    line("Every minigame starts with a rules card that shows its controls. Press 2 when you're ready.");
    line("Minigames on the title menu lets you play any minigame you like, straight away.");
    line("Press + during the board game to pause, set the TV borders, or quit.");
    line("If your TV cuts off the edges, use TV Borders on the title menu.");
    // everyone's here
    for (int i = 0; i < 4; i++) spr::character((i * 5 + 2) % data::CHARACTER_COUNT, "wave", t_ + i * 0.3f, 300 + i * 84, 424, 0.75f);
  }

  void draw() override {
    app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
    ui::fadeRect(0.45f);
    app.gfx.text("How to Play", VW / 2, 18, 34, col::white, CENTER, true);
    if (page_ == 0) pageControls();
    else if (page_ == 1) pageBoard();
    else if (page_ == 2) pageRules();
    else pageParty();
    for (int i = 0; i < PAGES; i++) app.gfx.circle(VW / 2 - 20 + i * 20, 62, 5, i == page_ ? col::gold : col::white.alpha(0.5f));
    ui::prompts(VW / 2, VH - 40, {{B_A, page_ + 1 < PAGES ? "Next" : "Done"}, {B_B, page_ > 0 ? "Previous" : "Back"}});
  }

 private:
  int page_ = 0;
  float t_ = 0;
};

}  // namespace

std::unique_ptr<ui::Scene> makeHowTo() { return std::make_unique<HowTo>(); }

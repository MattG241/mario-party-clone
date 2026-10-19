// The board game: draws the board, the players and the cast, and presents the rules engine (Match) through
// its IO interface: every IO call is a coroutine that animates, shows a box or a menu, and waits for the
// players (or for a moment, when it's a CPU's call).
#include <algorithm>
#include <cmath>
#include <cstring>

#include "../core/Util.h"
#include "../game/Session.h"
#include "../game/Sprites.h"
#include "../minigames/Minigame.h"

namespace {

using co::Task;

constexpr float K = 0.4f;  // board pixels -> art pixels (data::BOARD_K)
constexpr float TOKEN_SCALE = 1.1f;
const char* ORD[4] = {"1st", "2nd", "3rd", "4th"};

struct V2 {
  float x, y;
};

struct Token {
  float x = 0, y = 0;
  float hop = 0;  // height above the ground
  float anim = 0;
  const char* pose = "idle";
  float poseT = 0;  // pose resets to idle after this many seconds (0: keep)
  bool flip = false;
  bool moving = false;
  float scale = 1;
};

struct Popup {
  std::string text;
  int slot;  // over a player (-1: at x, y)
  float x, y;
  float t;
  Color c;
  int icon;  // 0 none, 1 coin, 2 star, 3+ item icon (item + 3)
};

struct Menu {
  bool open = false;
  int owner = 0;  // player index
  std::string title;
  std::vector<std::string> rows, notes;
  std::vector<int> icons;  // item per row, -1 none
  std::vector<bool> enabled;
  int sel = 0;
  bool cancel = false;
  int result = -2;  // -2 pending, -1 cancelled
  bool path = false;
  int at = -1;
  std::vector<int> pathTo;
};

enum Overlay { OV_NONE, OV_ORDER, OV_REWARDS, OV_AWARD, OV_RESULTS };

class Board : public ui::Scene, public IO {
 public:
  void enter() override {
    app.gfx.drop("boards/");
    app.audio.music("board");
    Match& m = session.match;
    m = Match();
    std::vector<Player> ps;
    for (int s : session.activeSlots()) {
      Player p;
      p.slot = s;
      p.character = session.slots[s].character;
      p.cpu = !session.slots[s].human;
      p.cpuLevel = session.slots[s].cpuLevel;
      ps.push_back(p);
      if (!p.cpu) anyHuman_ = true;
    }
    m.init(session.board, session.rounds, ps, SDL_GetTicks() * 2654435761u + 17);
    m.io = this;
    def_ = m.g.def;
    for (auto& p : m.players) {
      V2 a = nodeArt(p.node);
      tok_[p.slot].x = a.x;
      tok_[p.slot].y = a.y;
    }
    V2 s = nodeArt(m.players[0].node);
    camX_ = s.x, camY_ = s.y;
    zoom_ = zoomTgt_ = fitZoom();
    run_ = runMatch(m);
    run_.start();
  }

  // --- geometry ---------------------------------------------------------------------------------
  Match& M() { return session.match; }
  V2 nodeArt(int n) const {
    const auto& d = def_->nodes[n];
    return {d.x * K, d.y * K};
  }
  V2 toScreen(float ax, float ay) const { return {(ax - camX_) * zoom_ + VW / 2, (ay - camY_) * zoom_ + VH / 2}; }
  float fitZoom() const { return std::min((float)VW / def_->artW, (float)VH / def_->artH) * 1.02f; }
  Player* bySlot(int slot) {
    for (auto& p : M().players)
      if (p.slot == slot) return &p;
    return nullptr;
  }
  bool humanTurn() const { return turn_ && !turn_->cpu; }

  // Where a token stands when it isn't moving: its node, nudged aside when sharing it.
  V2 restPos(const Player& p) {
    V2 a = nodeArt(p.node);
    int here = 0, idx = 0;
    for (auto& q : M().players)
      if (q.node == p.node) {
        if (&q == &p) idx = here;
        here++;
      }
    if (here > 1) {
      static const V2 off[4] = {{-15, -5}, {15, -5}, {-15, 9}, {15, 9}};
      a.x += off[idx].x, a.y += off[idx].y;
    }
    return a;
  }

  // --- waiting helpers --------------------------------------------------------------------------
  // Wait for any human to press A (after a short guard), or a moment when only CPUs are playing.
  Task<> waitAdvance(float autoSecs) {
    float t = 0;
    while (true) {
      co_await co::nextFrame();
      t += co::Scheduler::get().dt();
      if (t < 0.25f) continue;
      if (anyHuman_ ? app.input.anyPress(B_A) : t >= autoSecs) break;
      if (anyHuman_ && t >= autoSecs * 4) break;
    }
  }
  Task<> wait(float s) { co_await co::wait(s); }
  void focusPlayer(const Player& p) {
    focusSlot_ = p.slot;
    focusNode_ = -1;
  }
  void focusNode(int n) {
    focusNode_ = n;
    focusSlot_ = -1;
  }
  void showBanner(const std::string& t, const std::string& s, Color c, float hold) {
    banTitle_ = t, banSub_ = s, banColor_ = c, banT_ = 0, banHold_ = hold;
  }
  void pop(const std::string& text, int slot, Color c, int icon = 0) { pops_.push_back({text, slot, 0, 0, 0, c, icon}); }
  void popAt(const std::string& text, int node, Color c) {
    V2 a = nodeArt(node);
    pops_.push_back({text, -1, a.x, a.y - 30, 0, c, 0});
  }
  void setPose(int slot, const char* pose, float secs) {
    tok_[slot].pose = pose;
    tok_[slot].anim = 0;
    tok_[slot].poseT = secs;
  }

  // A list menu driven by the owner's controller (or walked by the CPU to its pick).
  Task<int> runMenu(Menu mu, int cpuPick) {
    mu.open = true;
    mu.result = -2;
    menu_ = mu;
    const Player& p = M().players[menu_.owner];
    if (p.cpu) {
      co_await co::wait(0.5f);
      if (cpuPick < 0) {
        menu_.open = false;
        co_return -1;
      }
      while (menu_.sel != cpuPick) {
        menu_.sel += cpuPick > menu_.sel ? 1 : -1;
        app.audio.sfx("move", 0.6f);
        co_await co::wait(0.2f);
      }
      co_await co::wait(0.4f);
      app.audio.sfx("confirm");
      menu_.open = false;
      co_return cpuPick;
    }
    co_await co::until([this] { return menu_.result != -2; });
    menu_.open = false;
    co_return menu_.result;
  }

  // --- IO ---------------------------------------------------------------------------------------
  Task<> roundStart(int round, int total, bool final) override {
    if (round == 1 && !introDone_) {
      introDone_ = true;
      zoomTgt_ = fitZoom();
      focusNode_ = -1, focusSlot_ = -1;
      camTgt_ = {def_->artW / 2.0f, def_->artH / 2.0f};
      showBanner(def_->name, def_->subtitle, col::teal, 2.2f);
      co_await co::wait(2.8f);
      co_await say({{R_HOST, P_WAVE, std::string("Welcome to ") + def_->name + "! Collect the most Star Coins to win the party!"},
                    {R_HOST, P_POINT, fmt("Each Star Coin costs %d coins. We'll play %d rounds, with a minigame after every round!", STAR_PRICE, total)}},
                   nullptr);
      zoomTgt_ = 1;
    }
    focusPlayer(M().players[0]);
    if (final) {
      boardMusic_ = "final";
      app.audio.music(boardMusic_);
    }
    if (final) showBanner("FINAL ROUND!", "Make it count", col::coral, 1.2f);
    else showBanner(fmt("ROUND %d", round), fmt("of %d", total), col::teal, 1.0f);
    app.audio.sfx("go");
    co_await co::wait(1.7f);
  }

  Task<> headline(std::string title, std::string sub) override {
    showBanner(title, sub, col::purple, 1.3f);
    co_await co::wait(1.9f);
  }

  Task<> turnStart(Player& p) override {
    turn_ = &p;
    zoomTgt_ = 1;
    focusPlayer(p);
    showBanner(std::string(p.name()) + "'s turn", p.cpu ? "CPU" : fmt("Player %d", p.slot + 1), PLAYER_COLORS[p.slot], 0.7f);
    setPose(p.slot, "wave", 1.2f);
    co_await co::wait(1.2f);
  }

  Task<> turnEnd(Player& p) override {
    stepsLeft_ = -1;
    co_await co::wait(0.35f);
    turn_ = nullptr;
  }

  Task<int> preRoll(Player& p, std::vector<int> usable, int cpu) override {
    if (p.cpu && cpu < 0) {
      co_await co::wait(0.3f);
      co_return -1;
    }
    while (true) {
      Menu mu;
      mu.owner = M().playerIndex(p);
      mu.title = "Your move";
      mu.rows.push_back("Roll the dice");
      mu.icons.push_back(-1);
      mu.notes.push_back("");
      mu.enabled.push_back(true);
      for (int it : usable) {
        mu.rows.push_back(std::string("Use ") + data::ITEMS[it].name);
        mu.icons.push_back(it);
        mu.notes.push_back("");
        mu.enabled.push_back(true);
      }
      int mapRow = (int)mu.rows.size();
      if (!p.cpu) {
        mu.rows.push_back("View the map");
        mu.icons.push_back(-1);
        mu.notes.push_back("");
        mu.enabled.push_back(true);
      }
      int cpuRow = 0;
      for (size_t i = 0; i < usable.size(); i++)
        if (usable[i] == cpu) cpuRow = (int)i + 1;
      int r = co_await runMenu(mu, cpuRow);
      if (r == mapRow && !p.cpu) {
        mapView_ = true;
        mapOwner_ = p.slot;
        focusSlot_ = -1, focusNode_ = -1;
        camTgt_ = {camX_, camY_};
        co_await co::until([this] { return !mapView_; });
        focusPlayer(p);
        continue;
      }
      if (r <= 0) co_return -1;
      co_return usable[r - 1];
    }
  }

  Task<int> chooseTarget(Player& p, std::string prompt, std::vector<Target> opts, int cpu) override {
    Menu mu;
    mu.owner = M().playerIndex(p);
    mu.title = prompt;
    mu.cancel = true;
    for (auto& o : opts) {
      mu.rows.push_back(o.label);
      mu.icons.push_back(-1);
      mu.notes.push_back("");
      mu.enabled.push_back(true);
    }
    targets_ = opts;
    int r = co_await runMenu(mu, cpu);
    targets_.clear();
    focusPlayer(p);
    co_return r;
  }

  Task<int> chooseDiscard(Player& p, int incoming, int cpu) override {
    std::vector<int> all = p.items;
    all.push_back(incoming);
    Menu mu;
    mu.owner = M().playerIndex(p);
    mu.title = "Bag full! Toss one item";
    for (int it : all) {
      mu.rows.push_back(data::ITEMS[it].name);
      mu.icons.push_back(it);
      mu.notes.push_back(it == incoming ? "new" : "");
      mu.enabled.push_back(true);
    }
    int cpuRow = (int)all.size() - 1;
    for (size_t i = 0; i < all.size(); i++)
      if (all[i] == cpu) cpuRow = (int)i;
    int r = co_await runMenu(mu, cpuRow);
    co_return all[std::max(0, r)];
  }

  Task<> rollDice(Player& p, int result, int bonus) override {
    focusPlayer(p);
    dice_ = true;
    diceSlot_ = p.slot;
    diceHit_ = false;
    diceT_ = 0;
    if (p.cpu) co_await co::wait(0.7f + 0.3f * (float)rng_.next());
    else co_await co::until([&p] { return app.input.pad[p.slot].press(B_A); });
    diceHit_ = true;
    diceShown_ = result;
    diceT_ = 0;
    setPose(p.slot, "jump", 0.5f);
    app.audio.sfx("dice");
    co_await co::wait(0.75f);
    if (bonus > 0) {
      pop(fmt("+%d", bonus), p.slot, col::gold);
      co_await co::wait(0.5f);
    }
    dice_ = false;
    if (turn_ == &p) stepsLeft_ = result + bonus, stepsSlot_ = p.slot;
    else orderRoll_[p.slot] = result;
  }

  Task<bool> offerReroll(Player& p, int result, int cpu) override {
    Menu mu;
    mu.owner = M().playerIndex(p);
    mu.title = fmt("You rolled %d. Use a Bean to roll again?", result);
    mu.rows = {"Keep it", "Roll again"};
    mu.icons = {-1, IT_BEAN};
    mu.notes = {"", ""};
    mu.enabled = {true, true};
    int r = co_await runMenu(mu, cpu > 0 ? 1 : 0);
    co_return r == 1;
  }

  Task<int> choosePath(Player& p, int at, std::vector<PathOpt> opts, int cpu) override {
    Menu mu;
    mu.owner = M().playerIndex(p);
    mu.title = "Which way?";
    mu.path = true;
    mu.at = at;
    for (auto& o : opts) {
      mu.rows.push_back(o.label + (o.needsKey && !p.has(IT_KEY) ? " (locked)" : ""));
      mu.icons.push_back(-1);
      mu.notes.push_back("");
      mu.enabled.push_back(!(o.needsKey && !p.has(IT_KEY)));
      mu.pathTo.push_back(o.to);
    }
    int first = 0;
    while (first < (int)opts.size() - 1 && !mu.enabled[first]) first++;
    mu.sel = first;
    int r = co_await runMenu(mu, cpu);
    co_return std::max(0, r);
  }

  Task<int> shop(Player& p, int shopIdx, std::vector<int> items, int cpu) override {
    const auto& s = data::SHOPS[shopIdx];
    Role who = !strcmp(s.id, "pipper") ? R_SHOP2 : R_SHOP1;
    co_await say({{who, P_WAVE, fmt("Welcome to %s! Take a look.", s.name)}}, &p);
    Menu mu;
    mu.owner = M().playerIndex(p);
    mu.title = s.name;
    mu.cancel = true;
    for (int it : items) {
      mu.rows.push_back(data::ITEMS[it].name);
      mu.icons.push_back(it);
      mu.notes.push_back(fmt("%d", data::ITEMS[it].price));
      mu.enabled.push_back(p.coins >= data::ITEMS[it].price);
    }
    mu.rows.push_back("No thanks");
    mu.icons.push_back(-1);
    mu.notes.push_back("");
    mu.enabled.push_back(true);
    int cpuRow = (int)items.size();
    for (size_t i = 0; i < items.size(); i++)
      if (items[i] == cpu) cpuRow = (int)i;
    shopItems_ = items;
    int r = co_await runMenu(mu, cpuRow);
    shopItems_.clear();
    if (r < 0 || r >= (int)items.size()) {
      co_await say({{who, P_IDLE, "Come back any time!"}}, &p);
      co_return -1;
    }
    co_await say({{who, P_HAPPY, fmt("One %s, coming up! Thanks!", data::ITEMS[items[r]].name)}}, &p);
    co_return items[r];
  }

  Task<bool> offerStar(Player& p, int price, bool cpu) override {
    focusPlayer(p);
    co_await say({{R_KEEPER, P_WAVE, fmt("You made it! Would you like a Star Coin for %d coins?", price)}}, &p);
    Menu mu;
    mu.owner = M().playerIndex(p);
    mu.title = fmt("Buy a Star Coin for %d coins?", price);
    mu.rows = {"Yes please!", "No thanks"};
    mu.icons = {-1, -1};
    mu.notes = {"", ""};
    mu.enabled = {true, true};
    int r = co_await runMenu(mu, cpu ? 0 : 1);
    co_return r == 0;
  }

  Task<> moveStep(Player& p, int from, int to, int remaining) override {
    Token& t = tok_[p.slot];
    V2 a{t.x, t.y}, b = nodeArt(to);
    t.moving = true;
    t.pose = "run";
    if (std::fabs(b.x - a.x) > 2) t.flip = b.x < a.x;
    float dur = 0.26f, e = 0;
    while (e < dur) {
      co_await co::nextFrame();
      e += co::Scheduler::get().dt();
      float k = clampf(e / dur, 0, 1);
      t.x = lerpf(a.x, b.x, k);
      t.y = lerpf(a.y, b.y, k);
      t.hop = std::sin(k * 3.14159f) * 10;
    }
    t.hop = 0;
    stepsLeft_ = remaining;
    stepsSlot_ = p.slot;
    app.audio.sfx("step", 0.5f);
    if (remaining <= 0) t.pose = "idle";
    t.moving = false;
  }

  Task<> jumpTo(Player& p, int from, int to, JumpKind kind) override {
    Token& t = tok_[p.slot];
    V2 a{t.x, t.y}, b = nodeArt(to);
    t.moving = true;
    app.audio.sfx("whoosh");
    if (kind == J_WARP) {
      for (float e = 0; e < 0.3f; e += co::Scheduler::get().dt()) {
        t.scale = 1 - e / 0.3f;
        co_await co::nextFrame();
      }
      t.x = b.x, t.y = b.y;
      t.scale = 0;
      co_await co::wait(0.35f);
      for (float e = 0; e < 0.3f; e += co::Scheduler::get().dt()) {
        t.scale = e / 0.3f;
        co_await co::nextFrame();
      }
      t.scale = 1;
    } else {
      t.pose = kind == J_FALL ? "fall" : "jump";
      float dist = std::hypot(b.x - a.x, b.y - a.y);
      float dur = clampf(0.5f + dist / 900, 0.6f, 1.3f), e = 0;
      if (std::fabs(b.x - a.x) > 2) t.flip = b.x < a.x;
      while (e < dur) {
        co_await co::nextFrame();
        e += co::Scheduler::get().dt();
        float k = clampf(e / dur, 0, 1);
        t.x = lerpf(a.x, b.x, easeInOut(k));
        t.y = lerpf(a.y, b.y, easeInOut(k));
        t.hop = std::sin(k * 3.14159f) * std::min(160.0f, 40 + dist * 0.25f);
      }
      t.hop = 0;
      t.pose = "idle";
    }
    t.moving = false;
  }

  Task<> landed(Player& p, int node) override {
    stepsLeft_ = -1;
    flashNode_ = node;
    flashT_ = 0;
    int type = def_->nodes[node].type;
    app.audio.sfx(type == data::SP_BADLUCK ? "bad" : (type == data::SP_BLUE ? "coin" : "land"));
    co_await co::wait(0.35f);
  }

  Task<> coins(Player& p, int delta) override {
    if (delta == 0) co_return;
    pop(fmt(delta > 0 ? "+%d" : "%d", delta), p.slot, delta > 0 ? col::gold : col::red, 1);
    app.audio.sfx(delta > 0 ? "coin" : "bad");
    if (delta < 0) setPose(p.slot, "loseCoins", 0.9f);
    else if (delta >= 5) setPose(p.slot, "coins", 0.9f);
    co_await co::wait(0.85f);
  }

  Task<> starGained(Player& p, int source) override {
    focusPlayer(p);
    setPose(p.slot, "victory", 2.2f);
    pop("+1", p.slot, col::gold, 2);
    app.audio.sfx("fanfare");
    showBanner("STAR COIN!", std::string(p.name()) + (source == 1 ? " wins a Bonus Star Coin!" : " got a Star Coin!"), col::gold, 1.4f);
    co_await co::wait(2.3f);
  }

  Task<> starMoved(int from, int to) override {
    int back = focusSlot_;
    focusNode(to);
    showBanner("The Star Coin moved!", "", col::gold, 1.0f);
    app.audio.sfx("whoosh");
    co_await co::wait(1.8f);
    focusSlot_ = back;
    focusNode_ = -1;
  }

  Task<> item(Player& p, int it, int kind) override {
    static const char* verb[4] = {"Got", "Used", "Lost", "Tossed"};
    pop(std::string(verb[kind]) + " " + data::ITEMS[it].name + "!", p.slot, kind == 0 ? col::teal : (kind == 1 ? col::purple : col::grey), it + 3);
    app.audio.sfx(kind == 2 ? "bad" : "item");
    co_await co::wait(1.0f);
  }

  Task<> shield(Player& p, bool block) override {
    pop(block ? "Shield blocked it!" : "Shield up!", p.slot, col::blue);
    app.audio.sfx("item");
    co_await co::wait(0.9f);
  }

  Task<> trap(bool spring, int node, int owner, Player* victim) override {
    focusNode(node);
    popAt(spring ? "Snare sprung!" : "Snare set!", node, col::coral);
    app.audio.sfx(spring ? "bad" : "item");
    if (victim) setPose(victim->slot, "stunned", 1.0f);
    co_await co::wait(1.1f);
    if (turn_) focusPlayer(*turn_);
  }

  Task<> event(std::string title, int kind, std::vector<Line> lines, int focus, Player* p) override {
    static const Color kc[4] = {col::green, col::purple, col::teal, col::gold};
    showBanner(title, "", kc[std::max(0, std::min(3, kind))], 0.9f);
    app.audio.sfx(kind == 1 ? "bad" : "event");
    if (p) setPose(p->slot, kind == 1 ? "surprised" : "cheer", 1.0f);
    co_await co::wait(1.4f);
    if (focus >= 0) {
      focusNode(focus);
      co_await co::wait(0.6f);
    }
    co_await say(std::move(lines), p);
    if (turn_) focusPlayer(*turn_);
  }

  Task<> say(std::vector<Line> lines, Player* p) override {
    for (auto& l : lines) {
      line_ = l;
      talking_ = true;
      talkT_ = 0;
      co_await waitAdvance(1.4f + l.text.size() * 0.025f);
      app.audio.sfx("move", 0.4f);
    }
    talking_ = false;
  }

  Task<> hiddenBlock(Player& p, bool star) override {
    focusPlayer(p);
    showBanner("HIDDEN BLOCK!", star ? "A Star Coin was inside!" : "Coins inside!", col::gold, 0.9f);
    setPose(p.slot, "jump", 0.6f);
    app.audio.sfx("event");
    co_await co::wait(1.4f);
  }

  Task<> orderDecided() override {
    overlay_ = OV_ORDER;
    ovT_ = 0;
    co_await waitAdvance(2.4f);
    overlay_ = OV_NONE;
    for (auto& r : orderRoll_) r = 0;
  }

  Task<std::vector<int>> playMinigame() override {
    Match& m = M();
    // choose: the board's own world first, then any; avoid the last few played
    std::vector<std::string> pool, local;
    for (int i = 0; i < data::MINIGAME_COUNT; i++) {
      const char* id = data::MINIGAMES[i].id;
      if (!hasMinigame(id)) continue;
      bool recent = false;
      for (size_t k = m.mgHistory.size() > 4 ? m.mgHistory.size() - 4 : 0; k < m.mgHistory.size(); k++)
        if (m.mgHistory[k] == id) recent = true;
      if (recent) continue;
      pool.push_back(id);
      if (!strcmp(data::MINIGAMES[i].world, def_->world)) local.push_back(id);
    }
    if (pool.empty())
      for (int i = 0; i < data::MINIGAME_COUNT; i++)
        if (hasMinigame(data::MINIGAMES[i].id)) pool.push_back(data::MINIGAMES[i].id);
    if (pool.empty()) co_return std::vector<int>(m.players.size(), 1);
    std::string id = (!local.empty() && rng_.chance(0.55)) ? rng_.pick(local) : rng_.pick(pool);
    if (!session.forceMinigame.empty() && hasMinigame(session.forceMinigame.c_str())) id = session.forceMinigame;
    m.mgHistory.push_back(id);
    int idx = minigameIndex(id.c_str());
    // roulette
    roulette_ = true;
    rouletteT_ = 0;
    roulettePool_ = pool;
    rouletteId_ = id;
    app.audio.sfx("event");
    co_await co::wait(2.2f);
    showBanner("MINIGAME TIME!", idx >= 0 ? data::MINIGAMES[idx].name : id, col::coral, 1.0f);
    co_await co::wait(1.6f);
    roulette_ = false;
    std::vector<MgPlayer> mp;
    for (auto& p : m.players) mp.push_back(MgPlayer{p.slot, p.character, p.cpu, p.cpuLevel});
    host_.begin(id.c_str(), mp, m.rng.state() ^ (uint32_t)(m.round * 7919));
    mg_ = true;
    co_await co::until([this] { return host_.done(); });
    mg_ = false;
    app.audio.music(boardMusic_);
    co_return host_.places();
  }

  Task<> minigameRewards(std::vector<int> places, std::vector<int> coins) override {
    rewardPlaces_ = places;
    rewardCoins_ = coins;
    overlay_ = OV_REWARDS;
    ovT_ = 0;
    app.audio.sfx("coin");
    co_await waitAdvance(3.0f);
    overlay_ = OV_NONE;
  }

  Task<> bonusAwards(std::vector<Award> awards) override {
    showBanner("BONUS STARS!", "Three awards for the end of the party", col::gold, 1.4f);
    co_await co::wait(2.0f);
    for (auto& a : awards) {
      award_ = a;
      overlay_ = OV_AWARD;
      ovT_ = 0;
      app.audio.sfx("fanfare");
      co_await waitAdvance(3.2f);
    }
    overlay_ = OV_NONE;
  }

  Task<> finalResults() override {
    overlay_ = OV_RESULTS;
    ovT_ = 0;
    app.audio.music("results");
    app.audio.sfx("fanfare");
    if (anyHuman_) co_await waitAdvance(1e9f);
    else co_await co::wait(6.0f);
    over_ = true;
  }

  // --- frame update -----------------------------------------------------------------------------
  void update(float dt) override {
    if (paused_) {
      if (app.input.anyPress(B_UP) || app.input.anyPress(B_DOWN)) pauseSel_ ^= 1, app.audio.sfx("move");
      if (app.input.anyPress(B_START) || app.input.anyPress(B_B) || (app.input.anyPress(B_A) && pauseSel_ == 0)) {
        paused_ = false;
        co::Scheduler::get().setPaused(false);
      } else if (app.input.anyPress(B_A) && pauseSel_ == 1) {
        co::Scheduler::get().setPaused(false);
        co::Scheduler::get().clear();
        leaving_ = true;
        paused_ = false;
        ui::go(makeTitle());
      }
      return;
    }
    if (leaving_) return;
    if (mg_) {
      host_.update(dt);
      return;
    }
    if (over_) {
      over_ = false;
      leaving_ = true;
      if (session.demo) app.input.quit = true;
      else ui::go(makeTitle());
      return;
    }
    if (app.input.anyPress(B_START) && !menu_.open && !mapView_) {
      paused_ = true;
      pauseSel_ = 0;
      co::Scheduler::get().setPaused(true);
      return;
    }
    t_ += dt;
    talkT_ += dt;
    ovT_ += dt;
    diceT_ += dt;
    flashT_ += dt;
    rouletteT_ += dt;
    if (banT_ >= 0) {
      banT_ += dt;
      if (banT_ > banHold_ + 0.8f) banT_ = -1;
    }
    for (auto& p : pops_) p.t += dt;
    pops_.erase(std::remove_if(pops_.begin(), pops_.end(), [](const Popup& p) { return p.t > 1.3f; }), pops_.end());

    // tokens
    for (auto& p : M().players) {
      Token& t = tok_[p.slot];
      t.anim += dt;
      if (t.poseT > 0) {
        t.poseT -= dt;
        if (t.poseT <= 0) t.pose = "idle", t.poseT = 0;
      }
      if (!t.moving) {
        V2 r = restPos(p);
        t.x = approach(t.x, r.x, 10, dt);
        t.y = approach(t.y, r.y, 10, dt);
      }
    }

    // menu input
    if (menu_.open && !M().players[menu_.owner].cpu) {
      const Pad& pad = app.input.pad[M().players[menu_.owner].slot];
      int n = (int)menu_.rows.size();
      int d = 0;
      if (pad.press(B_UP) || (menu_.path && pad.press(B_LEFT))) d = -1;
      if (pad.press(B_DOWN) || (menu_.path && pad.press(B_RIGHT))) d = 1;
      if (d) {
        menu_.sel = (menu_.sel + d + n) % n;
        app.audio.sfx("move", 0.6f);
      }
      if (pad.press(B_A)) {
        if (menu_.enabled[menu_.sel]) {
          menu_.result = menu_.sel;
          app.audio.sfx("confirm");
        } else app.audio.sfx("bad");
      }
      if (menu_.cancel && pad.press(B_B)) {
        menu_.result = -1;
        app.audio.sfx("back");
      }
    }

    // map view
    if (mapView_) {
      const Pad& pad = app.input.pad[mapOwner_];
      camTgt_.x += pad.x * 520 * dt / zoom_;
      camTgt_.y += pad.y * 520 * dt / zoom_;
      if (pad.press(B_X)) zoomTgt_ = zoomTgt_ < 0.9f ? 1.0f : fitZoom();
      if (pad.press(B_B) || pad.press(B_A)) {
        mapView_ = false;
        zoomTgt_ = 1;
        app.audio.sfx("back");
      }
    }

    // camera
    if (focusSlot_ >= 0) camTgt_ = {tok_[focusSlot_].x, tok_[focusSlot_].y - tok_[focusSlot_].hop * 0.5f};
    else if (focusNode_ >= 0) camTgt_ = nodeArt(focusNode_);
    if (menu_.open && !targets_.empty()) {
      const Target& tg = targets_[std::min(menu_.sel, (int)targets_.size() - 1)];
      if (tg.node >= 0) camTgt_ = nodeArt(tg.node);
      else if (tg.slot >= 0) camTgt_ = {tok_[tg.slot].x, tok_[tg.slot].y};
    }
    zoom_ = approach(zoom_, zoomTgt_, 3, dt);
    float hw = VW / 2 / zoom_, hh = VH / 2 / zoom_;
    V2 tg = camTgt_;
    tg.y += 20 / zoom_;  // keep tokens clear of the dialogue box
    tg.x = def_->artW > hw * 2 ? clampf(tg.x, hw, def_->artW - hw) : def_->artW / 2.0f;
    tg.y = def_->artH > hh * 2 ? clampf(tg.y, hh - 60 / zoom_, def_->artH - hh) : def_->artH / 2.0f;
    if (mapView_) camTgt_ = tg;
    camX_ = approach(camX_, tg.x, 5, dt);
    camY_ = approach(camY_, tg.y, 5, dt);
  }

  // --- drawing ----------------------------------------------------------------------------------
  void drawBoard() {
    app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
    for (int j = 0; j < def_->artRows; j++)
      for (int i = 0; i < def_->artCols; i++) {
        float ax = i * 512.0f, ay = j * 512.0f;
        float tw = std::min(512, def_->artW - i * 512), th = std::min(512, def_->artH - j * 512);
        V2 s = toScreen(ax, ay);
        float w = tw * zoom_, h = th * zoom_;
        if (s.x > VW || s.y > VH || s.x + w < 0 || s.y + h < 0) continue;
        // overlap by a pixel so tile seams never show
        app.gfx.image(app.gfx.tex(fmt("boards/%s/t%d_%d.png", def_->id, i, j)), std::floor(s.x), std::floor(s.y), std::ceil(w) + 1, std::ceil(h) + 1);
      }
  }

  void drawSpaces() {
    Match& m = M();
    float sc = 0.62f * zoom_;
    for (int n = 0; n < def_->nodeCount; n++) {
      const auto& d = def_->nodes[n];
      V2 s = toScreen(d.x * K, d.y * K);
      if (s.x < -40 || s.x > VW + 40 || s.y < -40 || s.y > VH + 40) continue;
      bool broken = m.b.bridgeUntil >= 0 && m.g.bridgeGroup(n) == 1;
      bool surged = std::find(m.b.surge.begin(), m.b.surge.end(), n) != m.b.surge.end();
      Color tint = broken ? Color(110, 110, 120, 150) : col::white;
      spr::space(d.type, s.x, s.y, sc, tint);
      if (surged && !broken) app.gfx.ring(s.x, s.y, 20 * zoom_ + std::sin(t_ * 5) * 2, col::gold);
      if (n == flashNode_ && flashT_ < 0.6f) app.gfx.ring(s.x, s.y, (18 + flashT_ * 50) * zoom_, col::white.alpha(1 - flashT_ / 0.6f));
    }
    // locked gates: a padlock between the two spaces
    if (!(m.b.gatesOpenUntil >= m.round))
      for (auto& g : m.g.gates) {
        V2 a = nodeArt(g.first), b = nodeArt(g.second);
        V2 s = toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
        app.gfx.circle(s.x, s.y, 11 * zoom_, col::ink.alpha(0.8f));
        app.gfx.rect(s.x - 5 * zoom_, s.y - 3 * zoom_, 10 * zoom_, 8 * zoom_, col::gold);
        app.gfx.ring(s.x, s.y - 4 * zoom_, 4 * zoom_, col::gold);
      }
    // snares
    for (auto& tr : m.b.traps) {
      V2 s = toScreen(nodeArt(tr.first).x, nodeArt(tr.first).y);
      app.gfx.ring(s.x, s.y, 13 * zoom_, PLAYER_COLORS[tr.second & 3]);
      app.gfx.line(s.x - 8 * zoom_, s.y - 8 * zoom_, s.x + 8 * zoom_, s.y + 8 * zoom_, 2 * zoom_, PLAYER_COLORS[tr.second & 3]);
      app.gfx.line(s.x - 8 * zoom_, s.y + 8 * zoom_, s.x + 8 * zoom_, s.y - 8 * zoom_, 2 * zoom_, PLAYER_COLORS[tr.second & 3]);
    }
  }

  struct Drawable {
    float y;
    int kind;  // 0 token, 1 cast, 2 star
    int a, b;
    float x;
    bool flip;
  };

  void drawActors() {
    Match& m = M();
    std::vector<Drawable> list;
    // the Star Coin and its keeper
    V2 st = nodeArt(m.b.starGate);
    list.push_back({st.y - 1, 2, 0, 0, st.x, false});
    list.push_back({st.y - 4, 1, castOf(R_KEEPER), P_IDLE, st.x + 34, true});
    // shopkeepers
    for (int n = 0; n < def_->nodeCount; n++) {
      const char* s = def_->nodes[n].shop;
      if (!s || !s[0]) continue;
      V2 a = nodeArt(n);
      list.push_back({a.y - 6, 1, castOf(!strcmp(s, "pipper") ? R_SHOP2 : R_SHOP1), P_IDLE, a.x - 32, false});
    }
    for (auto& p : m.players) list.push_back({tok_[p.slot].y, 0, p.slot, p.character, tok_[p.slot].x, false});
    std::sort(list.begin(), list.end(), [](const Drawable& a, const Drawable& b) { return a.y < b.y; });
    for (auto& d : list) {
      V2 s = toScreen(d.x, d.y);
      if (s.x < -80 || s.x > VW + 80 || s.y < -40 || s.y > VH + 140) continue;
      if (d.kind == 2) {
        float bob = std::sin(t_ * 2.5f) * 4;
        app.gfx.ellipse(s.x, s.y, 16 * zoom_, 6 * zoom_, Color(0, 0, 0, 60));
        spr::star(s.x, s.y - (34 + bob) * zoom_, 0.62f * zoom_, std::sin(t_ * 1.7f) * 8);
      } else if (d.kind == 1) {
        spr::shadow(s.x, s.y, 34 * zoom_, 0.25f);
        spr::cast(d.a, d.b, s.x, s.y, 0.62f * zoom_, d.flip);
      } else {
        const Token& t = tok_[d.a];
        Player* p = bySlot(d.a);
        bool active = turn_ && p == turn_;
        if (active) app.gfx.ring(s.x, s.y, (19 + std::sin(t_ * 6)) * zoom_, PLAYER_COLORS[d.a]);
        spr::shadow(s.x, s.y, 34 * zoom_ * (1 - t.hop / 300), 0.3f);
        spr::character(d.b, t.pose, t.anim, s.x, s.y - t.hop * zoom_, TOKEN_SCALE * zoom_ * t.scale, t.flip);
        if (orderRoll_[d.a] > 0) bubble(s.x, s.y - 86 * zoom_, std::to_string(orderRoll_[d.a]), PLAYER_COLORS[d.a]);
      }
    }
  }

  void bubble(float x, float y, const std::string& s, Color c) {
    app.gfx.circle(x, y, 17, c);
    app.gfx.circle(x, y, 14, col::white);
    app.gfx.text(s, x, y - 13, 22, col::ink, CENTER, false);
  }

  void drawOverlaysOnBoard() {
    Match& m = M();
    // the dice block
    if (dice_) {
      const Token& t = tok_[diceSlot_];
      V2 s = toScreen(t.x, t.y);
      float y = s.y - 118 * zoom_ - t.hop * zoom_;
      float bounce = diceHit_ ? -easeOut(clampf(diceT_ / 0.15f, 0, 1)) * 14 * (1 - clampf((diceT_ - 0.15f) / 0.3f, 0, 1)) : std::sin(t_ * 5) * 3;
      int shown = diceHit_ ? diceShown_ : 1 + ((int)(t_ * 14)) % DICE_MAX;
      ui::card(s.x - 28, y - 28 + bounce, 56, 56, diceHit_ ? col::gold : col::white, 12);
      app.gfx.panel(s.x - 22, y - 22 + bounce, 44, 44, diceHit_ ? col::gold.mix(col::white, 0.4f) : col::blue.mix(col::white, 0.75f), 9);
      app.gfx.text(std::to_string(shown), s.x, y - 18 + bounce, 30, col::ink, CENTER, false);
      Player* p = bySlot(diceSlot_);
      if (p && !p->cpu && !diceHit_) ui::prompt(s.x - 34, y + 34, B_A, "Hit!", col::white);
    }
    // steps left
    if (stepsLeft_ > 0 && stepsSlot_ >= 0) {
      const Token& t = tok_[stepsSlot_];
      V2 s = toScreen(t.x, t.y);
      bubble(s.x, s.y - 92 * zoom_ - t.hop * zoom_, std::to_string(stepsLeft_), PLAYER_COLORS[stepsSlot_]);
    }
    // path arrows
    if (menu_.open && menu_.path) {
      V2 at = nodeArt(menu_.at);
      for (size_t i = 0; i < menu_.pathTo.size(); i++) {
        V2 to = nodeArt(menu_.pathTo[i]);
        float dx = to.x - at.x, dy = to.y - at.y, d = std::max(1.0f, std::hypot(dx, dy));
        dx /= d, dy /= d;
        bool on = (int)i == menu_.sel;
        float r = (on ? 42 : 36) + (on ? std::sin(t_ * 8) * 3 : 0);
        V2 tip = toScreen(at.x + dx * (r + 14), at.y + dy * (r + 14));
        V2 base = toScreen(at.x + dx * r, at.y + dy * r);
        Color c = !menu_.enabled[i] ? col::grey : (on ? col::gold : col::white);
        float px = -dy, py = dx, w = on ? 13 : 10;
        app.gfx.line(base.x - dx * 14 * zoom_, base.y - dy * 14 * zoom_, base.x, base.y, 7 * zoom_, c);
        for (int k = 0; k < 4; k++) {
          // a filled-ish arrowhead from a few lines
          float f = 1 - k / 4.0f;
          app.gfx.line(tip.x, tip.y, base.x + px * w * f * zoom_, base.y + py * w * f * zoom_, 4 * zoom_, c);
          app.gfx.line(tip.x, tip.y, base.x - px * w * f * zoom_, base.y - py * w * f * zoom_, 4 * zoom_, c);
        }
      }
    }
    // popups
    for (auto& p : pops_) {
      float x = p.x, y = p.y;
      if (p.slot >= 0) {
        x = tok_[p.slot].x;
        y = tok_[p.slot].y - 80;
      }
      V2 s = toScreen(x, y);
      float rise = easeOut(clampf(p.t / 0.5f, 0, 1)) * 26;
      float a = 1 - clampf((p.t - 0.9f) / 0.4f, 0, 1);
      float w = app.gfx.textWidth(p.text, 22) + (p.icon ? 30 : 0) + 20;
      ui::card(s.x - w / 2, s.y - rise - 16, w, 32, col::white.alpha(0.92f * a), 16);
      float tx = s.x - w / 2 + 10;
      if (p.icon == 1) spr::coin(tx + 12, s.y - rise, 0.42f, t_);
      else if (p.icon == 2) spr::star(tx + 12, s.y - rise, 0.3f);
      else if (p.icon >= 3) spr::itemIcon(p.icon - 3, tx + 12, s.y - rise, 0.5f);
      if (p.icon) tx += 30;
      app.gfx.text(p.text, tx, s.y - rise - 13, 22, p.c.alpha(a), LEFT, false);
    }
    (void)m;
  }

  void drawHud() {
    Match& m = M();
    auto places = standings(m.players);
    int n = (int)m.players.size();
    float w = 200, gap = (VW - 16 - w * n) / std::max(1, n - 1);
    // panels in seat order
    std::vector<int> order(n);
    for (int i = 0; i < n; i++) order[i] = i;
    std::sort(order.begin(), order.end(), [&](int a, int b) { return m.players[a].slot < m.players[b].slot; });
    for (int k = 0; k < n; k++) {
      const Player& p = m.players[order[k]];
      float x = 8 + k * (w + gap), y = 6;
      bool active = turn_ == &p;
      if (active) app.gfx.panel(x - 3, y - 3, w + 6, 58, PLAYER_COLORS[p.slot], 18);
      ui::card(x, y, w, 52, col::cream.alpha(0.95f), 16);
      app.gfx.circle(x + 26, y + 26, 22, PLAYER_COLORS[p.slot]);
      spr::portrait(p.character, x + 26, y + 26, 40);
      app.gfx.panel(x + 4, y + 36, 24, 15, col::ink, 7);
      app.gfx.text(ORD[std::min(3, places[order[k]] - 1)], x + 16, y + 36, 12, col::white, CENTER, false);
      spr::star(x + 62, y + 15, 0.26f);
      app.gfx.text(std::to_string(p.stars), x + 76, y + 3, 20, col::ink, LEFT, false);
      spr::coin(x + 116, y + 15, 0.36f, 0);
      app.gfx.text(std::to_string(p.coins), x + 130, y + 3, 20, col::ink, LEFT, false);
      for (int i = 0; i < MAX_ITEMS; i++) {
        float ix = x + 64 + i * 26, iy = y + 39;
        app.gfx.circle(ix, iy, 10, col::ink.alpha(0.12f));
        if (i < (int)p.items.size()) spr::itemIcon(p.items[i], ix, iy, 0.42f);
      }
      if (p.cpu) app.gfx.text("CPU", x + w - 22, y + 33, 13, col::grey, CENTER, false);
      else app.gfx.text(fmt("P%d", p.slot + 1), x + w - 22, y + 31, 16, PLAYER_COLORS[p.slot], CENTER, false);
    }
    // round counter
    if (talking_ || (menu_.open && !menu_.path)) return;
    ui::card(VW - 128, VH - 40, 120, 32, col::cream.alpha(0.92f), 16);
    app.gfx.text(fmt("Round %d/%d", m.round, m.rounds), VW - 68, VH - 37, 18, col::ink, CENTER, false);
  }

  void drawDialogue() {
    if (!talking_) return;
    float k = easeBack(clampf(talkT_ / 0.25f, 0, 1));
    float x = 70, y = VH - 128 + (1 - k) * 40, w = VW - 140, h = 104;
    ui::card(x, y, w, h, col::cream, 20);
    int c = castOf(line_.role);
    Color cc = Color::hex(data::CAST[c].color);
    app.gfx.circle(x + 58, y + 50, 42, cc.mix(col::white, 0.55f));
    spr::cast(c, line_.pose, x + 58, y + 98, 1.05f);
    app.gfx.panel(x + 112, y - 14, app.gfx.textWidth(castName(line_.role), 18) + 24, 28, cc, 14);
    app.gfx.text(castName(line_.role), x + 124, y - 11, 18, col::white, LEFT, false);
    app.gfx.textBox(line_.text, x + 116, y + 22, w - 140, 20, col::ink);
    if (anyHuman_ && talkT_ > 0.3f) {
      float b = std::sin(t_ * 6) * 2;
      app.gfx.text("v", x + w - 22, y + h - 28 + b, 20, col::teal, CENTER, false);
    }
  }

  void drawMenu() {
    if (!menu_.open) return;
    const Player& p = M().players[menu_.owner];
    if (menu_.path) {
      // a small caption with the highlighted way
      std::string s = menu_.rows[menu_.sel];
      float w = std::max(220.0f, app.gfx.textWidth(s, 20) + 40);
      ui::card(VW / 2 - w / 2, VH - 112, w, 70, col::cream, 18);
      app.gfx.text(menu_.title, VW / 2, VH - 106, 16, col::grey, CENTER, false);
      app.gfx.text(s, VW / 2, VH - 86, 20, menu_.enabled[menu_.sel] ? col::ink : col::grey, CENTER, false);
      if (!p.cpu) ui::prompts(VW / 2, VH - 36, {{B_A, "Go"}}, col::white);
      return;
    }
    int n = (int)menu_.rows.size();
    float w = 330, rh = 40, h = 52 + n * rh + 14;
    float x = VW - w - 24, y = std::max(70.0f, VH / 2 - h / 2 - 10);
    ui::card(x, y, w, h, col::cream, 18);
    app.gfx.panel(x, y, w, 40, PLAYER_COLORS[p.slot], 18);
    app.gfx.rect(x, y + 24, w, 16, PLAYER_COLORS[p.slot]);
    app.gfx.text(menu_.title, x + w / 2, y + 9, menu_.title.size() > 30 ? 15 : 19, col::white, CENTER, false);
    for (int i = 0; i < n; i++) {
      float ry = y + 50 + i * rh;
      bool on = i == menu_.sel;
      if (on) app.gfx.panel(x + 10, ry, w - 20, rh - 4, col::gold.alpha(0.85f), 12);
      float tx = x + 22;
      if (menu_.icons[i] >= 0) {
        spr::itemIcon(menu_.icons[i], tx + 12, ry + 18, 0.5f);
        tx += 32;
      }
      app.gfx.text(menu_.rows[i], tx, ry + 7, 19, menu_.enabled[i] ? col::ink : col::grey, LEFT, false);
      if (!menu_.notes[i].empty()) {
        bool num = isdigit((unsigned char)menu_.notes[i][0]);
        if (num) spr::coin(x + w - 66, ry + 18, 0.32f, 0);
        app.gfx.text(menu_.notes[i], x + w - 24, ry + 7, 18, col::ink, RIGHT, false);
      }
    }
    if (!shopItems_.empty() && menu_.sel < (int)shopItems_.size())
      app.gfx.textBox(data::ITEMS[shopItems_[menu_.sel]].description, x + 14, y + h + 8, w - 28, 15, col::white);
    if (!p.cpu) {
      std::vector<std::pair<Btn, std::string>> pr{{B_A, "OK"}};
      if (menu_.cancel) pr.push_back({B_B, "Back"});
      ui::prompts(x + w / 2, y + h + (shopItems_.empty() ? 10 : 52), pr);
    }
  }

  void drawOverlay() {
    Match& m = M();
    int n = (int)m.players.size();
    if (overlay_ == OV_ORDER) {
      ui::fadeRect(0.35f);
      ui::card(VW / 2 - 200, 90, 400, 70 + n * 56, col::cream, 20);
      app.gfx.text("Turn order", VW / 2, 102, 26, col::ink, CENTER, false);
      for (int i = 0; i < n; i++) {
        const Player& p = m.players[i];
        float y = 146 + i * 56;
        app.gfx.text(fmt("%d", i + 1), VW / 2 - 160, y + 8, 26, col::teal, CENTER, false);
        app.gfx.circle(VW / 2 - 110, y + 22, 22, PLAYER_COLORS[p.slot]);
        spr::portrait(p.character, VW / 2 - 110, y + 22, 40);
        app.gfx.text(p.name(), VW / 2 - 78, y + 10, 22, col::ink, LEFT, false);
      }
    } else if (overlay_ == OV_REWARDS) {
      ui::fadeRect(0.35f);
      ui::card(VW / 2 - 220, 80, 440, 70 + n * 60, col::cream, 20);
      app.gfx.text("Minigame rewards", VW / 2, 92, 26, col::ink, CENTER, false);
      std::vector<int> ord(n);
      for (int i = 0; i < n; i++) ord[i] = i;
      std::stable_sort(ord.begin(), ord.end(), [&](int a, int b) { return rewardPlaces_[a] < rewardPlaces_[b]; });
      for (int k = 0; k < n; k++) {
        int i = ord[k];
        const Player& p = m.players[i];
        float y = 134 + k * 60;
        app.gfx.text(ORD[std::min(3, rewardPlaces_[i] - 1)], VW / 2 - 190, y + 12, 24, col::ink, LEFT, false);
        app.gfx.circle(VW / 2 - 110, y + 25, 22, PLAYER_COLORS[p.slot]);
        spr::portrait(p.character, VW / 2 - 110, y + 25, 40);
        app.gfx.text(p.name(), VW / 2 - 78, y + 13, 20, col::ink, LEFT, false);
        spr::coin(VW / 2 + 130, y + 25, 0.42f, t_);
        app.gfx.text(fmt("+%d", rewardCoins_[i]), VW / 2 + 150, y + 11, 24, col::gold.mix(col::ink, 0.3f), LEFT, false);
      }
    } else if (overlay_ == OV_AWARD) {
      ui::fadeRect(0.4f);
      float k = easeBack(clampf(ovT_ / 0.35f, 0, 1));
      float w = 460 * k, h = 250 * k;
      ui::card(VW / 2 - w / 2, VH / 2 - h / 2, w, h, col::cream, 22);
      if (k < 0.95f) return;
      spr::star(VW / 2, VH / 2 - 92, 0.6f, std::sin(t_ * 2) * 10);
      app.gfx.text(award_.name, VW / 2, VH / 2 - 64, 28, col::ink, CENTER, false);
      app.gfx.text(award_.desc, VW / 2, VH / 2 - 30, 17, col::grey, CENTER, false);
      if (award_.winners.empty()) app.gfx.text("Nobody this time!", VW / 2, VH / 2 + 20, 22, col::ink, CENTER, false);
      int wn = (int)award_.winners.size();
      for (int i = 0; i < wn; i++) {
        const Player& p = m.players[award_.winners[i]];
        float x = VW / 2 + (i - (wn - 1) / 2.0f) * 110;
        app.gfx.circle(x, VH / 2 + 34, 30, PLAYER_COLORS[p.slot]);
        spr::portrait(p.character, x, VH / 2 + 34, 54);
        app.gfx.text(p.name(), x, VH / 2 + 70, 15, col::ink, CENTER, false);
      }
    } else if (overlay_ == OV_RESULTS) {
      app.gfx.image(app.gfx.tex("ui/results.png"), 0, 0, VW, VH);
      auto places = standings(m.players);
      std::vector<int> ord(n);
      for (int i = 0; i < n; i++) ord[i] = i;
      std::stable_sort(ord.begin(), ord.end(), [&](int a, int b) { return places[a] < places[b]; });
      const Player& w = m.players[ord[0]];
      app.gfx.text(std::string(w.name()) + " wins the party!", VW / 2, 18, 34, col::white, CENTER, true);
      // the podium drums: 1st in the middle, 2nd left, 3rd and 4th right
      static const float px[4] = {410, 250, 570, 735};
      static const float py[4] = {248, 296, 322, 345};
      for (int k = n - 1; k >= 0; k--) {
        const Player& p = m.players[ord[k]];
        int pl = std::min(3, places[ord[k]] - 1);
        float x = px[pl], y = py[pl];
        // tied players share a drum: nudge them apart
        int same = 0;
        for (int j = 0; j < k; j++)
          if (places[ord[j]] == places[ord[k]]) same++;
        x += same * 46;
        const char* anim = pl == 0 ? "victory" : (pl == 3 ? "disappointed" : "cheer");
        spr::character(p.character, anim, t_ + k * 0.3f, x, y, pl == 0 ? 1.9f : 1.55f);
        float cy = 398 + (same ? 36 : 0);
        ui::card(x - 74, cy, 148, 52, col::cream.alpha(0.95f), 16);
        app.gfx.circle(x - 52, cy + 26, 17, PLAYER_COLORS[p.slot]);
        app.gfx.text(ORD[pl], x - 52, cy + 16, 15, col::white, CENTER, false);
        app.gfx.text(p.name(), x + 10, cy + 4, p.name()[0] && strlen(p.name()) > 12 ? 12 : 15, col::ink, CENTER, false);
        spr::star(x - 20, cy + 37, 0.22f);
        app.gfx.text(std::to_string(p.stars), x - 8, cy + 27, 16, col::ink, LEFT, false);
        spr::coin(x + 28, cy + 37, 0.3f, 0);
        app.gfx.text(std::to_string(p.coins), x + 40, cy + 27, 16, col::ink, LEFT, false);
      }
      if (anyHuman_ && ovT_ > 1.5f) ui::prompts(VW / 2, 62, {{B_A, "Back to title"}});
    }
  }

  void drawRoulette() {
    if (!roulette_) return;
    ui::fadeRect(0.4f);
    ui::card(VW / 2 - 230, 150, 460, 150, col::cream, 22);
    app.gfx.text("Minigame roulette", VW / 2, 162, 20, col::grey, CENTER, false);
    std::string shown = rouletteId_;
    if (rouletteT_ < 1.8f && !roulettePool_.empty()) {
      // slows down as it settles
      float speed = 16 * (1 - rouletteT_ / 2.2f);
      int k = (int)(rouletteT_ * speed * 2) % (int)roulettePool_.size();
      shown = roulettePool_[k];
    }
    int idx = minigameIndex(shown.c_str());
    if (idx < 0) return;
    const auto& d = data::MINIGAMES[idx];
    app.gfx.panel(VW / 2 - 200, 196, 400, 60, Color::hex(d.color), 16);
    app.gfx.text(d.name, VW / 2, 206, 32, col::white, CENTER, true);
    app.gfx.text(d.tagline, VW / 2, 266, 16, col::ink, CENTER, false);
  }

  void draw() override {
    if (mg_) {
      host_.draw();
      return;
    }
    if (overlay_ == OV_RESULTS) {
      drawOverlay();
      return;
    }
    drawBoard();
    drawSpaces();
    drawActors();
    drawOverlaysOnBoard();
    drawHud();
    if (mapView_) {
      ui::card(VW / 2 - 210, VH - 46, 420, 36, col::cream.alpha(0.92f), 18);
      ui::prompts(VW / 2, VH - 41, {{B_B, "Done"}, {B_X, "Zoom"}}, col::ink);
      // where's the Star Coin?
      V2 s = toScreen(nodeArt(M().b.starGate).x, nodeArt(M().b.starGate).y);
      if (s.x < 0 || s.x > VW || s.y < 60 || s.y > VH) {
        float ax = clampf(s.x, 30, VW - 30), ay = clampf(s.y, 90, VH - 70);
        spr::star(ax, ay, 0.4f);
      }
    }
    drawMenu();
    drawDialogue();
    drawRoulette();
    if (overlay_ != OV_NONE) drawOverlay();
    if (banT_ >= 0) ui::banner(banTitle_, banSub_, banColor_, banT_, banHold_);
    if (paused_) {
      ui::fadeRect(0.5f);
      ui::card(VW / 2 - 150, 150, 300, 170, col::cream, 20);
      app.gfx.text("Paused", VW / 2, 164, 28, col::ink, CENTER, false);
      static const char* items[2] = {"Resume", "Quit to title"};
      for (int i = 0; i < 2; i++) {
        float y = 210 + i * 50;
        if (i == pauseSel_) app.gfx.panel(VW / 2 - 120, y, 240, 40, col::gold, 14);
        app.gfx.text(items[i], VW / 2, y + 8, 21, col::ink, CENTER, false);
      }
    }
  }

 private:
  const data::BoardDef* def_ = nullptr;
  Task<> run_;
  bool anyHuman_ = false, over_ = false, leaving_ = false, introDone_ = false;
  bool paused_ = false;
  int pauseSel_ = 0;
  const char* boardMusic_ = "board";
  float t_ = 0;
  Random rng_{(uint32_t)SDL_GetTicks() + 99};
  // camera
  float camX_ = 0, camY_ = 0, zoom_ = 1, zoomTgt_ = 1;
  V2 camTgt_{0, 0};
  int focusSlot_ = -1, focusNode_ = -1;
  bool mapView_ = false;
  int mapOwner_ = 0;
  // actors
  Token tok_[4];
  Player* turn_ = nullptr;
  int orderRoll_[4] = {};
  std::vector<Popup> pops_;
  int flashNode_ = -1;
  float flashT_ = 9;
  // dice
  bool dice_ = false, diceHit_ = false;
  int diceSlot_ = 0, diceShown_ = 1;
  float diceT_ = 0;
  int stepsLeft_ = -1, stepsSlot_ = -1;
  // boxes
  Menu menu_;
  std::vector<Target> targets_;
  std::vector<int> shopItems_;
  bool talking_ = false;
  Line line_{R_HOST, P_IDLE, ""};
  float talkT_ = 0;
  std::string banTitle_, banSub_;
  Color banColor_ = col::teal;
  float banT_ = -1, banHold_ = 1;
  Overlay overlay_ = OV_NONE;
  float ovT_ = 0;
  std::vector<int> rewardPlaces_, rewardCoins_;
  Award award_{};
  // minigames
  MinigameHost host_;
  bool mg_ = false, roulette_ = false;
  float rouletteT_ = 0;
  std::vector<std::string> roulettePool_;
  std::string rouletteId_;
};

}  // namespace

std::unique_ptr<ui::Scene> makeBoard() { return std::make_unique<Board>(); }

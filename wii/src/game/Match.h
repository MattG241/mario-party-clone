// The board game's rules: a C++ port of the web game's match flow (TurnManager / TurnFlow / EventManager /
// MatchBeats / BoardAI). The presentation layer implements IO with animations and controller input.
#pragma once
#include <map>
#include <string>
#include <vector>

#include "../core/Coro.h"
#include "../core/Util.h"
#include "Data.h"

// Items, in the order of data::ITEMS.
enum ItemId { IT_KEY, IT_CAPSULE, IT_BOOTS, IT_SHIELD, IT_SNARE, IT_WARP, IT_MAGNET, IT_BEAN, IT_COUNT };
int itemByName(const char* id);

// The board cast's roles (dialogue speakers).
enum Role { R_HOST, R_KEEPER, R_SHOP1, R_SHOP2, R_HELPER, R_COUNT };
enum Pose { P_IDLE, P_WAVE, P_CHEER, P_POINT, P_SURPRISED, P_HAPPY };
// Cast the roles from the players' characters (then the board's world, then a default line-up).
void castRoles(const std::vector<int>& characters, const char* world);
int castOf(Role r);           // index into data::CAST
const char* castName(Role r);

constexpr int DICE_MIN = 1, DICE_MAX = 10, BOOTS_BONUS = 3;
constexpr int START_COINS = 10, STAR_PRICE = 20, BLUE_COINS = 3, BLUE_FINAL = 5, MAX_ITEMS = 3, SNARE_STEAL = 5, MAGNET_STEAL = 5;
constexpr int REWARDS[4] = {10, 6, 3, 1};

struct Stats {
  int moved = 0, earned = 0, spent = 0, wins = 0, itemsUsed = 0, events = 0, lucky = 0, starsBought = 0;
};

struct Player {
  int slot = 0;       // controller / colour
  int character = 0;  // data::CHARACTERS index
  bool cpu = true;
  int cpuLevel = 1;   // 0 easy, 1 normal, 2 hard
  int node = 0;
  std::vector<int> trail;
  int coins = START_COINS, stars = 0;
  std::vector<int> items;
  bool shielded = false;
  Stats st;
  const char* name() const { return data::CHARACTERS[character].name; }
  bool has(int it) const;
};

struct Graph {
  const data::BoardDef* def = nullptr;
  std::vector<std::vector<int>> next, prev;
  std::map<std::string, int> index;
  std::vector<std::pair<int, int>> gates;
  int bridgeGroup(int n) const;  // 1 = bridge node, 2 = detour node, 0 = neither
  void build(const data::BoardDef* d);
  int id(const char* s) const;
  const data::NodeDef& node(int i) const { return def->nodes[i]; }
  int count() const { return def->nodeCount; }
};

struct BoardState {
  int starGate = 0;
  int salePrice = 0, saleUntil = -1;
  int bridgeUntil = -1;  // bridge broken until this round (-1: intact)
  std::vector<int> surge;
  int surgeUntil = -1;
  std::map<int, int> portals;
  std::vector<std::pair<int, int>> traps;  // node, owner slot
  int gatesOpenUntil = -1;
};

struct Exit {
  int to;
  bool gate;
  bool needsKey;
};

struct Line {
  Role role;
  Pose pose;
  std::string text;
};

struct PathOpt {
  int to;
  std::string label;
  bool needsKey;
};

struct Target {
  std::string label;
  int node;  // -1 none
  int slot;  // -1 none
};

struct Award {
  const char* name;
  const char* desc;
  std::vector<int> winners;  // player indices
  std::vector<int> values;   // per player
};

enum JumpKind { J_WARP, J_SWAP, J_CANNON, J_WIND, J_FALL, J_GUIDE };

struct Match;

class IO {
 public:
  virtual ~IO() = default;
  virtual co::Task<> roundStart(int round, int total, bool final) = 0;
  virtual co::Task<> headline(std::string title, std::string sub) = 0;
  virtual co::Task<> turnStart(Player& p) = 0;
  virtual co::Task<> turnEnd(Player& p) = 0;
  // -1: roll; otherwise the item to use. cpu holds the CPU's decision.
  virtual co::Task<int> preRoll(Player& p, std::vector<int> usable, int cpu) = 0;
  virtual co::Task<int> chooseTarget(Player& p, std::string prompt, std::vector<Target> opts, int cpu) = 0;  // index or -1
  virtual co::Task<int> chooseDiscard(Player& p, int incoming, int cpu) = 0;
  virtual co::Task<> rollDice(Player& p, int result, int bonus) = 0;
  virtual co::Task<bool> offerReroll(Player& p, int result, int cpu) = 0;
  virtual co::Task<int> choosePath(Player& p, int at, std::vector<PathOpt> opts, int cpu) = 0;  // index
  virtual co::Task<int> shop(Player& p, int shopIdx, std::vector<int> items, int cpu) = 0;     // item or -1
  virtual co::Task<bool> offerStar(Player& p, int price, bool cpu) = 0;
  virtual co::Task<> moveStep(Player& p, int from, int to, int remaining) = 0;
  virtual co::Task<> jumpTo(Player& p, int from, int to, JumpKind kind) = 0;
  virtual co::Task<> landed(Player& p, int node) = 0;
  virtual co::Task<> coins(Player& p, int delta) = 0;
  virtual co::Task<> starGained(Player& p, int source) = 0;  // 0 bought, 1 bonus, 2 hidden block
  virtual co::Task<> starMoved(int from, int to) = 0;
  virtual co::Task<> item(Player& p, int item, int kind) = 0;  // 0 gain, 1 use, 2 lose, 3 discard
  virtual co::Task<> shield(Player& p, bool block) = 0;
  virtual co::Task<> trap(bool spring, int node, int owner, Player* victim) = 0;
  virtual co::Task<> event(std::string title, int kind, std::vector<Line> lines, int focus, Player* p) = 0;  // kind 0 lucky 1 bad 2 board 3 global
  virtual co::Task<> say(std::vector<Line> lines, Player* p) = 0;
  virtual co::Task<> hiddenBlock(Player& p, bool star) = 0;
  virtual co::Task<> orderDecided() = 0;
  virtual co::Task<std::vector<int>> playMinigame() = 0;  // place (1-4) per player index
  virtual co::Task<> minigameRewards(std::vector<int> places, std::vector<int> coins) = 0;
  virtual co::Task<> bonusAwards(std::vector<Award> awards) = 0;
  virtual co::Task<> finalResults() = 0;
  virtual void boardChanged() {}
};

struct Match {
  int boardIndex = 0;
  int rounds = 10;
  int round = 1;
  std::vector<Player> players;
  BoardState b;
  Graph g;
  Random rng;
  std::vector<std::string> mgHistory;
  bool orderRolled = false, stretchDone = false;
  int bonus[3] = {0, 1, 2};
  // per-turn scratch
  int bootsBonus = 0;
  bool itemUsed = false, bounced = false;
  std::vector<int> starOffered;
  IO* io = nullptr;

  void init(int board, int rounds, const std::vector<Player>& ps, uint32_t seed);
  bool finalRound() const { return round == rounds; }
  int starPrice() const { return saleUntil() >= round ? b.salePrice : STAR_PRICE; }
  int saleUntil() const { return b.saleUntil; }
  std::vector<Exit> exits(int from, bool hasKey) const;
  int distance(int from, int to, bool keys) const;
  int aheadOf(int from, int steps) const;
  int stepBack(int at, const std::vector<int>& trail) const;
  bool isOpen(int n) const;
  int playerIndex(const Player& p) const { return (int)(&p - &players[0]); }
};

// Places from scores (higher is better): ties share a place.
std::vector<int> placesFromScores(const std::vector<int>& scores);
std::vector<int> standings(const std::vector<Player>& ps);  // place per player
const char* bonusName(int id);

co::Task<> runMatch(Match& m);

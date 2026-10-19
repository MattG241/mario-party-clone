// Minigame framework. Each minigame is a class in its own file (src/minigames/mg_<name>.cpp) that
// registers itself with REGISTER_MINIGAME("<id>", ClassName); the id matches data::MINIGAMES.
//
// The host (MinigameHost) shows the rules card, counts down, calls update()/draw() every frame until
// finished() is true, then shows the placings. A minigame:
//   * draws on the 854x480 canvas (VW x VH) with app.gfx and the spr:: helpers;
//   * reads human input with pad(i) (an all-false Pad for CPU players) and drives CPUs itself
//     (use isCpu(i) and cpuLevel(i): 0 easy, 1 normal, 2 hard);
//   * uses rng (seeded) for anything random, so runs are reproducible;
//   * reports scores() at the end: one int per player, higher is better (ties share a place).
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "../core/Platform.h"
#include "../core/Util.h"
#include "../game/Data.h"

struct MgPlayer {
  int slot = 0;       // 0-3: colour (PLAYER_COLORS) and controller
  int character = 0;  // data::CHARACTERS index
  bool cpu = true;
  int cpuLevel = 1;
};

class Minigame {
 public:
  virtual ~Minigame() = default;
  // Called once before the countdown. players.size() is 2-4.
  void setup(const std::vector<MgPlayer>& players, uint32_t seed, const data::MinigameDef* def) {
    players_ = players;
    rng.setState(seed);
    def_ = def;
    start();
  }
  virtual void start() = 0;
  // Game time in seconds (only while playing).
  virtual void update(float dt) = 0;
  virtual void draw() = 0;
  // Optional: draw before the countdown ends (default: draw()).
  virtual void drawIntro() { draw(); }
  virtual bool finished() const = 0;
  virtual std::vector<int> scores() const = 0;
  // A label for a player's score on the results card (e.g. "12 rings").
  virtual std::string scoreLabel(int i) const { return std::to_string(scores()[i]); }

  int count() const { return (int)players_.size(); }
  const MgPlayer& player(int i) const { return players_[i]; }
  bool isCpu(int i) const { return players_[i].cpu; }
  int cpuLevel(int i) const { return players_[i].cpuLevel; }
  Color color(int i) const { return PLAYER_COLORS[players_[i].slot]; }
  const Pad& pad(int i) const;
  const data::MinigameDef* def() const { return def_; }

  // Shared drawing helpers
  void drawArena() const;  // the minigame's arena backdrop (data::MinigameDef::arena), or a sky
  void drawTimer(float secondsLeft) const;
  void drawScores(const std::vector<int>& sc, const char* unit = "") const;  // a strip of player chips at the top
  void drawPlayerTag(int i, float x, float y) const;  // "P1" style marker above a character

  Random rng;

 private:
  std::vector<MgPlayer> players_;
  const data::MinigameDef* def_ = nullptr;
};

using MinigameFactory = std::unique_ptr<Minigame> (*)();
struct MinigameRegistrar {
  MinigameRegistrar(const char* id, MinigameFactory f);
};
#define REGISTER_MINIGAME(id, Class) \
  static MinigameRegistrar reg_##Class(id, []() -> std::unique_ptr<Minigame> { return std::unique_ptr<Minigame>(new Class()); })

std::unique_ptr<Minigame> createMinigame(const char* id);
bool hasMinigame(const char* id);
int minigameIndex(const char* id);  // into data::MINIGAMES, -1 if unknown
// The rules card's lines (0-3) and a one-line controls summary, worded for the Wii Remote (WiiRules.cpp).
const char* minigameRule(const data::MinigameDef* d, int k);
const char* minigameControls(const data::MinigameDef* d);

// ---------------------------------------------------------------------------------------------
// The host: rules card -> countdown -> play -> finish -> placings.
class MinigameHost {
 public:
  void begin(const char* id, const std::vector<MgPlayer>& players, uint32_t seed);
  void update(float dt);
  void draw();
  bool done() const { return phase_ == DONE; }
  std::vector<int> places() const { return places_; }  // per player, 1-4
  const char* id() const { return id_.c_str(); }

 private:
  enum Phase { CARD, COUNTDOWN, PLAY, FINISH, RESULTS, DONE } phase_ = DONE;
  std::unique_ptr<Minigame> game_;
  std::vector<MgPlayer> players_;
  std::vector<int> places_;
  std::vector<bool> ready_;
  std::string id_;
  const data::MinigameDef* def_ = nullptr;
  float t_ = 0;
};

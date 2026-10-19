// What the players chose in the menus, and the scene constructors.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "Match.h"
#include "Ui.h"

struct Slot {
  bool active = false;  // taking part
  bool human = false;   // a controller joined (else CPU)
  int character = -1;
  int cpuLevel = 1;
};

struct Session {
  Slot slots[4];
  int board = 0;
  int rounds = 10;
  bool minigameMode = false;
  // tests / demo
  bool demo = false;
  bool tour = false;  // play every minigame once (tests)
  std::string forceMinigame;
  int frameLimit = 0;
  Match match;
  std::vector<int> activeSlots() const {
    std::vector<int> v;
    for (int i = 0; i < 4; i++)
      if (slots[i].active) v.push_back(i);
    return v;
  }
};
extern Session session;

std::unique_ptr<ui::Scene> makeTitle();
std::unique_ptr<ui::Scene> makeSetup(bool minigameMode);
std::unique_ptr<ui::Scene> makeBoardSelect();
std::unique_ptr<ui::Scene> makeBoard();
std::unique_ptr<ui::Scene> makeMinigameMenu();
std::unique_ptr<ui::Scene> makeHowTo();

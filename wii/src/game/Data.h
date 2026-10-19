// Static game content, generated from the web game by wii/tools/build_assets.py (src/gen/GameData.cpp).
#pragma once

namespace data {

struct AnimDef {
  const char* name;
  const int* cells;
  int count;
  float fps;
  bool loop;
};

struct CharacterDef {
  const char* id;
  const char* name;
  const char* shortName;
  unsigned color;
  const char* blurb;
  const AnimDef* anims;
  int animCount;
  int cols;  // cells per row in chars/<id>.png
};

struct CastDef {
  const char* id;
  const char* name;
  const char* from[3];
  int fromCount;
  unsigned color;
};

struct ItemDef {
  const char* id;
  const char* name;
  const char* description;
  int price;
  const char* timing;  // passive | preRoll | postRoll
  int value;
  int icon;  // cell in items.png, -1 = none
};

struct ShopDef {
  const char* id;
  const char* name;
  const char* stock[4];
  int stockCount;
  const char* finalRoundExtra;
};

struct MinigameDef {
  const char* id;
  const char* name;
  const char* tagline;
  const char* description;
  const char* instructions[4];
  const char* world;
  unsigned color;
  const char* arena;  // data-relative path, "" if none
  bool teamGame;
};

struct WorldDef {
  const char* id;
  const char* name;
  const char* cast[4];
  int castCount;
  unsigned color;
};

// Space types, in the order of spaces.png.
enum SpaceType { SP_START, SP_BLUE, SP_LUCKY, SP_BADLUCK, SP_SHOP, SP_WARP, SP_STAR, SP_HAPPENING, SP_COUNT };

struct Sign {
  const char* to;
  const char* label;
};

struct NodeDef {
  const char* id;
  int x, y;  // board pixels
  int type;  // SpaceType
  const char* next[3];
  int nextCount;
  const char* eventId;
  const char* region;
  const char* shop;  // "wrench" | "pipper" | ""
  bool exposed;
  bool spring;
  const char* bridge;
  const char* detour;
  Sign signs[3];
};

struct GateDef {
  const char* from;
  const char* to;
};

struct BoardDef {
  const char* id;
  const char* name;
  const char* subtitle;
  const char* description;
  int width, height;  // board pixels
  const NodeDef* nodes;
  int nodeCount;
  const char* startNode;
  const char* const* relicGates;
  int relicGateCount;
  const char* const* portals;  // pairs
  int portalCount;
  const GateDef* gates;
  int gateCount;
  const char* world;
  const char* time;
  const char* const* minigames;
  int minigameCount;
  int artW, artH, artCols, artRows;  // the baked board art (Wii pixels, 512 px tiles)
};

extern const CharacterDef CHARACTERS[];
extern const int CHARACTER_COUNT;
extern const CastDef CAST[];
extern const int CAST_COUNT;
extern const ItemDef ITEMS[];
extern const int ITEM_COUNT;
extern const ShopDef SHOPS[];
extern const int SHOP_COUNT;
extern const MinigameDef MINIGAMES[];
extern const int MINIGAME_COUNT;
extern const WorldDef WORLDS[];
extern const int WORLD_COUNT;
extern const BoardDef BOARDS[];
extern const int BOARD_COUNT;
extern const float BOARD_K;

}  // namespace data

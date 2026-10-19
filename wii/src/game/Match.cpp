#include "Match.h"

#include <algorithm>
#include <climits>
#include <cstring>

using co::Task;
using namespace data;

static const int INF = INT_MAX / 4;

int itemByName(const char* id) {
  for (int i = 0; i < ITEM_COUNT; i++)
    if (!strcmp(ITEMS[i].id, id)) return i;
  return -1;
}

bool Player::has(int it) const { return std::find(items.begin(), items.end(), it) != items.end(); }

// ---------------------------------------------------------------------------------------------
// The board cast

static int g_cast[R_COUNT] = {7, 6, 0, 1, 8};

// The Wii edition's extra side characters for the special roles (scripts/art/side_<id>.py, rendered by
// scripts/art/cast_wii.py into wii/art/cast_<id>.png and stacked into cast_extra.png in this order).
static const CastDef EXTRA_CAST[] = {
    {"eggman", "Dr. Eggman", {"sonic", "", ""}, 1, 0xd63a2f},  {"frieza", "Frieza", {"goku", "", ""}, 1, 0x8e5bd6},
    {"catwoman", "Catwoman", {"batman", "", ""}, 1, 0x3a3a4a}, {"plankton", "Plankton", {"spongebob", "", ""}, 1, 0x4fae3a},
    {"krabs", "Mr. Krabs", {"spongebob", "", ""}, 1, 0xe0412f}, {"burns", "Mr. Burns", {"homer", "", ""}, 1, 0x6f8f5a},
};
constexpr int EXTRA_COUNT = (int)(sizeof EXTRA_CAST / sizeof EXTRA_CAST[0]);

int castTotal() { return CAST_COUNT + EXTRA_COUNT; }
const CastDef& castDef(int i) { return i < CAST_COUNT ? CAST[std::max(0, i)] : EXTRA_CAST[std::min(EXTRA_COUNT - 1, i - CAST_COUNT)]; }

static int castIndex(const char* id) {
  for (int i = 0; i < castTotal(); i++)
    if (!strcmp(castDef(i).id, id)) return i;
  return 0;
}

void castRoles(const std::vector<int>& characters, const char* world) {
  std::vector<int> picks;
  auto addFrom = [&](const char* cid) {
    for (int s = 0; s < CAST_COUNT; s++)
      for (int k = 0; k < CAST[s].fromCount; k++)
        if (!strcmp(CAST[s].from[k], cid) && std::find(picks.begin(), picks.end(), s) == picks.end()) picks.push_back(s);
  };
  for (int c : characters) addFrom(CHARACTERS[c].id);
  for (int w = 0; w < WORLD_COUNT; w++)
    if (!strcmp(WORLDS[w].id, world))
      for (int k = 0; k < WORLDS[w].castCount; k++) addFrom(WORLDS[w].cast[k]);
  for (const char* d : {"patrick", "tails", "chopper", "krillin", "bart", "kakashi", "alfred", "warmachine", "venom"}) {
    int s = castIndex(d);
    if (std::find(picks.begin(), picks.end(), s) == picks.end()) picks.push_back(s);
  }
  for (int r = 0; r < R_THIEF; r++) g_cast[r] = picks[r];
  // the thief, the banker and the villain: whoever comes from a franchise in play, else one of them by lot
  struct Pool {
    Role role;
    const char* ids[3];
  };
  static const Pool POOLS[] = {{R_VILLAIN, {"eggman", "frieza", "venom"}}, {R_THIEF, {"catwoman", "plankton", ""}}, {R_BANKER, {"krabs", "burns", ""}}};
  int lot = 0;
  for (int c : characters) lot = lot * 7 + c;
  for (const auto& pool : POOLS) {
    std::vector<int> cands;
    int pick = -1;
    for (const char* id : pool.ids) {
      if (!id[0]) continue;
      int s = castIndex(id);
      bool used = false;
      for (int r = 0; r < pool.role; r++) used |= g_cast[r] == s;
      if (used) continue;
      cands.push_back(s);
      const CastDef& d = castDef(s);
      for (int c : characters)
        for (int k = 0; k < d.fromCount; k++)
          if (pick < 0 && !strcmp(d.from[k], CHARACTERS[c].id)) pick = s;
    }
    if (pick < 0 && !cands.empty()) pick = cands[(lot >> 1) % cands.size()];
    g_cast[pool.role] = pick < 0 ? castIndex(pool.ids[0]) : pick;
  }
}

int castOf(Role r) { return g_cast[r]; }
const char* castName(Role r) { return castDef(g_cast[r]).name; }

// ---------------------------------------------------------------------------------------------
// Character dice (each character's own six-faced dice block)

static const struct {
  const char* character;
  CharacterDice dice;
} CHARACTER_DICE[] = {
    {"luffy", {"Gum-Gum Dice", {{1, 0}, {1, 0}, {3, 0}, {8, 0}, {10, 0}, {10, 0}}}},
    {"zoro", {"Three-Sword Dice", {{3, 0}, {3, 0}, {6, 0}, {6, 0}, {6, 0}, {9, 0}}}},
    {"nami", {"Navigator Dice", {{0, 5}, {4, 0}, {4, 0}, {5, 0}, {6, 0}, {8, 0}}}},
    {"goku", {"Saiyan Dice", {{0, -2}, {2, 0}, {6, 0}, {7, 0}, {8, 0}, {10, 0}}}},
    {"naruto", {"Shadow Clone Dice", {{3, 0}, {3, 0}, {5, 0}, {5, 0}, {7, 0}, {7, 0}}}},
    {"batman", {"Utility Dice", {{0, 4}, {4, 0}, {5, 0}, {5, 0}, {6, 0}, {7, 0}}}},
    {"spiderman", {"Web Dice", {{2, 0}, {2, 0}, {6, 0}, {6, 0}, {8, 0}, {8, 0}}}},
    {"ironman", {"Repulsor Dice", {{0, -3}, {5, 0}, {6, 0}, {7, 0}, {8, 0}, {9, 0}}}},
    {"sonic", {"Speed Dice", {{1, 0}, {1, 0}, {2, 0}, {9, 0}, {10, 0}, {10, 0}}}},
    {"spongebob", {"Fry Cook Dice", {{0, 3}, {0, 3}, {5, 0}, {5, 0}, {7, 0}, {9, 0}}}},
    {"homer", {"Donut Dice", {{0, 6}, {1, 0}, {3, 0}, {6, 0}, {8, 0}, {10, 0}}}},
    {"elvis", {"Rock and Roll Dice", {{4, 0}, {4, 0}, {4, 0}, {5, 0}, {5, 0}, {10, 0}}}},
    {"sabrina", {"Encore Dice", {{2, 0}, {3, 0}, {5, 0}, {6, 0}, {7, 0}, {8, 0}}}},
    {"chappell", {"Glitter Dice", {{0, 5}, {3, 0}, {3, 0}, {7, 0}, {7, 0}, {8, 0}}}},
    {"sandler", {"Happy Dice", {{0, 3}, {1, 0}, {6, 0}, {6, 0}, {6, 0}, {9, 0}}}},
    {"obama", {"Steady Dice", {{3, 0}, {4, 0}, {5, 0}, {5, 0}, {6, 0}, {7, 0}}}},
    {"trump", {"Tower Dice", {{1, 0}, {2, 0}, {2, 0}, {8, 0}, {9, 0}, {10, 0}}}},
};

const CharacterDice& characterDice(int character) {
  static const CharacterDice plain{"Dice", {{1, 0}, {2, 0}, {4, 0}, {6, 0}, {8, 0}, {10, 0}}};
  for (const auto& d : CHARACTER_DICE)
    if (!strcmp(d.character, CHARACTERS[character].id)) return d.dice;
  return plain;
}

bool BoardState::isVillain(int n) const { return std::find(villainNodes.begin(), villainNodes.end(), n) != villainNodes.end(); }

// ---------------------------------------------------------------------------------------------
// Graph and board queries

void Graph::build(const BoardDef* d) {
  def = d;
  index.clear();
  for (int i = 0; i < d->nodeCount; i++) index[d->nodes[i].id] = i;
  next.assign(d->nodeCount, {});
  prev.assign(d->nodeCount, {});
  for (int i = 0; i < d->nodeCount; i++)
    for (int k = 0; k < d->nodes[i].nextCount; k++) {
      int t = id(d->nodes[i].next[k]);
      if (t < 0) continue;
      next[i].push_back(t);
      prev[t].push_back(i);
    }
  gates.clear();
  for (int k = 0; k < d->gateCount; k++) gates.push_back({id(d->gates[k].from), id(d->gates[k].to)});
}

int Graph::id(const char* s) const {
  auto it = index.find(s);
  return it == index.end() ? -1 : it->second;
}

int Graph::bridgeGroup(int n) const {
  if (node(n).bridge[0]) return 1;
  if (node(n).detour[0]) return 2;
  return 0;
}

bool Match::isOpen(int n) const {
  int grp = g.bridgeGroup(n);
  if (!grp) return true;
  bool broken = b.bridgeUntil >= 0;
  return grp == 1 ? !broken : broken;
}

std::vector<Exit> Match::exits(int from, bool hasKey) const {
  std::vector<Exit> all, out;
  int fg = g.bridgeGroup(from);
  for (int to : g.next[from]) {
    if (!isOpen(to)) {
      int tg = g.bridgeGroup(to);
      if (!(fg && tg && fg == tg)) continue;
    }
    bool gate = std::find(g.gates.begin(), g.gates.end(), std::make_pair(from, to)) != g.gates.end();
    all.push_back({to, gate, false});
  }
  bool open = b.gatesOpenUntil >= round;
  for (auto& e : all) {
    if (!e.gate || open) out.push_back({e.to, e.gate, false});
    else if (hasKey) out.push_back({e.to, true, true});
  }
  if (out.empty() && !all.empty()) out.push_back({all[0].to, all[0].gate, false});
  return out;
}

int Match::distance(int from, int to, bool keys) const {
  if (from == to) return 0;
  std::vector<char> seen(g.count(), 0);
  std::vector<int> frontier{from}, nxt;
  seen[from] = 1;
  for (int d = 1; d < 200 && !frontier.empty(); d++) {
    nxt.clear();
    for (int id : frontier)
      for (auto& e : exits(id, keys)) {
        if (e.to == to) return d;
        if (!seen[e.to]) {
          seen[e.to] = 1;
          nxt.push_back(e.to);
        }
      }
    frontier.swap(nxt);
  }
  return INF;
}

int Match::aheadOf(int from, int steps) const {
  int at = from;
  for (int i = 0; i < steps; i++) {
    auto ex = exits(at, false);
    if (ex.empty()) break;
    at = ex[0].to;
  }
  return at;
}

int Match::stepBack(int at, const std::vector<int>& trail) const {
  const auto& preds = g.prev[at];
  if (!trail.empty()) {
    int last = trail.back();
    if (std::find(preds.begin(), preds.end(), last) != preds.end() && isOpen(last)) return last;
  }
  for (int p : preds)
    if (isOpen(p) && std::find(g.gates.begin(), g.gates.end(), std::make_pair(p, at)) == g.gates.end()) return p;
  return preds.empty() ? -1 : preds[0];
}

// The thief's and the banker's spots and the villain spaces: blue spaces well away from the start, the
// shops and each other, and the board's bad-luck spaces (the same on every visit to a board).
void Match::placeSpots(int start) {
  auto apart = [&](int a, int c) { return std::min(distance(a, c, true), distance(c, a, true)); };
  auto nearSpecial = [&](int n) {
    auto check = [&](int x) { return x == start || g.node(x).type == SP_SHOP || g.node(x).type == SP_STAR; };
    for (int x : g.next[n])
      if (check(x)) return true;
    for (int x : g.prev[n])
      if (check(x)) return true;
    return false;
  };
  std::vector<int> blues, reds;
  for (int i = 0; i < g.count(); i++) {
    if (i == start || nearSpecial(i)) continue;
    if (g.node(i).type == SP_BLUE) blues.push_back(i);
    if (g.node(i).type == SP_BADLUCK) reds.push_back(i);
  }
  auto farthest = [&](const std::vector<int>& from, std::function<int(int)> score, std::vector<int> skip) {
    int best = -1, bs = -1;
    for (int n : from) {
      if (std::find(skip.begin(), skip.end(), n) != skip.end()) continue;
      int s = score(n);
      if (s > bs) bs = s, best = n;
    }
    return best;
  };
  b.bankNode = farthest(blues, [&](int n) { return std::min(distance(start, n, true), 60); }, {});
  b.thiefNode = b.bankNode < 0 ? -1 : farthest(blues, [&](int n) { return std::min(apart(n, b.bankNode), 60); }, {b.bankNode});
  b.villainNodes.clear();
  const std::vector<int>& pool = reds.empty() ? blues : reds;
  int v1 = farthest(pool, [&](int n) { return std::min(distance(start, n, true), 60); }, {b.bankNode, b.thiefNode});
  if (v1 >= 0) {
    b.villainNodes.push_back(v1);
    int v2 = farthest(pool, [&](int n) { return std::min(apart(n, v1), 60); }, {b.bankNode, b.thiefNode, v1});
    if (v2 >= 0 && apart(v2, v1) >= 6) b.villainNodes.push_back(v2);
  }
}

void Match::init(int board, int rounds_, const std::vector<Player>& ps, uint32_t seed) {
  boardIndex = board;
  rounds = rounds_;
  round = 1;
  rng.setState(seed);
  g.build(&BOARDS[board]);
  players = ps;
  int start = g.id(g.def->startNode);
  for (auto& p : players) {
    p.node = start;
    p.coins = START_COINS;
  }
  b = BoardState();
  for (int i = 0; i + 1 < g.def->portalCount; i += 2) {
    int a = g.id(g.def->portals[i]), c = g.id(g.def->portals[i + 1]);
    if (a >= 0 && c >= 0) {
      b.portals[a] = c;
      b.portals[c] = a;
    }
  }
  std::vector<int> gates;
  for (int i = 0; i < g.def->relicGateCount; i++) {
    int n = g.id(g.def->relicGates[i]);
    if (n >= 0 && n != start) gates.push_back(n);
  }
  b.starGate = gates.empty() ? start : rng.pick(gates);
  placeSpots(start);
  // the classic three bonus stars
  bonus[0] = 7;
  bonus[1] = 8;
  bonus[2] = 4;
  for (auto& p : players) p.st.peakCoins = p.coins;
  std::vector<int> chars;
  for (auto& p : players) chars.push_back(p.character);
  castRoles(chars, g.def->world);
}

std::vector<int> placesFromScores(const std::vector<int>& scores) {
  int n = (int)scores.size();
  std::vector<int> order(n), place(n);
  for (int i = 0; i < n; i++) order[i] = i;
  std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return scores[a] > scores[b]; });
  for (int k = 0; k < n; k++) {
    int i = order[k];
    place[i] = (k > 0 && scores[order[k - 1]] == scores[i]) ? place[order[k - 1]] : k + 1;
  }
  return place;
}

std::vector<int> standings(const std::vector<Player>& ps) {
  std::vector<int> sc;
  for (auto& p : ps) sc.push_back(p.stars * 10000 + p.coins);
  return placesFromScores(sc);
}

static const char* BONUS_NAMES[9][2] = {{"Trailblazer", "Most spaces travelled"}, {"Treasure Keeper", "Most coins earned"},
                                        {"Game Champion", "Most minigame wins"},    {"Item Expert", "Most items used"},
                                        {"Happening Star", "Most Happening Spaces"}, {"Big Spender", "Most coins spent"},
                                        {"Lucky Landing", "Most Lucky Spaces"},     {"Minigame Star", "Most coins won in minigames"},
                                        {"Coin Star", "Most coins held at one time"}};
const char* bonusName(int id) { return BONUS_NAMES[id][0]; }

static int statOf(const Player& p, int id) {
  switch (id) {
    case 0: return p.st.moved;
    case 1: return p.st.earned;
    case 2: return p.st.wins;
    case 3: return p.st.itemsUsed;
    case 4: return p.st.events;
    case 5: return p.st.spent;
    case 7: return p.st.mgCoins;
    case 8: return p.st.peakCoins;
    default: return p.st.lucky;
  }
}

// ---------------------------------------------------------------------------------------------
// CPU decisions (BoardAI)

static const float SLOPPY[3] = {0.35f, 0.14f, 0.04f};
static bool sloppy(Match& m, Player& p) { return m.rng.chance(SLOPPY[p.cpuLevel]); }
static int starDist(Match& m, int from, bool key) { return m.distance(from, m.b.starGate, key); }

static int bestWarpTarget(Match& m, Player& p) {
  bool key = p.has(IT_KEY);
  int here = starDist(m, p.node, key), best = -1, bestD = here - 5;
  std::vector<int> cands;
  for (auto& o : m.players)
    if (&o != &p) cands.push_back(o.node);
  for (auto& kv : m.b.portals) cands.push_back(kv.first);
  for (int c : cands) {
    if (c == p.node) continue;
    int d = starDist(m, c, key);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// What a CPU thinks of ending its move on a node.
static float landValue(Match& m, Player& p, int n) {
  if (m.b.isVillain(n)) return -12;
  float v;
  switch (m.g.node(n).type) {
    case SP_BLUE: v = m.finalRound() ? 5 : 3; break;
    case SP_LUCKY: v = 4; break;
    case SP_BADLUCK: v = -5; break;
    case SP_HAPPENING: v = 2; break;
    case SP_SHOP: v = (p.items.size() < 3 && p.coins >= 6) ? 2 : 0; break;
    case SP_WARP: v = 1; break;
    default: v = 0;
  }
  if (n == m.b.bankNode) v += m.b.bankCoins;
  if (n == m.b.thiefNode && p.coins >= 5) v += 1;
  return v;
}

// The node `steps` ahead when heading for the Star Coin (the way a CPU walks).
static int walkTowardStar(Match& m, Player& p, int steps, bool* passesStar = nullptr) {
  bool key = p.has(IT_KEY);
  int at = p.node;
  if (passesStar) *passesStar = false;
  for (int k = 0; k < steps; k++) {
    auto ex = m.exits(at, key);
    if (ex.empty()) break;
    int nx = ex[0].to, nd = 1 << 30;
    for (auto& e : ex) {
      if (e.needsKey && !key) continue;
      int d = m.distance(e.to, m.b.starGate, key);
      if (d < nd) nd = d, nx = e.to;
    }
    at = nx;
    if (passesStar && at == m.b.starGate) *passesStar = true;
  }
  return at;
}

// Custom Dice: reach the Star Coin when it can be bought, else the best landing within 1-10.
static int aiCustomRoll(Match& m, Player& p) {
  int dist = starDist(m, p.node, p.has(IT_KEY));
  if (p.coins >= m.starPrice() && dist >= DICE_MIN && dist <= DICE_MAX) return dist;
  int best = DICE_MAX;
  float bs = -1e9f;
  for (int k = DICE_MIN; k <= DICE_MAX; k++) {
    float v = landValue(m, p, walkTowardStar(m, p, k)) + k * 0.15f;
    if (v > bs) bs = v, best = k;
  }
  return best;
}

// Whether a CPU rolls its character's own dice this turn.
static bool aiCharacterDice(Match& m, Player& p, int dist) {
  const CharacterDice& cd = characterDice(p.character);
  float steps = 0, coins = 0;
  int hi = 0;
  for (auto& f : cd.faces) {
    steps += f.steps / 6.0f;
    coins += f.coins / 6.0f;
    hi = std::max(hi, f.steps);
  }
  bool afford = p.coins >= m.starPrice();
  if (afford && dist <= hi && dist > 0) return m.rng.chance(0.5);
  if (!afford && coins > 0.5f) return m.rng.chance(0.4);
  if (steps > 5.4f) return m.rng.chance(0.35);
  return m.rng.chance(0.1);
}

static int aiPreRoll(Match& m, Player& p, const std::vector<int>& usable) {
  int dist = starDist(m, p.node, p.has(IT_KEY));
  int fallback = aiCharacterDice(m, p, dist) ? PRE_CHARACTER_DICE : -1;
  if (usable.empty() || sloppy(m, p)) return fallback;
  auto has = [&](int it) { return std::find(usable.begin(), usable.end(), it) != usable.end(); };
  bool afford = p.coins >= m.starPrice();
  if (has(IT_PIPE) && afford && dist > 3) return IT_PIPE;
  if (has(IT_CUSTOM) && afford && dist >= DICE_MIN && dist <= DICE_MAX) return IT_CUSTOM;
  if (has(IT_TRIPLE) && (dist > 14 || (afford && dist > 10 && dist <= 30))) return IT_TRIPLE;
  if (has(IT_DOUBLE) && (dist > 9 || (afford && dist > 10 && dist <= 20))) return IT_DOUBLE;
  if (has(IT_GLOVE) && p.coins >= 10) {
    for (auto& o : m.players)
      if (&o != &p && o.coins >= 15 && m.rng.chance(0.6)) return IT_GLOVE;
  }
  if (has(IT_CAPSULE)) return IT_CAPSULE;
  if (has(IT_SHIELD) && !p.shielded) return IT_SHIELD;
  if (has(IT_MAGNET)) {
    int rich = 0;
    for (auto& o : m.players)
      if (&o != &p) rich = std::max(rich, o.coins);
    if (rich >= 4) return IT_MAGNET;
  }
  if (has(IT_WARP) && dist > 14 && bestWarpTarget(m, p) >= 0) return IT_WARP;
  if (has(IT_BOOTS)) {
    bool aiming = p.coins >= m.starPrice() && dist >= 4 && dist <= 13;
    if (aiming || m.rng.chance(0.2)) return IT_BOOTS;
  }
  if (has(IT_SNARE) && m.g.node(p.node).type != SP_START && m.rng.chance(0.5)) return IT_SNARE;
  if (has(IT_CUSTOM) && m.rng.chance(0.3)) return IT_CUSTOM;
  return fallback;
}

static const int SPACE_VALUE[SP_COUNT] = {2, 3, 4, -3, 1, 2, 0, 2};

static int aiPath(Match& m, Player& p, const std::vector<PathOpt>& opts) {
  if (opts.size() == 1) return 0;
  if (sloppy(m, p)) return m.rng.range(0, (int)opts.size() - 1);
  bool key = p.has(IT_KEY), afford = p.coins >= m.starPrice();
  int best = 0;
  float bestScore = -1e9f;
  for (size_t i = 0; i < opts.size(); i++) {
    int d = m.distance(opts[i].to, m.b.starGate, key) + 1;
    float score;
    if (afford) score = -d * 10.0f;
    else {
      score = 0;
      int at = opts[i].to;
      for (int k = 0; k < 4; k++) {
        auto& n = m.g.node(at);
        score += SPACE_VALUE[n.type] * (1 - k * 0.15f);
        if (m.b.isVillain(at)) score -= 8 * (1 - k * 0.15f);
        if (at == m.b.bankNode) score += m.b.bankCoins * 0.3f;
        if (n.type == SP_SHOP && p.items.size() < 3 && p.coins >= 6) score += 3;
        auto ex = m.exits(at, false);
        if (ex.empty()) break;
        at = ex[0].to;
      }
      score -= std::min(d, 60) * 0.4f;
    }
    if (opts[i].needsKey) score += afford ? 0 : -6;
    score += m.rng.frange(0, 0.5f);
    if (score > bestScore) {
      bestScore = score;
      best = (int)i;
    }
  }
  return best;
}

static int leastValuable(const std::vector<int>& items) {
  int w = items[0];
  for (int it : items)
    if (ITEMS[it].value < ITEMS[w].value) w = it;
  return w;
}

static int aiShop(Match& m, Player& p, const std::vector<int>& offer) {
  int dist = starDist(m, p.node, p.has(IT_KEY));
  int reserve = (dist <= 14 && p.coins >= m.starPrice() * 0.6f) ? m.starPrice() : 4;
  int budget = p.coins - reserve;
  std::vector<int> ok;
  for (int it : offer)
    if (ITEMS[it].price <= budget) ok.push_back(it);
  if (ok.empty()) return -1;
  if (sloppy(m, p)) return m.rng.chance(0.5) ? m.rng.pick(ok) : -1;
  int pick = -1;
  for (int it : ok) {
    if (it == IT_SHIELD && (p.shielded || p.has(IT_SHIELD))) continue;
    // a Golden Pipe is only worth it with a Star Coin's price left over
    if (it == IT_PIPE && p.coins - ITEMS[it].price < m.starPrice()) continue;
    if (it == IT_KEY && p.has(IT_KEY)) continue;
    if (pick < 0 || ITEMS[it].value > ITEMS[pick].value) pick = it;
  }
  if (pick < 0) return -1;
  if ((int)p.items.size() >= MAX_ITEMS && ITEMS[pick].value <= ITEMS[leastValuable(p.items)].value + 1) return -1;
  return pick;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers (TurnFlow)

static Task<> gainCoins(Match& m, Player& p, int n) {
  if (n <= 0) co_return;
  p.coins += n;
  p.st.earned += n;
  p.st.peakCoins = std::max(p.st.peakCoins, p.coins);
  co_await m.io->coins(p, n);
}

static Task<int> loseCoins(Match& m, Player& p, int n) {
  int lost = std::min(p.coins, std::max(0, n));
  if (lost <= 0) co_return 0;
  p.coins -= lost;
  co_await m.io->coins(p, -lost);
  co_return lost;
}

static Task<> spendCoins(Match& m, Player& p, int n) {
  p.coins -= n;
  p.st.spent += n;
  co_await m.io->coins(p, -n);
}

static Task<bool> shieldBlocks(Match& m, Player& p) {
  if (!p.shielded) co_return false;
  p.shielded = false;
  co_await m.io->shield(p, true);
  co_return true;
}

static Task<> giveItem(Match& m, Player& p, int it) {
  if ((int)p.items.size() < MAX_ITEMS) {
    p.items.push_back(it);
    co_await m.io->item(p, it, 0);
    co_return;
  }
  std::vector<int> all = p.items;
  all.push_back(it);
  int cpu = p.cpu ? leastValuable(all) : -1;
  int drop = co_await m.io->chooseDiscard(p, it, cpu);
  if (drop == it) co_await m.io->item(p, it, 3);
  else {
    auto pos = std::find(p.items.begin(), p.items.end(), drop);
    if (pos != p.items.end()) *pos = it;
    co_await m.io->item(p, drop, 3);
    co_await m.io->item(p, it, 0);
  }
}

static void removeItem(Player& p, int it) {
  auto pos = std::find(p.items.begin(), p.items.end(), it);
  if (pos != p.items.end()) p.items.erase(pos);
}

static int randomItem(Match& m) {
  static const std::vector<float> w = {1.0f, 0.6f, 1.4f, 1.0f, 1.0f, 0.6f, 0.9f, 1.0f, 0.9f, 0.5f, 0.7f, 0.25f, 0.6f};
  return m.rng.weighted(w);
}

static Task<> teleport(Match& m, Player& p, int to, JumpKind kind) {
  if (p.node == to || to < 0) co_return;
  co_await m.io->jumpTo(p, p.node, to, kind);
  p.trail.clear();
  p.node = to;
}

static Task<> pushForward(Match& m, Player& p, int steps) {
  for (int i = 0; i < steps; i++) {
    auto ex = m.exits(p.node, false);
    if (ex.empty()) co_return;
    int to = ex[0].to;
    if (ex.size() > 1) {
      std::vector<PathOpt> opts;
      for (auto& e : ex) opts.push_back({e.to, "", e.needsKey});
      to = opts[aiPath(m, p, opts)].to;
    }
    co_await m.io->moveStep(p, p.node, to, steps - i - 1);
    p.trail.push_back(p.node);
    if (p.trail.size() > 16) p.trail.erase(p.trail.begin());
    p.node = to;
    p.st.moved++;
  }
}

static Task<> pushBackward(Match& m, Player& p, int steps) {
  int from = p.node, at = from;
  for (int i = 0; i < steps; i++) {
    int back = m.stepBack(at, p.trail);
    if (back < 0) break;
    if (!p.trail.empty() && p.trail.back() == back) p.trail.pop_back();
    at = back;
  }
  if (at == from) co_return;
  co_await m.io->jumpTo(p, from, at, J_WIND);
  p.node = at;
}

static Task<> relocateStar(Match& m, Player* buyer) {
  int old = m.b.starGate;
  std::vector<int> gates;
  std::vector<float> w;
  for (int i = 0; i < m.g.def->relicGateCount; i++) {
    int gte = m.g.id(m.g.def->relicGates[i]);
    if (gte < 0 || gte == old) continue;
    int d = buyer ? m.distance(buyer->node, gte, false) : 10;
    int minOthers = INF;
    for (auto& pl : m.players) minOthers = std::min(minOthers, m.distance(pl.node, gte, false));
    float wt = std::max(1, std::min(40, d >= INF ? 20 : d)) * (minOthers <= 2 ? 0.3f : 1.0f);
    gates.push_back(gte);
    w.push_back(wt);
  }
  if (gates.empty()) co_return;
  m.b.starGate = gates[m.rng.weighted(w)];
  co_await m.io->starMoved(old, m.b.starGate);
}

static Task<> offerStar(Match& m, Player& p) {
  int gate = m.b.starGate;
  if (std::find(m.starOffered.begin(), m.starOffered.end(), gate) != m.starOffered.end()) co_return;
  m.starOffered.push_back(gate);
  int price = m.starPrice();
  if (p.coins < price) {
    co_await m.io->say({{R_KEEPER, P_SURPRISED, fmt("A Star Coin costs %d coins. You have %d. Come back soon!", price, p.coins)}}, &p);
    co_return;
  }
  bool want = co_await m.io->offerStar(p, price, p.cpu);
  if (!want) co_return;
  co_await spendCoins(m, p, price);
  p.stars++;
  p.st.starsBought++;
  co_await m.io->starGained(p, 0);
  co_await relocateStar(m, &p);
}

static Task<> visitShop(Match& m, Player& p, int shopIdx) {
  const ShopDef& s = SHOPS[shopIdx];
  std::vector<int> offer;
  for (int i = 0; i < s.stockCount; i++) offer.push_back(itemByName(s.stock[i]));
  // three of the usual stock and two of the special dice and gadgets, different every visit
  m.rng.shuffle(offer);
  if (offer.size() > 3) offer.resize(3);
  std::vector<int> special{IT_DOUBLE, IT_TRIPLE, IT_CUSTOM, IT_PIPE, IT_GLOVE};
  m.rng.shuffle(special);
  offer.push_back(special[0]);
  offer.push_back(special[1]);
  int extra = itemByName(s.finalRoundExtra);
  if (m.finalRound() && std::find(offer.begin(), offer.end(), extra) == offer.end()) offer.push_back(extra);
  int cpu = p.cpu ? aiShop(m, p, offer) : -1;
  int pick = co_await m.io->shop(p, shopIdx, offer, cpu);
  if (pick < 0 || p.coins < ITEMS[pick].price) co_return;
  co_await spendCoins(m, p, ITEMS[pick].price);
  co_await giveItem(m, p, pick);
}

static int shopIndex(const char* id) {
  for (int i = 0; i < SHOP_COUNT; i++)
    if (!strcmp(SHOPS[i].id, id)) return i;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Events (EventManager + the worlds' board events, ported)

static Task<> present(Match& m, const char* title, int kind, std::vector<Line> lines, int focus, Player* p) {
  co_await m.io->event(title, kind, std::move(lines), focus, p);
}

static int scaleN(int n) { return n; }

static Task<> swapPlaces(Match& m, Player& a, Player& c) {
  int na = a.node, nc = c.node;
  co_await co::both(m.io->jumpTo(a, na, nc, J_SWAP), m.io->jumpTo(c, nc, na, J_SWAP));
  a.node = nc;
  c.node = na;
  a.trail.clear();
  c.trail.clear();
}

static Task<> runEvent(Match& m, const std::string& id, Player* p);
static Task<> villainSpace(Match& m, Player& p);
static Task<> thiefVisit(Match& m, Player& p);
static Task<> evLucky(Match& m, Player& p);

static Task<> evLucky(Match& m, Player& p) {
  p.st.lucky++;
  bool rivals = m.players.size() > 1;
  std::vector<std::string> ids{"parade", "sale", "lanterns", "delivery", "tailwind", "guide", "popup", "chance", "duel", "battle"};
  std::vector<float> w{1, m.b.saleUntil >= m.round ? 0.f : 0.8f, 1.4f, 1.2f, 1, m.distance(p.node, m.b.starGate, false) > 6 ? 0.7f : 0.f, p.coins >= 4 ? 0.8f : 0.f,
                       rivals ? 1.1f : 0.f, rivals && p.coins > 0 ? 0.7f : 0.f, rivals ? 0.6f : 0.f};
  static const char* LABELS[] = {"Coin parade", "Star Coin sale", "Lantern coins", "Free item", "Tailwind", "Shortcut", "Pop-up shop", "Chance Time", "Duel", "Battle"};
  int pick = m.rng.weighted(w);
  // the wheel shows the prize and five other possibilities
  std::vector<int> shown{pick};
  std::vector<int> others;
  for (size_t i = 0; i < ids.size(); i++)
    if ((int)i != pick && w[i] > 0) others.push_back((int)i);
  m.rng.shuffle(others);
  for (int i : others)
    if (shown.size() < 6) shown.push_back(i);
  m.rng.shuffle(shown);
  std::vector<std::string> labels;
  int at = 0;
  for (size_t k = 0; k < shown.size(); k++) {
    labels.push_back(LABELS[shown[k]]);
    if (shown[k] == pick) at = (int)k;
  }
  co_await m.io->roulette(p, "Lucky Space roulette!", labels, at, R_HELPER);
  co_await runEvent(m, ids[pick], &p);
}

static Task<> evBadLuck(Match& m, Player& p) {
  bool rivalElsewhere = false;
  for (auto& o : m.players)
    if (&o != &p && o.node != p.node) rivalElsewhere = true;
  std::vector<std::string> ids{"swap", "butterfingers", "leak", "backwind", "gust", "topsy", "battle"};
  std::vector<float> w{rivalElsewhere ? 1.f : 0.f, 1, 1.3f, 1, p.coins > 0 ? 1.f : 0.f, 0.8f, m.players.size() > 1 ? 0.7f : 0.f};
  co_await runEvent(m, ids[m.rng.weighted(w)], &p);
}

// Chance Time: three blocks pick who gives, what, and who receives.
static Task<> chanceTime(Match& m, Player& lander) {
  int n = (int)m.players.size();
  if (n < 2) co_return;
  co_await present(m, "CHANCE TIME!", 3, {{R_HOST, P_CHEER, "It's CHANCE TIME! Stop the blocks to see who gives what to whom!"}}, -1, &lander);
  int gi = m.rng.range(0, n - 1), ri = m.rng.range(0, n - 2);
  if (ri >= gi) ri++;
  Player &g = m.players[gi], &r = m.players[ri];
  std::vector<float> w{1.2f, 0.8f, g.stars > 0 ? 0.6f : 0.f, 0.7f, g.stars != r.stars ? 0.5f : 0.f};
  int act = m.rng.weighted(w);
  co_await m.io->chanceTime(lander, gi, ri, act);
  switch (act) {
    case CH_GIVE10:
    case CH_GIVE20: {
      int amount = co_await loseCoins(m, g, act == CH_GIVE10 ? 10 : 20);
      if (amount > 0) co_await gainCoins(m, r, amount);
      else co_await m.io->say({{R_HOST, P_SURPRISED, fmt("%s has no coins to give!", g.name())}}, &g);
      break;
    }
    case CH_GIVESTAR:
      g.stars--;
      r.stars++;
      co_await m.io->say({{R_HOST, P_SURPRISED, fmt("%s hands a Star Coin to %s!", g.name(), r.name())}}, &g);
      co_await m.io->starGained(r, 1);
      break;
    case CH_SWAPCOINS: {
      int gc = g.coins, rc = r.coins;
      co_await m.io->say({{R_HOST, P_SURPRISED, fmt("%s and %s swap coins!", g.name(), r.name())}}, nullptr);
      g.coins = rc;
      r.coins = gc;
      g.st.peakCoins = std::max(g.st.peakCoins, g.coins);
      r.st.peakCoins = std::max(r.st.peakCoins, r.coins);
      if (rc != gc) {
        co_await m.io->coins(g, rc - gc);
        co_await m.io->coins(r, gc - rc);
      }
      break;
    }
    case CH_SWAPSTARS:
      std::swap(g.stars, r.stars);
      co_await m.io->say({{R_HOST, P_SURPRISED, fmt("%s and %s swap their Star Coins! %s now has %d, %s has %d.", g.name(), r.name(), g.name(), g.stars, r.name(),
                                                     r.stars)}},
                         nullptr);
      break;
  }
  m.io->boardChanged();
}

// A Battle: everyone puts coins in a pot, then plays a minigame for it (70% to the winner, 30% to second).
static Task<> battle(Match& m, Player* lander) {
  static const int ANTES[3] = {5, 10, 20};
  int ante = ANTES[m.rng.weighted({1.2f, 1.0f, 0.6f})];
  co_await present(m, "BATTLE MINIGAME!", 3, {{R_HOST, P_CHEER, fmt("It's a BATTLE! Everyone puts up to %d coins in the pot, and the minigame winner takes most of it!", ante)}}, -1,
                   lander);
  int pot = 0;
  for (auto& p : m.players) pot += co_await loseCoins(m, p, ante);
  if (pot == 0) {
    co_await m.io->say({{R_HOST, P_SURPRISED, "Nobody has a single coin? Then the battle's off!"}}, nullptr);
    co_return;
  }
  co_await m.io->say({{R_HOST, P_POINT, fmt("There are %d coins in the pot. Let the battle begin!", pot)}}, nullptr);
  std::vector<int> who;
  for (size_t i = 0; i < m.players.size(); i++) who.push_back((int)i);
  auto places = co_await m.io->playMinigame(MG_BATTLE, who, {});
  std::vector<int> firsts, seconds;
  for (size_t i = 0; i < places.size(); i++) {
    if (places[i] == 1) firsts.push_back((int)i);
    if (places[i] == 2) seconds.push_back((int)i);
  }
  int firstPot = seconds.empty() ? pot : pot * 7 / 10, secondPot = pot - firstPot;
  std::vector<int> share(m.players.size(), 0);
  for (int i : firsts) share[i] += firstPot / (int)firsts.size();
  for (int i : seconds) share[i] += secondPot / (int)seconds.size();
  int given = 0;
  for (int s : share) given += s;
  // coins that don't divide evenly go to a lucky random player
  if (pot > given) share[m.rng.range(0, (int)share.size() - 1)] += pot - given;
  for (size_t i = 0; i < share.size(); i++)
    if (share[i] > 0) co_await gainCoins(m, m.players[i], share[i]);
}

// A Duel: pick a rival and a stake, then a two-player minigame; the winner takes the stake.
static Task<> duel(Match& m, Player& p) {
  std::vector<Target> opts;
  std::vector<int> who;
  for (size_t i = 0; i < m.players.size(); i++)
    if (&m.players[i] != &p) {
      who.push_back((int)i);
      opts.push_back({fmt("%s (%d coins)", m.players[i].name(), m.players[i].coins), -1, m.players[i].slot});
    }
  if (who.empty()) co_return;
  co_await present(m, "DUEL!", 3, {{R_HOST, P_POINT, "A DUEL! Pick a rival and a stake. The winner takes it all!"}}, -1, &p);
  int cpu = -1;
  if (p.cpu) {
    cpu = 0;
    for (size_t k = 0; k < who.size(); k++)
      if (m.players[who[k]].coins > m.players[who[cpu]].coins) cpu = (int)k;
  }
  int pick = co_await m.io->chooseTarget(p, "Duel which rival?", opts, cpu);
  if (pick < 0) pick = 0;
  Player& o = m.players[who[pick]];
  int most = std::min(p.coins, o.coins);
  std::vector<int> stakes;
  std::vector<Target> sopts;
  for (int s : {5, 10, 20})
    if (s <= most) stakes.push_back(s);
  if (stakes.empty() || stakes.back() != most) stakes.push_back(most);
  for (int s : stakes) sopts.push_back({s == most && s > 20 ? fmt("Everything: %d coins", s) : fmt("%d coins", s), -1, -1});
  int scpu = p.cpu ? (m.rng.chance(0.5) ? (int)stakes.size() - 1 : 0) : -1;
  int sp = co_await m.io->chooseTarget(p, "Stake how many coins?", sopts, scpu);
  int stake = stakes[std::max(0, sp)];
  if (stake <= 0) {
    co_await m.io->say({{R_HOST, P_SURPRISED, "No coins to stake? Then it's a duel for glory!"}}, nullptr);
  } else co_await m.io->say({{R_HOST, P_CHEER, fmt("%s versus %s, for %d coins!", p.name(), o.name(), stake)}}, nullptr);
  auto places = co_await m.io->playMinigame(MG_DUEL, {m.playerIndex(p), m.playerIndex(o)}, {});
  if (places.size() < 2 || places[0] == places[1]) {
    co_await m.io->say({{R_HOST, P_SURPRISED, "A draw! Everyone keeps their coins."}}, nullptr);
    co_return;
  }
  Player& winner = places[0] < places[1] ? p : o;
  Player& loser = places[0] < places[1] ? o : p;
  int won = co_await loseCoins(m, loser, stake);
  co_await m.io->say({{R_HOST, P_CHEER, fmt("%s wins the duel!", winner.name())}}, &winner);
  if (won > 0) co_await gainCoins(m, winner, won);
}

static Task<> runEvent(Match& m, const std::string& id, Player* p) {
  IO& io = *m.io;
  (void)io;
  if (id == "villain" && p) {
    co_await villainSpace(m, *p);
  } else if (id == "thief" && p) {
    co_await thiefVisit(m, *p);
  } else if (id == "lucky" && p) {
    co_await evLucky(m, *p);
  } else if (id == "giveitems" && p) {
    // tests: the special dice for everyone, and coins to use the thief
    for (auto& o : m.players) {
      o.items = {IT_DOUBLE, IT_TRIPLE, IT_CUSTOM};
      o.coins += 60;
      o.stars += 1;
    }
    m.io->boardChanged();
  } else if (id == "chance" && p) {
    co_await chanceTime(m, *p);
  } else if (id == "battle") {
    co_await battle(m, p);
  } else if (id == "duel" && p) {
    co_await duel(m, *p);
  } else if (id == "parade") {
    co_await present(m, "PARTY PARADE", 0, {{R_HELPER, P_HAPPY, "Parade time! Drums, banners and coins for EVERYONE!"}}, -1, p);
    for (auto& pl : m.players) co_await gainCoins(m, pl, 5);
  } else if (id == "sale") {
    m.b.salePrice = 15;
    m.b.saleUntil = m.round + 1;
    co_await present(m, "STAR COIN SALE", 0, {{R_KEEPER, P_CHEER, "Flash sale! Star Coins cost just 15 coins until the end of next round!"}}, m.b.starGate, p);
  } else if (id == "lanterns" && p) {
    int n = m.rng.range(4, 8);
    co_await present(m, "LANTERN SHOWER", 0, {{R_HOST, P_CHEER, "The party lanterns are raining coins on you!"}}, -1, p);
    co_await gainCoins(m, *p, n);
  } else if (id == "delivery" && p) {
    int it = randomItem(m);
    co_await present(m, "SPECIAL DELIVERY", 0, {{R_KEEPER, P_HAPPY, fmt("Special delivery! One %s, signed, sealed and delivered!", ITEMS[it].name)}}, -1, p);
    co_await giveItem(m, *p, it);
  } else if (id == "tailwind" && p) {
    co_await present(m, "TAILWIND", 0, {{R_HELPER, P_HAPPY, "Hold still... WHOOSH! Off you go!"}}, -1, p);
    co_await pushForward(m, *p, 3);
  } else if (id == "guide" && p) {
    std::vector<int> cands;
    for (int i = 0; i < m.g.count(); i++) {
      if (i == m.b.starGate || !m.isOpen(i)) continue;
      int d = m.distance(i, m.b.starGate, false);
      if (d >= 2 && d <= 4) cands.push_back(i);
    }
    co_await present(m, "HOST'S SHORTCUT", 0, {{R_HOST, P_POINT, "Follow me! I know a secret path to the Star Keeper."}}, -1, p);
    if (!cands.empty()) co_await teleport(m, *p, m.rng.pick(cands), J_GUIDE);
  } else if (id == "popup" && p) {
    co_await present(m, "POP-UP SHOP", 0, {{R_SHOP2, P_WAVE, fmt("Psst! %s's pop-up shop is open, just for you!", castName(R_SHOP2))}}, -1, p);
    co_await visitShop(m, *p, shopIndex("pipper"));
  } else if (id == "swap" && p) {
    std::vector<int> others;
    for (int i = 0; i < (int)m.players.size(); i++)
      if (&m.players[i] != p && m.players[i].node != p->node) others.push_back(i);
    if (others.empty()) co_return;
    Player& o = m.players[m.rng.pick(others)];
    co_await present(m, "SHUFFLE SWAP", 1, {{R_HELPER, P_SURPRISED, fmt("Whoooosh! You and %s are caught in a Shuffle Swap!", o.name())}}, -1, p);
    if (co_await shieldBlocks(m, *p)) co_return;
    co_await swapPlaces(m, *p, o);
  } else if (id == "butterfingers" && p) {
    co_await present(m, "BUTTERFINGERS", 1, {{R_HELPER, P_SURPRISED, "Uh-oh... something just slipped out of your bag!"}}, -1, p);
    if (co_await shieldBlocks(m, *p)) co_return;
    if (!p->items.empty()) {
      int it = m.rng.pick(p->items);
      removeItem(*p, it);
      co_await m.io->item(*p, it, 2);
    } else co_await loseCoins(m, *p, 3);
  } else if (id == "leak" && p) {
    int n = m.rng.range(3, 6);
    co_await present(m, "LEAKY POUCH", 1, {{R_SHOP2, P_POINT, "Your pouch has a hole in it! Coins everywhere!"}}, -1, p);
    if (co_await shieldBlocks(m, *p)) co_return;
    co_await loseCoins(m, *p, n);
  } else if (id == "backwind" && p) {
    co_await present(m, "BACKWIND", 1, {{R_HOST, P_POINT, "Whoa! A backwards breeze is pushing you back!"}}, -1, p);
    if (co_await shieldBlocks(m, *p)) co_return;
    co_await pushBackward(m, *p, 3);
  } else if (id == "gust" && p) {
    co_await present(m, "GENEROUS GUST", 1, {{R_KEEPER, P_SURPRISED, "Your coins are flying to everyone else! How generous!"}}, -1, p);
    if (co_await shieldBlocks(m, *p)) co_return;
    for (auto& o : m.players) {
      if (&o == p || p->coins <= 0) continue;
      int n = co_await loseCoins(m, *p, 2);
      if (n > 0) co_await gainCoins(m, o, n);
    }
  } else if (id == "topsy" && p) {
    co_await present(m, "TOPSY-TURVY", 1, {{R_HELPER, P_SURPRISED, "The trail is spinning backwards! Everyone nearby, hold on!"}}, -1, p);
    for (auto& o : m.players) {
      if (&o != p && m.distance(o.node, p->node, false) > 4 && m.distance(p->node, o.node, false) > 4) continue;
      if (co_await shieldBlocks(m, o)) continue;
      co_await pushBackward(m, o, 2);
    }
  } else if (id == "stroll") {
    co_await present(m, "KEEPER'S STROLL", 3, {{R_KEEPER, P_HAPPY, "I fancy a change of scenery. Follow me to my new spot!"}}, -1, nullptr);
    co_await relocateStar(m, nullptr);
  } else if (id == "surge") {
    m.b.surge.clear();
    for (int i = 0; i < m.g.count(); i++)
      if (m.g.node(i).type == SP_BLUE) m.b.surge.push_back(i);
    m.b.surgeUntil = m.round + 1;
    co_await present(m, "COIN SURGE", 3, {{R_SHOP1, P_CHEER, "Every Blue Space pays double until the end of next round!"}}, -1, nullptr);
  } else if (id == "portal_shuffle") {
    std::vector<int> ids;
    for (auto& kv : m.b.portals) ids.push_back(kv.first);
    if (ids.size() >= 4) {
      m.rng.shuffle(ids);
      m.b.portals.clear();
      for (size_t i = 0; i + 1 < ids.size(); i += 2) {
        m.b.portals[ids[i]] = ids[i + 1];
        m.b.portals[ids[i + 1]] = ids[i];
      }
    }
    co_await present(m, "WARP SHUFFLE", 3, {{R_HELPER, P_SURPRISED, "Every Warp Space just changed where it leads!"}}, -1, nullptr);
  } else if (id == "bridge_break") {
    if (m.g.def != nullptr) {
      if (m.b.bridgeUntil >= 0) {
        co_await present(m, "BRIDGE BREAK", 2, {{R_SHOP1, P_POINT, "The bridge is already in pieces! Here, a few coins for your patience."}}, -1, p);
        if (p) co_await gainCoins(m, *p, 3);
      } else {
        m.b.bridgeUntil = m.round + 2;
        co_await present(m, "BRIDGE BREAK", 2, {{R_SHOP1, P_SURPRISED, "Oh no, the rope bridge is going... going... GONE!"}, {R_SHOP1, P_POINT, "Take the detour below until it's patched up."}}, -1, p);
        m.io->boardChanged();
        for (auto& pl : m.players)
          if (m.g.bridgeGroup(pl.node) == 1) {
            int to = -1;
            for (int i = 0; i < m.g.count() && to < 0; i++)
              if (m.g.bridgeGroup(i) == 2) to = i;
            if (to >= 0) co_await teleport(m, pl, to, J_FALL);
          }
      }
    }
  } else if (id == "bridge_repair") {
    m.b.bridgeUntil = -1;
    co_await present(m, "BRIDGE REPAIRED", 3, {{R_SHOP1, P_CHEER, "Good as new! The bridge is open again."}}, -1, nullptr);
    m.io->boardChanged();
  }
  // ---- world board events -------------------------------------------------------------------
  else if (id == "cove_cannon_volley" && p) {
    co_await present(m, "CANNON VOLLEY", 2, {{R_SHOP1, P_POINT, "The galleon's cannons are loaded with party confetti. FIRE!"}}, -1, p);
    for (auto& o : m.players) {
      if (&o == p || m.distance(p->node, o.node, false) > 6) continue;
      if (co_await shieldBlocks(m, o)) continue;
      co_await pushBackward(m, o, 3);
    }
  } else if (id == "cove_treasure_map" && p) {
    co_await present(m, "TREASURE MAP", 2, {{R_KEEPER, P_CHEER, "X marks the spot! Dig in, it's buried treasure!"}}, -1, p);
    co_await gainCoins(m, *p, m.rng.range(6, 10));
  } else if ((id == "cove_high_tide" || id == "heroes_searchlight") && p) {
    bool tide = id == "cove_high_tide";
    co_await present(m, tide ? "HIGH TIDE" : "SEARCHLIGHT SWEEP", 2,
                     {{R_HOST, P_SURPRISED, tide ? "The tide's rolling in! Everyone on the low ground, hold on!" : "The searchlight sweeps the open ledges! Duck!"}}, -1, p);
    for (auto& o : m.players) {
      if (&o != p && !m.g.node(o.node).exposed) continue;
      if (co_await shieldBlocks(m, o)) continue;
      co_await pushBackward(m, o, tide ? 3 : 2);
    }
  } else if (id == "dojo_training" && p) {
    co_await present(m, "TRAINING MONTAGE", 2, {{R_HOST, P_CHEER, "Training montage! Every rep pays out. Push it!"}}, -1, p);
    co_await gainCoins(m, *p, m.rng.range(2, 9));
  } else if ((id == "dojo_bout" || id == "heroes_chase") && p) {
    bool bout = id == "dojo_bout";
    int best = -1, bestD = INF;
    for (int i = 0; i < (int)m.players.size(); i++) {
      if (&m.players[i] == p) continue;
      int d = bout ? -m.players[i].coins : m.distance(m.players[i].node, m.b.starGate, false);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) co_return;
    Player& o = m.players[best];
    if (bout) {
      co_await present(m, "TOURNAMENT BOUT", 2, {{R_HOST, P_POINT, fmt("%s versus %s in the Tournament Ring! Winner takes 5 coins!", p->name(), o.name())}}, -1, p);
      bool win = m.rng.chance(0.5);
      Player& w = win ? *p : o;
      Player& l = win ? o : *p;
      int n = co_await loseCoins(m, l, 5);
      if (n > 0) co_await gainCoins(m, w, n);
    } else {
      co_await present(m, "ROOFTOP CHASE", 2, {{R_HOST, P_POINT, fmt("After %s, across the rooftops! Swap places!", o.name())}}, -1, p);
      if (o.node != p->node) co_await swapPlaces(m, *p, o);
    }
  } else if (id == "dojo_smoke") {
    co_await present(m, "SMOKE BOMB", 2, {{R_HELPER, P_SURPRISED, "POOF! When the smoke clears, everyone has swapped places!"}}, -1, p);
    std::vector<int> spots;
    for (auto& o : m.players) spots.push_back(o.node);
    m.rng.shuffle(spots);
    for (size_t i = 0; i < m.players.size(); i++) co_await teleport(m, m.players[i], spots[i], J_SWAP);
  } else if (id == "heroes_blackout") {
    co_await present(m, "BLACKOUT", 2, {{R_KEEPER, P_SURPRISED, "I can't see a thing! I'll wait for you somewhere else."}}, -1, p);
    co_await relocateStar(m, nullptr);
  } else if (id == "coast_loop_launch" && p) {
    co_await present(m, "LOOP-THE-LOOP", 2, {{R_HELPER, P_HAPPY, "Into the loop-the-loop! Hold on tight!"}}, -1, p);
    co_await teleport(m, *p, m.aheadOf(p->node, m.rng.range(6, 10)), J_CANNON);
    co_await gainCoins(m, *p, 3);
  } else if (id == "coast_jellyfish" && p) {
    co_await present(m, "JELLYFISH SWARM", 2, {{R_SHOP2, P_SURPRISED, "A wobbly jellyfish swarm! Ow, ow, ow!"}}, -1, p);
    for (auto& o : m.players) {
      if (&o != p && strcmp(m.g.node(o.node).region, m.g.node(p->node).region) != 0) continue;
      if (co_await shieldBlocks(m, o)) continue;
      co_await loseCoins(m, o, 3);
    }
  } else if (id == "coast_donut_delivery" && p) {
    co_await present(m, "DONUT DELIVERY", 2, {{R_KEEPER, P_HAPPY, "Special delivery from the donut shop! A box for everyone!"}}, -1, p);
    for (auto& o : m.players) co_await gainCoins(m, o, &o == p ? 6 : 2);
  } else if (id == "showtime_encore" && p) {
    co_await present(m, "ENCORE!", 2, {{R_HOST, P_POINT, "The crowd wants more! Roll again and dance on down the strip!"}}, -1, p);
    int n = m.rng.range(DICE_MIN, DICE_MAX);
    co_await m.io->rollDice(*p, {n}, 0, DK_NORMAL, {});
    co_await pushForward(m, *p, n);
  } else if (id == "showtime_spotlight" && p) {
    co_await present(m, "SPOTLIGHT SOLO", 2, {{R_HOST, P_CHEER, "The spotlight finds you! Take a bow!"}}, -1, p);
    co_await gainCoins(m, *p, 6);
  } else if (id == "showtime_stampede" && p) {
    co_await present(m, "RODEO STAMPEDE", 2, {{R_HELPER, P_SURPRISED, "The toy rodeo bulls broke out! Run for it!"}}, -1, p);
    for (auto& o : m.players) {
      if (&o != p && m.distance(p->node, o.node, false) > 4 && m.distance(o.node, p->node, false) > 4) continue;
      if (co_await shieldBlocks(m, o)) continue;
      co_await pushBackward(m, o, m.rng.range(1, 3));
    }
  } else if (id == "capitol_parade" && p) {
    co_await present(m, "GARDEN PARADE", 2, {{R_HOST, P_CHEER, "A marching band! Everyone marches two spaces forward!"}}, -1, p);
    for (auto& o : m.players) co_await pushForward(m, o, 2);
    co_await gainCoins(m, *p, 3);
  } else if (id == "capitol_wish" && p) {
    co_await present(m, "FOUNTAIN WISH", 2, {{R_KEEPER, P_POINT, "Toss two coins in the fountain and make a wish!"}}, -1, p);
    co_await loseCoins(m, *p, 2);
    int r = m.rng.range(0, 3);
    if (r == 0) co_await gainCoins(m, *p, m.rng.range(6, 10));
    else if (r == 1) co_await giveItem(m, *p, randomItem(m));
    else if (r == 2) {
      m.b.salePrice = 15;
      m.b.saleUntil = m.round + 1;
      co_await m.io->say({{R_KEEPER, P_CHEER, "Your wish came true: Star Coins are 15 coins until the end of next round!"}}, p);
    } else co_await m.io->say({{R_HELPER, P_SURPRISED, "SPLASH! Nothing but a soggy wish this time."}}, p);
  } else if (id == "capitol_party") {
    co_await present(m, "GARDEN PARTY", 2, {{R_KEEPER, P_HAPPY, "Garden party! Everyone brings a third of their coins to share!"}}, -1, p);
    int pot = 0;
    for (auto& o : m.players) pot += co_await loseCoins(m, o, o.coins / 3);
    int share = pot / (int)m.players.size();
    for (auto& o : m.players) co_await gainCoins(m, o, share);
  } else if (id == "showtime_neon_surge") {
    co_await runEvent(m, "surge", nullptr);
  } else if (id == "heroes_subway") {
    co_await runEvent(m, "portal_shuffle", nullptr);
  } else if (p) {
    // an event this port doesn't know: a lucky coin shower
    co_await present(m, "SURPRISE!", 2, {{R_HOST, P_CHEER, "Surprise! A shower of coins!"}}, -1, p);
    co_await gainCoins(m, *p, 5);
  }
}

static Task<> runGlobalEvent(Match& m) {
  std::vector<std::string> pool{"parade", "stroll"};
  if (m.b.saleUntil < m.round) pool.push_back("sale");
  if (m.b.portals.size() >= 4) pool.push_back("portal_shuffle");
  if (!strcmp(m.g.def->world, "showtime")) pool.push_back("surge");
  co_await runEvent(m, m.rng.pick(pool), nullptr);
}

// ---------------------------------------------------------------------------------------------
// Items

static Task<bool> useItem(Match& m, Player& p, int it) {
  IO& io = *m.io;
  switch (it) {
    case IT_BOOTS:
      removeItem(p, it);
      m.bootsBonus += BOOTS_BONUS;
      co_await io.item(p, it, 1);
      break;
    case IT_SHIELD:
      removeItem(p, it);
      p.shielded = true;
      co_await io.item(p, it, 1);
      co_await io.shield(p, false);
      break;
    case IT_SNARE:
      for (auto& t : m.b.traps)
        if (t.first == p.node) co_return false;
      removeItem(p, it);
      m.b.traps.push_back({p.node, p.slot});
      co_await io.item(p, it, 1);
      co_await io.trap(false, p.node, p.slot, nullptr);
      break;
    case IT_CAPSULE: {
      removeItem(p, it);
      co_await io.item(p, it, 1);
      co_await giveItem(m, p, randomItem(m));
      break;
    }
    case IT_MAGNET: {
      std::vector<Target> opts;
      std::vector<int> who;
      for (int i = 0; i < (int)m.players.size(); i++)
        if (&m.players[i] != &p) {
          opts.push_back({fmt("%s (%d coins)", m.players[i].name(), m.players[i].coins), m.players[i].node, m.players[i].slot});
          who.push_back(i);
        }
      int cpu = -1;
      if (p.cpu) {
        cpu = 0;
        for (size_t k = 0; k < who.size(); k++)
          if (m.players[who[k]].coins > m.players[who[cpu]].coins) cpu = (int)k;
        if (sloppy(m, p)) cpu = m.rng.range(0, (int)who.size() - 1);
      }
      int pick = co_await io.chooseTarget(p, "Pull coins from which rival?", opts, cpu);
      if (pick < 0) co_return false;
      removeItem(p, it);
      co_await io.item(p, it, 1);
      Player& v = m.players[who[pick]];
      if (co_await shieldBlocks(m, v)) break;
      int n = co_await loseCoins(m, v, MAGNET_STEAL);
      if (n > 0) co_await gainCoins(m, p, n);
      break;
    }
    case IT_WARP: {
      std::vector<Target> opts;
      for (auto& o : m.players)
        if (&o != &p && o.node != p.node) opts.push_back({fmt("Warp to %s", o.name()), o.node, o.slot});
      for (auto& kv : m.b.portals) {
        bool dup = kv.first == p.node;
        for (auto& t : opts) dup |= t.node == kv.first;
        if (!dup) opts.push_back({std::string("Warp: ") + (m.g.node(kv.first).region[0] ? m.g.node(kv.first).region : "Warp Space"), kv.first, -1});
      }
      if (opts.empty()) co_return false;
      int cpu = -1;
      if (p.cpu) {
        int best = bestWarpTarget(m, p);
        cpu = 0;
        for (size_t k = 0; k < opts.size(); k++)
          if (opts[k].node == best) cpu = (int)k;
      }
      int pick = co_await io.chooseTarget(p, "Warp where?", opts, cpu);
      if (pick < 0) co_return false;
      removeItem(p, it);
      co_await io.item(p, it, 1);
      co_await teleport(m, p, opts[pick].node, J_WARP);
      break;
    }
    case IT_DOUBLE:
    case IT_TRIPLE:
      removeItem(p, it);
      m.diceCount = it == IT_DOUBLE ? 2 : 3;
      co_await io.item(p, it, 1);
      break;
    case IT_CUSTOM: {
      int cpu = -1;
      if (p.cpu) cpu = aiCustomRoll(m, p);
      removeItem(p, it);
      co_await io.item(p, it, 1);
      m.customRoll = co_await io.chooseNumber(p, DICE_MIN, DICE_MAX, cpu);
      break;
    }
    case IT_PIPE:
      removeItem(p, it);
      co_await io.item(p, it, 1);
      co_await io.say({{R_KEEPER, P_WAVE, "A Golden Pipe! Straight to the Star Coin, this way!"}}, &p);
      co_await teleport(m, p, m.b.starGate, J_WARP);
      m.starOffered.clear();
      co_await offerStar(m, p);
      m.turnOver = true;
      break;
    case IT_GLOVE:
      removeItem(p, it);
      co_await io.item(p, it, 1);
      co_await duel(m, p);
      break;
    default:
      co_return false;
  }
  p.st.itemsUsed++;
  co_return true;
}

static std::vector<int> usableItems(Match& m, Player& p) {
  std::vector<int> out;
  if (m.itemUsed) return out;
  bool canWarp = !m.b.portals.empty();
  for (auto& o : m.players)
    if (&o != &p && o.node != p.node) canWarp = true;
  for (int it : p.items) {
    if (strcmp(ITEMS[it].timing, "preRoll") != 0) continue;
    if (it == IT_WARP && !canWarp) continue;
    if (it == IT_MAGNET && m.players.size() < 2) continue;
    if (it == IT_SNARE) {
      bool taken = false;
      for (auto& t : m.b.traps) taken |= t.first == p.node;
      if (taken) continue;
    }
    if (std::find(out.begin(), out.end(), it) == out.end()) out.push_back(it);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Movement, landing, turns (TurnFlow)

// ---------------------------------------------------------------------------------------------
// The board's characters: the bank, the thief and the villain

// Passing the bank costs 5 coins; landing on it wins everything in it.
static Task<> bankToll(Match& m, Player& p) {
  if (p.coins <= 0) {
    co_await m.io->say({{R_BANKER, P_IDLE, "No coins? Then off you go, the bank only takes coins!"}}, &p);
    co_return;
  }
  co_await m.io->say({{R_BANKER, P_POINT, fmt("Bank toll! 5 coins, please. The bank holds %d coins so far.", m.b.bankCoins)}}, &p);
  m.b.bankCoins += co_await loseCoins(m, p, 5);
}

static Task<> bankPayout(Match& m, Player& p) {
  if (m.b.bankCoins <= 0) {
    co_await m.io->say({{R_BANKER, P_IDLE, "The bank is empty... for now. Everyone who passes pays 5 coins!"}}, &p);
    co_return;
  }
  int won = m.b.bankCoins;
  m.b.bankCoins = 0;
  co_await m.io->say({{R_BANKER, P_SURPRISED, fmt("You landed on the bank! All %d coins are yours!", won)}}, &p);
  co_await gainCoins(m, p, won);
}

// The thief "borrows" coins (5 coins) or a Star Coin (50 coins) from a rival.
static Task<> thiefVisit(Match& m, Player& p) {
  bool rivalCoins = false, rivalStars = false;
  for (auto& o : m.players)
    if (&o != &p) rivalCoins |= o.coins > 0, rivalStars |= o.stars > 0;
  bool canCoins = p.coins >= 5 && rivalCoins, canStar = p.coins >= 50 && rivalStars;
  if (!canCoins && !canStar) {
    co_await m.io->say({{R_THIEF, P_IDLE, "Psst... come back with 5 coins and I'll pinch something from a rival for you!"}}, &p);
    co_return;
  }
  co_await m.io->say({{R_THIEF, P_WAVE, "Psst! For a few coins I can 'borrow' something from a rival..."}}, &p);
  std::vector<Target> opts;
  std::vector<int> kinds;
  if (canCoins) opts.push_back({"Steal coins (pay 5)", -1, -1}), kinds.push_back(0);
  if (canStar) opts.push_back({"Steal a Star Coin (pay 50)", -1, -1}), kinds.push_back(1);
  opts.push_back({"No thanks", -1, -1});
  kinds.push_back(-1);
  int cpu = -1;
  if (p.cpu) {
    cpu = (int)opts.size() - 1;
    if (canStar && !sloppy(m, p)) cpu = canCoins ? 1 : 0;
    else if (canCoins && m.rng.chance(0.6)) cpu = 0;
  }
  int pick = co_await m.io->chooseTarget(p, "What shall I steal?", opts, cpu);
  int kind = pick < 0 ? -1 : kinds[pick];
  if (kind < 0) {
    co_await m.io->say({{R_THIEF, P_IDLE, "Suit yourself. You know where to find me!"}}, &p);
    co_return;
  }
  std::vector<Target> who;
  std::vector<int> idx;
  for (size_t i = 0; i < m.players.size(); i++) {
    Player& o = m.players[i];
    if (&o == &p || (kind == 0 ? o.coins <= 0 : o.stars <= 0)) continue;
    who.push_back({kind == 0 ? fmt("%s (%d coins)", o.name(), o.coins) : fmt("%s (%d Star Coins)", o.name(), o.stars), o.node, o.slot});
    idx.push_back((int)i);
  }
  int tcpu = -1;
  if (p.cpu) {
    tcpu = 0;
    for (size_t k = 0; k < idx.size(); k++) {
      const Player &a = m.players[idx[k]], &c = m.players[idx[tcpu]];
      if (kind == 0 ? a.coins > c.coins : a.stars > c.stars) tcpu = (int)k;
    }
  }
  int t = co_await m.io->chooseTarget(p, kind == 0 ? "Steal coins from who?" : "Steal a Star Coin from who?", who, tcpu);
  if (t < 0) t = 0;
  Player& v = m.players[idx[t]];
  co_await spendCoins(m, p, kind == 0 ? 5 : 50);
  co_await m.io->say({{R_THIEF, P_CHEER, fmt("Leave it to me! Off to see %s...", v.name())}}, &p);
  if (co_await shieldBlocks(m, v)) {
    co_await m.io->say({{R_THIEF, P_SURPRISED, "A shield?! I couldn't get a thing!"}}, &p);
    co_return;
  }
  if (kind == 0) {
    int n = co_await loseCoins(m, v, m.rng.range(5, 15));
    co_await m.io->say({{R_THIEF, P_HAPPY, fmt("Got away with %d coins!", n)}}, &p);
    if (n > 0) co_await gainCoins(m, p, n);
  } else {
    v.stars--;
    p.stars++;
    co_await m.io->say({{R_THIEF, P_HAPPY, fmt("Swiped a Star Coin from %s!", v.name())}}, &p);
    co_await m.io->starGained(p, 1);
  }
  m.io->boardChanged();
}

// A villain space: the board's villain spins the wheel of misfortune.
static Task<> villainSpace(Match& m, Player& p) {
  std::string name = castName(R_VILLAIN);
  co_await present(m, (name + " APPEARS!").c_str(), 1,
                   {{R_VILLAIN, P_POINT, "Ha! You've stepped into MY space! Let's spin my wheel of misfortune!"}}, -1, &p);
  std::vector<std::string> labels{"Coin tax", "Revolution!", "Star snatch", "Everybody pays", "Back to start", "Good mood"};
  int pick = m.rng.weighted({1.4f, 0.9f, p.stars > 0 ? 0.5f : 0.f, 1.0f, 0.6f, 0.35f});
  co_await m.io->roulette(p, name + "'s wheel of misfortune", labels, pick, R_VILLAIN);
  switch (pick) {
    case 0: {
      int n = co_await loseCoins(m, p, m.rng.range(10, 20));
      co_await m.io->say({{R_VILLAIN, P_HAPPY, n > 0 ? fmt("%d coins for me! Mwa ha ha!", n) : std::string("No coins at all? How disappointing.")}}, &p);
      break;
    }
    case 1: {
      // everyone's coins pooled and shared out equally
      int total = 0;
      for (auto& o : m.players) total += o.coins;
      int share = total / (int)m.players.size();
      co_await m.io->say({{R_VILLAIN, P_CHEER, fmt("REVOLUTION! Everyone's coins are shared out: %d each!", share)}}, nullptr);
      for (auto& o : m.players) {
        int d = share - o.coins;
        o.coins = share;
        o.st.peakCoins = std::max(o.st.peakCoins, o.coins);
        if (d) co_await m.io->coins(o, d);
      }
      break;
    }
    case 2:
      p.stars--;
      co_await m.io->say({{R_VILLAIN, P_HAPPY, "I'll be taking one of those Star Coins, thank you very much!"}}, &p);
      m.io->boardChanged();
      break;
    case 3:
      co_await m.io->say({{R_VILLAIN, P_CHEER, "Everybody pays! 5 coins each, hand them over!"}}, nullptr);
      for (auto& o : m.players) co_await loseCoins(m, o, 5);
      break;
    case 4:
      co_await m.io->say({{R_VILLAIN, P_POINT, "Back to the start with you!"}}, &p);
      co_await teleport(m, p, m.g.id(m.g.def->startNode), J_FALL);
      break;
    default:
      co_await m.io->say({{R_VILLAIN, P_IDLE, "Bah, I'm in a good mood today. Take 5 coins and go away!"}}, &p);
      co_await gainCoins(m, p, 5);
  }
}

static Task<> move(Match& m, Player& p, int steps) {
  int remaining = steps;
  while (remaining > 0) {
    int at = p.node;
    auto ex = m.exits(at, p.has(IT_KEY));
    if (ex.empty()) break;
    int pick = 0;
    if (ex.size() > 1) {
      std::vector<PathOpt> opts;
      for (auto& e : ex) {
        std::string label;
        for (auto& s : m.g.node(at).signs)
          if (s.to && s.to[0] && m.g.id(s.to) == e.to) label = s.label;
        if (label.empty()) label = m.g.node(e.to).region;
        opts.push_back({e.to, label, e.needsKey});
      }
      int cpu = p.cpu ? aiPath(m, p, opts) : -1;
      pick = co_await m.io->choosePath(p, at, opts, cpu);
    }
    Exit e = ex[pick];
    if (e.needsKey && p.has(IT_KEY)) {
      removeItem(p, IT_KEY);
      p.st.itemsUsed++;
      co_await m.io->item(p, IT_KEY, 1);
    }
    remaining--;
    co_await m.io->moveStep(p, at, e.to, remaining);
    p.trail.push_back(at);
    if (p.trail.size() > 16) p.trail.erase(p.trail.begin());
    p.node = e.to;
    p.st.moved++;
    auto& n = m.g.node(p.node);
    if (n.type == SP_STAR && m.b.starGate == p.node) co_await offerStar(m, p);
    else if (n.type == SP_SHOP && remaining > 0 && n.shop[0]) co_await visitShop(m, p, shopIndex(n.shop));
    if (p.node == m.b.bankNode && remaining > 0) co_await bankToll(m, p);
    if (p.node == m.b.thiefNode && remaining > 0) co_await thiefVisit(m, p);
  }
}

static Task<> hiddenBlock(Match& m, Player& p, int type) {
  if (type != SP_BLUE && type != SP_LUCKY && type != SP_BADLUCK) co_return;
  if (!m.rng.chance(0.03)) co_return;
  bool star = m.rng.chance(0.2);
  co_await m.io->hiddenBlock(p, star);
  if (star) {
    p.stars++;
    co_await m.io->starGained(p, 2);
  } else co_await gainCoins(m, p, 10);
}

static Task<> land(Match& m, Player& p) {
  int node = p.node;
  auto& n = m.g.node(node);
  co_await m.io->landed(p, node);
  for (size_t i = 0; i < m.b.traps.size(); i++)
    if (m.b.traps[i].first == node && m.b.traps[i].second != p.slot) {
      int owner = m.b.traps[i].second;
      m.b.traps.erase(m.b.traps.begin() + i);
      co_await m.io->trap(true, node, owner, &p);
      if (!(co_await shieldBlocks(m, p))) {
        int lost = co_await loseCoins(m, p, SNARE_STEAL);
        for (auto& o : m.players)
          if (o.slot == owner && lost > 0) co_await gainCoins(m, o, lost);
      }
      break;
    }
  // the space's colour splits the players for the round's minigame
  p.color = (n.type == SP_BLUE || n.type == SP_START || n.type == SP_LUCKY) ? SC_BLUE : (n.type == SP_BADLUCK ? SC_RED : SC_GREEN);
  if (m.b.isVillain(node)) {
    p.color = SC_RED;
    co_await villainSpace(m, p);
    co_return;
  }
  if (node == m.b.bankNode) co_await bankPayout(m, p);
  if (node == m.b.thiefNode) co_await thiefVisit(m, p);
  switch (n.type) {
    case SP_START:
    case SP_BLUE: {
      int base = m.finalRound() ? BLUE_FINAL : BLUE_COINS;
      bool surge = m.b.surgeUntil >= m.round && std::find(m.b.surge.begin(), m.b.surge.end(), node) != m.b.surge.end();
      co_await gainCoins(m, p, base * (surge ? 2 : 1));
      break;
    }
    case SP_LUCKY: co_await evLucky(m, p); break;
    case SP_BADLUCK:
      // a red space costs 3 coins (6 in the final round), and sometimes worse
      co_await loseCoins(m, p, m.finalRound() ? 6 : 3);
      if (m.rng.chance(0.4)) {
        co_await m.io->say({{R_HELPER, P_SURPRISED, "Oh no, that's not all..."}}, &p);
        co_await evBadLuck(m, p);
      }
      break;
    case SP_HAPPENING:
      p.st.events++;
      co_await runEvent(m, n.eventId[0] ? n.eventId : "lanterns", &p);
      if (m.finalRound()) co_await gainCoins(m, p, 3);
      break;
    case SP_SHOP:
      if (n.shop[0]) co_await visitShop(m, p, shopIndex(n.shop));
      break;
    case SP_WARP: {
      auto it = m.b.portals.find(node);
      if (it != m.b.portals.end()) {
        p.st.lucky++;
        co_await teleport(m, p, it->second, J_WARP);
      }
      break;
    }
    case SP_STAR:
      if (m.b.starGate != node) {
        co_await m.io->say({{R_KEEPER, P_IDLE, "No Star Coin here today... but have a few coins for stopping by!"}}, &p);
        co_await gainCoins(m, p, 2);
      }
      break;
  }
  co_await hiddenBlock(m, p, n.type);
}

static Task<> runTurn(Match& m, Player& p) {
  m.bootsBonus = 0;
  m.diceCount = 1;
  m.customRoll = 0;
  m.characterDiceNext = false;
  m.turnOver = false;
  m.itemUsed = false;
  m.bounced = false;
  m.starOffered.clear();
  co_await m.io->turnStart(p);
  for (int guard = 0; guard < 6; guard++) {
    auto usable = usableItems(m, p);
    int cpu = p.cpu ? aiPreRoll(m, p, usable) : -1;
    int choice = co_await m.io->preRoll(p, usable, cpu);
    if (choice == PRE_CHARACTER_DICE) {
      m.characterDiceNext = true;
      break;
    }
    if (choice < 0) break;
    if (std::find(usable.begin(), usable.end(), choice) == usable.end()) continue;
    if (co_await useItem(m, p, choice)) m.itemUsed = true;
  }
  if (m.turnOver) {
    // the Golden Pipe ends the turn at the Star Coin
    co_await m.io->turnEnd(p);
    co_return;
  }
  // the roll: one Dice Block (1-10), two or three (Double / Triple Dice), the chosen number (Custom Dice)
  // or a face of the character's own dice
  std::vector<int> results, faces;
  int kind = DK_NORMAL, faceCoins = 0;
  if (m.customRoll > 0) {
    results = {m.customRoll};
    kind = DK_CUSTOM;
  } else if (m.characterDiceNext) {
    const CharacterDice& cd = characterDice(p.character);
    int f = m.rng.range(0, 5);
    faces = {f};
    results = {cd.faces[f].steps};
    faceCoins = cd.faces[f].coins;
    kind = DK_CHARACTER;
  } else
    for (int k = 0; k < m.diceCount; k++) results.push_back(m.rng.range(DICE_MIN, DICE_MAX));
  co_await m.io->rollDice(p, results, m.bootsBonus, kind, faces);
  if (kind == DK_NORMAL && results.size() == 1 && p.has(IT_BEAN)) {
    int result = results[0];
    int cpu = -1;
    if (p.cpu) {
      int dist = starDist(m, p.node, p.has(IT_KEY));
      bool want = (p.coins >= m.starPrice() && dist <= 10 + m.bootsBonus && result + m.bootsBonus < dist) || result <= 3;
      if (sloppy(m, p)) want = m.rng.chance(0.5);
      cpu = want ? 1 : 0;
    }
    if (co_await m.io->offerReroll(p, result, cpu)) {
      removeItem(p, IT_BEAN);
      p.st.itemsUsed++;
      co_await m.io->item(p, IT_BEAN, 1);
      results = {m.rng.range(DICE_MIN, DICE_MAX)};
      co_await m.io->rollDice(p, results, m.bootsBonus, DK_NORMAL, {});
    }
  }
  int total = 0;
  for (int r : results) total += r;
  if (results.size() >= 2) {
    bool triple = results.size() == 3 && results[0] == results[1] && results[1] == results[2];
    bool dbl = !triple && (results[0] == results[1] || (results.size() == 3 && (results[0] == results[2] || results[1] == results[2])));
    if (triple) {
      co_await m.io->say({{R_HOST, P_CHEER, "TRIPLES! That's 30 bonus coins!"}}, &p);
      co_await gainCoins(m, p, 30);
    } else if (dbl) {
      co_await m.io->say({{R_HOST, P_CHEER, "DOUBLES! 10 bonus coins!"}}, &p);
      co_await gainCoins(m, p, 10);
    }
  }
  if (faceCoins > 0) co_await gainCoins(m, p, faceCoins);
  else if (faceCoins < 0) co_await loseCoins(m, p, -faceCoins);
  if (total + m.bootsBonus > 0) {
    co_await move(m, p, total + m.bootsBonus);
    co_await land(m, p);
  }
  co_await m.io->turnEnd(p);
}

// ---------------------------------------------------------------------------------------------
// Match beats and the round loop (MatchBeats + TurnManager)

static Task<> rollTurnOrder(Match& m) {
  m.orderRolled = true;
  if (m.players.size() < 2) co_return;
  co_await m.io->headline("WHO GOES FIRST?", "EVERYONE HITS THE DICE BLOCK");
  std::vector<int> lots;
  for (int i = DICE_MIN; i <= DICE_MAX; i++) lots.push_back(i);
  m.rng.shuffle(lots);
  std::vector<std::pair<int, int>> spin;  // roll, slot
  for (size_t i = 0; i < m.players.size(); i++) {
    co_await m.io->rollDice(m.players[i], {lots[i]}, 0, DK_NORMAL, {});
    spin.push_back({lots[i], m.players[i].slot});
  }
  std::stable_sort(m.players.begin(), m.players.end(), [&](const Player& a, const Player& c) {
    int ra = 0, rc = 0;
    for (auto& s : spin) {
      if (s.second == a.slot) ra = s.first;
      if (s.second == c.slot) rc = s.first;
    }
    return ra > rc;
  });
  std::string rest;
  for (size_t i = 1; i < m.players.size(); i++) rest += std::string(i == 1 ? "" : (i + 1 == m.players.size() ? " and " : ", ")) + m.players[i].name();
  co_await m.io->say({{R_HOST, P_CHEER, fmt("%s rolled highest and goes first! Then %s.", m.players[0].name(), rest.c_str())}}, nullptr);
  co_await m.io->orderDecided();
  m.io->boardChanged();
}

static Task<> finalStretch(Match& m) {
  m.stretchDone = true;
  int left = m.rounds - m.round + 1;
  co_await m.io->headline(fmt("LAST %d TURNS!", left), "THE FINAL STRETCH");
  auto pl = standings(m.players);
  int worst = *std::max_element(pl.begin(), pl.end());
  std::vector<int> lasts;
  for (size_t i = 0; i < pl.size(); i++)
    if (pl[i] == worst) lasts.push_back((int)i);
  Player& last = m.players[m.rng.pick(lasts)];
  co_await m.io->say({{R_HOST, P_CHEER, fmt("Only %d turns left, and it's still anyone's party!", left)}, {R_HOST, P_HAPPY, fmt("%s, you're trailing, so here's a boost to catch up!", last.name())}}, nullptr);
  co_await gainCoins(m, last, 10);
  int twist = m.rng.range(0, 2);
  if (twist == 0) {
    m.b.salePrice = 15;
    m.b.saleUntil = m.rounds;
    co_await m.io->say({{R_KEEPER, P_CHEER, "The party wheel says... STAR COIN SALE! Just 15 coins each until the very end!"}}, nullptr);
  } else if (twist == 1) {
    m.b.surge.clear();
    for (int i = 0; i < m.g.count(); i++)
      if (m.g.node(i).type == SP_BLUE) m.b.surge.push_back(i);
    m.b.surgeUntil = m.rounds;
    co_await m.io->say({{R_SHOP1, P_CHEER, "The party wheel says... COIN SURGE! Every Blue Space pays double from now on!"}}, nullptr);
  } else {
    co_await m.io->say({{R_KEEPER, P_HAPPY, fmt("The party wheel says... MYSTERY GIFT! %s, this one's for you too!", last.name())}}, &last);
    co_await giveItem(m, last, randomItem(m));
  }
  m.io->boardChanged();
}

Task<> runMatch(Match& m) {
  while (true) {
    // round start: clear expired effects
    bool repaired = m.b.bridgeUntil >= 0 && m.round > m.b.bridgeUntil;
    if (m.b.surgeUntil >= 0 && m.round > m.b.surgeUntil) {
      m.b.surge.clear();
      m.b.surgeUntil = -1;
    }
    if (m.b.saleUntil >= 0 && m.round > m.b.saleUntil) m.b.saleUntil = -1;
    m.io->boardChanged();
    co_await m.io->roundStart(m.round, m.rounds, m.finalRound());
    if (m.round == 1 && !m.orderRolled) {
      co_await rollTurnOrder(m);
      if (!m.testEvent.empty()) co_await runEvent(m, m.testEvent, &m.players[0]);
    }
    if (m.rounds >= 5 && m.round == m.rounds - (m.rounds >= 10 ? 4 : 2) && !m.stretchDone) co_await finalStretch(m);
    if (repaired) co_await runEvent(m, "bridge_repair", nullptr);
    if (m.finalRound()) {
      co_await m.io->say({{R_HOST, P_CHEER, "The final round is here! Last chance to grab those Star Coins!"},
                          {R_HOST, P_HAPPY, "Blue Spaces now pay 5 coins, and Happening Spaces pay a bonus too!"}},
                         nullptr);
      co_await runGlobalEvent(m);
    }
    for (size_t i = 0; i < m.players.size(); i++) co_await runTurn(m, m.players[i]);
    // the round's minigame: with four players, the colours of the spaces they ended on split them up
    // (green spaces join a side at random): all one colour is everyone for themselves, 3 and 1 is 1 vs 3,
    // 2 and 2 is 2 vs 2
    MgMode mode = MG_FFA;
    std::vector<int> teams;
    if (m.players.size() == 4) {
      int blues = 0;
      for (auto& p : m.players) {
        int c = p.color == SC_GREEN ? (m.rng.chance(0.5) ? SC_BLUE : SC_RED) : p.color;
        teams.push_back(c == SC_BLUE ? 0 : 1);
        blues += c == SC_BLUE;
      }
      mode = blues == 2 ? MG_2V2 : (blues == 1 || blues == 3 ? MG_1V3 : MG_FFA);
      if (mode == MG_FFA) teams.clear();
    }
    co_await m.io->minigameType(mode, teams);
    std::vector<int> who;
    for (size_t i = 0; i < m.players.size(); i++) who.push_back((int)i);
    std::vector<int> places = co_await m.io->playMinigame(mode, who, teams);
    std::vector<int> coins(m.players.size());
    for (size_t i = 0; i < m.players.size(); i++) {
      int pl = i < places.size() ? places[i] : 4;
      // free-for-all pays by place; in team games every winner gets 10 coins
      coins[i] = mode == MG_FFA ? REWARDS[std::max(0, std::min(3, pl - 1))] : (pl == 1 ? 10 : 0);
      m.players[i].coins += coins[i];
      m.players[i].st.earned += coins[i];
      m.players[i].st.mgCoins += coins[i];
      m.players[i].st.peakCoins = std::max(m.players[i].st.peakCoins, m.players[i].coins);
      if (pl == 1) m.players[i].st.wins++;
    }
    co_await m.io->minigameRewards(places, coins);
    if (m.round >= m.rounds) break;
    m.round++;
  }
  std::vector<Award> awards;
  for (int k = 0; k < 3; k++) {
    Award a;
    a.name = BONUS_NAMES[m.bonus[k]][0];
    a.desc = BONUS_NAMES[m.bonus[k]][1];
    int best = 0;
    for (auto& p : m.players) {
      a.values.push_back(statOf(p, m.bonus[k]));
      best = std::max(best, a.values.back());
    }
    if (best > 0)
      for (size_t i = 0; i < m.players.size(); i++)
        if (a.values[i] == best) {
          a.winners.push_back((int)i);
          m.players[i].stars++;
        }
    awards.push_back(a);
  }
  co_await m.io->bonusAwards(awards);
  co_await m.io->finalResults();
}

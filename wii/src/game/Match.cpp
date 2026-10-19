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

static int castIndex(const char* id) {
  for (int i = 0; i < CAST_COUNT; i++)
    if (!strcmp(CAST[i].id, id)) return i;
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
  for (int r = 0; r < R_COUNT; r++) g_cast[r] = picks[r];
}

int castOf(Role r) { return g_cast[r]; }
const char* castName(Role r) { return CAST[g_cast[r]].name; }

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
  std::vector<int> cats{0, 1, 2, 3, 4, 5, 6};
  rng.shuffle(cats);
  for (int i = 0; i < 3; i++) bonus[i] = cats[i];
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

static const char* BONUS_NAMES[7][2] = {{"Trailblazer", "Most spaces travelled"}, {"Treasure Keeper", "Most coins earned"},
                                        {"Game Champion", "Most minigame wins"},    {"Item Expert", "Most items used"},
                                        {"Event Explorer", "Most Happening Spaces"}, {"Big Spender", "Most coins spent"},
                                        {"Lucky Landing", "Most Lucky Spaces"}};
const char* bonusName(int id) { return BONUS_NAMES[id][0]; }

static int statOf(const Player& p, int id) {
  switch (id) {
    case 0: return p.st.moved;
    case 1: return p.st.earned;
    case 2: return p.st.wins;
    case 3: return p.st.itemsUsed;
    case 4: return p.st.events;
    case 5: return p.st.spent;
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

static int aiPreRoll(Match& m, Player& p, const std::vector<int>& usable) {
  if (usable.empty() || sloppy(m, p)) return -1;
  auto has = [&](int it) { return std::find(usable.begin(), usable.end(), it) != usable.end(); };
  int dist = starDist(m, p.node, p.has(IT_KEY));
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
  return -1;
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
  static const std::vector<float> w = {1.0f, 0.6f, 1.4f, 1.0f, 1.0f, 0.6f, 0.9f, 1.0f};
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

static Task<> evLucky(Match& m, Player& p) {
  p.st.lucky++;
  std::vector<std::string> ids{"parade", "sale", "lanterns", "delivery", "tailwind", "guide", "popup"};
  std::vector<float> w{1, m.b.saleUntil >= m.round ? 0.f : 0.8f, 1.4f, 1.2f, 1, m.distance(p.node, m.b.starGate, false) > 6 ? 0.7f : 0.f, p.coins >= 4 ? 0.8f : 0.f};
  co_await runEvent(m, ids[m.rng.weighted(w)], &p);
}

static Task<> evBadLuck(Match& m, Player& p) {
  bool rivalElsewhere = false;
  for (auto& o : m.players)
    if (&o != &p && o.node != p.node) rivalElsewhere = true;
  std::vector<std::string> ids{"swap", "butterfingers", "leak", "backwind", "gust", "topsy"};
  std::vector<float> w{rivalElsewhere ? 1.f : 0.f, 1, 1.3f, 1, p.coins > 0 ? 1.f : 0.f, 0.8f};
  co_await runEvent(m, ids[m.rng.weighted(w)], &p);
}

static Task<> runEvent(Match& m, const std::string& id, Player* p) {
  IO& io = *m.io;
  (void)io;
  if (id == "parade") {
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
    co_await m.io->rollDice(*p, n, 0);
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
  switch (n.type) {
    case SP_START:
    case SP_BLUE: {
      int base = m.finalRound() ? BLUE_FINAL : BLUE_COINS;
      bool surge = m.b.surgeUntil >= m.round && std::find(m.b.surge.begin(), m.b.surge.end(), node) != m.b.surge.end();
      co_await gainCoins(m, p, base * (surge ? 2 : 1));
      break;
    }
    case SP_LUCKY: co_await evLucky(m, p); break;
    case SP_BADLUCK: co_await evBadLuck(m, p); break;
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
  m.itemUsed = false;
  m.bounced = false;
  m.starOffered.clear();
  co_await m.io->turnStart(p);
  for (int guard = 0; guard < 6; guard++) {
    auto usable = usableItems(m, p);
    int cpu = p.cpu ? aiPreRoll(m, p, usable) : -1;
    int choice = co_await m.io->preRoll(p, usable, cpu);
    if (choice < 0) break;
    if (std::find(usable.begin(), usable.end(), choice) == usable.end()) continue;
    if (co_await useItem(m, p, choice)) m.itemUsed = true;
  }
  int result = m.rng.range(DICE_MIN, DICE_MAX);
  co_await m.io->rollDice(p, result, m.bootsBonus);
  if (p.has(IT_BEAN)) {
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
      result = m.rng.range(DICE_MIN, DICE_MAX);
      co_await m.io->rollDice(p, result, m.bootsBonus);
    }
  }
  co_await move(m, p, result + m.bootsBonus);
  co_await land(m, p);
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
    co_await m.io->rollDice(m.players[i], lots[i], 0);
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
  co_await m.io->headline("FINAL STRETCH!", "3 ROUNDS TO GO");
  auto pl = standings(m.players);
  int worst = *std::max_element(pl.begin(), pl.end());
  std::vector<int> lasts;
  for (size_t i = 0; i < pl.size(); i++)
    if (pl[i] == worst) lasts.push_back((int)i);
  Player& last = m.players[m.rng.pick(lasts)];
  co_await m.io->say({{R_HOST, P_CHEER, "Only three rounds left, and it's still anyone's party!"}, {R_HOST, P_HAPPY, fmt("%s, you're trailing, so here's a boost to catch up!", last.name())}}, nullptr);
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
    if (m.round == 1 && !m.orderRolled) co_await rollTurnOrder(m);
    if (m.rounds >= 5 && m.round == m.rounds - 2 && !m.stretchDone) co_await finalStretch(m);
    if (repaired) co_await runEvent(m, "bridge_repair", nullptr);
    if (m.finalRound()) {
      co_await m.io->say({{R_HOST, P_CHEER, "The final round is here! Last chance to grab those Star Coins!"},
                          {R_HOST, P_HAPPY, "Blue Spaces now pay 5 coins, and Happening Spaces pay a bonus too!"}},
                         nullptr);
      co_await runGlobalEvent(m);
    }
    for (size_t i = 0; i < m.players.size(); i++) co_await runTurn(m, m.players[i]);
    // the round's minigame
    std::vector<int> places = co_await m.io->playMinigame();
    std::vector<int> coins(m.players.size());
    for (size_t i = 0; i < m.players.size(); i++) {
      int pl = i < places.size() ? places[i] : 4;
      coins[i] = REWARDS[std::max(0, std::min(3, pl - 1))];
      m.players[i].coins += coins[i];
      m.players[i].st.earned += coins[i];
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

// Clone Chaos (Naruto, Hidden Dojo): the ninja hides among his smoke clones on the village rooftops.
// Watch the real one as they leap and shuffle, then move your marker onto him and press A before the
// smoke clears: a right pick scores 2, plus up to 3 more for speed. Five rounds, each with more clones,
// faster moves and more tricks (smoke screens, decoys, lights out); the last counts double.
// The rules run in the web game's 1920x1080 stage coordinates and are drawn scaled by S.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "../game/Data.h"
#include "../game/Sprites.h"
#include "Minigame.h"

namespace {

constexpr float S = VW / 1920.0f;
constexpr float PI = 3.14159265f;
constexpr float CHAR_K = 1.4f;  // web character scale -> Wii character scale

constexpr int ROUNDS = 5;
constexpr int BASE_POINTS = 2;
constexpr int SPEED_POINTS = 3;
constexpr float SPEED_STEPS[3] = {1100, 2200, 3300};
// Beat lengths (ms)
constexpr float INTRO_MS = 800, REVEAL_MS = 950, CLONE_MS = 700, STEP_GAP = 90, RESULT_MS = 1750, TRICK_EXTRA = 160;
constexpr float APEX_MIN_Y = 228;
constexpr float CALL_Y = 885;
// The watchers' deck (web px): a little higher than the web's 1040 so the score strip stays clear.
constexpr float DECK_FEET = 962;
constexpr float DECK_SCALE = 0.8f;

struct Skill {
  float reaction, accuracy, mistake, aimNoise, think;
};
constexpr Skill SKILL[3] = {{520, 0.55f, 0.24f, 0.55f, 700}, {300, 0.78f, 0.11f, 0.28f, 420}, {170, 0.9f, 0.05f, 0.13f, 240}};

enum Kind { SWAP, HOP, ROTATE, DOUBLE };
enum Trick { NO_TRICK, SMOKE, DECOY, BLACKOUT };
enum Dir { D_LEFT, D_RIGHT, D_UP, D_DOWN };

// Each round's plan: clones, moves, ms per move, how many of (swap hop rotate double) and of
// (smoke decoy blackout) it may use, pick time and the longest leap.
struct Plan {
  int clones, moves;
  float moveMs;
  int nKinds, nTricks;
  float pickMs, reach;
};
constexpr Plan TABLE[ROUNDS] = {
    {5, 5, 760, 1, 0, 4500, 430}, {6, 6, 660, 3, 0, 4300, 520}, {7, 7, 580, 4, 2, 4100, 620}, {8, 8, 510, 4, 3, 3900, 720}, {9, 9, 460, 4, 3, 3800, 820}};

// Where the clones stand: the three roof ridges of the rendered village (back to front).
struct Spot {
  float x, y, scale;
  int row;
};
constexpr int NSPOTS = 12;
std::array<Spot, NSPOTS> makeSpots() {
  std::array<Spot, NSPOTS> s{};
  const float xs0[4] = {480, 800, 1120, 1440}, xs1[5] = {320, 640, 960, 1280, 1600}, xs2[3] = {560, 960, 1360};
  int n = 0;
  for (float x : xs0) s[n++] = {x, 340, 0.54f, 0};
  for (float x : xs1) s[n++] = {x, 545, 0.6f, 1};
  for (float x : xs2) s[n++] = {x, 760, 0.68f, 2};
  return s;
}
const std::array<Spot, NSPOTS> SPOTS = makeSpots();

float spotDist(int a, int b) { return std::hypot(SPOTS[a].x - SPOTS[b].x, (SPOTS[a].y - SPOTS[b].y) * 1.2f); }

int startSpot() {
  int best = 0;
  for (int i = 1; i < NSPOTS; i++)
    if (std::hypot(SPOTS[i].x - 960, SPOTS[i].y - 545) < std::hypot(SPOTS[best].x - 960, SPOTS[best].y - 545)) best = i;
  return best;
}

using Occ = std::vector<int>;  // occ[spot] = clone standing there (0 = the real ninja), -1 empty

struct Step {
  int kind = SWAP;
  int spots[4] = {0, 0, 0, 0};
  int n = 2;
  int trick = NO_TRICK;
  int decoy = -1;
};
struct LeapRec {
  int clone, from, to;
};

int spotOf(const Occ& occ, int clone) {
  for (int i = 0; i < (int)occ.size(); i++)
    if (occ[i] == clone) return i;
  return -1;
}

int leapsOf(const Occ& occ, const Step& s, LeapRec out[4]) {
  int a = s.spots[0], b = s.spots[1], c = s.spots[2], d = s.spots[3];
  switch (s.kind) {
    case SWAP:
      out[0] = {occ[a], a, b};
      out[1] = {occ[b], b, a};
      return 2;
    case HOP:
      out[0] = {occ[a], a, b};
      return 1;
    case ROTATE:
      out[0] = {occ[a], a, b};
      out[1] = {occ[b], b, c};
      out[2] = {occ[c], c, a};
      return 3;
    default:
      out[0] = {occ[a], a, b};
      out[1] = {occ[b], b, a};
      out[2] = {occ[c], c, d};
      out[3] = {occ[d], d, c};
      return 4;
  }
}

void applyStep(Occ& occ, const Step& s) {
  LeapRec L[4];
  int n = leapsOf(occ, s, L);
  for (int i = 0; i < n; i++) occ[L[i].from] = -1;
  for (int i = 0; i < n; i++) occ[L[i].to] = L[i].clone;
}

Occ initialOccupancy(Random& rng, int clones) {
  Occ occ(NSPOTS, -1);
  std::vector<int> chosen;
  for (int row = 0; row < 3; row++) {
    std::vector<int> ids;
    for (int i = 0; i < NSPOTS; i++)
      if (SPOTS[i].row == row) ids.push_back(i);
    chosen.push_back(rng.pick(ids));
  }
  std::vector<int> rest;
  for (int i = 0; i < NSPOTS; i++)
    if (std::find(chosen.begin(), chosen.end(), i) == chosen.end()) rest.push_back(i);
  rng.shuffle(rest);
  size_t k = 0;
  while ((int)chosen.size() < std::min(clones, NSPOTS) && k < rest.size()) chosen.push_back(rest[k++]);
  std::vector<int> ids;
  for (int i = 0; i < (int)chosen.size(); i++) ids.push_back(i);
  rng.shuffle(ids);
  for (size_t i = 0; i < chosen.size(); i++) occ[chosen[i]] = ids[i];
  return occ;
}

// A spot near `from` among `pool` (weighted towards the nearest), within `reach` if any is.
int nearPick(Random& rng, int from, const std::vector<int>& pool, float reach) {
  std::vector<int> opts;
  for (int id : pool)
    if (id != from) opts.push_back(id);
  if (opts.empty()) return -1;
  std::vector<int> list;
  for (int id : opts)
    if (spotDist(from, id) <= reach) list.push_back(id);
  if (list.empty()) {
    int best = opts[0];
    for (int id : opts)
      if (spotDist(from, id) < spotDist(from, best)) best = id;
    list.push_back(best);
  }
  std::vector<float> w;
  for (int id : list) w.push_back(1.0f / (60 + spotDist(from, id)));
  return list[rng.weighted(w)];
}

// The shuffle for a round: the real ninja is in a little over half of the moves, no move simply undoes
// the last, and from round 3 a few moves carry a trick (never the first, at most two a round).
std::vector<Step> planShuffle(Random& rng, const Plan& plan, Occ occ) {
  std::vector<Step> steps;
  const float weights[4] = {3, 1.4f, 1.2f, 1};
  int tricks = 0;
  std::vector<int> last;
  for (int i = 0; i < plan.moves; i++) {
    std::vector<int> taken, empty;
    for (int id = 0; id < NSPOTS; id++) (occ[id] >= 0 ? taken : empty).push_back(id);
    int real = spotOf(occ, 0);
    Step step;
    bool ok = false;
    for (int tries = 0; tries < 12 && !ok; tries++) {
      std::vector<int> kinds;
      std::vector<float> w;
      for (int k = 0; k < plan.nKinds; k++) {
        if ((k == HOP && empty.empty()) || (k == ROTATE && taken.size() < 3) || (k == DOUBLE && taken.size() < 4)) continue;
        kinds.push_back(k);
        w.push_back(weights[k]);
      }
      int kind = kinds[rng.weighted(w)];
      int a = rng.chance(0.56) ? real : rng.pick(taken);
      step = Step();
      step.kind = kind;
      if (kind == SWAP || kind == HOP) {
        int b = nearPick(rng, a, kind == SWAP ? taken : empty, plan.reach);
        if (b >= 0) {
          step.spots[0] = a;
          step.spots[1] = b;
          step.n = 2;
          ok = true;
        }
      } else if (kind == ROTATE) {
        int b = nearPick(rng, a, taken, plan.reach);
        std::vector<int> pool;
        for (int id : taken)
          if (id != a) pool.push_back(id);
        int c = b < 0 ? -1 : nearPick(rng, b, pool, plan.reach);
        if (b >= 0 && c >= 0) {
          step.spots[0] = a;
          step.spots[1] = b;
          step.spots[2] = c;
          step.n = 3;
          ok = true;
        }
      } else {
        int b = nearPick(rng, a, taken, plan.reach);
        std::vector<int> rest;
        for (int id : taken)
          if (id != a && id != b) rest.push_back(id);
        int c = rest.empty() ? -1 : rng.pick(rest);
        int d = c < 0 ? -1 : nearPick(rng, c, rest, plan.reach);
        if (b >= 0 && c >= 0 && d >= 0) {
          step.spots[0] = a;
          step.spots[1] = b;
          step.spots[2] = c;
          step.spots[3] = d;
          step.n = 4;
          ok = true;
        }
      }
      if (ok) {
        std::vector<int> sig(step.spots, step.spots + step.n);
        std::sort(sig.begin(), sig.end());
        if ((step.kind == SWAP || step.kind == DOUBLE) && sig == last) ok = false;
        else last = sig;
      }
    }
    if (!ok) {
      step = Step();
      step.spots[0] = taken[0];
      step.spots[1] = taken[1];
    }
    if (plan.nTricks > 0 && i > 0 && tricks < 2 && rng.chance(0.34)) {
      step.trick = 1 + rng.range(0, plan.nTricks - 1);
      tricks++;
      if (step.trick == DECOY) {
        std::vector<int> idle;
        for (int id : taken)
          if (std::find(step.spots, step.spots + step.n, id) == step.spots + step.n) idle.push_back(id);
        if (!idle.empty()) step.decoy = rng.pick(idle);
        else step.trick = NO_TRICK;
      }
    }
    steps.push_back(step);
    applyStep(occ, step);
  }
  return steps;
}

// A CPU watching one step follows the clone it believes is real, and may lose it to another clone in
// the same move (likelier in a fast round, under smoke or in the dark); a decoy may draw its eye.
int trackStep(int belief, const Occ& before, const Step& s, const Plan& plan, float mistake, Random& rng) {
  LeapRec L[4];
  int n = leapsOf(before, s, L);
  std::vector<int> involved;
  for (int i = 0; i < n; i++)
    if (L[i].clone >= 0) involved.push_back(L[i].clone);
  if (std::find(involved.begin(), involved.end(), belief) != involved.end()) {
    float speed = 760 / plan.moveMs;
    float trick = s.trick == SMOKE ? 1.7f : (s.trick == BLACKOUT ? 1.9f : 1);
    float kind = s.kind == ROTATE ? 1.35f : (s.kind == DOUBLE ? 1.3f : (s.kind == HOP ? 0.5f : 1));
    std::vector<int> others;
    for (int c : involved)
      if (c != belief) others.push_back(c);
    if (!others.empty() && rng.next() < mistake * 0.85f * speed * trick * kind) return others[(int)(rng.next() * others.size()) % others.size()];
    return belief;
  }
  if (s.trick == DECOY && s.decoy >= 0 && before[s.decoy] >= 0 && rng.next() < mistake * 0.6f) return before[s.decoy];
  return belief;
}

int speedTier(float ms) {
  int n = 0;
  for (float t : SPEED_STEPS)
    if (ms <= t) n++;
  return n;
}

int pickPoints(bool correct, float lockMs, bool dbl) {
  if (!correct) return 0;
  int speed = lockMs < 0 ? 0 : speedTier(lockMs);
  int pts = BASE_POINTS + std::min(SPEED_POINTS, speed);
  return dbl ? pts * 2 : pts;
}

// The clone a marker moves to from `from` when pushed in `dir` (staying put if there is none).
int navFrom(int from, int dir, const std::vector<int>& cand) {
  const Spot& p = SPOTS[from];
  int best = from;
  float bestScore = 1e9f;
  for (int id : cand) {
    if (id == from) continue;
    const Spot& q = SPOTS[id];
    float dx = q.x - p.x, dy = q.y - p.y;
    float along = dir == D_LEFT ? -dx : dir == D_RIGHT ? dx : dir == D_UP ? -dy : dy;
    float across = (dir == D_LEFT || dir == D_RIGHT) ? std::fabs(dy) : std::fabs(dx);
    if (along <= 20) continue;
    float score = along + across * 1.8f + (q.x + q.y) * 1e-4f;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// The first push on the shortest way from `from` to `target` through the clones (-1 once there).
int navToward(int from, int target, const std::vector<int>& cand) {
  if (from == target) return -1;
  int first[NSPOTS];
  bool seen[NSPOTS] = {};
  std::vector<int> queue{from};
  seen[from] = true;
  for (size_t qi = 0; qi < queue.size(); qi++) {
    int at = queue[qi];
    for (int dir = 0; dir < 4; dir++) {
      int to = navFrom(at, dir, cand);
      if (seen[to]) continue;
      seen[to] = true;
      first[to] = at == from ? dir : first[at];
      if (to == target) return first[to];
      queue.push_back(to);
    }
  }
  return -1;
}

float frameT(int c, const char* anim, int frame) { return (frame + 0.5f) * spr::animSeconds(c, anim) / std::max(1, spr::animLength(c, anim)); }

// Filled triangle pointing down (tip at x, y), built from a few bars.
void triDown(float x, float y, float halfW, float h, Color c) {
  const int n = 5;
  for (int k = 0; k < n; k++) {
    float w = 2 * halfW * (1 - (float)k / n);
    app.gfx.rect(x - w / 2, y - h + k * h / n, w, h / n + 0.5f, c);
  }
}

struct Leap {
  int from = 0, to = 0;
  float t = 0, dur = 1, h = 0;
  bool high = false;
};

struct Clone {
  int spot = -1;
  float x = -999, y = -999, scale = 0.6f;
  bool shown = false, leaping = false, flip = false;
  Leap lp;
  const char* anim = "idle";
  float animT = 0;
  int hold = -1;         // a held frame of `anim` (-1 = play it)
  float pop = 1;         // appear tween 0..1
  float drop = -1;       // the real one dropping in (ms), -1 when done
  float appearAt = -1;   // stage ms when it pops into existence
  float vanishAt = -1;   // stage ms when it vanishes in a puff
};

struct Picker {
  int spot = 0;
  bool locked = false;
  float lockMs = -1;  // -1: left to the timeout
  int belief = 0;
  float mx = 0, my = 0;
  int points = 0;
  float timer = 0;
  int n = 0;
  bool marker = false;
  float tagT = -1;  // LOCKED tag age (ms), -1 hidden
  int tier = 0;
  const char* anim = "idle";
  float animT = 0;
};

struct Puff {
  float x, y, x1, y1, s0, s1, ang, t, fade;
  bool on = false;
};

struct Smoke {
  float x0, x1, y, scale, ang, t, dur;
  bool on = false;
};

struct Word {
  std::string text;
  float x, y, t, hold, delay;
  int size;
  Color c;
};

struct Wave {
  float x, y, r0, r1, t, dur;
  Color c;
};

enum Stage { INTRO, REVEAL, CLONE, SHUFFLE, PICK, RESULT, DONE };

class CloneChaos : public Minigame {
 public:
  void start() override {
    ninja_ = 0;
    for (int i = 0; i < data::CHARACTER_COUNT; i++)
      if (!std::strcmp(data::CHARACTERS[i].id, "naruto")) ninja_ = i;
    start_ = startSpot();
    int n = count();
    score_.assign(n, 0);
    const float x4[4] = {300, 640, 1280, 1620}, x3[3] = {330, 660, 1590}, x2[2] = {620, 1300};
    for (int i = 0; i < n; i++) {
      Picker pk;
      pk.spot = start_;
      pickers_.push_back(pk);
      deckX_.push_back(n == 4 ? x4[i] : n == 3 ? x3[i] : n == 2 ? x2[i] : 620);
    }
    clones_.resize(9);
    puffs_.resize(26);
    smoke_.resize(7);
    startRound();
  }

  void update(float dt) override {
    float ms = dt * 1000;
    clock_ += ms;
    stageT_ += ms;
    timedEvents();
    switch (stage_) {
      case INTRO:
        if (stageT_ >= introMs_) {
          reveal();
          setStage(REVEAL);
        }
        break;
      case REVEAL:
        if (stageT_ >= REVEAL_MS) {
          cloneUp();
          setStage(CLONE);
        }
        break;
      case CLONE:
        if (stageT_ >= CLONE_MS + (plan_.clones - 1) * 60) startShuffle();
        break;
      case SHUFFLE:
        stepT_ += ms;
        updateLeaps();
        if (stepT_ >= stepDur_) {
          if (!stepApplied_) endStep();
          if (stepT_ >= stepDur_ + STEP_GAP) {
            stepIdx_++;
            if (stepIdx_ >= (int)steps_.size()) startPick();
            else beginStep();
          }
        }
        break;
      case PICK:
        updatePick(ms);
        break;
      case RESULT:
        if (stageT_ >= RESULT_MS) {
          clearRound();
          if (round_ >= ROUNDS) setStage(DONE);
          else startRound();
        }
        break;
      case DONE:
        break;
    }
    // the real one dropping in, clones popping up, deck and clone animations
    for (auto& cl : clones_) {
      cl.animT += dt;
      if (cl.pop < 1) cl.pop = std::min(1.0f, cl.pop + ms / 220);
      if (cl.drop >= 0) {
        cl.drop += ms;
        if (cl.drop >= 360) {
          cl.drop = -1;
          setAnim(cl, "wave");
          const Spot& s = SPOTS[cl.spot];
          puffAt(s.x, s.y - 10, 0.5f * s.scale, 0);
        }
      }
    }
    for (auto& pk : pickers_) {
      pk.animT += dt;
      if (pk.tagT >= 0) pk.tagT += ms;
    }
    // markers glide between clones
    float k = 1 - std::exp(-ms / 55);
    for (auto& pk : pickers_) {
      pk.mx += (SPOTS[pk.spot].x - pk.mx) * k;
      pk.my += (SPOTS[pk.spot].y - pk.my) * k;
    }
    for (auto& p : puffs_)
      if (p.on && (p.t += ms) >= p.fade + 300) p.on = false;
    for (auto& s : smoke_)
      if (s.on && (s.t += ms) >= s.dur) s.on = false;
    if (darkT_ >= 0 && (darkT_ += ms) > darkDur_ + 40) darkT_ = -1;
    for (auto& w : words_) {
      if (w.delay > 0) w.delay -= ms;
      else w.t += ms;
    }
    std::erase_if(words_, [](const Word& w) { return w.delay <= 0 && w.t > w.hold + 250; });
    for (auto& w : waves_) w.t += ms;
    std::erase_if(waves_, [](const Wave& w) { return w.t >= w.dur; });
    if (stage_ == DONE) doneT_ += ms;
  }

  // --- Round flow ---------------------------------------------------------------------------------
  void setStage(Stage s) {
    stage_ = s;
    stageT_ = 0;
  }

  void startRound() {
    round_++;
    plan_ = TABLE[round_ - 1];
    dbl_ = round_ == ROUNDS;
    occ_ = initialOccupancy(rng, plan_.clones);
    steps_ = planShuffle(rng, plan_, occ_);
    stepIdx_ = 0;
    for (auto& pk : pickers_) {
      pk.locked = false;
      pk.lockMs = -1;
      pk.belief = 0;
      pk.marker = false;
      pk.tagT = -1;
      setAnim(pk, "idle");
    }
    float wait = round_ == 1 ? 620 : 0;
    introMs_ = INTRO_MS + wait;
    banner(dbl_ ? "FINAL ROUND" : "ROUND " + std::to_string(round_), dbl_ ? "DOUBLE POINTS!" : (round_ == 1 ? "FIND THE REAL ONE!" : ""), 520, 1400, wait);
    setStage(INTRO);
  }

  // The real ninja drops onto his roof, pointed out by a golden arrow.
  void reveal() {
    int spot = spotOf(occ_, 0);
    Clone& cl = clones_[0];
    placeClone(cl, spot);
    cl.shown = true;
    cl.pop = 1;
    cl.drop = 0;
    cl.flip = false;
    setAnim(cl, "jump", 2);
    realMark_ = true;
    const Spot& s = SPOTS[spot];
    word("THE REAL ONE!", s.x * S, (s.y - 260 * s.scale) * S - 30, 22, Color::hex(0xffcf3a), 750);
    app.audio.sfx("dash", 0.5f);
  }

  // Smoke puffs: the clones pop into existence on the other roofs, nearest first.
  void cloneUp() {
    realMark_ = false;
    setAnim(clones_[0], "cheer");
    int real = spotOf(occ_, 0);
    std::vector<int> order;
    for (int spot = 0; spot < NSPOTS; spot++)
      if (occ_[spot] > 0) order.push_back(spot);
    std::sort(order.begin(), order.end(), [&](int a, int b) { return spotDist(real, a) < spotDist(real, b); });
    for (size_t i = 0; i < order.size(); i++) {
      Clone& cl = clones_[occ_[order[i]]];
      cl.spot = order[i];
      cl.appearAt = 90 + i * 60;
    }
  }

  void startShuffle() {
    for (auto& cl : clones_)
      if (cl.shown) setAnim(cl, "idle");
    stepIdx_ = 0;
    beginStep();
    setStage(SHUFFLE);
  }

  void beginStep() {
    const Step& s = steps_[stepIdx_];
    for (int i = 0; i < count(); i++)
      if (isCpu(i)) pickers_[i].belief = trackStep(pickers_[i].belief, occ_, s, plan_, SKILL[cpuLevel(i)].mistake, rng);
    LeapRec L[4];
    int n = leapsOf(occ_, s, L);
    stepDur_ = plan_.moveMs + (s.trick ? TRICK_EXTRA : 0);
    stepT_ = 0;
    stepApplied_ = false;
    for (int i = 0; i < n; i++) {
      if (L[i].clone < 0) continue;
      Clone& cl = clones_[L[i].clone];
      float d = spotDist(L[i].from, L[i].to);
      // paths never coincide: in a swap one clone vaults high while the other scurries low
      bool high = i % 2 == 0;
      float cap = std::min(SPOTS[L[i].from].y, SPOTS[L[i].to].y) - APEX_MIN_Y;
      cl.leaping = true;
      cl.lp = Leap{L[i].from, L[i].to, 0, stepDur_, std::min(cap, high ? 95 + d * 0.32f : 26 + d * 0.08f), high};
      cl.flip = SPOTS[L[i].to].x < SPOTS[L[i].from].x;
    }
    app.audio.sfx("dash", 0.35f);
    if (s.trick == SMOKE) smokeScreen(s);
    else if (s.trick == BLACKOUT) {
      darkT_ = 0;
      darkDur_ = stepDur_;
      word("LIGHTS OUT!", VW / 2, CALL_Y * S - 14, 30, Color::hex(0x9fb2ff), 500);
    } else if (s.trick == DECOY && s.decoy >= 0) {
      // a clone that isn't moving hams it up: a wave and a flash to draw the eye (it may be him)
      Clone& cl = clones_[occ_[s.decoy]];
      setAnim(cl, "wave");
      const Spot& sp = SPOTS[s.decoy];
      wave(sp.x * S, (sp.y - 70 * sp.scale) * S, 4, 90 * sp.scale * S, 320, Color::hex(0xffe27a));
    }
  }

  void endStep() {
    stepApplied_ = true;
    applyStep(occ_, steps_[stepIdx_]);
    for (int id = 0; id < (int)clones_.size(); id++) {
      Clone& cl = clones_[id];
      if (!cl.leaping) continue;
      cl.leaping = false;
      placeClone(cl, spotOf(occ_, id));
    }
    // everyone back in step, so no clone gives itself away by being out of time
    for (auto& cl : clones_)
      if (cl.shown) setAnim(cl, "idle");
  }

  void startPick() {
    setStage(PICK);
    std::vector<int> taken = takenSpots();
    int start = taken[0];
    for (int id : taken)
      if (spotDist(id, start_) < spotDist(start, start_)) start = id;
    for (int i = 0; i < count(); i++) {
      Picker& pk = pickers_[i];
      pk.spot = start;
      pk.locked = false;
      pk.lockMs = -1;
      pk.mx = SPOTS[start].x;
      pk.my = SPOTS[start].y;
      // only a human sees their own marker while choosing: nobody can copy a CPU's pick
      pk.marker = !isCpu(i);
      pk.tagT = -1;
      if (isCpu(i)) {
        pk.timer = SKILL[cpuLevel(i)].reaction * (1.8f + (float)rng.next());
        pk.n = 0;
      }
    }
    banner("PICK THE REAL ONE!", "", CALL_Y, 1000, 0);
  }

  void lockIn(int i, bool timeout) {
    Picker& pk = pickers_[i];
    if (pk.locked) return;
    pk.locked = true;
    pk.lockMs = timeout ? -1 : stageT_;
    if (timeout) return;
    // the choice stays hidden until the reveal: the marker slips away, LOCKED shows on the deck
    if (pk.marker) {
      const Spot& s = SPOTS[pk.spot];
      wave(pk.mx * S, s.y * S, 4, 70 * s.scale * S, 300, color(i));
    }
    pk.marker = false;
    pk.tier = speedTier(stageT_);
    pk.tagT = 0;
    app.audio.sfx("dash", 0.4f);
  }

  void updatePick(float ms) {
    float left = plan_.pickMs - stageT_;
    std::vector<int> taken = takenSpots();
    for (int i = 0; i < count(); i++) {
      Picker& pk = pickers_[i];
      if (pk.locked) continue;
      if (isCpu(i)) {
        cpuPick(i, ms, taken);
        continue;
      }
      const Pad& p = pad(i);
      int dir = p.press(B_LEFT) ? D_LEFT : p.press(B_RIGHT) ? D_RIGHT : p.press(B_UP) ? D_UP : p.press(B_DOWN) ? D_DOWN : -1;
      if (dir >= 0) pk.spot = navFrom(pk.spot, dir, taken);
      if (p.press(B_A)) lockIn(i, false);
    }
    bool all = true;
    for (auto& pk : pickers_) all = all && pk.locked;
    if (left <= 0 || all) resolveRound();
  }

  // A CPU walks its marker to the clone it believes is real, a push at a time, then locks in.
  void cpuPick(int i, float ms, const std::vector<int>& taken) {
    Picker& pk = pickers_[i];
    pk.timer -= ms;
    if (pk.timer > 0) return;
    const Skill& sk = SKILL[cpuLevel(i)];
    int target = spotOf(occ_, pk.belief);
    int dir = target >= 0 ? navToward(pk.spot, target, taken) : -1;
    if (dir >= 0 && pk.n < 10) {
      pk.spot = navFrom(pk.spot, dir, taken);
      pk.n++;
      pk.timer = sk.think * 0.55f * (0.8f + 0.5f * (float)rng.next());
    } else {
      lockIn(i, false);
      pk.timer = 1e9f;
    }
  }

  void resolveRound() {
    setStage(RESULT);
    for (int i = 0; i < count(); i++)
      if (!pickers_[i].locked) lockIn(i, true);
    words_.clear();
    // everyone's pick comes out together
    for (auto& pk : pickers_) {
      pk.mx = SPOTS[pk.spot].x;
      pk.my = SPOTS[pk.spot].y;
      pk.marker = true;
      pk.tagT = -1;
    }
    // the smoke clears: every clone vanishes in a ripple of puffs (farthest first), leaving the real one
    int real = spotOf(occ_, 0);
    std::vector<int> fakes;
    for (int id = 1; id < (int)clones_.size(); id++)
      if (clones_[id].shown) fakes.push_back(id);
    std::sort(fakes.begin(), fakes.end(), [&](int a, int b) { return spotDist(real, clones_[a].spot) > spotDist(real, clones_[b].spot); });
    for (size_t i = 0; i < fakes.size(); i++) clones_[fakes[i]].vanishAt = i * 75.0f;
    realAt_ = fakes.size() * 75.0f + 120;
  }

  void showReal() {
    int real = spotOf(occ_, 0);
    const Spot& s = SPOTS[real];
    Clone& cl = clones_[0];
    setAnim(cl, "victory");
    realMark_ = true;
    wave(s.x * S, (s.y - 60 * s.scale) * S, 6, 180 * s.scale * S, 420, Color::hex(0xffe27a));
    int found = 0;
    for (int i = 0; i < count(); i++) {
      Picker& pk = pickers_[i];
      bool correct = pk.spot == real;
      int pts = pickPoints(correct, pk.lockMs, dbl_);
      pk.points = pts;
      if (correct) {
        found++;
        score_[i] += pts;
        float x = (pk.mx + markerOffset(i) * 1.9f) * S;
        float y = (s.y - 250 * s.scale) * S - 30 - (found % 2) * 20;
        Word w{"+" + std::to_string(pts), x, y, 0, 900, (found - 1) * 110.0f, 30, col::white};
        words_.push_back(w);
        setAnim(pk, "celebrate");
        app.audio.sfx("coin");
      } else {
        word("MISS", (pk.mx + markerOffset(i)) * S, (SPOTS[pk.spot].y - 200 * SPOTS[pk.spot].scale) * S, 18, Color::hex(0xc8d0de), 600);
        setAnim(pk, "disappointed");
      }
    }
    int n = count();
    std::string line = found == 0 ? "NOBODY FOUND HIM!" : (found == n ? "EVERYONE FOUND HIM!" : std::to_string(found) + " FOUND HIM!");
    banner(line, "", CALL_Y, 1100, 260, found ? Color::hex(0xffe08a) : Color::hex(0xdfe5ee));
    if (!found) app.audio.sfx("bad", 0.5f);
  }

  void clearRound() {
    Clone& real = clones_[0];
    if (real.shown && real.spot >= 0) puffAt(SPOTS[real.spot].x, SPOTS[real.spot].y - 50 * SPOTS[real.spot].scale, 0.9f * SPOTS[real.spot].scale, 0);
    for (auto& cl : clones_) {
      cl.shown = false;
      cl.leaping = false;
      cl.appearAt = cl.vanishAt = -1;
      cl.drop = -1;
    }
    realMark_ = false;
    realAt_ = -1;
    for (auto& pk : pickers_) {
      pk.marker = false;
      pk.tagT = -1;
    }
  }

  // Delayed beats: clones popping up or vanishing, and the real one shown at the end of a round.
  void timedEvents() {
    for (int id = 0; id < (int)clones_.size(); id++) {
      Clone& cl = clones_[id];
      if (cl.appearAt >= 0 && stageT_ >= cl.appearAt && stage_ == CLONE) {
        cl.appearAt = -1;
        placeClone(cl, cl.spot);
        cl.shown = true;
        cl.pop = 0;
        cl.flip = false;
        setAnim(cl, "idle");
        const Spot& s = SPOTS[cl.spot];
        puffAt(s.x, s.y - 50 * s.scale, 0.9f * s.scale, 1);
        app.audio.sfx("bump", 0.4f);
      }
      if (cl.vanishAt >= 0 && stageT_ >= cl.vanishAt && stage_ == RESULT) {
        cl.vanishAt = -1;
        const Spot& s = SPOTS[cl.spot];
        puffAt(s.x, s.y - 50 * s.scale, 0.95f * s.scale, 2);
        cl.shown = false;
      }
    }
    if (realAt_ >= 0 && stage_ == RESULT && stageT_ >= realAt_) {
      realAt_ = -1;
      showReal();
    }
  }

  void updateLeaps() {
    for (auto& cl : clones_) {
      if (!cl.leaping) continue;
      Leap& lp = cl.lp;
      lp.t = std::min(lp.dur, stepT_);
      float u = lp.t / lp.dur;
      float e = u < 0.5f ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
      const Spot& a = SPOTS[lp.from];
      const Spot& b = SPOTS[lp.to];
      cl.x = a.x + (b.x - a.x) * e;
      cl.y = a.y + (b.y - a.y) * e - lp.h * 4 * u * (1 - u);
      cl.scale = a.scale + (b.scale - a.scale) * e;
      cl.anim = "jump";
      cl.hold = u < 0.14f ? 0 : u < 0.5f ? 1 : u < 0.86f ? 2 : 3;
    }
  }

  std::vector<int> takenSpots() const {
    std::vector<int> t;
    for (int id = 0; id < NSPOTS; id++)
      if (occ_[id] >= 0) t.push_back(id);
    return t;
  }

  // Markers sharing a clone stand side by side.
  float markerOffset(int i) const {
    int n = 0, k = 0;
    for (int j = 0; j < count(); j++) {
      if (pickers_[j].spot != pickers_[i].spot || !pickers_[j].marker) continue;
      if (j == i) k = n;
      n++;
    }
    return n < 2 ? 0 : (k - (n - 1) / 2.0f) * 46;
  }

  void placeClone(Clone& cl, int spot) {
    cl.spot = spot;
    cl.x = SPOTS[spot].x;
    cl.y = SPOTS[spot].y;
    cl.scale = SPOTS[spot].scale;
  }

  static void setAnim(Clone& cl, const char* a, int hold = -1) {
    cl.anim = a;
    cl.hold = hold;
    cl.animT = 0;
  }
  static void setAnim(Picker& pk, const char* a) {
    pk.anim = a;
    pk.animT = 0;
  }

  // --- Effects --------------------------------------------------------------------------------------
  // Smoke rolls across the rows the move crosses (you can still make out shapes through it).
  void smokeScreen(const Step& s) {
    float top = 1e9f, bottom = -1e9f;
    for (int k = 0; k < s.n; k++) {
      top = std::min(top, SPOTS[s.spots[k]].y - 150);
      bottom = std::max(bottom, SPOTS[s.spots[k]].y + 20);
    }
    bool fromLeft = rng.chance(0.5);
    int n = (int)smoke_.size();
    for (int i = 0; i < n; i++) {
      Smoke& m = smoke_[i];
      m.on = true;
      m.y = top + ((i + 0.5f) / n) * (bottom - top);
      m.x0 = fromLeft ? -200.0f - i * 60 : 2120.0f + i * 60;
      m.x1 = fromLeft ? 1190.0f + i * 70 : 730.0f - i * 70;
      m.scale = 1.6f + (i % 3) * 0.35f;
      m.ang = i * 40.0f;
      m.t = 0;
      m.dur = stepDur_ + 380;
    }
    word("SMOKE SCREEN!", VW / 2, CALL_Y * S - 14, 30, col::white, 500);
  }

  // A cartoon puff of smoke: kind 0 small, 1 a clone appearing, 2 a clone vanishing.
  void puffAt(float x, float y, float scale, int kind) {
    int n = kind == 0 ? 2 : 4;
    for (int i = 0; i < n; i++) {
      Puff* p = nullptr;
      for (auto& q : puffs_)
        if (!q.on) {
          p = &q;
          break;
        }
      if (!p) return;
      float a = (float)i / n * PI * 2 + (float)rng.next();
      float r = 26 * scale;
      p->on = true;
      p->x = x + std::cos(a) * r;
      p->y = y + std::sin(a) * r * 0.6f;
      p->x1 = p->x + std::cos(a) * r * 1.5f;
      p->y1 = p->y + std::sin(a) * r - 16;
      p->s0 = scale * 0.35f;
      p->s1 = scale * (0.95f + 0.3f * (float)rng.next());
      p->ang = (float)rng.next() * 360;
      p->t = 0;
      p->fade = 180 + (kind == 2 ? 120 : 0);
    }
  }

  void word(const std::string& text, float x, float y, int size, Color c, float hold) { words_.push_back(Word{text, x, y, 0, hold, 0, size, c}); }

  void banner(const std::string& text, const std::string& sub, float yWeb, float hold, float delay, Color c = Color::hex(0xffe08a)) {
    words_.push_back(Word{text, VW / 2, yWeb * S - 26, 0, hold, delay, 44, c});
    if (!sub.empty()) words_.push_back(Word{sub, VW / 2, yWeb * S + 22, 0, hold, delay, 22, col::white});
  }

  void wave(float x, float y, float r0, float r1, float dur, Color c) { waves_.push_back(Wave{x, y, r0, r1, 0, dur, c}); }

  // --- Drawing ----------------------------------------------------------------------------------------
  void draw() override {
    drawArena();
    // rings under the picked clones
    if (stage_ == PICK || stage_ == RESULT)
      for (int i = 0; i < count(); i++) {
        const Picker& pk = pickers_[i];
        if (!pk.marker) continue;
        float sc = SPOTS[pk.spot].scale, off = markerOffset(i);
        float rx = (64 + std::fabs(off) * 0.2f) * sc * 0.8f * S;
        app.gfx.ellipse((pk.mx + off * 0.3f) * S, (pk.my + 4) * S, rx + 2, rx * 0.34f + 1.5f, col::white.alpha(0.6f));
        app.gfx.ellipse((pk.mx + off * 0.3f) * S, (pk.my + 4) * S, rx, rx * 0.34f, color(i).alpha(pk.locked ? 0.95f : 0.75f));
      }
    // clones: standing ones back to front, leaping ones over them (high vaulters on top)
    std::vector<int> order;
    for (int id = 0; id < (int)clones_.size(); id++)
      if (clones_[id].shown) order.push_back(id);
    auto depth = [&](int id) {
      const Clone& c = clones_[id];
      return c.leaping ? 3000 + (c.lp.high ? 2 : 1) + c.y * 0.001f : c.y;
    };
    std::sort(order.begin(), order.end(), [&](int a, int b) { return depth(a) < depth(b); });
    for (int id : order) {
      const Clone& cl = clones_[id];
      float y = cl.y;
      if (cl.drop >= 0) {
        float u = cl.drop / 360;
        y = cl.y - 420 * (1 - u * u);
      }
      float sc = cl.scale * CHAR_K * (cl.pop < 1 ? 0.3f + 0.7f * easeBack(cl.pop) : 1);
      if (!cl.leaping && cl.drop < 0) spr::shadow(cl.x * S, cl.y * S, 60 * sc, 0.3f);
      float t = cl.hold >= 0 ? frameT(ninja_, cl.anim, cl.hold) : (std::strcmp(cl.anim, "idle") ? cl.animT : clock_ / 1000);
      spr::character(ninja_, cl.anim, t, cl.x * S, y * S, sc, cl.flip);
    }
    // smoke screen and lights out
    Tex* puff = app.gfx.tex("mg/dojo_puff.png");
    SDL_Rect src{0, 0, puff->w, puff->h};
    for (auto& m : smoke_) {
      if (!m.on) continue;
      float u = m.t / m.dur;
      float e = u < 0.5f ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
      float a = u < 0.3f ? u / 0.3f : (u > 0.7f ? (1 - u) / 0.3f : 1);
      app.gfx.sprite(puff, src, lerpf(m.x0, m.x1, e) * S, m.y * S, m.scale, m.scale, 0.5f, 0.5f, m.ang + 40 * e, false, Color(255, 255, 255, (unsigned char)(150 * a)));
    }
    if (darkT_ >= 0) {
      float a = darkT_ < 120 ? darkT_ / 120 : (darkT_ > darkDur_ - 80 ? std::max(0.0f, (darkDur_ + 40 - darkT_) / 120) : 1);
      app.gfx.rect(0, 0, VW, VH, Color(11, 16, 48, (unsigned char)(148 * a)));
    }
    if (stage_ == PICK) {
      float left = std::max(0.0f, 1 - stageT_ / plan_.pickMs);
      app.gfx.rect(0, 90, VW, 300, Color(255, 255, 255, (unsigned char)(20 * left)));
    }
    // markers: an arrow in the player's colour with their tag, over the clone they're on
    if (stage_ == PICK || stage_ == RESULT)
      for (int i = 0; i < count(); i++) {
        const Picker& pk = pickers_[i];
        if (!pk.marker) continue;
        float sc = SPOTS[pk.spot].scale * CHAR_K;
        float bob = (pk.locked || stage_ != PICK) ? 0 : std::sin(clock_ / 150 + i) * 3;
        float x = (pk.mx + markerOffset(i)) * S, tip = pk.my * S - 68 * sc + bob;
        Color c = color(i);
        triDown(x, tip + 1, 9, 13, Color(10, 17, 32, 90));
        triDown(x, tip, 8, 12, pk.locked ? col::white : c);
        if (pk.locked) triDown(x, tip - 3, 4.5f, 7, c);
        drawPlayerTag(i, x, tip - 22);
      }
    if (realMark_ && clones_[0].shown && clones_[0].spot >= 0) {
      const Clone& cl = clones_[0];
      float sc = cl.scale * CHAR_K;
      float y = cl.drop >= 0 ? cl.y : cl.y;
      float tip = y * S - 70 * sc - 4 - std::fabs(std::sin(clock_ / 160)) * 6;
      triDown(cl.x * S, tip + 2, 12, 16, Color(122, 70, 0, 110));
      triDown(cl.x * S, tip, 11, 15, Color::hex(0xffd23f));
    }
    for (auto& p : puffs_) {
      if (!p.on) continue;
      float u = std::min(1.0f, p.t / 300);
      float e = 1 - (1 - u) * (1 - u) * (1 - u);
      float a = p.t < p.fade ? 0.95f : 0.95f * std::max(0.0f, 1 - (p.t - p.fade) / 300);
      float sc = lerpf(p.s0, p.s1, e);
      app.gfx.sprite(puff, src, lerpf(p.x, p.x1, e) * S, lerpf(p.y, p.y1, e) * S, sc, sc, 0.5f, 0.5f, p.ang + 30 * e, false, col::white.alpha(a));
    }
    for (auto& w : waves_) {
      float u = w.t / w.dur;
      app.gfx.ring(w.x, w.y, lerpf(w.r0, w.r1, easeOut(u)), w.c.alpha(1 - u));
    }
    // the watchers on the deck
    for (int i = 0; i < count(); i++) {
      const Picker& pk = pickers_[i];
      float x = deckX_[i] * S, y = DECK_FEET * S;
      spr::shadow(x, y, 46, 0.3f);
      spr::character(player(i).character, pk.anim, pk.animT, x, y, DECK_SCALE, deckX_[i] > 960);
      if (pk.tagT >= 0) {
        float k = std::min(1.0f, pk.tagT / 160);
        float w = 74 * (0.5f + 0.5f * k), ty = y - 66;
        app.gfx.panel(x - w / 2, ty - 12, w, 24, Color(18, 27, 43, 230), 11);
        app.gfx.text("LOCKED", x - 8, ty - 9, 13, col::white, CENTER, false);
        for (int p = 0; p < 3; p++) app.gfx.circle(x + 22 + p * 7 - 7, ty, 2.5f, p < pk.tier ? Color::hex(0xffe08a) : Color(255, 255, 255, 60));
        app.gfx.rect(x - w / 2, ty + 11, w, 2, color(i));
      } else {
        drawPlayerTag(i, x, y - 58);
      }
    }
    for (auto& w : words_) {
      if (w.delay > 0) continue;
      float pop = std::min(1.0f, w.t / 160);
      float a = w.t > w.hold ? std::max(0.0f, 1 - (w.t - w.hold) / 250) : 1;
      app.gfx.text(w.text, w.x, w.y - w.t * 0.012f, w.size, w.c.alpha(a), CENTER, true, 0.6f + 0.4f * easeBack(pop));
    }
    // HUD: the round plaque (pips per round), the pick timer and the scores
    app.gfx.panel(10, 8, 168, 40, Color(18, 27, 43, 215), 18);
    app.gfx.text("ROUND " + std::to_string(std::max(1, round_)) + "/5", 20, 17, 18, col::white, LEFT, false);
    for (int r = 0; r < ROUNDS; r++) {
      bool cur = r == round_ - 1, done = r < round_ - 1;
      app.gfx.circle(124 + r * 10, 28, cur ? 4 : 3, cur ? Color::hex(0xffe08a) : (done ? col::white : Color(255, 255, 255, 50)));
    }
    if (stage_ == PICK) {
      float left = std::max(0.0f, plan_.pickMs - stageT_);
      drawTimer(left / 1000);
      float f = left / plan_.pickMs;
      app.gfx.rect(VW / 2 - 60, 52, 120, 5, Color(0, 0, 0, 90));
      app.gfx.rect(VW / 2 - 60, 52, 120 * f, 5, f < 0.34f ? col::coral : Color::hex(0xffe08a));
    }
    drawScores(score_, "pts");
  }

  bool finished() const override { return stage_ == DONE && doneT_ >= 250; }
  std::vector<int> scores() const override { return score_; }
  std::string scoreLabel(int i) const override { return std::to_string(score_[i]) + (score_[i] == 1 ? " point" : " points"); }

 private:
  Stage stage_ = INTRO;
  float stageT_ = 0, clock_ = 0, doneT_ = 0;
  int round_ = 0;
  Plan plan_ = TABLE[0];
  bool dbl_ = false;
  Occ occ_;
  std::vector<Step> steps_;
  int stepIdx_ = 0;
  float stepT_ = 0, stepDur_ = 1;
  bool stepApplied_ = true;
  float introMs_ = INTRO_MS;
  std::vector<Clone> clones_;
  std::vector<Picker> pickers_;
  std::vector<float> deckX_;
  std::vector<int> score_;
  std::vector<Puff> puffs_;
  std::vector<Smoke> smoke_;
  std::vector<Word> words_;
  std::vector<Wave> waves_;
  float darkT_ = -1, darkDur_ = 0;
  float realAt_ = -1;
  bool realMark_ = false;
  int ninja_ = 0, start_ = 0;
};

}  // namespace

REGISTER_MINIGAME("clone-chaos", CloneChaos);

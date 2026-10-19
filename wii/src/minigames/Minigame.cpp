#include "Minigame.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "../game/Sprites.h"
#include "../game/Ui.h"

static std::map<std::string, MinigameFactory>& registry() {
  static std::map<std::string, MinigameFactory> r;
  return r;
}

MinigameRegistrar::MinigameRegistrar(const char* id, MinigameFactory f) { registry()[id] = f; }

std::unique_ptr<Minigame> createMinigame(const char* id) {
  auto it = registry().find(id);
  return it == registry().end() ? nullptr : it->second();
}

bool hasMinigame(const char* id) { return registry().count(id) > 0; }

int minigameIndex(const char* id) {
  for (int i = 0; i < data::MINIGAME_COUNT; i++)
    if (!strcmp(data::MINIGAMES[i].id, id)) return i;
  return -1;
}

static const Pad kNoPad{};
const Pad& Minigame::pad(int i) const { return players_[i].cpu ? kNoPad : app.input.pad[players_[i].slot]; }

void Minigame::drawArena() const {
  if (def_ && def_->arena[0]) app.gfx.image(app.gfx.tex(def_->arena), 0, 0, VW, VH);
  else app.gfx.image(app.gfx.tex("ui/sky.png"), 0, 0, VW, VH);
}

void Minigame::drawTimer(float left) const {
  int s = (int)std::ceil(left < 0 ? 0 : left);
  ui::card(VW / 2 - 40, 12, 80, 40, s <= 5 ? col::coral : col::cream, 20);
  app.gfx.text(std::to_string(s), VW / 2, 16, 30, s <= 5 ? col::white : col::ink, CENTER, false);
}

void Minigame::drawScores(const std::vector<int>& sc, const char* unit) const {
  int n = count();
  float w = 150, gap = 10, total = n * w + (n - 1) * gap;
  float x0 = VW / 2 - total / 2;
  for (int i = 0; i < n; i++) {
    float x = x0 + i * (w + gap), y = VH - 52;
    ui::card(x, y, w, 38, col::cream.alpha(0.95f), 19);
    app.gfx.circle(x + 19, y + 19, 17, color(i));
    spr::portrait(player(i).character, x + 19, y + 19, 32);
    std::string label = std::to_string(i < (int)sc.size() ? sc[i] : 0) + (unit[0] ? std::string(" ") + unit : "");
    app.gfx.text(label, x + 44, y + 8, 20, col::ink, LEFT, false);
  }
}

void Minigame::drawPlayerTag(int i, float x, float y) const {
  Color c = color(i);
  app.gfx.panel(x - 15, y - 11, 30, 20, c, 10);
  app.gfx.text(isCpu(i) ? "CPU" : ("P" + std::to_string(player(i).slot + 1)), x, y - 9, isCpu(i) ? 12 : 15, col::white, CENTER, false);
}

// ---------------------------------------------------------------------------------------------

namespace {
constexpr float PRACTICE_INTRO = 1.2f;   // "PRACTICE" splash before the practice game runs
constexpr float PRACTICE_LIMIT = 25.0f;  // seconds of practice play
constexpr float PRACTICE_OUTRO = 1.2f;   // "FINISH!" hold when the practice game ends by itself

Color teamColor(int t) { return t == 0 ? Color::hex(0x3b7cf0) : Color::hex(0xe5484d); }
const char* teamName(int t) { return t == 0 ? "BLUE" : "RED"; }
}  // namespace

void MinigameHost::begin(const char* id, const std::vector<MgPlayer>& players, uint32_t seed, std::vector<int> teams) {
  id_ = id;
  players_ = players;
  seed_ = seed;
  int idx = minigameIndex(id);
  def_ = idx >= 0 ? &data::MINIGAMES[idx] : nullptr;
  // teams: one entry (0 or 1) per player and both sides filled, or it's a free-for-all
  teams_ = std::move(teams);
  bool ok = teams_.size() == players.size() && players.size() >= 2;
  for (int t : teams_) ok = ok && (t == 0 || t == 1);
  if (!ok || teamSize(0) == 0 || teamSize(1) == 0) teams_.clear();
  winTeam_ = -1;
  teamScore_[0] = teamScore_[1] = 0;
  practiceEnd_ = -1;
  // free the previous minigame's arena and props (texture memory is tight on the Wii)
  game_.reset();
  app.gfx.drop("mg/");
  game_ = createMinigame(id);
  logf("minigame %s at %.1f s%s", id, app.time, teams_.empty() ? "" : " (teams)");
  if (!game_) {
    // unknown minigame: everyone ties
    places_.assign(players.size(), 1);
    phase_ = DONE;
    return;
  }
  game_->setup(players_, seed_, def_);
  ready_.assign(players_.size(), false);
  for (size_t i = 0; i < players_.size(); i++) ready_[i] = players_[i].cpu;
  phase_ = CARD;
  t_ = 0;
  app.audio.music("minigame");
}

bool MinigameHost::anyHuman() const {
  for (const auto& p : players_)
    if (!p.cpu) return true;
  return false;
}

int MinigameHost::teamSize(int team) const {
  int n = 0;
  for (int t : teams_) n += t == team;
  return n;
}

int MinigameHost::soloTeam() const {
  if (teams_.empty()) return -1;
  int a = teamSize(0), b = teamSize(1);
  if (a == 1 && b > 1) return 0;
  if (b == 1 && a > 1) return 1;
  return -1;
}

void MinigameHost::freshGame() {
  // destroying the old instance frees whatever it owns; the shared "mg/" textures stay cached
  game_.reset();
  game_ = createMinigame(id_.c_str());
  if (game_) game_->setup(players_, seed_, def_);
}

void MinigameHost::startPractice() {
  // one instance at a time: the practice run gets its own seed, the real run is rebuilt afterwards
  game_.reset();
  game_ = createMinigame(id_.c_str());
  if (!game_) {
    freshGame();
    return;
  }
  game_->setup(players_, seed_ * 2654435761u + 0x9e3779b9u, def_);
  phase_ = PRACTICE;
  t_ = 0;
  practiceEnd_ = -1;
  app.audio.sfx("confirm");
}

void MinigameHost::endPractice() {
  freshGame();  // same seed as before practice: the real run is unaffected
  for (size_t i = 0; i < players_.size(); i++) ready_[i] = players_[i].cpu;
  phase_ = CARD;
  t_ = 0;
  practiceEnd_ = -1;
  app.audio.sfx("back");
}

void MinigameHost::computePlaces() {
  auto sc = game_->scores();
  int n = (int)players_.size();
  sc.resize(n, 0);
  places_.assign(n, 1);
  if (teams_.empty()) {
    // places from scores (ties share)
    for (int i = 0; i < n; i++) {
      int better = 0;
      for (int j = 0; j < n; j++)
        if (sc[j] > sc[i]) better++;
      places_[i] = better + 1;
    }
    winTeam_ = -1;
    return;
  }
  long long sum[2] = {0, 0};
  int size[2] = {teamSize(0), teamSize(1)};
  for (int i = 0; i < n; i++) sum[teams_[i]] += sc[i];
  // equal teams compare sums; 1-vs-3 compares the solo score with the trio's average
  bool avg = size[0] != size[1];
  for (int t = 0; t < 2; t++) teamScore_[t] = avg ? (float)sum[t] / (float)size[t] : (float)sum[t];
  winTeam_ = teamScore_[0] > teamScore_[1] ? 0 : (teamScore_[1] > teamScore_[0] ? 1 : -1);
  for (int i = 0; i < n; i++) places_[i] = (winTeam_ >= 0 && teams_[i] == winTeam_) ? 1 : 2;
}

void MinigameHost::update(float dt) {
  t_ += dt;
  switch (phase_) {
    case CARD: {
      bool canPractice = anyHuman();
      bool all = true;
      for (size_t i = 0; i < players_.size(); i++) {
        if (players_[i].cpu) continue;
        const Pad& p = app.input.pad[players_[i].slot];
        if (canPractice && p.press(B_B)) {
          startPractice();
          return;
        }
        if (p.press(B_A)) {
          if (!ready_[i]) app.audio.sfx("confirm");
          ready_[i] = true;
        }
      }
      for (size_t i = 0; i < players_.size(); i++) all = all && ready_[i];
      // all-CPU games (demo) wait a moment so the card can be read
      if (all && t_ > 2.5f) {
        phase_ = COUNTDOWN;
        t_ = 0;
      }
      break;
    }
    case PRACTICE: {
      bool stop = false;
      for (const auto& pl : players_)
        if (!pl.cpu && app.input.pad[pl.slot].press(B_START)) stop = true;
      if (t_ >= PRACTICE_INTRO && practiceEnd_ < 0) {
        if (t_ - dt < PRACTICE_INTRO) app.audio.sfx("go");
        game_->update(dt);
        if (game_->finished()) {
          practiceEnd_ = t_;
          app.audio.sfx("finish");
        }
      }
      if (stop || t_ >= PRACTICE_INTRO + PRACTICE_LIMIT || (practiceEnd_ >= 0 && t_ - practiceEnd_ > PRACTICE_OUTRO))
        endPractice();
      break;
    }
    case COUNTDOWN:
      if ((int)(t_ - dt) != (int)t_ && t_ < 3) app.audio.sfx("tick");
      if (t_ >= 3.0f) {
        phase_ = PLAY;
        t_ = 0;
        app.audio.sfx("go");
      }
      break;
    case PLAY:
      game_->update(dt);
      if (game_->finished()) {
        phase_ = FINISH;
        t_ = 0;
        app.audio.sfx("finish");
      }
      break;
    case FINISH:
      if (t_ > 1.6f) {
        computePlaces();
        phase_ = RESULTS;
        t_ = 0;
        app.audio.sfx("fanfare");
      }
      break;
    case RESULTS:
      if (t_ > 1.0f && (app.input.anyPress(B_A) || t_ > 5.0f)) {
        phase_ = DONE;
      }
      break;
    case DONE: break;
  }
}

void MinigameHost::drawCard() {
  game_->drawIntro();
  ui::fadeRect(0.45f);
  Color accent = def_ ? Color::hex(def_->color) : col::teal;
  ui::card(70, 40, VW - 140, VH - 80, col::cream, 22);
  app.gfx.panel(70, 40, VW - 140, 64, accent, 22);
  app.gfx.rect(70, 82, VW - 140, 22, accent);
  if (teams_.empty()) {
    app.gfx.text(def_ ? def_->name : id_, VW / 2, 50, 34, col::white, CENTER, true);
  } else {
    // title and the match-up ("2 vs 2", solo side first for 1-vs-3) share the header band
    app.gfx.text(def_ ? def_->name : id_, VW / 2, 44, 30, col::white, CENTER, true);
    int sol = soloTeam();
    int a = sol >= 0 ? teamSize(sol) : teamSize(0), b = sol >= 0 ? teamSize(1 - sol) : teamSize(1);
    std::string vs = std::to_string(a) + " vs " + std::to_string(b);
    app.gfx.text(vs, VW / 2, 81, 17, col::white, CENTER, false);
  }
  if (def_) {
    app.gfx.text(def_->tagline, VW / 2, 112, 20, accent.mix(col::ink, 0.4f), CENTER, false);
    // the controls at a glance, for the Wii Remote held sideways
    std::string ctl = std::string("Wii Remote sideways:  ") + minigameControls(def_);
    float cw = app.gfx.textWidth(ctl, 16) + 28;
    app.gfx.panel(VW / 2 - cw / 2, 138, cw, 26, accent.alpha(0.18f), 13);
    app.gfx.text(ctl, VW / 2, 141, 16, col::ink, CENTER, false);
    float y = 176;
    for (int k = 0; k < 4; k++) {
      const char* line = minigameRule(def_, k);
      if (!line[0]) continue;
      app.gfx.circle(110, y + 11, 6, accent);
      y += app.gfx.textBox(line, 126, y, VW - 260, 18, col::ink) + 6;
    }
  }
  drawReadyRow();
  if (anyHuman()) ui::prompts(VW / 2, VH - 76, {{B_A, "Ready"}, {B_B, "Practice"}}, col::ink);
  else ui::prompts(VW / 2, VH - 76, {{B_A, "Ready"}}, col::ink);
}

void MinigameHost::drawReadyRow() {
  int n = (int)players_.size();
  float y = VH - 150;
  if (teams_.empty()) {
    for (int i = 0; i < n; i++) {
      float x = VW / 2 + (i - (n - 1) / 2.0f) * 120;
      app.gfx.circle(x, y + 20, 26, ready_[i] ? PLAYER_COLORS[players_[i].slot] : col::grey);
      spr::portrait(players_[i].character, x, y + 20, 44);
      app.gfx.text(ready_[i] ? "Ready!" : "...", x, y + 50, 16, ready_[i] ? col::green : col::grey, CENTER, false);
    }
    return;
  }
  // grouped by team on a team-coloured panel, "VS" between the groups
  const float cw = 92, vsw = 70;
  float x = VW / 2 - (teamSize(0) * cw + vsw + teamSize(1) * cw) / 2;
  for (int t = 0; t < 2; t++) {
    float gw = teamSize(t) * cw;
    app.gfx.panel(x, y - 8, gw, 76, teamColor(t), 18);
    int k = 0;
    for (int i = 0; i < n; i++) {
      if (teams_[i] != t) continue;
      float cx = x + cw * (k++ + 0.5f);
      app.gfx.circle(cx, y + 20, 28, col::white);
      app.gfx.circle(cx, y + 20, 26, ready_[i] ? PLAYER_COLORS[players_[i].slot] : col::grey);
      spr::portrait(players_[i].character, cx, y + 20, 44);
      app.gfx.text(ready_[i] ? "Ready!" : "...", cx, y + 50, 16, ready_[i] ? col::white : col::white.alpha(0.7f), CENTER, false);
    }
    x += gw;
    if (t == 0) {
      app.gfx.text("VS", x + vsw / 2, y + 6, 30, col::ink, CENTER, false);
      x += vsw;
    }
  }
}

void MinigameHost::drawTeamLabels() {
  for (int t = 0; t < 2; t++) {
    std::string s = std::string(teamName(t)) + ":";
    const char* sep = " ";
    for (size_t i = 0; i < players_.size(); i++) {
      if (teams_[i] != t) continue;
      s += sep;
      s += data::CHARACTERS[players_[i].character].shortName;
      sep = ", ";
    }
    float w = app.gfx.textWidth(s, 16) + 24;
    float x = t == 0 ? 18 : VW - 18 - w;
    app.gfx.panel(x, 16, w, 28, teamColor(t), 14);
    app.gfx.text(s, x + 12, 20, 16, col::white, LEFT, false);
  }
}

void MinigameHost::drawCelebration() {
  // winners cheer on either side of the results card, everyone else sulks below them
  int n = (int)players_.size();
  std::vector<int> side[2][2];  // [left/right][winners/losers]
  int cnt[2] = {0, 0}, w = 0;
  for (int i = 0; i < n; i++)
    if (places_[i] == 1) side[w % 2][0].push_back(i), cnt[w % 2]++, w++;
  for (int i = 0; i < n; i++) {
    if (places_[i] == 1) continue;
    int s = cnt[0] < cnt[1] ? 0 : 1;
    side[s][1].push_back(i), cnt[s]++;
  }
  const float cx[2] = {104, VW - 104};
  for (int s = 0; s < 2; s++) {
    // a backdrop so they stand out from the frozen minigame behind
    // (kept above the score strip most minigames draw along the bottom)
    if (cnt[s]) {
      float top = side[s][0].empty() ? 300 : 112;
      app.gfx.panel(cx[s] - 86, top, 172, 420 - top, col::ink.alpha(0.55f), 24);
    }
    for (int row = 0; row < 2; row++) {
      const auto& v = side[s][row];
      int m = (int)v.size();
      float scale = row == 0 ? (m > 1 ? 1.35f : 1.85f) : 1.1f, gap = row == 0 ? 84.0f : 76.0f;
      float fy = row == 0 ? 268.0f : 402.0f;
      for (int j = 0; j < m; j++) {
        int c = players_[v[j]].character;
        float x = cx[s] + (j - (m - 1) / 2.0f) * gap;
        const char* anim = row == 0 ? "victory" : "disappointed";
        if (row == 0) app.gfx.circle(x, fy - 60, 52 * scale / 1.85f, col::gold.alpha(0.22f));
        float tt = t_ + j * 0.3f + s * 0.45f;
        if (row == 0) tt = std::fmod(tt, spr::animSeconds(c, anim) + 0.9f);  // replay the cheer now and then
        spr::character(c, anim, tt, x, fy, scale, s == 1);
      }
    }
  }
}

void MinigameHost::drawResults() {
  int n = (int)players_.size();
  ui::card(VW / 2 - 230, 70, 460, 80 + n * 64, col::cream, 20);
  app.gfx.text("RESULTS", VW / 2, 84, 30, col::ink, CENTER, false);
  std::vector<int> order(n);
  for (int i = 0; i < n; i++) order[i] = i;
  std::sort(order.begin(), order.end(), [&](int a, int b) { return places_[a] < places_[b]; });
  static const char* ord[4] = {"1st", "2nd", "3rd", "4th"};
  for (int k = 0; k < n; k++) {
    int i = order[k];
    float y = 130 + k * 64;
    app.gfx.panel(VW / 2 - 210, y, 420, 54, places_[i] == 1 ? col::gold.alpha(0.6f) : col::white, 14);
    app.gfx.text(ord[std::min(3, places_[i] - 1)], VW / 2 - 190, y + 12, 26, col::ink, LEFT, false);
    app.gfx.circle(VW / 2 - 110, y + 27, 22, PLAYER_COLORS[players_[i].slot]);
    spr::portrait(players_[i].character, VW / 2 - 110, y + 27, 38);
    app.gfx.text(data::CHARACTERS[players_[i].character].name, VW / 2 - 80, y + 6, 20, col::ink, LEFT, false);
    app.gfx.text(game_->scoreLabel(i), VW / 2 - 80, y + 29, 16, col::grey, LEFT, false);
  }
}

void MinigameHost::drawTeamResults() {
  int n = (int)players_.size();
  int sol = soloTeam();
  bool avg = teamSize(0) != teamSize(1);
  std::string title = "DRAW!";
  Color tc = col::ink;
  if (winTeam_ >= 0) {
    tc = teamColor(winTeam_);
    if (sol < 0) title = std::string(teamName(winTeam_)) + " TEAM WINS!";
    else if (winTeam_ != sol) title = "TEAM WINS!";
    else
      for (int i = 0; i < n; i++)
        if (teams_[i] == sol) title = std::string(data::CHARACTERS[players_[i].character].shortName) + " WINS!";
  }
  const float rowH = 40, headH = 32, x0 = VW / 2 - 230, y0 = 70;
  float h = 60 + 2 * (headH + 8) + n * rowH + 10 + 14;
  ui::card(x0, y0, 460, h, col::cream, 20);
  app.gfx.text(title, VW / 2, y0 + 14, 30, tc, CENTER, false);
  float y = y0 + 60;
  int first = winTeam_ == 1 ? 1 : 0;  // the winners on top
  for (int k = 0; k < 2; k++) {
    int t = k == 0 ? first : 1 - first;
    int m = teamSize(t);
    float bh = headH + m * rowH + 8;
    Color c = teamColor(t);
    if (winTeam_ >= 0 && winTeam_ != t) c = c.mix(col::grey, 0.45f);
    app.gfx.panel(x0 + 20, y, 420, bh, c, 14);
    app.gfx.text(std::string(teamName(t)) + " TEAM", x0 + 38, y + 6, 18, col::white, LEFT, false);
    if (winTeam_ == t) {
      float nx = x0 + 38 + app.gfx.textWidth(std::string(teamName(t)) + " TEAM", 18) + 10;
      app.gfx.panel(nx, y + 6, 46, 22, col::gold, 11);
      app.gfx.text("WIN", nx + 23, y + 8, 15, col::ink, CENTER, false);
    }
    char buf[40];
    if (avg && m > 1) snprintf(buf, sizeof buf, "Average %.1f", teamScore_[t]);
    else if (avg) snprintf(buf, sizeof buf, "Score %d", (int)teamScore_[t]);
    else snprintf(buf, sizeof buf, "Total %d", (int)teamScore_[t]);
    app.gfx.text(buf, x0 + 422, y + 6, 18, col::white, RIGHT, false);
    float ry = y + headH;
    for (int i = 0; i < n; i++) {
      if (teams_[i] != t) continue;
      app.gfx.panel(x0 + 28, ry, 404, rowH - 4, col::white, 10);
      app.gfx.circle(x0 + 50, ry + 18, 15, PLAYER_COLORS[players_[i].slot]);
      spr::portrait(players_[i].character, x0 + 50, ry + 18, 26);
      app.gfx.text(data::CHARACTERS[players_[i].character].name, x0 + 74, ry + 7, 18, col::ink, LEFT, false);
      app.gfx.text(game_->scoreLabel(i), x0 + 418, ry + 9, 16, col::grey, RIGHT, false);
      ry += rowH;
    }
    y += bh + 10;
  }
}

void MinigameHost::draw() {
  if (!game_) return;
  if (phase_ == CARD) {
    drawCard();
    return;
  }
  if (phase_ == PRACTICE) {
    if (t_ < PRACTICE_INTRO) game_->drawIntro();
    else game_->draw();
    if (t_ < PRACTICE_INTRO) {
      float k = clampf(t_ / 0.3f, 0, 1);
      if (k > 0.05f) app.gfx.text("PRACTICE", VW / 2, VH / 2 - 50 * easeBack(k), 72, col::white, CENTER, true, easeBack(k));
    } else if (practiceEnd_ >= 0) {
      app.gfx.text("FINISH!", VW / 2, VH / 2 - 50, 72, col::white, CENTER, true);
    } else if (t_ < PRACTICE_INTRO + 0.8f) {
      app.gfx.text("GO!", VW / 2, VH / 2 - 60, 96, col::gold.alpha(1 - (t_ - PRACTICE_INTRO) / 0.8f), CENTER, true);
    }
    // the tag and how to stop, top-left (the timer sits top-centre)
    app.gfx.panel(18, 16, 128, 30, col::coral, 15);
    app.gfx.text("PRACTICE", 82, 20, 20, col::white, CENTER, false);
    float hw = 40 + app.gfx.textWidth("Stop practising", 18) + 10;
    app.gfx.panel(18, 50, hw, 30, col::ink.alpha(0.7f), 15);
    ui::prompt(20, 52, B_START, "Stop practising", col::white);
    return;
  }
  game_->draw();
  if (phase_ == COUNTDOWN) {
    int n = 3 - (int)t_;
    float k = t_ - (int)t_;
    float s = 1.6f - easeOut(k) * 0.6f;
    app.gfx.text(std::to_string(n), VW / 2, VH / 2 - 60 * s, 96, col::white.alpha(1 - k * 0.5f), CENTER, true, s);
    if (!teams_.empty()) drawTeamLabels();
  } else if (phase_ == PLAY && t_ < 0.8f) {
    app.gfx.text("GO!", VW / 2, VH / 2 - 60, 96, col::gold.alpha(1 - t_ / 0.8f), CENTER, true);
  } else if (phase_ == FINISH) {
    float k = clampf(t_ / 0.3f, 0, 1);
    if (k > 0.05f) app.gfx.text("FINISH!", VW / 2, VH / 2 - 60 * easeBack(k), 80, col::white, CENTER, true, easeBack(k));
  } else if (phase_ == RESULTS) {
    ui::fadeRect(0.5f);
    drawCelebration();
    if (teams_.empty()) drawResults();
    else drawTeamResults();
  }
}

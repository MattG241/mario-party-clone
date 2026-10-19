// All-Star Party: The Crossover Board Game, Wii edition.
#include <SDL.h>

#include <cstdio>
#include <cstring>
#include <string>

#include "core/Coro.h"
#include "core/Platform.h"
#include "game/Session.h"

Session session;
static int testChars[4] = {-1, -1, -1, -1};  // --chars: the demo's characters

int main(int argc, char** argv) {
  bool ok = platformInit(argc, argv);
#ifndef HW_RVL
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--demo")) session.demo = true;
    if (!strcmp(argv[i], "--tour")) session.tour = true;
    if (!strcmp(argv[i], "--chars") && i + 1 < argc) {
      int c[4] = {-1, -1, -1, -1};
      sscanf(argv[++i], "%d,%d,%d,%d", &c[0], &c[1], &c[2], &c[3]);
      for (int k = 0; k < 4; k++) testChars[k] = c[k];
    }
    if (!strcmp(argv[i], "--event") && i + 1 < argc) session.testEvent = argv[++i];
    if (!strcmp(argv[i], "--mg") && i + 1 < argc) session.forceMinigame = argv[++i];
    if (!strcmp(argv[i], "--frames") && i + 1 < argc) session.frameLimit = atoi(argv[++i]);
    // --press FRAME:PLAYER:BUTTON (a b x y start select up down left right), for driving menus in tests
    if (!strcmp(argv[i], "--press") && i + 1 < argc) {
      static const char* names[] = {"a", "b", "x", "y", "start", "select", "up", "down", "left", "right"};
      int f = 0, p = 0;
      char b[16] = {};
      if (sscanf(argv[++i], "%d:%d:%15s", &f, &p, b) == 3)
        for (int k = 0; k < 10; k++)
          if (!strcmp(b, names[k])) app.input.script(f, p, (Btn)k);
    }
  }
#endif
#ifdef ASP_AUTODEMO
  // test builds for the emulator: start an all-CPU match straight away
  session.demo = true;
#endif
#ifdef ASP_AUTOROSTER
  // test builds for the emulator: scroll quickly through every character on the select screen
  app.input.script(30, 0, B_A);
  app.input.script(60, 0, B_A);
  for (int k = 0; k < 40; k++) app.input.script(120 + k * 8, 0, B_RIGHT);
  session.frameLimit = 700;
#endif
#ifdef ASP_AUTOTOUR
  // test builds for the emulator: play every minigame once with four CPUs
  session.tour = true;
#endif
  if (!ok) {
    // No data folder: show a red screen for a few seconds, then return to the loader.
    for (int f = 0; f < 300 && app.gfx.renderer(); f++) {
      SDL_SetRenderDrawColor(app.gfx.renderer(), 160, 30, 40, 255);
      SDL_RenderClear(app.gfx.renderer());
      SDL_RenderPresent(app.gfx.renderer());
      SDL_Delay(16);
    }
    platformShutdown();
    return 1;
  }
  if (session.demo || session.tour || !session.forceMinigame.empty()) {
    // tests: four CPUs straight into a match (or one minigame)
    for (int i = 0; i < 4; i++) session.slots[i] = Slot{true, false, testChars[i] >= 0 ? testChars[i] : (i * 5 + 2) % data::CHARACTER_COUNT, 2};
    session.rounds = 2;
    ui::go(session.forceMinigame.empty() && !session.tour ? makeBoard() : makeMinigameMenu());
  } else ui::go(makeTitle());

  Uint32 last = SDL_GetTicks();
  int frame = 0;
  float shotTimer = 0;
  int shot = 0;
  double work = 0, workMax = 0;  // seconds spent updating and drawing (not waiting for vsync), per log period
  while (!app.input.quit) {
    Uint32 now = SDL_GetTicks();
    float dt = app.headless ? 1.0f / 30.0f : (now - last) / 1000.0f;
    last = now;
    if (dt > 0.05f) dt = 0.05f;
    app.time += dt;
    app.input.update();
    for (auto& p : app.input.pad)
      if (p.press(B_HOME)) app.input.quit = true;
    Uint64 w0 = SDL_GetPerformanceCounter();
    co::Scheduler::get().tick(dt);
    ui::tick(dt);
    app.gfx.begin(Color(13, 59, 71));
    ui::render();
    double w = (double)(SDL_GetPerformanceCounter() - w0) / SDL_GetPerformanceFrequency();
    work += w;
    if (w > workMax) workMax = w;
    if (!app.shotDir.empty()) {
      shotTimer += dt;
      if (shotTimer >= 1.5f) {
        shotTimer = 0;
        app.gfx.screenshot(app.shotDir + "/" + std::to_string(1000 + shot++) + ".png");
      }
    }
    app.gfx.end();
    frame++;
    if (frame % 120 == 0) {
      logf("frame %d dt %.4f ticks %u work %.1f ms (max %.1f) draws %d/f text %d loads %d", frame, dt, (unsigned)SDL_GetTicks(), work * 1000 / 120,
           workMax * 1000, app.gfx.statDraws / 120, app.gfx.statText, app.gfx.statLoads);
      work = workMax = 0;
      app.gfx.statDraws = app.gfx.statText = app.gfx.statLoads = 0;
    }
    if (session.frameLimit && frame >= session.frameLimit) break;
  }
  platformShutdown();
  return 0;
}

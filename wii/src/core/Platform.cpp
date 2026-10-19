#include "Platform.h"

#include <SDL_image.h>

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <unistd.h>
#include <cstring>

#ifdef HW_RVL
#include <fat.h>
#include <ogc/conf.h>
#include <ogc/pad.h>
#include <wiiuse/wpad.h>
#endif

App app;
const Color PLAYER_COLORS[4] = {Color::hex(0xe5484d), Color::hex(0x3b7cf0), Color::hex(0x3ec35c), Color::hex(0xf4b83b)};

static SDL_Window* g_window = nullptr;
[[maybe_unused]] static FILE* g_log = nullptr;

void logf(const char* f, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, f);
  vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
#ifdef HW_RVL
  if (!g_log && app.dataDir.size() > 5) g_log = fopen((app.dataDir.substr(0, app.dataDir.size() - 5) + "log.txt").c_str(), "w");
  if (g_log) {
    fprintf(g_log, "%s\n", buf);
    fflush(g_log);
    fsync(fileno(g_log));  // libfat only updates the file size on sync
  }
#else
  printf("%s\n", buf);
  fflush(stdout);
#endif
}

static bool fileExists(const std::string& p) {
  FILE* f = fopen(p.c_str(), "rb");
  if (!f) return false;
  fclose(f);
  return true;
}

#ifdef HW_RVL
// The console's Reset and Power buttons (and a Wii Remote's power button) end the game cleanly.
static volatile int g_powerOff = 0;
static void onReset(u32, void*) { app.input.quit = true; }
static void onPower() {
  g_powerOff = 1;
  app.input.quit = true;
}
static void onRemotePower(s32) { onPower(); }
#endif

// settings.txt sits next to the data folder: "border_x=3", "screen_shape=1", ...
static std::string settingsPath() { return app.dataDir.size() > 5 ? app.dataDir.substr(0, app.dataDir.size() - 5) + "settings.txt" : ""; }

static void loadSettings() {
  std::string p = settingsPath();
  FILE* f = p.empty() ? nullptr : fopen(p.c_str(), "r");
  if (!f) {
    // first run: most TVs crop the edges of a Wii's picture, so start inside the safe area and let the
    // title screen offer the TV border screen
    app.firstRun = true;
    app.borderX = 5;
    app.borderY = 3;
    return;
  }
  char line[128];
  int v;
  while (fgets(line, sizeof line, f)) {
    auto clampi = [](int x, int lo, int hi) { return x < lo ? lo : (x > hi ? hi : x); };
    if (sscanf(line, "border_x=%d", &v) == 1) app.borderX = clampi(v, 0, BORDER_MAX);
    if (sscanf(line, "border_y=%d", &v) == 1) app.borderY = clampi(v, 0, BORDER_MAX);
    if (sscanf(line, "shift_x=%d", &v) == 1) app.shiftX = clampi(v, -SHIFT_MAX, SHIFT_MAX);
    if (sscanf(line, "shift_y=%d", &v) == 1) app.shiftY = clampi(v, -SHIFT_MAX, SHIFT_MAX);
    if (sscanf(line, "screen_shape=%d", &v) == 1) app.screenShape = clampi(v, 0, 2);
  }
  fclose(f);
}

void App::saveSettings() {
  firstRun = false;
  std::string p = settingsPath();
  FILE* f = p.empty() ? nullptr : fopen(p.c_str(), "w");
  if (!f) return;
  fprintf(f, "border_x=%d\nborder_y=%d\nshift_x=%d\nshift_y=%d\nscreen_shape=%d\n", borderX, borderY, shiftX, shiftY, screenShape);
  fflush(f);
#ifdef HW_RVL
  fsync(fileno(f));
#endif
  fclose(f);
}

void App::applyScreen() {
  widescreen = screenShape == 0 ? tvWide : screenShape == 1;
  gfx.layout();
}

bool platformInit(int argc, char** argv) {
#ifdef HW_RVL
  app.wii = true;
  SYS_SetResetCallback(onReset);
  SYS_SetPowerCallback(onPower);
  fatInitDefault();
  std::vector<std::string> tries;
  if (argc > 0 && argv && argv[0]) {
    std::string a = argv[0];
    size_t slash = a.find_last_of('/');
    if (slash != std::string::npos) tries.push_back(a.substr(0, slash + 1) + "data/");
  }
  for (const char* dev : {"usb:", "sd:"}) tries.push_back(std::string(dev) + "/apps/allstarparty/data/");
  for (auto& t : tries)
    if (fileExists(t + "font.ttf")) {
      app.dataDir = t;
      break;
    }
  app.tvWide = CONF_GetAspectRatio() == CONF_ASPECT_16_9;
  loadSettings();
  app.widescreen = app.screenShape == 0 ? app.tvWide : app.screenShape == 1;
  logf("data dir: %s (tv 16:9 %d, borders %d/%d, shift %d/%d, shape %d)", app.dataDir.c_str(), app.tvWide, app.borderX, app.borderY,
       app.shiftX, app.shiftY, app.screenShape);
#else
  const char* env = getenv("ASP_DATA");
  if (env) app.dataDir = std::string(env) + "/";
  else {
    std::string exe = argc > 0 ? argv[0] : "";
    size_t slash = exe.find_last_of('/');
    std::string dir = slash == std::string::npos ? "./" : exe.substr(0, slash + 1);
    app.dataDir = fileExists(dir + "data/font.ttf") ? dir + "data/" : "data/";
  }
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--headless")) app.headless = true;
    if (!strcmp(argv[i], "--shots") && i + 1 < argc) app.shotDir = argv[++i];
    if (!strcmp(argv[i], "--43")) app.tvWide = false;
    if (!strcmp(argv[i], "--wii")) app.wii = true;  // preview the Wii's button names
  }
  loadSettings();
  app.widescreen = app.screenShape == 0 ? app.tvWide : app.screenShape == 1;
#endif
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_TIMER) != 0) {
    logf("SDL_Init: %s\n", SDL_GetError());
    return false;
  }
#ifdef HW_RVL
  {
    // the whole framebuffer of the console's video mode (640x480, or taller in some PAL modes)
    SDL_DisplayMode dm{};
    int ww = 640, wh = 480;
    if (SDL_GetDesktopDisplayMode(0, &dm) == 0 && dm.w > 0 && dm.h > 0) ww = dm.w, wh = dm.h;
    g_window = SDL_CreateWindow("All-Star Party", 0, 0, ww, wh, 0);
  }
#else
  g_window = SDL_CreateWindow("All-Star Party", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, app.widescreen ? VW : 640, 480, 0);
#endif
  logf("SDL up");
  if (!g_window) {
    logf("SDL_CreateWindow: %s\n", SDL_GetError());
    return false;
  }
  IMG_Init(IMG_INIT_PNG);
  TTF_Init();
  if (!app.gfx.init(g_window)) return false;
#ifdef HW_RVL
  {
    // libogc's video modes put the 640-pixel picture in the middle of a 720-pixel TV line, which leaves
    // black bars at the sides and squeezes the picture. Stretch it to 704 so it fills the screen width.
    GXRModeObj* vm = VIDEO_GetPreferredMode(NULL);
    vm->viWidth = 704;
    vm->viXOrigin = (VI_MAX_WIDTH_NTSC - 704) / 2;
    VIDEO_Configure(vm);
    VIDEO_Flush();
    VIDEO_WaitVSync();
    if (vm->viTVMode & VI_NON_INTERLACE) VIDEO_WaitVSync();
    logf("video %dx%d (xfb %d, vi %dx%d)", vm->fbWidth, vm->efbHeight, vm->xfbHeight, vm->viWidth, vm->viHeight);
  }
#endif
  logf("gfx up: scale %.3f %.3f", app.gfx.sx, app.gfx.sy);
  app.input.init();
  bool au = app.audio.init();
  logf("input + audio up (%d)", au);
  return !app.dataDir.empty();
}

void platformShutdown() {
  app.gfx.shutdown();
  Mix_CloseAudio();
  TTF_Quit();
  IMG_Quit();
  if (g_window) SDL_DestroyWindow(g_window);
  SDL_Quit();
#ifdef HW_RVL
  if (g_log) fclose(g_log);
  if (g_powerOff) SYS_ResetSystem(SYS_POWEROFF, 0, 0);
#endif
}

// ---------------------------------------------------------------------------------------------
// Gfx

static Tex makeTex(SDL_Renderer* r, int w, int h, float (*alpha)(float, float, int, int)) {
  SDL_Surface* s = SDL_CreateRGBSurfaceWithFormat(0, w, h, 32, SDL_PIXELFORMAT_RGBA32);
  auto* px = (unsigned char*)s->pixels;
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      unsigned char* p = px + y * s->pitch + x * 4;
      float a = alpha(x + 0.5f, y + 0.5f, w, h);
      a = a < 0 ? 0 : (a > 1 ? 1 : a);
      p[0] = p[1] = p[2] = 255;
      p[3] = (unsigned char)(a * 255);
    }
  Tex t;
  t.t = SDL_CreateTextureFromSurface(r, s);
  SDL_SetTextureBlendMode(t.t, SDL_BLENDMODE_BLEND);
  t.w = w;
  t.h = h;
  SDL_FreeSurface(s);
  return t;
}

bool Gfx::init(SDL_Window* win) {
#ifdef HW_RVL
  r_ = SDL_CreateRenderer(win, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
#else
  r_ = SDL_CreateRenderer(win, -1, app.headless ? SDL_RENDERER_SOFTWARE : (SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC));
  if (!r_) r_ = SDL_CreateRenderer(win, -1, SDL_RENDERER_SOFTWARE);
#endif
  if (!r_) {
    printf("SDL_CreateRenderer: %s\n", SDL_GetError());
    return false;
  }
  SDL_SetRenderDrawBlendMode(r_, SDL_BLENDMODE_BLEND);
  SDL_ShowCursor(SDL_DISABLE);
  SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "1");
  layout();
  white_ = makeTex(r_, 4, 4, [](float, float, int, int) { return 1.0f; });
  disc_ = makeTex(r_, 64, 64, [](float x, float y, int w, int) {
    float d = std::hypot(x - w * 0.5f, y - w * 0.5f);
    return (w * 0.5f - d) * 1.2f;
  });
  ringTex_ = makeTex(r_, 64, 64, [](float x, float y, int w, int) {
    float d = std::hypot(x - w * 0.5f, y - w * 0.5f);
    float a = (w * 0.5f - d) * 1.2f, b = (d - (w * 0.5f - 5.0f)) * 1.2f;
    return a < b ? a : b;
  });
  round_ = makeTex(r_, 64, 64, [](float x, float y, int w, int) {
    // a rounded square: radius 32 corners, so each quadrant is a corner piece
    float cx = x < 32 ? 32 : (x > w - 32 ? w - 32 : x), cy = y < 32 ? 32 : (y > w - 32 ? w - 32 : y);
    float d = std::hypot(x - cx, y - cy);
    return (32 - d) * 1.2f;
  });
  return true;
}

void Gfx::shutdown() {
  for (auto& kv : cache_) SDL_DestroyTexture(kv.second.t);
  cache_.clear();
  for (auto& kv : text_) SDL_DestroyTexture(kv.second.tex.t);
  text_.clear();
  for (auto& kv : panels_) SDL_DestroyTexture(kv.second.t);
  panels_.clear();
  for (auto& kv : fonts_) TTF_CloseFont(kv.second);
  fonts_.clear();
  if (r_) SDL_DestroyRenderer(r_);
}

void Gfx::layout() {
  int ow = 0, oh = 0;
  SDL_GetRendererOutputSize(r_, &ow, &oh);
  // the TV borders shrink the picture from each side
  float kx = 1 - app.borderX / 50.0f, ky = 1 - app.borderY / 50.0f;
  if (app.widescreen) {
    // 16:9: fill the framebuffer (the TV stretches the Wii's picture back out to 16:9)
    sx = (float)ow / VW * kx;
    sy = (float)oh / VH * ky;
  } else {
    // 4:3: letterbox the 16:9 canvas
    sx = (float)ow / VW * kx;
    sy = (float)ow / VW * ky;
  }
  ox = (ow - VW * sx) * 0.5f + app.shiftX * ow / 100.0f;
  oy = (oh - VH * sy) * 0.5f + app.shiftY * oh / 100.0f;
  // keep everything inside the picture when it doesn't fill the screen
  int x0 = std::max(0, (int)std::floor(ox)), y0 = std::max(0, (int)std::floor(oy));
  int x1 = std::min(ow, (int)std::ceil(ox + VW * sx)), y1 = std::min(oh, (int)std::ceil(oy + VH * sy));
  SDL_Rect clip{x0, y0, x1 - x0, y1 - y0};
  if (x0 > 0 || y0 > 0 || x1 < ow || y1 < oh) SDL_RenderSetClipRect(r_, &clip);
  else SDL_RenderSetClipRect(r_, nullptr);
  // text was rasterised for the old scale
  for (auto& t : text_)
    if (t.second.tex.t) SDL_DestroyTexture(t.second.tex.t);
  text_.clear();
}

void Gfx::begin(Color c) {
  SDL_SetRenderDrawColor(r_, 0, 0, 0, 255);
  SDL_RenderClear(r_);
  rect(0, 0, VW, VH, c);
}

void Gfx::end() {
  frame_++;
  // Drop text textures not drawn for a while.
  if (frame_ % 120 == 0 && text_.size() > 120) {
    for (auto it = text_.begin(); it != text_.end();) {
      if (frame_ - it->second.lastUsed > 240) {
        SDL_DestroyTexture(it->second.tex.t);
        it = text_.erase(it);
      } else ++it;
    }
  }
  // panel textures not drawn for a while (animated sizes make one-off ones)
  if (frame_ % 120 == 0)
    for (auto it = panels_.begin(); it != panels_.end();) {
      if (frame_ - it->second.used > 240) {
        SDL_DestroyTexture(it->second.t);
        it = panels_.erase(it);
      } else ++it;
    }
  // Character sheets are big (about 3 MB each in texture memory): free the ones not drawn lately, so
  // browsing all 17 on the select screen never holds them all at once.
  if (frame_ % 60 == 0)
    for (auto it = cache_.begin(); it != cache_.end();) {
      if (it->second.t && it->first.compare(0, 6, "chars/") == 0 && frame_ - it->second.used > 90 && !isPinned(it->first)) {
        logf("freed %s", it->first.c_str());
        SDL_DestroyTexture(it->second.t);
        it = cache_.erase(it);
      } else ++it;
    }
  SDL_RenderPresent(r_);
}

SDL_Texture* Gfx::load(const std::string& rel) {
  statLoads++;
  SDL_Texture* t = IMG_LoadTexture(r_, app.path(rel).c_str());
  // opaque art (board tiles, arenas, backdrops) ships as JPEG to keep the download small
  if (!t && rel.size() > 4 && rel.compare(rel.size() - 4, 4, ".png") == 0)
    t = IMG_LoadTexture(r_, app.path(rel.substr(0, rel.size() - 4) + ".jpg").c_str());
  return t;
}

bool Gfx::isPinned(const std::string& rel) const { return std::find(pinned_.begin(), pinned_.end(), rel) != pinned_.end(); }

// Free every texture that wasn't drawn this frame or the last (they reload when they're needed again).
void Gfx::purgeIdle() {
  for (auto it = cache_.begin(); it != cache_.end();) {
    if (it->second.t && frame_ - it->second.used > 1 && !isPinned(it->first)) {
      SDL_DestroyTexture(it->second.t);
      it = cache_.erase(it);
    } else ++it;
  }
}

Tex* Gfx::tex(const std::string& rel) {
  auto it = cache_.find(rel);
  if (it != cache_.end()) {
    it->second.used = frame_;
    return &it->second;
  }
  // a texture that failed to load is retried a little later, not given up on
  auto f = failed_.find(rel);
  if (f != failed_.end() && frame_ < f->second) return &blank_;
  Tex t;
  t.t = load(rel);
  if (!t.t) {
    // most likely out of memory: free the idle textures and try once more
    purgeIdle();
    t.t = load(rel);
  }
  if (!t.t) {
    logf("missing texture %s: %s", rel.c_str(), IMG_GetError());
    failed_[rel] = frame_ + 90;
    return &blank_;
  }
  failed_.erase(rel);
  SDL_QueryTexture(t.t, nullptr, nullptr, &t.w, &t.h);
  SDL_SetTextureBlendMode(t.t, SDL_BLENDMODE_BLEND);
  t.used = frame_;
  return &(cache_[rel] = t);
}

void Gfx::drop(const std::string& prefix) {
  for (auto it = cache_.begin(); it != cache_.end();) {
    if (it->first.compare(0, prefix.size(), prefix) == 0) {
      if (it->second.t) SDL_DestroyTexture(it->second.t);
      it = cache_.erase(it);
    } else ++it;
  }
}

void Gfx::dst(float x, float y, float w, float h, SDL_Rect& o) const {
  float x0 = x * sx + ox, y0 = y * sy + oy, x1 = (x + w) * sx + ox, y1 = (y + h) * sy + oy;
  o.x = (int)std::floor(x0);
  o.y = (int)std::floor(y0);
  o.w = (int)std::floor(x1) - o.x;
  o.h = (int)std::floor(y1) - o.y;
}

void Gfx::sprite(Tex* t, SDL_Rect src, float x, float y, float scx, float scy, float ox_, float oy_, float angle, bool flip, Color tint) {
  if (!t || !t->t || tint.a == 0) return;
  float w = src.w * std::fabs(scx), h = src.h * std::fabs(scy);
  SDL_Rect d;
  dst(x - w * ox_, y - h * oy_, w, h, d);
  if (d.w <= 0 || d.h <= 0) return;
  SDL_SetTextureColorMod(t->t, tint.r, tint.g, tint.b);
  SDL_SetTextureAlphaMod(t->t, tint.a);
  SDL_Point c{(int)(w * ox_ * sx), (int)(h * oy_ * sy)};
  SDL_RendererFlip f = (flip != (scx < 0)) ? SDL_FLIP_HORIZONTAL : SDL_FLIP_NONE;
  if (scy < 0) f = (SDL_RendererFlip)(f | SDL_FLIP_VERTICAL);
  statDraws++;
  if (angle == 0 && f == SDL_FLIP_NONE) SDL_RenderCopy(r_, t->t, &src, &d);
  else SDL_RenderCopyEx(r_, t->t, &src, &d, angle, &c, f);
}

void Gfx::image(Tex* t, float x, float y, float w, float h, Color tint) {
  if (!t || !t->t) return;
  SDL_Rect src{0, 0, t->w, t->h};
  sprite(t, src, x, y, w / t->w, h / t->h, 0, 0, 0, false, tint);
}

void Gfx::rect(float x, float y, float w, float h, Color c) {
  if (c.a == 0 || w <= 0 || h <= 0) return;
  SDL_Rect d;
  dst(x, y, w, h, d);
  SDL_SetRenderDrawColor(r_, c.r, c.g, c.b, c.a);
  SDL_RenderFillRect(r_, &d);
}

// A rounded rectangle of exactly pw x ph screen pixels (white, tinted when drawn), made once and reused:
// one draw call per panel instead of seven, which matters on the Wii's CPU.
Tex* Gfx::panelTex(int pw, int ph, int pr) {
  PanelKey k{pw, ph, pr};
  auto it = panels_.find(k);
  if (it != panels_.end()) {
    it->second.used = frame_;
    return &it->second;
  }
  SDL_Surface* s = SDL_CreateRGBSurfaceWithFormat(0, pw, ph, 32, SDL_PIXELFORMAT_RGBA32);
  if (!s) return nullptr;
  for (int y = 0; y < ph; y++) {
    Uint32* row = (Uint32*)((Uint8*)s->pixels + y * s->pitch);
    for (int x = 0; x < pw; x++) {
      float fx = x + 0.5f, fy = y + 0.5f;
      float cx = std::fmax((float)pr, std::fmin((float)(pw - pr), fx)), cy = std::fmax((float)pr, std::fmin((float)(ph - pr), fy));
      float a = std::fmax(0.0f, std::fmin(1.0f, (pr - std::hypot(fx - cx, fy - cy)) * 1.2f + 0.5f));
      row[x] = SDL_MapRGBA(s->format, 255, 255, 255, (Uint8)(a * 255));
    }
  }
  Tex t;
  t.t = SDL_CreateTextureFromSurface(r_, s);
  SDL_FreeSurface(s);
  if (!t.t) return nullptr;
  SDL_SetTextureBlendMode(t.t, SDL_BLENDMODE_BLEND);
  t.w = pw, t.h = ph, t.used = frame_;
  return &(panels_[k] = t);
}

void Gfx::panel(float x, float y, float w, float h, Color c, float rad) {
  if (c.a == 0) return;
  rad = std::fmin(rad, std::fmin(w, h) * 0.5f);
  if (rad < 1) {
    rect(x, y, w, h, c);
    return;
  }
  int pw = (int)std::lround(w * sx), ph = (int)std::lround(h * sy), pr = (int)std::lround(rad * sy);
  if (pw > 0 && ph > 0 && pw <= 1024 && ph <= 1024 && pw * ph <= 110000) {
    if (Tex* t = panelTex(pw, ph, pr)) {
      SDL_Rect src{0, 0, pw, ph};
      sprite(t, src, x, y, w / pw, h / ph, 0, 0, 0, false, c);
      return;
    }
  }
  float k = rad / 32.0f;
  SDL_Rect q[4] = {{0, 0, 32, 32}, {32, 0, 32, 32}, {0, 32, 32, 32}, {32, 32, 32, 32}};
  sprite(&round_, q[0], x, y, k, k, 0, 0, 0, false, c);
  sprite(&round_, q[1], x + w - rad, y, k, k, 0, 0, 0, false, c);
  sprite(&round_, q[2], x, y + h - rad, k, k, 0, 0, 0, false, c);
  sprite(&round_, q[3], x + w - rad, y + h - rad, k, k, 0, 0, 0, false, c);
  rect(x + rad, y, w - 2 * rad, h, c);
  rect(x, y + rad, rad, h - 2 * rad, c);
  rect(x + w - rad, y + rad, rad, h - 2 * rad, c);
}

void Gfx::circle(float x, float y, float r, Color c) {
  SDL_Rect s{0, 0, 64, 64};
  sprite(&disc_, s, x, y, r / 32.0f, r / 32.0f, 0.5f, 0.5f, 0, false, c);
}

void Gfx::ellipse(float x, float y, float rx, float ry, Color c) {
  SDL_Rect s{0, 0, 64, 64};
  sprite(&disc_, s, x, y, rx / 32.0f, ry / 32.0f, 0.5f, 0.5f, 0, false, c);
}

void Gfx::ring(float x, float y, float r, Color c) {
  SDL_Rect s{0, 0, 64, 64};
  sprite(&ringTex_, s, x, y, r / 32.0f, r / 32.0f, 0.5f, 0.5f, 0, false, c);
}

void Gfx::line(float x0, float y0, float x1, float y1, float w, Color c) {
  float len = std::hypot(x1 - x0, y1 - y0);
  if (len < 0.5f) return;
  float ang = std::atan2(y1 - y0, x1 - x0) * 57.29578f;
  SDL_Rect s{0, 0, 4, 4};
  // rotate about the start point: draw centred on the midpoint
  sprite(&white_, s, (x0 + x1) * 0.5f, (y0 + y1) * 0.5f, len / 4.0f, w / 4.0f, 0.5f, 0.5f, ang, false, c);
}

TTF_Font* Gfx::font(int size) {
  // Fonts are rasterised at framebuffer height (the canvas maps 1:1 vertically on a 480-line screen).
  int px = (int)std::lround(size * sy);
  if (px < 6) px = 6;
  auto it = fonts_.find(px);
  if (it != fonts_.end()) return it->second;
  TTF_Font* f = TTF_OpenFont(app.path("font.ttf").c_str(), px);
  if (!f) logf("font: %s", TTF_GetError());
  else logf("font %d px loaded", px);
  return fonts_[px] = f;
}

Gfx::TextTex* Gfx::textTex(const std::string& s, int size) {
  TextKey k{s, size};
  auto it = text_.find(k);
  if (it != text_.end()) {
    it->second.lastUsed = frame_;
    return &it->second;
  }
  TTF_Font* f = font(size);
  if (!f || s.empty()) return nullptr;
  statText++;
  SDL_Surface* surf = TTF_RenderUTF8_Blended(f, s.c_str(), SDL_Color{255, 255, 255, 255});
  if (!surf) return nullptr;
  TextTex tt;
  tt.tex.t = SDL_CreateTextureFromSurface(r_, surf);
  tt.tex.w = surf->w;
  tt.tex.h = surf->h;
  SDL_SetTextureBlendMode(tt.tex.t, SDL_BLENDMODE_BLEND);
  SDL_FreeSurface(surf);
  tt.lastUsed = frame_;
  return &(text_[k] = tt);
}

float Gfx::textWidth(const std::string& s, int size) {
  TextTex* t = textTex(s, size);
  // texture pixels are rasterised at framebuffer height: canvas width = pixels / sy
  return t ? t->tex.w / sy : 0;
}

void Gfx::text(const std::string& s, float x, float y, int size, Color c, Align a, bool shadow, float scale) {
  // big sizes snap to steps of 8 (and scale the rest), so animated text doesn't open a new font every frame
  if (size > 40) {
    int q = (size + 4) / 8 * 8;
    scale *= (float)size / q;
    size = q;
  }
  TextTex* t = textTex(s, size);
  if (!t) return;
  // texture pixels are framebuffer pixels: convert back to canvas units
  float w = t->tex.w / sy * scale, h = t->tex.h / sy * scale;
  float x0 = a == CENTER ? x - w * 0.5f : (a == RIGHT ? x - w : x);
  SDL_Rect src{0, 0, t->tex.w, t->tex.h};
  float k = scale / sy;
  if (shadow) sprite(&t->tex, src, x0 + 1.5f, y + 2.0f, k, k, 0, 0, 0, false, Color(0, 0, 0, (unsigned char)(c.a * 0.45f)));
  sprite(&t->tex, src, x0, y, k, k, 0, 0, 0, false, c);
  (void)h;
}

float Gfx::textBox(const std::string& s, float x, float y, float w, int size, Color c, Align a) {
  // greedy word wrap on measured widths
  std::vector<std::string> lines;
  std::string line, word;
  auto flush = [&]() {
    if (!line.empty()) lines.push_back(line);
    line.clear();
  };
  for (size_t i = 0; i <= s.size(); i++) {
    char ch = i < s.size() ? s[i] : ' ';
    if (ch == '\n') {
      if (!word.empty()) line += (line.empty() ? "" : " ") + word;
      word.clear();
      flush();
      continue;
    }
    if (ch == ' ') {
      if (word.empty()) continue;
      std::string cand = line.empty() ? word : line + " " + word;
      if (textWidth(cand, size) > w && !line.empty()) {
        flush();
        line = word;
      } else line = cand;
      word.clear();
    } else word += ch;
  }
  flush();
  float lh = size * 1.25f;
  for (size_t i = 0; i < lines.size(); i++) {
    float lx = a == CENTER ? x + w * 0.5f : (a == RIGHT ? x + w : x);
    text(lines[i], lx, y + i * lh, size, c, a, false);
  }
  return lines.size() * lh;
}

bool Gfx::screenshot(const std::string& path) {
  int w, h;
  SDL_GetRendererOutputSize(r_, &w, &h);
  SDL_Surface* s = SDL_CreateRGBSurfaceWithFormat(0, w, h, 32, SDL_PIXELFORMAT_RGBA32);
  if (SDL_RenderReadPixels(r_, nullptr, SDL_PIXELFORMAT_RGBA32, s->pixels, s->pitch) != 0) {
    SDL_FreeSurface(s);
    return false;
  }
  bool ok = IMG_SavePNG(s, path.c_str()) == 0;
  SDL_FreeSurface(s);
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Input

void Input::init() {
#ifdef HW_RVL
  WPAD_Init();
  WPAD_SetDataFormat(WPAD_CHAN_ALL, WPAD_FMT_BTNS_ACC);
  WPAD_SetPowerButtonCallback(onRemotePower);
  PAD_Init();
#endif
}

void Input::update() {
  frame++;
  bool now[4][B_COUNT] = {};
  float sx[4] = {}, sy[4] = {};
  bool conn[4] = {};
#ifdef HW_RVL
  WPAD_ScanPads();
  PAD_ScanPads();
  for (int i = 0; i < 4; i++) {
    u32 type = 0;
    s32 st = WPAD_Probe(i, &type);
    if (st == WPAD_ERR_NONE) {
      conn[i] = true;
      u32 h = WPAD_ButtonsHeld(i);
      WPADData* d = WPAD_Data(i);
      if (type == WPAD_EXP_NUNCHUK) {
        // Wii Remote upright + Nunchuk: stick moves, A confirms, B backs out
        now[i][B_A] |= h & WPAD_BUTTON_A;
        now[i][B_B] |= h & WPAD_BUTTON_B;
        now[i][B_X] |= h & WPAD_NUNCHUK_BUTTON_C;
        now[i][B_Y] |= h & WPAD_NUNCHUK_BUTTON_Z;
        now[i][B_UP] |= h & WPAD_BUTTON_UP;
        now[i][B_DOWN] |= h & WPAD_BUTTON_DOWN;
        now[i][B_LEFT] |= h & WPAD_BUTTON_LEFT;
        now[i][B_RIGHT] |= h & WPAD_BUTTON_RIGHT;
        if (d && d->exp.nunchuk.js.mag > 0.15f) {
          float a = d->exp.nunchuk.js.ang * 0.0174533f, m = d->exp.nunchuk.js.mag > 1 ? 1 : d->exp.nunchuk.js.mag;
          sx[i] = std::sin(a) * m;
          sy[i] = -std::cos(a) * m;
        }
      } else if (type == WPAD_EXP_CLASSIC) {
        now[i][B_A] |= h & WPAD_CLASSIC_BUTTON_A;
        now[i][B_B] |= h & WPAD_CLASSIC_BUTTON_B;
        now[i][B_X] |= h & WPAD_CLASSIC_BUTTON_X;
        now[i][B_Y] |= h & WPAD_CLASSIC_BUTTON_Y;
        now[i][B_START] |= h & WPAD_CLASSIC_BUTTON_PLUS;
        now[i][B_SELECT] |= h & WPAD_CLASSIC_BUTTON_MINUS;
        now[i][B_HOME] |= h & WPAD_CLASSIC_BUTTON_HOME;
        now[i][B_UP] |= h & WPAD_CLASSIC_BUTTON_UP;
        now[i][B_DOWN] |= h & WPAD_CLASSIC_BUTTON_DOWN;
        now[i][B_LEFT] |= h & WPAD_CLASSIC_BUTTON_LEFT;
        now[i][B_RIGHT] |= h & WPAD_CLASSIC_BUTTON_RIGHT;
        if (d && d->exp.classic.ljs.mag > 0.15f) {
          float a = d->exp.classic.ljs.ang * 0.0174533f, m = d->exp.classic.ljs.mag > 1 ? 1 : d->exp.classic.ljs.mag;
          sx[i] = std::sin(a) * m;
          sy[i] = -std::cos(a) * m;
        }
      } else {
        // Wii Remote held sideways (NES style): the d-pad turns, 2 confirms, 1 backs out
        now[i][B_A] |= h & (WPAD_BUTTON_2 | WPAD_BUTTON_A);
        now[i][B_B] |= h & WPAD_BUTTON_1;
        now[i][B_X] |= h & WPAD_BUTTON_B;
        now[i][B_UP] |= h & WPAD_BUTTON_RIGHT;
        now[i][B_DOWN] |= h & WPAD_BUTTON_LEFT;
        now[i][B_LEFT] |= h & WPAD_BUTTON_UP;
        now[i][B_RIGHT] |= h & WPAD_BUTTON_DOWN;
      }
      now[i][B_START] |= h & WPAD_BUTTON_PLUS;
      now[i][B_SELECT] |= h & WPAD_BUTTON_MINUS;
      now[i][B_HOME] |= h & WPAD_BUTTON_HOME;
    }
    // GameCube controller in the same port
    if (PAD_ButtonsHeld(i) || std::abs(PAD_StickX(i)) > 30 || std::abs(PAD_StickY(i)) > 30) conn[i] = true;
    u16 g = PAD_ButtonsHeld(i);
    now[i][B_A] |= g & PAD_BUTTON_A;
    now[i][B_B] |= g & PAD_BUTTON_B;
    now[i][B_X] |= g & PAD_BUTTON_X;
    now[i][B_Y] |= g & PAD_BUTTON_Y;
    now[i][B_START] |= g & PAD_BUTTON_START;
    now[i][B_SELECT] |= g & PAD_TRIGGER_Z;
    now[i][B_UP] |= g & PAD_BUTTON_UP;
    now[i][B_DOWN] |= g & PAD_BUTTON_DOWN;
    now[i][B_LEFT] |= g & PAD_BUTTON_LEFT;
    now[i][B_RIGHT] |= g & PAD_BUTTON_RIGHT;
    int gx = PAD_StickX(i), gy = PAD_StickY(i);
    if (std::abs(gx) > 18 || std::abs(gy) > 18) {
      sx[i] = gx / 80.0f;
      sy[i] = -gy / 80.0f;
    }
  }
  SDL_Event e;
  while (SDL_PollEvent(&e))
    if (e.type == SDL_QUIT) quit = true;
#else
  SDL_Event e;
  while (SDL_PollEvent(&e))
    if (e.type == SDL_QUIT) quit = true;
  const Uint8* k = SDL_GetKeyboardState(nullptr);
  conn[0] = true;
  now[0][B_A] = k[SDL_SCANCODE_Z] || k[SDL_SCANCODE_SPACE];
  now[0][B_B] = k[SDL_SCANCODE_X] || k[SDL_SCANCODE_BACKSPACE];
  now[0][B_X] = k[SDL_SCANCODE_C];
  now[0][B_Y] = k[SDL_SCANCODE_V];
  now[0][B_START] = k[SDL_SCANCODE_RETURN];
  now[0][B_SELECT] = k[SDL_SCANCODE_TAB];
  now[0][B_HOME] = k[SDL_SCANCODE_ESCAPE];
  now[0][B_UP] = k[SDL_SCANCODE_UP];
  now[0][B_DOWN] = k[SDL_SCANCODE_DOWN];
  now[0][B_LEFT] = k[SDL_SCANCODE_LEFT];
  now[0][B_RIGHT] = k[SDL_SCANCODE_RIGHT];
  conn[1] = true;
  now[1][B_A] = k[SDL_SCANCODE_F];
  now[1][B_B] = k[SDL_SCANCODE_G];
  now[1][B_UP] = k[SDL_SCANCODE_W];
  now[1][B_DOWN] = k[SDL_SCANCODE_S];
  now[1][B_LEFT] = k[SDL_SCANCODE_A];
  now[1][B_RIGHT] = k[SDL_SCANCODE_D];
#endif
  for (auto& ev : script_)
    if (ev.frame == frame) {
      now[ev.player][ev.b] = true;
      conn[ev.player] = true;
    }
  for (int i = 0; i < 4; i++) {
    Pad& p = pad[i];
    p.connected = conn[i];
    // the d-pad doubles as the stick
    float dx = (now[i][B_RIGHT] ? 1.f : 0.f) - (now[i][B_LEFT] ? 1.f : 0.f);
    float dy = (now[i][B_DOWN] ? 1.f : 0.f) - (now[i][B_UP] ? 1.f : 0.f);
    if (dx != 0 || dy != 0) {
      sx[i] = dx;
      sy[i] = dy;
    } else {
      // and the stick drives the d-pad for menus
      now[i][B_RIGHT] = sx[i] > 0.6f;
      now[i][B_LEFT] = sx[i] < -0.6f;
      now[i][B_DOWN] = sy[i] > 0.6f;
      now[i][B_UP] = sy[i] < -0.6f;
    }
    p.x = sx[i];
    p.y = sy[i];
    for (int b = 0; b < B_COUNT; b++) {
      p.held[b] = now[i][b];
      p.pressed[b] = now[i][b] && !prev_[i][b];
      prev_[i][b] = now[i][b];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Audio

bool Audio::init() {
  ok_ = Mix_OpenAudio(48000, MIX_DEFAULT_FORMAT, 2, 1024) == 0;
  if (ok_) Mix_AllocateChannels(16);
  return ok_;
}

void Audio::sfx(const char* name, float volume) {
  if (!ok_) return;
  auto it = chunks_.find(name);
  Mix_Chunk* c;
  if (it == chunks_.end()) {
    c = Mix_LoadWAV(app.path(std::string("sfx/") + name + ".wav").c_str());
    chunks_[name] = c;
  } else c = it->second;
  if (!c) return;
  int ch = Mix_PlayChannel(-1, c, 0);
  if (ch >= 0) Mix_Volume(ch, (int)(MIX_MAX_VOLUME * volume));
}

void Audio::music(const char* name) {
  if (!ok_ || current_ == name) return;
  stopMusic();
  current_ = name;
  for (const char* ext : {".ogg", ".mp3", ".wav"}) {
    std::string p = app.path(std::string("music/") + name + ext);
    if (!fileExists(p)) continue;
    music_ = Mix_LoadMUS(p.c_str());
    logf("music %s%s: %s", name, ext, music_ ? "playing" : Mix_GetError());
    if (music_) break;
  }
  if (music_) {
    Mix_VolumeMusic(MIX_MAX_VOLUME * 6 / 10);
    Mix_PlayMusic(music_, -1);
  }
}

bool Audio::hasMusic(const char* name) const {
  for (const char* ext : {".ogg", ".mp3", ".wav"})
    if (fileExists(app.path(std::string("music/") + name + ext))) return true;
  return false;
}

void Audio::stopMusic() {
  if (music_) {
    Mix_HaltMusic();
    Mix_FreeMusic(music_);
    music_ = nullptr;
  }
  current_.clear();
}

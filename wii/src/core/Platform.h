// Platform layer: video, timing, data paths, input and audio for the Wii (devkitPPC + SDL2) and for the
// Linux build used to develop and test the game.
#pragma once
#include <SDL.h>
#include <SDL_mixer.h>
#include <SDL_ttf.h>

#include <map>
#include <string>
#include <vector>

// The game draws on a 16:9 canvas of 854x480; Gfx maps it onto the real framebuffer.
constexpr int VW = 854;
constexpr int VH = 480;
constexpr int BORDER_MAX = 15, SHIFT_MAX = 6;  // screen options, percent of the screen

struct Color {
  unsigned char r = 255, g = 255, b = 255, a = 255;
  Color() = default;
  constexpr Color(unsigned char r_, unsigned char g_, unsigned char b_, unsigned char a_ = 255) : r(r_), g(g_), b(b_), a(a_) {}
  static constexpr Color hex(unsigned v, unsigned char a = 255) { return Color((v >> 16) & 255, (v >> 8) & 255, v & 255, a); }
  Color alpha(float k) const { return Color(r, g, b, (unsigned char)(a * k)); }
  Color mix(Color o, float k) const {
    return Color((unsigned char)(r + (o.r - r) * k), (unsigned char)(g + (o.g - g) * k), (unsigned char)(b + (o.b - b) * k), (unsigned char)(a + (o.a - a) * k));
  }
};

namespace col {
constexpr Color white{255, 255, 255}, black{0, 0, 0}, ink{31, 41, 64}, cream{255, 248, 231}, gold{255, 197, 58}, teal{31, 165, 160},
    coral{255, 107, 94}, navy{13, 59, 71}, blue{59, 124, 240}, red{230, 61, 77}, green{62, 195, 92}, purple{142, 92, 217}, grey{150, 158, 170};
}

extern const Color PLAYER_COLORS[4];

// ---------------------------------------------------------------------------------------------
struct Tex {
  SDL_Texture* t = nullptr;
  int w = 0, h = 0;
  int used = 0;  // frame last asked for (Gfx frees idle character sheets)
};

enum Align { LEFT = 0, CENTER = 1, RIGHT = 2 };

class Gfx {
 public:
  bool init(SDL_Window* win);
  // Map the 854x480 canvas onto the screen (16:9 stretch or 4:3 letterbox, inside the TV borders).
  void layout();
  void shutdown();
  void begin(Color clear);
  void end();

  Tex* tex(const std::string& rel);  // cached, from the data folder; "x.png" falls back to "x.jpg"
  // Textures that are never freed while idle (the sheets of the characters in play: a player walking
  // off-screen must not lose their sprite).
  void pin(const std::vector<std::string>& rels) { pinned_ = rels; }
  void drop(const std::string& prefix);
  // Draw part of a texture. (x, y) is where the origin (ox, oy in 0..1 of the drawn size) lands.
  void sprite(Tex* t, SDL_Rect src, float x, float y, float sx, float sy, float ox = 0.5f, float oy = 0.5f, float angle = 0, bool flip = false,
              Color tint = col::white);
  void image(Tex* t, float x, float y, float w, float h, Color tint = col::white);
  void rect(float x, float y, float w, float h, Color c);
  void panel(float x, float y, float w, float h, Color c, float radius = 16);
  void circle(float x, float y, float r, Color c);
  void ellipse(float x, float y, float rx, float ry, Color c);
  void ring(float x, float y, float r, Color c);
  void line(float x0, float y0, float x1, float y1, float w, Color c);

  // Text in the game font. size is the pixel height on the 854x480 canvas.
  void text(const std::string& s, float x, float y, int size, Color c = col::white, Align a = LEFT, bool shadow = true, float scale = 1.0f);
  // Word-wrapped text; returns the height used.
  float textBox(const std::string& s, float x, float y, float w, int size, Color c = col::ink, Align a = LEFT);
  float textWidth(const std::string& s, int size);

  bool screenshot(const std::string& path);
  SDL_Renderer* renderer() { return r_; }

  // canvas -> framebuffer mapping
  float sx = 1, sy = 1, ox = 0, oy = 0;

 private:
  struct TextKey {
    std::string s;
    int size;
    bool operator<(const TextKey& o) const { return size != o.size ? size < o.size : s < o.s; }
  };
  struct TextTex {
    Tex tex;
    int lastUsed = 0;
  };
  TTF_Font* font(int size);
  TextTex* textTex(const std::string& s, int size);
  void dst(float x, float y, float w, float h, SDL_Rect& out) const;

  SDL_Renderer* r_ = nullptr;
  std::map<std::string, Tex> cache_;
  struct PanelKey {
    int w, h, r;
    bool operator<(const PanelKey& o) const { return w != o.w ? w < o.w : (h != o.h ? h < o.h : r < o.r); }
  };
  std::map<PanelKey, Tex> panels_;
  Tex* panelTex(int pw, int ph, int pr);
  std::vector<std::string> pinned_;
  bool isPinned(const std::string& rel) const;
  std::map<std::string, int> failed_;  // textures that failed to load: retry after this frame
  Tex blank_;                           // what a texture that couldn't load draws (nothing)
  SDL_Texture* load(const std::string& rel);
  void purgeIdle();
  std::map<int, TTF_Font*> fonts_;
  std::map<TextKey, TextTex> text_;
  int frame_ = 0;

 public:
  // per-frame costs, for the log (draw calls, text rasterised, images loaded)
  int statDraws = 0, statText = 0, statLoads = 0;
  // what's held: cached images, text textures, panel textures, open fonts, and their pixel bytes
  void cacheStats(int& images, int& texts, int& panels, int& fonts, long& bytes) const;

 private:
  Tex white_, disc_, round_, ringTex_;
};

// ---------------------------------------------------------------------------------------------
enum Btn { B_A, B_B, B_X, B_Y, B_START, B_SELECT, B_UP, B_DOWN, B_LEFT, B_RIGHT, B_HOME, B_COUNT };

struct Pad {
  bool connected = false;
  bool held[B_COUNT] = {};
  bool pressed[B_COUNT] = {};
  float x = 0, y = 0;  // stick (or d-pad), -1..1, y down
  bool press(Btn b) const { return pressed[b]; }
  bool down(Btn b) const { return held[b]; }
};

class Input {
 public:
  void init();
  void update();
  Pad pad[4];
  bool quit = false;
  // Any player pressed this (menus that anyone can drive).
  bool anyPress(Btn b) const {
    for (const auto& p : pad)
      if (p.pressed[b]) return true;
    return false;
  }
  // Scripted presses for automated tests: (frame, player, button).
  void script(int frame, int player, Btn b) { script_.push_back({frame, player, b}); }
  int frame = 0;

 private:
  struct Ev {
    int frame, player;
    Btn b;
  };
  std::vector<Ev> script_;
  bool prev_[4][B_COUNT] = {};
};

// ---------------------------------------------------------------------------------------------
class Audio {
 public:
  bool init();
  void sfx(const char* name, float volume = 1.0f);
  // Plays music/<name>.ogg, .mp3 or .wav on a loop (so tracks made elsewhere can simply be dropped in).
  void music(const char* name);
  bool hasMusic(const char* name) const;
  void stopMusic();

 private:
  bool ok_ = false;
  std::map<std::string, Mix_Chunk*> chunks_;
  Mix_Music* music_ = nullptr;
  std::string current_;
};

// ---------------------------------------------------------------------------------------------
struct App {
  Gfx gfx;
  Input input;
  Audio audio;
  std::string dataDir;
  bool wii = false;
  bool widescreen = true;  // the picture shape in use (see screenShape)
  bool tvWide = true;      // the console's own 16:9 / 4:3 setting
  // Screen options (title menu, saved in settings.txt next to the data folder)
  int borderX = 0, borderY = 0;  // TV borders, percent of the screen on each side (for TVs that cut off the edges)
  int shiftX = 0, shiftY = 0;    // nudge the picture, percent of the screen (+ right / down)
  int screenShape = 0;           // 0 the console's setting, 1 16:9, 2 4:3
  bool firstRun = false;         // no settings.txt yet: the title screen opens the TV border screen
  void applyScreen();      // after changing the options
  void saveSettings();
  bool headless = false;  // tests: no vsync waits
  std::string shotDir;    // tests: save screenshots here
  float time = 0;
  std::string path(const std::string& rel) const { return dataDir + rel; }
};
extern App app;

void logf(const char* f, ...);  // to log.txt next to the data folder (Wii) or stdout
bool platformInit(int argc, char** argv);
void platformShutdown();

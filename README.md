# Gleamtrail: Festival of the Spiral Isles

An original local-multiplayer party game for the browser. Up to four players (controllers or
keyboard, CPUs fill empty seats) travel a floating-island board, collect Gleam Chips, trade them
for Prism Relics and battle it out in minigames between rounds.

Built with TypeScript, Vite and Phaser 3. Environment art and the four heroes are modelled and
pre-rendered from code in Blender (see [Art pipeline](#art-pipeline)).

> Gleamtrail's world, rules, art and audio, and its four heroes, are original. The **guest
> characters** (Luffy, Goku, Naruto, Batman, Spider-Man, Iron Man, Sonic and SpongeBob) are fan-made
> models for private, non-commercial play at home; the characters belong to their respective owners.

## Play now

**In your browser:** <https://mattg241.github.io/mario-party-clone/> — Chrome or Edge recommended.
It is published from `main` by GitHub Actions (`.github/workflows/pages.yml`; one-time setup:
repository Settings → Pages → Source: *GitHub Actions*). Or run it yourself (below):
`npm install && npm run build && npm run preview`, then open <http://localhost:4173>.

**TVs and low-power devices.** Graphics switch to **Lite** automatically on TV browsers, low-memory
devices and anything that runs the title screen very slowly: every big image (board, characters,
arenas, stages) at half resolution, one small sky, the TV-friendly single-texture shader, no colour
grade and a steady 30 fps (about a quarter of the memory). Minigame arenas load with each minigame
in every mode, so only one is held at a time.
Force it with <https://mattg241.github.io/mario-party-clone/?lite> or **Settings → Graphics**. A
computer plugged into the TV still gives the best experience.

**Controllers.** Up to four at once, plus the keyboard:

- Xbox (One, Series, 360), PlayStation (DualShock 4, DualSense), Nintendo Switch Pro Controller
  and Joy-Cons, 8BitDo, Logitech and generic USB / Bluetooth pads all work.
- Connect or pair them, then **press a button on each** — browsers only reveal a controller once
  one of its buttons has been pressed on the page.
- Button prompts follow each player's controller: Xbox letters, PlayStation symbols or Nintendo
  letters. On Nintendo controllers the button labelled **A** confirms (Settings → Nintendo
  Controllers switches to the bottom button instead).
- If a controller's buttons do the wrong thing (usually a generic pad, or some pads in Firefox),
  open **Settings → Controller Button Setup** and press each button when asked. The layout is
  remembered for that controller; **Settings → Test Controllers** shows everything live.
- Adapters and arcade sticks work too — wireless receivers (Xbox Wireless Adapter, 8BitDo,
  Mayflash, Brook…) and zero-delay USB encoders show up as an Xbox, Switch or generic controller.
  If an adapter presents itself as a Switch controller while you hold an Xbox or PlayStation pad,
  set **Settings → Nintendo Controllers** to *Bottom confirms*.
- A controller that shows up twice (some adapters, DS4Windows, Steam) still takes only one seat.
- If Steam is running it may remap controllers (Steam Input); close Steam if a pad behaves oddly.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Requires Node 20+ and a WebGL-capable browser (Chrome, Edge, Firefox, Safari).

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build a production bundle into `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm test` | Unit tests (Vitest): rules, economy, board graph, input, save data |
| `npm run test:e2e` | Playwright smoke tests: boot to the title, join player 1, an all-CPU minigame to the podium and an all-CPU board match to the final results |
| `npm run typecheck` | TypeScript only |

The game must be served over HTTP (dev server or preview); opening `index.html` from disk will not
load the assets.

## How to play

1. **Title → Board Game** (or **Minigames**). Everyone presses **A** to join on the character
   select screen, browses the roster along the bottom (left/right) and picks with **A**; each pick
   stands on that player's pedestal. Empty seats can be filled by CPUs, who pick at random.
2. **Your turn:** optionally open your items (**Y**), then stop the **Orbit Dial** (**A**) and move
   1–10 spaces. At forks, tilt the stick toward the path you want.
3. **Spaces:** Gleam (+chips), Mischief (something sneaky), Festival (a lucky surprise), Market
   (buy items), Portal (warp), Relic Gate, Event and Start.
4. **Prism Relics:** pass Packsprout, the Relic Keeper, with 20 chips to buy a Relic. He moves to a
   new gate after every sale — follow the beam of light.
5. **Minigames:** every round ends with a minigame for everyone; placings pay 10 / 6 / 3 / 1 chips.
6. **Winning:** most Relics after the final round (chips break ties). Festival Awards hand out bonus
   Relics at the end.

The in-game **How to Play** screen covers the same ground with pictures.

### Controls

| Action | Controller (standard layout) | Keyboard (default) |
| --- | --- | --- |
| Move / choose | Left stick or D-pad | W A S D / arrow keys |
| Confirm, jump, stop the dial | A | Enter / Space |
| Back, duck | B | Esc / Backspace |
| Secondary action (dash, throw, grab) | X | E |
| Items | Y | Q |
| Bumpers / triggers | LB RB / LT RT | Z C / R F |
| Aim (twin-stick minigames) | Right stick | I J K L |
| Scores and map | View | Tab |
| Pause | Menu | P |

Keyboard keys can be rebound in **Settings → Keyboard Controls**. **Settings → Test Controllers**
shows every connected pad live (buttons, sticks with the dead-zone ring, triggers, rumble), and
**Settings → Controller Button Setup** records the layout of any controller the browser doesn't map
as standard. If a controller disconnects mid-game, play pauses until it is reconnected, another
free controller takes over (press A), or the player carries on with the keyboard.

### Minigames

| Minigame | Players | Idea |
| --- | --- | --- |
| Gleam Grab | 1–4 | Catch falling chips; dodge the wobbly fake capsules |
| Orbit Dodge | 1–4 | Jump the low arm, duck the high arm; last one standing |
| Crate Craze | 1–4 | Shove festival crates into your corner zone |
| Skybridge Scramble | 1–4 | Keep your footing as platforms shake and fall |
| Totem Tug | 2–4 (teams) | Alternate triggers on the beat to win the tug-of-war |
| Spiral Splash | 1–4 | Blast rivals off drifting lily pads |
| Relic Relay | 1–4 | Race your parcel through an obstacle course |
| Tumble Tower | 1–4 | Climb a tower of moving, tipping platforms |

Every minigame opens with an instruction card (rules, controls and a live preview); this can be
set to full, quick or off in Settings. **Minigame Mode** lets you play any of them on their own.

## Settings and accessibility

Master / music / effects volume, vibration, stick dead zone, screen shake, reduced motion, large
text, game speed (fast CPU turns and board animations), minigame instruction level, keyboard
rebinding, controller button setup, the Nintendo A/B layout and a full reset. Settings and the match in progress are saved in `localStorage`, so a
board game can be continued from the title screen.

## Debug tools

The overlay and board shortcuts below are available in development builds, or in production
builds opened with `?debug`; the URL shortcuts work in any build:

- **F2** — overlay with FPS, scene, match state and recent errors.
- **On the board:** F3 skip turn · F4 go to the minigame · F5 +20 chips · F6 random item ·
  F7 move to the relic · F8 finish the round.
- **URL shortcuts** (never reachable from menus):
  `?quick` starts a board match immediately; `?minigame=<id>` jumps into a minigame
  (`gleam-grab`, `orbit-dodge`, `crate-craze`, `skybridge-scramble`, `totem-tug`, `spiral-splash`,
  `relic-relay`, `tumble-tower`); `?scene=<Key>` opens any scene (e.g. `Settings`).
  Modifiers: `&humans=0..4`, `&players=2..4`, `&rounds=N`, `&seed=N`, `&cpu=easy|normal|hard`,
  `&instructions=on|quick|off`, `&intro`, `&midgame` (round 4 with players spread out) and
  `&realtime` (lock game time to wall time on slow software-GL machines, used by tests).

## Project layout

```
src/game/
  scenes/        Title, character select, setup, board (+ background and UI layers), minigame
                 intro, results, final results, settings, how to play, controller test, pause…
  board/         Board graph, turn flow (pure logic), presenter, movement, dial, AI, events
  minigames/     BaseMinigame, registry, metadata (MinigameManager) and games/*.ts
  input/         Gamepad + keyboard devices, player slots, virtual CPU controls
  state/         Match state, scoring, session
  effects/       Particles/VFX, colour-grade post pipeline
  ui/            HUD, panels, prompts (controller glyphs follow the active device), menus;
                 Style.ts holds the house style (white cards, calm slate HUD, slim outlines)
  data/          Characters, board definition, items, NPCs, rendered-asset metadata
scripts/
  art/           Blender (bpy) scripts that render the environment art
  build-sprites.mjs, build-placeholders.mjs   sprite atlas / placeholder generation
  dev/           capture.mjs and drive.mjs: headless screenshot helpers used during development;
                 record.mjs: frame-stepped gameplay recorder; trailer/: the promo trailer's shot
                 list, score (music.py), sound-effect renderer and edit (edit.py + edl.json)
tests/unit, tests/e2e
public/assets/   atlases, audio, rendered art (WebP) and manifests
```

Game rules (turn flow, economy, events, scoring) are plain TypeScript with no Phaser dependency, so
they are unit-tested directly; scenes only present them.

## Art pipeline

All environment art — the board terrain and landmarks, board spaces, skies, minigame arenas,
title/select/results stages and gameplay sprites — the four playable heroes and the five festival
NPCs are modelled and lit in code and rendered with Blender's Cycles renderer, then saved under
`public/assets/`. The characters are posed on a small skeleton for every animation and rendered with
the board's key light, so they share the world's lighting and materials. Nothing needs to be
re-rendered to run or build the game; the scripts are only needed to change the art.

Setup (Python 3.11 and the `bpy` wheel, no Blender install needed):

```bash
python3.11 -m venv .artenv
.artenv/bin/pip install bpy==4.2.0 numpy pillow scipy scikit-image triangle fonttools brotli skia-pathops
```

| Script | Output |
| --- | --- |
| `board.py --scale 1.25 --samples 64 --export` | Board terrain tiles, landmark sprites and manifest (`--props-only [--only id,…]` re-renders landmarks) |
| `island_shadow.py` | Soft island shadow layer for the board |
| `spaces.py` | The eight board space pieces |
| `sky.py --variant day\|clear\|golden\|sunset` | Sky backdrops |
| `scenes.py title\|select\|results\|orbit` | Title island, select and results stages, Orbit Dodge arena |
| `gleam3d.py` | Gleam Grab arena (perspective) and its floor mapping |
| `mg_arenas.py yard\|pond\|relay\|totem\|tower\|sprites\|islets\|fg` | Arenas and sprites for the other minigames, sky islets, board foreground foliage |
| `characters.py` | Every playable character: models (`char_models.py`, `char_<id>.py`), poses (`char_anims.py`), rendered and packed into `public/assets/atlases/hero_<id>.webp/.json` plus `src/game/data/heroSprites.generated.ts` (`--hero kip --anims idle --preview` for quick looks; `--hero luffy --pack-only` re-packs). A guest joins the roster once its sheet is packed |
| `logo.py` | The extruded 3D title wordmark (`ui_logo.webp`) |
| `orbit_arms.py`, `ui.py`, `blur_backdrops.py` | Orbit Dodge arm frames, the dial, blurred intro backdrops |
| `bloom.py` | Bakes a soft highlight bloom into finished renders |

Each arena is rendered through an orthographic (or measured perspective) camera whose ground plane
maps onto the game's screen coordinates, so gameplay layouts line up with the art exactly.

## Browser support and performance

Targets 1920×1080 (scaled to fit) at 60 fps on integrated graphics. Gamepads use the standard
Gamepad API mapping; rumble works where the browser supports it (Chromium-based browsers).

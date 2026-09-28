import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS } from '../../constants';
import { CHARACTERS } from '../../data/characters';
import type { VirtualControls } from '../../input/PlayerInput';
import { glyphKindFor, makeGlyph } from '../../ui/ControllerPrompt';
import { addText } from '../../ui/theme';
import { Random } from '../../util/Random';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { punch } from '../juice';
import { LITE } from '../../perf';
import { bakePortrait, bakeWord, calmMotion, liteCount, RingBursts, WordPops } from './stageKit';
import { generateTower, PLAY_X0, PLAY_X1, PX_PER_M, START_Y, SUMMIT_Y, TOWER_H, towerScore, type PlankKind } from './TumbleTowerLayout';

// --- World: the tower layout constants live in TumbleTowerLayout.ts (pure, unit-tested) ---------
/** Climbers can't leave the tower face. */
const WALL_L = PLAY_X0 - 30;
const WALL_R = PLAY_X1 + 30;
/** The parapet on the tower top rises this far above the summit walkway. */
const CROWN_RISE = 64;
/**
 * Plank art (`rendered-mg-plank`, fallback `tw-plank`): 260×60 px, walking surface 20 px from the
 * top (origin 0.5, 1/3), drawn as a 3-slice so the 55 px ends (brackets) keep their shape.
 */
const PLANK_TEX_H = 60;
const PLANK_SURFACE = 20;
const PLANK_END = 55;
/** Anchors of the rendered sprites (assets/rendered/mg/sprites.json), when loaded. */
type SpriteMeta = Record<string, { anchor?: [number, number]; scale?: number }>;
/** Tower wall art (`rendered-mg-tower-wall`, fallback `tw-wall`): 1920×1080, tiles vertically. */
const WALL_TILE_H = 1080;
/** Wall drum (fallback art): centre x and radius. */
const DRUM_X = 960;
const DRUM_R = 680;
/** Height signs on the wall every SIGN_EVERY metres. */
const SIGN_X = 344;
const SIGN_EVERY = 5;
// --- Movement ---------------------------------------------------------------------------------
const GRAVITY = 2700;
/** Jump launch speed: apex ≈ JUMP_V² / 2g = 216 px. */
const JUMP_V = 1080;
const RUN_SPEED = 440;
const GROUND_ACCEL = 4200;
const AIR_ACCEL = 2400;
const MAX_FALL = 1500;
/** Releasing A early cuts the rise (short hops). */
const JUMP_CUT = 0.45;
const COYOTE_MS = 95;
const BUFFER_MS = 130;
/** Landing tolerance past a plank end. */
const FOOT_HALF = 16;
const CHAR_SCALE = 0.56;
// --- Ledge grab -------------------------------------------------------------------------------
/** A ledge 16..160 px above your feet, with you beside its end (64 px out, 20 px in), can be grabbed. */
const GRAB_UP = 160;
const GRAB_DOWN = 16;
const GRAB_OUT = 64;
const GRAB_IN = 20;
const HANG_MS = 150;
const PULLUP_MS = 300;
/** Feet below the ledge while hanging. */
const HANG_DY = 70;
// --- Platforms --------------------------------------------------------------------------------
const TIP_WOBBLE_MS = 800;
const TIP_SWING_MS = 240;
const TIP_HOLD_MS = 1300;
const TIP_RETURN_MS = 520;
const TIP_ANGLE = 58;
const CRUMBLE_MS = 750;
const CRUMBLE_RESPAWN_MS = 3200;
// --- Camera + rescue --------------------------------------------------------------------------
/** The highest climber is kept this far down the screen (fraction of the height). */
const CAM_LEAD = 0.42;
const CAM_RATE = 3.2;
/** Highest the camera goes (summit ledge ~40% down the screen). */
const CAM_TOP = SUMMIT_Y - 430;
const BUBBLE_DELAY = 600;
const BUBBLE_RISE = 1000;
/** Height gauge on the right edge (fixed): x, and screen y of 0 m and of the summit. */
const GAUGE_X = 1872;
const GAUGE_Y0 = 1000;
const GAUGE_Y1 = 250;
/**
 * Portrait markers ride the gauge in two staggered columns (P1 and P3 left of the rail, P2 and P4
 * right), so climbers at the same height sit side by side: radius, column offset, and the closest
 * two in one column may sit before they're nudged apart.
 */
const MARK_R = 21;
const MARK_DX = 17;
const MARK_GAP = 44;
/** Two portraits only swap places once one is clearly past the other (px), so they don't jitter. */
const MARK_HYST = 18;
// --- Feel -------------------------------------------------------------------------------------
/** Falling faster than this (px/s) whooshes and trails speed streaks. */
const FALL_FX_V = 900;
const FALL_TRAIL_V = 650;
/** A ledge caught while falling is a SAVE: a person's freezes the frame for a blink. */
const SAVE_STOP_MS = 55;
/** Landing this far below your best counts as a fall: beating that best again is a NEW BEST. */
const FALL_LOSS = 300;
/** The final stretch: the leader climbs in a shaft of light. */
const FINAL_MS = 10000;
/** World-space pop-ups stay under the HUD band (depth 8000+ is pinned to the screen). */
const POP_DEPTH = 7000;
/** Pop-up words, baked once (stageKit.bakeWord). */
const WORDS = {
  save: { key: 'tw-w-save', text: 'SAVE!', size: 46, fill: ['#e9fff2', '#6fe3a0'] },
  best: { key: 'tw-w-best', text: 'NEW BEST!', size: 42, fill: ['#fff6c4', '#ffbf2a'] },
  m10: { key: 'tw-w-10', text: '10 m!', size: 42, fill: ['#ffffff', '#ffe08a'] },
  m20: { key: 'tw-w-20', text: '20 m!', size: 42, fill: ['#ffffff', '#ffe08a'] },
  m30: { key: 'tw-w-30', text: '30 m!', size: 44, fill: ['#ffffff', '#ffd05a'] },
  m40: { key: 'tw-w-40', text: '40 m!', size: 46, fill: ['#ffffff', '#ffc13a'] },
} as const;
const MILESTONE_WORDS = [WORDS.m10, WORDS.m20, WORDS.m30, WORDS.m40] as const;

type PlatKind = PlankKind;
type PlatState = 'idle' | 'wobble' | 'swing' | 'hold' | 'return' | 'crack' | 'gone';

interface Plat {
  id: number;
  kind: PlatKind;
  /** Centre x and walking-surface y (world). */
  x: number;
  y: number;
  w: number;
  baseX: number;
  amp: number;
  period: number;
  phase: number;
  /** Horizontal movement this frame (carries riders). */
  dx: number;
  state: PlatState;
  t: number;
  angle: number;
  tipDir: -1 | 1;
  /** Creaks already played in this wobble (the telegraph rises to the tip). */
  creaks: number;
  grabRow: boolean;
  /** On the guaranteed route (rescue bubbles only drop players there). */
  main: boolean;
  view: Phaser.GameObjects.Container;
  plank: Phaser.GameObjects.NineSlice | null;
}

type ClimbState = 'normal' | 'climb' | 'wait' | 'bubble' | 'summit';

interface Brain {
  target: Plat | null;
  retarget: number;
  jumpAt: number;
  holdA: boolean;
  aimErr: number;
  willGrab: boolean;
  grabAt: number;
  takeoffY: number;
  /** Plank jumped from, plank stood on last frame, failed attempts at the current target. */
  fromPlat: Plat | null;
  lastOn: Plat | null;
  fails: number;
  avoid: Plat | null;
  avoidUntil: number;
  pauseUntil: number;
}

interface Climber {
  p: MgPlayer;
  c: Character;
  x: number;
  y: number;
  vx: number;
  vy: number;
  on: Plat | null;
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  state: ClimbState;
  t: number;
  grab: { plat: Plat; side: -1 | 1; fromX: number; fromY: number } | null;
  /** Best standing height (px above the floor) and when it was reached. */
  best: number;
  bestAt: number;
  air: 'rise' | 'fall' | null;
  bubble: Phaser.GameObjects.Image;
  rescue: Plat | null;
  rescueX: number;
  rescueDX: number;
  /** Just dropped by a rescue bubble: that landing doesn't count as height reached. */
  carried: boolean;
  hint: Phaser.GameObjects.Container | null;
  speed: number;
  jumpV: number;
  ai: Brain;
  /** Height-meter portrait: its true screen y, the nudged-apart y and the y it's easing to. */
  mark: Phaser.GameObjects.Image;
  markT: number;
  markR: number;
  markY: number;
  /** The best to beat after a fall (0 = none pending): beating it again flashes NEW BEST. */
  fellBest: number;
  /** New-best flash on the meter (1 → 0). */
  bestFlash: number;
  /** Already whooshed on this fall. */
  fallFx: boolean;
}

interface LedgeHit {
  plat: Plat;
  side: -1 | 1;
}

/**
 * Pin a UI object to the screen: scroll factor 0, including the circular geometry masks of the HUD
 * portraits (their mask graphics live outside the display list, in screen coordinates).
 */
function pinToScreen(o: Phaser.GameObjects.GameObject): void {
  const sf = o as unknown as { setScrollFactor?: (x: number, y?: number) => unknown };
  sf.setScrollFactor?.(0, 0);
  const masked = o as unknown as { mask?: { geometryMask?: Phaser.GameObjects.Graphics } | null };
  masked.mask?.geometryMask?.setScrollFactor(0, 0);
  if (o instanceof Phaser.GameObjects.Container) for (const child of o.list) pinToScreen(child);
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
}

/**
 * Tumble Tower — race up a tall tower of planks. Jump (A) up through planks, grab ledges (X),
 * ride moving planks and get off tipping ones before they dump you. Fall off the screen and a
 * bubble carries you back up. Highest climber after 50 seconds wins.
 */
export class TumbleTowerScene extends BaseMinigame {
  private plats: Plat[] = [];
  private climbers: Climber[] = [];
  private clock = 0;
  private camY = 0;
  private summits = 0;
  private wall!: Phaser.GameObjects.TileSprite;
  private altTint!: Phaser.GameObjects.Graphics;
  private gaugeG!: Phaser.GameObjects.Graphics;
  private summitFlag!: Phaser.GameObjects.Graphics;
  private pops!: WordPops;
  private rings!: RingBursts;
  /** Per-frame world-space drawing: fall streaks, tipping-plank warnings. */
  private fallG!: Phaser.GameObjects.Graphics;
  private hazardG!: Phaser.GameObjects.Graphics;
  /** Meter portraits per column, sorted top to bottom (reused every frame). */
  private markCols: [Climber[], Climber[]] = [[], []];
  /** The final stretch's spotlight on the leader. */
  private shaft!: Phaser.GameObjects.Image;
  private shaftGlow!: Phaser.GameObjects.Image;
  private leader: Climber | null = null;

  constructor() {
    super('mg-tumble-tower');
  }

  // --- Setup -----------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 50000;
    this.plats = [];
    this.climbers = [];
    this.clock = 0;
    this.camY = 0;
    this.summits = 0;
    this.markCols = [[], []];
    this.leader = null;
    this.cameras.main.setScroll(0, 0);
    for (const w of Object.values(WORDS)) bakeWord(this, w.key, w.text, { size: w.size, fill: w.fill });
    this.buildBackdrop();
    this.buildTower();
    this.buildTracks();
    this.buildSigns();
    this.pops = new WordPops(this, POP_DEPTH, 12);
    this.rings = new RingBursts(this, 8);
    this.fallG = this.add.graphics().setDepth(250);
    this.hazardG = this.add.graphics().setDepth(6800);
    this.shaft = this.add.image(960, START_Y, 'fx-shaft').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe6a0).setAlpha(0).setDepth(290);
    this.shaft.setDisplaySize(230, 940);
    this.shaftGlow = this.add.image(960, START_Y, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd36b).setAlpha(0).setDepth(295);
    this.shaftGlow.setDisplaySize(230, 60);
    this.gaugeG = this.add.graphics().setDepth(8100).setScrollFactor(0);
    const labels: Phaser.GameObjects.Text[] = [];
    for (let m = 0; m <= 50; m += 10) {
      const y = GAUGE_Y0 + (GAUGE_Y1 - GAUGE_Y0) * (m / 50);
      labels.push(addText(this, GAUGE_X - 34, y, `${m}`, 18, { color: CSS.creamDark, weight: 700, stroke: '#06141a', strokeThickness: 4, align: 'right' }));
    }
    for (const l of labels) l.setDepth(8101).setScrollFactor(0);
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const x = 960 + (index - (n - 1) / 2) * 150;
    const c = new Character(this, x, START_Y, p.characterId, { scale: CHAR_SCALE, slot: p.slot });
    c.face(x > 960).setDepth(300 + index);
    p.character = c;
    const bubble = this.add.image(x, START_Y, this.bubbleKey()).setDepth(320 + index).setVisible(false);
    let hint: Phaser.GameObjects.Container | null = null;
    if (!p.isCpu) {
      hint = this.add.container(0, 0).setDepth(6500).setVisible(false);
      const glyph = makeGlyph(this, 'X', 46, glyphKindFor(p.slot));
      const ring = this.add.graphics();
      ring.lineStyle(4, PLAYER_COLORS[p.slot], 0.95);
      ring.strokeCircle(0, 0, 34);
      hint.add([ring, glyph]);
    }
    const h = CHARACTERS[p.characterId].handling;
    this.climbers.push({
      p,
      c,
      x,
      y: START_Y,
      vx: 0,
      vy: 0,
      on: this.plats[0],
      coyote: 0,
      buffer: 0,
      jumpHeld: false,
      state: 'normal',
      t: 0,
      grab: null,
      best: 0,
      bestAt: 0,
      air: null,
      bubble,
      rescue: null,
      rescueX: x,
      rescueDX: 0,
      carried: false,
      hint,
      speed: RUN_SPEED * h.speed,
      jumpV: JUMP_V * (1 + (h.jump - 1) * 0.3),
      ai: { target: null, retarget: 0, jumpAt: -1, holdA: false, aimErr: 0, willGrab: false, grabAt: -1, takeoffY: START_Y, fromPlat: null, lastOn: null, fails: 0, avoid: null, avoidUntil: 0, pauseUntil: 0 },
      mark: this.add.image(GAUGE_X, GAUGE_Y0, bakePortrait(this, p.characterId, p.slot, MARK_R)).setDepth(8102 + index * 0.01).setScrollFactor(0),
      markT: GAUGE_Y0,
      markR: GAUGE_Y0,
      markY: GAUGE_Y0,
      fellBest: 0,
      bestFlash: 0,
      fallFx: false,
    });
    this.markCols[p.slot % 2].push(this.climbers[this.climbers.length - 1]);
  }

  protected override onStart(): void {
    audio.play('whoosh', { volume: 0.5 });
    if (this.humanSlots().length === 0) return;
    // Quick reminder once GO! has cleared.
    const t = addText(this, 960, 250, 'A: jump up through planks  ·  X: grab a ledge', 36, { color: CSS.cream, stroke: '#06141a', strokeThickness: 7, weight: 700, fixed: true });
    const back = this.add.graphics().setDepth(8799).setScrollFactor(0);
    back.fillStyle(0x06141a, 0.55);
    back.fillRoundedRect(960 - t.width / 2 - 28, 250 - 30, t.width + 56, 60, 30);
    t.setDepth(8800).setScrollFactor(0);
    for (const o of [t, back]) {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, delay: 700, duration: 250 });
      this.tweens.add({ targets: o, alpha: 0, delay: 3600, duration: 500, onComplete: () => o.destroy() });
    }
  }

  // --- Backdrop --------------------------------------------------------------------------------
  /** Sky, altitude tint, parallax islands and clouds, and the tiling tower wall. */
  private buildBackdrop(): void {
    if (this.textures.exists('rendered-sky-day')) this.add.image(GAME_WIDTH / 2, 540, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.04, 1124).setScrollFactor(0).setDepth(-100);
    else {
      const sky = this.add.graphics().setDepth(-100).setScrollFactor(0);
      sky.fillGradientStyle(0x5aa8f0, 0x5aa8f0, 0xd4eeff, 0xd4eeff, 1);
      sky.fillRect(0, 0, GAME_WIDTH, 1080);
    }
    // Higher up the sky deepens.
    this.altTint = this.add.graphics().setDepth(-96).setScrollFactor(0).setAlpha(0);
    this.altTint.fillGradientStyle(0x28408e, 0x28408e, 0x5a7fd0, 0x5a7fd0, 0.9, 0.9, 0, 0);
    this.altTint.fillRect(0, 0, GAME_WIDTH, 1080);
    this.ensureParallaxTextures();
    // Distant floating islands at the sides (slow parallax), then clouds (faster).
    const rng = new Random(4242);
    const span = -CAM_TOP;
    for (let i = 0; i < 14; i++) {
      const sf = rng.range(0.07, 0.2);
      const left = i % 2 === 0;
      const x = left ? rng.range(-40, 260) : rng.range(1660, 1960);
      const level = (i / 13) * span + rng.range(-150, 150);
      // Rendered sky islets when available, else the painted fallback islands.
      const islet = `rendered-islet-${i % 3}`;
      const key = this.textures.exists(islet) ? islet : rng.chance(0.5) ? 'tw-island-a' : 'tw-island-b';
      const img = this.add.image(x, 520 - level * sf + rng.range(-200, 200), key);
      const k = 0.35 + sf * 3;
      img.setScale(k).setScrollFactor(1, sf).setDepth(-90 + sf).setFlipX(!left);
      img.setTint(Phaser.Display.Color.GetColor(200 + sf * 250, 220 + sf * 150, 255));
      this.tweens.add({ targets: img, y: img.y - 14, duration: 2600 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    for (let i = 0; i < 16; i++) {
      const sf = rng.range(0.28, 0.5);
      const left = i % 2 === 1;
      const x = left ? rng.range(-120, 300) : rng.range(1620, 2040);
      const level = (i / 15) * span + rng.range(-200, 200);
      const img = this.add.image(x, 540 - level * sf + rng.range(-250, 250), 'tw-cloud');
      img.setScale(rng.range(0.7, 1.3)).setScrollFactor(1, sf).setDepth(-80 + sf).setAlpha(0.85);
      this.tweens.add({ targets: img, x: img.x + (left ? 40 : -40), duration: 7000 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const key = this.textures.exists('rendered-mg-tower-wall') ? 'rendered-mg-tower-wall' : this.ensureWallTexture();
    this.wall = this.add.tileSprite(0, 0, GAME_WIDTH, 1080, key).setOrigin(0).setScrollFactor(0).setDepth(-50);
    // Rendered wall tiles every 1080 px; scale if the supplied image has another height.
    const src = this.textures.get(key).getSourceImage() as { height: number };
    if (src.height && src.height !== WALL_TILE_H) this.wall.setTileScale(1080 / src.height);
  }

  // --- Tower -----------------------------------------------------------------------------------
  private addPlat(kind: PlatKind, x: number, y: number, w: number, grabRow = false, main = true): Plat {
    const q: Plat = {
      id: this.plats.length,
      kind,
      x,
      y,
      w,
      baseX: x,
      amp: 0,
      period: 3,
      phase: 0,
      dx: 0,
      state: 'idle',
      t: 0,
      angle: 0,
      tipDir: 1,
      creaks: 0,
      grabRow,
      main,
      view: this.add.container(x, y).setDepth(kind === 'ground' ? 90 : 100),
      plank: null,
    };
    this.plats.push(q);
    return q;
  }

  /** Planks from the seeded layout (see TumbleTowerLayout.generateTower). */
  private buildTower(): void {
    for (const spec of generateTower(this.rng)) {
      const q = this.addPlat(spec.kind, spec.x, spec.y, spec.w, spec.grabRow, spec.main);
      q.amp = spec.amp;
      q.period = spec.period;
      q.phase = spec.phase;
    }
    for (const q of this.plats) this.buildPlatView(q);
  }

  /**
   * Moving planks show their whole run: a faint crystal rail behind the plank from end stop to end
   * stop, so you can see where it's going before you jump.
   */
  private buildTracks(): void {
    const g = this.add.graphics().setDepth(95);
    for (const q of this.plats) {
      if (q.kind !== 'moving' || q.amp <= 0) continue;
      const x0 = q.baseX - q.amp - q.w / 2 + 16;
      const x1 = q.baseX + q.amp + q.w / 2 - 16;
      const y = q.y + 10;
      g.lineStyle(6, 0x0b3a4a, 0.28);
      g.lineBetween(x0, y + 2, x1, y + 2);
      for (let x = x0; x < x1; x += 26) {
        g.lineStyle(4, COLORS.crystal, 0.5);
        g.lineBetween(x, y, Math.min(x1, x + 14), y);
      }
      for (const ex of [x0, x1]) {
        g.fillStyle(0x0b3a4a, 0.5);
        g.fillRoundedRect(ex - 5, y - 13, 10, 26, 4);
        g.fillStyle(COLORS.crystal, 0.85);
        g.fillRoundedRect(ex - 3, y - 11, 6, 22, 3);
      }
    }
  }

  private plankKey(): string {
    if (this.textures.exists('rendered-mg-plank')) return 'rendered-mg-plank';
    this.ensurePlankTexture();
    return 'tw-plank';
  }

  private buildPlatView(q: Plat): void {
    const v = q.view;
    const back = this.add.graphics();
    const front = this.add.graphics();
    const w = q.w;
    if (q.kind === 'ground') {
      // Tower foot: grassy stone floor.
      back.fillStyle(0x6b6258, 1);
      back.fillRect(-w / 2, 0, w, 260);
      for (let r = 0; r < 5; r++) {
        for (let i = 0; i < 16; i++) {
          const bx = -w / 2 + i * (w / 16) + (r % 2) * (w / 32);
          back.fillStyle(r % 2 === 0 ? 0xa39a8c : 0x958c7e, 1);
          back.fillRoundedRect(bx + 3, 30 + r * 46, w / 16 - 6, 40, 6);
        }
      }
      back.fillStyle(0x6cc24a, 1);
      back.fillRect(-w / 2, -4, w, 26);
      back.fillStyle(0x9be06e, 1);
      back.fillRect(-w / 2, -6, w, 8);
      for (let i = 0; i < 90; i++) {
        const gx = -w / 2 + ((i * 97) % w);
        back.fillStyle(i % 2 ? 0x8bd346 : 0x5aa944, 1);
        back.fillTriangle(gx - 5, 2, gx + 5, 2, gx + ((i % 3) - 1) * 4, -12 - (i % 4) * 3);
      }
      v.add(back);
      return;
    }
    if (q.kind === 'summit') {
      // The tower's top: a battlemented parapet behind the walkway (the wall art stops here).
      v.setDepth(94);
      const R = DRUM_R;
      const x0 = DRUM_X - R - q.x;
      const merlons = 15;
      const mw = (2 * R) / merlons;
      for (let i = 0; i < merlons; i++) {
        if (i % 2 === 1) continue;
        const mx = x0 + i * mw;
        const shade = 0.75 + 0.25 * Math.cos(((i + 0.5) / merlons - 0.5) * Math.PI);
        const c = Phaser.Display.Color.GetColor(Math.round(226 * shade), Math.round(214 * shade), Math.round(192 * shade));
        back.fillStyle(0x06141a, 0.2);
        back.fillRect(mx + 6, -CROWN_RISE + 6, mw, CROWN_RISE);
        back.fillStyle(c, 1);
        back.fillRoundedRect(mx, -CROWN_RISE, mw, CROWN_RISE + 10, { tl: 8, tr: 8, bl: 0, br: 0 });
        back.fillStyle(0xffffff, 0.25);
        back.fillRect(mx + 4, -CROWN_RISE + 4, mw - 8, 5);
      }
      // Parapet wall between the merlons and the walkway slab.
      back.fillStyle(0xb8ab94, 1);
      back.fillRect(x0, -CROWN_RISE * 0.45, 2 * R, CROWN_RISE * 0.45 + 4);
      back.fillStyle(0xe8dcc6, 1);
      back.fillRect(x0 - 10, 0, 2 * R + 20, 30);
      back.fillStyle(0x9d907a, 1);
      back.fillRect(x0 - 10, 30, 2 * R + 20, 14);
      back.fillStyle(0x06141a, 0.22);
      back.fillRect(x0, 44, 2 * R, 10);
      front.fillStyle(0xf4b83b, 1);
      front.fillRect(x0 - 10, -3, 2 * R + 20, 7);
      front.fillStyle(0xffe08a, 1);
      front.fillRect(x0 - 10, -3, 2 * R + 20, 3);
      v.add([back, front]);
      this.summitFlag = this.add.graphics().setDepth(93);
      return;
    }
    // Supports behind the plank.
    if (q.kind === 'moving') {
      // Floating plank: a glowing crystal keeps it aloft.
      back.fillStyle(0x5ce1ff, 0.25);
      back.fillCircle(0, 44, 30);
      back.fillStyle(0x1b6f8a, 1);
      back.fillTriangle(-16, 22, 16, 22, 0, 70);
      back.fillStyle(0x5ce1ff, 1);
      back.fillTriangle(-11, 22, 11, 22, 0, 62);
      back.fillStyle(0xe6fbff, 1);
      back.fillTriangle(-5, 24, 3, 24, -1, 44);
    } else if (q.kind === 'tipping') {
      // Single pivot: a fixed beam into the wall (it doesn't turn with the plank) and a brass hub.
      const beam = this.add.graphics({ x: q.x, y: q.y }).setDepth(99);
      beam.fillStyle(0x06141a, 0.18);
      beam.fillRect(-6, 20, 20, 64);
      beam.fillStyle(0x4a2c10, 1);
      beam.fillRect(-9, 10, 18, 70);
      beam.fillStyle(0x7a4f22, 1);
      beam.fillRect(-5, 10, 8, 70);
      beam.fillStyle(0x3a3f4a, 1);
      beam.fillRoundedRect(-16, 72, 32, 14, 4);
    } else {
      for (const s of [-1, 1]) {
        const bx = s * (w / 2 - 44);
        back.fillStyle(0x4a2c10, 1);
        back.fillTriangle(bx - 12, 20, bx + 12, 20, bx - 12 * s * -1, 74);
        back.fillStyle(0x8a5a30, 1);
        back.fillTriangle(bx - 8, 22, bx + 8, 22, bx + 8 * s, 64);
      }
    }
    const key = this.plankKey();
    const texH = (this.textures.get(key).getSourceImage() as { height: number }).height || PLANK_TEX_H;
    const plank = this.add.nineslice(0, 0, key, undefined, w + 20, texH, PLANK_END, PLANK_END, 0, 0);
    const anchor = key === 'tw-plank' ? undefined : (this.cache.json.get('rendered-mg-sprites') as SpriteMeta | undefined)?.plank?.anchor;
    plank.setOrigin(0.5, anchor ? anchor[1] : PLANK_SURFACE / PLANK_TEX_H);
    q.plank = plank;
    if (q.kind === 'crumble') {
      plank.setTint(0xe8d2a8);
      front.lineStyle(2.5, 0x5a3a18, 0.85);
      for (let i = 0; i < 4; i++) {
        const cx = -w / 2 + ((i + 0.6) * w) / 4.4;
        front.beginPath();
        front.moveTo(cx, 3);
        front.lineTo(cx + 7, 11);
        front.lineTo(cx - 3, 18);
        front.lineTo(cx + 5, 25);
        front.strokePath();
      }
    }
    if (q.kind === 'tipping') {
      // Hazard chevrons on the front face and the pivot hub.
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const cx = i * (w / 8);
        front.fillStyle(0xff5a4a, 0.9);
        front.fillTriangle(cx - 9, 6, cx + 9, 6, cx + (i > 0 ? 14 : -14), 16);
      }
      front.fillStyle(0x4a2c10, 1);
      front.fillCircle(0, 16, 11);
      front.fillStyle(COLORS.gold, 1);
      front.fillCircle(0, 16, 8);
      front.fillStyle(0xfff0b0, 1);
      front.fillCircle(-2, 14, 3);
    }
    if (q.kind === 'moving') {
      front.fillStyle(0x5ce1ff, 0.9);
      for (const s of [-1, 1]) front.fillTriangle(s * (w / 2 - 20), 10, s * (w / 2 - 34), 4, s * (w / 2 - 34), 16);
    }
    if (q.grabRow) {
      // Brass grab handles at both ends: this ledge is too tall to jump — grab it.
      for (const s of [-1, 1]) {
        const hx = s * (w / 2 + 4);
        front.fillStyle(0x4a2c10, 1);
        front.fillRoundedRect(hx - 7, -6, 14, 30, 6);
        front.fillStyle(COLORS.gold, 1);
        front.fillRoundedRect(hx - 4, -4, 8, 26, 4);
        front.fillStyle(0xfff0b0, 1);
        front.fillRect(hx - 2, -2, 2, 20);
      }
    }
    v.add([back, plank, front]);
  }

  /** Painted height signs on the tower every few metres. */
  private buildSigns(): void {
    for (let m = SIGN_EVERY; m < TOWER_H / PX_PER_M; m += SIGN_EVERY) {
      const y = START_Y - m * PX_PER_M;
      const g = this.add.graphics().setDepth(60);
      g.fillStyle(0x06141a, 0.25);
      g.fillRoundedRect(SIGN_X - 44 + 4, y - 22 + 5, 88, 44, 10);
      g.fillStyle(0x7a4f22, 1);
      g.fillRoundedRect(SIGN_X - 44, y - 22, 88, 44, 10);
      g.fillStyle(0xa8743f, 1);
      g.fillRoundedRect(SIGN_X - 40, y - 19, 80, 36, 8);
      g.fillStyle(0x4a2c10, 1);
      g.fillCircle(SIGN_X - 32, y, 3);
      g.fillCircle(SIGN_X + 32, y, 3);
      addText(this, SIGN_X, y, `${m} m`, 22, { color: '#fff4dc', weight: 700, stroke: '#4a2c10', strokeThickness: 4 }).setDepth(61);
    }
  }

  // --- Platforms -------------------------------------------------------------------------------
  private platXAt(q: Plat, clockMs: number): number {
    if (q.kind !== 'moving') return q.x;
    return q.baseX + q.amp * Math.sin((Math.PI * 2 * (clockMs / 1000)) / q.period + q.phase);
  }

  private solid(q: Plat): boolean {
    if (q.kind === 'tipping') return q.state === 'idle' || q.state === 'wobble';
    if (q.kind === 'crumble') return q.state === 'idle' || q.state === 'crack';
    return true;
  }

  /** Moving planks slide every frame (also during the countdown). */
  private movePlats(): void {
    for (const q of this.plats) {
      if (q.kind !== 'moving') continue;
      const nx = this.platXAt(q, this.clock);
      q.dx = nx - q.x;
      q.x = nx;
    }
  }

  private ridersOf(q: Plat): Climber[] {
    return this.climbers.filter((cl) => cl.on === q && cl.state === 'normal');
  }

  private updatePlatStates(dt: number): void {
    for (const q of this.plats) {
      if (q.kind === 'tipping') this.updateTipping(q, dt);
      else if (q.kind === 'crumble') this.updateCrumble(q, dt);
    }
  }

  private updateTipping(q: Plat, dt: number): void {
    q.t += dt;
    switch (q.state) {
      case 'idle':
        q.angle = 0;
        if (this.ridersOf(q).length > 0) {
          q.state = 'wobble';
          q.t = 0;
          q.creaks = 0;
          audio.play('crack', { volume: 0.25, throttleMs: 200 });
        }
        break;
      case 'wobble': {
        // Telegraph: an ever-faster rattle, louder creaks and grit spilling from the pivot.
        const k = q.t / TIP_WOBBLE_MS;
        q.angle = Math.sin(q.t * (0.03 + 0.05 * k)) * (1.5 + 3 * k);
        if (q.creaks < 2 && q.t >= 330 + q.creaks * 290) {
          q.creaks++;
          audio.play('crack', { volume: 0.28 + 0.1 * q.creaks, throttleMs: 120 });
        }
        if (Math.random() < dt / ((LITE ? 220 : 110) * (1.2 - k))) this.fx.vfx('dust', q.x + (Math.random() - 0.5) * 20, q.y + 30, { scale: 0.12, duration: 320, alpha: 0.55, dy: 26, depth: 260 });
        if (q.t >= TIP_WOBBLE_MS) {
          const riders = this.ridersOf(q);
          const bias = riders.reduce((a, cl) => a + (cl.x - q.x), 0);
          q.tipDir = bias === 0 ? (Math.random() < 0.5 ? -1 : 1) : bias > 0 ? 1 : -1;
          q.state = 'swing';
          q.t = 0;
          audio.play('whoosh', { volume: 0.45 });
          this.fx.vfx('dust', q.x + q.tipDir * 30, q.y + 16, { scale: 0.3, duration: 380, alpha: 0.7, dx: q.tipDir * 30, depth: 260 });
          for (const cl of riders) {
            cl.on = null;
            cl.vx = q.tipDir * 300;
            cl.vy = -140;
            cl.c.play('surprised', { force: true });
          }
        }
        break;
      }
      case 'swing':
        q.angle = q.tipDir * TIP_ANGLE * Math.min(1, (q.t / TIP_SWING_MS) ** 2);
        if (q.t >= TIP_SWING_MS) {
          q.state = 'hold';
          q.t = 0;
        }
        break;
      case 'hold':
        q.angle = q.tipDir * TIP_ANGLE + Math.sin(q.t / 60) * 2 * Math.max(0, 1 - q.t / 400);
        if (q.t >= TIP_HOLD_MS) {
          q.state = 'return';
          q.t = 0;
        }
        break;
      case 'return': {
        const u = Math.min(1, q.t / TIP_RETURN_MS);
        q.angle = q.tipDir * TIP_ANGLE * (1 - Phaser.Math.Easing.Back.Out(u));
        if (u >= 1) {
          q.state = 'idle';
          q.t = 0;
          q.angle = 0;
        }
        break;
      }
      default:
        break;
    }
  }

  private updateCrumble(q: Plat, dt: number): void {
    q.t += dt;
    if (q.state === 'idle') {
      if (this.ridersOf(q).length > 0) {
        q.state = 'crack';
        q.t = 0;
        audio.play('crack', { volume: 0.35, throttleMs: 200 });
      }
    } else if (q.state === 'crack') {
      if (Math.random() < 0.25) this.fx.vfx('dust', q.x + (Math.random() - 0.5) * q.w, q.y + 20, { scale: 0.14, duration: 300, alpha: 0.5, depth: 260 });
      if (q.t >= CRUMBLE_MS) {
        q.state = 'gone';
        q.t = 0;
        audio.play('crack', { volume: 0.5 });
        this.fx.vfx('smoke', q.x, q.y + 10, { scale: 0.5, duration: 520, alpha: 0.7, depth: 260 });
        for (const cl of this.ridersOf(q)) {
          cl.on = null;
          cl.vy = 0;
        }
        this.tweens.add({ targets: q.view, alpha: 0, y: q.y + 140, angle: (Math.random() - 0.5) * 30, duration: 520, ease: 'Quad.In' });
      }
    } else if (q.state === 'gone' && q.t >= CRUMBLE_RESPAWN_MS) {
      q.state = 'idle';
      q.t = 0;
      this.tweens.killTweensOf(q.view);
      q.view.setPosition(q.x, q.y).setAngle(0).setAlpha(0);
      this.tweens.add({ targets: q.view, alpha: 1, duration: 300 });
    }
  }

  // --- Climbers --------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.updatePlatStates(dt);
    for (const cl of this.climbers) {
      if (cl.state === 'normal') this.updateNormal(cl, dt);
      else if (cl.state === 'climb') this.updateClimb(cl, dt);
    }
    this.updateCamera(dt / 1000);
    this.updateRescue(dt);
    this.syncVisuals(dt);
  }

  private updateNormal(cl: Climber, dt: number): void {
    const s = dt / 1000;
    const c = cl.p.controls;
    const mx = Math.abs(c.moveX) > 0.2 ? c.moveX : 0;
    cl.vx = approach(cl.vx, mx * cl.speed, (cl.on ? GROUND_ACCEL : AIR_ACCEL) * s);
    if (c.pressed('A')) cl.buffer = BUFFER_MS;
    else cl.buffer = Math.max(0, cl.buffer - dt);
    if (cl.on) cl.coyote = COYOTE_MS;
    else cl.coyote = Math.max(0, cl.coyote - dt);
    if (cl.buffer > 0 && cl.coyote > 0) this.jump(cl);
    if (cl.jumpHeld && !c.held('A')) {
      if (cl.vy < 0) cl.vy *= JUMP_CUT;
      cl.jumpHeld = false;
    }
    if (!cl.on && c.pressed('X')) {
      const lg = this.findLedge(cl);
      if (lg) {
        this.startClimb(cl, lg);
        return;
      }
    }
    const prevY = cl.y;
    if (cl.on) {
      const q = cl.on;
      cl.x += cl.vx * s + q.dx;
      if (!this.solid(q) || cl.x < q.x - q.w / 2 - FOOT_HALF || cl.x > q.x + q.w / 2 + FOOT_HALF) cl.on = null;
      else cl.y = q.y;
    }
    if (!cl.on) {
      // Trapezoid step: exact under constant gravity, so the jump arc doesn't depend on frame rate.
      const vy0 = cl.vy;
      cl.vy = Math.min(MAX_FALL, cl.vy + GRAVITY * s);
      cl.x += cl.vx * s;
      cl.y += ((vy0 + cl.vy) / 2) * s;
      if (cl.vy >= 0) {
        let hit: Plat | null = null;
        for (const q of this.plats) {
          if (!this.solid(q)) continue;
          if (cl.x < q.x - q.w / 2 - FOOT_HALF || cl.x > q.x + q.w / 2 + FOOT_HALF) continue;
          if (prevY <= q.y + 2 && cl.y >= q.y && (!hit || q.y < hit.y)) hit = q;
        }
        if (hit) this.land(cl, hit);
      }
    }
    if (cl.x < WALL_L) {
      cl.x = WALL_L;
      cl.vx = Math.max(0, cl.vx);
    } else if (cl.x > WALL_R) {
      cl.x = WALL_R;
      cl.vx = Math.min(0, cl.vx);
    }
    // A long drop whistles past (once per fall).
    if (!cl.on && cl.vy > FALL_FX_V && !cl.fallFx) {
      cl.fallFx = true;
      audio.play('whoosh', { volume: 0.32, throttleMs: 150 });
    }
  }

  private jump(cl: Climber): void {
    cl.vy = -cl.jumpV;
    cl.on = null;
    cl.coyote = 0;
    cl.buffer = 0;
    cl.jumpHeld = true;
    cl.air = null;
    cl.ai.takeoffY = cl.y;
    cl.c.squash(-0.12, 140);
    audio.play('jump', { volume: 0.35, rate: 0.9 + Math.random() * 0.2, throttleMs: 40 });
    this.fx.vfx('dust', cl.x, cl.y, { scale: 0.16, duration: 260, alpha: 0.55, depth: 260 });
  }

  private land(cl: Climber, q: Plat): void {
    const impact = cl.vy;
    cl.y = q.y;
    cl.vy = 0;
    cl.on = q;
    cl.air = null;
    cl.jumpHeld = false;
    cl.c.squash(Math.min(0.24, 0.12 + impact / 9000), 150);
    if (impact > 450) {
      audio.play('land', { volume: Math.min(0.5, impact / 2400), throttleMs: 50 });
      this.fx.vfx('dust', cl.x, q.y, { scale: 0.2, duration: 300, alpha: 0.6, depth: 260 });
    }
    cl.fallFx = false;
    const h = START_Y - q.y;
    const carried = cl.carried;
    cl.carried = false;
    // Dropped well below your best (a tumble, or a bubble ride back up): there's a best to beat.
    if (h < cl.best - FALL_LOSS && cl.fellBest === 0) cl.fellBest = cl.best;
    if (h > cl.best + 1 && !carried) {
      const before = Math.floor(cl.best / PX_PER_M);
      cl.best = h;
      cl.bestAt = this.elapsed;
      cl.p.score = Math.floor(h / PX_PER_M);
      cl.bestFlash = 1;
      const now = Math.floor(h / PX_PER_M);
      const tens = Math.floor(now / 10);
      if (cl.fellBest > 0 && q.kind !== 'summit') {
        // Back past the height you fell from.
        cl.fellBest = 0;
        audio.play('chipGain', { volume: 0.4, rate: 1.15 });
        this.pops.pop(WORDS.best.key, cl.x, q.y - 165, { rise: 50, hold: 700, tilt: -6, near: 160 });
        this.fx.sparks(cl.x, q.y - 70, liteCount(16));
        this.bumpHud(cl.p.slot);
      } else if (tens > Math.floor(before / 10) && tens >= 1 && tens <= 4 && q.kind !== 'summit') {
        audio.play('chipGain', { volume: 0.35, rate: 0.9 });
        this.pops.pop(MILESTONE_WORDS[tens - 1].key, cl.x, q.y - 160, { rise: 56, hold: 560, near: 220 });
        this.fx.sparks(cl.x, q.y - 60, liteCount(12));
        this.bumpHud(cl.p.slot);
      }
    }
    if (q.kind === 'summit' && !carried) this.reachSummit(cl);
  }

  private reachSummit(cl: Climber): void {
    if (cl.state === 'summit') return;
    cl.state = 'summit';
    cl.best = TOWER_H;
    cl.bestAt = this.elapsed;
    cl.p.score = TOWER_H / PX_PER_M;
    cl.p.doneAt = this.elapsed;
    cl.vx = 0;
    this.summits++;
    cl.c.play('victory', { force: true, returnTo: 'celebrate' });
    audio.play(this.summits === 1 ? 'fanfare' : 'victory', { volume: 0.6 });
    this.fx.confetti(cl.x, SUMMIT_Y - 200, liteCount(70));
    this.rings.burst(cl.x, SUMMIT_Y + 4, { tint: COLORS.goldLight, from: 50, to: 360, squash: 0.35, duration: 620, alpha: 0.9, add: true, depth: POP_DEPTH - 1 });
    if (this.summits === 1) {
      this.hitStop(80);
      punch(this, 0.04, 420);
    }
    this.fx.floatText(cl.x, SUMMIT_Y - 190, this.summits === 1 ? 'SUMMIT! 1st!' : 'SUMMIT!', '#ffe08a', { size: 52, rise: 90, duration: 1200 });
    this.rumble(cl.p, 0.5, 0.5, 200);
    if (this.summits >= this.climbers.length) this.time.delayedCall(1200, () => this.end());
  }

  /** A ledge end the climber can catch right now (nearest one), or null. */
  private findLedge(cl: Climber): LedgeHit | null {
    let best: LedgeHit | null = null;
    let bestD = Infinity;
    for (const q of this.plats) {
      if (q.kind === 'ground' || !this.solid(q)) continue;
      const rise = cl.y - q.y;
      if (rise < GRAB_DOWN || rise > GRAB_UP) continue;
      const l = q.x - q.w / 2;
      const r = q.x + q.w / 2;
      if (cl.x >= l - GRAB_OUT && cl.x <= l + GRAB_IN && Math.abs(cl.x - l) < bestD) {
        best = { plat: q, side: -1 };
        bestD = Math.abs(cl.x - l);
      }
      if (cl.x <= r + GRAB_OUT && cl.x >= r - GRAB_IN && Math.abs(cl.x - r) < bestD) {
        best = { plat: q, side: 1 };
        bestD = Math.abs(cl.x - r);
      }
    }
    return best;
  }

  private startClimb(cl: Climber, lg: LedgeHit): void {
    this.grabFx(cl, lg);
    cl.state = 'climb';
    cl.t = 0;
    cl.grab = { plat: lg.plat, side: lg.side, fromX: cl.x, fromY: cl.y };
    cl.vx = 0;
    cl.vy = 0;
    cl.on = null;
    cl.jumpHeld = false;
    cl.air = null;
    cl.c.hold('climb');
    cl.c.face(lg.side > 0);
    audio.play('step', { volume: 0.5 });
    this.rumble(cl.p, 0.15, 0.25, 60);
  }

  /** A spark where the hands catch the ledge; caught while falling, it's a SAVE. */
  private grabFx(cl: Climber, lg: LedgeHit): void {
    const ex = lg.plat.x + lg.side * (lg.plat.w / 2);
    const ey = lg.plat.y;
    this.fx.sparks(ex, ey - 4, liteCount(12));
    this.fx.vfx('impact', ex, ey, { scale: 0.3, duration: 220, blend: 'add', depth: 330 });
    audio.play('pop', { volume: 0.3, rate: 1.5, throttleMs: 60 });
    if (cl.vy > 120) {
      this.pops.pop(WORDS.save.key, ex - lg.side * 14, ey - 100, { rise: 36, hold: 520, tilt: -lg.side * 8, near: 140 });
      audio.play('chipGain', { volume: 0.32, rate: 1.1 });
      if (!cl.p.isCpu) this.hitStop(SAVE_STOP_MS);
    }
    cl.fallFx = false;
  }

  private updateClimb(cl: Climber, dt: number): void {
    const g = cl.grab;
    if (!g) {
      cl.state = 'normal';
      return;
    }
    const q = g.plat;
    if (!this.solid(q)) {
      // Lost the ledge (it tipped or crumbled): drop.
      cl.state = 'normal';
      cl.grab = null;
      cl.vy = 60;
      return;
    }
    cl.t += dt;
    const edge = q.x + g.side * (q.w / 2);
    const hangX = edge + g.side * 20;
    const hangY = q.y + HANG_DY;
    if (cl.t < HANG_MS) {
      const u = Math.min(1, cl.t / 90);
      cl.x = g.fromX + (hangX - g.fromX) * u;
      cl.y = g.fromY + (hangY - g.fromY) * u;
      return;
    }
    const u = Math.min(1, (cl.t - HANG_MS) / PULLUP_MS);
    const topX = edge - g.side * 34;
    cl.x = hangX + (topX - hangX) * Phaser.Math.Easing.Sine.InOut(u);
    cl.y = hangY + (q.y - hangY) * Phaser.Math.Easing.Quadratic.Out(u) - Math.sin(u * Math.PI) * 14;
    if (u >= 1) {
      cl.state = 'normal';
      cl.grab = null;
      cl.vy = 0;
      cl.c.play('idle', { force: true });
      this.land(cl, q);
    }
  }

  // --- Camera + rescue -------------------------------------------------------------------------
  private updateCamera(s: number): void {
    let hi = Infinity;
    for (const cl of this.climbers) {
      if (cl.state === 'normal' || cl.state === 'climb' || cl.state === 'summit') hi = Math.min(hi, cl.y);
    }
    if (hi === Infinity) return;
    const target = Math.max(CAM_TOP, Math.min(0, hi - CAM_LEAD * 1080));
    // Only ever scroll up.
    if (target < this.camY) this.camY += (target - this.camY) * (1 - Math.exp(-CAM_RATE * s));
    this.cameras.main.setScroll(0, this.camY);
  }

  /** Lowest solid, steady plank comfortably inside the view. */
  private pickRescue(): Plat | null {
    const top = this.camY;
    const bottom = top + 1080;
    let best: Plat | null = null;
    for (const q of this.plats) {
      if (!q.main || !this.solid(q) || q.kind === 'tipping' || q.kind === 'crumble' || q.kind === 'summit') continue;
      if (q.y > bottom - 150 || q.y < top + 260) continue;
      if (!best || q.y > best.y) best = q;
    }
    return best;
  }

  private updateRescue(dt: number): void {
    const bottom = this.camY + 1080;
    for (const cl of this.climbers) {
      if ((cl.state === 'normal' || cl.state === 'climb') && cl.y > bottom + 140) {
        cl.state = 'wait';
        cl.t = 0;
        cl.vx = 0;
        cl.vy = 0;
        cl.on = null;
        cl.grab = null;
        cl.c.setVisible(false);
        this.rumble(cl.p, 0.4, 0.3, 160);
        // Everyone sees who fell: a flash in their colour where they left the screen.
        this.rings.burst(cl.x, bottom - 16, { tint: PLAYER_COLORS[cl.p.slot], from: 40, to: 240, squash: 0.45, duration: 480, alpha: 0.9, add: true, depth: POP_DEPTH - 1 });
      }
      if (cl.state === 'wait') {
        cl.t += dt;
        if (cl.t >= BUBBLE_DELAY) {
          const q = this.pickRescue();
          if (q) {
            cl.state = 'bubble';
            cl.t = 0;
            cl.rescue = q;
            cl.rescueDX = (Math.random() - 0.5) * Math.min(120, q.w - 60);
            cl.rescueX = Phaser.Math.Clamp(q.x + cl.rescueDX + (Math.random() - 0.5) * 200, WALL_L + 60, WALL_R - 60);
            cl.c.setVisible(true);
            cl.c.hold('surprised', 0);
            cl.bubble.setVisible(true).setAlpha(1).setScale(0.9);
            audio.play('bounce', { volume: 0.4 });
          }
        }
      } else if (cl.state === 'bubble') {
        cl.t += dt;
        const q = cl.rescue;
        if (!q || !this.solid(q)) {
          cl.rescue = this.pickRescue();
          if (!cl.rescue) continue;
        }
        const tq = cl.rescue!;
        const u = Math.min(1, cl.t / BUBBLE_RISE);
        const e = 1 - Math.pow(1 - u, 3);
        const x1 = tq.x + cl.rescueDX;
        const y1 = tq.y - 70;
        const y0 = bottom + 120;
        cl.x = cl.rescueX + (x1 - cl.rescueX) * e + Math.sin(cl.t / 170) * 10 * (1 - u);
        cl.y = y0 + (y1 - y0) * e;
        if (u >= 1) {
          // Pop! Drop onto the plank.
          cl.state = 'normal';
          cl.vy = 0;
          cl.vx = 0;
          cl.on = null;
          cl.air = null;
          cl.bubble.setVisible(false);
          cl.carried = true;
          audio.play('pop', { volume: 0.55, rate: 0.8 });
          this.fx.vfx('splash', cl.x, cl.y - 50, { scale: 0.45, duration: 380, alpha: 0.8, tint: 0xc8f6ff, depth: 330 });
        }
      }
    }
  }

  // --- Visuals ---------------------------------------------------------------------------------
  protected override ambient(dt: number): void {
    this.clock += dt;
    this.movePlats();
    // The base HUD is built for a fixed camera: pin everything in the UI depth band to the screen.
    for (const o of this.children.list) {
      const go = o as unknown as { depth?: number; scrollFactorY?: number };
      if ((go.depth ?? 0) >= 8000 && go.scrollFactorY !== 0) pinToScreen(o);
    }
    if (this.phase !== 'playing') this.syncVisuals(dt);
  }

  private syncVisuals(dt: number): void {
    const cam = this.camY;
    // The wall ends at the tower's top (sky above the parapet).
    const topY = Phaser.Math.Clamp(SUMMIT_Y - CROWN_RISE * 0.45 - cam, 0, 1080);
    if (this.wall.y !== topY) this.wall.setPosition(0, topY).setSize(GAME_WIDTH, Math.max(1, 1080 - topY));
    this.wall.tilePositionY = (cam + topY) / this.wall.tileScaleY;
    this.altTint.setAlpha(Phaser.Math.Clamp(-cam / -CAM_TOP, 0, 1) * 0.55);
    const calm = calmMotion();
    for (const q of this.plats) {
      if (q.kind === 'ground' || q.kind === 'summit') continue;
      if (q.kind === 'crumble' && q.state === 'gone') continue;
      let sx = 0;
      if (q.kind === 'crumble' && q.state === 'crack') sx = Math.sin(this.clock / 22) * 3;
      // Tipping planks never sit quite still: a lazy idle rock marks them as unsafe (looks only).
      const rock = q.kind === 'tipping' && q.state === 'idle' && !calm ? Math.sin(this.clock / 430 + q.id * 1.7) * 0.9 : 0;
      q.view.setPosition(q.x + sx, q.y).setAngle(q.angle + rock);
      // Telegraph tint while a tipping plank rattles.
      if (q.kind === 'tipping' && q.plank) {
        if (q.state === 'wobble' && Math.floor(q.t / 110) % 2 === 0) q.plank.setTint(0xffb0a0);
        else q.plank.clearTint();
      }
    }
    this.drawSummitFlag();
    for (const cl of this.climbers) this.syncClimber(cl);
    this.drawHazards();
    this.drawFallTrails();
    this.syncLeader();
    this.drawGauge(dt);
  }

  /**
   * Tipping-plank warning while it rattles: a pulsing "!" on its pivot (under the plank, clear of
   * the riders) and a curved arrow past the end it will tip towards (where its riders stand).
   */
  private drawHazards(): void {
    const g = this.hazardG;
    g.clear();
    for (const q of this.plats) {
      if (q.kind !== 'tipping' || q.state !== 'wobble') continue;
      const k = q.t / TIP_WOBBLE_MS;
      const pulse = 0.5 + 0.5 * Math.sin(q.t / (70 - 35 * k));
      const bx = q.x;
      const by = q.y + 50;
      const r = 20 + 4 * pulse;
      g.fillStyle(0x06141a, 0.3);
      g.fillCircle(bx + 2, by + 3, r);
      g.fillStyle(0xff4a3a, 1);
      g.fillCircle(bx, by, r);
      g.lineStyle(3, 0xffffff, 1);
      g.strokeCircle(bx, by, r);
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(bx - 3.5, by - 13, 7, 16, 3.5);
      g.fillCircle(bx, by + 9, 4);
      let bias = 0;
      for (const cl of this.climbers) if (cl.on === q && cl.state === 'normal') bias += cl.x - q.x;
      if (bias === 0) continue;
      const dir = bias > 0 ? 1 : -1;
      const ax = q.x + dir * (q.w / 2 + 12);
      const ay = q.y - 12;
      const a0 = dir > 0 ? -Math.PI * 0.75 : -Math.PI * 0.25;
      const a1 = dir > 0 ? Math.PI * 0.05 : Math.PI * 0.95;
      g.lineStyle(10, 0x06141a, 0.35);
      g.beginPath();
      g.arc(ax, ay + 2, 32, a0, a1, dir < 0);
      g.strokePath();
      g.lineStyle(8, 0xffb03a, 0.65 + 0.35 * pulse);
      g.beginPath();
      g.arc(ax, ay, 32, a0, a1, dir < 0);
      g.strokePath();
      // Arrow head at the arc's end, pointing down and outwards.
      const ex = ax + Math.cos(a1) * 32;
      const ey = ay + Math.sin(a1) * 32;
      g.fillStyle(0xffb03a, 0.65 + 0.35 * pulse);
      g.fillTriangle(ex - 13, ey - 3, ex + 13, ey - 3, ex + dir * 3, ey + 17);
    }
  }

  /** Speed streaks trailing above a climber in a long drop, in their colour. */
  private drawFallTrails(): void {
    const g = this.fallG;
    g.clear();
    if (calmMotion()) return;
    for (const cl of this.climbers) {
      if (cl.state !== 'normal' || cl.on || cl.vy < FALL_TRAIL_V) continue;
      const k = Math.min(1, (cl.vy - FALL_TRAIL_V) / (MAX_FALL - FALL_TRAIL_V));
      const top = cl.y - 128;
      const len = 50 + 140 * k;
      const col = PLAYER_COLORS[cl.p.slot];
      const a = 0.55 + 0.45 * k;
      for (let i = -1; i <= 1; i++) {
        const flick = 0.85 + 0.15 * Math.sin(this.clock / 40 + i * 2);
        const x = cl.x + i * 20;
        const l = len * flick * (i === 0 ? 1 : 0.7);
        // A streak in the player's colour with a bright core, so everyone sees who is falling.
        g.lineStyle(i === 0 ? 10 : 6, col, (i === 0 ? 0.75 : 0.55) * a);
        g.lineBetween(x, top - 6, x, top - 6 - l);
        g.lineStyle(i === 0 ? 4 : 2, 0xffffff, 0.8 * a);
        g.lineBetween(x, top - 8, x, top - 8 - l * 0.85);
      }
    }
  }

  /** The final stretch: the leader (best height, first there on a tie) climbs in a shaft of light. */
  private syncLeader(): void {
    const final = this.phase === 'playing' && this.duration - this.elapsed <= FINAL_MS;
    let lead: Climber | null = null;
    if (final) {
      for (const cl of this.climbers) {
        if (cl.best <= 0) continue;
        if (!lead || cl.best > lead.best || (cl.best === lead.best && cl.bestAt < lead.bestAt)) lead = cl;
      }
    }
    if (lead !== this.leader) {
      if (lead && this.leader) audio.play('chipGain', { volume: 0.3, rate: 1.25 });
      this.leader = lead;
    }
    const show = !!lead && lead.state !== 'wait';
    const target = show ? 1 : 0;
    const a = this.shaft.alpha / 0.4;
    const next = a + (target - a) * 0.12;
    this.shaft.setAlpha(next * 0.4);
    this.shaftGlow.setAlpha(next * (0.55 + 0.2 * Math.sin(this.clock / 160)));
    if (lead && show) {
      this.shaft.setPosition(lead.x, lead.y + 18);
      this.shaftGlow.setPosition(lead.x, lead.y + 4);
    }
  }

  private syncClimber(cl: Climber): void {
    const c = cl.c;
    c.setPosition(cl.x, cl.y);
    if (cl.state === 'bubble') {
      cl.bubble.setPosition(cl.x, cl.y - 62).setScale(0.9 + Math.sin(this.clock / 140) * 0.03, 0.9 - Math.sin(this.clock / 140) * 0.03);
    }
    if (cl.state === 'normal' && this.phase === 'playing') {
      if (cl.on) {
        if (Math.abs(cl.vx) > 30) c.face(cl.vx < 0);
        const moving = Math.abs(cl.vx) > 70;
        const busy = c.current === 'surprised' || c.current === 'victory' || c.current === 'celebrate';
        if (moving && c.current !== 'run') c.play('run');
        else if (!moving && !busy && c.current !== 'idle') c.play('idle');
      } else {
        if (Math.abs(cl.vx) > 30) c.face(cl.vx < 0);
        const phase = cl.vy < -80 ? 'rise' : 'fall';
        if (phase !== cl.air) {
          cl.air = phase;
          c.hold('jump', phase === 'rise' ? 1 : 2);
        }
      }
    }
    // Grab prompt for humans when a ledge is in reach.
    if (cl.hint) {
      const lg = cl.state === 'normal' && !cl.on && this.phase === 'playing' ? this.findLedge(cl) : null;
      cl.hint.setVisible(!!lg);
      if (lg) {
        const edge = lg.plat.x + lg.side * (lg.plat.w / 2);
        cl.hint.setPosition(edge + lg.side * 40, lg.plat.y - 46).setScale(1 + Math.sin(this.clock / 90) * 0.08);
      }
    }
  }

  private drawSummitFlag(): void {
    const g = this.summitFlag;
    if (!g) return;
    g.clear();
    const x = 960;
    const y = SUMMIT_Y;
    g.fillStyle(0x4a2c10, 1);
    g.fillRect(x - 6, y - 300, 12, 300);
    g.fillStyle(COLORS.gold, 1);
    g.fillCircle(x, y - 306, 12);
    const t = this.clock / 1000;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push({ x: x + 6 + u * 200, y: y - 292 + Math.sin(t * 4 - u * 5) * 8 * u });
    }
    for (let i = 10; i >= 0; i--) {
      const u = i / 10;
      pts.push({ x: x + 6 + u * 200, y: y - 172 + Math.sin(t * 4 - u * 5) * 8 * u });
    }
    g.fillStyle(0xff6b5e, 1);
    g.fillPoints(pts, true);
    // Spiral emblem
    g.lineStyle(6, 0xfff4dc, 1);
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i * 0.3;
      const r = 3 + i * 0.95;
      const px = x + 100 + Math.cos(a) * r;
      const py = y - 232 + Math.sin(a) * r + Math.sin(t * 4 - 2.5) * 4;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  }

  /**
   * Height meter: a rail from the floor to the summit with every climber's portrait riding it at
   * their current height (nudged apart when they bunch up, with a notch at the true height), their
   * best as a tick in their colour (flashing when it moves), and the band the camera shows.
   */
  private drawGauge(dt: number): void {
    const g = this.gaugeG;
    g.clear();
    const x = GAUGE_X;
    const map = (h: number) => GAUGE_Y0 + (GAUGE_Y1 - GAUGE_Y0) * Phaser.Math.Clamp(h / TOWER_H, 0, 1);
    g.fillStyle(0x06141a, 0.28);
    g.fillRoundedRect(x - 26 + 4, GAUGE_Y1 - 46 + 6, 52, GAUGE_Y0 - GAUGE_Y1 + 82, 26);
    g.fillStyle(0x0c2630, 0.85);
    g.fillRoundedRect(x - 26, GAUGE_Y1 - 46, 52, GAUGE_Y0 - GAUGE_Y1 + 82, 26);
    g.fillGradientStyle(COLORS.gold, COLORS.gold, COLORS.grass, COLORS.grass, 1);
    g.fillRect(x - 5, GAUGE_Y1, 10, GAUGE_Y0 - GAUGE_Y1);
    // Visible band
    const vTop = map(START_Y - this.camY);
    const vBot = map(START_Y - (this.camY + 1080));
    g.lineStyle(3, 0xffffff, 0.45);
    g.strokeRoundedRect(x - 16, vTop, 32, vBot - vTop, 8);
    for (let m = 0; m <= 50; m += 10) {
      g.fillStyle(0xffffff, 0.8);
      g.fillRect(x - 11, map(m * PX_PER_M) - 1, 22, 2);
    }
    // Summit flag icon
    g.fillStyle(0xfff4dc, 1);
    g.fillRect(x - 2, GAUGE_Y1 - 36, 3, 30);
    g.fillStyle(0xff6b5e, 1);
    g.fillTriangle(x + 1, GAUGE_Y1 - 36, x + 20, GAUGE_Y1 - 28, x + 1, GAUGE_Y1 - 20);
    // Best heights: a tick in each player's colour, flaring when it climbs.
    for (const cl of this.climbers) {
      cl.bestFlash = Math.max(0, cl.bestFlash - dt / 600);
      const f = cl.bestFlash;
      const by = map(cl.best);
      g.fillStyle(PLAYER_COLORS[cl.p.slot], 1);
      g.fillRect(x - 16 - 8 * f, by - 2 - f, 32 + 16 * f, 4 + 2 * f);
      if (f > 0) {
        g.fillStyle(0xffffff, 0.7 * f);
        g.fillRect(x - 16 - 8 * f, by - 1, 32 + 16 * f, 2);
      }
    }
    for (let c = 0; c < 2; c++) this.drawMarkColumn(g, this.markCols[c], c === 0 ? -1 : 1, map, dt);
  }

  /**
   * One column of meter portraits: true heights, kept in order top to bottom (a climber only moves
   * up the order once clearly past the one above), nudged apart, then eased into place.
   */
  private drawMarkColumn(g: Phaser.GameObjects.Graphics, order: Climber[], side: -1 | 1, map: (h: number) => number, dt: number): void {
    const x = GAUGE_X;
    const mx = x + side * MARK_DX;
    for (const cl of order) cl.markT = map(START_Y - cl.y);
    for (let i = 1; i < order.length; i++) {
      const c = order[i];
      let j = i - 1;
      while (j >= 0 && order[j].markT > c.markT + MARK_HYST) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = c;
    }
    for (const cl of order) cl.markR = cl.markT;
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < order.length; i++) {
        const a = order[i - 1];
        const b = order[i];
        const gap = b.markR - a.markR;
        if (gap < MARK_GAP) {
          a.markR -= (MARK_GAP - gap) / 2;
          b.markR += (MARK_GAP - gap) / 2;
        }
      }
    }
    // Keep the stack on the rail: nothing above the summit flag or below the floor.
    const n = order.length;
    for (let i = 0; i < n; i++) order[i].markR = Math.max(order[i].markR, GAUGE_Y1 + 2 + i * MARK_GAP);
    for (let i = n - 1; i >= 0; i--) order[i].markR = Math.min(order[i].markR, GAUGE_Y0 - (n - 1 - i) * MARK_GAP);
    const final = this.leader;
    const ease = 1 - Math.exp(-dt / 90);
    for (const cl of order) {
      cl.markY += (cl.markR - cl.markY) * ease;
      const col = PLAYER_COLORS[cl.p.slot];
      // Notch at the true height on the rail, joined to the portrait when it has been nudged away.
      const nx = x + side * 7;
      g.fillStyle(col, 1);
      g.fillTriangle(nx + side * 10, cl.markT - 6, nx + side * 10, cl.markT + 6, nx, cl.markT);
      if (Math.abs(cl.markY - cl.markT) > 4) {
        g.lineStyle(2, col, 0.8);
        g.lineBetween(nx + side * 6, cl.markT, nx + side * 6, cl.markY);
      }
      if (cl === final) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock / 140);
        g.fillStyle(0xffd36b, 0.25 + 0.3 * pulse);
        g.fillCircle(mx, cl.markY, MARK_R + 10 + 3 * pulse);
      }
      cl.mark.setPosition(mx, cl.markY).setScale(cl === final ? 1.14 : 1).setAlpha(cl.state === 'wait' || cl.state === 'bubble' ? 0.6 : 1);
      cl.mark.setDepth(cl === final ? 8110 : 8102 + cl.p.slot * 0.01);
    }
  }

  // --- CPU -------------------------------------------------------------------------------------
  /** Simulate a full-height jump from the climber's spot, steering at the plank; lands on it? */
  private jumpLands(cl: Climber, T: Plat, fromX = cl.x, vx0 = cl.vx): boolean {
    let x = fromX;
    let y = cl.y;
    let vx = vx0;
    let vy = -cl.jumpV;
    const step = 1 / 30;
    for (let t = step; t < 1.6; t += step) {
      const tx = this.platXAt(T, this.clock + t * 1000);
      vx = approach(vx, Phaser.Math.Clamp((tx - x) / 30, -1, 1) * cl.speed, AIR_ACCEL * step);
      const py = y;
      const vy0 = vy;
      vy = Math.min(MAX_FALL, vy + GRAVITY * step);
      x += vx * step;
      y += ((vy0 + vy) / 2) * step;
      if (vy > 0 && py <= T.y && y >= T.y) return Math.abs(x - tx) <= T.w / 2 - 10;
      if (y > T.y + 260) return false;
    }
    return false;
  }

  /** Too tall to land on when jumping from height `fromY`: the ledge must be grabbed. */
  private grabOnly(cl: Climber, T: Plat, fromY = cl.y): boolean {
    return fromY - T.y > (cl.jumpV * cl.jumpV) / (2 * GRAVITY) - 14;
  }

  /** Horizontal gap between two planks' spans (a moving plank counts its whole sweep). */
  private gapBetween(a: Plat, q: Plat): number {
    const ql = q.baseX - q.amp - q.w / 2;
    const qr = q.baseX + q.amp + q.w / 2;
    const al = a.baseX - a.amp - a.w / 2;
    const ar = a.baseX + a.amp + a.w / 2;
    return Math.max(0, ql - ar, al - qr);
  }

  /** Planks reachable from `from` that rise between minRise and the climber's reach. */
  private reachable(cl: Climber, from: Plat, minRise: number): Plat[] {
    const reach = (cl.jumpV * cl.jumpV) / (2 * GRAVITY) + GRAB_UP - 50;
    return this.plats.filter((q) => {
      if (q === from || q.kind === 'ground') return false;
      const rise = from.y - q.y;
      if (rise < minRise || rise > reach) return false;
      return this.gapBetween(from, q) <= (rise < 0 ? 300 : 230);
    });
  }

  /** Where to stand on `cur` to jump up beside one of T's ends and grab it (null: nowhere). */
  private grabTakeoff(cur: Plat, T: Plat, fromX: number): number | null {
    const tx = this.platXAt(T, this.clock + 400);
    const lo = cur.x - cur.w / 2 + 18;
    const hi = cur.x + cur.w / 2 - 18;
    let best: number | null = null;
    for (const x of [tx - T.w / 2 - 30, tx + T.w / 2 + 30]) {
      if (x < lo || x > hi) continue;
      if (best === null || Math.abs(x - fromX) < Math.abs(best - fromX)) best = x;
    }
    return best;
  }

  private pickTarget(cl: Climber, allowAvoided = false): Plat | null {
    const cur = cl.on;
    if (!cur) return null;
    const sk = this.skill(cl.p);
    const b = cl.ai;
    const usable = (q: Plat) =>
      this.solid(q) && !(q.kind === 'crumble' && q.state === 'crack') && !(q.kind === 'tipping' && q.state !== 'idle') && (allowAvoided || !(q === b.avoid && this.elapsed < b.avoidUntil));
    const cands: { q: Plat; score: number }[] = [];
    for (const q of this.reachable(cl, cur, 40)) {
      if (!usable(q)) continue;
      const grab = this.grabOnly(cl, q);
      if (grab && this.grabTakeoff(cur, q, cl.x) === null) continue;
      const rise = cur.y - q.y;
      let score = rise * 1.2 - this.gapBetween(cur, q) * 0.5;
      if (q.kind === 'tipping') score -= 70;
      if (q.kind === 'crumble') score -= 45;
      if (q.kind === 'moving') score -= 25;
      if (grab) score -= 110;
      // Look one step ahead: avoid planks that lead nowhere.
      if (q.kind !== 'summit' && !this.reachable(cl, q, 40).some((r) => r !== cur)) score -= 180;
      if (q.kind === 'summit') score += 2000;
      score += gauss() * sk.aimNoise * 90;
      cands.push({ q, score });
    }
    if (cands.length === 0) {
      // Dead end: step across (or down) to a plank that has a way up.
      for (const q of this.reachable(cl, cur, -320)) {
        const rise = cur.y - q.y;
        if (rise >= 40 || !usable(q)) continue;
        if (!this.reachable(cl, q, 40).some((r) => r !== cur)) continue;
        cands.push({ q, score: rise * 0.5 - this.gapBetween(cur, q) * 0.3 + gauss() * sk.aimNoise * 60 });
      }
    }
    if (cands.length === 0) return allowAvoided || !b.avoid ? null : this.pickTarget(cl, true);
    if (Math.random() < sk.mistake * 0.5) return cands[Math.floor(Math.random() * cands.length)].q;
    cands.sort((a, b) => b.score - a.score);
    return cands[0].q;
  }

  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const cl = this.climbers.find((x) => x.p === p);
    if (!cl) return;
    const b = cl.ai;
    if (cl.state !== 'normal') {
      vc.setMove(0, 0);
      vc.hold('A', false);
      b.holdA = false;
      return;
    }
    const sk = this.skill(p);
    b.retarget -= dt;
    let mx = 0;
    let jumpNow = false;
    if (!cl.on && b.lastOn) {
      // Just left a plank (jumped or stepped off): that is the height a grab must beat.
      b.takeoffY = b.lastOn.y;
      b.fromPlat = b.lastOn;
    }
    if (cl.on && cl.on !== b.lastOn && b.lastOn === null) {
      // Just landed: back where we jumped from means the attempt failed; give up after two.
      if (b.target && cl.on === b.fromPlat && b.target !== cl.on) {
        b.fails++;
        if (b.fails >= 2) {
          b.avoid = b.target;
          b.avoidUntil = this.elapsed + 2500;
          b.target = null;
          b.fails = 0;
        }
      } else b.fails = 0;
      // Catch breath / look around before the next leap.
      b.jumpAt = -1;
      b.retarget = Math.min(b.retarget, 0);
      b.pauseUntil = this.elapsed + sk.think * (0.8 + Math.random() * 0.8);
    }
    b.lastOn = cl.on;
    if (cl.on) {
      const cur = cl.on;
      b.holdA = false;
      if (!b.target || b.target === cur || !this.solid(b.target) || b.retarget <= 0) {
        b.target = this.pickTarget(cl);
        b.retarget = 1400 + Math.random() * 900;
        b.jumpAt = -1;
      }
      const T = b.target;
      // Get off a rattling or cracking plank quickly.
      const urgent = (cur.kind === 'tipping' && cur.state === 'wobble') || (cur.kind === 'crumble' && cur.state === 'crack');
      if (!T) {
        if (Math.abs(cur.x - cl.x) > 40) mx = Math.sign(cur.x - cl.x) * 0.6;
      } else {
        const tx = this.platXAt(T, this.clock + 400);
        const grab = this.grabOnly(cl, T);
        const tl = tx - T.w / 2;
        const tr = tx + T.w / 2;
        const cl0 = cur.x - cur.w / 2 + 18;
        const cr0 = cur.x + cur.w / 2 - 18;
        let takeoff: number;
        if (grab) {
          // Stand just outside the tall ledge's end, beside it, and jump straight up.
          takeoff = this.grabTakeoff(cur, T, cl.x) ?? Phaser.Math.Clamp(tx, cl0, cr0);
        } else if (cur.y - T.y < -40) {
          // Clearly lower: just step off the end nearest the target.
          takeoff = tx > cur.x ? cur.x + cur.w / 2 + 40 : cur.x - cur.w / 2 - 40;
        } else if (cur.y - T.y < 20) {
          // About level: hop across from the end nearest the target.
          takeoff = tx > cur.x ? cr0 : cl0;
        } else if (tr > cl0 + 50 && tl < cr0 - 50) {
          takeoff = Phaser.Math.Clamp(tx, Math.max(cl0, tl + 30), Math.min(cr0, tr - 30));
        } else takeoff = tx > cur.x ? cr0 : cl0;
        const dx = takeoff - cl.x;
        mx = Math.abs(dx) > 12 ? Phaser.Math.Clamp(dx / 60, -1, 1) : 0;
        const feasible = grab ? Math.abs(dx) < 26 : this.jumpLands(cl, T);
        const resting = this.elapsed < b.pauseUntil && !urgent;
        if (resting) b.jumpAt = -1;
        else if (feasible || (urgent && Math.random() < 0.08)) {
          if (b.jumpAt < 0) b.jumpAt = this.elapsed + sk.reaction * (0.3 + Math.random() * 0.5) * (urgent ? 0.4 : 1);
        } else if (Math.random() < sk.mistake * 0.012) {
          // Impatient leap that probably falls short.
          b.jumpAt = this.elapsed;
        } else b.jumpAt = -1;
        if (b.jumpAt >= 0 && this.elapsed >= b.jumpAt) {
          jumpNow = true;
          b.jumpAt = -1;
          b.holdA = true;
          b.aimErr = gauss() * sk.aimNoise * (b.fails > 0 ? 15 : 45);
          b.willGrab = Math.random() < sk.accuracy + 0.05;
          b.grabAt = -1;
          b.fromPlat = cur;
        }
      }
    } else {
      const T = b.target;
      if (T) {
        const tx = this.platXAt(T, this.clock + 200) + b.aimErr;
        if (this.grabOnly(cl, T, b.takeoffY) && Math.abs(cl.x - tx) > T.w / 2) mx = 0;
        else mx = Phaser.Math.Clamp((tx - cl.x) / 50, -1, 1);
      }
      // Catch a ledge above the take-off height if one is in reach (after a short reaction).
      const lg = this.findLedge(cl);
      if (lg && lg.plat !== b.fromPlat && lg.plat.y < b.takeoffY - 30 && b.willGrab && (cl.vy > -260 || (T && this.grabOnly(cl, T, b.takeoffY)))) {
        if (b.grabAt < 0) b.grabAt = this.elapsed + sk.reaction * 0.35;
        if (this.elapsed >= b.grabAt) {
          vc.tap('X');
          b.grabAt = -1;
        }
      }
      if (cl.vy >= 0) b.holdA = false;
    }
    vc.setMove(mx, 0);
    vc.hold('A', b.holdA && !jumpNow && cl.vy < 0);
    if (jumpNow) vc.tap('A');
  }

  // --- Scores ----------------------------------------------------------------------------------
  protected override hudLabel(p: MgPlayer): string {
    const cl = this.climbers.find((x) => x.p === p);
    return `${Math.floor((cl?.best ?? 0) / PX_PER_M)} m`;
  }

  protected override end(): void {
    super.end();
    // Leader(s) celebrate on the spot.
    const top = Math.max(...this.climbers.map((cl) => cl.best));
    for (const cl of this.climbers) {
      cl.hint?.setVisible(false);
      if (cl.best === top && top > 0 && cl.state !== 'summit' && cl.state !== 'bubble' && cl.state !== 'wait') cl.c.play('victory', { force: true, returnTo: 'celebrate' });
    }
  }

  /** Best height reached (standing), ties broken by who got there first. */
  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.climbers.map((cl) => {
      const m = cl.best / PX_PER_M;
      const score = towerScore(cl.best, cl.bestAt);
      return { slot: cl.p.slot, score, label: cl.state === 'summit' ? `Summit! ${m.toFixed(0)} m` : `${m.toFixed(1)} m` };
    });
  }

  // --- Fallback art ----------------------------------------------------------------------------
  private bubbleKey(): string {
    if (!this.textures.exists('tw-bubble')) {
      const S = 190;
      const tex = this.textures.createCanvas('tw-bubble', S, S);
      if (tex) {
        const ctx = tex.getContext();
        const c = S / 2;
        const body = ctx.createRadialGradient(c - 20, c - 26, 10, c, c, c - 4);
        body.addColorStop(0, 'rgba(255,255,255,0.14)');
        body.addColorStop(0.65, 'rgba(170,236,255,0.26)');
        body.addColorStop(0.9, 'rgba(120,210,255,0.7)');
        body.addColorStop(1, 'rgba(235,252,255,1)');
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(c, c, c - 3, 0, Math.PI * 2);
        ctx.fill();
        const irid = ctx.createLinearGradient(0, 0, S, S);
        irid.addColorStop(0, 'rgba(255,160,220,0.25)');
        irid.addColorStop(0.5, 'rgba(160,255,230,0.15)');
        irid.addColorStop(1, 'rgba(170,170,255,0.3)');
        ctx.strokeStyle = irid;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(c, c, c - 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(c, c, c - 22, Math.PI * 1.08, Math.PI * 1.42);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(c + 38, c + 42, 6, 0, Math.PI * 2);
        ctx.fill();
        tex.refresh();
      }
    }
    return 'tw-bubble';
  }

  private ensurePlankTexture(): void {
    if (this.textures.exists('tw-plank')) return;
    const tex = this.textures.createCanvas('tw-plank', 260, PLANK_TEX_H);
    if (!tex) return;
    const ctx = tex.getContext();
    const x0 = 10;
    const x1 = 250;
    // Soft shadow under the plank
    ctx.fillStyle = 'rgba(20,20,30,0.25)';
    ctx.beginPath();
    ctx.ellipse(130, 50, 118, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Front face with grain
    const face = ctx.createLinearGradient(0, 22, 0, 46);
    face.addColorStop(0, '#c98f55');
    face.addColorStop(1, '#8a5a31');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(x0, 18, x1 - x0, 28, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,50,20,0.45)';
    ctx.lineWidth = 1.5;
    for (const gy of [28, 36]) {
      ctx.beginPath();
      ctx.moveTo(x0 + 6, gy);
      for (let gx = x0 + 6; gx < x1 - 6; gx += 20) ctx.lineTo(gx, gy + Math.sin(gx * 0.07) * 1.6);
      ctx.stroke();
    }
    for (const [kx, ky] of [
      [70, 31],
      [168, 38],
    ]) {
      ctx.fillStyle = 'rgba(90,50,20,0.5)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Top (walking) face
    const top = ctx.createLinearGradient(0, 12, 0, 24);
    top.addColorStop(0, '#f1c98f');
    top.addColorStop(1, '#d9a46a');
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.roundRect(x0, 12, x1 - x0, 12, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x0 + 6, 13, x1 - x0 - 12, 2);
    // Outline
    ctx.strokeStyle = '#4a2c10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x0, 12, x1 - x0, 34, 7);
    ctx.stroke();
    // Iron straps with brass bolts near the ends
    for (const sx of [34, 214]) {
      ctx.fillStyle = '#4b4f5a';
      ctx.fillRect(sx, 10, 12, 38);
      ctx.fillStyle = '#6b6f7a';
      ctx.fillRect(sx + 2, 10, 4, 38);
      for (const by of [18, 38]) {
        ctx.fillStyle = '#e0a93f';
        ctx.beginPath();
        ctx.arc(sx + 6, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    tex.refresh();
  }

  /** Stone tower drum with ledges, windows, ivy and banners; tiles every 1080 px. */
  private ensureWallTexture(): string {
    const key = 'tw-wall';
    if (this.textures.exists(key)) return key;
    const tex = this.textures.createCanvas(key, GAME_WIDTH, WALL_TILE_H);
    if (!tex) return key;
    const ctx = tex.getContext();
    const H = WALL_TILE_H;
    const cx = DRUM_X;
    const R = DRUM_R;
    // Shaded drum
    const drum = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    drum.addColorStop(0, '#6f6556');
    drum.addColorStop(0.1, '#b3a690');
    drum.addColorStop(0.38, '#e8dcc6');
    drum.addColorStop(0.6, '#ddd0b8');
    drum.addColorStop(0.9, '#9d907a');
    drum.addColorStop(1, '#645a4c');
    ctx.fillStyle = drum;
    ctx.fillRect(cx - R, 0, 2 * R, H);
    // Bricks laid around the drum (foreshortened towards the edges).
    const rows = 24;
    const rowH = H / rows;
    const n = 22;
    const rng = new Random(77);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 0.5;
      for (let i = -1; i <= n; i++) {
        const a0 = -Math.PI / 2 + ((i + off) * Math.PI) / n;
        const a1 = a0 + Math.PI / n;
        const s0 = Math.max(-1, Math.min(1, Math.sin(Math.max(-Math.PI / 2, a0))));
        const s1 = Math.max(-1, Math.min(1, Math.sin(Math.min(Math.PI / 2, a1))));
        const bx0 = cx + R * s0 + 1.5;
        const bx1 = cx + R * s1 - 1.5;
        if (bx1 - bx0 < 3) continue;
        const mid = (a0 + a1) / 2;
        const light = 0.62 + 0.38 * Math.cos(mid + 0.35);
        const v = rng.range(-14, 14);
        const base = [226 + v, 214 + v, 192 + v].map((c) => Math.round(Math.min(255, c * light)));
        ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
        ctx.beginPath();
        ctx.roundRect(bx0, r * rowH + 2, bx1 - bx0, rowH - 4, 5);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.18 * light})`;
        ctx.fillRect(bx0 + 3, r * rowH + 3, Math.max(0, bx1 - bx0 - 6), 2);
        ctx.fillStyle = 'rgba(40,30,20,0.16)';
        ctx.fillRect(bx0 + 2, r * rowH + rowH - 5, Math.max(0, bx1 - bx0 - 4), 2);
      }
    }
    // Ledge bands at 0/1080 (wrapping) and 540.
    const band = (y: number) => {
      const g = ctx.createLinearGradient(0, y - 14, 0, y + 18);
      g.addColorStop(0, '#f3ead8');
      g.addColorStop(0.5, '#cfc2aa');
      g.addColorStop(1, '#8f836e');
      ctx.fillStyle = g;
      ctx.fillRect(cx - R - 6, y - 14, 2 * R + 12, 28);
      ctx.fillStyle = 'rgba(30,20,10,0.22)';
      ctx.fillRect(cx - R, y + 14, 2 * R, 10);
    };
    band(0);
    band(H);
    band(H / 2);
    // Arched glowing windows (clear of the ledge bands so the tile seams stay clean).
    const windows: [number, number][] = [
      [600, 250],
      [1330, 290],
      [930, 790],
      [1460, 800],
      [420, 780],
    ];
    for (const [wx, wy] of windows) {
      const ww = 64 * Math.cos(Math.asin((wx - cx) / R));
      ctx.fillStyle = '#4a3326';
      ctx.beginPath();
      ctx.moveTo(wx - ww / 2 - 8, wy + 70);
      ctx.lineTo(wx - ww / 2 - 8, wy - 20);
      ctx.arc(wx, wy - 20, ww / 2 + 8, Math.PI, 0);
      ctx.lineTo(wx + ww / 2 + 8, wy + 70);
      ctx.closePath();
      ctx.fill();
      const glow = ctx.createLinearGradient(0, wy - 60, 0, wy + 70);
      glow.addColorStop(0, '#fff1b8');
      glow.addColorStop(1, '#f0a53a');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(wx - ww / 2, wy + 62);
      ctx.lineTo(wx - ww / 2, wy - 20);
      ctx.arc(wx, wy - 20, ww / 2, Math.PI, 0);
      ctx.lineTo(wx + ww / 2, wy + 62);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4a3326';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wx, wy - 20 - ww / 2);
      ctx.lineTo(wx, wy + 62);
      ctx.moveTo(wx - ww / 2, wy + 14);
      ctx.lineTo(wx + ww / 2, wy + 14);
      ctx.stroke();
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(wx - ww / 2 - 14, wy + 62, ww + 28, 10);
    }
    // Hanging banners from the middle band.
    for (const [bx, color] of [
      [770, '#ff6b5e'],
      [1170, '#1fa5a0'],
    ] as [number, string][]) {
      const bw = 84;
      ctx.fillStyle = '#6b4424';
      ctx.fillRect(bx - bw / 2 - 8, H / 2 + 12, bw + 16, 8);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(bx - bw / 2, H / 2 + 18);
      ctx.lineTo(bx + bw / 2, H / 2 + 18);
      ctx.lineTo(bx + bw / 2, H / 2 + 230);
      ctx.lineTo(bx, H / 2 + 200);
      ctx.lineTo(bx - bw / 2, H / 2 + 230);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(bx + bw / 2 - 14, H / 2 + 18, 14, 206);
      ctx.strokeStyle = '#fff4dc';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 36; i++) {
        const a = i * 0.32;
        const r = 2 + i * 0.75;
        const px = bx + Math.cos(a) * r;
        const py = H / 2 + 100 + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // Ivy strands hanging from the bands.
    for (let k = 0; k < 10; k++) {
      const sx = cx + rng.range(-R * 0.85, R * 0.85);
      const y0 = k % 2 === 0 ? 16 : H / 2 + 16;
      const len = rng.range(120, 300);
      for (let j = 0; j < len / 9; j++) {
        const y = y0 + j * 9;
        const x = sx + Math.sin(y * 0.05 + k) * 7;
        ctx.fillStyle = ['#5aa944', '#4f9a3a', '#6fbf52'][j % 3];
        ctx.beginPath();
        ctx.ellipse(x + (j % 2 ? 6 : -6), y, 7, 4.5, j % 2 ? 0.6 : -0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    tex.refresh();
    return key;
  }

  /** Floating islands and a soft cloud for the parallax layers. */
  private ensureParallaxTextures(): void {
    const island = (key: string, seed: number, pine: boolean) => {
      if (this.textures.exists(key)) return;
      const W = 360;
      const H = 300;
      const tex = this.textures.createCanvas(key, W, H);
      if (!tex) return;
      const ctx = tex.getContext();
      const rng = new Random(seed);
      const top = 120;
      // Rocky underside
      const rock = ctx.createLinearGradient(0, top, 0, H);
      rock.addColorStop(0, '#b08a66');
      rock.addColorStop(1, '#6d5440');
      ctx.fillStyle = rock;
      ctx.beginPath();
      ctx.moveTo(30, top);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        ctx.lineTo(30 + t * 300, top + Math.sin(t * Math.PI) * rng.range(120, 170) + rng.range(-10, 10));
      }
      ctx.lineTo(330, top);
      ctx.closePath();
      ctx.fill();
      // Grass cap
      const grass = ctx.createLinearGradient(0, top - 20, 0, top + 20);
      grass.addColorStop(0, '#a6e27a');
      grass.addColorStop(1, '#5fae47');
      ctx.fillStyle = grass;
      ctx.beginPath();
      ctx.ellipse(180, top, 158, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      // Trees
      for (let k = 0; k < 3; k++) {
        const tx = 110 + k * 70 + rng.range(-10, 10);
        const ty = top - 4;
        ctx.fillStyle = '#6b4424';
        ctx.fillRect(tx - 4, ty - 40, 8, 40);
        if (pine) {
          ctx.fillStyle = k % 2 ? '#3f8a48' : '#4f9a52';
          ctx.beginPath();
          ctx.moveTo(tx, ty - 110);
          ctx.lineTo(tx - 30, ty - 30);
          ctx.lineTo(tx + 30, ty - 30);
          ctx.closePath();
          ctx.fill();
        } else {
          const g = ctx.createRadialGradient(tx - 10, ty - 70, 4, tx, ty - 60, 36);
          g.addColorStop(0, '#b4ec86');
          g.addColorStop(1, '#4b943a');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(tx, ty - 60, 32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      tex.refresh();
    };
    island('tw-island-a', 11, false);
    island('tw-island-b', 23, true);
    if (!this.textures.exists('tw-cloud')) {
      const tex = this.textures.createCanvas('tw-cloud', 420, 200);
      if (tex) {
        const ctx = tex.getContext();
        const puffs: [number, number, number][] = [
          [110, 120, 60],
          [190, 95, 78],
          [280, 115, 62],
          [340, 135, 44],
          [70, 145, 40],
        ];
        for (const [px, py, pr] of puffs) {
          const g = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.4, pr * 0.2, px, py, pr);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.8, 'rgba(240,248,255,0.95)');
          g.addColorStop(1, 'rgba(220,235,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }
        tex.refresh();
      }
    }
  }
}

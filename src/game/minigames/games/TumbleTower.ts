import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { COLORS, CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../constants';
import { CHARACTERS } from '../../data/characters';
import type { VirtualControls } from '../../input/PlayerInput';
import { glyphKindFor, makeGlyph } from '../../ui/ControllerPrompt';
import { drawPlayerShape } from '../../ui/PlayerBadge';
import { addText } from '../../ui/theme';
import { Random } from '../../util/Random';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';

// --- World (side view; world y grows downwards and the camera scrolls up) ---------------------
/** Walking surface of the ground floor (world y). The view starts at scrollY 0. */
const START_Y = 980;
/** Climbable height (100 px = 1 m): the summit ledge sits this far above the floor. */
const TOWER_H = 5000;
const PX_PER_M = 100;
const SUMMIT_Y = START_Y - TOWER_H;
/** Horizontal play span in front of the tower wall (the wall art's drum spans x 280..1640). */
const PLAY_X0 = 300;
const PLAY_X1 = 1620;
/** Climbers can't leave the tower face. */
const WALL_L = PLAY_X0 - 30;
const WALL_R = PLAY_X1 + 30;
/** Plank rows: vertical spacing (px) and jitter; "grab" rows are too tall to jump — grab the ledge. */
const ROW_DY = 170;
const ROW_JITTER = 12;
const GRAB_STEP_DY = 248;
const GRAB_ROWS = [6, 12, 18, 23];
const SUMMIT_W = 900;
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

type PlatKind = 'ground' | 'static' | 'moving' | 'tipping' | 'crumble' | 'summit';
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
  grabRow: boolean;
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
  hint: Phaser.GameObjects.Container | null;
  speed: number;
  jumpV: number;
  ai: Brain;
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
    this.cameras.main.setScroll(0, 0);
    this.buildBackdrop();
    this.buildTower();
    this.buildSigns();
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
      hint,
      speed: RUN_SPEED * h.speed,
      jumpV: JUMP_V * (1 + (h.jump - 1) * 0.5),
      ai: { target: null, retarget: 0, jumpAt: -1, holdA: false, aimErr: 0, willGrab: false, grabAt: -1, takeoffY: START_Y },
    });
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
  private addPlat(kind: PlatKind, x: number, y: number, w: number, grabRow = false): Plat {
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
      grabRow,
      view: this.add.container(x, y).setDepth(kind === 'ground' ? 90 : 100),
      plank: null,
    };
    this.plats.push(q);
    return q;
  }

  /** Seeded zigzag of plank rows from the floor to the summit, plus side branches. */
  private buildTower(): void {
    const rng = this.rng;
    this.addPlat('ground', 960, START_Y, WALL_R - WALL_L + 200);
    let y = START_Y;
    let prevX = 960;
    let prevW = 520;
    let prevKind: PlatKind = 'ground';
    let dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
    for (let row = 1; row < 60; row++) {
      const remaining = y - SUMMIT_Y;
      if (remaining <= 185) break;
      const grab = GRAB_ROWS.includes(row) && remaining > GRAB_STEP_DY + 200;
      let dy = grab ? GRAB_STEP_DY : ROW_DY + rng.range(-ROW_JITTER, ROW_JITTER);
      if (!grab && remaining - dy < 110) dy = remaining - 140;
      y -= dy;
      const f = (START_Y - y) / TOWER_H;
      const w = Math.round(rng.range(240, 310) - f * 50);
      let kind: PlatKind = 'static';
      if (!grab && row > 2 && !GRAB_ROWS.includes(row + 1)) {
        const calm: number = prevKind !== 'static' && prevKind !== 'ground' ? 0.5 : 1;
        const pm: number = (0.15 + 0.2 * f) * calm;
        const pt = (0.1 + 0.15 * f) * calm;
        const pc = (0.06 + 0.12 * f) * calm;
        const r = rng.next();
        kind = r < pm ? 'moving' : r < pm + pt ? 'tipping' : r < pm + pt + pc ? 'crumble' : 'static';
      }
      let x: number;
      if (grab) {
        // Tall step: overlap the plank below so you can stand beside this one's end and grab it.
        const shift = (prevW + w) / 2 - rng.range(80, 120);
        x = prevX + dir * shift;
        if (x - w / 2 < PLAY_X0 || x + w / 2 > PLAY_X1) {
          dir = dir > 0 ? -1 : 1;
          x = prevX + dir * shift;
        }
      } else {
        if (rng.chance(0.22)) dir = dir > 0 ? -1 : 1;
        const shift = rng.range(190, 320);
        x = prevX + dir * shift;
        if (x - w / 2 < PLAY_X0 + 10 || x + w / 2 > PLAY_X1 - 10) {
          dir = dir > 0 ? -1 : 1;
          x = prevX + dir * shift;
        }
      }
      x = Phaser.Math.Clamp(x, PLAY_X0 + w / 2 + 10, PLAY_X1 - w / 2 - 10);
      const q = this.addPlat(kind, x, y, w, grab);
      if (kind === 'moving') {
        q.amp = Phaser.Math.Clamp(rng.range(90, 170), 40, Math.max(40, Math.min(x - w / 2 - PLAY_X0, PLAY_X1 - x - w / 2)));
        q.period = rng.range(2.8, 4.4);
        q.phase = rng.range(0, Math.PI * 2);
      }
      // Side branch: an alternative plank across the tower at about the same height.
      if (!grab && row > 1 && rng.chance(0.42)) {
        const bw = Math.round(rng.range(200, 250));
        const side = x < 960 ? 1 : -1;
        const bx = x + side * rng.range(440, 620);
        if (bx - bw / 2 > PLAY_X0 && bx + bw / 2 < PLAY_X1) {
          const bk: PlatKind = rng.chance(0.72) ? 'static' : rng.pick(['tipping', 'crumble'] as PlatKind[]);
          this.addPlat(bk, bx, y + rng.range(-24, 24), bw);
        }
      }
      prevX = x;
      prevW = w;
      prevKind = kind;
    }
    this.addPlat('summit', 960, SUMMIT_Y, SUMMIT_W);
    for (const q of this.plats) this.buildPlatView(q);
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
      // The tower's crown: battlements under the ledge, a banner pole above.
      back.fillStyle(0x7d7262, 1);
      back.fillRect(-w / 2, 10, w, 120);
      back.fillStyle(0xd9ccb4, 1);
      back.fillRect(-w / 2, 0, w, 36);
      for (let i = 0; i < 12; i++) {
        const bx = -w / 2 + i * (w / 12);
        back.fillStyle(i % 2 ? 0xc9bca6 : 0xb8ab94, 1);
        back.fillRoundedRect(bx + 4, 42, w / 12 - 8, 34, 6);
      }
      back.fillStyle(0x06141a, 0.25);
      back.fillRect(-w / 2, 128, w, 10);
      front.fillStyle(0xf4b83b, 1);
      front.fillRect(-w / 2, -2, w, 8);
      front.fillStyle(0xffe08a, 1);
      front.fillRect(-w / 2, -2, w, 3);
      v.add([back, front]);
      this.summitFlag = this.add.graphics().setDepth(95);
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
      // Single pivot: a beam into the wall with a brass hub.
      back.fillStyle(0x4a2c10, 1);
      back.fillRect(-9, 18, 18, 60);
      back.fillStyle(0x7a4f22, 1);
      back.fillRect(-5, 18, 8, 60);
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
          audio.play('crack', { volume: 0.25, throttleMs: 200 });
        }
        break;
      case 'wobble': {
        // Telegraph: an ever-faster rattle before it goes.
        const k = q.t / TIP_WOBBLE_MS;
        q.angle = Math.sin(q.t * (0.03 + 0.05 * k)) * (1.5 + 3 * k);
        if (q.t >= TIP_WOBBLE_MS) {
          const riders = this.ridersOf(q);
          const bias = riders.reduce((a, cl) => a + (cl.x - q.x), 0);
          q.tipDir = bias === 0 ? (Math.random() < 0.5 ? -1 : 1) : bias > 0 ? 1 : -1;
          q.state = 'swing';
          q.t = 0;
          audio.play('whoosh', { volume: 0.45 });
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
    this.syncVisuals();
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
    const h = START_Y - q.y;
    if (h > cl.best + 1) {
      const before = Math.floor(cl.best / PX_PER_M);
      cl.best = h;
      cl.bestAt = this.elapsed;
      cl.p.score = Math.floor(h / PX_PER_M);
      const now = Math.floor(h / PX_PER_M);
      if (Math.floor(now / 10) > Math.floor(before / 10) && q.kind !== 'summit') {
        audio.play('chipGain', { volume: 0.35, rate: 0.9 });
        this.fx.floatText(cl.x, q.y - 150, `${Math.floor(now / 10) * 10} m!`, '#ffe08a', { size: 40, rise: 70, duration: 800 });
        this.fx.sparks(cl.x, q.y - 60, 12);
      }
    }
    if (q.kind === 'summit') this.reachSummit(cl);
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
    this.fx.confetti(cl.x, SUMMIT_Y - 200, 70);
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
      if (!this.solid(q) || q.kind === 'tipping' || q.kind === 'crumble') continue;
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
    if (this.phase !== 'playing') this.syncVisuals();
  }

  private syncVisuals(): void {
    const cam = this.camY;
    this.wall.tilePositionY = cam / this.wall.tileScaleY;
    this.altTint.setAlpha(Phaser.Math.Clamp(-cam / -CAM_TOP, 0, 1) * 0.55);
    for (const q of this.plats) {
      if (q.kind === 'ground' || q.kind === 'summit') continue;
      if (q.kind === 'crumble' && q.state === 'gone') continue;
      let sx = 0;
      if (q.kind === 'crumble' && q.state === 'crack') sx = Math.sin(this.clock / 22) * 3;
      q.view.setPosition(q.x + sx, q.y).setAngle(q.angle);
      // Telegraph tint while a tipping plank rattles.
      if (q.kind === 'tipping' && q.plank) {
        if (q.state === 'wobble' && Math.floor(q.t / 110) % 2 === 0) q.plank.setTint(0xffb0a0);
        else q.plank.clearTint();
      }
    }
    this.drawSummitFlag();
    for (const cl of this.climbers) this.syncClimber(cl);
    this.drawGauge();
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

  /** Height gauge: everyone's current height, their best, and the visible band. */
  private drawGauge(): void {
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
    g.lineStyle(3, 0xffffff, 0.6);
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
    this.climbers.forEach((cl, i) => {
      const col = PLAYER_COLORS[cl.p.slot];
      g.fillStyle(col, 1);
      g.fillRect(x - 16, map(cl.best) - 2, 32, 4);
      const hy = map(START_Y - cl.y);
      const off = i % 2 === 0 ? -1 : 1;
      drawPlayerShape(g, PLAYER_SHAPES[cl.p.slot], x + off * 20, hy, 9, col, 0xffffff, 2);
    });
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

  private pickTarget(cl: Climber): Plat | null {
    const cur = cl.on;
    if (!cur) return null;
    const sk = this.skill(cl.p);
    const usable = (q: Plat) => this.solid(q) && !(q.kind === 'crumble' && q.state === 'crack') && !(q.kind === 'tipping' && q.state !== 'idle');
    const cands: { q: Plat; score: number }[] = [];
    for (const q of this.reachable(cl, cur, 40)) {
      if (!usable(q)) continue;
      const rise = cur.y - q.y;
      let score = rise * 1.2 - this.gapBetween(cur, q) * 0.5;
      if (q.kind === 'tipping') score -= 70;
      if (q.kind === 'crumble') score -= 45;
      if (q.kind === 'moving') score -= 25;
      if (this.grabOnly(cl, q)) score -= 60;
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
    if (cands.length === 0) return null;
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
          const edgeL = tl - 30;
          const edgeR = tr + 30;
          takeoff = Math.abs(edgeL - cl.x) < Math.abs(edgeR - cl.x) && edgeL > cl0 ? edgeL : edgeR < cr0 ? edgeR : edgeL;
          takeoff = Phaser.Math.Clamp(takeoff, cl0, cr0);
        } else if (cur.y - T.y < 20) {
          // Across or down: head off the end nearest the target (the hop is optional).
          takeoff = tx > cur.x ? cur.x + cur.w / 2 + 40 : cur.x - cur.w / 2 - 40;
        } else if (tr > cl0 + 50 && tl < cr0 - 50) {
          takeoff = Phaser.Math.Clamp(tx, Math.max(cl0, tl + 30), Math.min(cr0, tr - 30));
        } else takeoff = tx > cur.x ? cr0 : cl0;
        const dx = takeoff - cl.x;
        mx = Math.abs(dx) > 12 ? Phaser.Math.Clamp(dx / 60, -1, 1) : 0;
        const feasible = grab ? Math.abs(dx) < 26 : this.jumpLands(cl, T);
        if (feasible || (urgent && Math.random() < 0.08)) {
          if (b.jumpAt < 0) b.jumpAt = this.elapsed + sk.reaction * (0.3 + Math.random() * 0.5) * (urgent ? 0.4 : 1);
        } else if (Math.random() < sk.mistake * 0.012) {
          // Impatient leap that probably falls short.
          b.jumpAt = this.elapsed;
        } else b.jumpAt = -1;
        if (b.jumpAt >= 0 && this.elapsed >= b.jumpAt) {
          jumpNow = true;
          b.jumpAt = -1;
          b.holdA = true;
          b.aimErr = gauss() * sk.aimNoise * 45;
          b.willGrab = Math.random() < sk.accuracy + 0.05;
          b.grabAt = -1;
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
      if (lg && lg.plat.y < b.takeoffY - 30 && b.willGrab && (cl.vy > -260 || (T && this.grabOnly(cl, T, b.takeoffY)))) {
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
      const score = Math.round(cl.best) * 100000 + Math.max(0, 99999 - Math.floor(cl.bestAt));
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
        body.addColorStop(0, 'rgba(255,255,255,0.08)');
        body.addColorStop(0.72, 'rgba(180,240,255,0.16)');
        body.addColorStop(0.92, 'rgba(160,220,255,0.55)');
        body.addColorStop(1, 'rgba(230,250,255,0.9)');
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

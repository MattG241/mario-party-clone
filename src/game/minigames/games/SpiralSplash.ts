import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS } from '../../constants';
import { CHARACTERS } from '../../data/characters';
import type { VirtualControls } from '../../input/PlayerInput';
import { LITE } from '../../perf';
import { settings } from '../../save/SettingsManager';
import { Random } from '../../util/Random';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { drift, steer } from '../common';
import { banner, kick } from '../juice';
import { AFX, burst, ensureArenaFxTextures, every, Spray } from './arenaFx';
import { closestApproach, currentAt, hopTarget, insideEllipse, nearestGap, padGap, padUnder, survivorScore, type Disc } from './spiralSplashLogic';

// --- Layout (screen px unless noted). Keep in sync with POND_C / POND_R in scripts/art/mg_arenas.py. --
/** Water ellipse on screen. */
const POND = { cx: 960, cy: 640, rx: 760, ry: 360 };
/** Tilt of the orthographic pond camera from straight down (40° elevation). */
const TILT = (50 * Math.PI) / 180;
/** Screen px per world unit of depth (world units are screen px across, measured from the pond centre). */
const DEPTH_K = Math.cos(TILT);
/** The water in world units. */
const WATER = { rx: POND.rx, ry: POND.ry / DEPTH_K };
/** Lily pad footprint radius in world units at the start (screen: 190 × 122 px). */
const PAD_R = 95;
/**
 * Rendered pad art ('rendered-mg-pad'): footprint radius 100 px at scale 1, origin at its centre.
 * Anchor and render scale come from 'rendered-mg-sprites' (mg/sprites.json) when present.
 */
const PAD_ART_R = 100;
/** Fallback pad texture: a top-down disc of this radius in a 256×256 canvas. */
const PAD_TEX_R = 118;
/** Pads keep inside this ellipse (world units) so they never touch the banks. */
const PAD_FIELD = { rx: 610, ry: 440 };
/** Start rings (world units): three pads inside, the rest outside. */
const RING_IN = 205;
const RING_OUT = 420;
/** The "spiral": inner ring turns one way, outer ring the other, with gentle radial breathing. */
const CURRENT = { split: 310, inner: 0.13, outer: -0.085, breathe: 14, breatheRate: 0.35 };
/** Flight height of a water blast above the water (screen px). */
const BLAST_Z = 66;
/** The water-streak VFX frame points slightly uphill; rotate it back so it trails the blast. */
const STREAK_TILT = 0.12;

// --- Tuning ----------------------------------------------------------------------------------------
const CHAR_SCALE = 0.55;
const PLAYER_R = 26;
const WALK = 290;
const LIVES = 3;
/** How far past a rim the feet may stray before splashing (world units). */
const FOOT_TOL = 4;
/** Outer band of a pad where walking outward (with nowhere to hop) is slowed: a teeter, not a wall. */
const RIM_BAND = 16;
const PAD_GAP = 26;
const HOP_RANGE = 240;
const HOP_INSET = 30;
/** Hops also look this far either side of the stick direction (forgiving for 8-way keyboards). */
const HOP_SPREAD = 0.52;
const RESPAWN_MS = 1200;
const INVULN_MS = 1600;
const BLAST_SPEED = 950;
const BLAST_LIFE = 760;
const BLAST_R = 24;
const BLAST_CD = 520;
const KNOCK = 400;
const HIT_STUN = 330;
/** Drag while knocked back: low, so a hit slides you most of the way to the rim. */
const KNOCK_DRAG = 3.5;
const RETICLE_D = 200;
/** Pads shrink in telegraphed steps (ms since GO), each to this fraction of the previous size. */
const SHRINK_AT = [15000, 30000, 45000];
const SHRINK_STEP = 0.93;
const SHRINK_WARN = 1100;
const SUBSTEP = 16;
/** Freeze-frames: a blast landing, and a splash into the pond (ms). */
const HIT_STOP = 70;
const SPLASH_STOP = 60;
const RAD = 180 / Math.PI;
/** Water droplets: blues that read against the pale water, and white that reads over the pads. */
const DROP_TINTS = [0x5ec8ff, 0x9fe2ff, 0xffffff];
/** A fish leaps every so often (ms between leaps). */
const FISH_WAIT: [number, number] = [5000, 9000];

interface Pad extends Disc {
  id: number;
  vx: number;
  vy: number;
  /** Displacement during the current sub-step (carries anyone standing on it). */
  dx: number;
  dy: number;
  spin: number;
  spinW: number;
  bob: number;
  dip: number;
  bobY: number;
  /** Countdown to the next wake ripple at the rim. */
  wakeT: number;
  root: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Container | null;
  top: Phaser.GameObjects.Image;
  shade: Phaser.GameObjects.Image;
  rim: Phaser.GameObjects.Image;
}

type WState = 'pad' | 'hop' | 'sink' | 'out';

interface SBrain {
  think: number;
  target: Wader | null;
  aimErr: number;
  fireWait: number;
  hopPad: Pad | null;
  hopT: number;
  dodgeT: number;
  dx: number;
  dy: number;
  wanderT: number;
  wx: number;
  wy: number;
  holdX: number;
  holdY: number;
  decided: Map<number, number>;
}

interface Wader {
  p: MgPlayer;
  c: Character;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pad: Pad | null;
  state: WState;
  lives: number;
  hits: number;
  stunT: number;
  invuln: number;
  fireCd: number;
  /** Aim (unit, world) and facing. */
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  hop: { pad: Pad; ox: number; oy: number; sx: number; sy: number; t: number; T: number; h: number } | null;
  /** Height above the pad while dropping back in after a splash (screen px). */
  z: number;
  vz: number;
  sinkT: number;
  teeter: boolean;
  weight: number;
  brain: SBrain;
  /** Countdowns to the next bit of spray: the wake of a knockback, drips while dropping back in. */
  wakeT: number;
  dripT: number;
  /** Resting height of the player badge (it rises with the sprite during hops and drop-ins). */
  markerY: number;
}

interface Blast {
  active: boolean;
  shot: number;
  owner: Wader | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  core: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  streak: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** Countdown to the next droplet shed along the way. */
  dripT: number;
}

/** A dragonfly: hovers, then darts somewhere new over the water. */
interface Fly {
  img: Phaser.GameObjects.Image;
  /** Water-plane position (world units) and height above the water (screen px). */
  x: number;
  y: number;
  h: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  T: number;
  hover: boolean;
}

/** The pond's fish: a leap from (x0, y0) to (x1, y1) with a peak height h (screen px). */
interface Fish {
  img: Phaser.GameObjects.Image;
  on: boolean;
  wait: number;
  t: number;
  T: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
}

interface Ripple {
  img: Phaser.GameObjects.Image;
  t: number;
  life: number;
  size: number;
}

/**
 * Spiral Splash — a lily pond at 3/4 view. Pads drift on counter-rotating currents; walk off the
 * rim towards another pad to hop across. RT fires a water blast along the right stick (or your
 * facing); hits knock rivals back. Fall in three times and you're out. Last dry adventurer wins.
 */
export class SpiralSplashScene extends BaseMinigame {
  private pads: Pad[] = [];
  private waders: Wader[] = [];
  private blasts: Blast[] = [];
  private ripples: Ripple[] = [];
  private sparkles: { img: Phaser.GameObjects.Image; t: number; period: number }[] = [];
  private swirls: { img: Phaser.GameObjects.Image; w: number }[] = [];
  private aimG!: Phaser.GameObjects.Graphics;
  private rendered = false;
  private renderedPad = false;
  private padArtK = 1;
  private padScale = 1;
  private padScaleFrom = 1;
  private padScaleTo = 1;
  private shrinkT = 0;
  private shrinkIdx = 0;
  private warnT = 0;
  private rippleT = 0;
  private shotId = 0;
  private finished = false;
  /** Water droplets (blasts, hits, splashes, shake-offs) and white foam (knockback wakes). */
  private drops!: Spray;
  private foam!: Spray;
  private fish: Fish | null = null;
  private flies: Fly[] = [];

  constructor() {
    super('mg-spiral-splash');
  }

  // --- Arena ---------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 60000;
    this.pads = [];
    this.waders = [];
    this.blasts = [];
    this.ripples = [];
    this.sparkles = [];
    this.swirls = [];
    this.padScale = this.padScaleFrom = this.padScaleTo = 1;
    this.shrinkT = 0;
    this.shrinkIdx = 0;
    this.warnT = 0;
    this.rippleT = 0;
    this.shotId = 0;
    this.finished = false;
    this.fish = null;
    this.flies = [];
    this.rendered = this.textures.exists('rendered-scene-pond');
    this.renderedPad = this.textures.exists('rendered-mg-pad');
    const sky = this.textures.exists('rendered-sky-day') ? 'rendered-sky-day' : 'bg-sky';
    this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
    if (this.rendered) this.add.image(0, 0, 'rendered-scene-pond').setOrigin(0).setDepth(-50);
    else {
      makePondTextures(this);
      this.add.image(0, 0, 'ss-pond-bg').setOrigin(0).setDepth(-50);
    }
    if (!this.renderedPad) makePadTextures(this);
    makeSwirlTextures(this);
    ensureArenaFxTextures(this);
    makePondLifeTextures(this);
    this.buildWater();
    this.buildPads();
    this.aimG = this.add.graphics().setDepth(3000);
    // Droplets are in the air (over everyone); foam lies on the water and pads (under everyone).
    this.drops = new Spray(this, AFX.drop, {
      depth: 2900,
      reserve: burst(140),
      lifespan: [380, 620],
      gravity: 1500,
      scale: { start: 1.6, end: 0.9 },
      alpha: { start: 1, end: 0.3 },
      tint: DROP_TINTS,
    });
    this.foam = new Spray(this, 'fx-dot', {
      depth: 999,
      reserve: burst(70),
      lifespan: [320, 520],
      scale: { start: 0.8, end: 1.9 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffffff, 0xe8fbff],
    });
    this.buildPondLife();
  }

  /** A fish that leaps now and then, and a dragonfly or two patrolling the water. */
  private buildPondLife(): void {
    this.fish = { img: this.add.image(0, 0, 'ss-fish').setVisible(false), on: false, wait: 3500 + Math.random() * 3000, t: 0, T: 700, x0: 0, y0: 0, x1: 0, y1: 0, h: 70 };
    for (let i = 0; i < (LITE ? 1 : 2); i++) {
      const p = this.waterPoint(140);
      const img = this.add.image(0, 0, 'ss-fly', 'a').setScale(1.45);
      this.flies.push({ img, x: p.x, y: p.y, h: 70 + i * 30, sx: p.x, sy: p.y, tx: p.x, ty: p.y, t: 0, T: 400 + i * 700, hover: true });
    }
  }

  /** Animated water: counter-rotating current streaks, sparkles and ripple rings. */
  private buildWater(): void {
    for (const [key, w] of [
      ['ss-swirl-out', CURRENT.outer],
      ['ss-swirl-in', CURRENT.inner],
    ] as const) {
      const holder = this.add.container(POND.cx, POND.cy).setScale(1, DEPTH_K).setDepth(20);
      const img = this.add.image(0, 0, key).setScale(2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55);
      holder.add(img);
      this.swirls.push({ img, w });
    }
    for (let i = 0; i < 14; i++) {
      const img = this.add.image(0, 0, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setTint(0xe8fbff).setDepth(30).setAlpha(0);
      this.sparkles.push({ img, t: Math.random(), period: 0.8 + Math.random() * 0.9 });
    }
    for (let i = 0; i < 22; i++) {
      const img = this.add.image(0, 0, 'fx-ring').setTint(0xe8fbff).setDepth(25).setVisible(false);
      this.ripples.push({ img, t: 1, life: 1, size: 1 });
    }
  }

  private waterPoint(margin: number): { x: number; y: number } {
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() * 2 - 1) * WATER.rx;
      const y = (Math.random() * 2 - 1) * WATER.ry;
      if (!insideEllipse(x, y, WATER.rx, WATER.ry, margin)) continue;
      if (padUnder(this.pads, x, y, 20) >= 0) continue;
      return { x, y };
    }
    return { x: 0, y: WATER.ry * 0.8 };
  }

  /** A ripple ring on the water (world position). */
  private ripple(x: number, y: number, size: number, life = 1300): void {
    const r = this.ripples.find((q) => q.t >= q.life) ?? this.ripples[0];
    r.t = 0;
    r.life = life;
    r.size = size;
    r.img.setPosition(POND.cx + x, POND.cy + y * DEPTH_K).setVisible(true);
  }

  private buildPads(): void {
    const n = this.players.length;
    const count = n <= 2 ? 7 : n === 3 ? 8 : 9;
    const outer = count - 3;
    // Outer ring spaced so the players' start pads sit on the diagonals (P1 top-left … P4 bottom-right).
    const offset = outer >= 6 ? -150 : outer === 5 ? -162 : -135;
    const rnd = new Random(this.launch.seed + 7);
    for (let i = 0; i < outer; i++) {
      const a = ((offset + (i * 360) / outer) * Math.PI) / 180;
      this.makePad(Math.cos(a) * RING_OUT, Math.sin(a) * RING_OUT, rnd);
    }
    for (const deg of [-90, 30, 150]) {
      const a = (deg * Math.PI) / 180;
      this.makePad(Math.cos(a) * RING_IN, Math.sin(a) * RING_IN, rnd);
    }
  }

  private makePad(x: number, y: number, rnd: Random): Pad {
    const id = this.pads.length;
    const root = this.add.container(0, 0).setDepth(100 + id * 0.01);
    // Soft shadow on the water and a faint wet rim, both squashed by the camera tilt.
    const shade = this.add.image(10, 7, 'fx-shadow').setTint(0x06303a).setAlpha(0.55);
    const rim = this.add.image(0, 0, 'fx-ring').setTint(0xe8fbff).setAlpha(0.28);
    root.add([shade, rim]);
    let disc: Phaser.GameObjects.Container | null = null;
    let top: Phaser.GameObjects.Image;
    if (this.renderedPad) {
      const all = this.cache.json.get('rendered-mg-sprites') as Record<string, { anchor?: [number, number]; scale?: number }> | undefined;
      const anchor = all?.pad?.anchor ?? [0.5, 0.5];
      this.padArtK = 1 / (all?.pad?.scale ?? 1);
      top = this.add.image(0, 0, 'rendered-mg-pad').setOrigin(anchor[0], anchor[1]).setFlipX(rnd.chance(0.5));
      root.add(top);
      // The rendered pad carries its own baked shadow.
      shade.setVisible(false);
    } else {
      // Top-down pad art inside a container squashed by the tilt, so it can spin like a real pad.
      disc = this.add.container(0, 0).setScale(1, DEPTH_K);
      const key = `ss-pad-${id % 3}`;
      const under = this.add.image(0, 8 / DEPTH_K, key).setTint(0x2a5e2a);
      top = this.add.image(0, 0, key);
      disc.add([under, top]);
      root.add(disc);
    }
    const pad: Pad = {
      id,
      x,
      y,
      r: PAD_R,
      vx: 0,
      vy: 0,
      dx: 0,
      dy: 0,
      spin: rnd.range(0, Math.PI * 2),
      spinW: rnd.range(0.06, 0.16) * (rnd.chance(0.5) ? 1 : -1),
      bob: rnd.range(0, Math.PI * 2),
      dip: 0,
      bobY: 0,
      wakeT: rnd.range(300, 2000),
      root,
      disc,
      top,
      shade,
      rim,
    };
    this.pads.push(pad);
    this.placePad(pad);
    return pad;
  }

  /** Sprite placement for a pad (origin = centre of its footprint on the water). */
  private placePad(pad: Pad): void {
    pad.bobY = Math.sin(this.time.now / 520 + pad.bob) * 2.2 + pad.dip;
    pad.root.setPosition(POND.cx + pad.x, POND.cy + pad.y * DEPTH_K + pad.bobY);
    const shadeS = (pad.r * 2.5) / 128;
    pad.shade.setScale(shadeS, shadeS * DEPTH_K);
    const rimS = ((pad.r + 12) * 2) / 128;
    pad.rim.setScale(rimS, rimS * DEPTH_K);
    if (pad.disc) {
      pad.disc.setScale(1, DEPTH_K);
      const s = pad.r / PAD_TEX_R;
      for (const img of pad.disc.list as Phaser.GameObjects.Image[]) img.setScale(s).setRotation(pad.spin);
    } else pad.top.setScale((pad.r / PAD_ART_R) * this.padArtK);
  }

  // --- Players -------------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const want = [-150, -30, 150, 30][p.slot % 4];
    const outer = this.pads.slice(0, this.pads.length - 3);
    let pad = outer[index % outer.length];
    let best = Infinity;
    for (const pd of outer) {
      if (this.waders.some((w) => w.pad === pd)) continue;
      const a = (Math.atan2(pd.y, pd.x) * 180) / Math.PI;
      const d = Math.abs(((a - want + 540) % 360) - 180);
      if (d < best) {
        best = d;
        pad = pd;
      }
    }
    const c = new Character(this, POND.cx + pad.x, POND.cy + pad.y * DEPTH_K, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(pad.x > 0);
    p.character = c;
    const fx = pad.x > 0 ? -1 : 1;
    p.score = LIVES;
    this.waders.push({
      p,
      c,
      x: pad.x,
      y: pad.y,
      vx: 0,
      vy: 0,
      pad,
      state: 'pad',
      lives: LIVES,
      hits: 0,
      stunT: 0,
      invuln: 0,
      fireCd: 600,
      ax: fx,
      ay: 0,
      fx,
      fy: 0,
      hop: null,
      z: 0,
      vz: 0,
      sinkT: 0,
      teeter: false,
      wakeT: 0,
      dripT: 0,
      markerY: c.marker?.y ?? 0,
      weight: CHARACTERS[p.characterId].handling.weight,
      brain: {
        think: 300 + index * 110,
        target: null,
        aimErr: 0,
        fireWait: 1200 + index * 300,
        hopPad: null,
        hopT: 0,
        dodgeT: 0,
        dx: 0,
        dy: 0,
        wanderT: 0,
        wx: 0,
        wy: 0,
        holdX: 0,
        holdY: 0,
        decided: new Map(),
      },
    });
  }

  protected override onStart(): void {
    for (const w of this.waders) w.c.play('wave');
    audio.play('splash', { volume: 0.4 });
  }

  protected override hudLabel(p: MgPlayer): string {
    const w = this.waders.find((x) => x.p === p);
    return w ? (w.lives > 0 ? `Lives ${w.lives}` : 'Out') : '';
  }

  protected override hudPips(p: MgPlayer): { filled: number; total: number } {
    const w = this.waders.find((x) => x.p === p);
    return { filled: Math.max(0, w?.lives ?? LIVES), total: LIVES };
  }

  private screen(x: number, y: number): { x: number; y: number } {
    return { x: POND.cx + x, y: POND.cy + y * DEPTH_K };
  }

  // --- Frame ---------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.updateShrink(dt);
    this.updateActions(dt);
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.stepPads(sdt);
      for (const w of this.waders) this.stepWader(w, sdt);
      this.separateWaders();
      this.stepBlasts(sdt);
    }
    this.syncVisuals(dt);
  }

  /** Telegraphed pad shrinking: warning flash and banner, then a quick squeeze. */
  private updateShrink(dt: number): void {
    const next = SHRINK_AT[this.shrinkIdx];
    if (next !== undefined && this.warnT <= 0 && this.elapsed >= next - SHRINK_WARN) {
      this.warnT = SHRINK_WARN;
      audio.play('eventAlert', { volume: 0.5 });
      banner(this, 'PADS SHRINKING!', { y: 250, size: 84, color: CSS.goldLight, hold: 900 });
    }
    if (this.warnT > 0) {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        this.shrinkIdx++;
        this.padScaleFrom = this.padScale;
        this.padScaleTo = this.padScale * SHRINK_STEP;
        this.shrinkT = 700;
        audio.play('crack', { volume: 0.35 });
      }
    }
    if (this.shrinkT > 0) {
      this.shrinkT = Math.max(0, this.shrinkT - dt);
      const u = 1 - this.shrinkT / 700;
      this.padScale = this.padScaleFrom + (this.padScaleTo - this.padScaleFrom) * (u * u * (3 - 2 * u));
    }
    for (const pad of this.pads) pad.r = PAD_R * this.padScale;
  }

  /** Buttons and timers once per frame (inputs are edge-triggered); motion runs in sub-steps. */
  private updateActions(dt: number): void {
    for (const w of this.waders) {
      w.fireCd = Math.max(0, w.fireCd - dt);
      w.invuln = Math.max(0, w.invuln - dt);
      if (w.stunT > 0) w.stunT -= dt;
      if (w.state === 'sink') {
        w.sinkT -= dt;
        if (w.sinkT <= 0) this.respawn(w);
        continue;
      }
      if (w.state === 'out') continue;
      const c = w.p.controls;
      const mm = Math.hypot(c.moveX, c.moveY);
      if (mm > 0.3 && w.stunT <= 0) {
        w.fx = c.moveX / mm;
        w.fy = c.moveY / mm;
      }
      const am = Math.hypot(c.aimX, c.aimY);
      if (am > 0.3) {
        w.ax = c.aimX / am;
        w.ay = c.aimY / am;
      } else {
        w.ax = w.fx;
        w.ay = w.fy;
      }
      if ((c.held('RT') || c.rt > 0.5) && w.fireCd <= 0 && w.stunT <= 0 && w.z <= 0) this.fire(w);
    }
  }

  private stepPads(sdt: number): void {
    const s = sdt / 1000;
    const t = this.elapsed / 1000;
    const k = 1 - Math.exp(-1.1 * s);
    for (const p of this.pads) {
      const f = currentAt(p.x, p.y, t, CURRENT);
      p.vx += (f.vx - p.vx) * k;
      p.vy += (f.vy - p.vy) * k;
      // Soft bank: steer back inside the pad field.
      const e = Math.sqrt((p.x * p.x) / (PAD_FIELD.rx * PAD_FIELD.rx) + (p.y * p.y) / (PAD_FIELD.ry * PAD_FIELD.ry));
      if (e > 1) {
        const m = Math.hypot(p.x, p.y) || 1;
        const push = Math.min(1, (e - 1) * 6) * 140 * s;
        p.vx -= (p.x / m) * push;
        p.vy -= (p.y / m) * push;
      }
      p.dx = p.x;
      p.dy = p.y;
    }
    // Pads nudge each other apart so they never overlap.
    for (let i = 0; i < this.pads.length; i++) {
      for (let j = i + 1; j < this.pads.length; j++) {
        const a = this.pads[i];
        const b = this.pads[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const min = a.r + b.r + PAD_GAP;
        if (d >= min) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) * 2.4 * s;
        a.vx -= nx * push;
        a.vy -= ny * push;
        b.vx += nx * push;
        b.vy += ny * push;
        const over = a.r + b.r + 6 - d;
        if (over > 0) {
          a.x -= (nx * over) / 2;
          a.y -= (ny * over) / 2;
          b.x += (nx * over) / 2;
          b.y += (ny * over) / 2;
        }
      }
    }
    for (const p of this.pads) {
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.dx = p.x - p.dx;
      p.dy = p.y - p.dy;
      p.spin += p.spinW * s;
      p.dip *= Math.exp(-7 * s);
    }
  }

  private stepWader(w: Wader, sdt: number): void {
    if (w.state === 'hop' && w.hop) {
      const h = w.hop;
      h.t += sdt;
      const u = Math.min(1, h.t / h.T);
      const tx = h.pad.x + h.ox;
      const ty = h.pad.y + h.oy;
      w.x = h.sx + (tx - h.sx) * u;
      w.y = h.sy + (ty - h.sy) * u;
      w.z = Math.sin(u * Math.PI) * h.h;
      if (u >= 1) this.land(w, h.pad);
      return;
    }
    if (w.state !== 'pad') return;
    const pad = w.pad;
    if (pad) {
      w.x += pad.dx;
      w.y += pad.dy;
    }
    if (w.z > 0) {
      // Dropping back in after a splash: no control, can't fall.
      const s = sdt / 1000;
      w.vz -= 3200 * s;
      w.z = Math.max(0, w.z + w.vz * s);
      if (w.z <= 0) this.touchDown(w);
      return;
    }
    w.teeter = false;
    if (w.stunT > 0) drift(w, sdt, KNOCK_DRAG);
    else {
      const c = w.p.controls;
      const hand = CHARACTERS[w.p.characterId].handling;
      let ix = c.moveX;
      let iy = c.moveY;
      if (pad) {
        const rx = w.x - pad.x;
        const ry = w.y - pad.y;
        const d = Math.hypot(rx, ry);
        const out = d > 1 ? (ix * rx + iy * ry) / d : 0;
        if (out > 0.3 && d > pad.r - RIM_BAND) {
          // Walking off the rim: hop if a pad is in reach that way, otherwise teeter (slowed).
          const hop = hopTarget(this.pads, this.pads.indexOf(pad), w.x, w.y, ix, iy, HOP_RANGE, HOP_INSET, HOP_SPREAD);
          if (hop) {
            this.startHop(w, this.pads[hop.pad], hop.x, hop.y, hop.dist);
            return;
          }
          w.teeter = true;
          ix -= (rx / d) * out * 0.65;
          iy -= (ry / d) * out * 0.65;
        }
      }
      steer(w, ix, iy, sdt, { maxSpeed: WALK * hand.speed, accel: 14 * hand.accel, friction: 11 });
    }
    const i = padUnder(this.pads, w.x, w.y, FOOT_TOL);
    if (i >= 0) w.pad = this.pads[i];
    else this.splash(w);
  }

  private separateWaders(): void {
    for (let i = 0; i < this.waders.length; i++) {
      const a = this.waders[i];
      if (a.state !== 'pad' || a.z > 0) continue;
      for (let j = i + 1; j < this.waders.length; j++) {
        const b = this.waders[j];
        if (b.state !== 'pad' || b.z > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = PLAYER_R * 2;
        if (d >= min || d < 1e-3) continue;
        const push = min - d;
        const wa = b.weight / (a.weight + b.weight);
        a.x -= (dx / d) * push * wa;
        a.y -= (dy / d) * push * wa;
        b.x += (dx / d) * push * (1 - wa);
        b.y += (dy / d) * push * (1 - wa);
      }
    }
  }

  private startHop(w: Wader, pad: Pad, lx: number, ly: number, dist: number): void {
    w.state = 'hop';
    const T = 240 + dist * 0.75;
    w.hop = { pad, ox: lx - pad.x, oy: ly - pad.y, sx: w.x, sy: w.y, t: 0, T, h: 46 + dist * 0.22 };
    w.teeter = false;
    w.c.play('jump', { force: true, returnTo: 'idle' });
    w.c.faceToward(POND.cx + lx);
    audio.play('jump', { volume: 0.45, rate: CHARACTERS[w.p.characterId].pitch, throttleMs: 40 });
    const q = this.screen(w.x, w.y);
    this.fx.vfx('splash', q.x, q.y - 6, { scale: 0.16, duration: 260, alpha: 0.7, depth: 1000 + q.y - 1 });
  }

  private land(w: Wader, pad: Pad): void {
    w.state = 'pad';
    w.hop = null;
    w.z = 0;
    w.pad = pad;
    w.vx *= 0.3;
    w.vy *= 0.3;
    pad.dip = 7;
    w.c.squash(0.16, 150);
    audio.play('land', { volume: 0.35, throttleMs: 40 });
    audio.play('splash', { volume: 0.12, throttleMs: 60 });
    this.ripple(pad.x, pad.y, (pad.r + 20) / 64, 700);
    // A hop that lands short of the new pad's rim is a splash.
    if (padUnder(this.pads, w.x, w.y, FOOT_TOL) < 0) this.splash(w);
  }

  /** Back on a pad after a dunking: a soaked shake-off (droplets flung off, a quick wiggle). */
  private touchDown(w: Wader): void {
    w.vz = 0;
    w.c.squash(0.18, 160);
    w.c.play('idle');
    if (w.pad) w.pad.dip = 8;
    audio.play('land', { volume: 0.4 });
    this.ripple(w.x, w.y, ((w.pad?.r ?? PAD_R) + 16) / 64, 700);
    this.time.delayedCall(130, () => {
      if (w.state !== 'pad') return;
      const q = this.screen(w.x, w.y);
      this.drops.fire(q.x, q.y - 60, burst(14), -90, 115, 160, 420, [420, 640]);
      audio.play('splash', { volume: 0.2, throttleMs: 80 });
      if (!settings.get().reducedMotion) {
        this.tweens.add({ targets: w.c.sprite, angle: { from: -10, to: 10 }, duration: 65, yoyo: true, repeat: 2, ease: 'Sine.InOut', onComplete: () => w.c.sprite.setAngle(0) });
      }
    });
  }

  private splash(w: Wader): void {
    if (w.state === 'sink' || w.state === 'out') return;
    const q = this.screen(w.x, w.y);
    w.state = 'sink';
    w.lives -= 1;
    w.p.score = Math.max(0, w.lives);
    w.sinkT = RESPAWN_MS;
    w.pad = null;
    w.hop = null;
    w.stunT = 0;
    w.z = 0;
    w.teeter = false;
    w.vx = w.vy = 0;
    w.c.setPosition(q.x, q.y + 8).setDepth(1000 + q.y);
    w.c.play('swim', { force: true });
    this.tweens.killTweensOf(w.c);
    w.c.setAlpha(1);
    this.tweens.add({ targets: w.c, y: q.y + 40, alpha: 0, delay: 380, duration: 460, ease: 'Quad.In' });
    this.fx.vfx('splash', q.x, q.y - 40, { scale: 0.85, duration: 620, depth: 1000 + q.y + 2 });
    this.fx.vfx('splash', q.x - 40, q.y - 10, { scale: 0.45, duration: 480, depth: 1000 + q.y + 1, flipX: true });
    this.fx.vfx('splash', q.x + 42, q.y - 12, { scale: 0.4, duration: 460, depth: 1000 + q.y + 1 });
    // A tall column of spray, rings rolling out across the pond, a freeze-frame and a thump down.
    this.drops.fire(q.x, q.y - 24, burst(18), -90, 60, 280, 720, [520, 820]);
    this.ripple(w.x, w.y, 1.6, 1500);
    this.time.delayedCall(180, () => this.ripple(w.x, w.y, 1.1, 1200));
    this.time.delayedCall(380, () => this.ripple(w.x, w.y, 2.2, 1700));
    this.fx.floatText(q.x, q.y - 150, 'SPLASH!', '#bff4ff', { size: 54, rise: 70, duration: 900, stroke: '#0d3b47' });
    audio.play('splash', { volume: 0.9 });
    this.hitStop(SPLASH_STOP);
    kick(this, 0, 9);
    this.fx.shake(0.004, 160);
    this.rumble(w.p, 0.7, 0.5, 260);
    if (w.lives <= 0) {
      w.state = 'out';
      this.eliminate(w.p);
    }
  }

  /** Free pad for a respawn: nobody on it, far from rivals, not too close to the banks. */
  private respawn(w: Wader): void {
    let best = this.pads[0];
    let bestS = -Infinity;
    for (const pad of this.pads) {
      let s = pad.r * 0.5 - Math.hypot(pad.x, pad.y) * 0.15 + Math.random() * 30;
      for (const o of this.waders) {
        if (o === w || (o.state !== 'pad' && o.state !== 'hop')) continue;
        const d = Math.hypot(o.x - pad.x, o.y - pad.y);
        if (d < pad.r + PLAYER_R) s -= 1000;
        s += Math.min(400, d) * 0.3;
      }
      if (s > bestS) {
        bestS = s;
        best = pad;
      }
    }
    w.state = 'pad';
    w.pad = best;
    w.x = best.x;
    w.y = best.y;
    w.vx = w.vy = 0;
    w.z = 280;
    w.vz = 0;
    w.invuln = INVULN_MS;
    this.tweens.killTweensOf(w.c);
    w.c.setAlpha(1);
    w.c.play('jump', { force: true, returnTo: 'idle' });
    audio.play('pop', { volume: 0.5, rate: 0.9 });
    const q = this.screen(best.x, best.y);
    this.fx.vfx('sparkle', q.x, q.y - 80, { scale: 0.5, duration: 420, blend: 'add', tint: PLAYER_COLORS[w.p.slot] });
  }

  // --- Blasts --------------------------------------------------------------------------------------
  private getBlast(): Blast {
    const free = this.blasts.find((b) => !b.active);
    if (free) return free;
    const b: Blast = {
      active: false,
      shot: 0,
      owner: null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      glow: this.add.image(0, 0, 'fx-dot').setTint(0x5ce1ff).setBlendMode(Phaser.BlendModes.ADD).setScale(3.4),
      streak: this.add.image(0, 0, 'vfx', 7).setOrigin(0.82, 0.5).setScale(0.36).setAlpha(0.95),
      core: this.add.image(0, 0, 'fx-dot').setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5),
      shadow: this.add.image(0, 0, 'fx-contact').setTint(0x06303a).setAlpha(0.35).setDepth(150),
      dripT: 0,
    };
    this.blasts.push(b);
    return b;
  }

  private hideBlast(b: Blast): void {
    b.active = false;
    for (const o of [b.glow, b.streak, b.core, b.shadow]) o.setVisible(false);
  }

  private fire(w: Wader): void {
    w.fireCd = BLAST_CD;
    const b = this.getBlast();
    b.active = true;
    b.shot = ++this.shotId;
    b.owner = w;
    b.x = w.x + w.ax * 30;
    b.y = w.y + w.ay * 30;
    b.vx = w.ax * BLAST_SPEED;
    b.vy = w.ay * BLAST_SPEED;
    b.life = BLAST_LIFE;
    b.dripT = 0;
    for (const o of [b.glow, b.streak, b.core, b.shadow]) o.setVisible(true);
    this.placeBlast(b);
    if (w.state === 'pad' && w.stunT <= 0) w.c.play('throw', { force: true, returnTo: 'idle' });
    if (Math.abs(w.ax) > 0.15) w.c.face(w.ax < 0);
    audio.play('whoosh', { volume: 0.32, rate: 1.6, throttleMs: 40 });
    audio.play('pop', { volume: 0.3, rate: 0.7 + Math.random() * 0.12, throttleMs: 40 });
    const q = this.screen(b.x, b.y);
    this.fx.vfx('splash', q.x, q.y - BLAST_Z, { scale: 0.16, duration: 220, alpha: 0.8, depth: 1000 + q.y + 1 });
    // A fan of droplets off the muzzle along the shot, and a little recoil.
    this.drops.fire(q.x, q.y - BLAST_Z, burst(6), Math.atan2(w.ay * DEPTH_K, w.ax) * RAD, 22, 220, 480, [240, 400]);
    w.c.squash(0.07, 100);
  }

  private stepBlasts(sdt: number): void {
    const s = sdt / 1000;
    for (const b of this.blasts) {
      if (!b.active) continue;
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= sdt;
      for (const w of this.waders) {
        // Hoppers can be knocked out of the air; players dropping back in after a splash can't be hit.
        const target = w.state === 'hop' || (w.state === 'pad' && w.z <= 0);
        if (w === b.owner || w.invuln > 0 || !target) continue;
        if (Math.hypot(w.x - b.x, w.y - b.y) < BLAST_R + PLAYER_R) {
          this.hit(w, b);
          break;
        }
      }
      if (b.active && (b.life <= 0 || !insideEllipse(b.x, b.y, WATER.rx + 80, WATER.ry + 80))) this.plop(b);
    }
  }

  private hit(w: Wader, b: Blast): void {
    const m = Math.hypot(b.vx, b.vy) || 1;
    const kx = b.vx / m;
    const ky = b.vy / m;
    if (w.state === 'hop') {
      // Knocked out of the air: drop where you are.
      w.state = 'pad';
      w.hop = null;
      w.z = 0;
    }
    w.vx = (kx * KNOCK) / w.weight + w.vx * 0.2;
    w.vy = (ky * KNOCK) / w.weight + w.vy * 0.2;
    w.stunT = HIT_STUN;
    w.teeter = false;
    if (b.owner) b.owner.hits += 1;
    w.c.play('surprised', { force: true, returnTo: 'idle' });
    const q = this.screen(w.x, w.y);
    this.fx.vfx('splash', q.x, q.y - 70, { scale: 0.42, duration: 380, depth: 1000 + q.y + 2 });
    this.fx.vfx('impact', q.x - kx * 20, q.y - 80, { scale: 0.3, duration: 220, blend: 'add', tint: 0xbff4ff });
    // The blast bursts over them: spray carried on along the shot and up, a freeze-frame, the
    // camera knocked the way the blast was going, their pad rocked and a white flash on them.
    this.drops.fire(q.x, q.y - 70, burst(12), Math.atan2(ky * DEPTH_K, kx) * RAD, 50, 180, 520);
    this.drops.fire(q.x, q.y - 76, burst(6), -90, 45, 200, 420);
    this.hitStop(HIT_STOP);
    kick(this, kx * 9, ky * 9 * DEPTH_K);
    if (w.pad) w.pad.dip = Math.max(w.pad.dip, 6);
    w.wakeT = 0;
    if (!settings.get().reducedMotion) {
      w.c.sprite.setTintFill(0xffffff);
      this.time.delayedCall(70, () => w.c.sprite.clearTint());
    }
    audio.play('splash', { volume: 0.55, throttleMs: 30 });
    audio.play('hit', { volume: 0.25, throttleMs: 30 });
    this.rumble(w.p, 0.45, 0.35, 140);
    if (b.owner && !b.owner.p.isCpu) this.rumble(b.owner.p, 0.1, 0.25, 60);
    this.hideBlast(b);
  }

  private plop(b: Blast): void {
    const q = this.screen(b.x, b.y);
    const onPad = padUnder(this.pads, b.x, b.y, 0) >= 0;
    if (insideEllipse(b.x, b.y, WATER.rx, WATER.ry)) {
      this.fx.vfx('splash', q.x, q.y - 14, { scale: onPad ? 0.18 : 0.24, duration: 320, alpha: 0.85, depth: 1000 + q.y });
      if (!onPad) this.ripple(b.x, b.y, 0.7, 900);
      audio.play('pop', { volume: 0.15, rate: 0.6, throttleMs: 80 });
    }
    this.hideBlast(b);
  }

  private placeBlast(b: Blast): void {
    const q = this.screen(b.x, b.y);
    const y = q.y - BLAST_Z;
    const depth = 1000 + q.y + 0.5;
    const ang = Math.atan2(b.vy * DEPTH_K, b.vx);
    const pulse = 1 + 0.12 * Math.sin(this.time.now / 45 + b.shot);
    b.glow.setPosition(q.x, y).setDepth(depth).setScale(3.4 * pulse);
    b.core.setPosition(q.x, y).setDepth(depth + 0.02);
    b.streak.setPosition(q.x, y).setRotation(ang + STREAK_TILT).setDepth(depth + 0.01);
    b.shadow.setPosition(q.x, q.y).setScale(0.3, 0.3 * DEPTH_K);
  }

  // --- Visuals -------------------------------------------------------------------------------------
  private syncVisuals(dt: number): void {
    const now = this.time.now;
    const warn = this.warnT > 0 && Math.floor(this.warnT / 140) % 2 === 0;
    for (const pad of this.pads) {
      this.placePad(pad);
      pad.rim.setTint(warn ? 0xff6b5e : 0xe8fbff).setAlpha(warn ? 0.9 : 0.28);
    }
    for (const w of this.waders) {
      if (w.state === 'sink' || w.state === 'out') continue;
      const q = this.screen(w.x, w.y);
      const bob = w.pad && w.state === 'pad' ? w.pad.bobY : 0;
      w.c.setPosition(q.x, q.y + bob).setDepth(1000 + q.y);
      w.c.sprite.y = -w.z;
      if (w.c.marker) w.c.marker.y = w.markerY - w.z;
      w.c.shadow?.setScale(1 - Math.min(0.5, w.z / 300)).setAlpha(w.state === 'hop' ? 0.6 : 1);
      w.c.setAlpha(w.invuln > 0 ? (Math.floor(now / 90) % 2 ? 0.45 : 1) : 1);
      this.waderSpray(w, q.x, q.y, dt);
      if (w.state !== 'pad' || w.stunT > 0 || w.z > 0) continue;
      if (Math.abs(w.vx) > 30) w.c.face(w.vx < 0);
      const cur = w.c.current;
      if (cur !== 'idle' && cur !== 'run' && cur !== 'balance') continue;
      const moving = Math.hypot(w.vx - (w.pad ? w.pad.vx : 0), w.vy - (w.pad ? w.pad.vy : 0)) > 50;
      if (w.teeter) {
        if (cur !== 'balance') w.c.hold('balance');
      } else if (moving && cur !== 'run') w.c.play('run');
      else if (!moving && cur !== 'idle') w.c.play('idle');
    }
    for (const b of this.blasts) {
      if (!b.active) continue;
      this.placeBlast(b);
      // The blast sheds droplets that patter down to the water behind it.
      b.dripT -= dt;
      if (b.dripT <= 0) {
        b.dripT = every(40);
        const q = this.screen(b.x, b.y);
        this.drops.fire(q.x, q.y - BLAST_Z, 1, 90, 60, 20, 90, [260, 380]);
      }
    }
    this.drawAims();
    // Water life.
    const s = dt / 1000;
    for (const sw of this.swirls) sw.img.rotation += sw.w * s;
    for (const sp of this.sparkles) {
      sp.t += s / sp.period;
      if (sp.t >= 1) {
        sp.t = 0;
        const q = this.waterPoint(60);
        const pos = this.screen(q.x, q.y);
        sp.img.setPosition(pos.x, pos.y);
      }
      const a = Math.sin(sp.t * Math.PI);
      sp.img.setAlpha(0.7 * a).setScale((0.5 + a * 0.9) * 1.1, (0.5 + a * 0.9) * 0.55);
    }
    // Gentle wake off the trailing rim of each drifting pad.
    if (this.phase === 'playing') {
      for (const pad of this.pads) {
        pad.wakeT -= dt;
        const sp = Math.hypot(pad.vx, pad.vy);
        if (pad.wakeT > 0 || sp < 8) continue;
        pad.wakeT = 1500 + Math.random() * 900;
        this.ripple(pad.x - (pad.vx / sp) * pad.r * 0.9, pad.y - (pad.vy / sp) * pad.r * 0.9, 0.45, 1100);
      }
    }
    this.rippleT -= dt;
    if (this.rippleT <= 0) {
      this.rippleT = 320 + Math.random() * 300;
      const q = this.waterPoint(40);
      this.ripple(q.x, q.y, 0.5 + Math.random() * 0.5);
    }
    for (const r of this.ripples) {
      if (r.t >= r.life) continue;
      r.t += dt;
      const u = Math.min(1, r.t / r.life);
      const sc = r.size * (0.3 + u * 0.9);
      r.img.setScale(sc, sc * DEPTH_K).setAlpha(0.45 * (1 - u));
      if (u >= 1) r.img.setVisible(false);
    }
  }

  /**
   * Spray off a player at screen point (x, y): a foamy wake while a blast slides them across their
   * pad (rippling the water near the rim), and drips while they drop back in soaked.
   */
  private waderSpray(w: Wader, x: number, y: number, dt: number): void {
    if (w.state !== 'pad') return;
    if (w.z > 0) {
      w.dripT -= dt;
      if (w.dripT <= 0) {
        w.dripT = every(70);
        this.drops.fire(x + (Math.random() - 0.5) * 30, y - w.z - 50, 1, 90, 12, 40, 90, [320, 460]);
      }
      return;
    }
    if (w.stunT <= 0) return;
    // Their velocity is relative to the pad (the pad's drift is added separately).
    const sp = Math.hypot(w.vx, w.vy);
    w.wakeT -= dt;
    if (sp < 110 || w.wakeT > 0) return;
    w.wakeT = every(45);
    const back = Math.atan2(-w.vy * DEPTH_K, -w.vx) * RAD;
    this.foam.fire(x, y + 2, burst(2), back, 35, 40, 120);
    this.drops.fire(x, y - 8, 1, -90, 40, 120, 260, [280, 420]);
    const pad = w.pad;
    if (pad && Math.hypot(w.x - pad.x, w.y - pad.y) > pad.r - 34 && Math.random() < 0.45) this.ripple(w.x, w.y, 0.4, 700);
  }

  /** Aim line and reticle for everyone on a pad; the ring fills as the blast reloads. */
  private drawAims(): void {
    const g = this.aimG;
    g.clear();
    if (this.phase !== 'playing') return;
    for (const w of this.waders) {
      if ((w.state !== 'pad' && w.state !== 'hop') || w.z > 0) continue;
      const color = PLAYER_COLORS[w.p.slot];
      const alpha = w.p.isCpu ? 0.6 : 0.95;
      for (let i = 1; i <= 4; i++) {
        const d = 36 + i * 30;
        const q = this.screen(w.x + w.ax * d, w.y + w.ay * d);
        g.fillStyle(0x06141a, 0.35 * alpha);
        g.fillCircle(q.x + 1, q.y + 2, 4.5);
        g.fillStyle(color, alpha * (0.4 + i * 0.12));
        g.fillCircle(q.x, q.y, 4);
      }
      const c = this.screen(w.x + w.ax * RETICLE_D, w.y + w.ay * RETICLE_D);
      const ready = 1 - w.fireCd / BLAST_CD;
      const r = 20;
      g.lineStyle(7, 0x06141a, 0.35 * alpha);
      strokeEllipseArc(g, c.x, c.y + 2, r, r * DEPTH_K, 1);
      g.lineStyle(5, color, alpha);
      strokeEllipseArc(g, c.x, c.y, r, r * DEPTH_K, ready);
      g.lineStyle(2, 0xffffff, alpha * 0.9);
      g.lineBetween(c.x - r - 7, c.y, c.x - r + 3, c.y);
      g.lineBetween(c.x + r - 3, c.y, c.x + r + 7, c.y);
      g.fillStyle(0xffffff, alpha);
      g.fillCircle(c.x, c.y, 3);
    }
  }

  protected override ambient(dt: number): void {
    // Particles follow the minigame clock: frozen in a hit-stop, slowed in slow motion.
    const ts = this.time.timeScale;
    this.drops.sync(ts);
    this.foam.sync(ts);
    this.updatePondLife(dt);
    if (this.phase !== 'playing') this.syncVisuals(dt);
  }

  /** The fish leaps every few seconds; the dragonflies hover, then dart somewhere new. */
  private updatePondLife(dt: number): void {
    const f = this.fish;
    if (f && !f.on) {
      f.wait -= dt;
      if (f.wait <= 0) this.leap(f);
    } else if (f) {
      f.t += dt;
      const u = Math.min(1, f.t / f.T);
      const wx = f.x0 + (f.x1 - f.x0) * u;
      const wy = f.y0 + (f.y1 - f.y0) * u;
      const qy = POND.cy + wy * DEPTH_K;
      // Nose along the arc: the leap's run on screen, plus the rise and fall.
      const dir = f.x1 >= f.x0 ? 1 : -1;
      const run = Math.abs(f.x1 - f.x0) + 1;
      const rise = (f.y1 - f.y0) * DEPTH_K - Math.PI * f.h * Math.cos(u * Math.PI);
      f.img
        .setPosition(POND.cx + wx, qy - Math.sin(u * Math.PI) * f.h)
        .setDepth(1000 + qy)
        .setFlipX(dir < 0)
        .setRotation(dir * Math.atan2(rise, run));
      if (u >= 1) {
        f.on = false;
        f.img.setVisible(false);
        f.wait = FISH_WAIT[0] + Math.random() * (FISH_WAIT[1] - FISH_WAIT[0]);
        this.plopFish(wx, wy);
      }
    }
    const now = this.time.now;
    for (const fl of this.flies) {
      fl.t += dt;
      if (fl.hover && fl.t >= fl.T) {
        const p = this.waterPoint(120);
        // Keep each dart short, so it zips about rather than crossing the whole pond.
        const dx = p.x - fl.x;
        const dy = p.y - fl.y;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, 300 / d);
        fl.sx = fl.x;
        fl.sy = fl.y;
        fl.tx = fl.x + dx * k;
        fl.ty = fl.y + dy * k;
        fl.t = 0;
        fl.T = 260 + Math.random() * 180;
        fl.hover = false;
        fl.img.setFlipX(fl.tx < fl.sx);
      } else if (!fl.hover) {
        const u = Math.min(1, fl.t / fl.T);
        const e = 1 - (1 - u) * (1 - u) * (1 - u);
        fl.x = fl.sx + (fl.tx - fl.sx) * e;
        fl.y = fl.sy + (fl.ty - fl.sy) * e;
        if (u >= 1) {
          fl.hover = true;
          fl.t = 0;
          fl.T = 600 + Math.random() * 1400;
        }
      }
      const qy = POND.cy + fl.y * DEPTH_K;
      fl.img
        .setPosition(POND.cx + fl.x, qy - fl.h + Math.sin(now / 180 + fl.h) * 3)
        .setDepth(1000 + qy + 90)
        .setFrame(Math.floor(now / 40) % 2 ? 'b' : 'a');
    }
  }

  /** Start a fish leap between two open-water points (skipped if none fit this time). */
  private leap(f: Fish): void {
    for (let tries = 0; tries < 6; tries++) {
      const a = this.waterPoint(110);
      const ang = Math.random() * Math.PI * 2;
      const len = 90 + Math.random() * 50;
      const bx = a.x + Math.cos(ang) * len;
      const by = a.y + Math.sin(ang) * len * 0.6;
      if (!insideEllipse(bx, by, WATER.rx, WATER.ry, 110) || padUnder(this.pads, bx, by, 30) >= 0 || padUnder(this.pads, a.x, a.y, 30) >= 0) continue;
      f.on = true;
      f.t = 0;
      f.T = 620 + Math.random() * 160;
      f.x0 = a.x;
      f.y0 = a.y;
      f.x1 = bx;
      f.y1 = by;
      f.h = 55 + Math.random() * 30;
      f.img.setVisible(true);
      this.plopFish(a.x, a.y);
      return;
    }
    f.wait = 1500;
  }

  private plopFish(x: number, y: number): void {
    const q = this.screen(x, y);
    this.fx.vfx('splash', q.x, q.y - 10, { scale: 0.2, duration: 360, alpha: 0.9, depth: 1000 + q.y - 1 });
    this.ripple(x, y, 0.6, 1000);
    audio.play('pop', { volume: 0.06, rate: 0.5, throttleMs: 200 });
  }

  protected override end(): void {
    if (this.finished) return;
    this.finished = true;
    this.aimG.clear();
    for (const w of this.waders) {
      if (w.state === 'out' || w.state === 'sink') continue;
      w.c.play(this.alivePlayers.length === 1 ? 'victory' : 'celebrate', { force: true });
      const q = this.screen(w.x, w.y);
      if (this.alivePlayers.length === 1) this.fx.confetti(q.x, q.y - 120, 50);
    }
    super.end();
  }

  // --- CPU -----------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const w = this.waders.find((x) => x.p === p);
    if (!w) return;
    const b = w.brain;
    if (w.state !== 'pad' || !w.pad || w.z > 0) {
      vc.setMove(0, 0);
      vc.setTriggers(0, 0);
      return;
    }
    const sk = this.skill(p);
    b.think -= dt;
    b.fireWait -= dt;
    b.dodgeT -= dt;
    b.hopT -= dt;
    b.wanderT -= dt;
    if (b.think <= 0) {
      b.think = sk.think * (0.75 + Math.random() * 0.5);
      this.cpuPlan(w);
    }
    this.cpuDodge(w);
    const pad = w.pad;
    let mx = 0;
    let my = 0;
    let mag = 1;
    if (b.dodgeT > 0) {
      mx = b.dx;
      my = b.dy;
    } else if (b.wanderT > 0) {
      mx = b.wx;
      my = b.wy;
    } else if (b.hopPad && b.hopT > 0 && this.pads.includes(b.hopPad)) {
      mx = b.hopPad.x - w.x;
      my = b.hopPad.y - w.y;
      // Near the rim: only carry on if the hop can still land (the pads keep drifting).
      if (Math.hypot(w.x - pad.x, w.y - pad.y) > pad.r - RIM_BAND - 12 && !hopTarget(this.pads, this.pads.indexOf(pad), w.x, w.y, mx, my, HOP_RANGE, HOP_INSET, HOP_SPREAD)) {
        b.hopPad = null;
        b.hopT = 0;
      }
    } else {
      b.hopPad = null;
      mx = pad.x + b.holdX * pad.r - w.x;
      my = pad.y + b.holdY * pad.r - w.y;
      const d = Math.hypot(mx, my);
      mag = d < 10 ? 0 : Math.min(1, d / 40);
    }
    // Safety first: back towards the middle when near the rim with no hop planned (allowing for a
    // shrink that has been announced).
    const rx = w.x - pad.x;
    const ry = w.y - pad.y;
    const rd = Math.hypot(rx, ry);
    const planned = b.hopPad !== null && b.hopT > 0;
    const safeR = (this.warnT > 0 ? pad.r * SHRINK_STEP : pad.r) - 28;
    if (!planned && rd > safeR && !(b.wanderT > 0 && Math.random() < sk.mistake)) {
      mx = -rx;
      my = -ry;
      mag = 1;
    }
    const mm = Math.hypot(mx, my);
    if (mm > 1e-3 && mag > 0) vc.setMove((mx / mm) * mag, (my / mm) * mag);
    else vc.setMove(0, 0);
    // Aim and shoot.
    const t = b.target;
    if (t && (t.state === 'pad' || t.state === 'hop') && t.z <= 0) {
      const dist = Math.hypot(t.x - w.x, t.y - w.y);
      const flight = dist / BLAST_SPEED;
      const lead = sk.accuracy > 0.85 ? flight : sk.accuracy > 0.7 ? flight * 0.5 : 0;
      const tx = t.x + t.vx * lead - w.x;
      const ty = t.y + t.vy * lead - w.y;
      const ang = Math.atan2(ty, tx) + b.aimErr;
      vc.setAim(Math.cos(ang), Math.sin(ang));
      const inRange = dist < (BLAST_SPEED * BLAST_LIFE) / 1000 - 40;
      let fire = false;
      if (inRange && w.fireCd <= 0 && b.fireWait <= 0 && t.invuln <= 0 && w.stunT <= 0 && b.dodgeT <= 0) {
        // Better CPUs wait for a rival near their rim (more likely to knock them in).
        const tp = t.pad;
        const edge = tp ? Math.hypot(t.x - tp.x, t.y - tp.y) / tp.r : 1;
        fire = edge > 0.75 - sk.accuracy * 0.45 || Math.random() < 0.1 + (1 - sk.accuracy) * 0.25;
      }
      if (fire) {
        vc.setTriggers(0, 1);
        b.fireWait = BLAST_CD + 280 + sk.reaction * (0.9 + Math.random());
        b.aimErr = gaussish() * sk.aimNoise * 0.8;
      } else vc.setTriggers(0, 0);
    } else vc.setTriggers(0, 0);
  }

  private cpuPlan(w: Wader): void {
    const sk = this.skill(w.p);
    const b = w.brain;
    const pad = w.pad;
    if (!pad) return;
    // Target: nearest rival on a pad (rivals near an edge look juicier).
    let best: Wader | null = null;
    let bestS = Infinity;
    for (const o of this.waders) {
      if (o === w || (o.state !== 'pad' && o.state !== 'hop')) continue;
      const d = Math.hypot(o.x - w.x, o.y - w.y);
      const edge = o.pad ? Math.hypot(o.x - o.pad.x, o.y - o.pad.y) / o.pad.r : 0.5;
      const s = d - edge * 120 + (o.invuln > 0 ? 400 : 0) + (o === b.target ? -60 : 0);
      if (s < bestS) {
        bestS = s;
        best = o;
      }
    }
    b.target = best;
    // Stand near the middle (better CPUs hold it tighter).
    const spread = 0.24 * (1.2 - sk.accuracy);
    b.holdX = (Math.random() - 0.5) * spread;
    b.holdY = (Math.random() - 0.5) * spread;
    // Occasional blunder: a few steps in a random direction.
    if (Math.random() < sk.mistake * 0.5) {
      const a = Math.random() * Math.PI * 2;
      b.wx = Math.cos(a);
      b.wy = Math.sin(a);
      b.wanderT = 220 + Math.random() * 200;
    }
    // Hop when this pad is drifting away from the others (or a clearly better pad is in reach).
    if (b.hopPad && b.hopT > 0) return;
    const reach = HOP_RANGE - HOP_INSET - 30;
    const ci = this.pads.indexOf(pad);
    const score = (pd: Pad) => {
      let s = pd.r * 1.2 - Math.hypot(pd.x, pd.y) * 0.1;
      for (const o of this.pads) if (o !== pd && padGap(pd, o) < reach) s += 22;
      for (const o of this.waders) if (o !== w && o.state === 'pad' && o.pad === pd) s -= 90;
      return s;
    };
    const stranded = nearestGap(this.pads, ci) > reach - 40;
    const stay = score(pad) + 40 - (stranded ? 70 : 0);
    let hopTo: Pad | null = null;
    let hopS = stay + 25;
    for (const pd of this.pads) {
      if (pd === pad) continue;
      const gap = padGap(pad, pd);
      if (gap > reach) continue;
      const s = score(pd) - gap * 0.1;
      if (s > hopS) {
        hopS = s;
        hopTo = pd;
      }
    }
    if (hopTo && Math.random() < 0.35 + sk.accuracy * 0.5) {
      b.hopPad = hopTo;
      b.hopT = 1600;
    }
  }

  /** Spot incoming blasts; after a reaction delay, maybe sidestep (towards the roomier side). */
  private cpuDodge(w: Wader): void {
    const b = w.brain;
    const sk = this.skill(w.p);
    const pad = w.pad;
    if (!pad || b.dodgeT > 0) return;
    const chance = Math.max(0.12, (sk.accuracy - 0.45) * 1.55);
    for (const bl of this.blasts) {
      if (!bl.active || bl.owner === w) continue;
      const ca = closestApproach(bl.x, bl.y, bl.vx, bl.vy, w.x, w.y);
      if (ca.t > 0.7 || ca.d > BLAST_R + PLAYER_R + 20) continue;
      let when = b.decided.get(bl.shot);
      if (when === undefined) {
        when = Math.random() < chance ? this.elapsed + sk.reaction * 0.55 : -1;
        b.decided.set(bl.shot, when);
        if (b.decided.size > 40) b.decided.delete(b.decided.keys().next().value as number);
      }
      if (when >= 0 && this.elapsed >= when) {
        const m = Math.hypot(bl.vx, bl.vy) || 1;
        let px = -bl.vy / m;
        let py = bl.vx / m;
        const d1 = Math.hypot(w.x + px * 70 - pad.x, w.y + py * 70 - pad.y);
        const d2 = Math.hypot(w.x - px * 70 - pad.x, w.y - py * 70 - pad.y);
        if (d2 < d1) {
          px = -px;
          py = -py;
        }
        // Never sidestep into the pond: better to take the hit.
        b.decided.set(bl.shot, -1);
        if (Math.min(d1, d2) > pad.r - 20) return;
        b.dx = px;
        b.dy = py;
        b.dodgeT = 300;
        return;
      }
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    const alive = this.alivePlayers.length;
    return this.eliminationScores((p) => {
      const w = this.waders.find((x) => x.p === p);
      return p.alive && w ? survivorScore(w.lives, w.hits) : 0;
    }).map((s) => {
      const w = this.waders.find((x) => x.p.slot === s.slot);
      if (w && w.p.alive && alive > 1) s.label = `${w.lives} ${w.lives === 1 ? 'life' : 'lives'} · ${w.hits} hit${w.hits === 1 ? '' : 's'}`;
      return s;
    });
  }
}

/** Roughly normal noise in [-1.5, 1.5] (sum of uniforms). */
function gaussish(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
}

/** Stroke part of an ellipse (fraction 0..1 of the full turn, starting at the top). */
function strokeEllipseArc(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, frac: number): void {
  if (frac <= 0) return;
  const n = Math.max(4, Math.ceil(28 * frac));
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2 * Math.min(1, frac);
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokePath();
}

// --- Fallback art -------------------------------------------------------------------------------------
type Ctx = CanvasRenderingContext2D;

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

/** Pond life: a koi (facing right) and a dragonfly in two wing frames ('a' up, 'b' down). */
function makePondLifeTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, 'ss-fish', 60, 28, (ctx) => {
    // Forked tail, body with a pale belly and white patches, a fin and an eye.
    ctx.fillStyle = '#ff7a2e';
    ctx.beginPath();
    ctx.moveTo(13, 14);
    ctx.lineTo(1, 4);
    ctx.quadraticCurveTo(6, 14, 1, 24);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24, 7);
    ctx.quadraticCurveTo(31, 0, 37, 6.5);
    ctx.closePath();
    ctx.fill();
    const g = ctx.createLinearGradient(0, 5, 0, 23);
    g.addColorStop(0, '#ff8f40');
    g.addColorStop(1, '#ffe0bd');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(31, 14, 20, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.ellipse(27, 11, 6, 3.4, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(40, 15.5, 4, 2.8, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(130,52,10,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(31, 14, 20, 8.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#1b1530';
    ctx.beginPath();
    ctx.arc(45, 12, 1.7, 0, Math.PI * 2);
    ctx.fill();
  });
  if (scene.textures.exists('ss-fly')) return;
  const tex = scene.textures.createCanvas('ss-fly', 72, 26);
  if (!tex) return;
  const ctx = tex.getContext();
  for (const [ox, up] of [
    [0, true],
    [36, false],
  ] as const) {
    // Gauzy wings behind the body, then the slim teal body and its head.
    const wy = up ? -1 : 1;
    ctx.fillStyle = 'rgba(225,248,255,0.8)';
    ctx.strokeStyle = 'rgba(130,195,230,0.95)';
    ctx.lineWidth = 1;
    for (const [wx, len, rot] of [
      [15, 11, 0.5],
      [21, 10, 0.3],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(ox + wx, 13 + wy * 6, len, 3.2, wy * rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const g = ctx.createLinearGradient(ox + 3, 0, ox + 28, 0);
    g.addColorStop(0, '#1c6f9a');
    g.addColorStop(1, '#3fd0e8');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox + 3, 13);
    ctx.lineTo(ox + 27, 13);
    ctx.stroke();
    ctx.fillStyle = '#1c7fa0';
    ctx.beginPath();
    ctx.arc(ox + 29, 13, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d3b47';
    ctx.beginPath();
    ctx.arc(ox + 30.5, 12, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.refresh();
  tex.add('a', 0, 0, 0, 36, 26);
  tex.add('b', 0, 36, 0, 36, 26);
}

/** Current streaks (drawn at half size, shown at 2×): inner disc and outer ring (kept on the water: 2 × 262 × DEPTH_K < POND.ry). */
function makeSwirlTextures(scene: Phaser.Scene): void {
  const arms = (ctx: Ctx, c: number, r0: number, r1: number, count: number, pitch: number, width: number, alpha: number) => {
    for (let k = 0; k < count; k++) {
      const a0 = (k / count) * Math.PI * 2;
      for (let seg = 0; seg < 9; seg++) {
        const t0 = seg / 9;
        const t1 = t0 + 0.07;
        ctx.strokeStyle = `rgba(230,250,255,${alpha * (0.5 + 0.5 * Math.sin(t0 * Math.PI))})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const t = t0 + ((t1 - t0) * i) / 6;
          const r = r0 + (r1 - r0) * t;
          const a = a0 + t * pitch;
          const x = c + Math.cos(a) * r;
          const y = c + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  };
  canvasTexture(scene, 'ss-swirl-in', 320, 320, (ctx) => arms(ctx, 160, 22, 145, 3, 2.6, 3, 0.32));
  canvasTexture(scene, 'ss-swirl-out', 540, 540, (ctx) => arms(ctx, 270, 160, 262, 5, -1.3, 3, 0.26));
}

/** Top-down lily pads (three variants): notched disc, veins, rim and the odd flower. */
function makePadTextures(scene: Phaser.Scene): void {
  for (let v = 0; v < 3; v++) {
    canvasTexture(scene, `ss-pad-${v}`, 256, 256, (ctx) => {
      const c = 128;
      const R = PAD_TEX_R;
      const notch = 0.42;
      const rnd = new Random(300 + v);
      const path = (r: number) => {
        ctx.beginPath();
        ctx.moveTo(c, c);
        for (let k = 0; k <= 64; k++) {
          const a = -Math.PI / 2 + notch / 2 + ((Math.PI * 2 - notch) * k) / 64;
          const rr = r * (1 + 0.025 * Math.sin(a * 7 + v));
          ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
        }
        ctx.closePath();
      };
      const g = ctx.createRadialGradient(c - 20, c - 26, 10, c, c, R);
      g.addColorStop(0, v === 1 ? '#a6e27a' : '#9ddc6e');
      g.addColorStop(0.6, '#6cc24a');
      g.addColorStop(1, '#3f8f3a');
      ctx.fillStyle = g;
      path(R);
      ctx.fill();
      // Veins.
      ctx.strokeStyle = 'rgba(210,245,170,0.55)';
      ctx.lineWidth = 3;
      for (let k = 0; k < 11; k++) {
        const a = -Math.PI / 2 + notch / 2 + ((Math.PI * 2 - notch) * (k + 0.5)) / 11;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.quadraticCurveTo(c + Math.cos(a + 0.08) * R * 0.5, c + Math.sin(a + 0.08) * R * 0.5, c + Math.cos(a) * R * 0.92, c + Math.sin(a) * R * 0.92);
        ctx.stroke();
      }
      // Speckles and a wet sheen.
      for (let k = 0; k < 40; k++) {
        const a = rnd.next() * Math.PI * 2;
        const r = rnd.next() * R * 0.9;
        ctx.fillStyle = rnd.chance(0.5) ? 'rgba(40,100,40,0.25)' : 'rgba(220,255,190,0.25)';
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rnd.range(1.5, 4), 0, Math.PI * 2);
        ctx.fill();
      }
      const sheen = ctx.createRadialGradient(c - 40, c - 44, 4, c - 40, c - 44, 70);
      sheen.addColorStop(0, 'rgba(255,255,255,0.35)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      path(R);
      ctx.fill();
      // Rim lip.
      ctx.strokeStyle = '#3a7e32';
      ctx.lineWidth = 6;
      path(R - 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190,240,150,0.5)';
      ctx.lineWidth = 2;
      path(R - 7);
      ctx.stroke();
      if (v === 1) {
        // A lotus bloom near the rim.
        const fx = c + 58;
        const fy = c + 40;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ctx.fillStyle = k % 2 ? '#ffc2dd' : '#ff9ecb';
          ctx.beginPath();
          ctx.ellipse(fx + Math.cos(a) * 11, fy + Math.sin(a) * 11, 10, 6, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(fx, fy, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

function makePondTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, 'ss-pond-bg', GAME_WIDTH, 1080, drawPond);
}

/** Value noise in [0, 1] from a hashed lattice. */
function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (i: number, j: number) => {
    let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(i, j);
    const b = hash(i + 1, j);
    const c = hash(i, j + 1);
    const d = hash(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function drawPond(ctx: Ctx): void {
  const rnd = new Random(4101);
  const W = GAME_WIDTH;
  const H = 1080;
  const { cx, cy, rx, ry } = POND;
  // Floating island: rocky underside, then the grass top.
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const wob = 1 + 0.03 * Math.sin(a * 6 + 0.7) + 0.025 * Math.sin(a * 11 + 2.1);
    pts.push({ x: 960 + Math.cos(a) * 1010 * wob, y: 630 + Math.sin(a) * 500 * wob });
  }
  const outline = (dy = 0) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + dy) : ctx.moveTo(p.x, p.y + dy)));
    ctx.closePath();
  };
  let g = ctx.createLinearGradient(0, 700, 0, H + 160);
  g.addColorStop(0, '#9a7050');
  g.addColorStop(0.5, '#7a5238');
  g.addColorStop(1, '#4e3424');
  ctx.fillStyle = g;
  outline(120);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,24,14,0.25)';
  ctx.lineWidth = 3;
  for (let s = 1; s <= 3; s++) {
    outline(30 * s + 10);
    ctx.stroke();
  }
  g = ctx.createLinearGradient(0, 130, 0, H);
  g.addColorStop(0, '#9ad06e');
  g.addColorStop(0.5, '#7cbb57');
  g.addColorStop(1, '#5c9a3e');
  ctx.fillStyle = g;
  outline();
  ctx.fill();
  ctx.save();
  outline();
  ctx.clip();
  for (let i = 0; i < 2600; i++) {
    const x = rnd.next() * W;
    const y = 130 + rnd.next() * (H - 130);
    ctx.strokeStyle = rnd.chance(0.5) ? 'rgba(170,220,120,0.45)' : 'rgba(60,110,40,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rnd.range(-3, 3), y - rnd.range(4, 9));
    ctx.stroke();
  }
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rnd.pick(['#ffffff', '#ffe08a', '#ff9ecb', '#c49bff']);
    ctx.beginPath();
    ctx.arc(rnd.next() * W, 150 + rnd.next() * (H - 150), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(210,245,170,0.7)';
  ctx.lineWidth = 5;
  outline();
  ctx.stroke();
  // Trees and bushes around the pond.
  for (const [x, y, s] of [
    [520, 232, 0.9],
    [1400, 232, 0.9],
    [90, 300, 1.15],
    [1830, 300, 1.15],
    [80, 965, 1.05],
    [1840, 965, 1.05],
  ] as const) {
    drawTree(ctx, x, y, s, rnd);
  }
  for (const [x, y] of [
    [360, 300],
    [700, 262],
    [1220, 262],
    [1560, 300],
    [170, 640],
    [1750, 640],
  ] as const) {
    drawLanternPost(ctx, x, y);
  }
  // Shore: a sandy ring, darker where the far bank slopes down to the water.
  const bank = ctx.createLinearGradient(0, cy - ry - 26, 0, cy + ry + 26);
  bank.addColorStop(0, '#7e6246');
  bank.addColorStop(0.25, '#a88a64');
  bank.addColorStop(0.7, '#cdb48a');
  bank.addColorStop(1, '#d9c49a');
  ctx.fillStyle = 'rgba(20,40,20,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx + 6, cy + 10, rx + 40, ry + 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bank;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx + 34, ry + 24, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 260; i++) {
    const a = rnd.next() * Math.PI * 2;
    const k = rnd.range(1.0, 1.045);
    const r = rnd.range(1.5, 3.2);
    ctx.fillStyle = rnd.pick(['#8a7458', '#e6d6b4', '#6e5c46']);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * (rx + 17) * k, cy + Math.sin(a) * (ry + 12) * k, r, r * DEPTH_K, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Water.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
  g.addColorStop(0, '#1f7fa8');
  g.addColorStop(0.45, '#2a9cc4');
  g.addColorStop(1, '#4cc2dc');
  ctx.fillStyle = g;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  const deep = ctx.createRadialGradient(cx, cy - 20, 40, cx, cy, rx);
  deep.addColorStop(0, 'rgba(12,70,110,0.45)');
  deep.addColorStop(0.6, 'rgba(12,70,110,0.15)');
  deep.addColorStop(1, 'rgba(12,70,110,0)');
  ctx.fillStyle = deep;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  // Mottled light from value noise.
  const n1 = makeNoise(21);
  const img = ctx.getImageData(cx - rx, cy - ry, rx * 2, ry * 2);
  for (let y = 0; y < ry * 2; y += 1) {
    for (let x = 0; x < rx * 2; x += 1) {
      const v = n1(x / 70, y / (70 * DEPTH_K)) - 0.5;
      const i = (y * rx * 2 + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + v * 26));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + v * 30));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + v * 24));
    }
  }
  ctx.putImageData(img, cx - rx, cy - ry);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  // Reflection of the far bank and trees.
  const refl = ctx.createLinearGradient(0, cy - ry, 0, cy - ry + 110);
  refl.addColorStop(0, 'rgba(20,70,50,0.5)');
  refl.addColorStop(1, 'rgba(20,70,50,0)');
  ctx.fillStyle = refl;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, 110);
  ctx.filter = 'blur(6px)';
  for (const x of [520, 700, 1220, 1400]) {
    ctx.fillStyle = 'rgba(30,90,50,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, cy - ry + 30, 70, 26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = 'none';
  // Glints: soft wavy highlights, stretched by the tilt.
  for (let i = 0; i < 90; i++) {
    const x = cx + rnd.range(-rx, rx);
    const y = cy + rnd.range(-ry, ry);
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 0.95) continue;
    const len = rnd.range(16, 44);
    ctx.strokeStyle = `rgba(210,248,255,${rnd.range(0.12, 0.3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y);
    ctx.quadraticCurveTo(x, y - 4, x + len / 2, y);
    ctx.stroke();
  }
  // Depth shade where the far bank meets the water.
  const lip = ctx.createLinearGradient(0, cy - ry, 0, cy - ry + 40);
  lip.addColorStop(0, 'rgba(10,40,50,0.55)');
  lip.addColorStop(1, 'rgba(10,40,50,0)');
  ctx.fillStyle = lip;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, 40);
  ctx.restore();
  // Foam line along the shore.
  ctx.save();
  ctx.filter = 'blur(2px)';
  ctx.strokeStyle = 'rgba(240,252,255,0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 3, ry - 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.filter = 'none';
  ctx.restore();
  // Jetty on the far shore.
  const jx = cx;
  const jy = cy - ry - 30;
  for (const [dx, dy] of [
    [-120, -30],
    [120, -30],
    [-120, 26],
    [120, 26],
  ] as const) {
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(jx + dx - 5, jy + dy - 16, 10, 34);
  }
  for (let k = 0; k < 7; k++) {
    const x = jx - 126 + k * 36;
    const pg = ctx.createLinearGradient(0, jy - 40, 0, jy + 30);
    pg.addColorStop(0, k % 2 ? '#c08a58' : '#b07c4c');
    pg.addColorStop(1, k % 2 ? '#9a6a40' : '#8a5c38');
    ctx.fillStyle = pg;
    roundRectPath(ctx, x, jy - 40, 33, 70, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + 3, jy - 38, 27, 3);
  }
  ctx.fillStyle = 'rgba(10,30,40,0.35)';
  ctx.fillRect(jx - 126, jy + 30, 252, 8);
  // Rocks around the shore (the near shore stays mostly open), reeds and lotus flowers.
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2 + rnd.range(-0.03, 0.03);
    if (Math.sin(a) > 0.5 && k % 3) continue;
    if (Math.abs(Math.cos(a)) < 0.2 && Math.sin(a) < 0) continue; // keep the jetty clear
    const bx = cx + Math.cos(a) * rx * rnd.range(1.0, 1.06);
    const by = cy + Math.sin(a) * ry * rnd.range(1.0, 1.08);
    drawRock(ctx, bx, by, rnd.range(12, 26), rnd);
  }
  for (let k = 0; k < 22; k++) {
    const a = k < 16 ? rnd.range(Math.PI * 1.05, Math.PI * 1.95) : rnd.chance(0.5) ? rnd.range(-0.3, 0.3) : rnd.range(Math.PI - 0.3, Math.PI + 0.3);
    if (Math.abs(Math.cos(a)) < 0.2 && Math.sin(a) < 0) continue;
    drawReeds(ctx, cx + Math.cos(a) * rx * 1.03, cy + Math.sin(a) * ry * 1.05, rnd);
  }
  for (let k = 0; k < 9; k++) {
    const a = rnd.next() * Math.PI * 2;
    drawLotus(ctx, cx + Math.cos(a) * rx * 0.93, cy + Math.sin(a) * ry * 0.9, rnd);
  }
  for (const [x, y, s] of [
    [300, 1032, 1.1],
    [1620, 1032, 1.1],
    [960, 1062, 1.0],
    [140, 520, 0.9],
    [1780, 520, 0.9],
    [700, 1052, 0.9],
    [1220, 1052, 0.9],
  ] as const) {
    drawBush(ctx, x, y, s, rnd);
  }
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawRock(ctx: Ctx, x: number, y: number, r: number, rnd: Random): void {
  ctx.fillStyle = 'rgba(10,30,30,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y + 3, r * 1.2, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.9, r * 0.1, x, y - r * 0.4, r * 1.2);
  g.addColorStop(0, '#dcd8cc');
  g.addColorStop(0.5, '#a8a498');
  g.addColorStop(1, '#6a665e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.4, r * rnd.range(0.95, 1.2), r * 0.75, rnd.range(-0.2, 0.2), 0, Math.PI * 2);
  ctx.fill();
  if (rnd.chance(0.4)) {
    ctx.fillStyle = 'rgba(110,170,70,0.7)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.95, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawReeds(ctx: Ctx, x: number, y: number, rnd: Random): void {
  const n = rnd.int(5, 9);
  for (let j = 0; j < n; j++) {
    const ox = rnd.range(-22, 22);
    const oy = rnd.range(-8, 8);
    const h = rnd.range(40, 80);
    const lean = rnd.range(-14, 14);
    ctx.strokeStyle = rnd.pick(['#5f9e3a', '#6fb04a', '#4f8a30']);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + ox, y + oy);
    ctx.quadraticCurveTo(x + ox + lean * 0.3, y + oy - h * 0.6, x + ox + lean, y + oy - h);
    ctx.stroke();
    if (rnd.chance(0.4)) {
      ctx.fillStyle = '#7a4a26';
      roundRectPath(ctx, x + ox + lean - 4, y + oy - h - 4, 8, 18, 4);
      ctx.fill();
    }
  }
}

function drawLotus(ctx: Ctx, x: number, y: number, rnd: Random): void {
  ctx.fillStyle = '#4f9a3a';
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 4, 20, 20 * DEPTH_K, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rnd.range(-0.1, 0.1);
    ctx.fillStyle = k % 2 ? '#ffc2dd' : '#ff9ecb';
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * 7, y + Math.sin(a) * 7 * DEPTH_K - 3, 6, 4, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(x, y - 4, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx: Ctx, x: number, y: number, s: number, rnd: Random): void {
  ctx.fillStyle = 'rgba(10,30,10,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 30 * s, y + 4, 70 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  const tg = ctx.createLinearGradient(x - 10 * s, 0, x + 10 * s, 0);
  tg.addColorStop(0, '#8a5c38');
  tg.addColorStop(1, '#5a3a22');
  ctx.fillStyle = tg;
  ctx.fillRect(x - 10 * s, y - 70 * s, 20 * s, 72 * s);
  for (const [dx, dy, r] of [
    [0, -130, 62],
    [-50, -100, 46],
    [50, -98, 48],
    [-20, -160, 44],
    [28, -150, 40],
  ] as const) {
    const bx = x + dx * s;
    const by = y + dy * s;
    const rr = r * s * rnd.range(0.92, 1.08);
    const cg = ctx.createRadialGradient(bx - rr * 0.35, by - rr * 0.4, rr * 0.1, bx, by, rr);
    cg.addColorStop(0, '#9fdc6a');
    cg.addColorStop(0.6, '#5fae45');
    cg.addColorStop(1, '#3a7a2e');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(bx, by, rr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBush(ctx: Ctx, x: number, y: number, s: number, rnd: Random): void {
  ctx.fillStyle = 'rgba(10,30,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(x + 10 * s, y + 2, 60 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy, r] of [
    [-30, -18, 26],
    [0, -26, 32],
    [30, -18, 26],
  ] as const) {
    const bx = x + dx * s;
    const by = y + dy * s;
    const rr = r * s;
    const cg = ctx.createRadialGradient(bx - rr * 0.3, by - rr * 0.4, 2, bx, by, rr);
    cg.addColorStop(0, '#8fd06a');
    cg.addColorStop(1, '#3f8a30');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(bx, by, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = rnd.pick(['#ff6b5e', '#ffe08a', '#ffffff']);
    ctx.beginPath();
    ctx.arc(x + rnd.range(-40, 40) * s, y - rnd.range(10, 40) * s, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLanternPost(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = 'rgba(10,30,10,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 2, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6e4a2c';
  ctx.fillRect(x - 5, y - 96, 10, 98);
  ctx.fillStyle = '#8a5c38';
  ctx.fillRect(x - 5, y - 96, 4, 98);
  const glow = ctx.createRadialGradient(x, y - 104, 2, x, y - 104, 40);
  glow.addColorStop(0, 'rgba(255,230,150,0.75)');
  glow.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 40, y - 144, 80, 80);
  ctx.fillStyle = '#ffd35c';
  roundRectPath(ctx, x - 11, y - 118, 22, 26, 7);
  ctx.fill();
  ctx.fillStyle = '#c98a1b';
  ctx.fillRect(x - 12, y - 121, 24, 5);
  ctx.fillRect(x - 12, y - 95, 24, 4);
}

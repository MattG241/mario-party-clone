import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { CSS, GAME_WIDTH, PLAYER_COLORS, PLAYER_COLORS_CSS, PLAYER_SHAPES } from '../../constants';
import { CHARACTERS } from '../../data/characters';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import type { VirtualControls } from '../../input/PlayerInput';
import { drawPlayerShape } from '../../ui/PlayerBadge';
import { addText } from '../../ui/theme';
import { Random } from '../../util/Random';
import { standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { drift, steer } from '../common';
import {
  applyFriction,
  boxBoxContact,
  boxHalfPlane,
  boxInside,
  circleBoxContact,
  circleContact,
  circleHalfPlane,
  containBox,
  containCircle,
  cornerCut,
  cornerRect,
  detourPoint,
  pushSpot,
  resolve,
  segmentDistance,
  zoneIndex,
  zoneSlots,
  zoneTotals,
  type Body,
  type HalfPlane,
  type Rect,
} from './crateCrazeLogic';

// --- Layout (screen px unless noted). Keep in sync with YARD in scripts/art/mg_arenas.py. ---------
/** Yard floor on screen; the fences stand on its edges. */
const FLOOR = { x: 240, y: 330, w: 1440, h: 670 };
/** Tilt of the orthographic yard camera from straight down (48° elevation). */
const TILT = (42 * Math.PI) / 180;
/** Screen px per floor unit of depth (floor units are screen px across). */
const DEPTH_K = Math.cos(TILT);
/** Screen px per floor unit of height (how tall a crate's front face looks). */
const HEIGHT_K = Math.sin(TILT);
/** The floor in floor units: x = screen x, y = depth from the back fence. */
const WORLD: Rect = { x: FLOOR.x, y: 0, w: FLOOR.w, h: FLOOR.h / DEPTH_K };
/** Scoring zones (screen px), one per floor corner: P1 top-left, P2 top-right, P3 bottom-left, P4 bottom-right. */
const ZONE_W = 330;
const ZONE_H = 200;
/** Zone count signs stand on the grass beside each zone, outside the side fences (x = centre). */
const SIGN_X_LEFT = 128;
const SIGN_X_RIGHT = 1792;
/** Crate edge in floor units (= screen px wide). */
const CRATE = 105;
const HALF = CRATE / 2;
/**
 * Rendered crate art ('rendered-mg-crate', golden: 'rendered-mg-crate-gold'): 105 px wide at scale 1,
 * anchored at the centre of its footprint on the floor. The anchor and render scale are read from
 * 'rendered-mg-sprites' (mg/sprites.json) when present; these are the defaults.
 */
const CRATE_ART_WIDTH = 105;
const CRATE_ANCHOR = { x: 0.5, y: 150 / 190 };
/** Fallback crate texture size (same framing as the rendered sprite: 180×190, anchor 90,150). */
const CRATE_TEX = { w: 180, h: 190 };
/** Spectators' feet line behind the back fence and their x positions (between the supply piles). */
const CROWD_Y = 318;
const CROWD_X = [452, 522, 706, 776, 1144, 1214, 1398, 1468];
/** Back-fence overlay strip (fallback art): drawn over the spectators, under everything on the floor. */
const FENCE_STRIP = { y: 250, h: 100 };
/** Front-fence overlay strip (fallback art): drawn over crates pressed against the front fence. */
const FRONT_STRIP = { y: 960, h: 60 };
/** Height above the landing spot a supply drop falls from (screen px). */
const DROP_HEIGHT = 760;
/** Diagonal planter across corners nobody plays in, so crates slide out rather than wedge (floor units). */
const PLANTER_LEG = 190;

// --- Tuning ---------------------------------------------------------------------------------------
const CHAR_SCALE = 0.6;
const PLAYER_R = 30;
const WALK = 400;
const CRATE_MASS = 1.6;
const GOLD_MASS = 2.3;
/** Sliding friction (floor units/s²) and drag (1/s) on crates. */
const FRICTION = 1500;
const DRAG = 1.2;
const WALL_BOUNCE = 0.3;
const CRATE_BOUNCE = 0.3;
const SHOVE_WINDUP = 170;
const SHOVE_CD = 650;
const SHOVE_IMPULSE = 1900;
const SHOVE_KNOCK = 880;
const SHOVE_STUN = 700;
const DASH_SPEED = 1050;
const DASH_MS = 200;
const DASH_CD = 1300;
const DROP_MS = 1150;
/** Crates allowed in the yard, and loose (not banked) ones before drops pause. */
const MAX_CRATES = 24;
const MAX_LOOSE = 12;
/** Overhang allowed for a crate to count as inside a zone (and extra slack before it counts as out). */
const ZONE_TOL = 6;
const ZONE_KEEP = 10;
/** Physics sub-step (ms): keeps fast crates from tunnelling at low frame rates. */
const SUBSTEP = 16;
/** Supply-drop events (ms since GO): a golden crate plus two plain ones fall together. */
const EVENTS = [17000, 34000, 48000];

type Mode = 'work' | 'wander' | 'guard';

interface Brain {
  think: number;
  mode: Mode;
  crate: Crate | null;
  goal: { x: number; y: number } | null;
  wanderT: number;
  wx: number;
  wy: number;
  lastX: number;
  lastY: number;
  stuck: number;
  moving: boolean;
  noise: number;
  bestD: number;
  /** Game time of the last real progress (≥ 20 units) pushing the target crate home. */
  progressAt: number;
  blockedT: number;
  avoid: Crate | null;
  avoidT: number;
  bully: Pusher | null;
  shoveWish: boolean;
  dashWish: boolean;
  /** Per falling crate: whether this CPU noticed it in time to step out from under it. */
  dodge: Map<number, boolean>;
  /** Personality: how much this CPU prizes golden crates. */
  greed: number;
}

interface Pusher extends Body {
  p: MgPlayer;
  c: Character;
  /** Facing (unit, floor space): shoves go this way. */
  fx: number;
  fy: number;
  weight: number;
  dashT: number;
  dashCd: number;
  windT: number;
  shoveCd: number;
  stunT: number;
  touching: Crate | null;
  trailT: number;
  tele: Phaser.GameObjects.Graphics;
  brain: Brain;
}

interface Crate extends Body {
  id: number;
  gold: boolean;
  points: number;
  mass: number;
  /** Height above the floor while a supply drop falls (screen px); 0 once landed. */
  z: number;
  dropT: number;
  /** Slot whose zone holds this crate, or -1. */
  zone: number;
  walled: boolean;
  sprite: Phaser.GameObjects.Image;
  /** Owner-colour silhouette (additive) shown while banked. */
  aura: Phaser.GameObjects.Image;
  /** Soft floor glow under a banked crate. */
  glow: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image | null;
  ring: Phaser.GameObjects.Image | null;
  drop: Phaser.GameObjects.Image | null;
  twinkle: Phaser.GameObjects.Image | null;
  dustT: number;
  clackT: number;
  lastPusher: Pusher | null;
}

interface Zone {
  slot: number;
  rect: Rect;
  screen: Rect;
  slots: { x: number; y: number }[];
  sign: Phaser.GameObjects.Container;
  count: Phaser.GameObjects.Text;
}

/**
 * Crate Craze — a festival supply yard seen at 3/4. Walk into crates to push them, shove (A) crates
 * and rivals, dash (X), and bank crates fully inside your corner zone. Golden festival crates are
 * heavier and worth 3. Fresh supplies drop from the sky. Most points banked after 60 s wins.
 */
export class CrateCrazeScene extends BaseMinigame {
  private pushers: Pusher[] = [];
  private crates: Crate[] = [];
  private zones: (Zone | null)[] = [];
  private zoneRects: (Rect | null)[] = [];
  private planters: HalfPlane[] = [];
  private crowd: Phaser.GameObjects.Sprite[] = [];
  private nextId = 0;
  private dropT = 0;
  private eventIdx = 0;
  private renderedCrate = false;
  private finished = false;

  constructor() {
    super('mg-crate-craze');
  }

  // --- Arena ---------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 60000;
    this.pushers = [];
    this.crates = [];
    this.zones = [null, null, null, null];
    this.zoneRects = [null, null, null, null];
    this.planters = [];
    this.crowd = [];
    this.nextId = 0;
    this.dropT = 5200;
    this.eventIdx = 0;
    this.finished = false;
    this.renderedCrate = this.textures.exists('rendered-mg-crate');
    this.buildBackdrop();
    const used = new Set(this.players.map((p) => p.slot));
    for (let corner = 0; corner < 4; corner++) {
      if (used.has(corner)) this.buildZone(corner);
      else this.buildPlanter(corner);
    }
    this.scatterCrates();
  }

  private buildBackdrop(): void {
    const sky = this.textures.exists('rendered-sky-day') ? 'rendered-sky-day' : 'bg-sky';
    this.add.image(GAME_WIDTH / 2, 540, sky).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
    if (this.textures.exists('rendered-scene-crate')) {
      // Pre-rendered supply yard; spectators only when the back fence is supplied as an overlay.
      this.add.image(0, 0, 'rendered-scene-crate').setOrigin(0).setDepth(-50);
      if (this.textures.exists('rendered-scene-crate_wall')) {
        this.buildCrowd();
        this.add.image(0, 0, 'rendered-scene-crate_wall').setOrigin(0).setDepth(FLOOR.y - 1);
      }
    } else {
      makeYardTextures(this);
      this.add.image(0, 0, 'cc-yard-bg').setOrigin(0).setDepth(-50);
      this.buildCrowd();
      this.add.image(0, FENCE_STRIP.y, 'cc-yard-fence').setOrigin(0).setDepth(FLOOR.y - 1);
      this.add.image(0, FRONT_STRIP.y, 'cc-yard-front').setOrigin(0).setDepth(FLOOR.y + FLOOR.h + 2);
    }
    if (!this.renderedCrate) makeCrateTextures(this);
  }

  /** Festival folk watching from behind the back fence (bob, and hop when something big happens). */
  private buildCrowd(): void {
    const folk: [NpcId, string][] = [
      ['mimi', 'happy'],
      ['packsprout', 'cheer'],
      ['ora', 'cheer'],
      ['pipper', 'happy'],
      ['wrench', 'laugh'],
      ['mimi', 'laugh'],
      ['packsprout', 'star'],
      ['ora', 'wave'],
    ];
    CROWD_X.forEach((x, i) => {
      const [id, pose] = folk[i % folk.length];
      const y = CROWD_Y - (i % 2) * 6;
      const spr = this.add.sprite(x, y, NPC_ATLAS, npcFrame(id, pose));
      const o = standOrigin(NPC_ATLAS, npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(0.4).setDepth(FLOOR.y - 20 + i * 0.01).setFlipX(x > GAME_WIDTH / 2);
      this.add.image(x, y + 2, 'fx-contact').setScale(0.55, 0.16).setAlpha(0.45).setDepth(FLOOR.y - 20.5);
      this.tweens.add({ targets: spr, y: y - 7, duration: 400 + (i % 3) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 60 });
      this.crowd.push(spr);
    });
  }

  private crowdCheer(): void {
    audio.play('cheer', { volume: 0.4, throttleMs: 400 });
    this.crowd.forEach((spr, i) => {
      this.tweens.add({ targets: spr, scaleY: { from: 0.34, to: 0.44 }, duration: 150, yoyo: true, repeat: 2, delay: i * 35, onComplete: () => spr.setScale(0.4) });
    });
  }

  /** Screen y of a floor point. */
  private sy(y: number): number {
    return FLOOR.y + y * DEPTH_K;
  }

  private buildZone(corner: number): void {
    const color = PLAYER_COLORS[corner];
    const screen = cornerRect(FLOOR, corner, ZONE_W, ZONE_H);
    const rect: Rect = { x: screen.x, y: (screen.y - FLOOR.y) / DEPTH_K, w: screen.w, h: screen.h / DEPTH_K };
    const right = corner % 2 === 1;
    const bottom = corner >= 2;
    const g = this.add.graphics().setDepth(4);
    // Translucent paint that is strongest in the corner and fades towards the open edges.
    const aNear = 0.42;
    const aFar = 0.14;
    g.fillGradientStyle(color, color, color, color, !right && !bottom ? aNear : aFar, right && !bottom ? aNear : aFar, !right && bottom ? aNear : aFar, right && bottom ? aNear : aFar);
    g.fillRect(screen.x, screen.y, screen.w, screen.h);
    // A painted inner border and the slot's shape as a floor decal (colour is never the only cue).
    const mx = screen.x + screen.w / 2;
    const my = screen.y + screen.h / 2;
    g.lineStyle(6, 0xffffff, 0.16);
    g.strokeRect(screen.x + 16, screen.y + 12, screen.w - 32, screen.h - 24);
    const shape = this.add.graphics().setDepth(4.5);
    drawPlayerShape(shape, PLAYER_SHAPES[corner], 0, 0, 52, color, 0xffffff, 8);
    shape.setPosition(mx, my).setScale(1, DEPTH_K).setAlpha(0.32);
    // Dashed bright rim with a soft glow underneath (the glow pulses).
    const rimGlow = this.add.graphics().setDepth(4.2).setBlendMode(Phaser.BlendModes.ADD);
    rimGlow.lineStyle(18, color, 0.35);
    rimGlow.strokeRect(screen.x + 4, screen.y + 4, screen.w - 8, screen.h - 8);
    this.tweens.add({ targets: rimGlow, alpha: { from: 0.45, to: 1 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const rim = this.add.graphics().setDepth(4.6);
    dashedRect(rim, screen.x + 4, screen.y + 4, screen.w - 8, screen.h - 8, 26, 14, 7, color, 1);
    dashedRect(rim, screen.x + 4, screen.y + 4, screen.w - 8, screen.h - 8, 26, 14, 2.5, 0xffffff, 0.9);
    // Count sign beside the zone, outside the fence, so crates and players never hide it.
    const sign = this.add.container(right ? SIGN_X_RIGHT : SIGN_X_LEFT, my).setDepth(8000);
    const bg = this.add.graphics();
    bg.fillStyle(0x06141a, 0.35);
    bg.fillRoundedRect(-78, -26, 164, 60, 30);
    bg.fillStyle(0x0c2630, 0.92);
    bg.fillRoundedRect(-82, -30, 164, 60, 30);
    bg.fillStyle(0xffffff, 0.08);
    bg.fillRoundedRect(-74, -26, 148, 24, 12);
    bg.lineStyle(4, color, 1);
    bg.strokeRoundedRect(-82, -30, 164, 60, 30);
    const badge = this.add.graphics();
    drawPlayerShape(badge, PLAYER_SHAPES[corner], -48, 0, 18, color, 0xffffff, 3);
    const tag = addText(this, -48, 1, `P${corner + 1}`, 14, { color: '#ffffff', stroke: '#1b1530', strokeThickness: 3, weight: 700, fixed: true });
    const icon = this.add.graphics();
    drawCrateIcon(icon, 2, 0);
    const count = addText(this, 52, 1, '0', 40, { color: CSS.cream, weight: 700, stroke: '#06141a', strokeThickness: 5, fixed: true });
    sign.add([bg, badge, tag, icon, count]);
    this.zones[corner] = { slot: corner, rect, screen, slots: zoneSlots(rect, corner, CRATE, 3, 2, 3), sign, count };
    this.zoneRects[corner] = rect;
  }

  /** Flower planter cutting off a corner nobody plays in (so crates can always be pushed out). */
  private buildPlanter(corner: number): void {
    this.planters.push(cornerCut(WORLD, corner, PLANTER_LEG));
    const right = corner % 2 === 1;
    const bottom = corner >= 2;
    const cx = right ? FLOOR.x + FLOOR.w : FLOOR.x;
    const cy = bottom ? FLOOR.y + FLOOR.h : FLOOR.y;
    const ax = cx + (right ? -PLANTER_LEG : PLANTER_LEG);
    const by = cy + (bottom ? -PLANTER_LEG * DEPTH_K : PLANTER_LEG * DEPTH_K);
    const g = this.add.graphics().setDepth(bottom ? FLOOR.y + FLOOR.h + 5 : FLOOR.y + 1);
    const pts = [
      { x: cx, y: cy },
      { x: ax, y: cy },
      { x: cx, y: by },
    ];
    g.fillStyle(0x0b1a24, 0.25);
    g.fillTriangle(pts[0].x + 8, pts[0].y + 6, pts[1].x + 8, pts[1].y + 6, pts[2].x + 8, pts[2].y + 6);
    g.fillStyle(0x5b3a22, 1);
    g.fillTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    g.fillStyle(0x3d2616, 1);
    const inset = 0.16;
    const ix = (p: { x: number; y: number }) => p.x + (cx + (ax - cx) / 3 - p.x) * inset;
    const iy = (p: { x: number; y: number }) => p.y + (cy + (by - cy) / 3 - p.y) * inset;
    g.fillTriangle(ix(pts[0]), iy(pts[0]), ix(pts[1]), iy(pts[1]), ix(pts[2]), iy(pts[2]));
    // Timber edging along the diagonal.
    g.lineStyle(12, 0x7a5234, 1);
    g.lineBetween(ax, cy, cx, by);
    g.lineStyle(4, 0xc08a58, 1);
    g.lineBetween(ax, cy - 5, cx, by - 5);
    // Bushes and flowers.
    const rnd = new Random(77 + corner);
    for (let i = 0; i < 9; i++) {
      const u = rnd.range(0.12, 0.7);
      const v = rnd.range(0.08, 0.85 - u);
      const x = cx + (ax - cx) * u;
      const y = cy + (by - cy) * v;
      const r = rnd.range(13, 22);
      g.fillStyle(0x2f6b2a, 1);
      g.fillCircle(x + 2, y + 2, r);
      g.fillStyle(rnd.chance(0.5) ? 0x4f9a3a : 0x5fae45, 1);
      g.fillCircle(x, y - 3, r);
      g.fillStyle(0x8fd06a, 0.8);
      g.fillCircle(x - r * 0.35, y - r * 0.55, r * 0.35);
      if (rnd.chance(0.7)) {
        g.fillStyle(rnd.pick([0xff6b5e, 0xffe08a, 0xffffff, 0xc49bff]), 1);
        for (let k = 0; k < 3; k++) g.fillCircle(x + rnd.range(-r, r) * 0.7, y - 3 + rnd.range(-r, r) * 0.5, 3.2);
      }
    }
  }

  // --- Crates --------------------------------------------------------------------------------------
  private makeCrate(x: number, y: number, gold: boolean, dropping: boolean): Crate {
    const goldArt = gold && this.textures.exists('rendered-mg-crate-gold');
    const art = this.renderedCrate ? (goldArt ? 'rendered-mg-crate-gold' : 'rendered-mg-crate') : gold ? 'cc-crate-gold' : 'cc-crate';
    const meta = this.renderedCrate ? artMeta(this, goldArt ? 'crate_gold' : 'crate', CRATE_ANCHOR) : { x: CRATE_ANCHOR.x, y: CRATE_ANCHOR.y, k: 1 };
    const scale = this.renderedCrate ? (CRATE / CRATE_ART_WIDTH) * meta.k : 1;
    const sprite = this.add.image(0, 0, art).setOrigin(meta.x, meta.y).setScale(scale);
    if (this.renderedCrate && gold && !goldArt) sprite.setTint(0xffd45a);
    const aura = this.add.image(0, 0, art).setOrigin(meta.x, meta.y).setScale(scale).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setVisible(false);
    const glow = this.add.image(0, 0, 'fx-dot').setScale((CRATE * 2.3) / 24, (CRATE * DEPTH_K * 2.3) / 24).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setVisible(false);
    // The cast shadow is a separate floor-layer sprite so it never falls across players behind the crate.
    const shadow = !this.renderedCrate
      ? this.add.image(0, 0, 'cc-crate-shadow').setAlpha(0.85)
      : this.textures.exists('rendered-mg-crate-shadow')
        ? this.add.image(0, 0, 'rendered-mg-crate-shadow').setOrigin(meta.x, meta.y).setScale(scale)
        : null;
    const twinkle = gold ? this.add.image(0, 0, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff4c0).setAlpha(0) : null;
    const k: Crate = {
      id: this.nextId++,
      x,
      y,
      vx: 0,
      vy: 0,
      gold,
      points: gold ? 3 : 1,
      mass: gold ? GOLD_MASS : CRATE_MASS,
      z: dropping ? DROP_HEIGHT : 0,
      dropT: dropping ? DROP_MS : 0,
      zone: -1,
      walled: false,
      sprite,
      aura,
      glow,
      shadow,
      ring: null,
      drop: null,
      twinkle,
      dustT: 0,
      clackT: 0,
      lastPusher: null,
    };
    if (dropping) {
      // Landing telegraph: a shadow that darkens and a ring that closes in on the spot.
      const sx = x;
      const sy = this.sy(y);
      k.drop = this.add.image(sx, sy, 'fx-contact').setScale(0.2, 0.2 * DEPTH_K).setAlpha(0.2).setDepth(5);
      k.ring = this.add
        .image(sx, sy, 'fx-ring')
        .setTint(gold ? 0xffb020 : 0xfff4dc)
        .setAlpha(0.4)
        .setDepth(6)
        .setBlendMode(gold ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      shadow?.setVisible(false);
    }
    this.crates.push(k);
    this.placeCrate(k);
    return k;
  }

  /** Sprite placement for a crate (anchor = centre of its footprint on the floor). */
  private placeCrate(k: Crate): void {
    const sx = k.x;
    const sy = this.sy(k.y);
    k.sprite.setPosition(sx, sy - k.z).setDepth(sy + 0.5);
    k.aura.setPosition(sx, sy - k.z).setDepth(sy + 0.6);
    k.glow.setPosition(sx, sy).setDepth(5);
    if (this.renderedCrate) k.shadow?.setPosition(sx, sy).setDepth(5.5);
    else k.shadow?.setPosition(sx + 12, sy - 3).setDepth(5.5);
    if (k.twinkle) k.twinkle.setDepth(sy + 0.7);
  }

  private scatterCrates(): void {
    const n = this.players.length;
    const plain = 8 + (n >= 3 ? 1 : 0) + (n >= 4 ? 1 : 0);
    const gold = n >= 4 ? 3 : 2;
    const spawns = this.players.map((_p, i) => this.spawnPoint(i));
    const ok = (x: number, y: number) => spawns.every((s) => Math.hypot(s.x - x, s.y - y) > 170);
    // Golden crates start in the contested middle; plain ones spread out.
    for (let i = 0; i < gold; i++) {
      const spot = this.freeSpot(40, 0.34, ok);
      if (spot) this.makeCrate(spot.x, spot.y, true, false);
    }
    for (let i = 0; i < plain; i++) {
      const spot = this.freeSpot(40, 1, ok);
      if (spot) this.makeCrate(spot.x, spot.y, false, false);
    }
  }

  /**
   * A random spot for a crate clear of other crates, zones and planters. `spread` limits it to the
   * middle of the yard (1 = anywhere).
   */
  private freeSpot(gap: number, spread: number, extra?: (x: number, y: number) => boolean): { x: number; y: number } | null {
    const cx = WORLD.x + WORLD.w / 2;
    const cy = WORLD.y + WORLD.h / 2;
    const hw = (WORLD.w / 2 - HALF - 24) * spread;
    const hh = (WORLD.h / 2 - HALF - 24) * spread;
    for (let tries = 0; tries < 60; tries++) {
      const x = cx + this.rng.range(-hw, hw);
      const y = cy + this.rng.range(-hh, hh);
      let bad = false;
      for (const z of this.zoneRects) {
        if (z && x + HALF > z.x - 50 && x - HALF < z.x + z.w + 50 && y + HALF > z.y - 50 && y - HALF < z.y + z.h + 50) bad = true;
      }
      for (const hp of this.planters) if (x * hp.nx + y * hp.ny - HALF * 1.5 < hp.d + 30) bad = true;
      for (const k of this.crates) if (Math.abs(k.x - x) < CRATE + gap && Math.abs(k.y - y) < CRATE + gap) bad = true;
      if (bad || (extra && !extra(x, y))) continue;
      return { x, y };
    }
    return null;
  }

  private loose(): number {
    return this.crates.filter((k) => k.zone < 0).length;
  }

  private dropCrate(gold: boolean, near?: { x: number; y: number }): void {
    if (this.crates.length >= MAX_CRATES) return;
    let spot: { x: number; y: number } | null = null;
    if (near) {
      for (let i = 0; i < 12 && !spot; i++) {
        const x = near.x + this.rng.range(-230, 230);
        const y = near.y + this.rng.range(-170, 170);
        const clear = this.crates.every((k) => Math.abs(k.x - x) > CRATE + 20 || Math.abs(k.y - y) > CRATE + 20);
        const inside = x > WORLD.x + HALF + 20 && x < WORLD.x + WORLD.w - HALF - 20 && y > HALF + 20 && y < WORLD.h - HALF - 20;
        const zoneFree = this.zoneRects.every((z) => !z || x + HALF < z.x - 30 || x - HALF > z.x + z.w + 30 || y + HALF < z.y - 30 || y - HALF > z.y + z.h + 30);
        if (clear && inside && zoneFree) spot = { x, y };
      }
    }
    spot ??= this.freeSpot(24, 0.9);
    if (!spot) return;
    this.makeCrate(spot.x, spot.y, gold, true);
    audio.play('whoosh', { volume: 0.3, rate: 0.6, throttleMs: 120 });
  }

  private supplyDrop(): void {
    audio.play('eventAlert', { volume: 0.55 });
    const t = addText(this, GAME_WIDTH / 2, 262, 'SUPPLY DROP!', 70, { color: CSS.goldLight, stroke: '#3a2208', strokeThickness: 10, weight: 700, fixed: true }).setDepth(9000);
    t.setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: 222, alpha: 0, delay: 1100, duration: 450, onComplete: () => t.destroy() });
    this.crowdCheer();
    const centre = { x: WORLD.x + WORLD.w / 2 + this.rng.range(-220, 220), y: WORLD.h / 2 + this.rng.range(-120, 120) };
    this.dropCrate(true, centre);
    this.time.delayedCall(260, () => this.phase === 'playing' && this.dropCrate(false, centre));
    this.time.delayedCall(520, () => this.phase === 'playing' && this.dropCrate(false, centre));
  }

  private updateDrops(dt: number): void {
    this.dropT -= dt;
    if (this.dropT <= 0) {
      const progress = this.elapsed / this.duration;
      this.dropT = 4800 - progress * 1500 + this.rng.range(-500, 500);
      if (this.loose() < MAX_LOOSE) this.dropCrate(this.rng.chance(0.16 + progress * 0.14));
    }
    if (this.eventIdx < EVENTS.length && this.elapsed >= EVENTS[this.eventIdx]) {
      this.eventIdx++;
      this.supplyDrop();
    }
    for (const k of this.crates) {
      if (k.dropT <= 0) continue;
      k.dropT -= dt;
      const t = 1 - Math.max(0, k.dropT) / DROP_MS;
      k.z = DROP_HEIGHT * (1 - t * t);
      const sy = this.sy(k.y);
      k.drop?.setPosition(k.x, sy).setScale((0.3 + t * 0.9) * (CRATE / 110), (0.3 + t * 0.9) * (CRATE / 110) * DEPTH_K).setAlpha(0.15 + t * 0.6);
      const rs = (1.9 - t * 1.05) * (CRATE / 128);
      k.ring?.setPosition(k.x, sy).setScale(rs, rs * DEPTH_K).setAlpha(0.35 + t * 0.6);
      if (k.dropT <= 0) this.landCrate(k);
    }
  }

  private landCrate(k: Crate): void {
    k.dropT = 0;
    k.z = 0;
    k.ring?.destroy();
    k.ring = null;
    k.drop?.destroy();
    k.drop = null;
    k.shadow?.setVisible(true);
    const sx = k.x;
    const sy = this.sy(k.y);
    audio.play('land', { volume: 0.7, rate: k.gold ? 0.8 : 1 });
    audio.play('crack', { volume: 0.25, throttleMs: 90 });
    this.fx.shake(k.gold ? 0.005 : 0.003, 140);
    for (const [dx, dy] of [
      [-HALF, HALF * DEPTH_K],
      [HALF, HALF * DEPTH_K],
      [0, HALF * DEPTH_K + 6],
    ]) {
      this.fx.vfx('dust', sx + dx, sy + dy, { scale: 0.3, duration: 420, alpha: 0.7, depth: sy + 2 });
    }
    this.tweens.add({ targets: k.sprite, scaleY: { from: k.sprite.scaleX * 0.82, to: k.sprite.scaleX }, scaleX: { from: k.sprite.scaleX * 1.1, to: k.sprite.scaleX }, duration: 220, ease: 'Back.Out' });
    if (k.gold) {
      this.fx.sparks(sx, sy - 60, 16);
      this.crowdCheer();
    }
    // Anyone caught underneath gets bonked out of the way.
    for (const u of this.pushers) {
      const c = circleBoxContact(u.x, u.y, PLAYER_R, k.x, k.y, HALF);
      if (!c) continue;
      let dx = u.x - k.x;
      let dy = u.y - k.y;
      const m = Math.hypot(dx, dy);
      if (m < 1) {
        dx = Math.random() < 0.5 ? -1 : 1;
        dy = 0;
      } else {
        dx /= m;
        dy /= m;
      }
      u.x = k.x + dx * (HALF + PLAYER_R + 4);
      u.y = k.y + dy * (HALF + PLAYER_R + 4);
      this.stun(u, 900, dx * (700 / u.weight), dy * (700 / u.weight));
      this.fx.floatText(u.x, this.sy(u.y) - 170, 'BONK!', '#fff4dc', { size: 46, rise: 60, duration: 800, stroke: '#6a1830' });
    }
  }

  // --- Players -------------------------------------------------------------------------------------
  /** Start spot for player index i: just inside the mouth of their own zone. */
  private spawnPoint(i: number): { x: number; y: number } {
    const slot = this.players[i]?.slot ?? i;
    const z = cornerRect(WORLD, slot, ZONE_W, ZONE_H / DEPTH_K);
    const right = slot % 2 === 1;
    const bottom = slot >= 2;
    return { x: right ? z.x + z.w * 0.3 : z.x + z.w * 0.7, y: bottom ? z.y + z.h * 0.25 : z.y + z.h * 0.75 };
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const s = this.spawnPoint(index);
    const c = new Character(this, s.x, this.sy(s.y), p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    const toCentre = WORLD.x + WORLD.w / 2 - s.x;
    c.face(toCentre < 0);
    p.character = c;
    const fx = Math.sign(toCentre) || 1;
    this.pushers.push({
      p,
      c,
      x: s.x,
      y: s.y,
      vx: 0,
      vy: 0,
      fx,
      fy: 0,
      weight: CHARACTERS[p.characterId].handling.weight,
      dashT: 0,
      dashCd: 0,
      windT: 0,
      shoveCd: 0,
      stunT: 0,
      touching: null,
      trailT: 0,
      tele: this.add.graphics().setDepth(6),
      brain: {
        think: 400 + index * 120,
        mode: 'work',
        crate: null,
        goal: null,
        wanderT: 0,
        wx: s.x,
        wy: s.y,
        lastX: s.x,
        lastY: s.y,
        stuck: 0,
        moving: false,
        noise: 0,
        bestD: Infinity,
        progressAt: 0,
        blockedT: 0,
        avoid: null,
        avoidT: 0,
        bully: null,
        shoveWish: false,
        dashWish: false,
        dodge: new Map(),
        greed: 0.75 + Math.random() * 0.5,
      },
    });
  }

  protected override onStart(): void {
    for (const u of this.pushers) u.c.play('wave');
    this.crowdCheer();
  }

  protected override hudLabel(p: MgPlayer): string {
    return `${p.score}`;
  }

  private stun(u: Pusher, ms: number, vx: number, vy: number): void {
    u.stunT = Math.max(u.stunT, ms);
    u.windT = 0;
    u.dashT = 0;
    u.vx = vx;
    u.vy = vy;
    u.tele.clear();
    u.c.play('stunned', { force: true, returnTo: 'idle' });
    const sy = this.sy(u.y);
    this.fx.vfx('impact', u.x, sy - 90, { scale: 0.45, duration: 320, blend: 'add' });
    this.fx.vfx('starSwirl', u.x, sy + u.c.headY * CHAR_SCALE - 10, { scale: 0.32, duration: Math.max(500, ms), blend: 'add' });
    audio.play('hit', { volume: 0.6, throttleMs: 60 });
    this.rumble(u.p, 0.6, 0.4, 200);
  }

  private startShove(u: Pusher): void {
    u.windT = SHOVE_WINDUP;
    u.c.hold('crouch');
    u.c.squash(0.12, SHOVE_WINDUP);
    audio.play('step', { volume: 0.5, rate: 0.8 });
  }

  private releaseShove(u: Pusher): void {
    u.windT = 0;
    u.shoveCd = SHOVE_CD;
    u.tele.clear();
    u.c.play('throw', { force: true, returnTo: 'idle' });
    u.vx += u.fx * 320;
    u.vy += u.fy * 320;
    audio.play('whoosh', { volume: 0.5, rate: 1.25 });
    const reach = PLAYER_R + 44;
    const hx = u.x + u.fx * reach;
    const hy = u.y + u.fy * reach;
    let hit = false;
    for (const k of this.crates) {
      if (k.dropT > 0 || !circleBoxContact(hx, hy, 60, k.x, k.y, HALF)) continue;
      // Mostly along the facing, nudged towards the crate's centre for natural glancing blows.
      const cx = k.x - u.x;
      const cy = k.y - u.y;
      const cm = Math.hypot(cx, cy) || 1;
      let dx = u.fx * 0.8 + (cx / cm) * 0.2;
      let dy = u.fy * 0.8 + (cy / cm) * 0.2;
      const dm = Math.hypot(dx, dy) || 1;
      dx /= dm;
      dy /= dm;
      k.vx += (dx * SHOVE_IMPULSE) / k.mass;
      k.vy += (dy * SHOVE_IMPULSE) / k.mass;
      k.lastPusher = u;
      hit = true;
      this.tweens.add({ targets: k.sprite, scaleX: { from: k.sprite.scaleY * 1.08, to: k.sprite.scaleY }, duration: 160, ease: 'Quad.Out' });
    }
    for (const r of this.pushers) {
      if (r === u || r.stunT > 0) continue;
      const dx = r.x - u.x;
      const dy = r.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > PLAYER_R * 2 + 72 || d < 1) continue;
      if ((dx / d) * u.fx + (dy / d) * u.fy < 0.35) continue;
      const kx = (dx / d) * 0.5 + u.fx * 0.5;
      const ky = (dy / d) * 0.5 + u.fy * 0.5;
      const km = Math.hypot(kx, ky) || 1;
      this.stun(r, SHOVE_STUN, (kx / km) * (SHOVE_KNOCK / r.weight), (ky / km) * (SHOVE_KNOCK / r.weight));
      hit = true;
    }
    const sx = hx;
    const sy = this.sy(hy);
    if (hit) {
      audio.play('hit', { volume: 0.55 });
      this.fx.vfx('impact', sx, sy - 50, { scale: 0.5, duration: 300, blend: 'add' });
      this.fx.shake(0.004, 110);
      this.rumble(u.p, 0.5, 0.4, 140);
    } else {
      this.fx.vfx('dust', sx, sy, { scale: 0.22, duration: 320, alpha: 0.55, depth: sy + 1 });
    }
  }

  private startDash(u: Pusher, mx: number, my: number, mm: number): void {
    const hand = CHARACTERS[u.p.characterId].handling;
    const dx = mm > 0.25 ? mx / mm : u.fx;
    const dy = mm > 0.25 ? my / mm : u.fy;
    u.fx = dx;
    u.fy = dy;
    u.vx = dx * DASH_SPEED * hand.speed;
    u.vy = dy * DASH_SPEED * hand.speed;
    u.dashT = DASH_MS;
    u.dashCd = DASH_CD;
    u.c.play('dash', { force: true, returnTo: 'run' });
    audio.play('whoosh', { volume: 0.55 });
    this.rumble(u.p, 0.2, 0.3, 80);
    const sy = this.sy(u.y);
    this.fx.vfx('dust', u.x - dx * 30, sy, { scale: 0.26, duration: 360, alpha: 0.6, depth: sy - 1 });
  }

  // --- Frame ---------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.updateDrops(dt);
    this.updateActions(dt);
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const sdt = dt / steps;
    for (const u of this.pushers) u.touching = null;
    for (let i = 0; i < steps; i++) this.physicsStep(sdt);
    this.updateZones();
    this.syncVisuals();
    for (const k of this.crates) {
      k.dustT -= dt;
      k.clackT -= dt;
      if (k.dropT > 0 || k.dustT > 0) continue;
      const sp = Math.hypot(k.vx, k.vy);
      const sy = this.sy(k.y);
      if (sp > 380) {
        // Dust kicked up by fast-sliding crates.
        k.dustT = 90;
        this.fx.vfx('dust', k.x - Math.sign(k.vx) * HALF * 0.6, sy + HALF * DEPTH_K, { scale: 0.2, duration: 320, alpha: 0.5, depth: sy - 1 });
      } else if (sp > 70 && this.pushers.some((u) => u.touching === k)) {
        // Scuffs at the base while someone is shoving it along.
        k.dustT = 280;
        this.fx.vfx('dust', k.x - (k.vx / sp) * HALF * 0.8, sy + HALF * DEPTH_K - (k.vy / sp) * HALF * 0.5, { scale: 0.14, duration: 300, alpha: 0.45, depth: sy - 1 });
      }
    }
  }

  /** Buttons are read once per frame (they are edge-triggered); movement runs in sub-steps. */
  private updateActions(dt: number): void {
    for (const u of this.pushers) {
      const c = u.p.controls;
      u.dashCd = Math.max(0, u.dashCd - dt);
      u.shoveCd = Math.max(0, u.shoveCd - dt);
      if (u.stunT > 0) {
        u.stunT -= dt;
        continue;
      }
      if (u.windT > 0) {
        u.windT -= dt;
        this.drawTelegraph(u);
        if (u.windT <= 0) this.releaseShove(u);
        continue;
      }
      if (u.dashT > 0) {
        u.dashT -= dt;
        u.trailT -= dt;
        if (u.trailT <= 0) {
          u.trailT = 55;
          const sy = this.sy(u.y);
          this.fx.vfx('dust', u.x, sy, { scale: 0.18, duration: 300, alpha: 0.5, depth: sy - 1 });
        }
        continue;
      }
      const mx = c.moveX;
      const my = c.moveY;
      const mm = Math.hypot(mx, my);
      if (mm > 0.25) {
        u.fx = mx / mm;
        u.fy = my / mm;
      }
      if (c.pressed('A') && u.shoveCd <= 0) this.startShove(u);
      else if (c.pressed('X') && u.dashCd <= 0) this.startDash(u, mx, my, mm);
    }
  }

  /** Floor wedge in front of a winding-up shover so rivals can read it coming. */
  private drawTelegraph(u: Pusher): void {
    const g = u.tele;
    g.clear();
    const t = 1 - Math.max(0, u.windT) / SHOVE_WINDUP;
    const color = PLAYER_COLORS[u.p.slot];
    const a0 = Math.atan2(u.fy, u.fx);
    const r0 = PLAYER_R + 6;
    const r1 = PLAYER_R + 44 + 60 * (0.6 + 0.4 * t);
    const at = (a: number, r: number) => ({ x: u.x + Math.cos(a) * r, y: this.sy(u.y + Math.sin(a) * r) });
    g.fillStyle(color, 0.18 + 0.3 * t);
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const q = at(a0 - 0.75 + (1.5 * i) / 8, r1);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    }
    for (let i = 8; i >= 0; i--) {
      const q = at(a0 - 0.75 + (1.5 * i) / 8, r0);
      g.lineTo(q.x, q.y);
    }
    g.closePath();
    g.fillPath();
    g.lineStyle(3, 0xffffff, 0.35 + 0.5 * t);
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const q = at(a0 - 0.75 + (1.5 * i) / 8, r1);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    }
    g.strokePath();
  }

  private physicsStep(sdt: number): void {
    const s = sdt / 1000;
    for (const u of this.pushers) {
      const hand = CHARACTERS[u.p.characterId].handling;
      if (u.stunT > 0) drift(u, sdt, 5);
      else if (u.dashT > 0) drift(u, sdt, 1.6);
      else {
        const c = u.p.controls;
        const k = u.windT > 0 ? 0.25 : 1;
        steer(u, c.moveX * k, c.moveY * k, sdt, { maxSpeed: WALK * hand.speed, accel: 12 * hand.accel, friction: 10 });
      }
    }
    for (const k of this.crates) {
      if (k.dropT > 0) continue;
      k.x += k.vx * s;
      k.y += k.vy * s;
      applyFriction(k, FRICTION, DRAG, s);
    }
    this.collide(false);
    // Walls and planters, then settle again treating crates pinned against a wall as immovable
    // (stops things sinking into each other when someone pushes a crate into the fence).
    for (const k of this.crates) {
      if (k.dropT > 0) continue;
      let hit = containBox(k, HALF, WORLD, WALL_BOUNCE);
      k.walled = k.x - HALF <= WORLD.x + 0.5 || k.x + HALF >= WORLD.x + WORLD.w - 0.5 || k.y - HALF <= WORLD.y + 0.5 || k.y + HALF >= WORLD.y + WORLD.h - 0.5;
      for (const hp of this.planters) {
        hit = Math.max(hit, boxHalfPlane(k, HALF, hp, WALL_BOUNCE));
        if (k.x * hp.nx + k.y * hp.ny - HALF * (Math.abs(hp.nx) + Math.abs(hp.ny)) <= hp.d + 0.5) k.walled = true;
      }
      if (hit > 280) this.thud(k, hit);
    }
    this.collide(true);
    for (const u of this.pushers) {
      containCircle(u, PLAYER_R, WORLD);
      for (const hp of this.planters) circleHalfPlane(u, PLAYER_R, hp);
    }
  }

  private collide(settle: boolean): void {
    const crates = this.crates;
    const massOf = (k: Crate) => (settle && k.walled ? Infinity : k.mass);
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < crates.length; i++) {
        const a = crates[i];
        if (a.dropT > 0) continue;
        for (let j = i + 1; j < crates.length; j++) {
          const b = crates[j];
          if (b.dropT > 0) continue;
          const c = boxBoxContact(a.x, a.y, HALF, b.x, b.y, HALF);
          if (!c) continue;
          const imp = resolve(a, massOf(a), b, massOf(b), c, CRATE_BOUNCE);
          if (imp > 0) {
            // A shoved crate passes the credit on to whatever it hits.
            if (a.lastPusher && !b.lastPusher) b.lastPusher = a.lastPusher;
            else if (b.lastPusher && !a.lastPusher) a.lastPusher = b.lastPusher;
          }
          if (imp > 260) this.clack(a, b, imp);
        }
      }
    }
    for (const u of this.pushers) {
      for (const k of crates) {
        if (k.dropT > 0) continue;
        const c = circleBoxContact(u.x, u.y, PLAYER_R, k.x, k.y, HALF);
        if (!c) continue;
        // Crate speed towards the player (a shoved crate slamming into someone).
        const incoming = -(k.vx * c.nx + k.vy * c.ny);
        const own = u.vx * c.nx + u.vy * c.ny;
        const dashing = u.dashT > 0;
        const slammed = !settle && incoming > 480 && incoming - own > 260 && u.stunT <= 0 && k.lastPusher !== u;
        const imp = resolve(u, u.weight, k, massOf(k), c, dashing ? 0.55 : 0);
        u.touching = k;
        if (own > 40) k.lastPusher = u;
        if (slammed) {
          this.stun(u, 480, -c.nx * 260, -c.ny * 260);
        } else if (!settle && dashing && imp > 320 && k.clackT <= 0) {
          k.clackT = 120;
          audio.play('land', { volume: 0.55 });
          const sy = this.sy(k.y);
          this.fx.vfx('dust', u.x + c.nx * PLAYER_R, this.sy(u.y + c.ny * PLAYER_R), { scale: 0.26, duration: 320, alpha: 0.6, depth: sy + 1 });
        }
      }
    }
    if (settle) return;
    for (let i = 0; i < this.pushers.length; i++) {
      for (let j = i + 1; j < this.pushers.length; j++) {
        const a = this.pushers[i];
        const b = this.pushers[j];
        const c = circleContact(a.x, a.y, PLAYER_R, b.x, b.y, PLAYER_R);
        if (!c) continue;
        const aDash = a.dashT > 0;
        const bDash = b.dashT > 0;
        const imp = resolve(a, a.weight, b, b.weight, c, 0.2);
        // Dashing into a rival bumps them aside.
        if (imp > 380 && aDash && !bDash && b.stunT <= 0) this.stun(b, 260, c.nx * 420, c.ny * 420);
        else if (imp > 380 && bDash && !aDash && a.stunT <= 0) this.stun(a, 260, -c.nx * 420, -c.ny * 420);
      }
    }
  }

  private clack(a: Crate, b: Crate, imp: number): void {
    if (a.clackT > 0 && b.clackT > 0) return;
    a.clackT = b.clackT = 110;
    audio.play('land', { volume: Math.min(0.7, 0.25 + imp / 1800), rate: 1.3 + Math.random() * 0.2, throttleMs: 50 });
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const sy = this.sy(y);
    this.fx.vfx('impact', x, sy - 40, { scale: Math.min(0.4, 0.15 + imp / 4000), duration: 220, blend: 'add' });
  }

  private thud(k: Crate, hit: number): void {
    if (k.clackT > 0) return;
    k.clackT = 120;
    audio.play('land', { volume: Math.min(0.7, 0.25 + hit / 1800), throttleMs: 50 });
    const sy = this.sy(k.y);
    this.fx.vfx('dust', k.x, sy + HALF * DEPTH_K, { scale: 0.26, duration: 360, alpha: 0.6, depth: sy + 1 });
  }

  // --- Zones ---------------------------------------------------------------------------------------
  private updateZones(): void {
    for (const k of this.crates) {
      let z = -1;
      if (k.dropT <= 0) {
        const cur = k.zone >= 0 ? this.zoneRects[k.zone] : null;
        // Slack before a banked crate counts as out, so it can't flicker on the line.
        z = cur && boxInside(k.x, k.y, HALF, cur, ZONE_TOL + ZONE_KEEP) ? k.zone : zoneIndex(k.x, k.y, HALF, this.zoneRects, ZONE_TOL);
      }
      if (z !== k.zone) {
        const prev = k.zone;
        k.zone = z;
        this.onZoneChange(k, prev, z);
      }
    }
    const totals = zoneTotals(this.crates, 4);
    for (const p of this.players) {
      const v = totals[p.slot] ?? 0;
      if (p.score === v) continue;
      p.score = v;
      const zone = this.zones[p.slot];
      if (zone) {
        zone.count.setText(String(v));
        this.tweens.killTweensOf(zone.sign);
        zone.sign.setScale(1);
        this.tweens.add({ targets: zone.sign, scale: { from: 1.22, to: 1 }, duration: 260, ease: 'Back.Out' });
      }
    }
  }

  private onZoneChange(k: Crate, prev: number, z: number): void {
    const sx = k.x;
    const sy = this.sy(k.y);
    if (z >= 0) {
      const color = PLAYER_COLORS[z];
      k.aura.setTintFill(color).setVisible(true);
      k.glow.setTint(color).setVisible(true);
      this.fx.floatText(sx, sy - 150, `+${k.points}`, PLAYER_COLORS_CSS[z], { size: k.gold ? 72 : 58, rise: 70, duration: 800, stroke: '#06141a' });
      audio.play('chipGain', { rate: k.gold ? 0.8 : 1 + Math.random() * 0.1, volume: 0.8, throttleMs: 40 });
      this.fx.vfx('sparkle', sx, sy - 70, { scale: 0.45, duration: 420, blend: 'add', tint: color });
      if (k.gold) {
        this.fx.sparks(sx, sy - 70, 20);
        this.crowdCheer();
      }
      const owner = this.pushers.find((u) => u.p.slot === z);
      if (owner && !owner.p.isCpu) this.rumble(owner.p, 0.15, 0.3, 70);
      if (owner && owner.stunT <= 0 && owner.windT <= 0 && owner.dashT <= 0 && k.gold) owner.c.play('celebrate');
    } else {
      k.aura.setVisible(false).setAlpha(0);
      k.glow.setVisible(false).setAlpha(0);
    }
    if (prev >= 0 && prev !== z) {
      this.fx.floatText(sx, sy - 150, `-${k.points}`, '#ff8a7a', { size: 50, rise: 60, duration: 750, stroke: '#3a0e0a' });
      audio.play('chipLose', { volume: 0.4, throttleMs: 60 });
    }
  }

  // --- Visuals -------------------------------------------------------------------------------------
  private syncVisuals(): void {
    const now = this.time.now;
    for (const u of this.pushers) {
      const sy = this.sy(u.y);
      u.c.setPosition(u.x, sy).setDepth(sy);
      if (u.stunT > 0) continue;
      if (Math.abs(u.fx) > 0.2) u.c.face(u.fx < 0);
      if (u.windT > 0 || u.dashT > 0) continue;
      const cur = u.c.current;
      if (cur !== 'idle' && cur !== 'run' && cur !== 'walk') continue;
      const moving = Math.hypot(u.vx, u.vy) > 60;
      const want = !moving ? 'idle' : u.touching ? 'walk' : 'run';
      if (cur !== want) u.c.play(want);
    }
    for (const k of this.crates) {
      this.placeCrate(k);
      if (k.zone >= 0) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 260 + k.id);
        k.aura.setAlpha(0.14 + 0.14 * pulse);
        k.glow.setAlpha(0.45 + 0.3 * pulse);
      }
      if (k.twinkle) {
        // A glint that wanders over the golden crate's lid.
        const ph = (now / 900 + k.id * 0.37) % 1;
        const sy = this.sy(k.y) - k.z;
        k.twinkle
          .setPosition(k.x - 30 + ((k.id * 37) % 60), sy - 95 + ((k.id * 23) % 40))
          .setScale(0.6 + 1.4 * Math.sin(ph * Math.PI))
          .setAlpha(0.9 * Math.sin(ph * Math.PI));
      }
    }
  }

  protected override ambient(): void {
    if (this.phase !== 'playing') this.syncVisuals();
  }

  protected override end(): void {
    if (this.finished) return;
    this.finished = true;
    const best = Math.max(0, ...this.players.map((p) => p.score));
    for (const u of this.pushers) {
      u.tele.clear();
      u.windT = 0;
      u.dashT = 0;
      if (best > 0 && u.p.score === best) {
        u.c.play('victory', { force: true });
        const zone = this.zones[u.p.slot];
        if (zone) this.fx.confetti(zone.screen.x + zone.screen.w / 2, zone.screen.y + zone.screen.h / 2, 50);
      } else u.c.play('disappointed', { force: true });
    }
    super.end();
  }

  // --- CPU -----------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const u = this.pushers.find((x) => x.p === p);
    if (!u) return;
    const sk = this.skill(p);
    const b = u.brain;
    if (u.stunT > 0) {
      vc.setMove(0, 0);
      return;
    }
    b.think -= dt;
    b.wanderT -= dt;
    b.avoidT -= dt;
    if (b.think <= 0) {
      b.think = sk.think * (0.75 + Math.random() * 0.5);
      this.cpuPlan(u);
    }
    // Step out from under a supply drop (if it was noticed in time).
    for (const k of this.crates) {
      if (k.dropT <= 0 || k.dropT > 850 || !circleBoxContact(u.x, u.y, PLAYER_R + 26, k.x, k.y, HALF)) continue;
      let seen = b.dodge.get(k.id);
      if (seen === undefined) {
        seen = Math.random() < 0.35 + sk.accuracy * 0.6;
        b.dodge.set(k.id, seen);
      }
      if (!seen || k.dropT > 850 - sk.reaction) continue;
      const dx = u.x - k.x || 1;
      const dy = u.y - k.y;
      vc.setMove(dx, dy);
      b.moving = true;
      return;
    }
    // Opportunistic shove at a rival in reach.
    if (b.bully && u.shoveCd <= 0 && u.windT <= 0 && u.dashT <= 0) {
      const r = b.bully;
      b.bully = null;
      const dx = r.x - u.x;
      const dy = r.y - u.y;
      if (Math.hypot(dx, dy) < PLAYER_R * 2 + 90) {
        vc.setMove(dx, dy);
        vc.tap('A');
        return;
      }
    }
    let tx = u.x;
    let ty = u.y;
    let pushing = false;
    let sp: { x: number; y: number; dx: number; dy: number } | null = null;
    const k = b.crate;
    if (b.mode === 'wander') {
      tx = b.wx;
      ty = b.wy;
      if (b.wanderT <= 0) b.mode = 'work';
    } else if (k && b.goal) {
      sp = this.cpuPushSpot(k, b.goal);
      const ox = u.x - k.x;
      const oy = u.y - k.y;
      const along = ox * sp.dx + oy * sp.dy;
      const lateral = Math.abs(-ox * sp.dy + oy * sp.dx);
      if (along < -HALF * 0.5 && lateral < HALF * 0.8) {
        // Behind the crate and lined up: walk through it towards the goal, correcting sideways.
        pushing = true;
        tx = u.x + sp.dx * 100 + (sp.x - u.x) * 1.5;
        ty = u.y + sp.dy * 100 + (sp.y - u.y) * 1.5;
        const toGoal = Math.hypot(b.goal.x - k.x, b.goal.y - k.y);
        if (b.shoveWish && u.shoveCd <= 0 && lateral < HALF * 0.35 && toGoal > 260 && u.touching === k) {
          b.shoveWish = false;
          vc.setMove(sp.dx, sp.dy);
          vc.tap('A');
          return;
        }
      } else {
        const near = Math.hypot(ox, oy) < CRATE * 1.5;
        const wp = along > -HALF * 0.5 && near ? detourPoint(u.x, u.y, k.x, k.y, sp.dx, sp.dy, HALF + PLAYER_R + 34) : sp;
        tx = wp.x;
        ty = wp.y;
      }
    } else if (b.mode === 'guard') {
      // Nothing worth fetching: stand at the mouth of the zone and shove intruders.
      const zone = this.zones[p.slot];
      if (zone) {
        const right = p.slot % 2 === 1;
        const bottom = p.slot >= 2;
        tx = right ? zone.rect.x : zone.rect.x + zone.rect.w;
        ty = bottom ? zone.rect.y : zone.rect.y + zone.rect.h;
      }
    }
    let mx = tx - u.x;
    let my = ty - u.y;
    const md = Math.hypot(mx, my);
    if (md < 14) {
      vc.setMove(0, 0);
      b.moving = false;
      return;
    }
    mx /= md;
    my /= md;
    if (!pushing) {
      // Steer around crates that aren't the target (so it doesn't bulldoze its own zone).
      let ax = 0;
      let ay = 0;
      for (const o of this.crates) {
        if (o === k || o.dropT > 0) continue;
        const dx = u.x - o.x;
        const dy = u.y - o.y;
        const d = Math.hypot(dx, dy);
        const reach = HALF + PLAYER_R + 50;
        if (d < reach && d > 1 && (o.x - u.x) * mx + (o.y - u.y) * my > 0) {
          const w = (1 - d / reach) * 1.6;
          ax += (dx / d) * w;
          ay += (dy / d) * w;
        }
      }
      mx += ax;
      my += ay;
      if (b.dashWish && u.dashCd <= 0 && md > 420) {
        b.dashWish = false;
        vc.setMove(mx, my);
        vc.tap('X');
        b.moving = true;
        return;
      }
    }
    const n = Math.hypot(mx, my) || 1;
    const c = Math.cos(b.noise);
    const s = Math.sin(b.noise);
    vc.setMove((mx * c - my * s) / n, (mx * s + my * c) / n);
    b.moving = true;
  }

  /** Push spot for a crate towards a goal; falls back to axis-aligned pushes when the fence is in the way. */
  private cpuPushSpot(k: Crate, goal: { x: number; y: number }): { x: number; y: number; dx: number; dy: number } {
    const stand = HALF + PLAYER_R + 6;
    const inside = (q: { x: number; y: number }) => q.x > WORLD.x + PLAYER_R && q.x < WORLD.x + WORLD.w - PLAYER_R && q.y > WORLD.y + PLAYER_R && q.y < WORLD.y + WORLD.h - PLAYER_R;
    const sp = pushSpot(k.x, k.y, goal.x, goal.y, stand);
    if (inside(sp)) return sp;
    const ax = pushSpot(k.x, k.y, goal.x, k.y, stand);
    if (Math.abs(goal.x - k.x) > 8 && inside(ax)) return ax;
    const ay = pushSpot(k.x, k.y, k.x, goal.y, stand);
    if (Math.abs(goal.y - k.y) > 8 && inside(ay)) return ay;
    return sp;
  }

  /** Free slot in a zone for a crate (deeper slots preferred, then nearer ones). */
  private pickSlot(zone: Zone, k: Crate): { x: number; y: number } {
    let best = zone.slots[0];
    let bestScore = Infinity;
    zone.slots.forEach((s, i) => {
      const taken = this.crates.some((o) => o !== k && o.dropT <= 0 && Math.abs(o.x - s.x) < HALF * 0.9 && Math.abs(o.y - s.y) < HALF * 0.9);
      if (taken) return;
      const score = Math.hypot(s.x - k.x, s.y - k.y) + i * 70;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    });
    return best;
  }

  private cpuPlan(u: Pusher): void {
    const sk = this.skill(u.p);
    const b = u.brain;
    const slot = u.p.slot;
    const zone = this.zones[slot];
    // Stuck? (trying to move but not getting anywhere) — wander briefly.
    const moved = Math.hypot(u.x - b.lastX, u.y - b.lastY);
    b.lastX = u.x;
    b.lastY = u.y;
    if (b.mode !== 'wander' && b.moving && moved < 10) {
      b.stuck++;
      if (b.stuck >= 3) {
        b.stuck = 0;
        b.mode = 'wander';
        b.wanderT = 500 + Math.random() * 500;
        const a = Math.random() * Math.PI * 2;
        b.wx = Math.max(WORLD.x + 60, Math.min(WORLD.x + WORLD.w - 60, u.x + Math.cos(a) * 200));
        b.wy = Math.max(60, Math.min(WORLD.h - 60, u.y + Math.sin(a) * 200));
        b.avoid = b.crate;
        b.avoidT = 2500;
        b.crate = null;
        return;
      }
    } else b.stuck = 0;
    if (b.mode === 'wander') return;
    b.noise = (Math.random() - 0.5) * sk.aimNoise * 0.5;
    const totals = zoneTotals(this.crates, 4);
    const lead = Math.max(...this.players.map((pl) => totals[pl.slot] ?? 0));
    // Rival within reach in front: maybe shove them.
    const aggression = sk.accuracy * 0.35;
    for (const r of this.pushers) {
      if (r === u || r.stunT > 0) continue;
      const dx = r.x - u.x;
      const dy = r.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > PLAYER_R * 2 + 70 || d < 1) continue;
      const busy = r.touching !== null || (zone && boxInside(r.x, r.y, 0, zone.rect, 40));
      if (Math.random() < aggression * (busy ? 1.6 : 0.6) * (totals[r.p.slot] >= lead ? 1.3 : 1)) {
        b.bully = r;
        break;
      }
    }
    if (!zone) return;
    // Current job done?
    const k0 = b.crate;
    if (k0) {
      if (!this.crates.includes(k0) || k0.dropT > 0) b.crate = null;
      else if (k0.zone === slot) {
        const g = b.goal;
        const settled = !g || Math.hypot(k0.x - g.x, k0.y - g.y) < 40 || b.blockedT > 700;
        if (settled) b.crate = null;
      }
    }
    // Progress watch on the crate being pushed: jiggling against a jam doesn't count, only real
    // gains; with none for a while, leave it (a rival may be pushing back, or the zone is blocked).
    if (b.crate && b.goal) {
      const d = Math.hypot(b.crate.x - b.goal.x, b.crate.y - b.goal.y);
      if (d < b.bestD - 20) {
        b.bestD = d;
        b.progressAt = this.elapsed;
        b.blockedT = 0;
      } else b.blockedT += sk.think;
      if (this.elapsed - b.progressAt > 2600 && b.crate.zone !== slot) {
        b.avoid = b.crate;
        b.avoidT = 3500;
        b.crate = null;
      }
    }
    // Choose the most valuable reachable crate not already banked with us, by points per second of
    // work: walking to its far side plus pushing it home at the speed its mass allows.
    let best: Crate | null = null;
    let bestScore = -Infinity;
    const stealWill = 0.3 + sk.accuracy * 0.35;
    for (const k of this.crates) {
      if (k.dropT > 0 || k.zone === slot) continue;
      if (b.avoid === k && b.avoidT > 0) continue;
      let value = k.points * (k.gold ? b.greed : 1);
      if (k.zone >= 0) {
        // Stealing: tempting when the victim leads, but it is slow work in a crowded corner.
        const theirs = totals[k.zone] ?? 0;
        value *= stealWill * (theirs >= (totals[slot] ?? 0) ? 1.3 : 0.7);
      }
      const goal = this.pickSlot(zone, k);
      const sp = this.cpuPushSpot(k, goal);
      if (!this.standable(sp.x, sp.y, k)) continue;
      const behind = (u.x - k.x) * sp.dx + (u.y - k.y) * sp.dy < 0;
      const myD = Math.hypot(u.x - k.x, u.y - k.y);
      let time = Math.hypot(u.x - sp.x, u.y - sp.y) / WALK + (behind ? 0 : 0.5) + Math.hypot(goal.x - k.x, goal.y - k.y) / pushSpeed(k.mass);
      for (const o of this.crates) {
        if (o === k || o.dropT > 0 || o.zone === slot) continue;
        if (segmentDistance(o.x, o.y, k.x, k.y, goal.x, goal.y) < HALF * 1.7) time += 1.1;
      }
      // Rivals already closer to it make it a scrum: prefer something else.
      for (const r of this.pushers) if (r !== u && Math.hypot(r.x - k.x, r.y - k.y) < Math.min(180, myD)) time += 1.4;
      let score = value / (0.8 + time);
      if (k === k0) score *= 1.35;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best && Math.random() < sk.mistake) {
      const pool = this.crates.filter((k) => k.dropT <= 0 && k.zone !== slot);
      if (pool.length) best = pool[Math.floor(Math.random() * pool.length)];
    }
    if (best !== b.crate) {
      b.crate = best;
      b.bestD = Infinity;
      b.progressAt = this.elapsed;
      b.blockedT = 0;
    }
    b.goal = best ? this.pickSlot(zone, best) : null;
    b.mode = best ? 'work' : 'guard';
    b.shoveWish = !!best && Math.random() < sk.accuracy * (best.gold ? 0.7 : 0.45);
    b.dashWish = Math.random() < sk.accuracy * 0.35;
  }

  /** Can a player stand at this spot (inside the fence, not inside another crate)? */
  private standable(x: number, y: number, except: Crate): boolean {
    if (x < WORLD.x + PLAYER_R || x > WORLD.x + WORLD.w - PLAYER_R || y < PLAYER_R || y > WORLD.h - PLAYER_R) return false;
    for (const hp of this.planters) if (x * hp.nx + y * hp.ny - PLAYER_R < hp.d) return false;
    for (const o of this.crates) {
      if (o === except || o.dropT > 0) continue;
      if (circleBoxContact(x, y, PLAYER_R - 6, o.x, o.y, HALF)) return false;
    }
    return true;
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => {
      const n = this.crates.filter((k) => k.zone === p.slot).length;
      return { slot: p.slot, score: p.score, label: `${p.score} pt${p.score === 1 ? '' : 's'} · ${n} crate${n === 1 ? '' : 's'}` };
    });
  }
}

/**
 * Anchor (origin) and display-scale factor of a rendered minigame sprite, from the metadata that
 * scripts/art/mg_arenas.py writes to mg/sprites.json (loaded as 'rendered-mg-sprites').
 */
function artMeta(scene: Phaser.Scene, name: string, fallback: { x: number; y: number }): { x: number; y: number; k: number } {
  const all = scene.cache.json.get('rendered-mg-sprites') as Record<string, { anchor?: [number, number]; scale?: number }> | undefined;
  const m = all?.[name];
  return { x: m?.anchor?.[0] ?? fallback.x, y: m?.anchor?.[1] ?? fallback.y, k: 1 / (m?.scale ?? 1) };
}

/**
 * Steady speed a player pushes a crate of mass m at: the steer's pull (accel × (walk − v)) balances
 * the crate's sliding friction, so v = walk − m × friction / accel.
 */
function pushSpeed(m: number): number {
  return Math.max(80, WALK - (m * FRICTION) / 12);
}

// --- Drawing helpers --------------------------------------------------------------------------------

/** Dashed rectangle outline. */
function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number, width: number, color: number, alpha: number): void {
  g.lineStyle(width, color, alpha);
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.lineBetween(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e);
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
}

/** Tiny crate glyph for the zone signs. */
function drawCrateIcon(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x06141a, 0.4);
  g.fillRect(x - 12, y - 11, 26, 26);
  g.fillStyle(0xdcb07a, 1);
  g.fillRect(x - 13, y - 13, 26, 10);
  g.fillStyle(0xb07a44, 1);
  g.fillRect(x - 13, y - 3, 26, 14);
  g.lineStyle(2, 0x5a3a1e, 1);
  g.strokeRect(x - 13, y - 13, 26, 24);
  g.lineBetween(x - 13, y - 3, x + 13, y - 3);
  g.lineBetween(x - 11, y + 9, x + 11, y - 1);
}

type Ctx = CanvasRenderingContext2D;

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

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

/** Procedural crate textures (plain and golden festival crate) and their soft floor shadow. */
function makeCrateTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, 'cc-crate', CRATE_TEX.w, CRATE_TEX.h, (ctx) => drawCrate(ctx, false));
  canvasTexture(scene, 'cc-crate-gold', CRATE_TEX.w, CRATE_TEX.h, (ctx) => drawCrate(ctx, true));
  canvasTexture(scene, 'cc-crate-shadow', 170, 130, (ctx) => {
    ctx.filter = 'blur(9px)';
    ctx.fillStyle = 'rgba(10,16,24,0.55)';
    roundRectPath(ctx, 30, 26, 112, 80, 14);
    ctx.fill();
    ctx.filter = 'none';
  });
}

/**
 * A crate seen by the 3/4 yard camera: lid (foreshortened by DEPTH_K) above the front face
 * (HEIGHT_K). Anchor = centre of the footprint at (90, 150) in the 180×190 image.
 */
function drawCrate(ctx: Ctx, gold: boolean): void {
  const ax = 90;
  const ay = 150;
  const w = CRATE;
  const lidD = CRATE * DEPTH_K;
  const faceH = CRATE * HEIGHT_K;
  const x0 = ax - w / 2;
  const x1 = ax + w / 2;
  const lidTop = ay - lidD / 2 - faceH;
  const lidBot = ay + lidD / 2 - faceH;
  const faceBot = ay + lidD / 2;
  const pal = gold
    ? { lid: ['#ffe9a0', '#f4c24c'], face: ['#eab23a', '#c07a14'], groove: '#8a5210', batten: ['#fff1b8', '#c98a1b'], dark: '#6a3e0c', metal: ['#ffffff', '#f4c24c', '#8a5a10'] }
    : { lid: ['#e2b882', '#c89660'], face: ['#bb8651', '#8f5e34'], groove: '#5c3a1e', batten: ['#9a6a40', '#6a4426'], dark: '#3e2614', metal: ['#f2f6f8', '#a2adb3', '#58626a'] };
  // Lid.
  let grd = ctx.createLinearGradient(0, lidTop, 0, lidBot);
  grd.addColorStop(0, pal.lid[0]);
  grd.addColorStop(1, pal.lid[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(x0, lidTop, w, lidD);
  // Lid planks (run left–right) and grain.
  for (let i = 1; i < 3; i++) {
    const y = lidTop + (lidD * i) / 3;
    ctx.fillStyle = pal.groove;
    ctx.fillRect(x0, y - 1.5, w, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x0, y + 1.5, w, 1.5);
  }
  const rnd = new Random(gold ? 91 : 17);
  ctx.strokeStyle = gold ? 'rgba(150,90,10,0.25)' : 'rgba(90,55,25,0.22)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) {
    const y = lidTop + 4 + rnd.next() * (lidD - 8);
    const xs = x0 + rnd.next() * w * 0.6;
    ctx.beginPath();
    ctx.moveTo(xs, y);
    ctx.bezierCurveTo(xs + 12, y - 1.5, xs + 24, y + 1.5, xs + 30 + rnd.next() * 25, y);
    ctx.stroke();
  }
  // Lid frame battens.
  const bw = 9;
  grd = ctx.createLinearGradient(0, lidTop, 0, lidBot);
  grd.addColorStop(0, pal.batten[0]);
  grd.addColorStop(1, pal.batten[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(x0, lidTop, w, bw * DEPTH_K);
  ctx.fillRect(x0, lidBot - bw * DEPTH_K, w, bw * DEPTH_K);
  ctx.fillRect(x0, lidTop, bw, lidD);
  ctx.fillRect(x1 - bw, lidTop, bw, lidD);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x0 + 1, lidTop + 1, w - 2, 1.5);
  // Front face.
  grd = ctx.createLinearGradient(0, lidBot, 0, faceBot);
  grd.addColorStop(0, pal.face[0]);
  grd.addColorStop(1, pal.face[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(x0, lidBot, w, faceH);
  for (let i = 1; i < 3; i++) {
    const y = lidBot + (faceH * i) / 3;
    ctx.fillStyle = pal.groove;
    ctx.fillRect(x0, y - 1.5, w, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x0, y + 1.5, w, 1.2);
  }
  // Diagonal brace between the frame battens.
  const fb = 11;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 + fb, lidBot + fb * 0.8, w - fb * 2, faceH - fb * 1.6);
  ctx.clip();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = pal.dark;
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(x0 + fb - 4, faceBot - fb * 0.8 + 4);
  ctx.lineTo(x1 - fb + 4, lidBot + fb * 0.8 - 4);
  ctx.stroke();
  ctx.strokeStyle = gold ? '#f7cf62' : '#c9965e';
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 + fb - 6, faceBot - fb * 0.8 - 1);
  ctx.lineTo(x1 - fb + 2, lidBot + fb * 0.8 - 8);
  ctx.stroke();
  ctx.restore();
  // Front frame battens.
  grd = ctx.createLinearGradient(0, lidBot, 0, faceBot);
  grd.addColorStop(0, pal.batten[0]);
  grd.addColorStop(1, pal.batten[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(x0, lidBot, w, fb * 0.8);
  ctx.fillRect(x0, faceBot - fb * 0.8, w, fb * 0.8);
  ctx.fillRect(x0, lidBot, fb, faceH);
  ctx.fillRect(x1 - fb, lidBot, fb, faceH);
  // Top-front edge highlight and a soft occlusion line at the bottom.
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(x0, lidBot, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x0, faceBot - 3, w, 3);
  if (gold) {
    // Festival spiral emblem glowing on the front.
    const cx = ax;
    const cy = lidBot + faceH / 2 + 1;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    glow.addColorStop(0, 'rgba(160,245,255,0.95)');
    glow.addColorStop(0.5, 'rgba(92,225,255,0.45)');
    glow.addColorStop(1, 'rgba(92,225,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 28, cy - 28, 56, 56);
    ctx.fillStyle = '#0d4f57';
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5ce1ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.02) {
      const a = t * Math.PI * 4.2;
      const r = 2 + t * 10;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else {
    // Faded stencil: an up arrow (this way up!).
    ctx.fillStyle = 'rgba(40,24,10,0.3)';
    const cx = ax;
    const cy = lidBot + faceH / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 13);
    ctx.lineTo(cx + 10, cy - 2);
    ctx.lineTo(cx + 4, cy - 2);
    ctx.lineTo(cx + 4, cy + 12);
    ctx.lineTo(cx - 4, cy + 12);
    ctx.lineTo(cx - 4, cy - 2);
    ctx.lineTo(cx - 10, cy - 2);
    ctx.closePath();
    ctx.fill();
  }
  // Metal corner brackets with rivets (front corners and lid corners).
  const bracket = (x: number, y: number, sx: number, sy: number, len: number, thick: number) => {
    const g2 = ctx.createLinearGradient(x, y, x + sx * len, y + sy * len);
    g2.addColorStop(0, pal.metal[0]);
    g2.addColorStop(0.5, pal.metal[1]);
    g2.addColorStop(1, pal.metal[2]);
    ctx.fillStyle = g2;
    ctx.fillRect(Math.min(x, x + sx * len), Math.min(y, y + sy * thick), len, thick);
    ctx.fillRect(Math.min(x, x + sx * thick), Math.min(y, y + sy * len), thick, len);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.min(x, x + sx * len), y + sy * thick - (sy > 0 ? 1 : 0), len, 1);
    ctx.fillStyle = pal.metal[2];
    for (const [dx, dy] of [
      [thick / 2, thick / 2],
      [len - 4, thick / 2],
      [thick / 2, len - 4],
    ]) {
      ctx.beginPath();
      ctx.arc(x + sx * dx, y + sy * dy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  bracket(x0, lidBot, 1, 1, 22, 8);
  bracket(x1, lidBot, -1, 1, 22, 8);
  bracket(x0, faceBot, 1, -1, 22, 8);
  bracket(x1, faceBot, -1, -1, 22, 8);
  bracket(x0, lidTop, 1, 1, 16, 6);
  bracket(x1, lidTop, -1, 1, 16, 6);
  // Crisp outline for readability over the busy floor.
  ctx.strokeStyle = gold ? 'rgba(90,50,5,0.85)' : 'rgba(40,24,12,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, lidTop + 1, w - 2, faceBot - lidTop - 2);
}

/** Value noise in [0, 1] from a hashed lattice (for the ground textures). */
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

/** Fallback yard art: a supply yard on a floating island, and the back fence as a separate strip. */
function makeYardTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, 'cc-yard-bg', GAME_WIDTH, 1080, drawYard);
  canvasTexture(scene, 'cc-yard-fence', GAME_WIDTH, FENCE_STRIP.h, (ctx) => {
    ctx.translate(0, -FENCE_STRIP.y);
    drawFenceRun(ctx, FLOOR.x - 8, FLOOR.y, FLOOR.x + FLOOR.w + 8, FLOOR.y, 46, 12, 2);
  });
  canvasTexture(scene, 'cc-yard-front', GAME_WIDTH, FRONT_STRIP.h, (ctx) => {
    ctx.translate(0, -FRONT_STRIP.y);
    drawFenceRun(ctx, FLOOR.x - 6, FLOOR.y + FLOOR.h, FLOOR.x + FLOOR.w + 6, FLOOR.y + FLOOR.h, 16, 12, 1);
  });
}

/** Posts with brass caps and rails, in screen space; `h` is the post height in px. */
function drawFenceRun(ctx: Ctx, ax: number, ay: number, bx: number, by: number, h: number, n: number, rails: number): void {
  const vertical = Math.abs(bx - ax) < 1;
  const railY = rails === 2 ? [0.32, 0.78] : [0.66];
  // Rails first (behind the posts).
  for (const t of railY) {
    const off = h * t;
    if (vertical) {
      const g = ctx.createLinearGradient(ax - 5, 0, ax + 5, 0);
      g.addColorStop(0, '#c08a58');
      g.addColorStop(1, '#7a5234');
      ctx.fillStyle = g;
      ctx.fillRect(ax - 4, ay - off, 8, by - ay);
    } else {
      ctx.fillStyle = '#6a4426';
      ctx.fillRect(ax, ay - off - 1, bx - ax, 9);
      const g = ctx.createLinearGradient(0, ay - off - 4, 0, ay - off + 5);
      g.addColorStop(0, '#d49a64');
      g.addColorStop(1, '#9a6a40');
      ctx.fillStyle = g;
      ctx.fillRect(ax, ay - off - 4, bx - ax, 7);
    }
  }
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const pw = vertical ? 12 : 14;
    // Contact shadow, post body with a lit left side, top face and brass cap.
    ctx.fillStyle = 'rgba(10,16,24,0.28)';
    ctx.beginPath();
    ctx.ellipse(x + 6, y + 2, pw * 0.9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0);
    g.addColorStop(0, '#a8744a');
    g.addColorStop(0.45, '#8a5c38');
    g.addColorStop(1, '#5e3c22');
    ctx.fillStyle = g;
    ctx.fillRect(x - pw / 2, y - h, pw, h);
    ctx.fillStyle = '#b8845a';
    ctx.fillRect(x - pw / 2, y - h - 5, pw, 5);
    const cap = ctx.createRadialGradient(x - 2, y - h - 9, 1, x, y - h - 7, 7);
    cap.addColorStop(0, '#fff2b0');
    cap.addColorStop(0.5, '#e0a93f');
    cap.addColorStop(1, '#9a6a1a');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(x, y - h - 7, 6.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawYard(ctx: Ctx): void {
  const rnd = new Random(20260927);
  const W = GAME_WIDTH;
  const H = 1080;
  // Island outline (a gently wobbly ellipse), its rocky underside, then the grass top.
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const wob = 1 + 0.035 * Math.sin(a * 5 + 1.3) + 0.025 * Math.sin(a * 9 + 0.4);
    pts.push({ x: 960 + Math.cos(a) * 1010 * wob, y: 650 + Math.sin(a) * 480 * wob });
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
  g = ctx.createLinearGradient(0, 160, 0, H);
  g.addColorStop(0, '#98cf6c');
  g.addColorStop(0.45, '#7dbb58');
  g.addColorStop(1, '#5f9d40');
  ctx.fillStyle = g;
  outline();
  ctx.fill();
  ctx.save();
  outline();
  ctx.clip();
  // Grass texture: tufts and a few flowers.
  for (let i = 0; i < 2600; i++) {
    const x = rnd.next() * W;
    const y = 150 + rnd.next() * (H - 150);
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
    ctx.arc(rnd.next() * W, 170 + rnd.next() * (H - 170), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(210,245,170,0.7)';
  ctx.lineWidth = 5;
  outline();
  ctx.stroke();

  // Trees, stalls and supplies around the yard (behind the back fence and in the side strips).
  for (const [x, y, s] of [
    [70, 330, 1.1],
    [1850, 330, 1.1],
    [60, 985, 1.0],
    [1860, 985, 1.0],
    [236, 205, 0.8],
    [1690, 205, 0.8],
  ] as const) {
    drawTree(ctx, x, y, s, rnd);
  }
  for (const [x, y] of [
    [420, 236],
    [960, 236],
    [1500, 236],
  ] as const) {
    drawLanternPost(ctx, x, y);
  }
  drawBunting(ctx, 420, 1500, 150, 26, rnd);
  drawBunting(ctx, 960 - 540, 960 + 540, 172, 34, rnd, true);
  for (const [x, y] of [
    [330, 262],
    [600, 250],
    [1320, 250],
    [1590, 262],
  ] as const) {
    drawSupplyPile(ctx, x, y, rnd, 5);
  }
  for (const [x, y] of [
    [860, 262],
    [1060, 262],
  ] as const) {
    drawHayBale(ctx, x, y);
  }
  drawStall(ctx, 110, 560, '#ff6b5e');
  drawStall(ctx, 1810, 560, '#8e5cd9');
  for (const [x, y] of [
    [150, 470],
    [1770, 470],
    [150, 830],
    [1770, 830],
  ] as const) {
    drawSupplyPile(ctx, x, y, rnd, 3);
  }
  drawHayBale(ctx, 190, 680);
  drawHayBale(ctx, 1730, 680);
  for (const [x, y, s] of [
    [300, 1045, 1.1],
    [960, 1058, 1.0],
    [1620, 1045, 1.1],
    [110, 720, 0.9],
    [1810, 720, 0.9],
  ] as const) {
    drawBush(ctx, x, y, s, rnd);
  }

  // Raised yard slab: stone front face, then the floor.
  const fx = FLOOR.x;
  const fy = FLOOR.y;
  const fw = FLOOR.w;
  const fh = FLOOR.h;
  ctx.fillStyle = 'rgba(10,20,20,0.3)';
  ctx.fillRect(fx - 6, fy + fh, fw + 24, 46);
  for (let x = fx - 8, i = 0; x < fx + fw + 8; i++) {
    const bw = 62 + ((i * 37) % 30);
    const e = Math.min(bw, fx + fw + 8 - x);
    const sg = ctx.createLinearGradient(0, fy + fh, 0, fy + fh + 38);
    sg.addColorStop(0, '#d8cbb8');
    sg.addColorStop(1, '#a8987e');
    ctx.fillStyle = sg;
    roundRectPath(ctx, x + 1, fy + fh + 1, e - 2, 36, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 4, fy + fh + 3, e - 8, 2);
    x += bw;
  }
  // Floor: packed earth with value-noise mottling.
  const img = ctx.createImageData(fw, fh);
  const n1 = makeNoise(3);
  const n2 = makeNoise(11);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const v = 0.82 + 0.26 * n1(x / 90, y / (90 * DEPTH_K)) + 0.1 * (n2(x / 9, y / 7) - 0.5);
      const i = (y * fw + x) * 4;
      img.data[i] = Math.min(255, 182 * v);
      img.data[i + 1] = Math.min(255, 142 * v);
      img.data[i + 2] = Math.min(255, 100 * v);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, fx, fy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  ctx.clip();
  // Cart ruts.
  for (const [ya, yb] of [
    [0.3, 0.36],
    [0.66, 0.71],
  ]) {
    for (const [yy, ph] of [
      [ya, 0],
      [yb, 1],
    ]) {
      ctx.strokeStyle = 'rgba(120,86,56,0.55)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      for (let x = 0; x <= fw; x += 12) {
        const y = fy + fh * yy + Math.sin(x / 140 + ph) * 9;
        if (x === 0) ctx.moveTo(fx + x, y);
        else ctx.lineTo(fx + x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214,178,130,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  // Flagstone patches.
  const pal = ['#cebea6', '#c0b096', '#d6c6ac', '#b8a892'];
  for (let i = 0; i < 26; i++) {
    const cx = fx + 60 + rnd.next() * (fw - 120);
    const cy = fy + 40 + rnd.next() * (fh - 80);
    for (let k = rnd.int(3, 7); k > 0; k--) {
      const sx = cx + rnd.range(-60, 60);
      const sy = cy + rnd.range(-40, 40) * DEPTH_K;
      const rw = rnd.range(26, 46);
      const rh = rnd.range(20, 34) * DEPTH_K;
      const c = rnd.pick(pal);
      ctx.fillStyle = 'rgba(70,50,30,0.45)';
      roundRectPath(ctx, sx - rw, sy - rh + 3, rw * 2, rh * 2, 7);
      ctx.fill();
      ctx.fillStyle = c;
      roundRectPath(ctx, sx - rw, sy - rh, rw * 2, rh * 2, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRectPath(ctx, sx - rw + 4, sy - rh + 2, rw * 2 - 12, 4, 2);
      ctx.fill();
    }
  }
  // Straw wisps and pebbles.
  for (let i = 0; i < 900; i++) {
    const sx = fx + rnd.next() * fw;
    const sy = fy + rnd.next() * fh;
    const a = rnd.next() * Math.PI * 2;
    const len = rnd.range(6, 16);
    ctx.strokeStyle = rnd.pick(['#e8c878', '#d6b260', '#f0d68c']);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len * DEPTH_K);
    ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    const r = rnd.range(1.5, 3.5);
    ctx.fillStyle = rnd.pick(['#968068', '#c8baa4', '#786450']);
    ctx.beginPath();
    ctx.ellipse(fx + rnd.next() * fw, fy + rnd.next() * fh, r, r * DEPTH_K, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Paved border.
  const bw = 34;
  const bh = bw * DEPTH_K;
  ctx.fillStyle = '#968470';
  ctx.fillRect(fx, fy, fw, bh);
  ctx.fillRect(fx, fy + fh - bh, fw, bh);
  ctx.fillRect(fx, fy, bw, fh);
  ctx.fillRect(fx + fw - bw, fy, bw, fh);
  ctx.fillStyle = '#c6b8a0';
  for (let k = 0; k < fw; k += 44) {
    roundRectPath(ctx, fx + k + 2, fy + 2, 40, bh - 4, 4);
    ctx.fill();
    roundRectPath(ctx, fx + k + 2, fy + fh - bh + 2, 40, bh - 4, 4);
    ctx.fill();
  }
  const step = 40 * DEPTH_K;
  for (let k = 0; k < fh; k += step) {
    roundRectPath(ctx, fx + 2, fy + k + 2, bw - 4, step - 4, 4);
    ctx.fill();
    roundRectPath(ctx, fx + fw - bw + 2, fy + k + 2, bw - 4, step - 4, 4);
    ctx.fill();
  }
  // Soft occlusion where the floor meets the back and side fences.
  g = ctx.createLinearGradient(0, fy, 0, fy + 46);
  g.addColorStop(0, 'rgba(30,18,8,0.45)');
  g.addColorStop(1, 'rgba(30,18,8,0)');
  ctx.fillStyle = g;
  ctx.fillRect(fx, fy, fw, 46);
  for (const [x0, x1] of [
    [fx, fx + 30],
    [fx + fw, fx + fw - 30],
  ]) {
    g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(30,18,8,0.35)');
    g.addColorStop(1, 'rgba(30,18,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), fy, 30, fh);
  }
  ctx.restore();
  // Low side fences (the back and front fences are overlay layers).
  drawFenceRun(ctx, fx - 6, fy, fx - 6, fy + fh, 26, 7, 1);
  drawFenceRun(ctx, fx + fw + 6, fy, fx + fw + 6, fy + fh, 26, 7, 1);
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
  const blobs: [number, number, number][] = [
    [0, -130, 62],
    [-50, -100, 46],
    [50, -98, 48],
    [-20, -160, 44],
    [28, -150, 40],
  ];
  for (const [dx, dy, r] of blobs) {
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

function drawBunting(ctx: Ctx, x0: number, x1: number, y: number, sag: number, rnd: Random, alt = false): void {
  const colors = ['#ff6b5e', '#f4b83b', '#1fa5a0', '#8e5cd9', '#5ce1ff', '#6cc24a'];
  const at = (t: number) => ({ x: x0 + (x1 - x0) * t, y: y + Math.sin(t * Math.PI) * sag });
  ctx.strokeStyle = '#5a3a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const p = at(i / 40);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  const n = Math.round((x1 - x0) / 38);
  for (let i = 0; i < n; i++) {
    const p = at((i + 0.5) / n);
    ctx.fillStyle = colors[(i + (alt ? 3 : 0)) % colors.length];
    ctx.beginPath();
    ctx.moveTo(p.x - 11, p.y);
    ctx.lineTo(p.x + 11, p.y);
    ctx.lineTo(p.x + rnd.range(-2, 2), p.y + 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(p.x - 11, p.y);
    ctx.lineTo(p.x - 2, p.y);
    ctx.lineTo(p.x - 1, p.y + 16);
    ctx.closePath();
    ctx.fill();
  }
}

/** A small stack of crates, barrels and sacks (screen px, feet at y). */
function drawSupplyPile(ctx: Ctx, x: number, y: number, rnd: Random, n: number): void {
  const items: { dx: number; dy: number; kind: number }[] = [];
  for (let k = 0; k < n; k++) items.push({ dx: rnd.range(-70, 70), dy: rnd.range(-16, 16), kind: rnd.next() });
  items.sort((a, b) => a.dy - b.dy);
  for (const it of items) {
    const ix = x + it.dx;
    const iy = y + it.dy;
    ctx.fillStyle = 'rgba(10,20,10,0.3)';
    ctx.beginPath();
    ctx.ellipse(ix + 10, iy + 2, 38, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    if (it.kind < 0.45) {
      const s = rnd.range(46, 60);
      ctx.fillStyle = '#d6aa74';
      ctx.fillRect(ix - s / 2, iy - s * 0.66 - s * 0.35, s, s * 0.36);
      ctx.fillStyle = '#a8744a';
      ctx.fillRect(ix - s / 2, iy - s * 0.66, s, s * 0.66);
      ctx.strokeStyle = '#5a3a1e';
      ctx.lineWidth = 2;
      ctx.strokeRect(ix - s / 2, iy - s * 0.66 - s * 0.35, s, s * 1.01);
      ctx.beginPath();
      ctx.moveTo(ix - s / 2 + 4, iy - 4);
      ctx.lineTo(ix + s / 2 - 4, iy - s * 0.62);
      ctx.stroke();
    } else if (it.kind < 0.75) {
      const bg = ctx.createLinearGradient(ix - 20, 0, ix + 20, 0);
      bg.addColorStop(0, '#b07a48');
      bg.addColorStop(0.5, '#9a6a40');
      bg.addColorStop(1, '#6e4a2c');
      ctx.fillStyle = bg;
      roundRectPath(ctx, ix - 20, iy - 56, 40, 56, 10);
      ctx.fill();
      ctx.fillStyle = '#c9a36a';
      ctx.beginPath();
      ctx.ellipse(ix, iy - 56, 20, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5c666c';
      ctx.fillRect(ix - 20, iy - 44, 40, 4);
      ctx.fillRect(ix - 20, iy - 16, 40, 4);
    } else {
      const sg = ctx.createRadialGradient(ix - 8, iy - 30, 3, ix, iy - 20, 28);
      sg.addColorStop(0, '#f0e2c0');
      sg.addColorStop(1, '#bca47c');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(ix, iy - 20, 26, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a7250';
      ctx.fillRect(ix - 6, iy - 44, 12, 6);
    }
  }
}

function drawHayBale(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = 'rgba(10,20,10,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 12, y + 2, 52, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0d27a';
  ctx.fillRect(x - 46, y - 64, 92, 26);
  const g = ctx.createLinearGradient(0, y - 40, 0, y);
  g.addColorStop(0, '#e2bc5c');
  g.addColorStop(1, '#b8923a');
  ctx.fillStyle = g;
  ctx.fillRect(x - 46, y - 40, 92, 40);
  ctx.strokeStyle = 'rgba(120,90,30,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 44 + i * 8, y - 38);
    ctx.lineTo(x - 40 + i * 8, y - 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#8a5c38';
  ctx.fillRect(x - 24, y - 64, 5, 64);
  ctx.fillRect(x + 19, y - 64, 5, 64);
}

function drawStall(ctx: Ctx, x: number, y: number, stripe: string): void {
  ctx.fillStyle = 'rgba(10,20,10,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 14, y + 4, 90, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a5c38';
  ctx.fillRect(x - 70, y - 120, 8, 120);
  ctx.fillRect(x + 62, y - 120, 8, 120);
  const g = ctx.createLinearGradient(0, y - 56, 0, y);
  g.addColorStop(0, '#c08a58');
  g.addColorStop(1, '#8a5c38');
  ctx.fillStyle = g;
  ctx.fillRect(x - 74, y - 56, 148, 56);
  ctx.fillStyle = '#e8c89a';
  ctx.fillRect(x - 78, y - 62, 156, 10);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#fff4dc' : stripe;
    ctx.beginPath();
    ctx.moveTo(x - 84 + i * 28, y - 150);
    ctx.lineTo(x - 84 + (i + 1) * 28, y - 150);
    ctx.lineTo(x - 84 + (i + 1) * 28, y - 118);
    ctx.quadraticCurveTo(x - 84 + i * 28 + 14, y - 104, x - 84 + i * 28, y - 118);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x - 84, y - 124, 168, 4);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = ['#ff6b5e', '#ffe08a', '#6cc24a', '#f4b83b', '#c49bff'][i];
    ctx.beginPath();
    ctx.arc(x - 50 + i * 25, y - 68, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

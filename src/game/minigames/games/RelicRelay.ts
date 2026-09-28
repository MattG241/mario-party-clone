import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS, PLAYER_SHAPES } from '../../constants';
import { CHARACTERS, type CharacterId } from '../../data/characters';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import type { VirtualControls } from '../../input/PlayerInput';
import { glyphKindFor, makeGlyph } from '../../ui/ControllerPrompt';
import { drawPlayerShape } from '../../ui/PlayerBadge';
import { addText } from '../../ui/theme';
import { standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { HERO_DATA } from '../../data/heroSprites.generated';
import {
  BODY_DEPTH,
  BODY_HALF,
  buildCourse,
  DEPTH_K,
  FINISH_REST_X,
  GOAL_X,
  HEDGE_Y,
  LANE_HALF,
  LANE_Y,
  LANES_FOR,
  MACE_ACROSS,
  MACE_ALONG,
  MACE_AMP,
  MACE_BALL_R,
  MACE_PIVOT_H,
  MACE_ROPE,
  MACE_STRIP,
  maceBall,
  maceHits,
  ordinal,
  raceScore,
  SPRING_DIST,
  SPRING_HALF,
  START_X,
  strideClear,
  type CourseObstacle,
} from './relicRelayLogic';

// Layout constants (lane centrelines, start/goal x) and hazard geometry live in relicRelayLogic.ts.

// --- Art contract ------------------------------------------------------------------------------
/**
 * Optional pre-rendered art (scripts/art/mg_arenas.py). Sprites are placed by an anchor (normalised
 * origin): `meta` names their entry in 'rendered-mg-sprites' (mg/sprites.json), whose anchor/scale
 * win when loaded; ox/oy are the defaults. `size` shrinks a render to the gameplay size used here.
 */
const ART = {
  /** Full 1920×1080 course at (0, 0): lanes, hedges, start + goal markers. */
  scene: 'rendered-scene-relay',
  /** Optional overlay drawn above the runners (e.g. the front of an arch). */
  sceneFront: 'rendered-scene-relay_front',
  /** Roll-frame strip (spritesheet); anchor = where the log touches the lane centreline. */
  log: { key: 'rendered-mg-log', meta: 'log', ox: 0.5, oy: 150 / 180, size: 0.72 },
  /** Spiked ball; anchor = centre of the ball (the rope is drawn in code). */
  mace: { key: 'rendered-mg-mace', meta: 'mace', ox: 0.5, oy: 0.667, size: 0.72 },
  /** Spring pad; anchor = centre of its footprint on the ground. */
  spring: { key: 'rendered-mg-spring', meta: 'spring', ox: 0.5, oy: 90 / 130, size: 0.7 },
  /** Relic parcel; anchor = bottom centre (where it rests on the ground). */
  parcel: { key: 'rendered-mg-parcel', meta: 'parcel', ox: 0.5, oy: 95 / 110, size: 0.7 },
} as const;
type ArtSpec = { key: string; meta: string; ox: number; oy: number; size: number };
const SKY_KEY = 'rendered-sky-day';
const TEX_COURSE = 'relay-course';
const TEX_PARCEL = 'relay-parcel';
const TEX_MACE = 'relay-mace';
/** Fallback spring: the spring-pad frame of the shared props sheet (anchor at the footprint). */
const SPRING_FRAME = '21';
const SPRING_ORIGIN = { x: 0.532, y: 0.69 };

/** Race progress bar along the bottom edge (screen px). */
const TRACK_BAR = { x0: 560, x1: 1360, y: 1026 };

// --- Runners -----------------------------------------------------------------------------------
const CHAR_SCALE = 0.55;
const RUN_SPEED = 120;
const RUN_SPEED_EMPTY = 170;
const ACCEL = 9;
const FRICTION = 11;
const JUMP_V = 880;
const JUMP_V_CARRY = 800;
const GRAVITY = 2600;
const STUN_MS = 720;
const INVULN_MS = 950;
const PICK_RANGE = 72;
const PICK_MS = 340;
const THROW_MS = 280;
const THROW_VX = 460;
const THROW_VZ = 780;
/** Where the parcel sits in the carry pose on the 2D sheets (local px from the feet, facing right); rendered heroes carry their own anchor. */
const CARRY_HOLD: Partial<Record<CharacterId, { x: number; y: number }>> = {
  kip: { x: 72, y: -112 },
  mossi: { x: 58, y: -92 },
  tumble: { x: 66, y: -112 },
  zippa: { x: 76, y: -94 },
};
const PARCEL_SCALE = 0.62;
/** Half the parcel's height on screen (its anchor is the bottom centre). */
const PARCEL_HALF_H = 22;

// --- Obstacles ---------------------------------------------------------------------------------
const LOG_R = 26;
/** Length of a log across the lane, on screen. */
const LOG_LEN = 80;
/** Heights and across-lane depths shrink by this on screen (45 degree camera, as the course). */
const VIEW_K = DEPTH_K;
const LOG_SPEED = 240;
/** Logs hurt below this height (top of the spikes). */
const LOG_HIT_H = 44;
const LOG_HIT_HALF = 20;
const SPRING_VZ = 1120;

// --- Procedural fallback art -------------------------------------------------------------------

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Deterministic pseudo-random for texture speckles (keeps the art identical every run). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Grass banks, four dirt lanes with low hedges, start/finish lines. Arches are drawn separately. */
function paintCourse(ctx: CanvasRenderingContext2D, sky: CanvasImageSource | null): void {
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  if (sky) ctx.drawImage(sky, -W * 0.02, -H * 0.02, W * 1.04, H * 1.04);
  else {
    const sg = ctx.createLinearGradient(0, 0, 0, 300);
    sg.addColorStop(0, '#5fb4ee');
    sg.addColorStop(1, '#cfeefc');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, 320);
  }
  // Distant meadow hills with round trees.
  const hill = (y: number, amp: number, color: string, seed: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, y - amp * (0.5 + 0.5 * Math.sin(x / 260 + seed)) - amp * 0.4 * Math.sin(x / 90 + seed * 2));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  };
  hill(206, 34, '#9fd08a', 1.3);
  for (let k = 0; k < 16; k++) {
    const tx = 40 + k * 124 + hash(k) * 60;
    const ty = 200 - hash(k + 9) * 26;
    const r = 16 + hash(k + 3) * 12;
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(tx - 3, ty, 6, 16);
    ctx.fillStyle = '#5fa65a';
    ctx.beginPath();
    ctx.arc(tx, ty - r * 0.4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(tx - r * 0.3, ty - r * 0.75, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  hill(236, 20, '#84c46c', 4.1);
  // Main grass field.
  const gg = ctx.createLinearGradient(0, 240, 0, H);
  gg.addColorStop(0, '#7cc25e');
  gg.addColorStop(0.35, '#6ab24e');
  gg.addColorStop(1, '#4f9a3c');
  ctx.fillStyle = gg;
  ctx.fillRect(0, 250, W, H - 250);
  for (let k = 0; k < 900; k++) {
    const x = hash(k * 3.1) * W;
    const y = 250 + hash(k * 7.7) * (H - 250);
    ctx.fillStyle = hash(k) > 0.5 ? 'rgba(255,255,220,0.1)' : 'rgba(30,70,20,0.12)';
    ctx.fillRect(x, y, 2 + hash(k * 1.3) * 4, 2);
  }
  // Wooden fence behind the top hedge.
  ctx.fillStyle = '#8a5a30';
  for (let x = 60; x < W - 40; x += 58) {
    ctx.fillRect(x, 300, 8, 44);
    ctx.fillStyle = 'rgba(255,230,190,0.35)';
    ctx.fillRect(x, 300, 3, 44);
    ctx.fillStyle = '#8a5a30';
  }
  ctx.fillStyle = '#9c683a';
  ctx.fillRect(40, 310, W - 80, 7);
  ctx.fillRect(40, 328, W - 80, 7);
  ctx.fillStyle = 'rgba(255,230,190,0.35)';
  ctx.fillRect(40, 310, W - 80, 2);
  ctx.fillRect(40, 328, W - 80, 2);
  // Dirt lanes.
  const lx0 = 96;
  const lx1 = W - 96;
  for (const ly of LANE_Y) {
    const dg = ctx.createLinearGradient(0, ly - LANE_HALF, 0, ly + LANE_HALF);
    dg.addColorStop(0, '#b98a58');
    dg.addColorStop(0.5, '#d2a472');
    dg.addColorStop(1, '#b3834f');
    ctx.fillStyle = dg;
    rr(ctx, lx0, ly - LANE_HALF, lx1 - lx0, LANE_HALF * 2, 18);
    ctx.fill();
    // Worn running groove, pebbles and speckle.
    ctx.fillStyle = 'rgba(120,78,40,0.16)';
    ctx.fillRect(lx0 + 20, ly - 10, lx1 - lx0 - 40, 20);
    for (let k = 0; k < 260; k++) {
      const x = lx0 + 10 + hash(k * 5.3 + ly) * (lx1 - lx0 - 20);
      const y = ly - LANE_HALF + 6 + hash(k * 2.9 + ly * 0.37) * (LANE_HALF * 2 - 12);
      const r = 1 + hash(k * 9.1 + ly) * 2.6;
      ctx.fillStyle = hash(k + ly) > 0.55 ? 'rgba(255,236,200,0.5)' : 'rgba(96,60,28,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Start line (chalk) with lane numbers, finish line (checkered).
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const ly of LANE_Y) {
    ctx.fillRect(START_X - 3, ly - LANE_HALF + 4, 6, LANE_HALF * 2 - 8);
  }
  ctx.font = '700 30px Fredoka, "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  LANE_Y.forEach((ly, i) => {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(String(i + 1), START_X - 44, ly + 2);
  });
  const sq = 13;
  for (const ly of LANE_Y) {
    for (let r = 0; r < Math.floor((LANE_HALF * 2) / sq); r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#1d1d26' : '#fafafa';
        ctx.fillRect(GOAL_X - sq * 1.5 + c * sq, ly - LANE_HALF + 2 + r * sq, sq, sq);
      }
    }
  }
  // Low hedges between the lanes: a shaded front face and a bumpy lit top.
  for (const hy of HEDGE_Y) {
    const top = hy - 22;
    ctx.fillStyle = 'rgba(20,50,20,0.28)';
    rr(ctx, lx0 - 10, hy - 2, lx1 - lx0 + 20, 22, 11);
    ctx.fill();
    const fg = ctx.createLinearGradient(0, top, 0, hy + 14);
    fg.addColorStop(0, '#3f8a35');
    fg.addColorStop(1, '#23561f');
    ctx.fillStyle = fg;
    rr(ctx, lx0 - 12, top + 8, lx1 - lx0 + 24, 30, 12);
    ctx.fill();
    for (let x = lx0 - 6; x < lx1 + 8; x += 22) {
      const r = 13 + hash(x + hy) * 5;
      const bg = ctx.createRadialGradient(x - 3, top + 4, 2, x, top + 10, r);
      bg.addColorStop(0, '#8fd46a');
      bg.addColorStop(0.6, '#5aa843');
      bg.addColorStop(1, '#3b8032');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x, top + 10, r, Math.PI, 0);
      ctx.fill();
    }
    for (let k = 0; k < 28; k++) {
      const x = lx0 + hash(k * 4.7 + hy) * (lx1 - lx0);
      ctx.fillStyle = ['#ffd6e8', '#fff4b0', '#ffffff'][k % 3];
      ctx.beginPath();
      ctx.arc(x, top + 4 + hash(k + hy) * 16, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Flowers and tufts on the front bank.
  for (let k = 0; k < 70; k++) {
    const x = hash(k * 13.3) * W;
    const y = 950 + hash(k * 3.3) * 120;
    ctx.strokeStyle = 'rgba(40,90,30,0.7)';
    ctx.lineWidth = 2;
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + b * 5, y - 10 - hash(k + b) * 6);
      ctx.stroke();
    }
    if (k % 3 === 0) {
      ctx.fillStyle = ['#ff8aa8', '#ffe066', '#ffffff', '#c49bff'][k % 4];
      ctx.beginPath();
      ctx.arc(x, y - 14, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Glowing relic parcel: purple wrapped box with a gold ribbon, bow and a crystal seal. */
function paintParcel(ctx: CanvasRenderingContext2D): void {
  const cx = 60;
  // Front face
  const fx = cx - 34;
  const fy = 50;
  const fw = 68;
  const fh = 48;
  const fg = ctx.createLinearGradient(0, fy, 0, fy + fh);
  fg.addColorStop(0, '#8a55d6');
  fg.addColorStop(1, '#4e2a8f');
  ctx.fillStyle = '#2c1650';
  rr(ctx, fx - 3, fy - 3, fw + 6, fh + 6, 9);
  ctx.fill();
  ctx.fillStyle = fg;
  rr(ctx, fx, fy, fw, fh, 7);
  ctx.fill();
  // Top face
  const tg = ctx.createLinearGradient(0, fy - 22, 0, fy);
  tg.addColorStop(0, '#c9a4ff');
  tg.addColorStop(1, '#9d6be6');
  ctx.fillStyle = '#2c1650';
  ctx.beginPath();
  ctx.moveTo(fx + 6, fy - 25);
  ctx.lineTo(fx + fw - 6, fy - 25);
  ctx.lineTo(fx + fw + 3, fy + 1);
  ctx.lineTo(fx - 3, fy + 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(fx + 8, fy - 22);
  ctx.lineTo(fx + fw - 8, fy - 22);
  ctx.lineTo(fx + fw, fy);
  ctx.lineTo(fx, fy);
  ctx.closePath();
  ctx.fill();
  // Gold ribbon over both faces
  const gold = ctx.createLinearGradient(cx - 7, 0, cx + 7, 0);
  gold.addColorStop(0, '#c98a1b');
  gold.addColorStop(0.5, '#ffe08a');
  gold.addColorStop(1, '#c98a1b');
  ctx.fillStyle = gold;
  ctx.fillRect(cx - 7, fy - 22, 14, fh + 22);
  ctx.fillStyle = '#f4b83b';
  ctx.fillRect(fx, fy + fh / 2 - 6, fw, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(fx, fy + fh / 2 - 6, fw, 2.5);
  ctx.beginPath();
  ctx.moveTo(fx + 4, fy - 11);
  ctx.lineTo(fx + fw - 4, fy - 11);
  ctx.lineTo(fx + fw - 1, fy - 5);
  ctx.lineTo(fx + 1, fy - 5);
  ctx.closePath();
  ctx.fillStyle = '#e6a52a';
  ctx.fill();
  // Bow
  const loop = (dir: number) => {
    ctx.fillStyle = '#c98a1b';
    ctx.beginPath();
    ctx.ellipse(cx + dir * 14, fy - 30, 15, 9, dir * -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd35c';
    ctx.beginPath();
    ctx.ellipse(cx + dir * 14, fy - 31, 11, 6, dir * -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b87400';
    ctx.beginPath();
    ctx.ellipse(cx + dir * 12, fy - 30, 4, 2.5, dir * -0.5, 0, Math.PI * 2);
    ctx.fill();
  };
  loop(-1);
  loop(1);
  ctx.fillStyle = '#f4b83b';
  ctx.beginPath();
  ctx.arc(cx, fy - 27, 6, 0, Math.PI * 2);
  ctx.fill();
  // Crystal seal with a spiral
  const sy = fy + fh / 2;
  const cg = ctx.createRadialGradient(cx - 3, sy - 3, 1, cx, sy, 12);
  cg.addColorStop(0, '#e9fdff');
  cg.addColorStop(0.5, '#5ce1ff');
  cg.addColorStop(1, '#1f8fb0');
  ctx.fillStyle = '#1b3a55';
  ctx.beginPath();
  ctx.arc(cx, sy, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(cx, sy, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 3.2; a += 0.2) {
    const r = 1 + a * 0.75;
    const px = cx + Math.cos(a) * r;
    const py = sy + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // Sheen
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  rr(ctx, fx + 5, fy + 4, 10, fh - 10, 4);
  ctx.fill();
}

/** Iron ball with gold spikes and a chain ring on top. */
function paintMace(ctx: CanvasRenderingContext2D): void {
  const cx = 48;
  const cy = 52;
  const r = MACE_BALL_R;
  // Spikes (behind the ball) all round.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    const tip = r + 15;
    ctx.fillStyle = '#6e4a10';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.26) * (r - 2), cy + Math.sin(a - 0.26) * (r - 2));
    ctx.lineTo(cx + Math.cos(a) * (tip + 2), cy + Math.sin(a) * (tip + 2));
    ctx.lineTo(cx + Math.cos(a + 0.26) * (r - 2), cy + Math.sin(a + 0.26) * (r - 2));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4c54a';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.2) * (r - 2), cy + Math.sin(a - 0.2) * (r - 2));
    ctx.lineTo(cx + Math.cos(a) * tip, cy + Math.sin(a) * tip);
    ctx.lineTo(cx + Math.cos(a + 0.2) * (r - 2), cy + Math.sin(a + 0.2) * (r - 2));
    ctx.closePath();
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx - 9, cy - 10, 2, cx, cy, r);
  g.addColorStop(0, '#8d97a8');
  g.addColorStop(0.45, '#4a5160');
  g.addColorStop(1, '#1f222b');
  ctx.fillStyle = '#15171d';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Front spikes (studs facing the camera)
  for (const [dx, dy] of [
    [-9, -4],
    [9, 6],
    [2, -13],
    [-4, 11],
  ]) {
    ctx.fillStyle = '#7a520f';
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd35c';
    ctx.beginPath();
    ctx.arc(cx + dx - 1, cy + dy - 1, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx - 10, cy - 12, 7, 4, -0.6, 0, Math.PI * 2);
  ctx.fill();
  // Chain ring
  ctx.strokeStyle = '#2a2d36';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r - 4, 6, 7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#9aa3b3';
  ctx.lineWidth = 2;
  ctx.stroke();
}

interface Parcel {
  state: 'held' | 'air' | 'ground';
  x: number;
  z: number;
  vx: number;
  vz: number;
  bounces: number;
  spin: number;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
}

interface Runner {
  p: MgPlayer;
  c: Character;
  lane: number;
  y: number;
  x: number;
  vx: number;
  z: number;
  vz: number;
  carrying: boolean;
  stunT: number;
  invuln: number;
  /** Pick-up / throw lock. */
  act: 'none' | 'pick' | 'throw';
  actT: number;
  /** Flying off a spring (no control until landing). */
  launched: boolean;
  finished: boolean;
  place: number;
  /** Phase of the fake run cycle (bob and rock) for the single-frame carry pose. */
  bob: number;
  markerY: number;
  parcel: Parcel;
  prompt?: Phaser.GameObjects.Container;
  /** Last mace/log decision the CPU made (so it commits once per hazard). */
  cpu: { logId: number; logJump: number; logDone: boolean; maceX: number; maceDir: number; go: boolean; clearT: number; err: number; throwAt: number; wait: number };
}

interface Log {
  id: number;
  lane: number;
  zone: CourseObstacle;
  x: number;
  z: number;
  vz: number;
  roll: number;
  dying: number;
  dust: number;
  img?: Phaser.GameObjects.Sprite;
}

interface LaneKit {
  lane: number;
  y: number;
  ground: Phaser.GameObjects.Graphics;
  logs: Phaser.GameObjects.Graphics;
  maces: { m: CourseObstacle; ball: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; rope: Phaser.GameObjects.Graphics }[];
  springs: { s: CourseObstacle; sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image; cool: number }[];
  crates: { zone: CourseObstacle; g: Phaser.GameObjects.Graphics; warn: Phaser.GameObjects.Text }[];
}

/**
 * Relic Relay — a four-lane obstacle course. Carry your glowing relic parcel from the start arch
 * to the goal: jump rolling spiked logs, time your dash past swinging maces, ride the spring pads.
 * Get bonked and the parcel pops out behind you; you can also lob it ahead over trouble.
 */
export class RelicRelayScene extends BaseMinigame {
  private runners: Runner[] = [];
  private course: CourseObstacle[] = [];
  private kits: LaneKit[] = [];
  private logs: Log[] = [];
  private logSeq = 0;
  private nextRelease = new Map<CourseObstacle, number>();
  private finishedCount = 0;
  private endAt = -1;
  private barG!: Phaser.GameObjects.Graphics;
  private crowd: Phaser.GameObjects.Sprite[] = [];
  private usedLanes: number[] = [];
  private wrapped = false;
  /** Display scale of the mace ball (rendered art is shrunk to the gameplay size). */
  private maceBase = 1;
  /** Roll frames in the rendered log strip. */
  private logFrames = 8;

  constructor() {
    super('mg-relic-relay');
  }

  // --- Arena ------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 75000;
    this.runners = [];
    this.kits = [];
    this.logs = [];
    this.logSeq = 0;
    this.nextRelease = new Map();
    this.finishedCount = 0;
    this.endAt = -1;
    this.wrapped = false;
    this.crowd = [];
    this.usedLanes = LANES_FOR[Math.max(1, Math.min(4, this.launch.players.length))];
    this.maceBase = this.textures.exists(ART.mace.key) ? this.artMeta(ART.mace).k : 1;
    const logMeta = (this.cache.json.get('rendered-mg-sprites') as Record<string, { frames?: number }> | undefined)?.log;
    this.logFrames = logMeta?.frames ?? (this.textures.exists(ART.log.key) ? Math.max(1, this.textures.get(ART.log.key).frameTotal - 1) : 8);
    this.course = buildCourse(this.rng);
    for (const o of this.course) if (o.kind === 'log') this.nextRelease.set(o, o.phase);
    if (this.textures.exists(ART.scene)) {
      // The rendered island is cut out, so the sky shows through above it.
      if (this.textures.exists(SKY_KEY)) this.add.image(GAME_WIDTH / 2, 540, SKY_KEY).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
      this.add.image(0, 0, ART.scene).setOrigin(0).setDepth(-50);
      if (this.textures.exists(ART.sceneFront)) this.add.image(0, 0, ART.sceneFront).setOrigin(0).setDepth(2000);
    } else {
      this.ensureCourseTexture();
      this.add.image(0, 0, TEX_COURSE).setOrigin(0).setDepth(-50);
      this.buildArches();
    }
    this.ensurePropTextures();
    this.buildSpectators();
    for (const lane of this.usedLanes) this.buildLane(lane);
    this.buildGantries();
    this.buildTrackBar();
  }

  private ensureCourseTexture(): void {
    if (this.textures.exists(TEX_COURSE)) return;
    const tex = this.textures.createCanvas(TEX_COURSE, GAME_WIDTH, GAME_HEIGHT);
    if (!tex) return;
    const sky = this.textures.exists(SKY_KEY) ? (this.textures.get(SKY_KEY).getSourceImage() as CanvasImageSource) : null;
    paintCourse(tex.getContext(), sky);
    tex.refresh();
  }

  private ensurePropTextures(): void {
    const make = (key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const tex = this.textures.createCanvas(key, w, h);
      if (!tex) return;
      paint(tex.getContext());
      tex.refresh();
    };
    make(TEX_PARCEL, 120, 110, paintParcel);
    make(TEX_MACE, 96, 100, paintMace);
  }

  /** Anchor and display scale of a rendered sprite (mg/sprites.json wins over the defaults). */
  private artMeta(spec: ArtSpec): { ox: number; oy: number; k: number } {
    const all = this.cache.json.get('rendered-mg-sprites') as Record<string, { anchor?: [number, number]; scale?: number }> | undefined;
    const m = all?.[spec.meta];
    return { ox: m?.anchor?.[0] ?? spec.ox, oy: m?.anchor?.[1] ?? spec.oy, k: spec.size / (m?.scale ?? 1) };
  }

  /** A rendered sprite placed by its anchor, or null when the art isn't loaded. */
  private artImage(spec: ArtSpec, x: number, y: number): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(spec.key)) return null;
    const m = this.artMeta(spec);
    return this.add.image(x, y, spec.key).setOrigin(m.ox, m.oy).setScale(m.k);
  }

  /** Start and goal arches: back pillar behind everyone, front pillar and beam in front. */
  private buildArches(): void {
    const arch = (x: number, label: string, colors: [number, number]) => {
      const top = HEDGE_Y[0];
      const bot = HEDGE_Y[HEDGE_Y.length - 1];
      const h = 250;
      const pillar = (g: Phaser.GameObjects.Graphics, py: number) => {
        g.fillStyle(0x0b1a24, 0.25);
        g.fillEllipse(x + 8, py + 6, 64, 20);
        g.fillStyle(0x6b6b78, 1);
        g.fillRoundedRect(x - 24, py - 18, 48, 26, 6);
        g.fillStyle(0x8e8e9a, 1);
        g.fillRoundedRect(x - 24, py - 22, 48, 10, 5);
        g.fillStyle(0x5a3a1e, 1);
        g.fillRect(x - 13, py - h, 26, h - 16);
        g.fillStyle(0x8a5a30, 1);
        g.fillRect(x - 11, py - h, 18, h - 16);
        g.fillStyle(0xc28a52, 1);
        g.fillRect(x - 9, py - h, 5, h - 16);
        g.fillStyle(colors[0], 1);
        for (let k = 0; k < 3; k++) g.fillRect(x - 13, py - h + 40 + k * 60, 26, 10);
        g.fillStyle(COLORS.gold, 1);
        g.fillCircle(x, py - h - 4, 14);
        g.fillStyle(COLORS.goldLight, 1);
        g.fillCircle(x - 4, py - h - 8, 5);
      };
      const back = this.add.graphics().setDepth(top - 1);
      pillar(back, top);
      const front = this.add.graphics().setDepth(2000);
      pillar(front, bot);
      // Beam running back to front over the lanes, dressed with pennants.
      front.fillStyle(0x4a2e14, 1);
      front.fillRect(x - 9, top - h, 18, bot - top);
      front.fillStyle(0x8a5a30, 1);
      front.fillRect(x - 7, top - h, 12, bot - top);
      for (let y = top - h + 30; y < bot - h - 10; y += 34) {
        front.fillStyle(PLAYER_COLORS[Math.floor((y - top) / 34) % 4], 1);
        front.fillTriangle(x + 6, y, x + 6, y + 22, x + 30, y + 11);
      }
      // Sign board facing the camera at the top of the back pillar.
      const sign = this.add.graphics().setDepth(top);
      sign.fillStyle(0x0b1a24, 0.3);
      sign.fillRoundedRect(x - 86 + 5, top - h - 88 + 6, 172, 62, 14);
      sign.fillStyle(0x6b3f1c, 1);
      sign.fillRoundedRect(x - 86, top - h - 88, 172, 62, 14);
      sign.fillStyle(colors[1], 1);
      sign.fillRoundedRect(x - 78, top - h - 81, 156, 48, 10);
      addText(this, x, top - h - 57, label, 34, { color: CSS.cream, stroke: '#3a2208', strokeThickness: 6, weight: 700, fixed: true }).setDepth(top + 0.5);
    };
    arch(START_X - 50, 'START', [COLORS.teal, COLORS.tealDark]);
    arch(GOAL_X + 30, 'GOAL', [COLORS.coral, 0xc9452f]);
  }

  /** Festival folk cheering from the bank behind the top hedge and beside the arches. */
  private buildSpectators(): void {
    const folk: [NpcId, string, number, number, number][] = [
      ['mimi', 'happy', 360, 338, 0.34],
      ['packsprout', 'cheer', 470, 344, 0.34],
      ['ora', 'wave', 640, 336, 0.34],
      ['pipper', 'happy', 820, 342, 0.34],
      ['wrench', 'laugh', 1100, 338, 0.34],
      ['mimi', 'laugh', 1290, 344, 0.34],
      ['packsprout', 'star', 1450, 336, 0.34],
      ['ora', 'cheer', 1580, 342, 0.34],
      ['pipper', 'coin', 56, 610, 0.38],
      ['wrench', 'idea', 60, 1010, 0.4],
      ['mimi', 'happy', 1868, 620, 0.38],
      ['packsprout', 'cheer', 1862, 1016, 0.4],
    ];
    folk.forEach(([id, pose, x, y, s], i) => {
      const spr = this.add.sprite(x, y, NPC_ATLAS, npcFrame(id, pose));
      const o = standOrigin(NPC_ATLAS, npcFrame(id, pose));
      spr.setOrigin(o.x, o.y).setScale(s).setDepth(y - 2 + i * 0.01).setFlipX(x > 960);
      this.tweens.add({ targets: spr, y: y - 7, duration: 380 + (i % 3) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 70 });
      this.crowd.push(spr);
    });
  }

  private crowdCheer(): void {
    for (const [i, spr] of this.crowd.entries()) {
      const s = spr.scaleX;
      this.tweens.add({ targets: spr, scaleY: { from: s * 0.9, to: s * 1.1 }, duration: 150, yoyo: true, repeat: 2, delay: i * 30, onComplete: () => spr.setScale(s) });
    }
  }

  /** Per-lane props: log crates, mace balls and shadows, spring pads, and the ground overlay. */
  private buildLane(lane: number): void {
    const y = LANE_Y[lane];
    const kit: LaneKit = {
      lane,
      y,
      ground: this.add.graphics().setDepth(y - 8),
      logs: this.add.graphics().setDepth(y + 2),
      maces: [],
      springs: [],
      crates: [],
    };
    for (const o of this.course) {
      if (o.kind === 'spring') {
        const sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image =
          this.artImage(ART.spring, o.x, y) ?? this.add.sprite(o.x, y + 4, 'props', SPRING_FRAME).setOrigin(SPRING_ORIGIN.x, SPRING_ORIGIN.y).setScale(0.5);
        sprite.setDepth(y - 6);
        kit.springs.push({ s: o, sprite, cool: 0 });
      } else if (o.kind === 'mace') {
        const ball = this.artImage(ART.mace, o.x, y) ?? this.add.image(o.x, y, TEX_MACE).setOrigin(0.5, 52 / 100);
        const shadow = this.add.image(o.x, y, 'fx-contact').setDepth(y - 7).setAlpha(0.5);
        const rope = this.add.graphics();
        kit.maces.push({ m: o, ball, shadow, rope });
      } else {
        // Log crate on the back hedge at the top of the run.
        const g = this.add.graphics({ x: o.x1 + 10, y: y - 70 }).setDepth(y - 70 + 2);
        this.drawCrate(g);
        const warn = addText(this, o.x1 + 10, y - 70 - 78, '!', 46, { color: '#ffe08a', stroke: '#6a1a10', strokeThickness: 8, weight: 700, fixed: true })
          .setDepth(y + 400)
          .setVisible(false);
        kit.crates.push({ zone: o, g, warn });
      }
    }
    this.kits.push(kit);
  }

  /** Wooden log crate with an open chute facing down the lane. */
  private drawCrate(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    g.fillStyle(0x0b1a24, 0.25);
    g.fillEllipse(6, 6, 84, 22);
    g.fillStyle(0x4a2c12, 1);
    g.fillRoundedRect(-36, -62, 72, 64, 8);
    g.fillStyle(0x9a6334, 1);
    g.fillRoundedRect(-33, -59, 66, 58, 6);
    g.fillStyle(0xb97c44, 1);
    g.fillRect(-33, -59, 66, 12);
    g.fillStyle(0x6e421d, 1);
    for (const yy of [-44, -28, -12]) g.fillRect(-33, yy, 66, 3);
    g.fillStyle(0x2a1606, 1);
    g.fillRoundedRect(-30, -40, 30, 36, 6);
    // Log ends peeking out of the chute
    g.fillStyle(0x7a4a22, 1);
    g.fillCircle(-18, -24, 10);
    g.fillStyle(0xc89060, 1);
    g.fillCircle(-18, -24, 7);
    g.fillStyle(0x7a4a22, 1);
    g.fillCircle(-4, -14, 7);
    g.fillStyle(COLORS.gold, 1);
    g.fillCircle(-30, -58, 4);
    g.fillCircle(30, -58, 4);
  }

  /** Mace gantries: posts on every hedge line of the used lanes, a beam over the top. */
  private buildGantries(): void {
    const a = this.usedLanes[0];
    const b = this.usedLanes[this.usedLanes.length - 1];
    for (const o of this.course) {
      if (o.kind !== 'mace') continue;
      for (let hIdx = a; hIdx <= b + 1; hIdx++) {
        const hy = HEDGE_Y[hIdx];
        const g = this.add.graphics().setDepth(hy + 1);
        g.fillStyle(0x0b1a24, 0.25);
        g.fillEllipse(o.x + 6, hy + 4, 40, 12);
        g.fillStyle(0x4a2e14, 1);
        g.fillRect(o.x - 8, hy - MACE_PIVOT_H, 16, MACE_PIVOT_H);
        g.fillStyle(0x8a5a30, 1);
        g.fillRect(o.x - 6, hy - MACE_PIVOT_H, 11, MACE_PIVOT_H);
        g.fillStyle(0xc28a52, 1);
        g.fillRect(o.x - 5, hy - MACE_PIVOT_H, 3, MACE_PIVOT_H);
        g.fillStyle(COLORS.gold, 1);
        g.fillRect(o.x - 8, hy - 60, 16, 5);
      }
      const beam = this.add.graphics().setDepth(1990);
      const y0 = HEDGE_Y[a] - MACE_PIVOT_H - 10;
      const y1 = HEDGE_Y[b + 1] - MACE_PIVOT_H + 6;
      beam.fillStyle(0x3a2410, 1);
      beam.fillRoundedRect(o.x - 12, y0, 24, y1 - y0, 8);
      beam.fillStyle(0x9a6334, 1);
      beam.fillRoundedRect(o.x - 9, y0 + 2, 17, y1 - y0 - 4, 6);
      beam.fillStyle(0xc89060, 1);
      beam.fillRect(o.x - 7, y0 + 6, 4, y1 - y0 - 12);
      for (const lane of this.usedLanes) {
        const py = LANE_Y[lane] - MACE_PIVOT_H;
        beam.fillStyle(0x2a2d36, 1);
        beam.fillCircle(o.x, py, 8);
        beam.fillStyle(0x9aa3b3, 1);
        beam.fillCircle(o.x - 2, py - 2, 3.5);
      }
    }
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const lane = this.usedLanes[index % this.usedLanes.length];
    const y = LANE_Y[lane];
    const x = START_X - 30;
    const c = new Character(this, x, y, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.setDepth(y);
    c.hold('carry');
    p.character = c;
    const pimg = this.artImage(ART.parcel, x, y) ?? this.add.image(x, y, TEX_PARCEL).setOrigin(0.5, 101 / 110).setScale(PARCEL_SCALE);
    pimg.setDepth(y + 3);
    const glow = this.add.image(x, y, 'fx-dot').setScale(3.2).setTint(0xffd86a).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 2.9);
    const shadow = this.add.image(x, y, 'fx-contact').setScale(0.42, 0.13).setAlpha(0.55).setDepth(y - 2).setVisible(false);
    const r: Runner = {
      p,
      c,
      lane,
      y,
      x,
      vx: 0,
      z: 0,
      vz: 0,
      carrying: true,
      stunT: 0,
      invuln: 0,
      act: 'none',
      actT: 0,
      launched: false,
      finished: false,
      place: 0,
      bob: index * 1.3,
      markerY: c.marker?.y ?? 0,
      parcel: { state: 'held', x, z: 0, vx: 0, vz: 0, bounces: 0, spin: 0, img: pimg, glow, shadow },
      cpu: { logId: -1, logJump: 0, logDone: false, maceX: -1, maceDir: 0, go: false, clearT: 0, err: 0, throwAt: -1, wait: 0 },
    };
    if (!p.isCpu) {
      const glyph = makeGlyph(this, 'B', 44, glyphKindFor(p.slot));
      const txt = addText(this, 0, 40, 'PICK UP', 24, { color: CSS.white, stroke: '#1b1530', strokeThickness: 6, weight: 700, fixed: true });
      r.prompt = this.add.container(x, y - 120, [glyph, txt]).setDepth(8500).setVisible(false);
    }
    this.runners.push(r);
    this.syncRunner(r);
  }

  protected override onStart(): void {
    for (const r of this.runners) r.c.squash(-0.12, 160);
    audio.play('cheer', { volume: 0.4 });
    this.crowdCheer();
  }

  protected override hudLabel(p: MgPlayer): string {
    const r = this.runners.find((x) => x.p === p);
    if (!r) return '';
    return ordinal(this.rankOf(r));
  }

  /** Live race position: finishers by place, then distance (a parcel in hand counts extra). */
  private rankOf(r: Runner): number {
    const key = (o: Runner) => (o.finished ? 100000 - o.place : o.x + (o.carrying ? 200 : 0));
    return 1 + this.runners.filter((o) => o !== r && key(o) > key(r)).length;
  }

  // --- Track bar ----------------------------------------------------------------------------------
  private buildTrackBar(): void {
    const { x0, x1, y } = TRACK_BAR;
    const bg = this.add.graphics().setDepth(8000);
    bg.fillStyle(0x06141a, 0.3);
    bg.fillRoundedRect(x0 - 76, y - 30 + 6, x1 - x0 + 152, 64, 32);
    bg.fillStyle(0x0c2630, 0.86);
    bg.fillRoundedRect(x0 - 80, y - 32, x1 - x0 + 160, 64, 32);
    bg.lineStyle(4, COLORS.gold, 0.9);
    bg.strokeRoundedRect(x0 - 80, y - 32, x1 - x0 + 160, 64, 32);
    bg.fillStyle(0xffffff, 0.14);
    bg.fillRoundedRect(x0, y - 4, x1 - x0, 8, 4);
    // Obstacle ticks
    for (const o of this.course) {
      const fx = x0 + ((o.x - START_X) / (GOAL_X - START_X)) * (x1 - x0);
      const col = o.kind === 'log' ? 0xb97c44 : o.kind === 'mace' ? 0x8d97a8 : 0xff6b5e;
      bg.fillStyle(0x06141a, 0.8);
      bg.fillCircle(fx, y, 8);
      bg.fillStyle(col, 1);
      bg.fillCircle(fx, y, 5.5);
    }
    // Start flag and checkered goal
    bg.fillStyle(0xffffff, 1);
    bg.fillRect(x0 - 3, y - 16, 5, 32);
    bg.fillStyle(COLORS.teal, 1);
    bg.fillTriangle(x0 + 2, y - 16, x0 + 2, y - 4, x0 + 18, y - 10);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      bg.fillStyle((r + c) % 2 ? 0x1d1d26 : 0xfafafa, 1);
      bg.fillRect(x1 - 2 + c * 7, y - 14 + r * 7, 7, 7);
    }
    this.barG = this.add.graphics().setDepth(8001);
    addText(this, x0 - 44, y + 1, 'RACE', 20, { color: CSS.creamDark, weight: 700, fixed: true }).setDepth(8002);
  }

  private drawTrackBar(): void {
    const g = this.barG;
    if (!g) return;
    const { x0, x1, y } = TRACK_BAR;
    g.clear();
    const sorted = this.runners.slice().sort((a, b) => a.x - b.x);
    sorted.forEach((r, k) => {
      const f = Phaser.Math.Clamp((r.x - START_X) / (GOAL_X - START_X), 0, 1);
      const px = x0 + f * (x1 - x0);
      const py = y - 4 - (k % 2) * 6;
      if (!r.carrying && !r.finished) {
        // Where the parcel is lying.
        const pf = Phaser.Math.Clamp((r.parcel.x - START_X) / (GOAL_X - START_X), 0, 1);
        const qx = x0 + pf * (x1 - x0);
        g.fillStyle(0x06141a, 0.9);
        g.fillRect(qx - 7, y + 6, 14, 12);
        g.fillStyle(0x9d6be6, 1);
        g.fillRect(qx - 5, y + 8, 10, 8);
        g.fillStyle(COLORS.gold, 1);
        g.fillRect(qx - 1, y + 8, 2, 8);
      }
      drawPlayerShape(g, PLAYER_SHAPES[r.p.slot], px, py - 8, 13, PLAYER_COLORS[r.p.slot], 0xffffff, 3);
      if (r.carrying || r.finished) {
        g.fillStyle(0xffd86a, 1);
        g.fillCircle(px + 11, py - 18, 5);
      }
    });
  }

  // --- Runners ------------------------------------------------------------------------------------
  private hit(r: Runner, from: 'log' | 'mace'): void {
    if (r.invuln > 0 || r.finished) return;
    r.stunT = STUN_MS;
    r.invuln = INVULN_MS;
    r.act = 'none';
    r.launched = false;
    r.vx = from === 'log' ? -230 : -170;
    if (r.z > 0) r.vz = Math.min(r.vz, 0);
    audio.play('hit', { volume: 0.7 });
    this.fx.vfx('impact', r.x + 10, r.y - 70 - r.z, { scale: 0.5, blend: 'add', depth: r.y + 10 });
    this.fx.shake(0.004, 140);
    this.rumble(r.p, 0.7, 0.5, 220);
    r.c.play('stunned', { force: true });
    r.c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => r.c.sprite.clearTint());
    if (r.carrying) this.dropParcel(r);
  }

  /** The parcel pops out and tumbles to the ground a little behind the runner. */
  private dropParcel(r: Runner): void {
    const pc = r.parcel;
    r.carrying = false;
    pc.state = 'air';
    pc.x = r.x + 20;
    pc.z = Math.max(60, r.z + 60);
    pc.vx = -this.rng.range(130, 200);
    pc.vz = this.rng.range(520, 620);
    pc.bounces = 0;
    pc.spin = this.rng.chance(0.5) ? -540 : 540;
    audio.play('pop', { volume: 0.6, rate: 0.8 });
    this.fx.floatText(r.x, r.y - 170, 'DROPPED!', '#ff8a7a', { size: 40, stroke: '#4a1010', rise: 60, duration: 900, depth: 8600 });
  }

  private throwParcel(r: Runner): void {
    const pc = r.parcel;
    r.carrying = false;
    r.act = 'throw';
    r.actT = THROW_MS;
    pc.state = 'air';
    pc.x = r.x + 30;
    pc.z = r.z + 90;
    pc.vx = THROW_VX;
    pc.vz = THROW_VZ;
    pc.bounces = 0;
    pc.spin = 420;
    r.c.face(false).play('throw', { force: true, returnTo: 'idle' });
    audio.play('whoosh', { volume: 0.5 });
    this.rumble(r.p, 0.15, 0.2, 60);
  }

  private pickUp(r: Runner): void {
    const pc = r.parcel;
    r.act = 'pick';
    r.actT = PICK_MS;
    r.vx = 0;
    pc.state = 'held';
    r.carrying = true;
    r.c.hold('crouch');
    audio.play('itemGet', { volume: 0.45 });
    this.fx.vfx('sparkle', pc.x, r.y - 30, { scale: 0.45, duration: 380, blend: 'add', depth: r.y + 5 });
    this.rumble(r.p, 0.1, 0.25, 70);
  }

  private jump(r: Runner): void {
    const hand = CHARACTERS[r.p.characterId].handling;
    r.vz = (r.carrying ? JUMP_V_CARRY : JUMP_V) * hand.jump;
    if (!r.carrying) r.c.play('jump', { force: true });
    r.c.squash(-0.1, 110);
    audio.play('jump', { volume: 0.5, rate: 0.95 + Math.random() * 0.1 });
    this.fx.vfx('dust', r.x, r.y, { scale: 0.18, duration: 260, alpha: 0.55, depth: r.y - 1 });
  }

  private springLaunch(r: Runner, k: LaneKit['springs'][number]): void {
    r.launched = true;
    r.vz = SPRING_VZ;
    r.vx = (k.s.period || SPRING_DIST) / ((2 * SPRING_VZ) / GRAVITY);
    k.cool = 700;
    if (k.sprite instanceof Phaser.GameObjects.Sprite) k.sprite.play('spring-launch');
    else this.tweens.add({ targets: k.sprite, scaleY: { from: 0.7, to: 1 }, duration: 260, ease: 'Back.Out' });
    audio.play('bounce', { volume: 0.7 });
    this.fx.vfx('dust', k.s.x, r.y + 4, { scale: 0.3, duration: 360, alpha: 0.7, depth: r.y - 1 });
    if (!r.carrying) r.c.play('jump', { force: true });
    r.c.squash(-0.18, 160);
    this.rumble(r.p, 0.3, 0.4, 120);
  }

  private finish(r: Runner): void {
    r.finished = true;
    this.finishedCount++;
    r.place = this.finishedCount;
    r.p.doneAt = this.elapsed;
    r.p.score = r.place;
    r.act = 'none';
    audio.play(r.place === 1 ? 'fanfare' : 'chipGain', { volume: 0.7 });
    this.fx.confetti(GOAL_X, r.y - 120, r.place === 1 ? 70 : 36);
    this.fx.sparks(GOAL_X, r.y - 60, 20);
    this.fx.floatText(GOAL_X - 110, r.y - 50, `${ordinal(r.place)}!`, r.place === 1 ? '#ffe08a' : '#ffffff', { size: 70, stroke: '#3a2208', rise: 40, duration: 1500, depth: 8600 });
    r.c.play('victory', { force: true, returnTo: 'idle' });
    r.c.marker?.setVisible(false);
    // Keep celebrating at the finish until the round wraps up.
    this.time.addEvent({ delay: 1500, repeat: 20, callback: () => r.c.active && r.c.play(r.c.current === 'victory' ? 'celebrate' : 'victory', { force: true }) });
    this.rumble(r.p, 0.4, 0.6, 260);
    this.crowdCheer();
    const n = this.runners.length;
    if (this.finishedCount >= n || (n > 1 && this.finishedCount >= n - 1)) this.endAt = this.elapsed + 1600;
  }

  private updateRunner(r: Runner, dt: number): void {
    const s = dt / 1000;
    const c = r.p.controls;
    const hand = CHARACTERS[r.p.characterId].handling;
    r.stunT = Math.max(0, r.stunT - dt);
    r.invuln = Math.max(0, r.invuln - dt);
    const grounded = r.z <= 0 && r.vz <= 0;
    if (r.finished) {
      // Jog to a stop past the line, then celebrate.
      const dx = FINISH_REST_X - r.x;
      r.vx = Math.abs(dx) > 4 ? Math.sign(dx) * 120 : 0;
      r.x += r.vx * s;
    } else if (r.act !== 'none') {
      r.actT -= dt;
      r.vx *= Math.exp(-14 * s);
      r.x += r.vx * s;
      if (r.actT <= 0) {
        r.act = 'none';
        if (r.carrying) r.c.hold('carry');
      }
    } else if (r.stunT > 0 || r.launched) {
      r.vx *= Math.exp(-(r.launched ? 0 : 5) * s);
      r.x += r.vx * s;
    } else {
      const max = (r.carrying ? RUN_SPEED : RUN_SPEED_EMPTY) * hand.speed;
      const target = Math.abs(c.moveX) > 0.2 ? Math.sign(c.moveX) * Math.min(1, Math.abs(c.moveX) * 1.25) * max : 0;
      const rate = target !== 0 ? ACCEL * hand.accel : FRICTION;
      const air = grounded ? 1 : 0.35;
      r.vx += (target - r.vx) * (1 - Math.exp(-rate * air * s));
      r.x += r.vx * s;
      if (grounded && c.pressed('A')) this.jump(r);
      else if (c.pressed('X') && r.carrying) this.throwParcel(r);
      else if (c.pressed('B') && !r.carrying && grounded && r.parcel.state === 'ground' && Math.abs(r.parcel.x - r.x) < PICK_RANGE) this.pickUp(r);
    }
    r.x = Phaser.Math.Clamp(r.x, START_X - 60, GOAL_X + 130);
    // Vertical motion
    if (!grounded || r.vz > 0) {
      r.vz -= GRAVITY * s;
      r.z += r.vz * s;
      if (r.z <= 0 && r.vz < 0) {
        r.z = 0;
        r.vz = 0;
        if (r.launched) {
          r.launched = false;
          r.vx = Math.min(r.vx, (r.carrying ? RUN_SPEED : RUN_SPEED_EMPTY) * hand.speed);
        }
        r.c.squash(0.16, 140);
        audio.play('land', { volume: 0.35, throttleMs: 60 });
        this.fx.vfx('dust', r.x, r.y, { scale: 0.2, duration: 280, alpha: 0.55, depth: r.y - 1 });
        if (r.stunT <= 0 && r.act === 'none') {
          if (r.carrying) r.c.hold('carry');
          else r.c.play('idle');
        }
      }
    }
    // Finish line: only with the parcel in hand.
    if (!r.finished && r.carrying && r.x >= GOAL_X) this.finish(r);
  }

  private updateParcel(r: Runner, dt: number): void {
    const pc = r.parcel;
    const s = dt / 1000;
    if (pc.state === 'air') {
      pc.vz -= GRAVITY * s;
      pc.x += pc.vx * s;
      pc.z += pc.vz * s;
      if (pc.z <= 0) {
        pc.z = 0;
        pc.bounces++;
        if (pc.bounces >= 2 || Math.abs(pc.vz) < 180) {
          pc.state = 'ground';
          pc.vx = 0;
          pc.vz = 0;
          this.fx.vfx('dust', pc.x, r.y, { scale: 0.2, duration: 280, alpha: 0.5, depth: r.y - 1 });
        } else {
          pc.vz = -pc.vz * 0.35;
          pc.vx *= 0.45;
          audio.play('land', { volume: 0.3, rate: 1.4, throttleMs: 60 });
        }
      }
      pc.x = Phaser.Math.Clamp(pc.x, START_X - 40, GOAL_X + 110);
    }
  }

  private syncRunner(r: Runner): void {
    const c = r.c;
    const now = this.time.now;
    c.setPosition(r.x, r.y).setDepth(r.y);
    // Run cycle for the (single-frame) carry pose: bob and rock.
    const moving = Math.abs(r.vx) > 30 && r.z <= 0 && r.stunT <= 0;
    if (moving) r.bob += (Math.abs(r.vx) / 1000) * 0.075 * (this.game.loop.delta || 16);
    const carryPose = r.carrying && r.act === 'none' && r.stunT <= 0 && !r.finished;
    const bobY = carryPose && moving ? -Math.abs(Math.sin(r.bob)) * 9 : carryPose ? Math.sin(now / 260) * 1.5 : 0;
    c.sprite.y = (-r.z + bobY) / c.scaleY;
    c.sprite.setAngle(carryPose && moving ? Math.sin(r.bob) * 3 : 0);
    if (c.marker) c.marker.y = r.markerY - r.z / c.scaleY;
    c.shadow?.setScale(1 - Math.min(0.55, r.z / 320));
    c.sprite.setAlpha(r.invuln > 0 && r.stunT <= 0 ? (Math.floor(now / 80) % 2 ? 0.5 : 1) : 1);
    if (Math.abs(r.vx) > 25 && r.act === 'none' && !r.launched) c.face(r.vx < 0);
    if (this.phase !== 'finished') {
      if (!r.carrying && r.stunT <= 0 && r.act === 'none' && r.z <= 0 && !r.finished) {
        if (moving && c.current !== 'run') c.play('run');
        else if (!moving && (c.current === 'run' || c.current === 'carry' || c.current === 'crouch')) c.play('idle');
      }
      if (r.carrying && r.stunT <= 0 && r.act === 'none' && !r.finished && c.current !== 'carry' && r.z <= 0) c.hold('carry');
    }
    // Parcel (anchored at its bottom centre).
    const pc = r.parcel;
    if (pc.state === 'held') {
      if (r.finished) {
        // Held up high while celebrating.
        pc.x = r.x;
        pc.img.setPosition(r.x, r.y - r.z + c.headY * c.scaleY - 4 + Math.sin(now / 200) * 4).setAngle(0);
      } else {
        const grip = HERO_DATA.points[r.p.characterId]?.carry;
        const hold = grip ? { x: grip[0], y: grip[1] + 18 } : (CARRY_HOLD[r.p.characterId] ?? { x: 72, y: -112 });
        const dir = c.isFacingLeft ? -1 : 1;
        const crouch = r.act === 'pick' ? 0.55 : 1;
        pc.x = r.x + dir * hold.x * c.scaleX;
        pc.img.setPosition(pc.x, r.y + hold.y * crouch * c.scaleY - r.z + bobY + PARCEL_HALF_H).setAngle(c.sprite.angle);
      }
      pc.img.setDepth(r.y + 3);
      pc.shadow.setVisible(false);
    } else {
      if (pc.state === 'air') pc.img.angle += pc.spin * ((this.game.loop.delta || 16) / 1000);
      else pc.img.setAngle(Phaser.Math.Linear(pc.img.angle, 0, 0.3));
      const rest = pc.state === 'ground' ? Math.sin(now / 240) * 3 - 5 : 0;
      pc.img.setPosition(pc.x, r.y - pc.z + rest + (pc.state === 'air' ? PARCEL_HALF_H * 0.5 : 0)).setDepth(pc.state === 'ground' ? r.y - 1 : r.y + 3);
      pc.shadow.setVisible(true).setPosition(pc.x, r.y + 2).setScale(0.42 - Math.min(0.2, pc.z / 800), 0.13);
    }
    const pulse = 0.5 + 0.5 * Math.sin(now / 180 + r.p.slot);
    pc.glow
      .setPosition(pc.img.x, pc.img.y - PARCEL_HALF_H)
      .setDepth(pc.img.depth - 0.1)
      .setAlpha((pc.state === 'ground' ? 0.55 : 0.4) + 0.25 * pulse)
      .setScale(pc.state === 'ground' ? 3.8 : 3.1);
    // Pick-up prompt for humans.
    if (r.prompt) {
      const show = !r.carrying && pc.state === 'ground' && Math.abs(pc.x - r.x) < PICK_RANGE * 1.6 && !r.finished && this.phase === 'playing';
      r.prompt.setVisible(show);
      // Above the player badge, so the two never overlap.
      if (show) r.prompt.setPosition(pc.x, r.y - 190 + Math.sin(now / 150) * 4);
    }
  }

  // --- Obstacles ----------------------------------------------------------------------------------
  private updateLogs(dt: number): void {
    const s = dt / 1000;
    // Releases are shared by every lane (same timing for fairness), telegraphed by the crate.
    for (const o of this.course) {
      if (o.kind !== 'log') continue;
      const due = this.nextRelease.get(o) ?? 0;
      const soon = due - this.elapsed;
      for (const k of this.kits) {
        const crate = k.crates.find((cr) => cr.zone === o);
        if (!crate) continue;
        const warn = soon < 480 && soon > 0;
        crate.warn.setVisible(warn);
        if (warn) crate.warn.setScale(1 + 0.15 * Math.sin(this.time.now / 50));
        crate.g.x = o.x1 + 10 + (warn ? Math.sin(this.time.now / 25) * 2.5 : 0);
      }
      if (soon <= 0) {
        this.nextRelease.set(o, due + o.period);
        for (const k of this.kits) {
          const log: Log = { id: ++this.logSeq, lane: k.lane, zone: o, x: o.x1 - 8, z: 34, vz: 120, roll: 0, dying: 0, dust: 0 };
          if (this.textures.exists(ART.log.key)) {
            const m = this.artMeta(ART.log);
            log.img = this.add.sprite(log.x, k.y, ART.log.key, 0).setOrigin(m.ox, m.oy).setScale(m.k).setDepth(k.y + 2);
          }
          this.logs.push(log);
        }
        audio.play('rumble', { volume: 0.25, throttleMs: 300 });
      }
    }
    for (const log of this.logs) {
      if (log.dying > 0) {
        log.dying -= dt;
        continue;
      }
      log.x -= LOG_SPEED * s;
      log.roll -= (LOG_SPEED * s) / LOG_R;
      log.dust -= dt;
      if (log.dust <= 0 && log.z <= 0) {
        log.dust = 170;
        const y = LANE_Y[log.lane];
        this.fx.vfx('dust', log.x + LOG_R + 4, y + 4, { scale: 0.13, duration: 280, alpha: 0.45, dx: 26, depth: y + 1 });
      }
      if (log.z > 0 || log.vz > 0) {
        log.vz -= GRAVITY * s;
        log.z = Math.max(0, log.z + log.vz * s);
        if (log.z === 0) {
          log.vz = 0;
          audio.play('land', { volume: 0.25, rate: 0.7, throttleMs: 100 });
        }
      }
      if (log.x <= log.zone.x0) {
        log.dying = 260;
        const y = LANE_Y[log.lane];
        this.fx.vfx('dust', log.x, y, { scale: 0.3, duration: 320, alpha: 0.7, depth: y + 3 });
        audio.play('crack', { volume: 0.2, rate: 1.3, throttleMs: 120 });
      }
    }
    for (const log of this.logs) if (log.dying > 0 && log.dying <= dt) log.img?.destroy();
    this.logs = this.logs.filter((l) => !(l.dying > 0 && l.dying <= dt));
  }

  /**
   * Redraw every log (per-lane Graphics) as a spiked cylinder lying across the lane, seen by the
   * course's 45 degree camera: rotating spikes and bark, and the spiral end cap facing us. While
   * the lane's runner is airborne the log sorts behind them, so a clean jump reads as one.
   */
  private drawLogs(): void {
    for (const k of this.kits) {
      k.logs.clear();
      const r = this.runners.find((rr) => rr.lane === k.lane);
      k.logs.setDepth(r && r.z > 24 ? k.y - 1 : k.y + 2);
    }
    const R = LOG_R;
    const sp = 19;
    const ry = R * VIEW_K;
    for (const log of this.logs) {
      const k = this.kits.find((kk) => kk.lane === log.lane);
      if (!k) continue;
      const y = k.y;
      const fade = log.dying > 0 ? log.dying / 260 : 1;
      const sink = log.dying > 0 ? (1 - fade) * 20 : 0;
      if (log.img) {
        const frames = Math.max(1, this.logFrames);
        const f = Math.floor(((((-log.roll) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) / (Math.PI / 3) * frames) % frames;
        log.img.setFrame(f).setPosition(log.x, y - log.z * VIEW_K + sink).setAlpha(fade).setDepth(k.logs.depth);
        continue;
      }
      const g = k.logs;
      const x = log.x;
      const gy = y - log.z * VIEW_K + sink;
      const back = gy - LOG_LEN / 2;
      const front = gy + LOG_LEN / 2;
      g.fillStyle(0x0b1a24, 0.25 * fade);
      g.fillEllipse(x + 8, y + 2, R * 2.5, LOG_LEN + 10);
      // Point on a spike ring at angle a (0 = up, pi/2 = towards +x), ring ground position ly.
      const spike = (a: number, ly: number, pass: 0 | 1) => {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        if ((pass === 0) !== ca < 0.15) return;
        const cy = ly - ry;
        const bx = x + sa * (R - 2);
        const by = cy - ca * (R - 2) * VIEW_K;
        const tx = x + sa * (R + sp);
        const ty = cy - ca * (R + sp) * VIEW_K;
        const wx = ca * 5.5;
        const wy = sa * 5.5 * VIEW_K;
        g.fillStyle(0x6e4a10, fade);
        g.fillTriangle(bx - wx, by - wy, bx + wx, by + wy, tx, ty);
        g.fillStyle(pass ? 0xf4c54a : 0xc9962c, fade);
        g.fillTriangle(bx - wx * 0.6, by - wy * 0.6, bx + wx * 0.6, by + wy * 0.6, tx, ty);
      };
      const rings = [back + LOG_LEN * 0.2, gy, front - LOG_LEN * 0.2];
      const spin = (n: number, ro: number) => log.roll + (n / 6) * Math.PI * 2 + ro * 0.004;
      for (const ro of rings) for (let n = 0; n < 6; n++) spike(spin(n, ro), ro, 0);
      // Body: dark outline, bark, a lit top band running along the log.
      g.fillStyle(0x3a220e, fade);
      g.fillEllipse(x, back - ry, R * 2 + 4, ry * 2 + 4);
      g.fillRect(x - R - 2, back - ry, R * 2 + 4, LOG_LEN);
      g.fillStyle(0x7e4c24, fade);
      g.fillEllipse(x, back - ry, R * 2, ry * 2);
      g.fillRect(x - R, back - ry, R * 2, LOG_LEN);
      g.fillStyle(0x9c6334, fade);
      g.fillRect(x - R * 0.72, back - ry * 1.6, R * 1.2, LOG_LEN);
      g.fillStyle(0xbf8450, fade);
      g.fillRect(x - R * 0.45, back - ry * 1.75, R * 0.5, LOG_LEN);
      g.fillStyle(0x5a3416, fade * 0.9);
      g.fillRect(x + R * 0.55, back - ry, R * 0.45, LOG_LEN);
      // Bark grooves travel round as it rolls.
      for (let n = 0; n < 7; n++) {
        const a = log.roll * 1 + (n / 7) * Math.PI * 2;
        if (Math.cos(a) < 0.1) continue;
        const gx = x + Math.sin(a) * R * 0.93;
        g.fillStyle(0x4a2a10, fade * 0.7);
        g.fillRect(gx - 1.2, back - ry - Math.cos(a) * ry * 0.9 + 4, 2.4, LOG_LEN - 6);
      }
      for (const ro of rings) for (let n = 0; n < 6; n++) spike(spin(n, ro), ro, 1);
      // Front end cap: gold band, wood rings and the spinning spiral seal.
      const ey = front - ry;
      g.fillStyle(0x3a220e, fade);
      g.fillEllipse(x, ey, R * 2 + 4, ry * 2 + 4);
      g.fillStyle(0xe0a93f, fade);
      g.fillEllipse(x, ey, R * 2, ry * 2);
      g.fillStyle(0xd9ad78, fade);
      g.fillEllipse(x, ey, R * 1.56, ry * 1.56);
      g.lineStyle(1.5, 0xa47444, fade * 0.8);
      g.strokeEllipse(x, ey, R * 1.1, ry * 1.1);
      g.lineStyle(2.4, 0x1fa5a0, fade);
      g.beginPath();
      for (let a = 0; a < Math.PI * 3; a += 0.3) {
        const rad = 1.5 + a * 1.2;
        const px = x + Math.cos(a + log.roll) * rad;
        const py = ey + Math.sin(a + log.roll) * rad * VIEW_K;
        if (a === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();
    }
  }

  private updateHazards(dt: number): void {
    for (const k of this.kits) {
      const r = this.runners.find((rr) => rr.lane === k.lane);
      for (const sp of k.springs) {
        sp.cool = Math.max(0, sp.cool - dt);
        if (!r || r.finished || sp.cool > 0 || r.launched) continue;
        const grounded = r.z <= 0 && r.vz <= 0;
        if (grounded && r.stunT <= 0 && Math.abs(r.x - sp.s.x) < SPRING_HALF && r.vx > 20) this.springLaunch(r, sp);
      }
      if (!r || r.finished || r.invuln > 0) continue;
      for (const log of this.logs) {
        if (log.lane !== k.lane || log.dying > 0) continue;
        if (log.z <= 0 && Math.abs(log.x - r.x) < LOG_HIT_HALF + BODY_HALF && r.z < LOG_HIT_H) {
          this.hit(r, 'log');
          break;
        }
      }
      if (r.invuln > 0) continue;
      for (const mk of k.maces) {
        if (maceHits(mk.m, this.elapsed, r.x, r.z)) {
          this.hit(r, 'mace');
          break;
        }
      }
    }
  }

  /** Mace balls, ropes, ground shadows and the pulsing danger strip across each lane. */
  private drawMaces(): void {
    const t = this.elapsed;
    for (const k of this.kits) {
      const g = k.ground;
      g.clear();
      for (const mk of k.maces) {
        const m = mk.m;
        const b = maceBall(m, t);
        const sy = k.y + b.w * DEPTH_K;
        const bx = m.x + b.ax;
        const by = sy - b.h;
        // Danger strip: brightens as the ball swings into the lane.
        const near = Phaser.Math.Clamp(1 - (Math.abs(b.w) - (BODY_DEPTH + MACE_BALL_R)) / 70, 0, 1);
        g.fillStyle(0xff3b1f, 0.08 + 0.3 * near);
        g.fillRect(m.x - MACE_STRIP, k.y - LANE_HALF + 6, MACE_STRIP * 2, LANE_HALF * 2 - 12);
        g.lineStyle(3, 0xff5a3a, 0.25 + 0.6 * near);
        g.strokeRect(m.x - MACE_STRIP, k.y - LANE_HALF + 6, MACE_STRIP * 2, LANE_HALF * 2 - 12);
        // Swing path on the ground (dotted).
        const reach = Math.sin(MACE_AMP) * MACE_ROPE;
        for (let f = -1; f <= 1.001; f += 0.2) {
          g.fillStyle(0xffffff, 0.35);
          g.fillCircle(m.x + f * reach * MACE_ALONG, k.y + f * reach * MACE_ACROSS * DEPTH_K, 2.5);
        }
        // Shadow: tight and dark when low, soft when high.
        const hk = Phaser.Math.Clamp((b.h - 60) / 140, 0, 1);
        mk.shadow.setPosition(bx, sy).setScale(0.55 + hk * 0.35, (0.55 + hk * 0.35) * 0.35).setAlpha(0.6 - hk * 0.3);
        const depth = k.y + b.w * DEPTH_K + 1;
        const scale = 1 + (b.w / (MACE_ROPE * MACE_ACROSS)) * 0.12;
        mk.ball.setPosition(bx, by).setScale(this.maceBase * scale).setDepth(depth).setAngle(Math.sin(t / 300) * 10);
        // Rope from the pivot on the beam down to the ball.
        const px = m.x;
        const py = k.y - MACE_PIVOT_H;
        const rope = mk.rope;
        rope.clear().setDepth(depth - 0.05);
        rope.lineStyle(5, 0x3a2a14, 1);
        rope.lineBetween(px, py, bx, by - MACE_BALL_R);
        rope.lineStyle(2.5, 0xc9a45c, 1);
        rope.lineBetween(px, py, bx, by - MACE_BALL_R);
      }
    }
  }

  // --- Frame ------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.updateLogs(dt);
    for (const r of this.runners) {
      this.updateRunner(r, dt);
      this.updateParcel(r, dt);
    }
    this.updateHazards(dt);
    this.syncAll();
    if (this.endAt >= 0 && this.elapsed >= this.endAt) this.end();
  }

  private syncAll(): void {
    for (const r of this.runners) this.syncRunner(r);
    this.drawLogs();
    this.drawMaces();
    this.drawTrackBar();
  }

  protected override ambient(): void {
    if (this.phase !== 'playing') this.syncAll();
  }

  protected override end(): void {
    const first = !this.wrapped;
    this.wrapped = true;
    super.end();
    if (!first) return;
    for (const r of this.runners) {
      r.prompt?.setVisible(false);
      r.vx = 0;
      if (r.finished) {
        if (r.c.current !== 'victory') r.c.play('victory', { force: true, returnTo: 'celebrate' });
      } else {
        // Didn't make it: set the parcel down and sulk.
        if (r.carrying) {
          r.carrying = false;
          r.parcel.state = 'ground';
          r.parcel.x = r.x + (r.c.isFacingLeft ? -40 : 40);
          r.parcel.z = 0;
        }
        r.z = 0;
        r.c.sprite.y = 0;
        r.c.sprite.setAngle(0);
        r.c.play('disappointed', { force: true, returnTo: 'idle' });
      }
    }
  }

  // --- CPU ----------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const r = this.runners.find((x) => x.p === p);
    if (!r) return;
    if (r.finished || r.stunT > 0 || r.act !== 'none' || r.launched) {
      vc.setMove(0, 0);
      return;
    }
    const sk = this.skill(p);
    const b = p.brain;
    const cp = r.cpu;
    b.timer -= dt;
    const think = b.timer <= 0;
    if (think) b.timer = sk.think * (0.6 + Math.random() * 0.5);
    const grounded = r.z <= 0 && r.vz <= 0;
    const pc = r.parcel;
    let move = 1;
    // 1) Parcel on the ground or flying: go and get it.
    if (!r.carrying) {
      const tx = pc.state === 'air' ? pc.x + pc.vx * 0.25 : pc.x;
      const dx = tx - r.x;
      if (Math.abs(dx) > PICK_RANGE * 0.55) move = Math.sign(dx);
      else {
        move = 0;
        // Only crouch for it when no log will roll in (or drop out of a crate) during the pick-up.
        const window = (PICK_MS + 300) / 1000;
        const logSoon =
          this.logs.some((l) => l.lane === r.lane && l.dying <= 0 && l.x > r.x - 20 && (l.x - r.x - 42) / LOG_SPEED < window) ||
          this.course.some((o) => o.kind === 'log' && r.x > o.x0 - 40 && r.x < o.x1 && ((this.nextRelease.get(o) ?? 0) - this.elapsed) / 1000 + (o.x1 - 8 - r.x) / LOG_SPEED < window + 0.2);
        if (pc.state === 'ground' && grounded && !logSoon) {
          cp.wait += dt;
          if (cp.wait >= sk.reaction * 0.7) {
            cp.wait = 0;
            vc.tap('B');
          }
        }
      }
    } else cp.wait = 0;
    // 2) Maces ahead: wait at the strip until a clean window has been seen for a moment (the
    //    reaction delay), then commit. A careless CPU (by skill) sometimes just goes for it.
    const dir = Math.sign(move) || 1;
    const mace = this.course.find((o) => o.kind === 'mace' && (dir > 0 ? o.x + MACE_STRIP + 10 > r.x && o.x - MACE_STRIP - 110 < r.x : o.x - MACE_STRIP - 10 < r.x && o.x + MACE_STRIP + 110 > r.x));
    if (mace && move !== 0) {
      const outside = dir > 0 ? r.x < mace.x - MACE_STRIP - 18 : r.x > mace.x + MACE_STRIP + 18;
      if (outside) {
        if (cp.maceX !== mace.x || cp.maceDir !== dir) {
          cp.maceX = mace.x;
          cp.maceDir = dir;
          cp.go = Math.random() < sk.mistake * 0.5;
          cp.clearT = 0;
          cp.err = (Math.random() - 0.5) * sk.aimNoise * 600;
        }
        if (!cp.go) {
          const speed = (r.carrying ? RUN_SPEED : RUN_SPEED_EMPTY) * CHARACTERS[p.characterId].handling.speed;
          if (strideClear(mace, r.x, r.vx, dir, speed, ACCEL * CHARACTERS[p.characterId].handling.accel, this.elapsed + cp.err + dt)) cp.clearT += dt;
          else cp.clearT = 0;
          if (cp.clearT >= sk.reaction * 0.6) cp.go = true;
        }
        if (!cp.go) {
          // Hold just short of the strip.
          const edge = dir > 0 ? mace.x - MACE_STRIP - 30 : mace.x + MACE_STRIP + 30;
          move = Math.abs(edge - r.x) > 8 ? Math.sign(edge - r.x) * 0.6 : 0;
          // Sometimes lob the parcel over while waiting.
          if (r.carrying && dir > 0 && cp.throwAt !== mace.x && think) {
            cp.throwAt = mace.x;
            if (Math.random() < 0.15 + sk.accuracy * 0.2 && this.landingClear(r.x + 30 + THROW_VX * ((2 * THROW_VZ) / GRAVITY))) vc.tap('X');
          }
        }
      } else if (grounded && Math.random() < sk.accuracy * 0.3) {
        // Inside the strip with the ball about to arrive: hop it.
        const soon = [0.16, 0.22].some((tt) => maceHits(mace, this.elapsed + tt * 1000, r.x + r.vx * tt, 0));
        if (soon) vc.tap('A');
      }
    }
    // 3) Logs rolling in: jump with a skill-dependent reaction. Logs are only jumpable head-on, so
    //    a CPU heading back towards its parcel turns to face a log catching it up.
    if (grounded) {
      let best: Log | null = null;
      let bestT = Infinity;
      for (const log of this.logs) {
        if (log.lane !== r.lane || log.dying > 0) continue;
        const rel = log.x - r.x;
        const closing = (r.vx + LOG_SPEED) * Math.sign(rel || 1);
        if (Math.abs(rel) > 260 || closing <= 40) continue;
        const tc = Math.abs(rel) / closing;
        if (tc < bestT) {
          bestT = tc;
          best = log;
        }
      }
      // A log about to drop out of a crate: dash under the chute if there's time, otherwise hold
      // back clear of where it lands (it then rolls in head-on and gets jumped).
      for (const o of this.course) {
        if (o.kind !== 'log' || move <= 0) continue;
        const due = ((this.nextRelease.get(o) ?? 0) - this.elapsed) / 1000;
        const rel = o.x1 - 8 - r.x;
        if (due <= 0 || due > 0.9 || rel < -10 || rel > 170) continue;
        const passT = (rel + 10) / Math.max(60, r.vx);
        if (passT < due + 0.1) continue;
        move = rel > 105 ? 0 : -0.6;
      }
      if (best) {
        const rel = best.x - r.x;
        // Meet it head-on: turning to face a log that's catching you up, or stepping into one
        // while waiting, makes the hop far easier to time (the log is over faster).
        if (rel > 0 && move <= 0 && rel < 170) move = 0.6;
        if (best.id !== cp.logId) {
          cp.logId = best.id;
          cp.logDone = false;
          // Aim to be at the top of the hop as the log rolls under (that centres the safe window
          // whatever the closing speed); timing noise and outright slips scale with skill.
          const apex = ((r.carrying ? JUMP_V_CARRY : JUMP_V) * CHARACTERS[p.characterId].handling.jump) / GRAVITY;
          const wrong = Math.random() < sk.mistake * 0.7;
          cp.logJump = wrong ? (Math.random() < 0.5 ? apex + 0.3 : 0.03) : apex + (Math.random() - 0.5) * sk.aimNoise * 0.2;
        }
        // Jump once the time to contact drops to the planned lead (half a frame early, so the
        // average error is zero at any frame rate).
        if (!cp.logDone && bestT - dt / 2000 <= cp.logJump) {
          cp.logDone = true;
          vc.tap('A');
        }
      }
      // Carrying into a log run? A bold CPU may lob the parcel over the whole run.
      if (r.carrying && think && move > 0) {
        const zone = this.course.find((o) => o.kind === 'log' && o.x0 > r.x && o.x0 - r.x < 60);
        if (zone && cp.throwAt !== zone.x && Math.random() < 0.12 + sk.accuracy * 0.18) {
          cp.throwAt = zone.x;
          if (this.landingClear(r.x + 30 + THROW_VX * ((2 * THROW_VZ) / GRAVITY))) vc.tap('X');
        }
      }
    }
    // Easy CPUs dawdle now and then.
    if (think && Math.random() < sk.mistake * 0.5) b.wait = 250 + Math.random() * 350;
    if (b.wait && b.wait > 0) {
      b.wait -= dt;
      move *= 0.3;
    }
    vc.setMove(move, 0);
  }

  /** A thrown parcel shouldn't land inside a hazard. */
  private landingClear(x: number): boolean {
    if (x >= GOAL_X + 100) return false;
    return !this.course.some((o) => o.kind !== 'spring' && x > o.x0 - 20 && x < o.x1 + 20);
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.runners.map((r) => ({ slot: r.p.slot, ...raceScore({ finished: r.finished, doneAt: r.p.doneAt ?? 0, x: r.x, carrying: r.carrying }) }));
  }
}

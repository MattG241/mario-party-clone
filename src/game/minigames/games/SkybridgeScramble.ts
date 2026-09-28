import Phaser from 'phaser';
import { audio } from '../../audio/AudioManager';
import { Character } from '../../characters/Character';
import { CSS, GAME_WIDTH } from '../../constants';
import { CHARACTER_ANIMATIONS } from '../../characters/CharacterAnimations';
import { CHARACTERS } from '../../data/characters';
import { NPC_ATLAS, npcFrame, type NpcId } from '../../data/npcs';
import type { VirtualControls } from '../../input/PlayerInput';
import { LITE } from '../../perf';
import { settings } from '../../save/SettingsManager';
import { addText } from '../../ui/theme';
import { centerOrigin, standOrigin } from '../../util/spriteUtil';
import { BaseMinigame, type MgPlayer } from '../BaseMinigame';
import { drift, separate, steer, type Mover } from '../common';
import { banner, kick } from '../juice';
import { AFX, burst, ensureArenaFxTextures, every, RingPool, Spray } from './arenaFx';
import {
  buildPattern,
  COLS,
  findRoute,
  GRID_CX,
  GRID_CY,
  GRID_H,
  GRID_W,
  GRID_X0,
  GRID_Y0,
  guardPattern,
  nearestTile,
  PITCH_Y,
  ROWS,
  supportingTile,
  TILE_COUNT,
  TILE_H,
  TILE_W,
  tileCentre,
  Y_SPEED,
  type PatternKind,
} from './skybridgeScrambleLogic';

// Layout constants (grid centre, tile size, gaps) live in skybridgeScrambleLogic.ts.

// --- Art contract ------------------------------------------------------------------------------
/**
 * Optional pre-rendered tile (scripts/art/mg_arenas.py `sky_tile`): 210×120 px top face with its
 * thickness hanging below, anchored at the centre of the top face. The anchor/scale in
 * 'rendered-mg-sprites' (mg/sprites.json, entry "sky_tile") win over these defaults.
 */
const TILE_ART = { key: 'rendered-mg-sky-tile', meta: 'sky_tile', ox: 0.5, oy: 80 / 190 };
/** Optional distant islets drifting in the sky (shared with the board backdrop). */
const ISLET_KEYS = ['rendered-islet-0', 'rendered-islet-1', 'rendered-islet-2'];
const SKY_KEY = 'rendered-sky-day';
/** Procedural fallback textures (generated once, shared by every run). */
const TEX_TILE = 'skybridge-tile';
const TEX_CRACK = 'skybridge-crack';
const TEX_CLOUD = 'skybridge-cloud';
const CLOUD_VARIANTS = 3;
/** A distant bird (two wing frames), and a soft red vignette for sudden death. */
const TEX_BIRD = 'skybridge-bird';
const TEX_VIGNETTE = 'skybridge-vignette';
/** Fallback tile texture: padding around the top face, visible thickness, underside. */
const TILE_PAD = 12;
const TILE_THICK = 30;
const TILE_TEX_W = TILE_W + TILE_PAD * 2;
const TILE_TEX_H = TILE_PAD + TILE_H + TILE_THICK + 44;
/** Slight colour variation between tiles so the grid doesn't look stamped. */
const TILE_TINTS = [0xffffff, 0xf7efe6, 0xfff5ea, 0xf2ebe4, 0xfffaf2];

// --- Depth bands -------------------------------------------------------------------------------
const DEPTH_CLOUD_FAR = -80;
const DEPTH_CLOUD_BELOW = 40;
const DEPTH_TILE_SHADOW = 90;
/** Tile rows are drawn back to front: row r sits at DEPTH_TILE + r * DEPTH_ROW. */
const DEPTH_TILE = 100;
const DEPTH_ROW = 10;
const DEPTH_PLAYER = 1000;
const DEPTH_CLOUD_FRONT = 4000;
/** Splinters, dust and landing puffs: over every tile row, under the players. */
const DEPTH_FX = DEPTH_TILE + ROWS * DEPTH_ROW + 5;
const RAD = 180 / Math.PI;
const WOOD_TINTS = [0xb07a44, 0x8e5a2b, 0xd9a066, 0x6e4420];
/** Lifespans of the dribble off a shaking platform (fixed, so the bursts allocate nothing). */
const LIFE_DRIBBLE: [number, number] = [380, 520];
const LIFE_SPLINTER: [number, number] = [420, 600];
/** Cool blue-grey for rings on the cloud sea (white alone vanishes against the clouds). */
const CLOUD_PUFF = 0x9fb4d8;

// --- Timing ------------------------------------------------------------------------------------
const WARN_MS = 1200;
/** The warning shortens a little as the round escalates (down to WARN_MS - this). */
const WARN_SQUEEZE_MS = 180;
/** Visual drop (the tile stops being walkable the moment it starts to fall). */
const DROP_MS = 620;
const RISE_MS = 700;
/** A ghost outline shows where a tile will float back up for this long before it rises. */
const GHOST_MS = 750;
const CAP_MS = 90000;
/** Escalation: when each pattern family starts, and the banner announcing it. */
const PHASES: { at: number; kind: Phase; banner?: string; color?: string }[] = [
  { at: 0, kind: 'random' },
  { at: 10000, kind: 'lines', banner: 'ROWS & COLUMNS!' },
  { at: 22000, kind: 'checker', banner: 'CHECKERBOARD!' },
  { at: 36000, kind: 'wave', banner: 'HERE COMES THE WAVE!' },
  { at: 52000, kind: 'frenzy', banner: 'SUDDEN DEATH!', color: CSS.coral },
];
/** The late game (from the wave to sudden death) ramps up shaking and wind, 0 → 1. */
const LATE_FROM = 36000;
const LATE_TO = 58000;

// --- Players -----------------------------------------------------------------------------------
const CHAR_SCALE = 0.56;
const MOVE_SPEED = 420;
const JUMP_V = 880;
const GRAVITY = 2850;
const COYOTE_MS = 90;
const BUFFER_MS = 110;
const LIVES = 3;
const RESPAWN_MS = 1500;
const INVULN_MS = 1600;
const DROP_IN_Z = 520;
const BUMP_DIST = 66;
const BUMP_MIN_SPEED = 150;

type Phase = 'random' | 'lines' | 'checker' | 'wave' | 'frenzy';
type TileState = 'solid' | 'warn' | 'falling' | 'gone' | 'rising';

interface Tile {
  i: number;
  c: number;
  r: number;
  /** Centre of the top face. */
  x: number;
  y: number;
  state: TileState;
  /** Time left in the current state (ms). */
  t: number;
  /** Length of this tile's current warning (ms). */
  warnMs: number;
  /** Milliseconds until the tile starts to shake (-1 = not scheduled). */
  due: number;
  /** How long it stays down once it has dropped. */
  downMs: number;
  /** Highlighted as a refuge while a wave rolls (for spareT more ms). */
  spare: boolean;
  spareT: number;
  img: Phaser.GameObjects.Image;
  crack: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** Shake offset this frame (the warning outline follows it). */
  ox: number;
  oy: number;
  crackStage: number;
  seed: number;
  /** Subtle per-tile colour variation (restored after the warning flash). */
  tint: number;
  /** Display scale of the tile sprite (rendered art may be scaled). */
  base: number;
  /** Springy dip after someone lands on it: ms since the landing (-1 = still), its depth in px. */
  dipT: number;
  dipA: number;
  /** Current dip offset (px), shared with whoever stands on it. */
  dy: number;
  /** Countdown to the next dribble of dust while it shakes. */
  dustT: number;
}

interface Hopper extends Mover {
  p: MgPlayer;
  c: Character;
  z: number;
  vz: number;
  lives: number;
  state: 'play' | 'falling' | 'out';
  fallT: number;
  invuln: number;
  /** Time spent grounded without support (a short grace lets a late jump still save you). */
  coyote: number;
  buffer: number;
  bumpT: number;
  supported: boolean;
  markerY: number;
  ring?: Phaser.GameObjects.GameObject & { setVisible(v: boolean): unknown };
  cushion: Phaser.GameObjects.Image;
  /** CPU route: tile indices still to visit. */
  route: number[];
  /** CPU call at the current edge (-1 undecided, 0 blunder, 1 handle it). */
  edge: number;
  /** CPU has noticed its tile is no longer safe. */
  alarmed: boolean;
  idle: { x: number; y: number };
  /** Tile underfoot (-1 over a gap): the character rides its dip. */
  tile: number;
  /** Countdown to the next speed line (long jumps, falls). */
  trailT: number;
}

// --- Procedural fallback art -------------------------------------------------------------------

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A short length of lashing rope with twisted strands. */
function rope(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w = 5): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5a3f1c';
  ctx.lineWidth = w + 2.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = '#e6cf92';
  ctx.lineWidth = w;
  ctx.stroke();
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (x2 - x1) / len;
  const ny = (y2 - y1) / len;
  ctx.strokeStyle = 'rgba(120,84,40,0.8)';
  ctx.lineWidth = 1.4;
  for (let d = 3; d < len - 2; d += 4) {
    const px = x1 + nx * d;
    const py = y1 + ny * d;
    ctx.beginPath();
    ctx.moveTo(px - ny * w * 0.45 - nx * 1.5, py + nx * w * 0.45 - ny * 1.5);
    ctx.lineTo(px + ny * w * 0.45 + nx * 1.5, py - nx * w * 0.45 + ny * 1.5);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,248,220,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x1 - ny * w * 0.25, y1 + nx * w * 0.25 - 1);
  ctx.lineTo(x2 - ny * w * 0.25, y2 + nx * w * 0.25 - 1);
  ctx.stroke();
}

/** Floating wooden platform: planked top in a rim, rope lashings, a visible thickness and underside. */
function paintTile(ctx: CanvasRenderingContext2D): void {
  const x0 = TILE_PAD;
  const y0 = TILE_PAD;
  const W = TILE_W;
  const H = TILE_H;
  const T = TILE_THICK;
  // The deck's side tapers towards the bottom so neighbouring rows read as separate rafts.
  const taper = 20;
  // Soft shadow under the platform (ambient occlusion onto the air below).
  ctx.save();
  ctx.filter = 'blur(8px)';
  ctx.fillStyle = 'rgba(24,44,78,0.3)';
  roundRectPath(ctx, x0 + 24, y0 + H + 2, W - 48, T + 24, 16);
  ctx.fill();
  ctx.restore();
  // Two cross logs underneath (their round ends peek out below the side) and a dangling rope.
  for (const lx of [x0 + 50, x0 + W - 50]) {
    const ly = y0 + H + T + 1;
    ctx.fillStyle = '#2f1b0a';
    ctx.beginPath();
    ctx.ellipse(lx, ly, 14, 11.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(lx - 3, ly - 3, 1, lx, ly, 12);
    g.addColorStop(0, '#c08a5a');
    g.addColorStop(1, '#6e4420');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 11, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,40,16,0.7)';
    ctx.lineWidth = 1.2;
    for (const rr of [3.2, 6.5]) {
      ctx.beginPath();
      ctx.ellipse(lx, ly, rr, rr * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  rope(ctx, x0 + W / 2 + 6, y0 + H + T - 6, x0 + W / 2 + 9, y0 + H + T + 18, 4);
  ctx.fillStyle = '#d9bf7f';
  ctx.beginPath();
  ctx.arc(x0 + W / 2 + 9, y0 + H + T + 20, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // Side (thickness): a shadowed band that narrows towards the bottom.
  const fg = ctx.createLinearGradient(0, y0 + H - 8, 0, y0 + H + T);
  fg.addColorStop(0, '#7d4f27');
  fg.addColorStop(0.45, '#573417');
  fg.addColorStop(1, '#2c1706');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(x0 + 2, y0 + H - 14);
  ctx.lineTo(x0 + W - 2, y0 + H - 14);
  ctx.lineTo(x0 + W - 2, y0 + H - 2);
  ctx.quadraticCurveTo(x0 + W - 4, y0 + H + T * 0.55, x0 + W - taper, y0 + H + T);
  ctx.lineTo(x0 + taper, y0 + H + T);
  ctx.quadraticCurveTo(x0 + 4, y0 + H + T * 0.55, x0 + 2, y0 + H - 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,10,2,0.35)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    const gy = y0 + H + 4 + k * 5.5;
    const inset = 8 + k * 4;
    ctx.beginPath();
    ctx.moveTo(x0 + inset, gy);
    ctx.bezierCurveTo(x0 + W * 0.35, gy + 2, x0 + W * 0.6, gy - 1.5, x0 + W - inset, gy + 1);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,214,160,0.35)';
  ctx.fillRect(x0 + 8, y0 + H + 0.5, W - 16, 1.5);
  // Top face: rim frame, then five planks inset in it.
  const rim = 9;
  const tg = ctx.createLinearGradient(0, y0, 0, y0 + H);
  tg.addColorStop(0, '#8e5a2b');
  tg.addColorStop(1, '#a86d37');
  ctx.fillStyle = tg;
  roundRectPath(ctx, x0, y0, W, H, 11);
  ctx.fill();
  const planks = 5;
  const ph = (H - rim * 2) / planks;
  const tones = ['#d9a066', '#cf955a', '#dca870', '#c98d52', '#d69d62'];
  for (let k = 0; k < planks; k++) {
    const py = y0 + rim + k * ph;
    const px = x0 + rim;
    const pw = W - rim * 2;
    const g = ctx.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, tones[k]);
    g.addColorStop(1, '#b77b43');
    ctx.fillStyle = g;
    roundRectPath(ctx, px, py + 0.8, pw, ph - 1.6, 3);
    ctx.fill();
    // Grain
    ctx.strokeStyle = 'rgba(112,64,26,0.32)';
    ctx.lineWidth = 1;
    for (let gI = 0; gI < 3; gI++) {
      const gy = py + 4 + gI * (ph - 8) / 2;
      ctx.beginPath();
      ctx.moveTo(px + 4, gy);
      ctx.bezierCurveTo(px + pw * 0.3, gy + (gI - 1) * 2 + 1.5, px + pw * 0.65, gy - 1.5, px + pw - 4, gy + 0.5);
      ctx.stroke();
    }
    if (k % 2 === 0) {
      ctx.strokeStyle = 'rgba(96,52,20,0.5)';
      ctx.beginPath();
      ctx.ellipse(px + pw * (0.3 + k * 0.1), py + ph / 2, 5, 2.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Highlight on the top edge, shadow on the bottom edge of each plank.
    ctx.fillStyle = 'rgba(255,236,200,0.4)';
    ctx.fillRect(px + 3, py + 1.5, pw - 6, 1.6);
    ctx.fillStyle = 'rgba(70,36,12,0.45)';
    ctx.fillRect(px + 2, py + ph - 2.2, pw - 4, 1.8);
    // Nails
    for (const nx of [px + 9, px + pw - 9]) {
      ctx.fillStyle = '#4b3423';
      ctx.beginPath();
      ctx.arc(nx, py + ph / 2, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,210,0.7)';
      ctx.beginPath();
      ctx.arc(nx - 0.7, py + ph / 2 - 0.8, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Soft inner shade towards the rim gives the deck some form.
  const vg = ctx.createRadialGradient(x0 + W * 0.45, y0 + H * 0.4, H * 0.3, x0 + W / 2, y0 + H / 2, W * 0.62);
  vg.addColorStop(0, 'rgba(255,240,210,0.08)');
  vg.addColorStop(1, 'rgba(60,28,8,0.22)');
  ctx.fillStyle = vg;
  roundRectPath(ctx, x0 + rim, y0 + rim, W - rim * 2, H - rim * 2, 4);
  ctx.fill();
  // Rim highlights: bright along the back edge, a soft lip along the front edge.
  ctx.strokeStyle = 'rgba(255,226,180,0.55)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, x0 + 1.5, y0 + 1.5, W - 3, H - 3, 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(58,30,10,0.55)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x0 + rim - 1, y0 + rim - 1, W - rim * 2 + 2, H - rim * 2 + 2, 4);
  ctx.stroke();
  // Rope lashings: an X over each corner, plus wraps down the front corners.
  const lash = (cx: number, cy: number) => {
    rope(ctx, cx - 9, cy - 7, cx + 9, cy + 7, 4.5);
    rope(ctx, cx + 9, cy - 7, cx - 9, cy + 7, 4.5);
  };
  lash(x0 + 13, y0 + 12);
  lash(x0 + W - 13, y0 + 12);
  lash(x0 + 13, y0 + H - 12);
  lash(x0 + W - 13, y0 + H - 12);
  // One wrap over the front lip at each corner (short, so rows don't visually join up).
  for (const wx of [x0 + 18, x0 + W - 18]) rope(ctx, wx, y0 + H - 6, wx + (wx < x0 + W / 2 ? 3 : -3), y0 + H + 12, 5);
}

/** Splintered cracks across the top face (overlay, faded in while a tile shakes). */
function paintCracks(ctx: CanvasRenderingContext2D): void {
  const cx = TILE_PAD + TILE_W * 0.52;
  const cy = TILE_PAD + TILE_H * 0.46;
  const branches: [number, number][][] = [
    [
      [0, 0],
      [-18, -8],
      [-34, -5],
      [-52, -16],
      [-78, -14],
      [-92, -28],
    ],
    [
      [0, 0],
      [16, 6],
      [34, 2],
      [48, 14],
      [70, 12],
      [90, 26],
    ],
    [
      [0, 0],
      [6, -14],
      [-2, -26],
      [8, -42],
    ],
    [
      [0, 0],
      [-8, 14],
      [2, 26],
      [-6, 40],
    ],
    [
      [34, 2],
      [44, -12],
      [60, -18],
    ],
    [
      [-52, -16],
      [-60, 2],
      [-74, 10],
    ],
  ];
  for (const pass of [0, 1]) {
    for (const b of branches) {
      ctx.beginPath();
      b.forEach(([dx, dy], k) => {
        const px = cx + dx + (pass ? 0.8 : 0);
        const py = cy + dy + (pass ? 1.2 : 0);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = pass ? 'rgba(255,226,180,0.75)' : '#2e1706';
      ctx.lineWidth = pass ? 1.1 : 3.4;
      ctx.stroke();
    }
  }
  // Splinter chips around the crack centre.
  ctx.fillStyle = '#f1c98e';
  for (const [dx, dy] of [
    [-10, -3],
    [12, 9],
    [3, -18],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy + dy);
    ctx.lineTo(cx + dx + 5, cy + dy + 1.5);
    ctx.lineTo(cx + dx + 1, cy + dy + 3.5);
    ctx.closePath();
    ctx.fill();
  }
}

/** A puffy cumulus cloud with a cool shaded underside. */
function paintCloud(ctx: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const puffs: [number, number, number][] = [
    [
      [0.18, 0.62, 0.2],
      [0.34, 0.45, 0.26],
      [0.52, 0.38, 0.3],
      [0.7, 0.48, 0.24],
      [0.84, 0.62, 0.17],
      [0.5, 0.66, 0.28],
    ],
    [
      [0.14, 0.66, 0.16],
      [0.3, 0.52, 0.22],
      [0.47, 0.46, 0.25],
      [0.64, 0.4, 0.27],
      [0.8, 0.55, 0.2],
      [0.55, 0.68, 0.25],
    ],
    [
      [0.2, 0.6, 0.22],
      [0.4, 0.42, 0.28],
      [0.62, 0.5, 0.25],
      [0.8, 0.64, 0.17],
      [0.45, 0.68, 0.24],
    ],
  ][variant % 3].map(([x, y, r]) => [x * w, y * h, r * w * 0.62] as [number, number, number]);
  ctx.save();
  ctx.filter = 'blur(1.5px)';
  // Underside shade first, then the lit puffs over it, offset up.
  ctx.fillStyle = 'rgba(150,172,214,0.95)';
  for (const [x, y, r] of puffs) {
    ctx.beginPath();
    ctx.arc(x, y + r * 0.12, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y, r] of puffs) {
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(240,246,255,1)');
    g.addColorStop(1, 'rgba(206,220,246,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.06, r * 0.93, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Flatten the bottom a little so it sits on an invisible horizon.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, h * 0.78, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.globalCompositeOperation = 'source-over';
}

/** A far-off bird in two frames side by side: wings up (0–32) and wings down (32–64). */
function paintBirds(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(38,50,80,0.92)';
  ctx.fillStyle = 'rgba(38,50,80,0.92)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (const [ox, up] of [
    [0, true],
    [32, false],
  ] as const) {
    ctx.beginPath();
    if (up) {
      ctx.moveTo(ox + 3, 4);
      ctx.quadraticCurveTo(ox + 9, 2, ox + 16, 9);
      ctx.quadraticCurveTo(ox + 23, 2, ox + 29, 4);
    } else {
      ctx.moveTo(ox + 4, 13);
      ctx.quadraticCurveTo(ox + 10, 6, ox + 16, 8);
      ctx.quadraticCurveTo(ox + 22, 6, ox + 28, 13);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(ox + 16, 9, 2.6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** White at the edges, clear in the middle (tinted red for sudden death). */
function paintVignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(80, 45, 26, 80, 45, 94);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.62)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 160, 90);
}

function ensureTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    paint(tex.getContext());
    tex.refresh();
  };
  make(TEX_TILE, TILE_TEX_W, TILE_TEX_H, paintTile);
  make(TEX_CRACK, TILE_TEX_W, TILE_TEX_H, paintCracks);
  for (let v = 0; v < CLOUD_VARIANTS; v++) make(`${TEX_CLOUD}-${v}`, 460, 190, (ctx) => paintCloud(ctx, 460, 190, v));
  if (!LITE) make(TEX_VIGNETTE, 160, 90, paintVignette);
  if (!scene.textures.exists(TEX_BIRD)) {
    const tex = scene.textures.createCanvas(TEX_BIRD, 64, 16);
    if (tex) {
      paintBirds(tex.getContext());
      tex.refresh();
      tex.add('up', 0, 0, 0, 32, 16);
      tex.add('down', 0, 32, 0, 32, 16);
    }
  }
}

interface Drifter {
  img: Phaser.GameObjects.Image;
  speed: number;
  w: number;
}

/** A wind streak rushing past within a band of the sky. */
interface Streak {
  img: Phaser.GameObjects.Image;
  speed: number;
  y0: number;
  y1: number;
}

/** A cloud that swells up and fades where something plunges into the cloud sea. */
interface Billow {
  img: Phaser.GameObjects.Image;
  t: number;
  life: number;
  s0: number;
  s1: number;
  y: number;
}

/**
 * Skybridge Scramble — a grid of floating wooden platforms high above the clouds. Tiles shake,
 * crack and drop away in escalating patterns (random tiles, rows and columns, checkerboards, a
 * rolling wave), then float back up. Jump the gaps, don't get bumped off; three falls and you're out.
 */
export class SkybridgeScrambleScene extends BaseMinigame {
  private tiles: Tile[] = [];
  private hoppers: Hopper[] = [];
  private rowG: Phaser.GameObjects.Graphics[] = [];
  private drifters: Drifter[] = [];
  private streaks: Streak[] = [];
  private countdown!: Phaser.GameObjects.Text;
  private phaseBanner: Phaser.GameObjects.Text | null = null;
  private rings!: RingPool;
  private chips!: Spray;
  private dust!: Spray;
  /** Speed lines behind long jumps (over the tiles) and around falling players (at their depth). */
  private jumpLines!: Spray;
  private fallLines!: Spray;
  /** A little flock that crosses the far sky now and then. */
  private birds: Phaser.GameObjects.Image[] = [];
  private flock = { on: false, t: 6000, x: 0, y: 0, dir: -1 };
  /** Red-edged vignette that creeps in for sudden death (Full graphics only). */
  private dread: Phaser.GameObjects.Image | null = null;
  private dreadK = 0;
  /** Cloud puffs under falling tiles are rationed, so a whole wave dropping stays readable. */
  private puffs = 3;
  private puffT = 0;
  private billows: Billow[] = [];
  private nextPatternIn = 0;
  private phaseIndex = 0;
  private lastKind: PatternKind = 'random';
  /** Phase whose signature pattern has already been played. */
  private openedPhase = -1;
  private celebrated = false;

  constructor() {
    super('mg-skybridge-scramble');
  }

  protected createArena(): void {
    this.duration = 0;
    this.tiles = [];
    this.hoppers = [];
    this.rowG = [];
    this.drifters = [];
    this.streaks = [];
    this.nextPatternIn = 1600;
    this.phaseIndex = 0;
    this.lastKind = 'random';
    this.openedPhase = -1;
    this.celebrated = false;
    this.phaseBanner = null;
    this.birds = [];
    this.flock = { on: false, t: 6000, x: 0, y: 0, dir: -1 };
    this.dread = null;
    this.dreadK = 0;
    this.puffs = 3;
    this.puffT = 0;
    this.billows = [];
    ensureTextures(this);
    ensureArenaFxTextures(this);
    // Sky, then layered clouds drifting far below the platforms.
    if (this.textures.exists(SKY_KEY)) this.add.image(GAME_WIDTH / 2, 540, SKY_KEY).setDisplaySize(GAME_WIDTH * 1.04, 1124).setDepth(-100);
    else this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, 1080).setDepth(-100);
    this.buildClouds();
    this.buildGrandstands();
    // Soft shadow of the whole platform field on the cloud sea (key light from the front-left).
    this.add.image(GRID_CX + 40, GRID_Y0 + GRID_H + 150, 'fx-shadow').setDisplaySize(GRID_W * 1.15, 300).setAlpha(0.28).setDepth(DEPTH_CLOUD_BELOW + 5);
    const rendered = this.textures.exists(TILE_ART.key);
    for (let i = 0; i < TILE_COUNT; i++) {
      const { x, y } = tileCentre(i);
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const depth = DEPTH_TILE + r * DEPTH_ROW;
      const img = this.placeTile(this.add.image(x, y, rendered ? TILE_ART.key : TEX_TILE), rendered).setDepth(depth);
      const crack = this.placeTile(this.add.image(x, y, TEX_CRACK), false).setDepth(depth + 1).setAlpha(0);
      const shadow = this.add
        .image(x + 18, y + TILE_H / 2 + 46, 'fx-shadow')
        .setDisplaySize(TILE_W * 1.05, 70)
        .setAlpha(0.22)
        .setDepth(DEPTH_TILE_SHADOW);
      const tint = TILE_TINTS[(i * 7 + r * 3) % TILE_TINTS.length];
      img.setTint(tint);
      this.tiles.push({
        i,
        c,
        r,
        x,
        y,
        state: 'solid',
        t: 0,
        warnMs: WARN_MS,
        due: -1,
        downMs: 3000,
        spare: false,
        spareT: 0,
        img,
        crack,
        shadow,
        ox: 0,
        oy: 0,
        crackStage: 0,
        seed: i * 1.7,
        tint,
        base: img.scaleX,
        dipT: -1,
        dipA: 0,
        dy: 0,
        dustT: 0,
      });
    }
    for (let r = 0; r < ROWS; r++) this.rowG.push(this.add.graphics().setDepth(DEPTH_TILE + r * DEPTH_ROW + 3));
    this.countdown = addText(this, GAME_WIDTH / 2, 170, '', 64, { color: CSS.cream, stroke: '#1b1530', strokeThickness: 9, weight: 700, fixed: true })
      .setDepth(9000)
      .setVisible(false);
    this.buildFx();
  }

  /** Pooled splinters, dust, rings and speed lines, the far-off flock and the sudden-death vignette. */
  private buildFx(): void {
    this.rings = new RingPool(this, 10);
    this.chips = new Spray(this, AFX.chip, {
      depth: DEPTH_FX,
      reserve: burst(120),
      lifespan: [650, 950],
      gravity: 1500,
      scale: { start: 1.6, end: 1.1 },
      alpha: { start: 1, end: 0 },
      tint: WOOD_TINTS,
      spin: 0.035,
    });
    this.dust = new Spray(this, 'fx-dot', {
      depth: DEPTH_FX,
      reserve: burst(100),
      lifespan: [420, 650],
      gravity: 240,
      scale: { start: 0.8, end: 2 },
      alpha: { start: 0.85, end: 0 },
      tint: [0xfff1dc, 0xf1dfc2, 0xffffff],
    });
    // Speed lines mostly cross the white cloud sea, so they are a cool blue-grey, not white.
    const lines = { reserve: burst(32), lifespan: [170, 260] as [number, number], scale: { start: 1.25, end: 0.5 }, alpha: { start: 0.95, end: 0 }, tint: [0x8ea8d6, 0xa9bde2], align: true };
    this.jumpLines = new Spray(this, AFX.streak, { depth: DEPTH_PLAYER - 1, ...lines });
    this.fallLines = new Spray(this, AFX.streak, { depth: DEPTH_TILE - 2, ...lines });
    for (let i = 0; i < (LITE ? 3 : 5); i++) this.birds.push(this.add.image(0, 0, TEX_BIRD, 'up').setVisible(false).setDepth(DEPTH_CLOUD_FAR + 2));
    // Billows reuse the sky's own cloud art, so a plunge looks like the cloud sea churning.
    for (let i = 0; i < (LITE ? 3 : 5); i++) {
      const img = this.add.image(0, 0, `${TEX_CLOUD}-${i % CLOUD_VARIANTS}`).setVisible(false).setDepth(DEPTH_CLOUD_FRONT + 1);
      this.billows.push({ img, t: 1, life: 1, s0: 0, s1: 0, y: 0 });
    }
    if (!LITE) this.dread = this.add.image(GAME_WIDTH / 2, 540, TEX_VIGNETTE).setDisplaySize(GAME_WIDTH, 1080).setTint(0xff3a1e).setAlpha(0).setDepth(8900);
  }

  /** Anchor a tile sprite at the centre of its top face. */
  private placeTile(img: Phaser.GameObjects.Image, rendered: boolean): Phaser.GameObjects.Image {
    if (rendered) {
      const all = this.cache.json.get('rendered-mg-sprites') as Record<string, { anchor?: [number, number]; scale?: number }> | undefined;
      const m = all?.[TILE_ART.meta];
      img.setOrigin(m?.anchor?.[0] ?? TILE_ART.ox, m?.anchor?.[1] ?? TILE_ART.oy).setScale(1 / (m?.scale ?? 1));
    } else img.setOrigin(0.5, (TILE_PAD + TILE_H / 2) / TILE_TEX_H);
    return img;
  }

  /** Far clouds high in the sky, cloud banks under the platforms, and a front bank at the bottom. */
  /**
   * A little flower islet either side of the bridge with festival folk cheering on the players
   * (behind the platforms, in front of the cloud sea). The islet's grass top is centred at
   * (135, 191) in the 275x421 render.
   */
  private buildGrandstands(): void {
    const key = 'rendered-islet-2';
    if (!this.textures.exists(key)) return;
    const k = 1.1;
    const cy = 560;
    const crowds: [NpcId, string][][] = [
      [['mimi', 'laugh'], ['packsprout', 'cheer'], ['pipper', 'wave']],
      [['ora', 'cheer'], ['wrench', 'laugh'], ['mimi', 'happy']],
    ];
    const depth = DEPTH_CLOUD_BELOW + 12;
    [150, GAME_WIDTH - 150].forEach((cx, side) => {
      const flip = side === 1;
      this.add.image(cx, cy, key).setOrigin(135 / 275, 191 / 421).setScale(k).setFlipX(flip).setDepth(depth);
      crowds[side].forEach(([id, pose], i) => {
        const x = cx + (i - 1) * 56;
        const y = cy + [14, -12, 20][i];
        const frame = npcFrame(id, pose);
        const o = standOrigin(NPC_ATLAS, frame);
        this.add.image(x, y + 2, 'fx-contact').setScale(0.42, 0.13).setAlpha(0.45).setDepth(depth + 0.5);
        const spr = this.add.sprite(x, y, NPC_ATLAS, frame).setOrigin(o.x, o.y).setScale(0.31).setFlipX(flip).setDepth(depth + 1 + y * 0.001);
        this.tweens.add({ targets: spr, y: y - 7, duration: 380 + (i % 3) * 90, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 80 + side * 150 });
      });
    });
  }

  private buildClouds(): void {
    const layer = (count: number, depth: number, y0: number, y1: number, scale: [number, number], speed: number, alpha: number, tint: number) => {
      for (let k = 0; k < count; k++) {
        const s = scale[0] + this.rng.next() * (scale[1] - scale[0]);
        const img = this.add
          .image(this.rng.range(-200, GAME_WIDTH + 200), this.rng.range(y0, y1), `${TEX_CLOUD}-${k % CLOUD_VARIANTS}`)
          .setScale(s)
          .setAlpha(alpha)
          .setTint(tint)
          .setDepth(depth + k * 0.01)
          .setFlipX(this.rng.chance(0.5));
        this.drifters.push({ img, speed: speed * (0.8 + this.rng.next() * 0.4), w: 460 * s });
      }
    };
    // Distant islets (when the rendered ones are loaded) drift slowest of all.
    ISLET_KEYS.forEach((key, k) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image([200, 1740, 1480][k], [250, 215, 330][k], key).setScale([0.42, 0.34, 0.26][k]).setAlpha(0.92).setDepth(DEPTH_CLOUD_FAR - 5 + k * 0.01);
      this.drifters.push({ img, speed: 3 + k, w: img.displayWidth });
    });
    layer(3, DEPTH_CLOUD_FAR, 150, 330, [0.35, 0.55], 7, 0.75, 0xeef4ff);
    layer(5, DEPTH_CLOUD_BELOW, 500, 980, [0.7, 1.1], 14, 0.88, 0xf4f8ff);
    layer(3, DEPTH_CLOUD_BELOW + 10, 880, 1040, [1.1, 1.5], 20, 0.95, 0xffffff);
    layer(3, DEPTH_CLOUD_FRONT, 1085, 1140, [1.3, 1.7], 26, 0.97, 0xffffff);
    // Wind streaks rushing past sell the altitude: across the blue sky, low over the cloud sea
    // (tinted so they show against white), and a couple of faint fast ones in front for parallax.
    const band = (n: number, y0: number, y1: number, depth: number, alpha: number, tint: number, speed: number, len: number) => {
      for (let k = 0; k < n; k++) {
        const img = this.add
          .image(Math.random() * GAME_WIDTH, y0 + Math.random() * (y1 - y0), AFX.streak)
          .setDisplaySize(len * (0.7 + Math.random() * 0.6), 6)
          .setAlpha(alpha)
          .setTint(tint)
          .setDepth(depth);
        this.streaks.push({ img, speed: speed * (0.8 + Math.random() * 0.4), y0, y1 });
      }
    };
    band(LITE ? 3 : 5, 110, 470, DEPTH_CLOUD_FAR + 1, 0.55, 0xffffff, 380, 200);
    band(LITE ? 2 : 3, 870, 1040, DEPTH_CLOUD_BELOW + 11, 0.5, 0xc2d8f2, 440, 230);
    band(LITE ? 1 : 2, 180, 1000, DEPTH_CLOUD_FRONT - 1, 0.18, 0xffffff, 820, 340);
  }

  protected createPlayer(p: MgPlayer, index: number): void {
    const spots = [7, 10, 13, 16, 8, 15];
    const tile = spots[index % spots.length];
    const { x, y } = tileCentre(tile);
    const c = new Character(this, x, y, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(x > GRID_CX);
    c.setDepth(DEPTH_PLAYER + y);
    p.character = c;
    // The coloured player ring at the feet (hidden while hanging over a hole).
    const ring = c.list.find((o) => o instanceof Phaser.GameObjects.Ellipse) as Hopper['ring'];
    const cushion = this.add.image(x, y, `${TEX_CLOUD}-1`).setScale(0.26, 0.2).setVisible(false).setDepth(DEPTH_PLAYER + y - 1);
    this.hoppers.push({
      p,
      c,
      x,
      y,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      lives: LIVES,
      state: 'play',
      fallT: 0,
      invuln: 0,
      coyote: 0,
      buffer: 0,
      bumpT: 0,
      supported: true,
      markerY: c.marker?.y ?? 0,
      ring,
      cushion,
      route: [],
      edge: -1,
      alarmed: false,
      idle: { x, y },
      tile,
      trailT: 0,
    });
    p.score = LIVES;
  }

  protected override hudLabel(p: MgPlayer): string {
    const h = this.hopper(p);
    return h ? (h.lives > 0 ? `Lives ${h.lives}` : 'Out') : '';
  }

  protected override hudPips(p: MgPlayer): { filled: number; total: number } {
    return { filled: Math.max(0, this.hopper(p)?.lives ?? LIVES), total: LIVES };
  }

  private hopper(p: MgPlayer): Hopper | undefined {
    return this.hoppers.find((h) => h.p === p);
  }

  protected override onStart(): void {
    for (const h of this.hoppers) h.c.play('wave');
    audio.play('rumble', { volume: 0.35 });
  }

  // --- Tiles ------------------------------------------------------------------------------------
  private walkable(t: Tile): boolean {
    return t.state === 'solid' || t.state === 'warn';
  }

  /** Solid, not shaking and not about to: somewhere worth standing. */
  private isSafe(t: Tile): boolean {
    return t.state === 'solid' && t.due < 0;
  }

  private busy(): boolean[] {
    return this.tiles.map((t) => !this.isSafe(t));
  }

  private currentPhase(): Phase {
    let k = 0;
    for (let i = 0; i < PHASES.length; i++) if (this.elapsed >= PHASES[i].at) k = i;
    if (k !== this.phaseIndex) {
      this.phaseIndex = k;
      const b = PHASES[k].banner;
      if (b) {
        this.showBanner(b, PHASES[k].color);
        // The new pattern family follows its banner almost at once.
        this.nextPatternIn = Math.min(this.nextPatternIn, 900);
      }
    }
    return PHASES[k].kind;
  }

  private showBanner(text: string, color: string = CSS.goldLight): void {
    audio.play('eventAlert', { volume: 0.6 });
    // A new phase's call-out replaces any still on screen.
    if (this.phaseBanner?.active) {
      this.tweens.killTweensOf(this.phaseBanner);
      this.phaseBanner.destroy();
    }
    this.phaseBanner = banner(this, text, { y: 205, size: 96, color, hold: 1200 });
    if (this.phaseIndex === PHASES.length - 1) {
      // Sudden death: the whole bridge groans.
      audio.play('rumble', { volume: 0.6 });
      this.fx.shake(0.005, 500);
    }
  }

  /** How far into the late game we are: 0 before the wave, 1 by sudden death. */
  private lateness(): number {
    return Phaser.Math.Clamp((this.elapsed - LATE_FROM) / (LATE_TO - LATE_FROM), 0, 1);
  }

  /** Pick and schedule the next pattern; escalates with the phase. */
  private launchPattern(): void {
    const phase = this.currentPhase();
    const free = this.tiles.filter((t) => this.isSafe(t)).length;
    // Each family opens with its signature pattern (row, checkerboard, wave) so it reads.
    const first = this.phaseIndex !== this.openedPhase;
    const progress = Math.min(1, this.elapsed / 60000);
    let kind: PatternKind = 'random';
    let interval = 2000;
    const pick = (opts: PatternKind[]) => {
      const choices = opts.filter((k) => k !== this.lastKind || opts.length === 1);
      return this.rng.pick(choices.length ? choices : opts);
    };
    switch (phase) {
      case 'random':
        kind = 'random';
        interval = 2000 - progress * 500;
        break;
      case 'lines':
        kind = first ? 'row' : pick(['row', 'col', 'row', 'col', 'random']);
        interval = 2600;
        break;
      case 'checker':
        kind = first ? 'checker' : pick(['checker', 'rows2', 'stripes', 'cross', 'col', 'random']);
        interval = 3000;
        break;
      case 'wave':
        kind = first ? 'wave' : pick(['wave', 'checker', 'ring', 'core', 'cross', 'stripes']);
        interval = 3300;
        break;
      case 'frenzy':
        kind = pick(['wave', 'checker', 'stripes', 'rows2', 'ring', 'cross']);
        interval = 2500;
        break;
    }
    // Big patterns need a mostly intact floor; otherwise nibble at it with a few random tiles.
    const needs: Partial<Record<PatternKind, number>> = { checker: 18, wave: 20, rows2: 16, stripes: 16, ring: 20, core: 16, cross: 14 };
    if ((needs[kind] ?? 0) > free) {
      kind = 'random';
      interval = 1300;
    }
    const n = kind === 'random' ? Math.min(7, 2 + Math.floor(this.elapsed / 9000) + (phase === 'frenzy' ? 1 : 0)) : phase === 'frenzy' ? 2 : 3;
    if (first && (kind !== 'random' || this.phaseIndex === 0)) this.openedPhase = this.phaseIndex;
    const plan = buildPattern(kind, this.rng, n);
    const minSafe = phase === 'frenzy' ? 2 : Math.max(2, Math.min(3, this.alivePlayers.length - 1));
    const tiles = guardPattern(plan.tiles, this.busy(), minSafe, this.rng);
    const baseDown = 2600 + progress * 1500;
    const downMs = kind === 'wave' ? 1900 + progress * 500 : kind === 'checker' || kind === 'stripes' || kind === 'rows2' ? 2300 : baseDown;
    tiles.forEach((i) => {
      const t = this.tiles[i];
      const k = plan.tiles.indexOf(i);
      t.due = Math.max(1, plan.delays[k] ?? 0);
      t.downMs = downMs + this.rng.range(-200, 300);
    });
    if (kind === 'wave') {
      // Refuges: every tile the wave leaves standing (its spares, plus any the guard kept back).
      const until = Math.max(0, ...plan.delays) + WARN_MS + DROP_MS + 300;
      const hit = new Set(tiles);
      for (const t of this.tiles) {
        if (hit.has(t.i) || !this.isSafe(t)) continue;
        t.spare = true;
        t.spareT = until;
      }
      // The late game shakes harder.
      audio.play('rumble', { volume: 0.55 });
      this.fx.shake(0.003 + 0.003 * this.lateness(), 400);
      interval += (Math.max(0, ...plan.delays) + WARN_MS + downMs) * 0.55;
    } else if (tiles.length >= 9 || phase === 'frenzy') {
      const late = this.lateness();
      audio.play('rumble', { volume: 0.4 + 0.2 * late });
      if (late > 0) this.fx.shake(0.0015 + 0.003 * late, 320);
    }
    this.lastKind = kind;
    this.nextPatternIn = interval;
  }

  private startWarn(t: Tile): void {
    t.state = 'warn';
    t.warnMs = WARN_MS - WARN_SQUEEZE_MS * Math.min(1, this.elapsed / 60000);
    t.t = t.warnMs;
    t.crackStage = 0;
    t.dustT = 120;
    audio.play('crack', { volume: 0.3, rate: 1.1 + Math.random() * 0.2, throttleMs: 90 });
  }

  private startFall(t: Tile): void {
    t.state = 'falling';
    t.t = DROP_MS;
    t.ox = t.oy = 0;
    audio.play('crack', { volume: 0.5, rate: 0.8, throttleMs: 70 });
    audio.play('whoosh', { volume: 0.35, throttleMs: 160 });
    // One puff of splinter dust per tile (a whole wave dropping at once stays readable).
    this.fx.vfx('smoke', t.x + this.rng.range(-50, 50), t.y + TILE_H * 0.4, { scale: 0.3, duration: 480, alpha: 0.45, tint: 0xfff6e8, depth: t.img.depth + 2, dy: 36 });
    const spin = (this.rng.chance(0.5) ? -1 : 1) * this.rng.range(4, 9);
    this.tweens.add({ targets: t.img, x: t.x, y: t.y + 470, angle: spin, scale: t.base * 0.9, alpha: 0, duration: DROP_MS * 1.5, ease: 'Quad.In' });
    this.tweens.add({ targets: t.crack, x: t.x, y: t.y + 470, angle: spin, scale: 0.9, alpha: 0, duration: DROP_MS * 1.5, ease: 'Quad.In' });
    this.tweens.add({ targets: t.shadow, alpha: 0, duration: DROP_MS });
    t.dipT = -1;
    t.dy = 0;
    // Splinters burst off the rim and dust spills out underneath...
    this.chips.fire(t.x, t.y + TILE_H * 0.2, burst(9), -90, 85, 160, 430);
    this.dust.fire(t.x, t.y + TILE_H * 0.5, burst(4), 90, 70, 30, 120);
    // ...and as it fades away it punches into the cloud sea below the bridge (kept under the
    // front row, so a billow never sits on a platform).
    this.time.delayedCall(DROP_MS * 1.4, () => this.cloudPuff(t.x, Phaser.Math.Clamp(t.y + 410, 985, 1030), 0.36));
  }

  /** A burst of cloud where a platform plunges into the cloud sea (rationed: see `puffs`). */
  private cloudPuff(x: number, y: number, scale: number): void {
    if (this.puffs <= 0) return;
    this.puffs--;
    this.billow(x, y, scale * 0.4, scale, 620);
    this.rings.spawn(x, y + 16, 24, 130, { squash: 0.3, tint: CLOUD_PUFF, alpha: 0.8, ms: 560, depth: DEPTH_CLOUD_FRONT + 1 });
  }

  /** A cloud swelling from scale s0 to s1 as it fades (reuses the oldest when all are busy). */
  private billow(x: number, y: number, s0: number, s1: number, ms: number): void {
    let b = this.billows[0];
    let oldest = -1;
    for (const o of this.billows) {
      const u = o.t / o.life;
      if (u >= 1) {
        b = o;
        break;
      }
      if (u > oldest) {
        oldest = u;
        b = o;
      }
    }
    if (!b) return;
    b.t = 0;
    b.life = ms;
    b.s0 = s0;
    b.s1 = s1;
    b.y = y;
    b.img.setPosition(x, y).setScale(s0).setAlpha(1).setFlipX(Math.random() < 0.5).setVisible(true);
  }

  private updateBillows(dt: number): void {
    for (const b of this.billows) {
      if (b.t >= b.life) continue;
      b.t += dt;
      const u = Math.min(1, b.t / b.life);
      const e = 1 - (1 - u) * (1 - u) * (1 - u);
      b.img
        .setScale(b.s0 + (b.s1 - b.s0) * e)
        .setY(b.y - 26 * e)
        .setAlpha(u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55);
      if (u >= 1) b.img.setVisible(false);
    }
  }

  private startRise(t: Tile): void {
    t.state = 'rising';
    t.t = RISE_MS;
    t.spare = false;
    this.tweens.killTweensOf([t.img, t.crack]);
    t.img.setTint(t.tint).setAngle(0).setScale(t.base * 0.94).setPosition(t.x, t.y + 230).setAlpha(0);
    t.crack.setAlpha(0).setAngle(0).setScale(1).setPosition(t.x, t.y);
    this.tweens.add({ targets: t.img, y: t.y, scale: t.base, alpha: 1, duration: RISE_MS, ease: 'Back.Out' });
    this.tweens.add({ targets: t.shadow, alpha: 0.22, duration: RISE_MS });
    audio.play('whoosh', { volume: 0.18, rate: 1.4, throttleMs: 200 });
  }

  private updateTiles(dt: number): void {
    const now = this.time.now;
    const late = this.lateness();
    for (const t of this.tiles) {
      if (t.spare) {
        t.spareT -= dt;
        if (t.spareT <= 0) t.spare = false;
      }
      if (t.dipT >= 0) {
        // A landing sinks the platform a few px and it springs back (a damped bounce).
        t.dipT += dt;
        if (t.dipT > 640) {
          t.dipT = -1;
          t.dy = 0;
        } else t.dy = t.dipA * Math.exp(-t.dipT / 120) * Math.cos(t.dipT / 42);
        if (t.state === 'solid') {
          t.img.setY(t.y + t.dy);
          t.crack.setY(t.img.y);
        }
      }
      if (t.due >= 0) {
        t.due -= dt;
        if (t.due <= 0) {
          t.due = -1;
          if (t.state === 'solid') this.startWarn(t);
          else t.spare = false;
        }
      }
      switch (t.state) {
        case 'warn': {
          t.t -= dt;
          const k = 1 - Math.max(0, t.t) / t.warnMs;
          // Shake harder and flash faster as the drop approaches (and harder still late on).
          const amp = (1 + 4.5 * k) * (1 + 0.6 * late);
          t.ox = Math.sin(now * 0.07 + t.seed) * amp;
          t.oy = Math.cos(now * 0.09 + t.seed * 2) * amp * 0.35;
          t.img.setPosition(t.x + t.ox, t.y + t.oy + t.dy).setAngle(Math.sin(now * 0.05 + t.seed) * k * 1.4);
          t.crack.setPosition(t.img.x, t.img.y).setAngle(t.img.angle);
          // Dust and splinters dribble off its front lip, faster as the drop nears.
          t.dustT -= dt;
          if (t.dustT <= 0) {
            t.dustT = every(250 - 160 * k);
            const dx = t.x + (Math.random() - 0.5) * TILE_W * 0.85;
            this.dust.fire(dx, t.y + TILE_H / 2 + 4, 1, 90, 20, 20, 60, LIFE_DRIBBLE);
            if (Math.random() < 0.4 + 0.4 * k) this.chips.fire(dx, t.y + TILE_H / 2 + 2, 1, 90, 35, 30, 110, LIFE_SPLINTER);
          }
          const flash = Math.sin((t.warnMs - t.t) * (0.012 + 0.028 * k)) > 0.1;
          t.img.setTint(flash ? 0xff9f86 : 0xffe6d8);
          const stage = k < 0.3 ? 1 : k < 0.65 ? 2 : 3;
          if (stage !== t.crackStage) {
            t.crackStage = stage;
            t.crack.setAlpha(stage === 1 ? 0.35 : stage === 2 ? 0.7 : 1);
            if (stage > 1) audio.play('crack', { volume: 0.22, rate: 1.3, throttleMs: 90 });
            if (stage === 3 && this.rng.chance(0.35)) this.fx.vfx('smoke', t.x + this.rng.range(-60, 60), t.y + TILE_H * 0.45, { scale: 0.15, duration: 320, alpha: 0.5, tint: 0xfff1dc, depth: t.img.depth + 2 });
          }
          if (t.t <= 0) this.startFall(t);
          break;
        }
        case 'falling':
          t.t -= dt;
          if (t.t <= 0) {
            t.state = 'gone';
            t.t = t.downMs;
          }
          break;
        case 'gone':
          t.t -= dt;
          if (t.t <= 0) this.startRise(t);
          break;
        case 'rising':
          t.t -= dt;
          if (t.t <= 0) {
            t.state = 'solid';
            t.img.setPosition(t.x, t.y).setScale(t.base).setAlpha(1);
            audio.play('pop', { volume: 0.2, rate: 0.7, throttleMs: 120 });
            // Wisps of cloud shaken loose as it settles.
            for (const dx of [-55, 55]) this.fx.vfx('smoke', t.x + dx, t.y + TILE_H * 0.55, { scale: 0.22, duration: 420, alpha: 0.35, blend: 'add', depth: t.img.depth + 2 });
          }
          break;
        case 'solid':
          break;
      }
    }
  }

  /** Warning outlines, rising ghosts and wave refuges, one Graphics per tile row. */
  private drawTileOverlays(): void {
    const now = this.time.now;
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    for (const g of this.rowG) g.clear();
    for (const t of this.tiles) {
      const g = this.rowG[t.r];
      const x = t.x + t.ox - TILE_W / 2;
      const y = t.y + t.oy + t.dy - TILE_H / 2;
      if (t.state === 'warn') {
        const k = 1 - Math.max(0, t.t) / t.warnMs;
        g.fillStyle(0xff3b1f, 0.1 + 0.16 * k * pulse);
        g.fillRoundedRect(x + 4, y + 4, TILE_W - 8, TILE_H - 8, 10);
        g.lineStyle(5, 0xff4a2a, 0.55 + 0.45 * pulse);
        g.strokeRoundedRect(x + 2, y + 2, TILE_W - 4, TILE_H - 4, 11);
        g.lineStyle(2, 0xfff0c0, 0.5 * pulse);
        g.strokeRoundedRect(x + 8, y + 8, TILE_W - 16, TILE_H - 16, 8);
      } else if (t.state === 'gone' && t.t < GHOST_MS) {
        // Dashed outline where the tile is about to float back up.
        const a = 0.35 + 0.35 * pulse;
        g.lineStyle(3, 0xffffff, a);
        const dash = 14;
        for (let dx = 12; dx < TILE_W - 12; dx += dash * 2) {
          g.lineBetween(x + dx, y + 2, x + Math.min(TILE_W - 12, dx + dash), y + 2);
          g.lineBetween(x + dx, y + TILE_H - 2, x + Math.min(TILE_W - 12, dx + dash), y + TILE_H - 2);
        }
        for (let dy = 10; dy < TILE_H - 10; dy += dash * 2) {
          g.lineBetween(x + 2, y + dy, x + 2, y + Math.min(TILE_H - 10, dy + dash));
          g.lineBetween(x + TILE_W - 2, y + dy, x + TILE_W - 2, y + Math.min(TILE_H - 10, dy + dash));
        }
      } else if (t.spare && t.state === 'solid' && this.phase === 'playing') {
        // Wave refuge: golden glow with twinkles.
        g.fillStyle(0xffd24a, 0.1 + 0.08 * pulse);
        g.fillRoundedRect(x + 4, y + 4, TILE_W - 8, TILE_H - 8, 10);
        g.lineStyle(5, 0xffd84a, 0.65 + 0.35 * pulse);
        g.strokeRoundedRect(x + 2, y + 2, TILE_W - 4, TILE_H - 4, 11);
        for (let k = 0; k < 3; k++) {
          const a = now / 700 + k * 2.1 + t.seed;
          const sx = t.x + Math.cos(a) * TILE_W * 0.36;
          const sy = t.y + Math.sin(a * 1.3) * TILE_H * 0.3;
          const s = 5 + 3 * Math.sin(now / 150 + k);
          g.fillStyle(0xfff6c8, 0.9);
          g.fillTriangle(sx - s, sy, sx + s, sy, sx, sy - s * 1.8);
          g.fillTriangle(sx - s, sy, sx + s, sy, sx, sy + s * 1.8);
        }
      }
    }
  }

  // --- Players ----------------------------------------------------------------------------------
  private support(h: Hopper): number {
    return supportingTile(h.x, h.y, (i) => this.walkable(this.tiles[i]));
  }

  private jump(h: Hopper): void {
    const hand = CHARACTERS[h.p.characterId].handling;
    h.vz = JUMP_V * hand.jump;
    h.buffer = 0;
    h.coyote = 0;
    // A little extra carry on take-off so a running hop clears a missing tile.
    const sp = Math.hypot(h.vx, h.vy);
    if (sp > 60) {
      const boost = Math.min(1.12, (MOVE_SPEED * hand.speed * 1.02) / sp);
      if (boost > 1) {
        h.vx *= boost;
        h.vy *= boost;
      }
    }
    h.c.play('jump', { force: true });
    h.c.squash(-0.1, 120);
    audio.play('jump', { volume: 0.5, rate: 0.95 + Math.random() * 0.1 });
    if (h.supported) this.fx.vfx('dust', h.x, h.y, { scale: 0.2, duration: 280, alpha: 0.55, depth: DEPTH_PLAYER + h.y - 2 });
    this.rumble(h.p, 0.05, 0.15, 50);
  }

  private land(h: Hopper): void {
    const impact = Math.max(0, -h.vz);
    h.vz = 0;
    h.z = 0;
    const tile = this.support(h);
    if (tile >= 0 || h.invuln > 0) {
      h.c.squash(0.16, 140);
      audio.play('land', { volume: 0.35, throttleMs: 60 });
      if (tile >= 0) {
        this.fx.vfx('dust', h.x, h.y, { scale: 0.22, duration: 300, alpha: 0.6, depth: DEPTH_PLAYER + h.y - 2 });
        // The platform dips under the landing and a puff rolls out from the feet (a big one when
        // dropping back in from the sky).
        const t = this.tiles[tile];
        t.dipT = 0;
        t.dipA = Phaser.Math.Clamp(impact / 160, 2.5, 10);
        const big = impact > 1200;
        this.rings.spawn(h.x, h.y + 4, 16, big ? 120 : 76, { squash: 0.36, alpha: big ? 0.85 : 0.65, ms: big ? 480 : 360, depth: DEPTH_FX });
        this.dust.fire(h.x, h.y + 2, burst(big ? 9 : 4), -90, 85, 40, big ? 200 : 120);
        if (big) kick(this, 0, 4);
      }
      h.c.play('idle');
    } else {
      // Landed on thin air: no grace period.
      h.coyote = COYOTE_MS;
    }
  }

  private fall(h: Hopper): void {
    h.state = 'falling';
    h.fallT = 0;
    h.tile = -1;
    h.lives -= 1;
    h.p.score = h.lives;
    h.vx = h.vy = 0;
    h.route = [];
    h.cushion.setVisible(false);
    h.c.shadow?.setVisible(false);
    h.ring?.setVisible(false);
    h.c.marker?.setVisible(false);
    h.c.hold('fall');
    // The fall pose is drawn off-centre in its frame: centre the artwork over the feet.
    const fallDef = CHARACTER_ANIMATIONS[h.p.characterId].fall;
    const fo = centerOrigin(fallDef.atlas ?? CHARACTERS[h.p.characterId].atlas, fallDef.frames[0]);
    h.c.sprite.setOrigin(h.c.isFacingLeft ? 1 - fo.x : fo.x, h.c.sprite.originY);
    // Tuck behind the tile rows in front of the hole so it drops *into* the gap.
    const r = Math.floor((h.y - GRID_Y0) / PITCH_Y);
    h.c.setDepth(DEPTH_TILE + Math.max(-1, Math.min(ROWS - 1, r)) * DEPTH_ROW + 5);
    // Their speed lines share that slot, so the rows in front hide both alike.
    this.fallLines.setDepth(h.c.depth + 1);
    h.c.sprite.y = -h.z / h.c.scaleY;
    // Off the side of the grid, tumble outwards; through a hole, drop straight down.
    const dir = h.x < GRID_X0 ? -1 : h.x > GRID_X0 + GRID_W ? 1 : h.c.isFacingLeft ? -1 : 1;
    const out = h.x < GRID_X0 || h.x > GRID_X0 + GRID_W ? 70 : 20;
    this.tweens.add({ targets: h.c, y: h.y + 420, x: h.x + dir * out, scale: CHAR_SCALE * 0.3, angle: dir * 28, duration: 950, ease: 'Quad.In' });
    this.tweens.add({ targets: h.c, alpha: 0, delay: 620, duration: 330 });
    audio.play('whoosh', { volume: 0.55, rate: 0.75 });
    h.trailT = 0;
    kick(this, 0, 4);
    this.time.delayedCall(700, () => {
      // Through the cloud sea: a burst of cloud and a thump of the camera.
      const by = Math.min(1040, h.y + 360);
      audio.play('pop', { volume: 0.35, rate: 0.55 });
      const depth = DEPTH_CLOUD_FRONT + 1;
      this.billow(h.x, by, 0.22, 0.58, 760);
      if (!LITE) this.billow(h.x + (Math.random() < 0.5 ? -70 : 70), by + 18, 0.14, 0.36, 620);
      this.rings.spawn(h.x, by + 24, 30, 190, { squash: 0.3, tint: CLOUD_PUFF, alpha: 0.85, ms: 620, depth });
      kick(this, 0, 10);
    });
    // A lost life gets its "-1" here; the last one's OUT! is the base class's call.
    if (h.lives > 0) this.fx.floatText(h.x, h.y - 150, '-1', '#ff8a7a', { size: 60, stroke: '#4a1010', depth: 9000 });
    this.rumble(h.p, 0.6, 0.5, 260);
    if (h.lives <= 0) {
      h.state = 'out';
      this.eliminate(h.p);
    }
  }

  /** Drop back in from the sky onto a safe tile, briefly invulnerable. */
  private respawn(h: Hopper): boolean {
    const others = this.hoppers.filter((o) => o !== h && o.state === 'play');
    let best: Tile | null = null;
    let bestScore = -Infinity;
    for (const t of this.tiles) {
      if (!this.isSafe(t)) continue;
      const crowd = others.filter((o) => Math.abs(o.x - t.x) < TILE_W * 0.7 && Math.abs(o.y - t.y) < TILE_H * 0.7).length;
      const score = -Math.hypot(t.x - GRID_CX, (t.y - GRID_CY) * 1.8) - crowd * 400 + Math.random() * 60;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (!best) return false;
    h.state = 'play';
    h.x = best.x + this.rng.range(-30, 30);
    h.y = best.y + this.rng.range(-8, 8);
    h.vx = h.vy = 0;
    h.z = DROP_IN_Z;
    h.vz = 0;
    h.coyote = 0;
    h.buffer = 0;
    h.invuln = INVULN_MS;
    this.tweens.killTweensOf(h.c);
    h.c.setAngle(0).setScale(CHAR_SCALE).setAlpha(1).setPosition(h.x, h.y);
    h.c.shadow?.setVisible(true);
    h.ring?.setVisible(true);
    h.c.marker?.setVisible(true);
    h.c.play('jump', { force: true });
    audio.play('pop', { volume: 0.4, rate: 1.2 });
    this.fx.vfx('sparkle', h.x, h.y - 20, { scale: 0.5, duration: 500, blend: 'add', depth: DEPTH_PLAYER + h.y + 1 });
    return true;
  }

  private updateHoppers(dt: number): void {
    const s = dt / 1000;
    for (const h of this.hoppers) {
      if (h.state === 'out') continue;
      if (h.state === 'falling') {
        h.fallT += dt;
        // Speed lines stream up past them as they drop, framing the body either side (closer in as
        // they shrink into the distance).
        h.trailT -= dt;
        if (h.fallT < 820 && h.trailT <= 0) {
          h.trailT = every(50);
          const k = h.c.scaleX / CHAR_SCALE;
          const side = Math.random() < 0.5 ? -1 : 1;
          this.fallLines.fire(h.c.x + side * (40 + Math.random() * 45) * k, h.c.y - (20 + Math.random() * 130) * k, 1, -90, 0, 280, 420);
        }
        if (h.fallT >= RESPAWN_MS) this.respawn(h);
        continue;
      }
      const c = h.p.controls;
      const hand = CHARACTERS[h.p.characterId].handling;
      h.invuln = Math.max(0, h.invuln - dt);
      h.bumpT = Math.max(0, h.bumpT - dt);
      const grounded = h.z <= 0 && h.vz <= 0;
      if (c.pressed('A')) h.buffer = BUFFER_MS;
      else h.buffer = Math.max(0, h.buffer - dt);
      if (h.bumpT > 0) drift(h, dt, 4);
      else
        steer(h, c.moveX, c.moveY * Y_SPEED, dt, {
          maxSpeed: MOVE_SPEED * hand.speed,
          accel: (grounded ? 14 : 4) * hand.accel,
          friction: grounded ? 9 : 0.8,
        });
      // Keep everyone inside a generous frame (walking off the edge still drops you).
      h.x = Phaser.Math.Clamp(h.x, GRID_X0 - 70, GRID_X0 + GRID_W + 70);
      h.y = Phaser.Math.Clamp(h.y, GRID_Y0 - 50, GRID_Y0 + GRID_H + 50);
      if (!grounded || h.vz > 0) {
        h.vz -= GRAVITY * s;
        h.z += h.vz * s;
        if (h.z <= 0 && h.vz < 0) this.land(h);
      }
      const tile = this.support(h);
      h.supported = tile >= 0;
      h.tile = tile;
      // Speed lines: behind a running jump across a gap, and above a drop back in from the sky.
      h.trailT -= dt;
      if (h.trailT <= 0 && h.z > 0) {
        const sp = Math.hypot(h.vx, h.vy);
        if (!h.supported && sp > 300) {
          h.trailT = every(45);
          this.jumpLines.fire(h.x - (h.vx / sp) * 26, h.y - h.z - 30 - Math.random() * 60, 1, Math.atan2(h.vy, h.vx) * RAD, 0, 0, 20);
        } else if (h.invuln > 0 && h.vz < -700) {
          h.trailT = every(45);
          this.jumpLines.fire(h.x + (Math.random() - 0.5) * 50, h.y - h.z - 40 - Math.random() * 70, 1, -90, 0, 0, 30);
        }
      }
      if (h.z <= 0 && h.vz <= 0) {
        if (h.supported || h.invuln > 0) h.coyote = 0;
        else h.coyote += dt;
        if (h.buffer > 0 && (h.supported || h.invuln > 0 || h.coyote < COYOTE_MS)) this.jump(h);
        else if (h.coyote >= COYOTE_MS) {
          this.fall(h);
          continue;
        }
      }
    }
    // Bumping: rivals push apart, and a proper collision knocks both back a little.
    const act = this.hoppers.filter((h) => h.state === 'play');
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i];
        const b = act[j];
        if (Math.abs(a.z - b.z) > 60) continue;
        const dx = b.x - a.x;
        const dy = (b.y - a.y) * 1.6;
        const d = Math.hypot(dx, dy);
        if (d >= BUMP_DIST || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d / 1.6;
        const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const wa = CHARACTERS[a.p.characterId].handling.weight;
        const wb = CHARACTERS[b.p.characterId].handling.weight;
        separate(a, b, BUMP_DIST, wa, wb);
        if (rv > BUMP_MIN_SPEED && a.bumpT <= 0 && b.bumpT <= 0 && a.invuln <= 0 && b.invuln <= 0) {
          const impulse = Math.min(430, 150 + rv * 0.5);
          a.vx -= nx * impulse * (wb / (wa + wb)) * 2;
          a.vy -= ny * impulse * (wb / (wa + wb)) * 2;
          b.vx += nx * impulse * (wa / (wa + wb)) * 2;
          b.vy += ny * impulse * (wa / (wa + wb)) * 2;
          a.bumpT = b.bumpT = 240;
          a.c.squash(0.2, 160);
          b.c.squash(0.2, 160);
          audio.play('bounce', { volume: 0.4, throttleMs: 120 });
          this.fx.vfx('impact', (a.x + b.x) / 2, (a.y + b.y) / 2 - 70 - a.z, { scale: 0.32, duration: 240, blend: 'add', depth: DEPTH_PLAYER + Math.max(a.y, b.y) + 2 });
          if (impulse > 260) {
            // A proper shove near a drop: freeze a beat and knock the camera the way it went.
            this.hitStop(45);
            kick(this, nx * 5, ny * 5);
          }
          this.rumble(a.p, 0.3, 0.3, 120);
          this.rumble(b.p, 0.3, 0.3, 120);
        }
      }
    }
  }

  private syncHoppers(): void {
    const now = this.time.now;
    for (const h of this.hoppers) {
      if (h.state !== 'play') continue;
      const c = h.c;
      // Standing on a platform that's dipping from a landing: ride the dip.
      const dip = h.tile >= 0 && h.z <= 0 ? this.tiles[h.tile].dy : 0;
      c.setPosition(h.x, h.y + dip).setDepth(DEPTH_PLAYER + h.y);
      c.sprite.y = -h.z / c.scaleY;
      if (c.marker) c.marker.y = h.markerY - h.z / c.scaleY;
      const overFloor = h.supported;
      c.shadow?.setVisible(overFloor).setScale(1 - Math.min(0.55, h.z / 320));
      h.ring?.setVisible(overFloor || h.invuln > 0);
      c.sprite.setAlpha(h.invuln > 0 ? (Math.floor(now / 80) % 2 ? 0.45 : 1) : 1);
      const cushion = h.invuln > 0 && !overFloor && h.z < 40;
      h.cushion.setVisible(cushion);
      if (cushion) h.cushion.setPosition(h.x, h.y + 6).setDepth(DEPTH_PLAYER + h.y - 1).setScale(0.26 + 0.02 * Math.sin(now / 120), 0.2);
      if (Math.abs(h.vx) > 40) c.face(h.vx < 0);
      const grounded = h.z <= 0 && h.vz <= 0;
      if (grounded && h.bumpT <= 0) {
        const moving = Math.hypot(h.vx, h.vy) > 70;
        if (moving && c.current !== 'run' && c.current !== 'jump') c.play('run');
        else if (!moving && c.current === 'run') c.play('idle');
      }
    }
  }

  // --- Frame ------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 110;
      this.puffs = Math.min(3, this.puffs + 1);
    }
    this.nextPatternIn -= dt;
    if (this.nextPatternIn <= 0) this.launchPattern();
    else this.currentPhase();
    this.updateTiles(dt);
    this.updateHoppers(dt);
    this.syncHoppers();
    this.drawTileOverlays();
    // Safety cap: survivors share the win, ranked by lives left.
    const left = CAP_MS - this.elapsed;
    if (left <= 10000) {
      const secs = Math.ceil(left / 1000);
      if (this.countdown.text !== String(secs)) {
        this.countdown.setText(String(secs)).setVisible(true).setColor(secs <= 3 ? '#ff8a7a' : CSS.cream);
        this.tweens.add({ targets: this.countdown, scale: { from: 1.35, to: 1 }, duration: 200 });
        if (secs <= 5) audio.play('countdown', { volume: 0.45 });
      }
    }
    if (this.elapsed >= CAP_MS) this.end();
  }

  protected override ambient(dt: number): void {
    const s = dt / 1000;
    // Particles follow the minigame clock: frozen in a hit-stop, slowed in slow motion.
    const ts = this.time.timeScale;
    this.chips.sync(ts);
    this.dust.sync(ts);
    this.jumpLines.sync(ts);
    this.fallLines.sync(ts);
    this.rings.update(dt);
    this.updateBillows(dt);
    // The wind picks up in the late game.
    const late = this.lateness();
    for (const d of this.drifters) {
      d.img.x -= d.speed * s * (1 + 0.5 * late);
      if (d.img.x < -d.w / 2 - 40) d.img.x = GAME_WIDTH + d.w / 2 + 40;
    }
    for (const d of this.streaks) {
      d.img.x -= d.speed * s * (1 + 0.9 * late);
      if (d.img.x < -240) {
        d.img.x = GAME_WIDTH + 240;
        d.img.y = d.y0 + Math.random() * (d.y1 - d.y0);
      }
    }
    this.updateFlock(dt);
    if (this.dread) {
      const want = this.phase === 'playing' && this.phaseIndex === PHASES.length - 1 ? 1 : 0;
      this.dreadK += (want - this.dreadK) * Math.min(1, dt / 900);
      // A slow heartbeat of red at the edges (gentle: well under a flash; steady with Reduced Motion).
      const beat = settings.get().reducedMotion ? 0 : 0.1 * Math.sin(this.time.now / 320);
      this.dread.setAlpha(this.dreadK * (0.36 + beat));
    }
    if (this.phase !== 'playing') {
      for (const h of this.hoppers) if (h.state === 'play') h.c.setDepth(DEPTH_PLAYER + h.y);
    }
  }

  /** Now and then a little flock of birds crosses the far sky, in a loose V. */
  private updateFlock(dt: number): void {
    const f = this.flock;
    if (!f.on) {
      f.t -= dt;
      if (f.t > 0 || !this.birds.length) return;
      f.on = true;
      f.dir = Math.random() < 0.5 ? -1 : 1;
      f.x = f.dir < 0 ? GAME_WIDTH + 60 : -60;
      f.y = 150 + Math.random() * 170;
      for (const b of this.birds) b.setVisible(true);
    }
    f.x += f.dir * 95 * (dt / 1000);
    const now = this.time.now;
    for (let i = 0; i < this.birds.length; i++) {
      const rank = Math.ceil(i / 2);
      const side = i % 2 ? -1 : 1;
      this.birds[i]
        .setPosition(f.x - f.dir * rank * 34, f.y + side * rank * 16 + Math.sin(now / 420 + i) * 3)
        .setFrame(Math.sin(now / 95 + i * 1.7) > 0 ? 'up' : 'down')
        .setScale(0.9 - rank * 0.06);
    }
    if ((f.dir < 0 && f.x < -200) || (f.dir > 0 && f.x > GAME_WIDTH + 200)) {
      f.on = false;
      f.t = 14000 + Math.random() * 9000;
      for (const b of this.birds) b.setVisible(false);
    }
  }

  protected override end(): void {
    const first = !this.celebrated;
    this.celebrated = true;
    super.end();
    if (!first) return;
    for (const g of this.rowG) g.clear();
    for (const h of this.hoppers) {
      if (h.state !== 'play' || !h.p.alive) continue;
      h.c.sprite.y = 0;
      h.c.sprite.setAlpha(1);
      h.c.play('victory', { force: true });
      this.fx.confetti(h.x, h.y - 160, 50);
    }
  }

  // --- CPU ----------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const h = this.hopper(p);
    if (!h || h.state !== 'play') {
      vc.setMove(0, 0);
      return;
    }
    const sk = this.skill(p);
    const b = p.brain;
    // Noticing that the floor underfoot has turned dangerous takes a moment (reaction by skill).
    const underfoot = this.support(h);
    const danger = underfoot < 0 || !this.isSafe(this.tiles[underfoot]);
    if (danger && !h.alarmed) {
      h.alarmed = true;
      b.timer = Math.max(b.timer, sk.reaction * (0.6 + Math.random() * 0.8));
    } else if (!danger) h.alarmed = false;
    b.timer -= dt;
    if (b.timer <= 0) {
      b.timer = sk.think * (0.7 + Math.random() * 0.6);
      this.cpuPlan(h, sk);
    }
    // Follow the route: next tile centre, or idle wobble around the current tile.
    let tx = h.idle.x;
    let ty = h.idle.y;
    while (h.route.length) {
      const t = this.tiles[h.route[0]];
      if (Math.abs(h.x - t.x) < 40 && Math.abs(h.y - t.y) < 26 && h.z <= 0) {
        h.route.shift();
        if (!h.route.length) h.idle = { x: t.x + (Math.random() - 0.5) * 60, y: t.y + (Math.random() - 0.5) * 30 };
        continue;
      }
      tx = t.x;
      ty = t.y;
      break;
    }
    const dx = tx - h.x;
    const dy = ty - h.y;
    const d = Math.hypot(dx, dy);
    if (d < 12) {
      vc.setMove(0, 0);
      return;
    }
    // Stick direction that makes the (foreshortened) velocity point at the target.
    let sx = dx / d;
    let sy = dy / d / Y_SPEED;
    const m = Math.hypot(sx, sy);
    sx /= m;
    sy /= m;
    const slow = !h.route.length && d < 60 ? 0.45 : 1;
    const noise = sk.aimNoise * 0.12;
    vc.setMove((sx + (Math.random() - 0.5) * noise) * slow, (sy + (Math.random() - 0.5) * noise) * slow);
    // Edge handling: hop a gap when the far side is solid, otherwise stop short.
    const grounded = h.z <= 0 && h.vz <= 0;
    if (!grounded) return;
    const sp = Math.max(160, Math.hypot(h.vx, h.vy));
    const look = Math.max(34, sp * (dt / 1000) * 1.6);
    const ux = dx / d;
    const uy = dy / d;
    const walk = (i: number) => this.walkable(this.tiles[i]);
    const ahead = supportingTile(h.x + ux * look, h.y + uy * look * Y_SPEED, walk);
    if (!h.supported && h.coyote > 0) {
      // Floor vanished underfoot: a sharp CPU still gets a jump off (decided once).
      if (h.coyote <= dt && Math.random() < sk.accuracy * 0.8) vc.tap('A');
      return;
    }
    if (ahead < 0) {
      // One call per edge: handle it (hop or stop short), or blunder straight on.
      if (h.edge < 0) h.edge = Math.random() < sk.mistake * 0.6 ? 0 : 1;
      const reach = sp * 0.6;
      const landing = supportingTile(h.x + ux * reach, h.y + uy * reach * Y_SPEED, walk, 0);
      if (landing >= 0 && d > 50) {
        if (h.edge === 1) vc.tap('A');
      } else if (h.edge === 1) {
        vc.setMove(0, 0);
        b.timer = Math.min(b.timer, 120);
      }
    } else h.edge = -1;
  }

  /** Would a shove along (dx, dy) push this player off solid ground? */
  private byDrop(o: Hopper, dx: number, dy: number): boolean {
    const d = Math.hypot(dx, dy) || 1;
    return supportingTile(o.x + (dx / d) * 70, o.y + (dy / d) * 70 * Y_SPEED, (i) => this.walkable(this.tiles[i])) < 0;
  }

  /** Choose where to stand: stay on a safe tile, or route to the nearest one. */
  private cpuPlan(h: Hopper, sk: { mistake: number; accuracy: number; aimNoise: number }): void {
    const walk = this.tiles.map((t) => t.state === 'solid' || (t.state === 'warn' && t.t > 380) || (t.state === 'rising' && t.t < 200));
    const safe = this.tiles.map((t) => this.isSafe(t));
    let here = this.support(h);
    if (here < 0) here = nearestTile(h.x, h.y);
    if (safe[here] && !h.route.length) {
      // Safe for now. A bolder CPU sometimes goes to shove a rival who's standing by a drop.
      const aggro = sk.accuracy * (this.elapsed > 20000 ? 0.28 : 0.08);
      if (h.invuln <= 0 && Math.random() < aggro) {
        const prey = this.hoppers.find((o) => o !== h && o.state === 'play' && o.invuln <= 0 && Math.abs(o.x - h.x) < TILE_W * 1.2 && Math.abs(o.y - h.y) < TILE_H * 1.1 && this.byDrop(o, o.x - h.x, o.y - h.y));
        if (prey) {
          h.idle = { x: prey.x + Math.sign(prey.x - h.x) * 24, y: prey.y + Math.sign(prey.y - h.y) * 10 };
          return;
        }
      }
      // Otherwise sometimes shuffle towards the middle of the tile.
      if (Math.random() < 0.3) {
        const t = this.tiles[here];
        h.idle = { x: t.x + (Math.random() - 0.5) * 90, y: t.y + (Math.random() - 0.5) * 40 };
      }
      return;
    }
    if (h.route.length) {
      // Keep the current plan while its destination is still good.
      const dest = h.route[h.route.length - 1];
      const stepOk = h.route.every((i) => walk[i] || i !== h.route[0]);
      if (safe[dest] && stepOk && Math.random() > sk.mistake) return;
    }
    const others = this.hoppers.filter((o) => o !== h && o.state === 'play');
    const extra = this.tiles.map((t) => {
      const crowd = others.filter((o) => Math.abs(o.x - t.x) < TILE_W * 0.6 && Math.abs(o.y - t.y) < TILE_H * 0.6).length;
      return crowd * 90 + Math.random() * 80 * sk.aimNoise;
    });
    if (Math.random() < sk.mistake) {
      // A wrong call: wander to some neighbouring tile, safe or not.
      const nbrs = [here - 1, here + 1, here - COLS, here + COLS].filter((i) => i >= 0 && i < TILE_COUNT && walk[i] && (Math.abs((i % COLS) - (here % COLS)) <= 1));
      if (nbrs.length) {
        h.route = [nbrs[Math.floor(Math.random() * nbrs.length)]];
        return;
      }
    }
    const route = findRoute(walk, safe, here, extra);
    if (route) {
      h.route = route;
      if (!route.length) {
        const t = this.tiles[here];
        h.idle = { x: t.x, y: t.y };
      }
    } else {
      // Nowhere safe yet: head for whatever will be walkable longest.
      let best = here;
      let bestT = -1;
      this.tiles.forEach((t, i) => {
        const left = t.state === 'solid' ? (t.due < 0 ? 9999 : t.due + WARN_MS) : t.state === 'warn' ? t.t : -1;
        const dd = Math.hypot(t.x - h.x, t.y - h.y);
        if (left - dd > bestT) {
          bestT = left - dd;
          best = i;
        }
      });
      h.route = best === here ? [] : [best];
    }
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    const scores = this.eliminationScores((p) => (this.hopper(p)?.lives ?? 0) * 100);
    const survivors = this.hoppers.filter((h) => h.p.alive).length;
    return scores.map((s) => {
      const h = this.hoppers.find((x) => x.p.slot === s.slot);
      if (h && h.p.alive && survivors > 1) return { ...s, label: h.lives === 1 ? 'Survived (1 life)' : `Survived (${h.lives} lives)` };
      return s;
    });
  }
}

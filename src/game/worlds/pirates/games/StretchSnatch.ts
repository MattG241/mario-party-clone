import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, PLAYER_COLORS, PLAYER_COLORS_DARK } from '../../../constants';
import type { VirtualControls } from '../../../input/PlayerInput';
import { LITE } from '../../../perf';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { banner, kick, popToHud, punch, shockwave, titleTexture, type HudPop } from '../../../minigames/juice';
import { bakeWord, liteCount, RingBursts, WordPops } from '../../../minigames/games/stageKit';
import { calm, Crowd, finishAtlas, hasFrame, queueAtlas, startHint, thickPolyline } from '../piratesKit';
import { GullFlock, type GullHost } from './snatchGulls';
import { D_DECAL, D_FOOD, FeastTable, FOOD_R_MAX, FOOD_R_MIN, FOOD_SCALE, K, TABLE_R, TX, TY, type Food } from './snatchTable';
import {
  angleDelta,
  clampAim,
  distToSegment,
  FOOD_VALUE,
  haulPoints,
  leadTarget,
  MAX_HAUL,
  onTable,
  segmentsCross,
  serveKind,
  spinSpeed,
  tableTarget,
  type FoodKind,
  type Lead,
  type Pt,
} from './stretchSnatchRules';

// --- Layout: keep in step with scripts/art/worlds/pirates/mg_deck.py (ortho camera at 50 degrees) ------
/** Ground centre of the table (seats are placed round it) and the seats' radius. */
const GROUND_Y = 650;
const SEAT_R = 435;
/** Shoulders (where an arm starts) sit this far from the centre, on the table plane. */
const SHOULDER_R = 395;
/**
 * Seat angles (0 = east, 90 = the front) by player count, in launch order (P1 on the left). Four seats
 * sit an even 70 degrees apart, so the middle two don't have more neighbours' arms to cross than the ends.
 */
const SEATS: Record<number, number[]> = { 1: [90], 2: [180, 0], 3: [180, 90, 0], 4: [195, 125, 55, -15] };
/** The cook's feet on screen (behind the table) and where the tentacles leave the body. */
const COOK_X = 960;
const COOK_Y = 351;
const COOK_HAND = { x: 1012, y: 262 };

// --- Tuning ------------------------------------------------------------------------------------------
const REACH_SPEED = 960;
const SNAP_SPEED = 1750;
const L_MAX = 640;
const HOLD_MS = 950;
const COOL_MS = 180;
const GRAB_R = 60;
const AIM_DEV = 1.22;
const AIM_RATE = 12;
const TANGLE_MS = 900;
const BONK_MS = 650;
/** Arms float this high over the table top (screen px), so they cast a shadow onto it. */
const ARM_Z = 16;
const CHAR_SCALE = 0.62;
/** The cook's rolling-pin slam: warning, and the radius it bonks. */
const SLAM_WARN = 950;
const SLAM_R = 78;
const SLAM_LIFT = 420;
const POP_SIZE = 58;

// --- Depth bands -------------------------------------------------------------------------------------
const D_COOK = 60;
const D_TABLE = 100;
const D_ARM_SHADOW = 390;
const D_ARM = 400;
const D_FIST = 410;
const D_HELD = 415;
const D_TENTACLE = 450;
const D_CHAR = 500;
const D_GULL = 900;
const D_POP = 5600;

type ArmState = 'ready' | 'reach' | 'hold' | 'snap' | 'tangle' | 'bonk';

interface Arm {
  state: ArmState;
  aim: number;
  dirX: number;
  dirY: number;
  len: number;
  holdT: number;
  t: number;
  haul: Food[];
  knotX: number;
  knotY: number;
  wob: number;
  phase: number;
  /** Items in hand when this reach began (CPU judgement). */
  startHaul: number;
  /** A fresh press of A is waiting to launch (holding A never relaunches by itself). */
  primed: boolean;
  /** Can't tangle again for a moment after coming out of a knot. */
  safeT: number;
}

interface Snatcher {
  p: MgPlayer;
  c: Character;
  gx: number;
  gy: number;
  sx: number;
  sy: number;
  toCentre: number;
  arm: Arm;
  fist: Phaser.GameObjects.Image;
  color: number;
  dark: number;
  light: number;
  pop?: { h: HudPop; value: number };
  /** CPU: where it's aiming (its brain's target, reused). */
  aimAt: Pt;
}

type SlamState = 'idle' | 'wind' | 'drop' | 'lift';

/**
 * Stretch & Snatch (Luffy's minigame) - a feast table spins on a pirate ship's deck. Players aim a
 * stretchy rubber arm (stick), hold A to reach and let go to snap back with up to three items. Crossed
 * arms tangle and drop their haul, the octopus cook slams a rolling pin on arms left out too long, and
 * gulls swoop on full fists. Most food after 45 seconds wins.
 */
export class StretchSnatchScene extends BaseMinigame {
  private snatchers: Snatcher[] = [];
  private table!: FeastTable;
  private gulls!: GullFlock<Snatcher | Food, Food>;
  private omega = 0.42;
  private spinDir = 1;
  private flipAt = 0;
  /** Until when (scene ms) a banner is up, so two never pile onto each other. */
  private bannerUntil = 0;
  private frenzy = false;
  private serveT = 0;
  private roastAt: number[] = [];
  private slamState: SlamState = 'idle';
  private slamT = 0;
  private slamNext = 0;
  private slamX = 0;
  private slamY = 0;
  private cookMood: 'idle' | 'shout' | 'happy' = 'idle';
  private cookMoodT = 0;
  private wrapped = false;
  private hasAtlas = false;
  // display objects
  private topImg!: Phaser.GameObjects.Image;
  private armG!: Phaser.GameObjects.Graphics;
  private shadowG!: Phaser.GameObjects.Graphics;
  private guideG!: Phaser.GameObjects.Graphics;
  private decalG!: Phaser.GameObjects.Graphics;
  private tentG!: Phaser.GameObjects.Graphics;
  private cook!: Phaser.GameObjects.Image;
  private pin!: Phaser.GameObjects.Image;
  private words!: WordPops;
  private rings!: RingBursts;
  private crowd?: Crowd;
  private steam: Phaser.GameObjects.Image[] = [];
  /** Scratch space (no per-frame allocation). */
  private pts: Pt[] = Array.from({ length: 14 }, () => ({ x: 0, y: 0 }));
  private tmp: Pt = { x: 0, y: 0 };
  private tmpA: Pt = { x: 0, y: 0 };
  private tmpB: Pt = { x: 0, y: 0 };
  private lead: Lead = { x: 0, y: 0, len: 0, t: 0 };
  private bestLead: Lead = { x: 0, y: 0, len: 0, t: 0 };

  constructor() {
    super('mg-stretch-snatch');
  }

  preload(): void {
    queueAtlas(this, 'pirates-snatch', 'pirates_snatch');
  }

  // --- Arena ---------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 45000;
    this.snatchers = [];
    this.omega = spinSpeed(0, false);
    this.spinDir = 1;
    this.flipAt = 21000 + this.rng.next() * 6000;
    this.bannerUntil = 0;
    this.frenzy = false;
    this.serveT = 300;
    this.roastAt = [11500, 27000];
    this.slamState = 'idle';
    this.slamT = 0;
    this.slamNext = 5500;
    this.cookMood = 'idle';
    this.cookMoodT = 0;
    this.wrapped = false;
    this.steam = [];
    finishAtlas(this, 'pirates-snatch');
    this.hasAtlas = hasFrame(this, 'pirates-snatch', 'table');
    for (let v = 1; v <= 9; v++) titleTexture(this, `+${v}`, POP_SIZE, v >= 5 ? CSS.goldLight : '#ffffff');
    const words: [string, string, readonly [string, string]][] = [
      ['pc-w-tangle', 'TANGLE!', ['#ffe9a8', '#ff9a3c']],
      ['pc-w-bonk', 'BONK!', ['#ffd0c8', '#ff5a4a']],
      ['pc-w-squawk', 'SQUAWK!', ['#ffffff', '#b8d8ff']],
      ['pc-w-full', 'FULL HAND!', ['#fff6c0', '#ffc83a']],
      ['pc-w-yum', 'YUM!', ['#ffffff', '#ffe08a']],
      ['pc-w-bop', 'BOP!', ['#e6fbff', '#5ce1ff']],
      ['pc-w-feast', 'FEAST!', ['#fff6c0', '#ff9a3c']],
    ];
    for (const [key, text, fill] of words) bakeWord(this, key, text, { size: 54, fill });
    this.words = new WordPops(this, D_POP, 14);
    this.rings = new RingBursts(this, 14);
    this.makeGloveTexture();
    if (this.textures.exists('rendered-scene-pirates_deck')) this.add.image(0, 0, 'rendered-scene-pirates_deck').setOrigin(0).setDepth(-50);
    else this.fallbackDeck();
    // the table top spins: a straight-down render in a container squashed to the deck's view
    this.topImg = this.hasAtlas ? this.add.image(0, 0, 'pirates-snatch', 'table') : this.add.image(0, 0, this.fallbackTop());
    this.add.container(TX, TY, [this.topImg]).setScale(1, K).setDepth(D_TABLE);
    this.decalG = this.add.graphics().setDepth(D_DECAL);
    this.shadowG = this.add.graphics().setDepth(D_ARM_SHADOW);
    this.armG = this.add.graphics().setDepth(D_ARM);
    this.guideG = this.add.graphics().setDepth(D_ARM - 1);
    this.tentG = this.add.graphics().setDepth(D_TENTACLE);
    this.cook = this.hasAtlas ? this.add.image(COOK_X, COOK_Y, 'pirates-snatch', 'cook_idle') : this.add.image(COOK_X, COOK_Y - 90, 'fx-dot').setScale(9, 8).setTint(0xf07a5a);
    this.cook.setDepth(D_COOK);
    this.pin = (this.hasAtlas ? this.add.image(0, 0, 'pirates-snatch', 'pin') : this.add.image(0, 0, 'fx-dot').setScale(6, 1.6).setTint(0xe6b87a)).setDepth(D_TENTACLE + 1).setVisible(false);
    this.table = new FeastTable(this, () => this.rng.next(), this.hasAtlas, this.rings);
    this.gulls = new GullFlock(this.gullHost(), D_GULL, D_DECAL + 3);
    this.buildCrowd();
    this.buildSteam();
    // a first spread of food so nobody reaches for an empty table
    const n = tableTarget(this.players.length) - 2;
    for (let i = 0; i < n; i++) this.table.place(serveKind(this.rng.next(), this.rng.next(), 0), FOOD_R_MIN + this.rng.next() * (FOOD_R_MAX - FOOD_R_MIN), (i / n) * Math.PI * 2 + this.rng.next() * 0.5);
  }

  /** A white cartoon glove (seen from above, pointing right): the fist on the end of every arm. */
  private makeGloveTexture(): void {
    if (this.textures.exists('pc-glove')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x1b1b2a, 0.35);
    g.fillEllipse(34, 38, 52, 44);
    g.fillStyle(0x2a2233, 1);
    g.fillEllipse(32, 32, 54, 46);
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(32, 32, 48, 40);
    g.fillStyle(0xe9edf4, 1);
    g.fillEllipse(29, 36, 40, 26);
    g.lineStyle(3, 0x9aa3b8, 1);
    for (const y of [22, 30, 38]) g.lineBetween(44, y, 54, y + 1);
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(24, 16, 22, 12);
    g.generateTexture('pc-glove', 64, 64);
    g.destroy();
  }

  private fallbackTop(): string {
    const key = 'pc-top-fallback';
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xc08a56, 1);
      g.fillCircle(300, 300, 290);
      g.lineStyle(10, 0xd8a441, 1);
      g.strokeCircle(300, 300, 285);
      g.lineStyle(3, 0x8a5a34, 0.6);
      for (let x = 40; x < 600; x += 64) g.lineBetween(x, 20, x, 580);
      g.fillStyle(0xeee0c0, 1);
      g.fillCircle(300, 300, 100);
      g.fillStyle(0xe84c40, 1);
      g.fillTriangle(300, 210, 285, 300, 315, 300);
      g.generateTexture(key, 600, 600);
      g.destroy();
    }
    return key;
  }

  private fallbackDeck(): void {
    const g = this.add.graphics().setDepth(-50);
    g.fillStyle(0x1c88b3, 1);
    g.fillRect(0, 0, 1920, 200);
    g.fillStyle(0xb98a57, 1);
    g.fillRect(0, 200, 1920, 880);
    g.lineStyle(2, 0x8a5f3a, 0.6);
    for (let y = 226; y < 1080; y += 26) g.lineBetween(0, y, 1920, y);
    g.fillStyle(0x6e4426, 1);
    g.fillEllipse(TX, GROUND_Y + 10, 640, 470);
  }

  /** Festival folk visiting the ship, either side of the table (the arena keeps those spots clear). */
  private buildCrowd(): void {
    this.crowd = new Crowd(
      this,
      [
        { id: 'mimi', pose: 'happy', x: 178, y: 668, scale: 0.36 },
        { id: 'pipper', pose: 'wave', x: 262, y: 742, scale: 0.4 },
        { id: 'packsprout', pose: 'cheer', x: 168, y: 790, scale: 0.38 },
        { id: 'wrench', pose: 'laugh', x: 1742, y: 668, scale: 0.36 },
        { id: 'ora', pose: 'cheer', x: 1660, y: 742, scale: 0.4 },
        { id: 'mimi', pose: 'laugh', x: 1752, y: 790, scale: 0.38 },
      ],
      D_CHAR,
    );
  }

  /** Steam curling off the stove's pot behind the cook. */
  private buildSteam(): void {
    if (calm()) return;
    for (let i = 0; i < (LITE ? 2 : 4); i++) {
      const s = this.add.image(1122, 232, 'fx-dot').setTint(0xf4f0e8).setAlpha(0).setDepth(D_COOK - 1);
      this.steam.push(s);
      this.tweens.add({
        targets: s,
        y: { from: 232, to: 120 },
        x: { from: 1122, to: 1122 + (i % 2 ? 22 : -18) },
        scale: { from: 1.2, to: 3.4 },
        alpha: { from: 0.5, to: 0 },
        duration: 1800,
        delay: i * 450,
        repeat: -1,
      });
    }
  }

  // --- Players -------------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const deg = (SEATS[n] ?? SEATS[4])[index % 4];
    const th = (deg * Math.PI) / 180;
    const gx = TX + Math.cos(th) * SEAT_R;
    const gy = GROUND_Y + Math.sin(th) * SEAT_R * K;
    const c = new Character(this, gx, gy, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true });
    c.face(gx > TX + 5);
    c.setDepth(D_CHAR + gy * 0.01);
    p.character = c;
    const sx = Math.cos(th) * SHOULDER_R;
    const sy = Math.sin(th) * SHOULDER_R;
    const toCentre = Math.atan2(-sy, -sx);
    const color = PLAYER_COLORS[p.slot];
    const fist = this.add.image(0, 0, 'pc-glove').setDepth(D_FIST).setVisible(false);
    this.snatchers.push({
      p,
      c,
      aimAt: { x: 0, y: 0 },
      gx,
      gy,
      sx,
      sy,
      toCentre,
      arm: { state: 'ready', aim: toCentre, dirX: Math.cos(toCentre), dirY: Math.sin(toCentre), len: 0, holdT: 0, t: 0, haul: [], knotX: 0, knotY: 0, wob: 0, phase: 0, startHaul: 0, primed: false, safeT: 0 },
      fist,
      color,
      dark: PLAYER_COLORS_DARK[p.slot],
      light: Phaser.Display.Color.IntegerToColor(color).lighten(22).color,
    });
  }

  protected override onStart(): void {
    for (const s of this.snatchers) s.c.play('wave');
    this.setCookMood('happy', 900);
    audio.play('cheer', { volume: 0.45 });
    if (this.humanSlots().length) startHint(this, 'Aim with the stick, hold A to stretch \u2014 let go to snap back!', 1030);
  }

  protected override bannerY(): number {
    return 470;
  }

  protected override onFinalStretch(): void {
    this.frenzy = true;
    this.showFinalStretch('FEAST FRENZY!');
    this.bannerUntil = this.elapsed + 1900;
    this.crowd?.cheer(true);
    this.setCookMood('happy', 1200);
    this.serveT = 0;
    this.tossRoast();
    for (let i = 0; i < 4; i++) this.time.delayedCall(i * 140, () => this.toss(serveKind(this.rng.next(), this.rng.next(), 1)));
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  // --- Projection ----------------------------------------------------------------------------------
  private sx(x: number): number {
    return TX + x;
  }

  private sy(y: number, z = 0): number {
    return TY + y * K - z;
  }

  // --- Food ----------------------------------------------------------------------------------------
  /** The cook tosses an item from the galley onto a free spot of the table. */
  private toss(kind: FoodKind, spot?: { r: number; a: number }): void {
    if (!this.table.toss(kind, COOK_HAND.x + (this.rng.next() - 0.5) * 60, COOK_HAND.y, spot)) return;
    audio.play('whoosh', { volume: 0.25, rate: 1.4, throttleMs: 60 });
    if (this.cookMood === 'idle') this.setCookMood('happy', 380);
  }

  private tossRoast(): void {
    this.toss('roast', { r: 150 + this.rng.next() * 70, a: this.rng.next() * Math.PI * 2 });
    // (its own glint and landing burst say it well enough while another banner is up)
    if (this.elapsed >= this.bannerUntil) {
      banner(this, 'GOLDEN ROAST!', { y: this.bannerY(), size: 74, color: CSS.goldLight, hold: 700 });
      this.bannerUntil = this.elapsed + 1400;
    }
    audio.play('itemGet', { volume: 0.6 });
    this.setCookMood('happy', 900);
  }

  // --- The cook ------------------------------------------------------------------------------------
  private setCookMood(mood: 'idle' | 'shout' | 'happy', ms: number): void {
    this.cookMood = mood;
    this.cookMoodT = ms;
    if (this.hasAtlas) this.cook.setFrame(`cook_${mood}`);
    if (!calm()) {
      this.tweens.killTweensOf(this.cook);
      this.cook.setScale(1);
      this.tweens.add({ targets: this.cook, scaleX: { from: 1.06, to: 1 }, scaleY: { from: 0.94, to: 1 }, duration: 220, ease: 'Back.Out' });
    }
  }

  private updateCook(dt: number): void {
    if (this.cookMoodT > 0) {
      this.cookMoodT -= dt;
      if (this.cookMoodT <= 0 && this.slamState === 'idle') this.setCookMood('idle', 0);
    }
    const bob = calm() ? 0 : Math.sin(this.elapsed / 260) * 3;
    this.cook.y = COOK_Y + bob;
    // serving
    this.serveT -= dt;
    const target = tableTarget(this.players.length) + (this.frenzy ? 3 : 0);
    if (this.serveT <= 0) {
      this.serveT = this.frenzy ? 480 : 1000 + this.rng.next() * 500;
      const short = target - this.table.count();
      if (short > 0) {
        const n = Math.min(short, this.frenzy ? 3 : short > 4 ? 3 : 2);
        for (let i = 0; i < n; i++) this.time.delayedCall(i * 150, () => this.toss(serveKind(this.rng.next(), this.rng.next(), this.elapsed / this.duration)));
      }
    }
    if (this.roastAt.length && this.elapsed >= this.roastAt[0]) {
      this.roastAt.shift();
      if (!this.table.has('roast')) this.tossRoast();
    }
    this.updateSlam(dt);
  }

  /** Pick the slam's target: the fullest arm left out over the table, else a crowded patch of food. */
  private startSlam(): void {
    let best: Snatcher | null = null;
    let bestV = 0;
    for (const s of this.snatchers) {
      const a = s.arm;
      if ((a.state !== 'reach' && a.state !== 'hold') || a.len < 180) continue;
      const v = 1 + a.haul.length * 2 + a.len / 300;
      if (v > bestV) {
        bestV = v;
        best = s;
      }
    }
    if (best && this.rng.next() < 0.75) {
      const a = best.arm;
      const k = Math.min(a.len, L_MAX) * (0.55 + this.rng.next() * 0.3);
      this.slamX = best.sx + a.dirX * k;
      this.slamY = best.sy + a.dirY * k;
    } else {
      const spot = this.table.freeSpot(90, 220);
      const p = onTable(spot.r, spot.a, this.table.angle, this.tmp);
      this.slamX = p.x;
      this.slamY = p.y;
    }
    const r = Math.hypot(this.slamX, this.slamY);
    if (r > TABLE_R - 40) {
      this.slamX *= (TABLE_R - 40) / r;
      this.slamY *= (TABLE_R - 40) / r;
    }
    this.slamState = 'wind';
    this.slamT = 0;
    this.setCookMood('shout', SLAM_WARN + 500);
    audio.play('warn', { volume: 0.5, rate: 0.8 });
  }

  private updateSlam(dt: number): void {
    const g = this.tentG;
    g.clear();
    this.decalG.clear();
    if (this.slamState === 'idle') {
      this.pin.setVisible(false);
      this.slamNext -= dt;
      if (this.slamNext <= 0 && this.phase === 'playing') {
        const p = this.elapsed / this.duration;
        this.slamNext = (this.frenzy ? 2600 : 4600 - 1400 * p) + this.rng.next() * 1200;
        this.startSlam();
      }
      return;
    }
    this.slamT += dt;
    const tx = this.sx(this.slamX);
    const ty = this.sy(this.slamY);
    let h = 0;
    if (this.slamState === 'wind') {
      const u = Math.min(1, this.slamT / SLAM_WARN);
      h = 30 + 170 * Math.min(1, u * 2.2) + (calm() ? 0 : Math.sin(this.slamT / 45) * 6 * u);
      this.drawSlamWarning(tx, ty, u);
      if (u > 0.5 && this.slamT - dt < SLAM_WARN * 0.5) audio.play('warn', { volume: 0.55, rate: 1.1 });
      if (u >= 1) {
        this.slamState = 'drop';
        this.slamT = 0;
      }
    } else if (this.slamState === 'drop') {
      const u = Math.min(1, this.slamT / 70);
      h = 200 * (1 - u * u);
      this.drawSlamWarning(tx, ty, 1);
      if (u >= 1) {
        this.slamImpact(tx, ty);
        this.slamState = 'lift';
        this.slamT = 0;
      }
    } else {
      const u = Math.min(1, this.slamT / SLAM_LIFT);
      h = u < 0.35 ? 0 : 240 * ((u - 0.35) / 0.65);
      if (u >= 1) {
        this.slamState = 'idle';
        this.pin.setVisible(false);
        return;
      }
    }
    // The tentacle: a thick coral curve from the cook to the pin's grip, suckers along its underside.
    const px = tx;
    const py = ty - h - 16;
    const mx = (COOK_HAND.x + px) / 2 + (px > COOK_HAND.x ? 40 : -40);
    const my = Math.min(COOK_HAND.y, py) - 90;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      this.pts[i].x = a * COOK_HAND.x + b * mx + c * px;
      this.pts[i].y = a * COOK_HAND.y + b * my + c * py;
    }
    thickPolyline(g, this.pts, n, 30, 0x8f3a2a);
    thickPolyline(g, this.pts, n, 22, 0xf07a5a);
    g.fillStyle(0xffd7c4, 1);
    for (let i = 2; i < n - 1; i += 2) g.fillCircle(this.pts[i].x, this.pts[i].y + 7, 4);
    this.pin.setVisible(true).setPosition(px, py + 10).setDepth(D_TENTACLE + 1);
    // the pin's shadow on the table, tighter and darker as it comes down
    const k = 1 - Math.min(1, h / 220);
    this.decalG.fillStyle(0x1a1010, 0.18 + 0.32 * k);
    this.decalG.fillEllipse(tx, ty + 4, 70 + 40 * (1 - k), (70 + 40 * (1 - k)) * K * 0.55);
  }

  /** The slam's target on the table: a red ring tightening round the spot, throbbing faster. */
  private drawSlamWarning(tx: number, ty: number, u: number): void {
    const g = this.decalG;
    const throb = 0.5 + 0.5 * Math.sin(this.slamT / (90 - 50 * u));
    const r = SLAM_R * (1.6 - 0.6 * u);
    g.fillStyle(0xff3a2a, 0.12 + 0.18 * u);
    g.fillEllipse(tx, ty, r * 2, r * 2 * K);
    g.lineStyle(6, 0xffffff, 0.5 + 0.5 * throb);
    g.strokeEllipse(tx, ty, SLAM_R * 2, SLAM_R * 2 * K);
    g.lineStyle(4, 0xff3a2a, 1);
    g.strokeEllipse(tx, ty, SLAM_R * 2, SLAM_R * 2 * K);
  }

  private slamImpact(tx: number, ty: number): void {
    audio.play('hit', { volume: 0.8, rate: 0.8 });
    audio.play('land', { volume: 0.7 });
    audio.play('crack', { volume: 0.4 });
    shockwave(this, tx, ty, { radius: SLAM_R * 1.8, ratio: K, color: 0xffe0b0, alpha: 0.9, duration: 380, depth: D_DECAL + 1 });
    this.rings.burst(tx, ty, { tint: 0xffffff, from: 40, to: SLAM_R * 2.6, squash: K, duration: 420, alpha: 0.6, depth: D_DECAL + 1 });
    this.fx.vfx('dust', tx, ty, { scale: 0.5, duration: 420, alpha: 0.7, depth: D_FOOD + 40 });
    let bonked: Snatcher | null = null;
    for (const s of this.snatchers) {
      const a = s.arm;
      if (a.state !== 'reach' && a.state !== 'hold' && a.state !== 'snap') continue;
      const f = this.fistPos(s, this.tmp);
      if (distToSegment(this.slamX, this.slamY, s.sx, s.sy, f.x, f.y) > SLAM_R) continue;
      this.bonk(s);
      bonked = s;
    }
    this.table.hop(this.slamX, this.slamY, SLAM_R * 1.6);
    if (bonked) {
      this.hitStop(80);
      kick(this, 0, 12, 170);
    } else kick(this, 0, 6, 140);
  }

  // --- Arms ----------------------------------------------------------------------------------------
  /** A snatcher's fist on the table plane (written into `out`). */
  private fistPos(s: Snatcher, out: Pt): Pt {
    const a = s.arm;
    if (a.state === 'tangle') {
      out.x = a.knotX;
      out.y = a.knotY;
      return out;
    }
    out.x = s.sx + a.dirX * a.len;
    out.y = s.sy + a.dirY * a.len;
    return out;
  }

  private armOut(a: Arm): boolean {
    return a.state === 'reach' || a.state === 'hold' || a.state === 'snap';
  }

  private updateArm(s: Snatcher, dt: number): void {
    const a = s.arm;
    const c = s.p.controls;
    const sec = dt / 1000;
    a.phase += sec * 22;
    a.wob *= Math.exp(-6 * sec);
    a.safeT = Math.max(0, a.safeT - dt);
    switch (a.state) {
      case 'ready': {
        a.t -= dt;
        const mx = c.moveX;
        const my = c.moveY;
        if (Math.hypot(mx, my) > 0.35) {
          const want = clampAim(Math.atan2(my, mx), s.toCentre, AIM_DEV);
          a.aim += angleDelta(want, a.aim) * (1 - Math.exp(-AIM_RATE * sec));
        }
        if (c.pressed('A')) a.primed = true;
        if (!c.held('A')) a.primed = false;
        if (a.primed && a.t <= 0 && this.phase === 'playing') this.reachOut(s);
        break;
      }
      case 'reach':
        a.len = Math.min(L_MAX, a.len + REACH_SPEED * sec);
        this.grabAlong(s);
        if (!c.held('A')) this.snap(s);
        else if (a.len >= L_MAX) {
          a.state = 'hold';
          a.holdT = 0;
          audio.play('bounce', { volume: 0.25, rate: 0.7 });
        }
        break;
      case 'hold':
        a.holdT += dt;
        a.wob = Math.max(a.wob, 3 + 3 * Math.sin(a.holdT / 60));
        this.grabAlong(s);
        if (!c.held('A') || a.holdT >= HOLD_MS) this.snap(s);
        break;
      case 'snap':
        a.len -= SNAP_SPEED * sec;
        if (a.len <= 0) this.bank(s);
        break;
      case 'tangle':
      case 'bonk':
        a.t -= dt;
        if (a.t <= 0) {
          if (a.state === 'tangle') {
            a.len = Math.hypot(a.knotX - s.sx, a.knotY - s.sy);
            a.safeT = 450;
          }
          a.state = 'snap';
          a.wob = 16;
        }
        break;
    }
  }

  private reachOut(s: Snatcher): void {
    const a = s.arm;
    a.state = 'reach';
    a.dirX = Math.cos(a.aim);
    a.dirY = Math.sin(a.aim);
    a.len = 0;
    a.holdT = 0;
    a.wob = 0;
    a.startHaul = a.haul.length;
    a.primed = false;
    s.c.hold('throw', 1);
    s.c.face(a.dirX < 0);
    s.c.squash(0.12, 140);
    audio.play('whoosh', { volume: 0.5, rate: 1.15 + this.rng.next() * 0.2 });
    this.rumble(s.p, 0.15, 0.2, 60);
  }

  private snap(s: Snatcher): void {
    const a = s.arm;
    a.state = 'snap';
    a.wob = 20;
    audio.play('bounce', { volume: 0.45, rate: 1.35 + a.haul.length * 0.1 });
  }

  /** Grab whatever the fist passes over (up to a full hand). */
  private grabAlong(s: Snatcher): void {
    const a = s.arm;
    if (a.haul.length >= MAX_HAUL) return;
    const fp = this.fistPos(s, this.tmp);
    for (const f of this.table.foods) {
      if (f.state !== 'table' || f.z > 26) continue;
      if (Math.hypot(f.x - fp.x, f.y - fp.y) > GRAB_R) continue;
      f.state = 'held';
      a.haul.push(f);
      f.shadow.setVisible(false);
      const gold = f.kind === 'roast';
      audio.play(gold ? 'goldChip' : 'pop', { volume: gold ? 0.8 : 0.5, rate: 1.1 + a.haul.length * 0.12, throttleMs: 30 });
      this.rings.burst(this.sx(fp.x), this.sy(fp.y), { tint: gold ? 0xffd23a : s.light, from: 24, to: gold ? 130 : 84, squash: K, duration: 300, alpha: 0.7, depth: D_DECAL + 2, add: true });
      if (gold) {
        this.fx.sparks(this.sx(fp.x), this.sy(fp.y) - 30, liteCount(16));
        this.hitStop(60);
      }
      this.rumble(s.p, 0.1, 0.25, 50);
      if (a.haul.length >= MAX_HAUL) {
        this.words.pop('pc-w-full', this.sx(fp.x), this.sy(fp.y) - 70, { scale: 0.8, owner: s.p.slot, rise: 30 });
        break;
      }
    }
  }

  /** The fist is home: the haul is eaten and scored. */
  private bank(s: Snatcher): void {
    const a = s.arm;
    a.state = 'ready';
    a.len = 0;
    a.t = COOL_MS;
    s.c.play('idle');
    s.c.squash(0.14, 150);
    if (!a.haul.length) return;
    const kinds = a.haul.map((f) => f.kind);
    const pts = haulPoints(kinds);
    const gold = kinds.includes('roast');
    for (const f of a.haul) {
      const spr = f.spr;
      this.tweens.add({ targets: spr, x: s.c.x, y: s.c.y - 80, scale: 0.2, duration: 160, ease: 'Quad.In', onComplete: () => this.table.release(f) });
      f.state = 'gone';
    }
    a.haul.length = 0;
    s.p.score += pts;
    this.popScore(s, pts, gold);
    audio.play('chipGain', { volume: 0.55, rate: 1 + Math.min(0.4, pts * 0.05) });
    if (pts >= 5 || gold) {
      audio.play('cheer', { volume: 0.4 });
      s.c.play(gold ? 'victory' : 'celebrate');
      this.crowd?.cheer(gold);
      this.words.pop('pc-w-feast', s.c.x, s.c.y - 200, { scale: 0.9, owner: 100 + s.p.slot });
      if (gold) punch(this, 0.02, 260);
    } else if (pts >= 3) this.words.pop('pc-w-yum', s.c.x, s.c.y - 190, { scale: 0.75, owner: 100 + s.p.slot });
    this.rumble(s.p, 0.2, 0.3, 90);
  }

  private popScore(s: Snatcher, value: number, gold: boolean): void {
    const slot = s.p.slot;
    this.holdHud(slot, value);
    const h = this.hudPoint(slot);
    const entry: { h?: HudPop; value: number } = { value };
    entry.h = popToHud(this, s.c.x + (s.gx > TX ? -50 : 50), s.c.y - 150, `+${value}`, h.x, h.y, {
      color: value >= 5 || gold ? CSS.goldLight : '#ffffff',
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(slot, entry.value);
        this.bumpHud(slot);
      },
    });
  }

  /** Arms that cross knot together: both drop their haul where they cross. */
  private checkTangles(): void {
    for (let i = 0; i < this.snatchers.length; i++) {
      const A = this.snatchers[i];
      if (!this.armOut(A.arm) || A.arm.len < 40 || A.arm.safeT > 0) continue;
      const fa = this.fistPos(A, this.tmpA);
      for (let j = i + 1; j < this.snatchers.length; j++) {
        const B = this.snatchers[j];
        if (!this.armOut(B.arm) || B.arm.len < 40 || B.arm.safeT > 0) continue;
        const fb = this.fistPos(B, this.tmpB);
        const x = segmentsCross(A.sx, A.sy, fa.x, fa.y, B.sx, B.sy, fb.x, fb.y);
        if (x) this.tangle(A, B, x);
      }
    }
  }

  private tangle(A: Snatcher, B: Snatcher, at: Pt): void {
    for (const s of [A, B]) {
      const a = s.arm;
      const fp = this.fistPos(s, { x: 0, y: 0 });
      for (const f of a.haul) this.table.drop(f, fp.x, fp.y);
      a.haul.length = 0;
      a.state = 'tangle';
      a.t = TANGLE_MS;
      a.knotX = at.x;
      a.knotY = at.y;
      s.c.play('stunned', { force: true, returnTo: 'idle' });
      this.rumble(s.p, 0.5, 0.4, 180);
    }
    const x = this.sx(at.x);
    const y = this.sy(at.y, ARM_Z);
    audio.play('crack', { volume: 0.6 });
    audio.play('bounce', { volume: 0.6, rate: 0.6 });
    this.words.pop('pc-w-tangle', x, y - 60, { scale: 1, near: 60 });
    this.fx.vfx('starSwirl', x, y - 10, { scale: 0.5, duration: 700, blend: 'add', depth: D_FIST + 5 });
    this.rings.burst(x, y + ARM_Z, { tint: 0xffe9a8, from: 30, to: 160, squash: K, duration: 380, alpha: 0.8, depth: D_DECAL + 2, add: true });
    this.hitStop(70);
    kick(this, (B.gx - A.gx) * 0.01, 6, 150);
  }

  private bonk(s: Snatcher): void {
    const a = s.arm;
    const fp = this.fistPos(s, { x: 0, y: 0 });
    for (const f of a.haul) this.table.drop(f, fp.x, fp.y);
    a.haul.length = 0;
    a.state = 'bonk';
    a.t = BONK_MS;
    a.wob = 0;
    s.c.play('stunned', { force: true, returnTo: 'idle' });
    audio.play('hit', { volume: 0.7 });
    this.words.pop('pc-w-bonk', this.sx(fp.x), this.sy(fp.y) - 70, { scale: 1, owner: 200 + s.p.slot });
    this.fx.vfx('starSwirl', s.c.x, s.c.y + s.c.headY * CHAR_SCALE - 10, { scale: 0.42, duration: 700, blend: 'add', depth: D_CHAR + 20 });
    this.rumble(s.p, 0.7, 0.5, 220);
  }

  // --- Gulls (snatchGulls.ts flies them; the scene says what they can dive at) -------------------------
  private gullHost(): GullHost<Snatcher | Food, Food> {
    return {
      scene: this,
      hasAtlas: this.hasAtlas,
      rand: () => this.rng.next(),
      screen: (x, y, z, out) => {
        out.x = this.sx(x);
        out.y = this.sy(y, z);
        return out;
      },
      pickPrey: () => this.gullPrey(),
      preyAt: (prey, out) => {
        if ('arm' in prey) {
          if (!this.armOut(prey.arm) || !prey.arm.haul.length) return false;
          this.fistPos(prey, out);
          return true;
        }
        if (prey.state !== 'table') return false;
        out.x = prey.x;
        out.y = prey.y;
        return true;
      },
      snatch: (prey) => this.snatchFrom(prey),
      fistHits: (x, y, r) => {
        for (const s of this.snatchers) {
          if (s.arm.state !== 'reach' && s.arm.state !== 'hold') continue;
          const fp = this.fistPos(s, this.tmpB);
          if (Math.hypot(fp.x - x, fp.y - y) <= r) return true;
        }
        return false;
      },
      drop: (f, x, y) => this.table.drop(f, x, y),
      lose: (f) => this.table.release(f),
      carry: (f, x, y, tilt) => {
        f.spr.setPosition(x, y).setDepth(D_GULL - 1).setAngle(tilt);
        f.glint?.setPosition(x, y - 14);
      },
      said: (word, x, y) => {
        this.words.pop(word === 'squawk' ? 'pc-w-squawk' : 'pc-w-bop', x, y - 55, { scale: 0.88, near: 80 });
        this.fx.vfx('confetti', x, y, { scale: 0.42, duration: 420, tint: 0xffffff, depth: D_GULL + 1 });
      },
    };
  }

  /** A gull's pick: the fullest fist out over the table, else the most valuable item on it. */
  private gullPrey(): Snatcher | Food | null {
    let best: Snatcher | Food | null = null;
    let bestV = 0;
    for (const s of this.snatchers) {
      if (!this.armOut(s.arm) || !s.arm.haul.length || s.arm.state === 'snap') continue;
      let v = 1.5;
      for (const f of s.arm.haul) v += FOOD_VALUE[f.kind];
      if (v > bestV) {
        bestV = v;
        best = s;
      }
    }
    if (best) return best;
    for (const f of this.table.foods) {
      if (f.state !== 'table') continue;
      const v = FOOD_VALUE[f.kind] + this.rng.next() * 0.5;
      if (v > bestV) {
        bestV = v;
        best = f;
      }
    }
    return best;
  }

  /** The gull takes the best item from a fist, or the item itself off the table. */
  private snatchFrom(prey: Snatcher | Food): Food | null {
    let loot: Food | null = null;
    if ('arm' in prey) {
      const haul = prey.arm.haul;
      let bi = 0;
      for (let i = 1; i < haul.length; i++) if (FOOD_VALUE[haul[i].kind] > FOOD_VALUE[haul[bi].kind]) bi = i;
      loot = haul.splice(bi, 1)[0] ?? null;
      if (loot) {
        prey.c.squash(0.16, 160);
        this.rumble(prey.p, 0.3, 0.3, 120);
      }
    } else if (prey.state === 'table') loot = prey;
    if (!loot) return null;
    loot.state = 'gull';
    loot.shadow.setVisible(false);
    return loot;
  }

  // --- Frame ---------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    const s = dt / 1000;
    // the table spins (and turns round once, a little past halfway)
    if (this.flipAt > 0 && this.elapsed >= this.flipAt && this.elapsed >= this.bannerUntil) {
      this.flipAt = 0;
      this.spinDir *= -1;
      banner(this, 'THE TABLE TURNS!', { y: this.bannerY(), size: 72, color: '#ffe9a8', hold: 650 });
      this.bannerUntil = this.elapsed + 1400;
      audio.play('sweep', { volume: 0.5 });
    }
    const want = this.spinDir * spinSpeed(this.elapsed / this.duration, this.frenzy);
    this.omega += (want - this.omega) * (1 - Math.exp(-2.5 * s));
    this.table.angle += this.omega * s;
    this.topImg.setRotation(this.table.angle);
    this.table.update(dt);
    this.updateCook(dt);
    for (const sn of this.snatchers) this.updateArm(sn, dt);
    this.checkTangles();
    this.gulls.update(dt, true, this.players.length >= 3 && this.elapsed > 20000, this.frenzy);
    this.drawArms();
  }

  protected override ambient(dt: number): void {
    if (this.phase === 'finished') this.gulls?.update(dt, false, false, false);
    if (this.phase !== 'playing') {
      if (this.phase === 'countdown') {
        this.table.angle += this.omega * 0.5 * (dt / 1000);
        this.topImg?.setRotation(this.table.angle);
        this.table.update(0);
      }
      this.drawArms();
    }
  }

  /** Every arm: a shadow on the table, a rubbery tube with stretch bands, the glove fist and its haul. */
  private drawArms(): void {
    const g = this.armG;
    const sh = this.shadowG;
    const gd = this.guideG;
    g.clear();
    sh.clear();
    gd.clear();
    for (const s of this.snatchers) {
      const a = s.arm;
      const x0 = this.sx(s.sx);
      const y0 = this.sy(s.sy, ARM_Z);
      if (a.state === 'ready') {
        s.fist.setVisible(false);
        if (!s.p.isCpu && this.phase === 'playing') this.drawGuide(gd, s);
        continue;
      }
      const fp = this.fistPos(s, this.tmp);
      const fx = this.sx(fp.x);
      const fy = this.sy(fp.y, a.state === 'bonk' ? 4 : ARM_Z);
      const n = 12;
      const dx = fx - x0;
      const dy = fy - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const wob = a.state === 'snap' ? a.wob : a.state === 'hold' ? a.wob * 0.4 : 0;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const off = wob * Math.sin(u * Math.PI * 3 + a.phase) * Math.sin(u * Math.PI);
        this.pts[i].x = x0 + dx * u + nx * off;
        this.pts[i].y = y0 + dy * u + ny * off;
      }
      // shadow straight below on the table
      sh.lineStyle(20, 0x1a0e08, 0.22);
      sh.beginPath();
      sh.moveTo(this.pts[0].x, this.pts[0].y + ARM_Z);
      for (let i = 1; i < n; i++) sh.lineTo(this.pts[i].x, this.pts[i].y + ARM_Z);
      sh.strokePath();
      const w = a.state === 'bonk' ? 30 : 22;
      thickPolyline(g, this.pts, n, w + 8, s.dark);
      thickPolyline(g, this.pts, n, w, s.color);
      // highlight along the top edge
      g.lineStyle(4, s.light, 0.9);
      g.beginPath();
      g.moveTo(this.pts[0].x, this.pts[0].y - w * 0.26);
      for (let i = 1; i < n; i++) g.lineTo(this.pts[i].x, this.pts[i].y - w * 0.26);
      g.strokePath();
      // stretch bands: always six, so they spread as the arm stretches
      g.lineStyle(4, s.dark, 0.8);
      for (let k = 1; k <= 6; k++) {
        const u = k / 7;
        const i0 = Math.min(n - 2, Math.floor(u * (n - 1)));
        const px = this.pts[i0].x;
        const py = this.pts[i0].y;
        g.lineBetween(px - nx * w * 0.45, py - ny * w * 0.45, px + nx * w * 0.45, py + ny * w * 0.45);
      }
      if (a.state === 'tangle') {
        g.lineStyle(7, s.color, 1);
        const r = 18;
        const t = this.elapsed / 90;
        g.strokeCircle(fx + Math.cos(t) * 8, fy + Math.sin(t) * 5, r);
      }
      // the glove, pointing along the arm
      const ang = Math.atan2(dy, dx);
      s.fist.setVisible(a.state !== 'tangle').setPosition(fx, fy).setRotation(ang).setScale(a.state === 'bonk' ? 1.1 : 1, a.state === 'bonk' ? 0.7 : 1);
      g.fillStyle(s.color, 1);
      g.fillCircle(fx - Math.cos(ang) * 24, fy - Math.sin(ang) * 24, w * 0.62);
      for (let i = 0; i < a.haul.length; i++) {
        const f = a.haul[i];
        const ox = (i - (a.haul.length - 1) / 2) * 26;
        f.spr.setPosition(fx + nx * ox, fy - 20 - (i % 2) * 6).setDepth(D_HELD + i * 0.1).setScale(this.hasAtlas ? FOOD_SCALE * 0.82 : 2);
        f.glint?.setPosition(fx + nx * ox, fy - 34);
      }
    }
  }

  /** A human's aim: a dotted line out to full reach, with a ring where the fist would stop. */
  private drawGuide(g: Phaser.GameObjects.Graphics, s: Snatcher): void {
    const a = s.arm;
    const cx = Math.cos(a.aim);
    const cy = Math.sin(a.aim);
    const ready = a.t <= 0;
    g.fillStyle(s.color, ready ? 0.8 : 0.35);
    for (let d = 40; d <= L_MAX; d += 34) {
      const x = this.sx(s.sx + cx * d);
      const y = this.sy(s.sy + cy * d);
      g.fillCircle(x, y, d > L_MAX - 30 ? 7 : 4.5);
    }
    const ex = this.sx(s.sx + cx * L_MAX);
    const ey = this.sy(s.sy + cy * L_MAX);
    g.lineStyle(4, s.color, ready ? 0.9 : 0.4);
    g.strokeEllipse(ex, ey, 40, 40 * K);
  }

  protected override end(): void {
    const first = !this.wrapped;
    this.wrapped = true;
    if (first) {
      // Whatever is in hand at the buzzer still counts: arms snap home and bank.
      for (const s of this.snatchers) {
        if (s.arm.state !== 'ready') {
          s.arm.len = 0;
          this.bank(s);
        }
        s.fist.setVisible(false);
      }
      this.guideG.clear();
      this.armG.clear();
      this.shadowG.clear();
      this.tentG.clear();
      this.decalG.clear();
      this.pin.setVisible(false);
      this.slamState = 'idle';
    }
    super.end();
    if (first) this.crowd?.cheer(true);
  }

  // --- CPU -----------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    let s: Snatcher | undefined;
    for (const q of this.snatchers) if (q.p === p) s = q;
    if (!s) return;
    const a = s.arm;
    const sk = this.skill(p);
    const b = p.brain;
    if (a.state === 'reach' || a.state === 'hold') {
      let release = false;
      const want = b.wait ?? L_MAX;
      if (a.len >= want) release = true;
      if (a.haul.length > a.startHaul && !this.foodAhead(s)) release = true;
      if (a.haul.length >= MAX_HAUL) release = true;
      // danger: a slam coming down on the arm, or a gull diving at the fist
      if (b.mode !== 'brave' && this.armThreatened(s)) {
        if (b.mode !== 'bail') b.mode = Math.random() < 0.25 + sk.accuracy * 0.7 ? 'bail' : 'brave';
        if (b.mode === 'bail') release = true;
      }
      vc.hold('A', !release);
      return;
    }
    vc.hold('A', false);
    if (a.state !== 'ready') {
      b.target = undefined;
      return;
    }
    b.timer -= dt;
    if (!b.target || b.timer <= 0) {
      b.timer = sk.think * (0.7 + Math.random() * 0.6);
      b.mode = 'aim';
      b.n = sk.reaction * (0.6 + Math.random() * 0.5);
      this.pickTarget(s, p);
    }
    const t = b.target;
    if (!t) {
      vc.setMove(0, 0);
      return;
    }
    const want = Math.atan2(t.y - s.sy, t.x - s.sx);
    vc.setMove(Math.cos(want), Math.sin(want));
    b.n = (b.n ?? 0) - dt;
    if ((b.n ?? 0) <= 0 && a.t <= 0 && Math.abs(angleDelta(want, a.aim)) < 0.08) {
      vc.hold('A', true);
      b.mode = 'reach';
      b.target = undefined;
    }
  }

  /** CPU target choice: the best value it can reach soonest, leading the spin, with skill-scaled slop. */
  private pickTarget(s: Snatcher, p: MgPlayer): void {
    const sk = this.skill(p);
    const b = p.brain;
    let found = false;
    const best = this.bestLead;
    let bestScore = -1e9;
    const sh = this.tmpA;
    sh.x = s.sx;
    sh.y = s.sy;
    for (const f of this.table.foods) {
      if (f.state !== 'table') continue;
      const lead = leadTarget(sh, f.r, f.a, this.table.angle, this.omega, REACH_SPEED, 0.25, L_MAX - 16, this.lead);
      if (!lead) continue;
      const ang = Math.atan2(lead.y - s.sy, lead.x - s.sx);
      if (Math.abs(angleDelta(ang, s.toCentre)) > AIM_DEV) continue;
      let score = (FOOD_VALUE[f.kind] * 10) / (lead.t + 0.6);
      // what else lies along the way (a fist can bring three home)
      for (const o of this.table.foods) {
        if (o === f || o.state !== 'table') continue;
        if (distToSegment(o.x, o.y, s.sx, s.sy, lead.x, lead.y) < GRAB_R * 0.8) score += FOOD_VALUE[o.kind] * 3;
      }
      for (const q of this.players) {
        const qt = q.brain.target;
        if (q !== p && qt && Math.hypot(qt.x - lead.x, qt.y - lead.y) < 60) {
          score -= 5;
          break;
        }
      }
      if (this.slamState === 'wind' && distToSegment(this.slamX, this.slamY, s.sx, s.sy, lead.x, lead.y) < SLAM_R + 20) score -= 12 * sk.accuracy;
      // careful CPUs keep clear of arms already out (a tangle drops everything)
      for (const o of this.snatchers) {
        if (o === s || !this.armOut(o.arm)) continue;
        const of = this.fistPos(o, this.tmp);
        if (segmentsCross(s.sx, s.sy, lead.x, lead.y, o.sx, o.sy, of.x, of.y)) score -= 9 * sk.accuracy;
      }
      score += (Math.random() - 0.5) * 12 * sk.mistake;
      if (score > bestScore) {
        bestScore = score;
        found = true;
        best.x = lead.x;
        best.y = lead.y;
        best.len = lead.len;
        best.t = lead.t;
      }
    }
    if (!found) {
      b.target = undefined;
      return;
    }
    const miss = sk.aimNoise * 95 * (Math.random() - 0.5) * 2;
    const ang = Math.atan2(best.y - s.sy, best.x - s.sx) + Math.PI / 2;
    const t = s.aimAt;
    t.x = best.x + Math.cos(ang) * miss;
    t.y = best.y + Math.sin(ang) * miss;
    b.target = t;
    b.wait = best.len + 20 + (Math.random() < sk.mistake ? 140 : 0);
  }

  /** Another item just ahead of the fist, still worth reaching for. */
  private foodAhead(s: Snatcher): boolean {
    const a = s.arm;
    const fp = this.fistPos(s, this.tmp);
    const ex = fp.x + a.dirX * 110;
    const ey = fp.y + a.dirY * 110;
    for (const f of this.table.foods) {
      if (f.state !== 'table') continue;
      if (distToSegment(f.x, f.y, fp.x, fp.y, ex, ey) < GRAB_R * 0.8) return true;
    }
    return false;
  }

  /** A slam about to land on this arm, or a gull diving at this fist. */
  private armThreatened(s: Snatcher): boolean {
    if (this.slamState === 'wind' && this.slamT > SLAM_WARN * 0.35) {
      const fp = this.fistPos(s, this.tmpA);
      if (distToSegment(this.slamX, this.slamY, s.sx, s.sy, fp.x, fp.y) < SLAM_R + 30) return true;
    }
    if (this.gulls.divingAt(s) > 0.3) return true;
    return false;
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} food` }));
  }
}

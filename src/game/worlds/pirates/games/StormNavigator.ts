import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import { Character } from '../../../characters/Character';
import { CSS, PLAYER_COLORS } from '../../../constants';
import type { VirtualControls } from '../../../input/PlayerInput';
import { LITE } from '../../../perf';
import { addText } from '../../../ui/theme';
import { BaseMinigame, type MgPlayer } from '../../../minigames/BaseMinigame';
import { banner, flashScreen, kick, popToHud, shockwave, titleTexture } from '../../../minigames/juice';
import { AFX, burst, ensureArenaFxTextures, RingPool, Spray } from '../../../minigames/games/arenaFx';
import { bakeWord, WordPops } from '../../../minigames/games/stageKit';
import { calm, Crowd, finishAtlas, hasFrame, queueAtlas, startHint, thickPolyline } from '../piratesKit';
import {
  angleDelta,
  BAY,
  boomAngle,
  inIrons,
  keepInBay,
  LIGHT,
  sailEfficiency,
  splitLoss,
  strikeLoss,
  tackClear,
  tackHeading,
  type Tack,
  TREASURE_VALUE,
  treasureKind,
  type TreasureKind,
} from './stormNavigatorRules';

// --- Layout: keep in step with scripts/art/worlds/pirates/mg_stormbay.py (ortho camera at 55 degrees) ---
/** Depth squash of the water (sin 55) and how tall one world unit stands on screen (cos 55 x 100). */
const K = 0.819;
const UP = 57.4;
const MAST_TOP = 1.95 * UP;
const MAST_FOOT = 0.32 * UP;
const MAST_FWD = 12;
const BOOM = 78;

// --- Tuning --------------------------------------------------------------------------------------------
const BASE_SPEED = 330;
const TURN_RATE = 3.1;
const LEEWAY = 24;
const BOOST_MS = 700;
const BOOST_K = 1.6;
const BOOST_CD = 2600;
const BOAT_R = 52;
const PICK_R = 62;
const RAM_SPEED = 330;
const STRIKE_WARN = 1400;
const STRIKE_R = 115;
const STRIKE_STUN = 1100;
const WHIRL_R = 180;
/** How opaque the whirlpool's swirl is drawn. */
const WHIRL_ALPHA = 0.82;
const WHIRL_CORE = 46;
const CHAR_SCALE = 0.42;
const POP_SIZE = 54;
/** Treasure widths on screen (px). */
const LOOT_W: Record<TreasureKind, number> = { pouch: 62, chest: 80, goldchest: 86 };
/** The middle of the open water (screen px). */
const BAY_MID = { x: (BAY.x0 + BAY.x1) / 2, y: (BAY.y0 + BAY.y1) / 2 };

// --- Depths --------------------------------------------------------------------------------------------
const D_WATER = 10;
const D_OBJ = 100;
const D_BOLT = 7000;
const D_RAIN = 7100;
const D_UI = 8200;

interface Boat {
  p: MgPlayer;
  c: Character;
  x: number;
  y: number;
  h: number;
  v: number;
  kx: number;
  ky: number;
  boostT: number;
  boostCd: number;
  stunT: number;
  spin: number;
  flutter: number;
  eff: number;
  hull: Phaser.GameObjects.Image;
  sail: Phaser.GameObjects.Graphics;
  wakeT: number;
  tack: number;
  /** How fast the boat really moves (px/s, smoothed), and how long a CPU has been stuck (ms). */
  spd: number;
  stuckT: number;
  pop?: { value: number };
}

interface Loot {
  active: boolean;
  kind: TreasureKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bob: number;
  /** Surfacing (ms left) and the whirlpool's grip on it. */
  rise: number;
  spr: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image;
}

interface Strike {
  active: boolean;
  x: number;
  y: number;
  t: number;
  hit: boolean;
}

/**
 * Storm Navigator (Nami's minigame) - dinghies on a stormy bay. The wind shifts (the weather vane and the
 * streaks on the water show where it blows); a boat sails fast across or with it and stalls heading into
 * it, so players tack. Scoop floating treasure, pump the sail (A) for a burst - ramming a rival knocks
 * treasure loose - and dodge telegraphed lightning and a roaming whirlpool. Most treasure in 50 s wins.
 */
export class StormNavigatorScene extends BaseMinigame {
  private boats: Boat[] = [];
  private loot: Loot[] = [];
  private strikes: Strike[] = [];
  private wind = 0;
  private windTo = 0;
  private windS = 1;
  private shiftT = 0;
  private strikeT = 0;
  private spawnT = 0;
  private thunderT = 0;
  private tide = false;
  private hasAtlas = false;
  private whirlOn = false;
  private whirlX = 960;
  private whirlY = 600 / K;
  private whirlT = 0;
  private whirl?: Phaser.GameObjects.Container;
  private whirlImg?: Phaser.GameObjects.Image;
  private vane?: Phaser.GameObjects.Image;
  private dial?: Phaser.GameObjects.Image;
  private dialRing!: Phaser.GameObjects.Graphics;
  private warnG!: Phaser.GameObjects.Graphics;
  private boltG!: Phaser.GameObjects.Graphics;
  private boltT = 0;
  private dark!: Phaser.GameObjects.Rectangle;
  private rain: Phaser.GameObjects.Image[] = [];
  private streaks: Phaser.GameObjects.Image[] = [];
  private streakT = 0;
  private rings!: RingPool;
  private spray?: Spray;
  private foam?: Spray;
  private words!: WordPops;
  private crowd?: Crowd;
  private wrapped = false;
  private sailPts: Phaser.Types.Math.Vector2Like[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  private sailShadow: Phaser.Types.Math.Vector2Like[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  private boltPts: { x: number; y: number }[] = Array.from({ length: 12 }, () => ({ x: 0, y: 0 }));
  private tmp = { x: 0, y: 0 };
  private tack: Tack = { heading: 0, tack: 0 };

  constructor() {
    super('mg-storm-navigator');
  }

  preload(): void {
    queueAtlas(this, 'pirates-storm', 'pirates_storm');
  }

  // --- Arena ---------------------------------------------------------------------------------------
  protected createArena(): void {
    this.duration = 50000;
    this.boats = [];
    this.loot = [];
    this.strikes = [];
    this.wind = -Math.PI / 2 + (this.rng.next() - 0.5) * 1.2;
    this.windTo = this.wind;
    this.windS = 1;
    this.shiftT = 7500;
    this.strikeT = 5000;
    this.spawnT = 0;
    this.thunderT = 3500;
    this.tide = false;
    this.whirlOn = false;
    this.whirlT = 0;
    this.boltT = 0;
    this.rain = [];
    this.streaks = [];
    this.streakT = 0;
    this.wrapped = false;
    finishAtlas(this, 'pirates-storm');
    this.hasAtlas = hasFrame(this, 'pirates-storm', 'boat_00');
    ensureArenaFxTextures(this);
    for (const [key, text, fill] of [
      ['sn-w-zap', 'ZAP!', ['#fffbe0', '#ffe14a']],
      ['sn-w-ram', 'RAM!', ['#ffd0c8', '#ff7a4a']],
      ['sn-w-spun', 'WHIRLED!', ['#e6fbff', '#5ce1ff']],
      ['sn-w-gold', 'GOLDEN!', ['#fff6c0', '#ffc83a']],
      ['sn-w-stall', 'NO WIND!', ['#e8eef6', '#9aa8c0']],
    ] as [string, string, readonly [string, string]][]) {
      bakeWord(this, key, text, { size: 50, fill });
    }
    for (let v = 1; v <= 5; v++) titleTexture(this, `+${v}`, POP_SIZE, v >= 5 ? CSS.goldLight : '#ffffff');
    if (this.textures.exists('rendered-scene-pirates_storm')) this.add.image(0, 0, 'rendered-scene-pirates_storm').setOrigin(0).setDepth(-50);
    else this.add.rectangle(960, 540, 1920, 1080, 0x174452).setDepth(-50);
    this.rings = new RingPool(this, LITE ? 14 : 24);
    this.spray = new Spray(this, AFX.drop, { depth: D_OBJ + 60, reserve: LITE ? 40 : 90, lifespan: [360, 620], gravity: 700, scale: { start: 1.1, end: 0.5 }, alpha: { start: 1, end: 0 }, tint: [0xdff4ff, 0xffffff, 0x9fd0e8] });
    this.foam = new Spray(this, 'fx-dot', { depth: D_WATER + 2, reserve: LITE ? 40 : 90, lifespan: [600, 1000], gravity: 0, scale: { start: 1.1, end: 0.2 }, alpha: { start: 0.55, end: 0 }, tint: [0xe8f6ff, 0xffffff] });
    this.words = new WordPops(this, D_UI - 20, 14);
    this.warnG = this.add.graphics().setDepth(D_WATER + 5);
    this.boltG = this.add.graphics().setDepth(D_BOLT).setBlendMode(Phaser.BlendModes.ADD);
    // the roaming whirlpool (hidden until it forms) and the lighthouse's weather vane
    if (this.hasAtlas) {
      this.whirlImg = this.add.image(0, 0, 'pirates-storm', 'whirl');
      this.whirlImg.setScale((WHIRL_R * 2) / Math.max(1, this.whirlImg.frame.realWidth));
      this.whirl = this.add.container(0, 0, [this.whirlImg]).setScale(1, K).setDepth(D_WATER + 1).setAlpha(0).setVisible(false);
      this.vane = this.add.image(0, 0, 'pirates-storm', 'vane').setScale(0.8);
      this.add.container(LIGHT.x, LIGHT.y, [this.vane]).setScale(1, K).setDepth(D_OBJ + 5);
    }
    for (let i = 0; i < 26; i++) this.loot.push(this.makeLoot());
    for (let i = 0; i < 4; i++) this.strikes.push({ active: false, x: 0, y: 0, t: 0, hit: false });
    this.buildWeather();
    this.buildDial();
    this.crowd = new Crowd(
      this,
      [
        { id: 'packsprout', pose: 'cheer', x: 70, y: 1040, scale: 0.3 },
        { id: 'mimi', pose: 'alert', x: 150, y: 1060, scale: 0.3 },
        { id: 'wrench', pose: 'surprised', x: 1850, y: 1052, scale: 0.3 },
      ],
      D_OBJ + 200,
    );
    const n = 6 + this.players.length;
    for (let i = 0; i < n; i++) this.spawnLoot(true);
  }

  /** Rain, the storm's gloom and wind streaks on the water (all pooled; halved in Lite). */
  private buildWeather(): void {
    this.dark = this.add.rectangle(960, 540, 1920, 1080, 0x0a1a2a, 0.16).setDepth(D_RAIN - 1);
    const rainN = calm() ? 20 : LITE ? 34 : 70;
    for (let i = 0; i < rainN; i++) {
      const r = this.add.image(this.rng.next() * 1920, this.rng.next() * 1080, AFX.streak).setDepth(D_RAIN).setAlpha(0.35).setTint(0xcfe4f4);
      r.setScale(0.5 + this.rng.next() * 0.4, 0.8);
      this.rain.push(r);
    }
    for (let i = 0; i < (LITE ? 16 : 30); i++) this.streaks.push(this.add.image(0, 0, AFX.streak).setDepth(D_WATER + 3).setVisible(false).setTint(0xe8f6ff));
  }

  /** The wind dial on the rocks at the bottom: a brass plate with the vane arrow pointing where it blows. */
  private buildDial(): void {
    const x = 960;
    const y = 1040;
    const g = this.add.graphics().setDepth(D_UI);
    g.fillStyle(0x0a1120, 0.55);
    g.fillRoundedRect(x - 150, y - 34, 300, 68, 34);
    g.lineStyle(3, 0xe0a93f, 1);
    g.strokeRoundedRect(x - 150, y - 34, 300, 68, 34);
    addText(this, x - 88, y, 'WIND', 26, { color: '#ffe08a', weight: 700 }).setDepth(D_UI + 1);
    this.dialRing = this.add.graphics().setDepth(D_UI + 1);
    this.dial = this.hasAtlas ? this.add.image(x + 60, y, 'pirates-storm', 'vane').setScale(0.62).setDepth(D_UI + 2) : undefined;
  }

  protected override bannerY(): number {
    return 470;
  }

  // --- Players -------------------------------------------------------------------------------------
  protected createPlayer(p: MgPlayer, index: number): void {
    const n = this.players.length;
    const spots = [
      [420, 360],
      [1500, 360],
      [420, 820],
      [1500, 820],
    ];
    const order = n === 2 ? [0, 3] : [0, 1, 2, 3];
    const [sx, sy] = spots[order[index % 4]];
    const h = Math.atan2(600 - sy, 960 - sx);
    const hull = this.hasAtlas ? this.add.image(sx, sy, 'pirates-storm', 'boat_00') : this.add.image(sx, sy, 'fx-dot').setScale(5, 2.4).setTint(0x8a5a34);
    const sail = this.add.graphics();
    const c = new Character(this, sx, sy, p.characterId, { scale: CHAR_SCALE, slot: p.slot, marker: true, shadow: false });
    p.character = c;
    this.boats.push({ p, c, x: sx, y: sy / K, h, v: 0, kx: 0, ky: 0, boostT: 0, boostCd: 0, stunT: 0, spin: 0, flutter: 0, eff: 1, hull, sail, wakeT: 0, tack: 0, spd: 0, stuckT: 0 });
  }

  protected override onStart(): void {
    audio.play('splash', { volume: 0.5 });
    audio.play('rumble', { volume: 0.4 });
    for (const b of this.boats) b.c.play('wave');
    if (this.humanSlots().length) startHint(this, 'Steer across the wind \u2014 heading into it stalls you! A pumps the sail', 560);
  }

  protected override onFinalStretch(): void {
    this.tide = true;
    this.showFinalStretch('TREASURE TIDE!');
    for (let i = 0; i < 6; i++) this.time.delayedCall(i * 120, () => this.spawnLoot(false));
    this.crowd?.cheer(true);
  }

  protected override hudLabel(p: MgPlayer): string {
    return String(p.score);
  }

  // --- Treasure ------------------------------------------------------------------------------------
  private makeLoot(): Loot {
    const spr = this.add.image(0, 0, this.hasAtlas ? 'pirates-storm' : 'fx-dot', this.hasAtlas ? 'pouch' : undefined).setVisible(false);
    const ring = this.add.image(0, 0, AFX.ring).setVisible(false).setAlpha(0.5).setDepth(D_WATER + 4);
    const glint = this.add.image(0, 0, this.textures.exists('fx-rays') ? 'fx-rays' : 'fx-dot').setVisible(false).setTint(0xffd23a).setBlendMode(Phaser.BlendModes.ADD);
    return { active: false, kind: 'pouch', x: 0, y: 0, vx: 0, vy: 0, bob: 0, rise: 0, spr, ring, glint };
  }

  private placeLoot(kind: TreasureKind, x: number, y: number, vx = 0, vy = 0, rise = 500): Loot | null {
    const l = this.loot.find((q) => !q.active);
    if (!l) return null;
    l.active = true;
    l.kind = kind;
    l.x = x;
    l.y = y;
    l.vx = vx;
    l.vy = vy;
    l.bob = this.rng.next() * 6;
    l.rise = rise;
    if (this.hasAtlas) {
      l.spr.setTexture('pirates-storm', kind);
      l.spr.setScale(LOOT_W[kind] / Math.max(1, l.spr.frame.cutWidth));
    }
    else l.spr.setTexture('fx-dot').setScale(2.6).setTint(kind === 'goldchest' ? 0xffd23a : kind === 'chest' ? 0xa0602a : 0xd9a468);
    l.spr.setVisible(true).setAlpha(1);
    l.ring.setVisible(true);
    l.glint.setVisible(kind === 'goldchest');
    return l;
  }

  /** New treasure bobs up somewhere clear of the boats (the whirlpool and the rim). */
  private spawnLoot(initial: boolean): void {
    const gold = this.loot.some((l) => l.active && l.kind === 'goldchest');
    const kind = treasureKind(this.rng.next(), gold || this.elapsed < 6000);
    let best = { x: 960, y: 600 / K };
    let bestD = -1;
    for (let tries = 0; tries < 12; tries++) {
      const x = BAY.x0 + 90 + this.rng.next() * (BAY.x1 - BAY.x0 - 180);
      const y = (BAY.y0 + 80 + this.rng.next() * (BAY.y1 - BAY.y0 - 160)) / K;
      this.tmp.x = x;
      this.tmp.y = y * K;
      if (keepInBay(this.tmp, 80)) continue;
      let d = 1e9;
      for (const b of this.boats) d = Math.min(d, Math.hypot(b.x - x, b.y - y));
      for (const l of this.loot) if (l.active) d = Math.min(d, Math.hypot(l.x - x, l.y - y) * 1.6);
      if (this.whirlOn) d = Math.min(d, Math.hypot(this.whirlX - x, this.whirlY - y) - WHIRL_R * 0.5);
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
    const l = this.placeLoot(kind, best.x, best.y, 0, 0, initial ? 0 : 600);
    if (!l || initial) return;
    this.rings.spawn(best.x, best.y * K, 10, 70, { squash: K, tint: kind === 'goldchest' ? 0xffd23a : 0xe8f6ff, alpha: 0.8, ms: 520, depth: D_WATER + 4 });
    this.spray?.fire(best.x, best.y * K, burst(6), -90, 50, 80, 200);
    audio.play('splash', { volume: 0.18, rate: 1.4, throttleMs: 80 });
  }

  private updateLoot(dt: number): void {
    const s = dt / 1000;
    for (const l of this.loot) {
      if (!l.active) continue;
      l.bob += s * 2.6;
      if (l.rise > 0) l.rise -= dt;
      // drifting (tossed treasure slows; everything drifts a little with the wind)
      l.vx *= Math.exp(-1.6 * s);
      l.vy *= Math.exp(-1.6 * s);
      l.x += (l.vx + Math.cos(this.wind) * 10 * this.windS) * s;
      l.y += (l.vy + Math.sin(this.wind) * 10 * this.windS) * s;
      if (this.whirlOn) this.whirlPull(l, s, true);
      this.tmp.x = l.x;
      this.tmp.y = l.y * K;
      if (keepInBay(this.tmp, 40)) {
        l.x = this.tmp.x;
        l.y = this.tmp.y / K;
        l.vx *= -0.4;
        l.vy *= -0.4;
      }
      const sx = l.x;
      const sy = l.y * K;
      const risen = l.rise > 0 ? 1 - l.rise / 600 : 1;
      const bob = Math.sin(l.bob) * 3;
      l.spr.setPosition(sx, sy - 6 + bob + (1 - risen) * 18).setAlpha(risen).setDepth(D_OBJ + sy * 0.01);
      const rs = (l.kind === 'pouch' ? 0.62 : 0.78) + 0.06 * Math.sin(l.bob);
      l.ring.setPosition(sx, sy + 2).setScale(rs, rs * K * 0.5);
      if (l.glint.visible) l.glint.setPosition(sx, sy - 34 + bob).setScale(0.42).setAngle(this.elapsed * 0.06).setDepth(l.spr.depth - 0.1);
    }
  }

  private freeLoot(l: Loot): void {
    l.active = false;
    l.spr.setVisible(false);
    l.ring.setVisible(false);
    l.glint.setVisible(false);
  }

  private collect(b: Boat, l: Loot): void {
    const v = TREASURE_VALUE[l.kind];
    b.p.score += v;
    const sx = l.x;
    const sy = l.y * K;
    this.freeLoot(l);
    audio.play(l.kind === 'goldchest' ? 'goldChip' : 'chipGain', { volume: 0.6, rate: 0.95 + v * 0.05, throttleMs: 30 });
    this.rings.spawn(sx, sy, 14, 80, { squash: K, tint: v >= 5 ? 0xffd23a : PLAYER_COLORS[b.p.slot], alpha: 0.8, ms: 380, depth: D_WATER + 4, add: true });
    this.fx.sparks(sx, sy - 20, burst(v >= 3 ? 12 : 6));
    if (v >= 5) {
      this.words.pop('sn-w-gold', sx, sy - 80, { scale: 0.9, near: 80 });
      b.c.play('victory');
      this.crowd?.cheer(true);
    } else if (v >= 3) b.c.play('celebrate');
    this.holdHud(b.p.slot, v);
    const h = this.hudPoint(b.p.slot);
    popToHud(this, sx, sy - 50, `+${v}`, h.x, h.y, {
      color: v >= 5 ? CSS.goldLight : '#ffffff',
      size: POP_SIZE,
      onArrive: () => {
        this.releaseHud(b.p.slot, v);
        this.bumpHud(b.p.slot);
      },
    });
    this.rumble(b.p, 0.15, 0.25, 60);
  }

  /** Knock treasure overboard: it's lost from the score and floats out round the boat for anyone. */
  private spill(b: Boat, points: number, speed: number): void {
    const n = Math.min(points, b.p.score);
    if (n <= 0) return;
    b.p.score -= n;
    const parts = splitLoss(n);
    parts.forEach((kind, i) => {
      const a = (i / parts.length) * Math.PI * 2 + this.rng.next() * 0.6;
      this.placeLoot(kind, b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40, Math.cos(a) * speed, Math.sin(a) * speed, 0);
    });
    audio.play('chipLose', { volume: 0.55 });
  }

  // --- Wind ----------------------------------------------------------------------------------------
  private updateWind(dt: number): void {
    this.shiftT -= dt;
    if (this.shiftT <= 0 && this.phase === 'playing') {
      this.shiftT = (this.tide ? 5200 : 7000) + this.rng.next() * 2500;
      const turn = (0.9 + this.rng.next() * 1.4) * (this.rng.next() < 0.5 ? -1 : 1);
      this.windTo = this.wind + turn;
      this.windS = 0.85 + this.rng.next() * 0.35;
      banner(this, 'WIND SHIFT!', { y: this.bannerY(), size: 76, color: '#dff4ff', hold: 600 });
      audio.play('sweep', { volume: 0.5 });
      audio.play('whoosh', { volume: 0.5, rate: 0.6 });
    }
    this.wind += angleDelta(this.windTo, this.wind) * (1 - Math.exp(-1.8 * (dt / 1000)));
    // the vane (in the world) and the dial (on screen, where the wind blows on screen)
    if (this.vane) this.vane.setRotation(this.wind + (calm() ? 0 : Math.sin(this.elapsed / 180) * 0.05));
    const screenAng = Math.atan2(Math.sin(this.wind) * K, Math.cos(this.wind));
    this.dial?.setRotation(screenAng);
    const g = this.dialRing;
    g.clear();
    g.fillStyle(0xe0a93f, 1);
    for (let i = 0; i < 3; i++) g.fillCircle(960 + 118, 1040 - 14 + i * 14, i < Math.round((this.windS - 0.7) * 6) ? 5 : 2.5);
    this.updateStreaks(dt);
  }

  /** Wind streaks racing across the water the way the wind blows. */
  private updateStreaks(dt: number): void {
    const dx = Math.cos(this.wind);
    const dy = Math.sin(this.wind) * K;
    const ang = Math.atan2(dy, dx);
    this.streakT -= dt;
    if (this.streakT <= 0) {
      this.streakT = LITE ? 110 : 60;
      const img = this.streaks.find((q) => !q.visible);
      if (img) {
        const x = BAY.x0 + this.rng.next() * (BAY.x1 - BAY.x0);
        const y = BAY.y0 + this.rng.next() * (BAY.y1 - BAY.y0);
        img.setPosition(x, y).setRotation(ang).setAlpha(0).setScale(0.8 + this.rng.next() * 0.8, 0.8).setVisible(true).setData('t', 0);
      }
    }
    const sp = 420 * this.windS * (dt / 1000);
    for (const img of this.streaks) {
      if (!img.visible) continue;
      const t = (img.getData('t') as number) + dt;
      img.setData('t', t);
      img.x += dx * sp;
      img.y += dy * sp;
      img.setRotation(ang).setAlpha(Math.sin(Math.min(1, t / 900) * Math.PI) * 0.4);
      if (t > 900) img.setVisible(false);
    }
  }

  private updateRain(dt: number): void {
    const s = dt / 1000;
    const wx = Math.cos(this.wind) * 260 * this.windS;
    const ang = Math.atan2(900, wx);
    for (const r of this.rain) {
      r.x += wx * s;
      r.y += 900 * s;
      r.setRotation(ang);
      if (r.y > 1100) {
        r.y = -20;
        r.x = this.rng.next() * 2100 - 90;
      }
      if (r.x < -100) r.x += 2100;
      if (r.x > 2020) r.x -= 2100;
    }
  }

  // --- Boats ---------------------------------------------------------------------------------------
  private updateBoat(b: Boat, dt: number): void {
    const s = dt / 1000;
    const c = b.p.controls;
    b.boostCd = Math.max(0, b.boostCd - dt);
    b.boostT = Math.max(0, b.boostT - dt);
    b.flutter += s * 18;
    if (b.stunT > 0) {
      b.stunT -= dt;
      b.spin *= Math.exp(-2 * s);
      b.h += b.spin * s;
      b.v *= Math.exp(-2.5 * s);
    } else {
      const mx = c.moveX;
      const my = c.moveY;
      if (Math.hypot(mx, my) > 0.35) {
        // the stick points where the boat should head on screen
        const want = Math.atan2(my / K, mx);
        const d = angleDelta(want, b.h);
        b.h += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * s);
      }
      if (c.pressed('A') && b.boostCd <= 0 && this.phase === 'playing') this.pump(b);
    }
    b.eff = sailEfficiency(b.h, this.wind);
    const target = BASE_SPEED * this.windS * b.eff * (b.boostT > 0 ? BOOST_K : 1) * (b.stunT > 0 ? 0.2 : 1);
    b.v += (target - b.v) * (1 - Math.exp(-(target > b.v ? 1.9 : 1.2) * s));
    let vx = Math.cos(b.h) * b.v + Math.cos(this.wind) * LEEWAY * this.windS + b.kx;
    let vy = Math.sin(b.h) * b.v + Math.sin(this.wind) * LEEWAY * this.windS + b.ky;
    b.kx *= Math.exp(-2.4 * s);
    b.ky *= Math.exp(-2.4 * s);
    if (this.whirlOn) {
      const f = this.whirlForce(b.x, b.y);
      vx += f.x;
      vy += f.y;
    }
    const px = b.x;
    const py = b.y;
    b.x += vx * s;
    b.y += vy * s;
    this.tmp.x = b.x;
    this.tmp.y = b.y * K;
    if (keepInBay(this.tmp, 30)) {
      b.x = this.tmp.x;
      b.y = this.tmp.y / K;
      b.v *= 0.6;
      b.kx *= -0.3;
      b.ky *= -0.3;
      if (Math.hypot(vx, vy) > 160) {
        audio.play('land', { volume: 0.25, throttleMs: 200 });
        this.spray?.fire(b.x, b.y * K, burst(5), -90, 60, 80, 180);
      }
    }
    if (s > 0) b.spd += (Math.hypot(b.x - px, b.y - py) / s - b.spd) * (1 - Math.exp(-4 * s));
    // wake
    b.wakeT -= dt;
    const speed = Math.hypot(vx, vy);
    if (b.wakeT <= 0 && speed > 70) {
      b.wakeT = (LITE ? 110 : 60) * (b.boostT > 0 ? 0.5 : 1);
      const bx = b.x - Math.cos(b.h) * 44;
      const by = (b.y - Math.sin(b.h) * 44) * K;
      this.foam?.fire(bx, by, b.boostT > 0 ? 3 : 1, (b.h * 180) / Math.PI + 180, 40, 10, 50);
      if (speed > 220 && Math.random() < 0.5) this.rings.spawn(bx, by, 8, 34, { squash: K, alpha: 0.35, ms: 500, depth: D_WATER + 2 });
    }
    if (b.eff < 0.3 && b.stunT <= 0 && this.phase === 'playing' && !b.p.isCpu && Math.random() < dt / 2200) {
      this.words.pop('sn-w-stall', b.x, b.y * K - 120, { scale: 0.6, owner: 50 + b.p.slot, rise: 16 });
    }
  }

  /** A pump of the sail: a burst of speed, stronger with the wind in the sail. */
  private pump(b: Boat): void {
    b.boostT = BOOST_MS * (0.5 + 0.5 * b.eff);
    b.boostCd = BOOST_CD;
    b.v += 80 * b.eff;
    audio.play('whoosh', { volume: 0.5, rate: 1.1 });
    audio.play('splash', { volume: 0.2, rate: 1.3 });
    this.spray?.fire(b.x - Math.cos(b.h) * 40, (b.y - Math.sin(b.h) * 40) * K, burst(8), (b.h * 180) / Math.PI + 180, 40, 120, 260);
    b.c.squash(0.14, 150);
    this.rumble(b.p, 0.2, 0.3, 70);
  }

  private collideBoats(): void {
    for (let i = 0; i < this.boats.length; i++) {
      for (let j = i + 1; j < this.boats.length; j++) {
        const a = this.boats[i];
        const b = this.boats[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= BOAT_R * 2 || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (BOAT_R * 2 - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const va = Math.cos(a.h) * a.v * nx + Math.sin(a.h) * a.v * ny;
        const vb = -(Math.cos(b.h) * b.v * nx + Math.sin(b.h) * b.v * ny);
        const rammer = a.boostT > 0 && va > RAM_SPEED * 0.6 ? a : b.boostT > 0 && vb > RAM_SPEED * 0.6 ? b : null;
        const bump = 160;
        a.kx -= nx * bump;
        a.ky -= ny * bump;
        b.kx += nx * bump;
        b.ky += ny * bump;
        if (rammer && Math.max(va, vb) > RAM_SPEED * 0.6) this.ram(rammer, rammer === a ? b : a);
        else audio.play('bounce', { volume: 0.3, rate: 0.8, throttleMs: 150 });
      }
    }
  }

  private ram(r: Boat, v: Boat): void {
    if (v.stunT > 0) return;
    v.stunT = 520;
    v.spin = (Math.random() < 0.5 ? -1 : 1) * 7;
    r.boostT = 0;
    this.spill(v, 1, 180);
    const x = (r.x + v.x) / 2;
    const y = ((r.y + v.y) / 2) * K;
    this.words.pop('sn-w-ram', x, y - 90, { scale: 0.9, near: 90 });
    this.spray?.fire(x, y, burst(14), -90, 90, 150, 360);
    audio.play('hit', { volume: 0.6 });
    audio.play('splash', { volume: 0.4 });
    this.hitStop(70);
    kick(this, (v.x - r.x) * 0.05, (v.y - r.y) * 0.05, 150);
    this.rumble(v.p, 0.6, 0.4, 200);
    this.rumble(r.p, 0.3, 0.3, 100);
  }

  private pickups(): void {
    for (const b of this.boats) {
      if (b.stunT > 0) continue;
      for (const l of this.loot) {
        if (!l.active || l.rise > 150) continue;
        if (Math.hypot(l.x - b.x, (l.y - b.y) * 1.0) < PICK_R) this.collect(b, l);
      }
    }
  }

  // --- Drawing a boat ------------------------------------------------------------------------------
  private drawBoat(b: Boat): void {
    const sx = b.x;
    const sy = b.y * K;
    const bob = calm() ? 0 : Math.sin(this.elapsed / 300 + b.p.slot) * 2.5;
    const deg = ((((b.h * 180) / Math.PI) % 360) + 360) % 360;
    const k = Math.round(deg / 22.5) % 16;
    if (this.hasAtlas) b.hull.setFrame(`boat_${k < 10 ? '0' : ''}${k}`);
    else b.hull.setRotation(b.h);
    b.hull.setPosition(sx, sy + bob).setDepth(D_OBJ + sy * 0.01);
    // the character stands just aft of the mast
    const cx = sx - Math.cos(b.h) * 14;
    const cy = (b.y - Math.sin(b.h) * 14) * K - 8 + bob;
    b.c.setPosition(cx, cy).setDepth(D_OBJ + sy * 0.01 + 0.2);
    if (b.stunT <= 0) b.c.face(Math.cos(b.h) < 0);
    // the sail: mast top, foot, and the boom's end swung out to leeward, bellied by the wind
    const mx = sx + Math.cos(b.h) * MAST_FWD;
    const myw = b.y + Math.sin(b.h) * MAST_FWD;
    const my = myw * K + bob;
    const boom = boomAngle(b.h, this.wind, Math.sin(b.flutter));
    const ex = mx + Math.cos(boom) * BOOM;
    const ey = my + Math.sin(boom) * BOOM * K - MAST_FOOT;
    const topX = mx;
    const topY = my - MAST_TOP;
    const footY = my - MAST_FOOT;
    const g = b.sail;
    g.clear();
    const irons = inIrons(b.h, this.wind);
    const full = irons ? 0.05 : Math.min(1, b.eff) * (b.boostT > 0 ? 1.3 : 1);
    // belly: push the leech out toward the side the wind blows to
    const nx = Math.cos(this.wind);
    const ny = Math.sin(this.wind) * K;
    const pts = this.sailPts;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const lx = topX + (ex - topX) * u;
      const ly = topY + (ey - topY) * u;
      const belly = Math.sin(u * Math.PI) * 30 * full + (irons ? Math.sin(b.flutter * 2 + u * 6) * 5 : 0);
      pts[i].x = lx + nx * belly;
      pts[i].y = ly + ny * belly;
    }
    pts[n].x = mx;
    pts[n].y = footY;
    const lit = Math.cos(angleDelta(boom, -2.2)) > 0;
    const sh = this.sailShadow;
    for (let i = 0; i <= n; i++) {
      sh[i].x = (pts[i].x ?? 0) + 4;
      sh[i].y = (pts[i].y ?? 0) + 6;
    }
    g.fillStyle(0x2a2233, 0.35);
    g.fillPoints(sh, true);
    g.fillStyle(lit ? 0xfbf3e2 : 0xe0d4be, 1);
    g.fillPoints(pts, true);
    // a stripe in the player's colour across the middle of the sail
    const col = PLAYER_COLORS[b.p.slot];
    g.lineStyle(9, col, 1);
    const a0x = topX + (mx - topX) * 0.55;
    const a0y = topY + (footY - topY) * 0.55;
    const i1 = 3;
    g.lineBetween(a0x, a0y, (pts[i1].x ?? 0) * 0.6 + a0x * 0.4, (pts[i1].y ?? 0) * 0.6 + a0y * 0.4 + 10);
    g.lineStyle(2.5, 0x6b4428, 1);
    g.lineBetween(topX, topY, mx, footY + 6);
    g.lineBetween(mx, footY, ex, ey);
    const mastInFront = my > cy;
    g.setDepth(D_OBJ + sy * 0.01 + (mastInFront ? 0.3 : 0.1));
    if (b.boostT > 0 && !calm()) {
      g.lineStyle(3, 0xffffff, 0.6);
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * 16;
        const bx = sx - Math.cos(b.h) * (60 + i * 8) - Math.sin(b.h) * o;
        const by = (b.y - Math.sin(b.h) * (60 + i * 8) + Math.cos(b.h) * o) * K;
        g.lineBetween(bx, by, bx - Math.cos(b.h) * 40, by - Math.sin(b.h) * 40 * K);
      }
    }
  }

  // --- Lightning -----------------------------------------------------------------------------------
  private updateStrikes(dt: number): void {
    this.strikeT -= dt;
    if (this.strikeT <= 0 && this.phase === 'playing') {
      const p = this.elapsed / this.duration;
      this.strikeT = (this.tide ? 1500 : 2900 - 1100 * p) + this.rng.next() * 900;
      this.startStrike();
      if (this.tide && this.rng.next() < 0.5) this.startStrike();
    }
    const g = this.warnG;
    g.clear();
    for (const st of this.strikes) {
      if (!st.active) continue;
      st.t += dt;
      const u = Math.min(1, st.t / STRIKE_WARN);
      const x = st.x;
      const y = st.y * K;
      const throb = 0.5 + 0.5 * Math.sin(st.t / (80 - 50 * u));
      // a dark cloud shadow deepening over the spot, and a crackling ring closing in
      g.fillStyle(0x05101a, 0.14 + 0.3 * u);
      g.fillEllipse(x, y, STRIKE_R * 2.6, STRIKE_R * 2.6 * K);
      g.fillStyle(0xfff3a0, 0.08 + 0.14 * u * throb);
      g.fillEllipse(x, y, STRIKE_R * 2, STRIKE_R * 2 * K);
      g.lineStyle(5, 0xfff3a0, 0.5 + 0.5 * throb);
      g.strokeEllipse(x, y, STRIKE_R * 2 * (1.5 - 0.5 * u), STRIKE_R * 2 * K * (1.5 - 0.5 * u));
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeEllipse(x, y, STRIKE_R * 2, STRIKE_R * 2 * K);
      if (u > 0.6 && Math.random() < dt / 180) this.fx.vfx('electric', x + (Math.random() - 0.5) * STRIKE_R, y - 20, { scale: 0.3, duration: 220, blend: 'add', depth: D_WATER + 6 });
      if (u >= 1) this.strike(st);
    }
    if (this.boltT > 0) {
      this.boltT -= dt;
      this.boltG.setAlpha(Math.max(0, this.boltT / 180));
      if (this.boltT <= 0) this.boltG.clear();
    }
  }

  private startStrike(): void {
    const st = this.strikes.find((q) => !q.active);
    if (!st) return;
    let x: number;
    let y: number;
    const victim = this.boats[Math.floor(this.rng.next() * this.boats.length)];
    if (victim && this.rng.next() < 0.55) {
      // aim ahead of a boat (it can see it coming and turn away)
      const lead = 0.6;
      x = victim.x + Math.cos(victim.h) * victim.v * lead + (this.rng.next() - 0.5) * 120;
      y = victim.y + Math.sin(victim.h) * victim.v * lead + (this.rng.next() - 0.5) * 120;
    } else {
      x = BAY.x0 + 120 + this.rng.next() * (BAY.x1 - BAY.x0 - 240);
      y = (BAY.y0 + 100 + this.rng.next() * (BAY.y1 - BAY.y0 - 200)) / K;
    }
    this.tmp.x = x;
    this.tmp.y = y * K;
    keepInBay(this.tmp, 70);
    st.active = true;
    st.x = this.tmp.x;
    st.y = this.tmp.y / K;
    st.t = 0;
    st.hit = false;
    audio.play('rumble', { volume: 0.3, rate: 1.2 });
    audio.play('warn', { volume: 0.3, rate: 1.4 });
  }

  private strike(st: Strike): void {
    st.active = false;
    const x = st.x;
    const y = st.y * K;
    this.drawBolt(x, y);
    this.boltT = 180;
    this.boltG.setAlpha(1);
    flashScreen(this, 0xe8f4ff, 0.3, 200);
    this.lift(0.02, 420);
    audio.play('explosion', { volume: 0.55, rate: 1.3 });
    audio.play('crack', { volume: 0.7 });
    this.fx.vfx('splash', x, y - 20, { scale: 0.7, duration: 520, depth: D_OBJ + 50 });
    shockwave(this, x, y, { radius: STRIKE_R * 1.5, ratio: K, color: 0xfff3a0, alpha: 0.95, duration: 420, depth: D_WATER + 6 });
    this.spray?.fire(x, y, burst(16), -90, 80, 160, 420);
    let hitAny = false;
    for (const b of this.boats) {
      if (Math.hypot(b.x - st.x, b.y - st.y) > STRIKE_R + 20) continue;
      hitAny = true;
      b.stunT = STRIKE_STUN;
      b.spin = (Math.random() < 0.5 ? -1 : 1) * 9;
      b.boostT = 0;
      this.spill(b, strikeLoss(b.p.score), 240);
      b.c.play('stunned', { force: true, returnTo: 'idle' });
      b.c.sprite.setTintFill(0xffffff);
      this.time.delayedCall(90, () => b.c.sprite.clearTint());
      this.fx.vfx('starSwirl', b.x, b.y * K - 110, { scale: 0.4, duration: 800, blend: 'add', depth: D_UI - 30 });
      this.words.pop('sn-w-zap', b.x, b.y * K - 130, { scale: 1, owner: 10 + b.p.slot });
      this.rumble(b.p, 0.9, 0.6, 300);
    }
    // floating treasure nearby is flung outward
    for (const l of this.loot) {
      if (!l.active) continue;
      const dx = l.x - st.x;
      const dy = l.y - st.y;
      const d = Math.hypot(dx, dy);
      if (d > STRIKE_R * 1.4 || d === 0) continue;
      l.vx += (dx / d) * 260;
      l.vy += (dy / d) * 260;
    }
    if (hitAny) {
      this.hitStop(90);
      kick(this, 0, 10, 170);
    } else kick(this, 0, 5, 120);
  }

  /** Lightning lifts the storm's gloom for a moment. */
  private lift(to: number, ms: number): void {
    this.tweens.killTweensOf(this.dark);
    this.dark.setAlpha(to / 0.16);
    this.tweens.add({ targets: this.dark, alpha: 1, duration: ms, ease: 'Quad.In' });
  }

  private drawBolt(x: number, y: number): void {
    const g = this.boltG;
    g.clear();
    const pts = this.boltPts;
    const n = pts.length;
    let px = x + (Math.random() - 0.5) * 200;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const py = -40 + (y + 40) * u;
      px += (Math.random() - 0.5) * 70 * (1 - u * 0.7);
      pts[i].x = i === n - 1 ? x : px * (1 - u) + x * u + (Math.random() - 0.5) * 30 * (1 - u);
      pts[i].y = py;
    }
    thickPolyline(g, pts, n, 26, 0x5ca8ff, 0.35);
    thickPolyline(g, pts, n, 12, 0xbfe4ff, 0.9);
    thickPolyline(g, pts, n, 5, 0xffffff, 1);
  }

  // --- The whirlpool -------------------------------------------------------------------------------
  private whirlForce(x: number, y: number): { x: number; y: number } {
    const dx = x - this.whirlX;
    const dy = y - this.whirlY;
    const d = Math.hypot(dx, dy);
    this.tmp.x = 0;
    this.tmp.y = 0;
    if (d > WHIRL_R || d === 0) return this.tmp;
    const k = 1 - d / WHIRL_R;
    const nx = dx / d;
    const ny = dy / d;
    this.tmp.x = -ny * 170 * k - nx * 120 * k;
    this.tmp.y = nx * 170 * k - ny * 120 * k;
    return this.tmp;
  }

  private whirlPull(l: Loot, s: number, isLoot: boolean): void {
    const f = this.whirlForce(l.x, l.y);
    l.x += f.x * s;
    l.y += f.y * s;
    if (!isLoot) return;
    // treasure sucked into the eye is spat out again across the rim
    if (Math.hypot(l.x - this.whirlX, l.y - this.whirlY) < WHIRL_CORE * 0.8) {
      const a = Math.random() * Math.PI * 2;
      l.x = this.whirlX + Math.cos(a) * WHIRL_R * 0.9;
      l.y = this.whirlY + Math.sin(a) * WHIRL_R * 0.9;
      l.vx = Math.cos(a) * 280;
      l.vy = Math.sin(a) * 280;
      this.spray?.fire(l.x, l.y * K, burst(6), -90, 60, 100, 240);
    }
  }

  private updateWhirl(dt: number): void {
    if (!this.whirlOn) {
      if (this.elapsed > 9000 && this.phase === 'playing') {
        this.whirlOn = true;
        this.whirlT = 0;
        this.whirl?.setVisible(true);
        if (this.whirl) this.tweens.add({ targets: this.whirl, alpha: WHIRL_ALPHA, duration: 900 });
        banner(this, 'WHIRLPOOL!', { y: this.bannerY(), size: 76, color: '#bff0ff', hold: 600 });
        audio.play('portal', { volume: 0.5, rate: 0.7 });
      }
      return;
    }
    this.whirlT += dt;
    const t = this.whirlT / 1000;
    // a slow wander round the bay (a lissajous path, clear of the rim)
    const cx = 960 + Math.sin(t * 0.21 + 0.6) * 520;
    const cy = (600 + Math.sin(t * 0.33) * 260) / K;
    this.whirlX = cx;
    this.whirlY = cy;
    this.whirl?.setPosition(cx, cy * K);
    this.whirlImg?.setRotation(this.whirlImg.rotation + (dt / 1000) * 2.4);
    for (const b of this.boats) {
      if (b.stunT > 0) continue;
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (d < WHIRL_CORE) this.whirled(b);
    }
  }

  private whirled(b: Boat): void {
    const a = Math.atan2(b.y - this.whirlY, b.x - this.whirlX) + 0.8;
    b.stunT = 900;
    b.spin = 12;
    b.kx = Math.cos(a) * 520;
    b.ky = Math.sin(a) * 520;
    b.boostT = 0;
    this.spill(b, Math.min(2, b.p.score), 200);
    b.c.play('stunned', { force: true, returnTo: 'idle' });
    this.words.pop('sn-w-spun', b.x, b.y * K - 120, { scale: 0.9, owner: 10 + b.p.slot });
    audio.play('splash', { volume: 0.6, rate: 0.8 });
    audio.play('portal', { volume: 0.4, rate: 1.4 });
    this.rumble(b.p, 0.6, 0.5, 240);
    this.hitStop(60);
  }

  // --- Frame ---------------------------------------------------------------------------------------
  protected tick(dt: number): void {
    this.updateWind(dt);
    this.updateWhirl(dt);
    for (const b of this.boats) this.updateBoat(b, dt);
    this.collideBoats();
    this.updateLoot(dt);
    this.pickups();
    this.updateStrikes(dt);
    // keep the bay stocked
    this.spawnT -= dt;
    const cap = 6 + Math.round(this.players.length * 1.5) + (this.tide ? 5 : 0);
    if (this.spawnT <= 0) {
      this.spawnT = this.tide ? 450 : 1100;
      let out = 0;
      for (const l of this.loot) if (l.active) out++;
      if (out < cap) this.spawnLoot(false);
    }
    for (const b of this.boats) this.drawBoat(b);
  }

  protected override ambient(dt: number): void {
    const k = this.time.timeScale;
    this.spray?.sync(k);
    this.foam?.sync(k);
    this.rings.update(dt);
    this.updateRain(dt);
    this.thunderT -= dt;
    if (this.thunderT <= 0) {
      // distant sheet lightning: a flicker and a low rumble, no strike
      this.thunderT = 5000 + this.rng.next() * 4000;
      if (!calm()) flashScreen(this, 0xdfeeff, 0.12, 160);
      this.lift(0.08, 300);
      audio.play('rumble', { volume: 0.35, rate: 0.7 });
    }
    if (this.phase !== 'playing') {
      if (this.phase === 'countdown') {
        this.updateLoot(0);
        this.updateStreaks(dt);
      }
      for (const b of this.boats) this.drawBoat(b);
    }
  }

  protected override end(): void {
    if (!this.wrapped) {
      this.wrapped = true;
      this.warnG.clear();
      for (const st of this.strikes) st.active = false;
      for (const b of this.boats) b.boostT = 0;
    }
    super.end();
    this.crowd?.cheer(true);
  }

  // --- CPU -----------------------------------------------------------------------------------------
  protected cpuThink(p: MgPlayer, vc: VirtualControls, dt: number): void {
    const b = this.boatOf(p);
    if (!b) return;
    const sk = this.skill(p);
    const br = p.brain;
    br.timer -= dt;
    if (br.timer <= 0 || !br.target) {
      br.timer = sk.think * (0.7 + Math.random() * 0.6);
      this.cpuTarget(b, p);
    }
    const t = br.target;
    if (!t) {
      vc.setMove(0, 0);
      return;
    }
    let bearing = Math.atan2(t.y - b.y, t.x - b.x);
    // hazards first: a lightning ring about to strike, or the whirlpool's pull
    let fleeing = false;
    for (const st of this.strikes) {
      if (!st.active || st.t < STRIKE_WARN * (0.55 - sk.accuracy * 0.25)) continue;
      const d = Math.hypot(b.x - st.x, b.y - st.y);
      if (d < STRIKE_R + 60 && (br.n ?? 0) !== 1) {
        if (br.mode !== 'flee' && Math.random() < sk.accuracy) br.mode = 'flee';
      }
      if (br.mode === 'flee' && d < STRIKE_R + 70) {
        bearing = Math.atan2(b.y - st.y, b.x - st.x);
        fleeing = true;
      }
    }
    if (!fleeing && br.mode === 'flee') br.mode = 'seek';
    if (this.whirlOn) {
      const d = Math.hypot(b.x - this.whirlX, b.y - this.whirlY);
      if (d < WHIRL_R * 0.95 && Math.random() < 0.4 + sk.accuracy * 0.6) {
        bearing = Math.atan2(b.y - this.whirlY, b.x - this.whirlX) + 0.5;
        fleeing = true;
      }
    }
    // stuck (pinned on the rocks, or in irons): head for open water on the other tack for a moment
    if (b.stunT <= 0 && this.phase === 'playing' && b.spd < 55) b.stuckT += dt;
    else b.stuckT = Math.max(0, b.stuckT - dt * 2);
    if (b.stuckT > 1300) {
      b.stuckT = 0;
      b.tack = b.tack ? -b.tack : Math.random() < 0.5 ? -1 : 1;
      br.mode = 'unstick';
      br.wait = 1100;
    }
    if (br.mode === 'unstick') {
      br.wait = (br.wait ?? 0) - dt;
      if (br.wait <= 0) {
        br.mode = 'seek';
        br.timer = 0;
      } else if (!fleeing) bearing = Math.atan2(BAY_MID.y / K - b.y, BAY_MID.x - b.x);
    }
    // beating upwind, it comes about before a leg runs onto the rocks
    const tk = tackClear(bearing, this.wind, b.tack, b.x, b.y, K, this.tack);
    b.tack = tk.tack;
    const noise = (Math.sin(this.elapsed / 700 + p.slot * 2) * 0.5 + (Math.random() - 0.5)) * sk.aimNoise * 0.35;
    const h = tk.heading + noise;
    // the stick points on screen, so squash the heading's depth back down
    vc.setMove(Math.cos(h), Math.sin(h) * K);
    const dist = Math.hypot(t.x - b.x, t.y - b.y);
    if (b.boostCd <= 0 && (fleeing || (dist > 260 && b.eff > 0.75)) && Math.random() < sk.accuracy * 0.08) vc.tap('A');
  }

  private boatOf(p: MgPlayer): Boat | undefined {
    for (const b of this.boats) if (b.p === p) return b;
    return undefined;
  }

  /** CPU target: the best treasure for the time it takes to sail there (wind included), clear of storms. */
  private cpuTarget(b: Boat, p: MgPlayer): void {
    const sk = this.skill(p);
    let best: Loot | null = null;
    let bestScore = -1e9;
    for (const l of this.loot) {
      if (!l.active) continue;
      const d = Math.hypot(l.x - b.x, l.y - b.y);
      const bearing = Math.atan2(l.y - b.y, l.x - b.x);
      const eff = Math.max(0.55, sailEfficiency(tackHeading(bearing, this.wind, 0, this.tack).heading, this.wind));
      const eta = d / (BASE_SPEED * this.windS * eff);
      let score = (TREASURE_VALUE[l.kind] * 10) / (eta + 0.8);
      for (const o of this.boats) {
        if (o === b) continue;
        if (Math.hypot(l.x - o.x, l.y - o.y) < d * 0.6) score -= 3;
      }
      for (const st of this.strikes) if (st.active && Math.hypot(l.x - st.x, l.y - st.y) < STRIKE_R + 30) score -= 8 * sk.accuracy;
      if (this.whirlOn && Math.hypot(l.x - this.whirlX, l.y - this.whirlY) < WHIRL_R * 0.7) score -= 6 * sk.accuracy;
      score += (Math.random() - 0.5) * 8 * sk.mistake;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    const t = p.brain.target ?? (p.brain.target = { x: 0, y: 0 });
    t.x = best ? best.x : BAY_MID.x;
    t.y = best ? best.y : BAY_MID.y / K;
    if (!p.brain.mode) p.brain.mode = 'seek';
  }

  protected finalScores(): { slot: number; score: number; label: string }[] {
    return this.players.map((p) => ({ slot: p.slot, score: p.score, label: `${p.score} treasure` }));
  }
}

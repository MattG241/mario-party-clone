// Stretch & Snatch: the spinning feast table and the food on it - a fixed pool of items that the cook
// tosses on, that ride round with the table, hop when the rolling pin lands, and are grabbed, dropped,
// carried off by gulls or eaten (the scene decides which; this keeps them placed and drawn).
import Phaser from 'phaser';
import { audio } from '../../../audio/AudioManager';
import type { EffectsManager } from '../../../effects/EffectsManager';
import { shockwave } from '../../../minigames/juice';
import { liteCount, type RingBursts } from '../../../minigames/games/stageKit';
import { onTable, toLocal, type FoodKind, type Pt } from './stretchSnatchRules';

// --- Layout: keep in step with scripts/art/worlds/pirates/mg_deck.py (ortho camera at 50 degrees) ------
/** The table top's centre on screen, the depth squash of the deck (sin 50 degrees) and its radius. */
export const TX = 960;
export const TY = 589;
export const K = 0.766;
export const TABLE_R = 290;
/** Food stays between these radii of the table, drawn at this scale. */
export const FOOD_R_MIN = 70;
export const FOOD_R_MAX = 236;
export const FOOD_SCALE = 1.35;
export const D_DECAL = 108;
export const D_FOOD = 120;

/** Screen x / y of a table-plane point (y raised z px). */
export function tsx(x: number): number {
  return TX + x;
}

export function tsy(y: number, z = 0): number {
  return TY + y * K - z;
}

export interface Food {
  kind: FoodKind;
  state: 'free' | 'toss' | 'table' | 'held' | 'gull' | 'gone';
  /** Local polar position on the table (it turns with the table). */
  r: number;
  a: number;
  /** Table-plane position now. */
  x: number;
  y: number;
  /** Height above the table top (screen px): tosses and hops. */
  z: number;
  vz: number;
  spr: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image | null;
  /** A toss from the cook: start (screen), elapsed, length. */
  fx: number;
  fy: number;
  tossT: number;
  tossMs: number;
  bob: number;
}

export class FeastTable {
  readonly foods: Food[] = [];
  /** How far the table has turned (radians). */
  angle = 0;
  private tmp: Pt = { x: 0, y: 0 };
  private clock = 0;

  constructor(
    private scene: Phaser.Scene & { fx: EffectsManager },
    private rand: () => number,
    private hasAtlas: boolean,
    private rings: RingBursts,
    count = 32,
  ) {
    for (let i = 0; i < count; i++) {
      const spr = scene.add.image(0, 0, hasAtlas ? 'pirates-snatch' : 'fx-dot', hasAtlas ? 'apple' : undefined).setVisible(false);
      const shadow = scene.add.image(0, 0, 'fx-contact').setVisible(false).setDepth(D_DECAL - 1);
      this.foods.push({ kind: 'apple', state: 'free', r: 0, a: 0, x: 0, y: 0, z: 0, vz: 0, spr, shadow, glint: null, fx: 0, fy: 0, tossT: 0, tossMs: 1, bob: 0 });
    }
  }

  /** Items on the table or on their way to it. */
  count(): number {
    let n = 0;
    for (const f of this.foods) if (f.state === 'table' || f.state === 'toss') n++;
    return n;
  }

  has(kind: FoodKind): boolean {
    for (const f of this.foods) if (f.kind === kind && (f.state === 'table' || f.state === 'toss')) return true;
    return false;
  }

  /** Put an item straight onto the table at local polar (r, a). */
  place(kind: FoodKind, r: number, a: number): Food | null {
    const f = this.take(kind);
    if (!f) return null;
    f.state = 'table';
    f.r = r;
    f.a = a;
    return f;
  }

  /** Toss an item from a screen point onto a spot of the table (a free one unless given). */
  toss(kind: FoodKind, fromX: number, fromY: number, spot?: { r: number; a: number }): Food | null {
    const f = this.take(kind);
    if (!f) return null;
    const s = spot ?? this.freeSpot();
    f.state = 'toss';
    f.r = s.r;
    f.a = s.a;
    f.fx = fromX;
    f.fy = fromY;
    f.tossT = 0;
    f.tossMs = 640 + this.rand() * 160;
    return f;
  }

  /** A free spot on the table (local polar), away from the other items. */
  freeSpot(rMin = FOOD_R_MIN, rMax = FOOD_R_MAX): { r: number; a: number } {
    let best = { r: (rMin + rMax) / 2, a: 0 };
    let bestD = -1;
    for (let tries = 0; tries < 10; tries++) {
      const r = Math.sqrt(rMin * rMin + this.rand() * (rMax * rMax - rMin * rMin));
      const a = this.rand() * Math.PI * 2;
      const px = r * Math.cos(a);
      const py = r * Math.sin(a);
      let d = 1e9;
      for (const f of this.foods) {
        if (f.state !== 'table' && f.state !== 'toss') continue;
        d = Math.min(d, Math.hypot(f.r * Math.cos(f.a) - px, f.r * Math.sin(f.a) - py));
      }
      if (d > 90) return { r, a };
      if (d > bestD) {
        bestD = d;
        best = { r, a };
      }
    }
    return best;
  }

  /** Drop an item back onto the table near a plane point (a fumbled haul), bouncing a little. */
  drop(f: Food, x: number, y: number): void {
    let px = x + (this.rand() - 0.5) * 70;
    let py = y + (this.rand() - 0.5) * 70;
    const r = Math.hypot(px, py);
    if (r > FOOD_R_MAX) {
      px *= FOOD_R_MAX / r;
      py *= FOOD_R_MAX / r;
    }
    const loc = toLocal(px, py, this.angle);
    f.state = 'table';
    f.r = Math.max(FOOD_R_MIN * 0.5, loc.r);
    f.a = loc.a;
    f.z = 40;
    f.vz = 300 + this.rand() * 200;
    f.spr.setScale(this.hasAtlas ? FOOD_SCALE : f.spr.scaleX).setVisible(true);
    f.shadow.setVisible(true);
  }

  /** Back to the pool (eaten, or carried off). */
  release(f: Food): void {
    f.state = 'free';
    f.spr.setVisible(false);
    f.shadow.setVisible(false);
    f.glint?.setVisible(false);
  }

  /** Items near a plane point hop up and skitter (the rolling pin landing). */
  hop(x: number, y: number, radius: number): void {
    const d0 = Math.hypot(x, y);
    for (const f of this.foods) {
      if (f.state !== 'table') continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d > radius) continue;
      f.vz = 420 + (1 - d / radius) * 380;
      f.z = Math.max(f.z, 1);
      f.r = Math.min(FOOD_R_MAX, Math.max(FOOD_R_MIN * 0.6, f.r + (f.r > d0 ? 26 : -18)));
    }
  }

  update(dt: number): void {
    const s = dt / 1000;
    this.clock += dt;
    for (const f of this.foods) {
      if (f.state === 'toss') this.flyToss(f, dt);
      if (f.state !== 'table') continue;
      onTable(f.r, f.a, this.angle, this.tmp);
      f.x = this.tmp.x;
      f.y = this.tmp.y;
      if (f.z > 0 || f.vz !== 0) {
        f.vz -= 2600 * s;
        f.z += f.vz * s;
        if (f.z <= 0) {
          f.z = 0;
          f.vz = Math.abs(f.vz) > 260 ? -f.vz * 0.3 : 0;
        }
      }
      f.bob += s * 2.2;
      const sx = tsx(f.x);
      const sy = tsy(f.y);
      f.spr.setPosition(sx, sy - f.z - (f.kind === 'roast' ? 2 + Math.sin(f.bob) * 2 : 0)).setDepth(D_FOOD + f.y * 0.01).setAngle(0);
      f.shadow.setPosition(sx, sy + 2);
      if (f.glint) f.glint.setPosition(sx, sy - 22 - f.z).setAngle(this.clock * 0.05);
    }
  }

  private take(kind: FoodKind): Food | null {
    const f = this.foods.find((q) => q.state === 'free');
    if (!f) return null;
    f.kind = kind;
    f.z = 0;
    f.vz = 0;
    f.bob = this.rand() * 6;
    if (this.hasAtlas) f.spr.setTexture('pirates-snatch', kind).setScale(FOOD_SCALE).clearTint();
    else f.spr.setTexture('fx-dot').setScale(kind === 'roast' ? 3.4 : 2.4).setTint(kind === 'roast' ? 0xffc83a : kind === 'meat' ? 0xb5602a : 0xe84b3c);
    f.spr.setVisible(true).setAlpha(1).setAngle(0);
    f.shadow.setVisible(true).setAlpha(0.45).setScale(kind === 'roast' ? 0.75 : 0.5, kind === 'roast' ? 0.24 : 0.16);
    if (kind === 'roast' && this.scene.textures.exists('fx-rays')) {
      f.glint = f.glint ?? this.scene.add.image(0, 0, 'fx-rays').setTint(0xffd23a).setBlendMode(Phaser.BlendModes.ADD);
      f.glint.setVisible(true).setAlpha(0.7).setScale(0.36);
    } else f.glint?.setVisible(false);
    return f;
  }

  /** A toss arcs from the cook's tentacle to its (turning) landing spot. */
  private flyToss(f: Food, dt: number): void {
    f.tossT += dt;
    const u = Math.min(1, f.tossT / f.tossMs);
    const land = onTable(f.r, f.a, this.angle, this.tmp);
    const lx = tsx(land.x);
    const ly = tsy(land.y);
    const x = f.fx + (lx - f.fx) * u;
    const y = f.fy + (ly - f.fy) * u - Math.sin(u * Math.PI) * 170;
    f.x = land.x;
    f.y = land.y;
    f.spr.setPosition(x, y).setDepth(D_FOOD + 50).setAngle(f.kind === 'roast' ? 0 : u * 360);
    f.shadow.setPosition(lx, ly).setAlpha(0.2 + 0.3 * u);
    f.glint?.setPosition(x, y);
    if (u < 1) return;
    f.state = 'table';
    f.z = 0;
    f.vz = 180;
    audio.play('pop', { volume: 0.3, rate: 0.9 + this.rand() * 0.3, throttleMs: 40 });
    this.rings.burst(lx, ly, { tint: 0xfff2d0, from: 30, to: 110, squash: K, duration: 320, alpha: 0.5, depth: D_DECAL });
    if (f.kind === 'roast') {
      this.scene.fx.sparks(lx, ly - 30, liteCount(14));
      shockwave(this.scene, lx, ly, { radius: 90, ratio: K, color: 0xffd23a, alpha: 0.8, duration: 380, depth: D_DECAL });
    }
  }
}

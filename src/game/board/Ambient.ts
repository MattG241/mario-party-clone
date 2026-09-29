// Ambient life on the board: cloud shadows gliding over the islands, a flock of birds now and
// then, glints on the water, mist at the waterfall, bunting swaying, petals on the breeze, and at
// dusk lanterns, glowing spaces and fireflies. Everything is pooled and built once; the per-frame
// update only moves existing objects (no allocations), Lite runs roughly half the counts, and
// Reduced Motion drops the fast movers (birds, petals).
//
// Placement never reads the pixels of a particular render by hand: water is found by sampling the
// terrain tiles once at load (whatever art is installed), lanterns and bunting come from the
// render manifest, and spaces from the board graph.
import Phaser from 'phaser';
import { DEPTH } from '../constants';
import { LITE } from '../perf';
import { renderedTileKey, type RenderedProp } from '../data/rendered';
import { settings } from '../save/SettingsManager';
import type { BoardManager } from './BoardManager';
import { GROUND_SQUASH, SPACE_COLORS } from './boardStyle';
import { lerpColor, type Look } from './DayCycle';

/** The breeze: everything light drifts this way (normalised-ish, board px). */
const WIND_X = 1;
const WIND_Y = 0.32;
/** Terrain sampling step when looking for water (render px per sample). */
const WATER_STEP = 16;
/** Render scale WATER_STEP is tuned for (Lite renders at half this, so it samples twice as finely). */
const WATER_REF_SCALE = 1.25;
/** Waterfall splash pools, in board coordinates (kept only if water is really there). */
/** Suncoil's falls; world boards list theirs in their theme. */
const SUNCOIL_FALLS: { x: number; y: number; lipX: number; lipY: number }[] = [{ x: 2290, y: 1000, lipX: 2250, lipY: 805 }];

/** Depths: sparkles lie on the terrain; drifting things float over the world, under effects. */
const D_WATER = DEPTH.islands + 2;
const D_CLOUD = DEPTH.worldFx - 20;
const D_BIRD_SHADOW = DEPTH.worldFx - 19;
const D_BIRD = DEPTH.worldFx - 12;
const D_PETAL = DEPTH.worldFx - 11;
const D_FIREFLY = DEPTH.worldFx - 10;

interface Glint {
  s: Phaser.GameObjects.Image;
  life: number;
  dur: number;
  wait: number;
  size: number;
}

interface Drifter {
  s: Phaser.GameObjects.Image;
  on: boolean;
  vx: number;
  vy: number;
  spin: number;
  phase: number;
  /** Petals cross the view; tree leaves fall to the ground under their tree. */
  floorY: number;
}

interface Firefly {
  s: Phaser.GameObjects.Image;
  hx: number;
  hy: number;
  r: number;
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  blink: number;
}

interface Puff {
  s: Phaser.GameObjects.Image;
  life: number;
  dur: number;
  x0: number;
  y0: number;
  big: number;
}

interface Bird {
  s: Phaser.GameObjects.Image;
  sh: Phaser.GameObjects.Image;
  ox: number;
  oy: number;
  phase: number;
}

interface Cloud {
  s: Phaser.GameObjects.Image;
  speed: number;
}

interface Glow {
  halo: Phaser.GameObjects.Image;
  pool?: Phaser.GameObjects.Image;
  flicker: number;
  base: number;
}

interface Sway {
  rope: Phaser.GameObjects.Rope;
  n: number;
  amp: number;
  phase: number;
}

/** Small generated textures for the ambient life (and the relic's sparkles); made once per game. */
export function ensureAmbientTextures(scene: Phaser.Scene): void {
  const tx = scene.textures;
  if (!tx.exists('amb-cloud')) {
    // A lumpy, very soft cloud shadow (alpha does the work; the objects keep it faint).
    const t = tx.createCanvas('amb-cloud', 256, 128);
    if (t) {
      const ctx = t.getContext();
      const blobs: [number, number, number][] = [
        [70, 70, 52],
        [120, 56, 60],
        [176, 66, 50],
        [140, 84, 46],
        [96, 86, 40],
      ];
      for (const [x, y, r] of blobs) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(14,24,48,0.55)');
        g.addColorStop(0.6, 'rgba(14,24,48,0.32)');
        g.addColorStop(1, 'rgba(14,24,48,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 128);
      }
      t.refresh();
    }
  }
  if (!tx.exists('amb-bird')) {
    // A gull in flight: two swept wings (flapping squashes it vertically).
    const t = tx.createCanvas('amb-bird', 48, 24);
    if (t) {
      const ctx = t.getContext();
      ctx.fillStyle = '#2b2a3c';
      ctx.beginPath();
      ctx.moveTo(2, 8);
      ctx.quadraticCurveTo(14, 2, 24, 14);
      ctx.quadraticCurveTo(34, 2, 46, 8);
      ctx.quadraticCurveTo(34, 7, 24, 19);
      ctx.quadraticCurveTo(14, 7, 2, 8);
      ctx.fill();
      t.refresh();
    }
  }
  if (!tx.exists('amb-glint')) {
    // Four-point sparkle with a soft core.
    const t = tx.createCanvas('amb-glint', 32, 32);
    if (t) {
      const ctx = t.getContext();
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 9);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (const [w, h] of [
        [2.2, 15],
        [15, 2.2],
      ]) {
        ctx.beginPath();
        ctx.moveTo(16, 16 - h);
        ctx.lineTo(16 + w, 16);
        ctx.lineTo(16, 16 + h);
        ctx.lineTo(16 - w, 16);
        ctx.closePath();
        ctx.fill();
      }
      t.refresh();
    }
  }
  if (!tx.exists('amb-petal')) {
    const t = tx.createCanvas('amb-petal', 18, 12);
    if (t) {
      const ctx = t.getContext();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(9, 6, 8, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.ellipse(10, 7.5, 5, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      t.refresh();
    }
  }
}

export class Ambient {
  private readonly lite = LITE;
  private water: Float32Array = new Float32Array(0);
  private glints: Glint[] = [];
  private drifters: Drifter[] = [];
  private flies: Firefly[] = [];
  private puffs: Puff[] = [];
  private birds: Bird[] = [];
  private clouds: Cloud[] = [];
  private glows: Glow[] = [];
  private halos: { img: Phaser.GameObjects.Image; id: string }[] = [];
  private sways: Sway[] = [];
  /** A tree whose canopy sheds the odd leaf (board px rect). */
  private canopy: Phaser.Geom.Rectangle | null = null;
  private time = 0;
  private flockIn = 9000;
  private flockLeft = 0;
  private flockVX = 0;
  private flockVY = 0;
  private leafIn = 2000;
  private petalIn = 600;
  private area = new Phaser.Geom.Rectangle();
  /** Current mood (see DayCycle). */
  private sun = 1;
  private glow = 0;
  private glintTint = 0xffffff;
  private mistTint = 0xffffff;

  constructor(
    private scene: Phaser.Scene,
    private board: BoardManager,
  ) {}

  build(): void {
    ensureAmbientTextures(this.scene);
    const b = this.board.bounds();
    // Everything that roams wraps inside the board with a margin round the rim.
    this.area.setTo(b.x - 700, b.y - 600, b.width + 1400, b.height + 1100);
    this.findWater();
    this.buildGlints();
    this.buildMist();
    this.buildClouds();
    this.buildBirds();
    this.buildDrifters();
    this.buildFireflies();
    this.buildLights();
    this.buildSpaceHalos();
    this.buildBunting();
  }

  private get reduced(): boolean {
    return settings.get().reducedMotion;
  }

  // --- Water ----------------------------------------------------------------------------------
  /** Find water in the installed terrain render: one small downsampled read per tile, once. */
  private findWater(): void {
    const art = this.board.renderedArt();
    if (!art || typeof document === 'undefined') return;
    const out: number[] = [];
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const k = 1 / art.scale;
      // The same spacing on the board whatever resolution the terrain was loaded at.
      const step = Math.max(4, Math.round((WATER_STEP * art.scale) / WATER_REF_SCALE));
      for (const t of art.tiles) {
        const key = renderedTileKey(this.board.def.id, t.file);
        if (!this.scene.textures.exists(key)) continue;
        const src = this.scene.textures.get(key).getSourceImage() as CanvasImageSource;
        const sw = Math.max(1, Math.ceil(t.w / step));
        const sh = Math.max(1, Math.ceil(t.h / step));
        canvas.width = sw;
        canvas.height = sh;
        ctx.clearRect(0, 0, sw, sh);
        ctx.drawImage(src, 0, 0, sw, sh);
        const d = ctx.getImageData(0, 0, sw, sh).data;
        for (let j = 0; j < sh; j++) {
          for (let i = 0; i < sw; i++) {
            const o = (j * sw + i) * 4;
            const r = d[o];
            const g = d[o + 1];
            const bl = d[o + 2];
            // Cyan-blue, clearly bluer than it is red: ponds, brooks and falls (never grass,
            // paths, cliffs or the lavender fields).
            if (d[o + 3] > 200 && bl > 110 && bl > r + 50 && g > r + 25 && bl >= g - 10) {
              out.push(art.origin[0] + (t.x + ((i + 0.5) * t.w) / sw) * k, art.origin[1] + (t.y + ((j + 0.5) * t.h) / sh) * k);
            }
          }
        }
      }
    } catch {
      // Unreadable textures (should not happen with same-origin art): simply no water sparkle.
      return;
    }
    this.water = Float32Array.from(out);
  }

  private waterNear(x: number, y: number, r: number): number {
    let n = 0;
    const w = this.water;
    for (let i = 0; i < w.length; i += 2) if (Math.abs(w[i] - x) < r && Math.abs(w[i + 1] - y) < r) n++;
    return n;
  }

  private buildGlints(): void {
    if (this.water.length === 0) return;
    const n = this.lite ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const s = this.scene.add.image(0, 0, 'amb-glint').setBlendMode(Phaser.BlendModes.ADD).setDepth(D_WATER).setVisible(false);
      this.glints.push({ s, life: 0, dur: 1, wait: Math.random() * 1500, size: 0.5 });
    }
  }

  /** Index of a random water point inside the view (-1 when no water is on screen). */
  private waterInView(view: Phaser.Geom.Rectangle): number {
    const w = this.water;
    const count = w.length / 2;
    for (let a = 0; a < 8; a++) {
      const i = Math.floor(Math.random() * count) * 2;
      if (view.contains(w[i], w[i + 1])) return i;
    }
    return -1;
  }

  private updateGlints(dt: number, view: Phaser.Geom.Rectangle): void {
    // Sunlight sparkles most by day; at night only a few moonlit twinkles remain.
    const strength = 0.35 + 0.65 * this.sun;
    for (const g of this.glints) {
      if (g.wait > 0) {
        g.wait -= dt;
        if (g.wait <= 0) {
          const i = this.waterInView(view);
          if (i < 0 || Math.random() > strength) {
            g.wait = 300 + Math.random() * 900;
            continue;
          }
          g.life = 0;
          g.dur = 500 + Math.random() * 700;
          g.size = 0.35 + Math.random() * 0.45;
          g.s.setPosition(this.water[i] + (Math.random() - 0.5) * 10, this.water[i + 1] + (Math.random() - 0.5) * 8).setVisible(true).setTint(this.glintTint);
        }
        continue;
      }
      g.life += dt;
      const k = g.life / g.dur;
      if (k >= 1) {
        g.s.setVisible(false);
        g.wait = 150 + Math.random() * 1400;
        continue;
      }
      const a = Math.sin(k * Math.PI);
      g.s.setScale(g.size * (0.4 + a * 0.8)).setAlpha(a * 0.95).setRotation(k * 0.6);
    }
  }

  // --- Waterfall mist ------------------------------------------------------------------------
  private buildMist(): void {
    const def = this.board.graph.def;
    for (const f of def.theme ? (def.theme.waterfalls ?? []) : SUNCOIL_FALLS) {
      if (this.waterNear(f.x, f.y, 55) < 2) continue;
      const n = this.lite ? 4 : 8;
      for (let i = 0; i < n; i++) {
        const s = this.scene.add.image(f.x, f.y, 'fx-dot').setDepth(D_WATER + 1).setAlpha(0);
        this.puffs.push({ s, life: Math.random() * 2000, dur: 1800 + Math.random() * 1400, x0: f.x, y0: f.y, big: 0 });
      }
      // A couple of spray sparkles where the water tips over the lip.
      const n2 = this.lite ? 1 : 3;
      for (let i = 0; i < n2; i++) {
        const s = this.scene.add.image(f.lipX, f.lipY, 'fx-dot').setDepth(D_WATER + 1).setAlpha(0);
        this.puffs.push({ s, life: Math.random() * 900, dur: 700 + Math.random() * 500, x0: f.lipX, y0: f.lipY, big: -1 });
      }
    }
  }

  private updateMist(dt: number): void {
    for (const p of this.puffs) {
      p.life += dt;
      if (p.life >= p.dur) {
        p.life -= p.dur;
        p.big = p.big < 0 ? -1 : 0.7 + Math.random() * 0.8;
      }
      const k = p.life / p.dur;
      const a = Math.sin(k * Math.PI);
      if (p.big < 0) {
        // Lip spray: small quick puffs.
        p.s.setPosition(p.x0 + (k - 0.5) * 24, p.y0 + k * 14).setScale(1.2 + k * 1.6).setAlpha(a * 0.35).setTint(this.mistTint);
      } else {
        // Mist billows up and drifts downwind from the splash pool.
        const sc = (2.2 + k * 3.4) * (p.big || 1);
        p.s.setPosition(p.x0 + (k * 70 - 20) * WIND_X + Math.sin(k * 5 + p.dur) * 10, p.y0 - k * 70).setScale(sc, sc * 0.8).setAlpha(a * 0.3).setTint(this.mistTint);
      }
    }
  }

  // --- Cloud shadows --------------------------------------------------------------------------
  private buildClouds(): void {
    // Big soft quads cost fill rate: Lite (TV GPUs) gets one smaller cloud, Full three.
    const n = this.lite ? 1 : 3;
    const k = this.lite ? 0.75 : 1;
    for (let i = 0; i < n; i++) {
      const s = this.scene.add.image(0, 0, 'amb-cloud').setDepth(D_CLOUD).setScale((4.4 + i * 0.9) * k, (3.6 + i * 0.6) * k).setAlpha(0);
      s.setPosition(this.area.x + ((i + 0.3) / n) * this.area.width, this.area.y + ((i * 0.37 + 0.2) % 1) * this.area.height);
      this.clouds.push({ s, speed: 26 + i * 7 });
    }
  }

  private updateClouds(dt: number): void {
    const a = 0.2 * this.sun;
    for (const c of this.clouds) {
      const s = c.s;
      s.x += WIND_X * c.speed * dt * 0.001;
      s.y += WIND_Y * c.speed * dt * 0.001;
      // Wrap round the board (off-screen, so the jump is never seen).
      if (s.x - s.displayWidth / 2 > this.area.right) s.x = this.area.x - s.displayWidth / 2;
      if (s.y - s.displayHeight / 2 > this.area.bottom) s.y = this.area.y - s.displayHeight / 2;
      s.setAlpha(a);
      s.setVisible(a > 0.01);
    }
  }

  // --- Birds ------------------------------------------------------------------------------------
  private buildBirds(): void {
    const n = this.lite ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const s = this.scene.add.image(0, 0, 'amb-bird').setDepth(D_BIRD).setVisible(false);
      const sh = this.scene.add.image(0, 0, 'fx-dot').setDepth(D_BIRD_SHADOW).setTint(0x0e1830).setVisible(false);
      // A loose V: the leader ahead, the others trailing to both sides.
      const row = Math.ceil(i / 2);
      const side = i % 2 ? -1 : 1;
      this.birds.push({ s, sh, ox: -row * 46 + Math.random() * 10, oy: side * row * 30 + Math.random() * 8, phase: Math.random() * Math.PI * 2 });
    }
  }

  private launchFlock(view: Phaser.Geom.Rectangle): void {
    // Enter from the left or right edge of the view and cross it on a gentle slant.
    const fromLeft = Math.random() < 0.65;
    const speed = 240 + Math.random() * 80;
    this.flockVX = fromLeft ? speed : -speed;
    this.flockVY = (Math.random() - 0.5) * 70;
    const x0 = fromLeft ? view.x - 160 : view.right + 160;
    const y0 = view.y + view.height * (0.18 + Math.random() * 0.5);
    const count = this.lite ? 3 : 3 + Math.floor(Math.random() * 4);
    this.birds.forEach((b, i) => {
      const on = i < count;
      b.s.setVisible(on).setFlipX(!fromLeft);
      b.sh.setVisible(on);
      if (on) b.s.setPosition(x0 + (fromLeft ? b.ox : -b.ox), y0 + b.oy);
    });
    this.flockLeft = (view.width + 500) / speed * 1000;
  }

  private updateBirds(dt: number, view: Phaser.Geom.Rectangle): void {
    if (this.birds.length === 0) return;
    if (this.flockLeft <= 0) {
      this.flockIn -= dt;
      if (this.flockIn <= 0) {
        this.flockIn = (this.lite ? 32000 : 20000) + Math.random() * 18000;
        // Birds roost at night and stay away when Reduced Motion is on.
        if (this.sun > 0.3 && !this.reduced) this.launchFlock(view);
      }
      return;
    }
    this.flockLeft -= dt;
    const zoomK = Phaser.Math.Clamp(0.9 / this.scene.cameras.main.zoom, 1, 2.2);
    for (const b of this.birds) {
      if (!b.s.visible) continue;
      b.phase += dt * 0.012;
      b.s.x += this.flockVX * dt * 0.001;
      b.s.y += (this.flockVY + Math.sin(b.phase * 0.25) * 16) * dt * 0.001;
      // Wing beats (squash), gliding now and then.
      const beat = Math.sin(b.phase);
      b.s.setScale(0.9 * zoomK, (0.35 + 0.65 * Math.abs(beat)) * (beat > 0 ? 1 : -0.7) * zoomK);
      // They fly high: their shadows land well below them, faint and soft.
      b.sh.setPosition(b.s.x + 70, b.s.y + 230).setScale(1.3 * zoomK, 0.45 * zoomK).setAlpha(0.16 * this.sun);
      if (this.flockLeft <= 0) {
        b.s.setVisible(false);
        b.sh.setVisible(false);
      }
    }
  }

  // --- Petals and leaves ----------------------------------------------------------------------
  private buildDrifters(): void {
    const n = this.lite ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const s = this.scene.add.image(0, 0, 'amb-petal').setDepth(D_PETAL).setVisible(false);
      this.drifters.push({ s, on: false, vx: 0, vy: 0, spin: 0, phase: 0, floorY: 0 });
    }
    const tree = this.board.renderedArt()?.props?.find((p) => p.kind === 'twist_tree' || p.id.includes('tree'));
    if (tree) this.canopy = new Phaser.Geom.Rectangle(tree.x + tree.w * 0.12, tree.y + tree.h * 0.05, tree.w * 0.76, tree.h * 0.5);
  }

  private spawnDrifter(x: number, y: number, leaf: boolean, floorY: number): void {
    let d: Drifter | null = null;
    for (const q of this.drifters) {
      if (!q.on) {
        d = q;
        break;
      }
    }
    if (!d) return;
    d.on = true;
    d.vx = (leaf ? 22 : 70) + Math.random() * 40;
    d.vy = (leaf ? 60 : 38) + Math.random() * 30;
    d.spin = (Math.random() - 0.5) * 5;
    d.phase = Math.random() * Math.PI * 2;
    d.floorY = floorY;
    const pinks = [0xffc9dd, 0xffe1ec, 0xfff3c4];
    const tint = leaf ? (Math.random() < 0.5 ? 0x9bd36a : 0xc9e27a) : pinks[Math.floor(Math.random() * pinks.length)];
    d.s.setPosition(x, y).setTint(tint).setAlpha(0).setVisible(true).setScale(leaf ? 1.1 : 0.9);
  }

  private updateDrifters(dt: number, view: Phaser.Geom.Rectangle): void {
    if (this.drifters.length === 0) return;
    const day = this.sun > 0.35 && !this.reduced;
    // Petals ride the breeze in from the upwind edges of the view.
    this.petalIn -= dt;
    if (day && this.petalIn <= 0) {
      this.petalIn = (this.lite ? 1400 : 700) + Math.random() * 900;
      if (Math.random() < 0.6) this.spawnDrifter(view.x - 30, view.y + Math.random() * view.height * 0.8, false, Number.POSITIVE_INFINITY);
      else this.spawnDrifter(view.x + Math.random() * view.width * 0.8, view.y - 30, false, Number.POSITIVE_INFINITY);
    }
    // The big grove tree sheds a leaf now and then while it is on screen.
    this.leafIn -= dt;
    if (day && this.canopy && this.leafIn <= 0) {
      this.leafIn = 1800 + Math.random() * 2600;
      const c = this.canopy;
      if (Phaser.Geom.Rectangle.Overlaps(view, c)) this.spawnDrifter(c.x + Math.random() * c.width, c.y + Math.random() * c.height, true, c.bottom + c.height * 0.9);
    }
    const s = dt * 0.001;
    const zoomK = Phaser.Math.Clamp(0.9 / this.scene.cameras.main.zoom, 1, 1.8);
    for (const d of this.drifters) {
      if (!d.on) continue;
      d.phase += dt * 0.004;
      const sway = Math.sin(d.phase) * 40;
      d.s.x += (d.vx * WIND_X + sway) * s;
      d.s.y += (d.vy + Math.cos(d.phase * 1.3) * 18) * s;
      d.s.rotation += d.spin * s;
      // Tumbling: the petal turns edge-on and back.
      d.s.scaleX = Math.cos(d.phase * 1.7) * 0.9 * zoomK;
      d.s.scaleY = 0.9 * zoomK;
      const target = day ? 0.9 : 0;
      d.s.alpha += (target - d.s.alpha) * Math.min(1, s * 3);
      if (d.s.y > d.floorY || d.s.x > view.right + 60 || d.s.y > view.bottom + 60 || (!day && d.s.alpha < 0.02)) {
        d.on = false;
        d.s.setVisible(false);
      }
    }
  }

  // --- Fireflies (dusk) -----------------------------------------------------------------------
  private buildFireflies(): void {
    const n = this.lite ? 10 : 24;
    for (let i = 0; i < n; i++) {
      const s = this.scene.add.image(0, 0, 'fx-dot').setDepth(D_FIREFLY).setBlendMode(Phaser.BlendModes.ADD).setTint(i % 3 ? 0xf2ff8a : 0xc8ff78).setVisible(false);
      this.flies.push({ s, hx: 0, hy: 0, r: 50 + Math.random() * 70, w1: 0.4 + Math.random() * 0.5, w2: 0.5 + Math.random() * 0.6, p1: Math.random() * 7, p2: Math.random() * 7, blink: Math.random() * 7 });
    }
  }

  private updateFireflies(dt: number, view: Phaser.Geom.Rectangle): void {
    const a = Phaser.Math.Clamp((this.glow - 0.3) / 0.6, 0, 1);
    const on = a > 0.01;
    const t = this.time * 0.001;
    const zoomK = Phaser.Math.Clamp(0.9 / this.scene.cameras.main.zoom, 1, 2);
    for (const f of this.flies) {
      if (!on) {
        if (f.s.visible) f.s.setVisible(false);
        continue;
      }
      // Keep them where the players are looking: re-home any that drifted out of the view.
      if (!f.s.visible || !view.contains(f.hx, f.hy)) {
        f.hx = view.x + Math.random() * view.width;
        f.hy = view.y + view.height * (0.15 + Math.random() * 0.8);
        f.s.setVisible(true);
      }
      f.blink += dt * 0.0022;
      const pulse = Math.max(0, Math.sin(f.blink) * 1.3 - 0.3);
      f.s.setPosition(f.hx + Math.sin(t * f.w1 + f.p1) * f.r, f.hy + Math.sin(t * f.w2 + f.p2) * f.r * 0.6);
      f.s.setAlpha(a * pulse).setScale((0.32 + pulse * 0.2) * zoomK);
    }
  }

  // --- Lanterns, crystals and space halos -----------------------------------------------------
  /** Brightest warm (or cool) spot in a prop render, in board coordinates. */
  private brightSpot(p: RenderedProp, cool: boolean): { x: number; y: number } | null {
    const key = renderedTileKey(this.board.def.id, p.file);
    if (!this.scene.textures.exists(key) || typeof document === 'undefined') return null;
    try {
      const canvas = document.createElement('canvas');
      const sw = 24;
      const sh = Math.max(8, Math.round((24 * p.h) / p.w));
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(this.scene.textures.get(key).getSourceImage() as CanvasImageSource, 0, 0, sw, sh);
      const d = ctx.getImageData(0, 0, sw, sh).data;
      let best = -1;
      let bi = -1;
      for (let i = 0; i < sw * sh; i++) {
        const o = i * 4;
        if (d[o + 3] < 180) continue;
        const r = d[o];
        const g = d[o + 1];
        const b = d[o + 2];
        const score = cool ? (b > 170 && g > 150 && r < b - 20 ? b + g - r : -1) : r > 200 && g > 170 && b > 90 ? r + g + b * 0.5 : -1;
        if (score > best) {
          best = score;
          bi = i;
        }
      }
      if (bi < 0) return null;
      return { x: p.x + (((bi % sw) + 0.5) / sw) * p.w, y: p.y + ((Math.floor(bi / sw) + 0.5) / sh) * p.h };
    } catch {
      return null;
    }
  }

  private buildLights(): void {
    const props = this.board.renderedArt()?.props ?? [];
    const add = (x: number, y: number, color: number, size: number, poolAt?: { x: number; y: number }) => {
      const halo = this.scene.add.image(x, y, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(size).setDepth(DEPTH.worldFx - 30).setVisible(false);
      let pool: Phaser.GameObjects.Image | undefined;
      if (poolAt) pool = this.scene.add.image(poolAt.x, poolAt.y, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(size * 2.4, size * 2.4 * GROUND_SQUASH * 0.6).setDepth(DEPTH.paths + 2).setVisible(false);
      this.glows.push({ halo, pool, flicker: Math.random() * 7, base: size });
    };
    for (const p of props) {
      if (p.kind === 'lantern') {
        const spot = this.brightSpot(p, false) ?? { x: p.x + p.w * 0.55, y: p.y + p.h * 0.28 };
        add(spot.x, spot.y, 0xffc36a, 5.4, { x: p.anchorX + 12, y: p.baseY - 4 });
      } else if (p.kind === 'crystal_gen') {
        const spot = this.brightSpot(p, true);
        if (spot) add(spot.x, spot.y, 0x7ae8ff, 5.2);
      }
    }
    // The placeholder lanterns (no rendered landmarks): light the top of each one.
    if (props.length === 0) {
      for (const d of this.board.def.decorations) if (d.texture === 'lantern') add(d.x, d.y - 110 * (d.scale ?? 1), 0xffc36a, 4.2, { x: d.x, y: d.y });
    }
  }

  private buildSpaceHalos(): void {
    // Each space glows in its own colour after dark, so the route reads even when the land dims.
    for (const n of this.board.def.nodes) {
      const img = this.scene.add
        .image(n.x, n.y + 2, 'fx-dot')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(SPACE_COLORS[n.type] ?? 0xffffff)
        .setScale(6.4, 6.4 * GROUND_SQUASH * 0.72)
        .setDepth(DEPTH.spaces - 0.5)
        .setVisible(false);
      this.halos.push({ img, id: n.id });
    }
  }

  private updateLights(dt: number): void {
    const g = this.glow;
    const on = g > 0.02;
    for (const l of this.glows) {
      l.halo.setVisible(on);
      l.pool?.setVisible(on);
      if (!on) continue;
      l.flicker += dt * 0.006;
      const f = 0.9 + Math.sin(l.flicker) * 0.06 + Math.sin(l.flicker * 2.7) * 0.04;
      l.halo.setAlpha(0.85 * g * f).setScale(l.base * (0.9 + 0.1 * f));
      l.pool?.setAlpha(0.7 * g * f);
    }
    const pulse = 0.85 + Math.sin(this.time * 0.002) * 0.15;
    for (const h of this.halos) {
      // Dormant spaces (the closed bridge or detour) stay dark.
      const vis = on && this.board.nodeOpen(h.id);
      if (h.img.visible !== vis) h.img.setVisible(vis);
      if (vis) h.img.setAlpha(0.55 * g * pulse);
    }
  }

  // --- Bunting ----------------------------------------------------------------------------------
  /**
   * Swap each rendered bunting for a rope that ripples in the breeze: the posts stay pinned (the
   * wave is zero at both ends) while the pennants between them bob. Full graphics only (ropes use
   * their own shader; Lite keeps the still render).
   */
  private buildBunting(): void {
    if (this.lite || this.scene.renderer.type !== Phaser.WEBGL) return;
    const props = this.board.renderedArt()?.props ?? [];
    for (const p of props) {
      if (p.kind !== 'bunting') continue;
      const img = this.board.decorations.get(p.id) as Phaser.GameObjects.Image | undefined;
      const key = renderedTileKey(this.board.def.id, p.file);
      if (!img || !this.scene.textures.exists(key)) continue;
      const n = 18;
      const fr = this.scene.textures.getFrame(key);
      // Points along the texture's middle line, centred on the rope's origin.
      const pts: Phaser.Types.Math.Vector2Like[] = [];
      for (let i = 0; i < n; i++) pts.push({ x: -fr.halfWidth + (i * fr.width) / (n - 1), y: 0 });
      const rope = this.scene.add.rope(p.x + p.w / 2, p.y + p.h / 2, key, undefined, pts, true);
      rope.setScale(p.w / fr.width, p.h / fr.height).setDepth(img.depth);
      img.setVisible(false);
      this.board.adoptLit(rope);
      this.sways.push({ rope, n, amp: fr.height * 0.018, phase: Math.random() * 7 });
    }
  }

  private updateBunting(): void {
    const t = this.time * 0.001;
    for (const w of this.sways) {
      const pts = w.rope.points;
      for (let i = 0; i < pts.length; i++) {
        const u = i / (pts.length - 1);
        const pin = Math.sin(u * Math.PI) ** 2;
        pts[i].y = pin * w.amp * (Math.sin(t * 2.1 + w.phase) + 0.45 * Math.sin(t * 5.3 + u * 7 + w.phase));
      }
      w.rope.setDirty();
    }
  }

  // --- Mood and frame ------------------------------------------------------------------------
  /** Follow the time of day (see DayCycle). */
  setMood(look: Look): void {
    this.sun = look.sun;
    this.glow = look.glow;
    // Glints go gold at golden hour and pale lilac by moonlight; mist takes the sky's colour.
    this.glintTint = lerpColor(0xffffff, look.land, 0.6);
    this.mistTint = lerpColor(0xffffff, look.skyTint, 0.7);
  }

  update(dt: number): void {
    const step = Math.min(dt, 100);
    this.time += step;
    const view = this.scene.cameras.main.worldView;
    this.updateGlints(step, view);
    this.updateMist(step);
    this.updateClouds(step);
    this.updateBirds(step, view);
    this.updateDrifters(step, view);
    this.updateFireflies(step, view);
    this.updateLights(step);
    this.updateBunting();
  }
}

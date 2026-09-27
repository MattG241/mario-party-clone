import Phaser from 'phaser';
import { settings } from '../save/SettingsManager';

/**
 * Screen-space ambience layered over the pre-rendered arenas: sun shafts, festival bunting,
 * tethered balloons and drifting dust motes. Everything here is decoration only (no gameplay),
 * honours reduced motion by holding still, and is built from generated textures.
 */

const PENNANT_COLORS = [0xf2644f, 0xffc93c, 0x2fb6a8, 0x7a5cd6, 0xf28f3b, 0x57b8ee];
const BALLOON_COLORS = [0xf2644f, 0xffc93c, 0x2fb6a8, 0x9a6ee6, 0x57b8ee, 0xff8fb1];

function reducedMotion(_scene: Phaser.Scene): boolean {
  return settings.get().reducedMotion;
}

/** Generate the ambience textures once (safe to call from any scene). */
export function ensureAmbienceTextures(scene: Phaser.Scene): void {
  const tx = scene.textures;
  if (!tx.exists('fx-shaft')) {
    // A long soft beam: gaussian across, fading in at the top and out toward the far end.
    const W = 128;
    const H = 512;
    const tex = tx.createCanvas('fx-shaft', W, H);
    if (tex) {
      const ctx = tex.getContext();
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const v = y / (H - 1);
        const along = Math.min(1, v / 0.12) * Math.pow(1 - v, 1.4);
        for (let x = 0; x < W; x++) {
          const u = (x / (W - 1)) * 2 - 1;
          const across = Math.exp(-u * u * 4.5);
          const a = Math.round(255 * across * along);
          const i = (y * W + x) * 4;
          img.data[i] = 255;
          img.data[i + 1] = 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = a;
        }
      }
      ctx.putImageData(img, 0, 0);
      tex.refresh();
    }
  }
  if (!tx.exists('fx-balloon')) {
    // A balloon body with baked shading, tinted per use; its highlight is a separate untinted
    // texture ('fx-balloon-shine') so it stays white.
    const W = 96;
    const H = 132;
    const tex = tx.createCanvas('fx-balloon', W, H);
    if (tex) {
      const ctx = tex.getContext();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(48, 52, 40, 48, 0, 0, Math.PI * 2);
      const body = ctx.createRadialGradient(34, 34, 4, 48, 56, 56);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.55, '#e8e8e8');
      body.addColorStop(1, '#8a8a8a');
      ctx.fillStyle = body;
      ctx.fill();
      ctx.restore();
      // knot
      ctx.fillStyle = '#9a9a9a';
      ctx.beginPath();
      ctx.moveTo(42, 104);
      ctx.lineTo(54, 104);
      ctx.lineTo(48, 96);
      ctx.closePath();
      ctx.fill();
      tex.refresh();
    }
  }
  if (!tx.exists('fx-balloon-shine')) {
    const tex = tx.createCanvas('fx-balloon-shine', 96, 132);
    if (tex) {
      const ctx = tex.getContext();
      const hl = ctx.createRadialGradient(32, 30, 1, 32, 30, 16);
      hl.addColorStop(0, 'rgba(255,255,255,0.95)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.ellipse(32, 30, 11, 16, -0.5, 0, Math.PI * 2);
      ctx.fill();
      tex.refresh();
    }
  }
}

export interface ShaftOpts {
  /** Where the light comes from (screen coords, usually off-screen top). */
  x: number;
  y: number;
  /** Beam direction in degrees (0 = straight down, positive leans right). */
  angle?: number;
  count?: number;
  /** Horizontal spread of the beam origins. */
  spread?: number;
  length?: number;
  width?: number;
  alpha?: number;
  tint?: number;
  depth?: number;
}

/** Soft additive sun shafts slanting across the scene, slowly breathing. */
export function addLightShafts(scene: Phaser.Scene, o: ShaftOpts): Phaser.GameObjects.Image[] {
  ensureAmbienceTextures(scene);
  const n = o.count ?? 5;
  const out: Phaser.GameObjects.Image[] = [];
  const still = reducedMotion(scene);
  const rnd = new Phaser.Math.RandomDataGenerator(['shafts']);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const w = (o.width ?? 150) * rnd.realInRange(0.55, 1.35);
    const len = (o.length ?? 1300) * rnd.realInRange(0.8, 1.1);
    const base = (o.alpha ?? 0.1) * rnd.realInRange(0.6, 1.2);
    const img = scene.add
      .image(o.x + (t - 0.5) * (o.spread ?? 900), o.y, 'fx-shaft')
      .setOrigin(0.5, 0)
      .setDisplaySize(w, len)
      .setAngle(-(o.angle ?? 24))
      .setTint(o.tint ?? 0xfff2cf)
      .setAlpha(base)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(o.depth ?? 400);
    out.push(img);
    if (!still) {
      scene.tweens.add({
        targets: img,
        alpha: { from: base * 0.45, to: base },
        duration: rnd.between(2600, 4600),
        delay: rnd.between(0, 2000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }
  }
  return out;
}

export interface BuntingOpts {
  depth?: number;
  /** Pennant size in pixels (height of the triangle). */
  size?: number;
  /** Sag at the middle of the rope. */
  sag?: number;
  spacing?: number;
  alpha?: number;
}

/** A rope of triangular pennants hung between two points, gently swaying. */
export function addBunting(scene: Phaser.Scene, x0: number, y0: number, x1: number, y1: number, o: BuntingOpts = {}): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(o.depth ?? 300);
  const size = o.size ?? 34;
  const sag = o.sag ?? 60;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(3, Math.round(len / (o.spacing ?? size * 1.25)));
  const at = (t: number) => ({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + sag * 4 * t * (1 - t) });
  const rope = scene.add.graphics();
  rope.lineStyle(3, 0x4a3320, 0.9);
  rope.beginPath();
  for (let k = 0; k <= 24; k++) {
    const p = at(k / 24);
    if (k === 0) rope.moveTo(p.x, p.y);
    else rope.lineTo(p.x, p.y);
  }
  rope.strokePath();
  c.add(rope);
  const still = reducedMotion(scene);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = at(t);
    const col = PENNANT_COLORS[i % PENNANT_COLORS.length];
    const g = scene.add.graphics({ x: p.x, y: p.y });
    const hw = size * 0.46;
    // shadow side, then the flag, then a light fold along the left edge
    g.fillStyle(0x000000, 0.18);
    g.fillTriangle(-hw + 3, 3, hw + 3, 3, 3, size + 3);
    g.fillStyle(col, 1);
    g.fillTriangle(-hw, 0, hw, 0, 0, size);
    g.fillStyle(0xffffff, 0.22);
    g.fillTriangle(-hw, 0, -hw * 0.25, 0, 0, size);
    g.fillStyle(0x000000, 0.12);
    g.fillTriangle(hw * 0.35, 0, hw, 0, 0, size);
    g.setAlpha(o.alpha ?? 1);
    c.add(g);
    if (!still) {
      scene.tweens.add({
        targets: g,
        angle: { from: -5, to: 5 },
        duration: 1300 + (i % 5) * 170,
        delay: i * 90,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }
  }
  return c;
}

/** A tethered cluster of balloons bobbing on strings from an anchor point. */
export function addBalloons(
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts: { count?: number; scale?: number; depth?: number; seed?: string; /** string length in unscaled pixels */ lift?: number } = {},
): Phaser.GameObjects.Container {
  ensureAmbienceTextures(scene);
  const rnd = new Phaser.Math.RandomDataGenerator([opts.seed ?? `${x},${y}`]);
  const c = scene.add.container(x, y).setDepth(opts.depth ?? 300);
  const sc = opts.scale ?? 0.7;
  const n = opts.count ?? 3;
  const still = reducedMotion(scene);
  for (let i = 0; i < n; i++) {
    const bx = (i - (n - 1) / 2) * 46 * sc + rnd.between(-8, 8);
    const lift = opts.lift ?? 180;
    const by = -rnd.between(lift * 0.82, lift * 1.16) * sc;
    const string = scene.add.graphics();
    const b = scene.add.container(bx, by);
    const col = BALLOON_COLORS[rnd.between(0, BALLOON_COLORS.length - 1)];
    b.add(scene.add.image(0, 0, 'fx-balloon').setOrigin(0.5, 0.79).setScale(sc).setTint(col));
    b.add(scene.add.image(0, 0, 'fx-balloon-shine').setOrigin(0.5, 0.79).setScale(sc));
    c.add([string, b]);
    const draw = () => {
      string.clear();
      string.lineStyle(2, 0xf6efe0, 0.85);
      string.beginPath();
      string.moveTo(0, 0);
      const mx = b.x * 0.5 + Math.sin(b.y * 0.05) * 6;
      string.lineTo(mx, b.y * 0.5);
      string.lineTo(b.x, b.y);
      string.strokePath();
    };
    draw();
    b.setAngle((bx / 46) * 6);
    if (!still) {
      scene.tweens.add({
        targets: b,
        y: by - 10 * sc,
        x: bx + rnd.between(-6, 6),
        angle: b.angle + rnd.between(-5, 5),
        duration: rnd.between(1800, 2600),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        onUpdate: draw,
      });
    }
  }
  return c;
}

/** Slow sunlit dust motes drifting through a region (additive, very subtle). */
export function addDustMotes(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: { count?: number; depth?: number; tint?: number } = {}): void {
  if (!scene.textures.exists('fx-dot') || reducedMotion(scene)) return;
  scene.add
    .particles(0, 0, 'fx-dot', {
      x: { min: x, max: x + w },
      y: { min: y, max: y + h },
      lifespan: { min: 5000, max: 9000 },
      speedX: { min: -8, max: 14 },
      speedY: { min: -10, max: 4 },
      scale: { min: 0.12, max: 0.32 },
      alpha: { onEmit: () => 0, onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => Math.sin(t * Math.PI) * 0.75 },
      tint: opts.tint ?? 0xfff3c8,
      blendMode: Phaser.BlendModes.ADD,
      frequency: 9000 / (opts.count ?? 40),
      advance: 9000,
    })
    .setDepth(opts.depth ?? 420);
}

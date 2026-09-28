// Game-feel pieces shared by Crate Craze, Skybridge Scramble and Spiral Splash: expanding rings
// flattened onto a floor or the water, directional particle sprays (splinters, droplets, dust,
// speed lines) and the few tiny textures they need. Everything is pooled up front and advanced by
// the minigame's own clock, so effects freeze during a hit-stop and crawl in slow motion. Lite
// (the TV mode) and Reduced Motion get smaller bursts; see `burst`.
import Phaser from 'phaser';
import { LITE } from '../../perf';
import { settings } from '../../save/SettingsManager';

/** Generated textures (made once per game, shared by every run). */
export const AFX = {
  /** A short splinter of wood or grit (white: tint it). */
  chip: 'afx-chip',
  /** A bright bead of water. */
  drop: 'afx-drop',
  /** A thin line fading out at both ends: speed lines and wind. */
  streak: 'afx-streak',
  /** A soft-edged ring for landings, shock rings and ripples. */
  ring: 'afx-ring',
} as const;

/** Radius of the ring drawn in the AFX.ring texture (px at scale 1). */
const RING_R = 58;

/** Particle count for a burst at this graphics level: Lite and Reduced Motion each halve it. */
export function burst(full: number): number {
  let n = full;
  if (LITE) n *= 0.5;
  if (settings.get().reducedMotion) n *= 0.5;
  return Math.max(1, Math.round(n));
}

/** Interval between trail particles: Lite emits them less often. */
export function every(ms: number): number {
  return LITE ? ms * 1.8 : ms;
}

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  paint(tex.getContext());
  tex.refresh();
}

/** Make the shared effect textures (all tiny: the largest is 128×128). */
export function ensureArenaFxTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, AFX.chip, 16, 8, (ctx) => {
    // Lit along the top edge so a tinted splinter still reads as a solid sliver.
    const g = ctx.createLinearGradient(0, 1, 0, 7);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#b8b8b8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(1, 4);
    ctx.lineTo(4, 1.5);
    ctx.lineTo(14, 2.5);
    ctx.lineTo(15, 5);
    ctx.lineTo(11, 6.5);
    ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
  });
  canvasTexture(scene, AFX.drop, 14, 14, (ctx) => {
    const g = ctx.createRadialGradient(6, 6, 0.5, 7, 7, 6.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f2f2f2');
    g.addColorStop(1, 'rgba(220,220,220,0.85)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(7, 7, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(5, 5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, AFX.streak, 96, 8, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 96, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(48, 4, 47, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, AFX.ring, 128, 128, (ctx) => {
    // A soft halo under a crisp line, so a flattened ring still reads at any size.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(64, 64, RING_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
  });
}

export interface RingOpts {
  /** Vertical squash (the floor's depth scale), so the ring lies on the ground. */
  squash?: number;
  tint?: number;
  alpha?: number;
  ms?: number;
  depth?: number;
  add?: boolean;
}

interface Ring {
  img: Phaser.GameObjects.Image;
  t: number;
  life: number;
  r0: number;
  r1: number;
  a0: number;
  squash: number;
}

/** Expanding rings on the floor or water (landings, shock rings, scoring). Fixed pool, no allocations. */
export class RingPool {
  private rings: Ring[] = [];

  constructor(scene: Phaser.Scene, size: number) {
    for (let i = 0; i < size; i++) {
      const img = scene.add.image(0, 0, AFX.ring).setVisible(false);
      this.rings.push({ img, t: 1, life: 1, r0: 0, r1: 0, a0: 0, squash: 1 });
    }
  }

  /** A ring growing from radius r0 to r1 (px) while it fades. Reuses the oldest ring when all are busy. */
  spawn(x: number, y: number, r0: number, r1: number, o: RingOpts = {}): void {
    let ring = this.rings[0];
    let oldest = -1;
    for (const r of this.rings) {
      const u = r.t / r.life;
      if (u >= 1) {
        ring = r;
        break;
      }
      if (u > oldest) {
        oldest = u;
        ring = r;
      }
    }
    if (!ring) return;
    ring.t = 0;
    ring.life = o.ms ?? 420;
    ring.r0 = r0;
    ring.r1 = r1;
    ring.a0 = o.alpha ?? 0.8;
    ring.squash = o.squash ?? 1;
    const s = r0 / RING_R;
    ring.img
      .setPosition(x, y)
      .setScale(s, s * ring.squash)
      .setAlpha(ring.a0)
      .setTint(o.tint ?? 0xffffff)
      .setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setDepth(o.depth ?? 0)
      .setVisible(true);
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (r.t >= r.life) continue;
      r.t += dt;
      const u = Math.min(1, r.t / r.life);
      const e = 1 - (1 - u) * (1 - u);
      const s = (r.r0 + (r.r1 - r.r0) * e) / RING_R;
      r.img.setScale(s, s * r.squash).setAlpha(r.a0 * (1 - u) * (1 - u * 0.3));
      if (u >= 1) r.img.setVisible(false);
    }
  }
}

export interface SprayConfig {
  depth: number;
  /** Pool size: particles are created up front and recycled. */
  reserve: number;
  lifespan: [number, number];
  gravity?: number;
  scale?: { start: number; end: number };
  alpha?: { start: number; end: number };
  tint?: number[];
  add?: boolean;
  /** Spin splinters as they fly (degrees per px/s of sideways speed, per frame). */
  spin?: number;
  /** Point each particle along its direction of travel (speed lines). */
  align?: boolean;
  frame?: string | number;
}

/**
 * A directional particle spray on one pooled emitter: `fire` sends n particles from a point in a
 * fan of directions. The direction, spread and speed are read through callbacks, so re-aiming a
 * burst allocates nothing.
 */
export class Spray {
  readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private a0 = 0;
  private a1 = 360;
  private s0 = 100;
  private s1 = 200;
  private l0: number;
  private l1: number;
  private readonly life: [number, number];

  constructor(scene: Phaser.Scene, texture: string, c: SprayConfig) {
    this.life = c.lifespan;
    this.l0 = c.lifespan[0];
    this.l1 = c.lifespan[1];
    const spin = c.spin ?? 0;
    const cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
      emitting: false,
      // Cap the live particles, not the total: `maxParticles` counts the reserved (dead) ones too,
      // so reserving that many would leave the emitter "full" before it ever fired.
      maxAliveParticles: c.reserve,
      reserve: c.reserve,
      lifespan: () => this.l0 + Math.random() * (this.l1 - this.l0),
      speed: () => this.s0 + Math.random() * (this.s1 - this.s0),
      angle: () => this.a0 + Math.random() * (this.a1 - this.a0),
      gravityY: c.gravity ?? 0,
      scale: c.scale ?? { start: 1, end: 1 },
      alpha: c.alpha ?? { start: 1, end: 0 },
      blendMode: c.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
    };
    if (c.frame !== undefined) cfg.frame = c.frame;
    if (c.tint) cfg.tint = c.tint;
    if (c.align) cfg.rotate = () => (this.a0 + this.a1) / 2;
    else if (spin)
      cfg.rotate = {
        onEmit: () => Math.random() * 360,
        onUpdate: (p: Phaser.GameObjects.Particles.Particle, _k: string, _t: number, v: number) => v + p.velocityX * spin,
      };
    this.emitter = scene.add.particles(0, 0, texture, cfg).setDepth(c.depth);
  }

  /**
   * n particles from (x, y) heading `angle` ± `spread` degrees (screen space; 0 = right, 90 = down)
   * at speeds s0..s1 px/s. Optionally override the lifespan for this burst.
   */
  fire(x: number, y: number, n: number, angle: number, spread: number, s0: number, s1: number, life?: [number, number]): void {
    this.a0 = angle - spread;
    this.a1 = angle + spread;
    this.s0 = s0;
    this.s1 = s1;
    const l = life ?? this.life;
    this.l0 = l[0];
    this.l1 = l[1];
    this.emitter.emitParticleAt(x, y, n);
  }

  /** Follow the minigame clock (hit-stop freezes, slow motion slows), read from its time scale. */
  sync(timeScale: number): void {
    this.emitter.timeScale = timeScale;
  }

  setDepth(d: number): void {
    this.emitter.setDepth(d);
  }
}

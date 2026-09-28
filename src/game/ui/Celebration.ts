import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import type { CharacterId } from '../data/characters';
import { LITE } from '../perf';
import { settings } from '../save/SettingsManager';
import { addPortrait } from './Portrait';
import { drawRibbon, shade, tintToward } from './Style';
import { addText } from './theme';

// Shared pieces of the podium ceremonies (minigame results and the final results): confetti in the
// players' colours fired from cannons, a god-ray behind a winner, fireworks, the winner's ribbon
// banner and the foreground dressing that frames the rendered podium stage. Everything is pooled
// particles or a handful of images, scaled down on Lite.

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Fewer particles on Lite, and a third of them with Reduced Motion. */
function count(n: number): number {
  const k = (LITE ? 0.45 : 1) * (settings.get().reducedMotion ? 0.34 : 1);
  return Math.max(1, Math.round(n * k));
}

/**
 * Confetti in the players' colours (the winner's colour weighted in), fired from cannons at the
 * stage's corners or drifting down from the top.
 */
export class Confetti {
  private cannonE: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rainE: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(scene: Phaser.Scene, depth: number, favour?: number) {
    if (!scene.textures.exists('fx-confetti')) return;
    const tints: number[] = [...PLAYER_COLORS, 0xffffff, COLORS.goldLight];
    if (favour !== undefined) tints.push(favour, favour, tintToward(favour, 0xffffff, 0.4));
    this.cannonE = scene.add.particles(0, 0, 'fx-confetti', {
      emitting: false,
      lifespan: { min: 1900, max: 2900 },
      speed: { min: 520, max: 1050 },
      angle: { min: -80, max: -60 },
      gravityY: 780,
      rotate: { start: 0, end: 900 },
      scaleX: { start: 1.25, end: 0.3 },
      scaleY: { start: 1.25, end: 1 },
      tint: tints,
      alpha: { start: 1, end: 0.2 },
      maxParticles: LITE ? 180 : 480,
    });
    this.cannonE.setDepth(depth);
    this.rainE = scene.add.particles(0, 0, 'fx-confetti', {
      emitting: false,
      lifespan: { min: 2600, max: 3800 },
      speedX: { min: -70, max: 70 },
      speedY: { min: 90, max: 220 },
      gravityY: 90,
      rotate: { start: 0, end: 540 },
      scaleX: { start: 1.1, end: 0.25 },
      scaleY: { start: 1.1, end: 1 },
      tint: tints,
      alpha: { start: 1, end: 0.6 },
      maxParticles: LITE ? 110 : 300,
    });
    this.rainE.setDepth(depth);
  }

  /** A burst from a cannon at (x, y), aimed up and inwards (dir 1 = to the right). */
  cannon(x: number, y: number, dir: 1 | -1, n = 70): void {
    if (!this.cannonE) return;
    // (setEmitterAngle only nudges the current value within the configured range; reload the op.)
    this.cannonE.ops.angle.loadConfig({ angle: dir > 0 ? { min: -82, max: -52 } : { min: -128, max: -98 } });
    this.cannonE.explode(count(n), x, y);
  }

  /** Both corner cannons at once. */
  cannons(y = GAME_HEIGHT - 40, n = 70): void {
    this.cannon(60, y, 1, n);
    this.cannon(GAME_WIDTH - 60, y, -1, n);
  }

  /** Confetti drifting down across the top of the screen. */
  rain(n = 40): void {
    if (!this.rainE) return;
    const k = count(n);
    for (let i = 0; i < k; i++) this.rainE.emitParticleAt(Phaser.Math.Between(40, GAME_WIDTH - 40), Phaser.Math.Between(-60, -10), 1);
  }
}

/**
 * A god-ray behind a winner: a slowly turning sunburst, a shaft of light from above and a warm pool
 * at their feet. Returns the container (fade it in; destroy with the scene).
 */
export function godRays(scene: Phaser.Scene, x: number, footY: number, o: { tint?: number; scale?: number; depth?: number } = {}): Phaser.GameObjects.Container {
  const tint = o.tint ?? 0xfff0c8;
  const k = o.scale ?? 1;
  const c = scene.add.container(0, 0).setDepth(o.depth ?? -1);
  if (scene.textures.exists('fx-rays')) {
    const rays = scene.add.image(x, footY - 190 * k, 'fx-rays').setScale(1.55 * k).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55);
    c.add(rays);
    if (!settings.get().reducedMotion) scene.tweens.add({ targets: rays, angle: 360, duration: 26000, repeat: -1 });
  }
  if (scene.textures.exists('fx-shaft')) {
    c.add(scene.add.image(x, footY + 30, 'fx-shaft').setOrigin(0.5, 1).setDisplaySize(380 * k, 900).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5));
  }
  c.add(scene.add.image(x, footY - 2, 'fx-dot').setScale(12 * k, 3.2 * k).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55));
  return c;
}

/** Fireworks: a spark climbs from below and bursts into a ring of light in the given colour. */
export class Fireworks {
  private burstE: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(
    private scene: Phaser.Scene,
    private depth: number,
  ) {
    if (!scene.textures.exists('fx-dot')) return;
    this.burstE = scene.add.particles(0, 0, 'fx-dot', {
      emitting: false,
      lifespan: { min: 700, max: 1200 },
      speed: { min: 160, max: 430 },
      gravityY: 240,
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      maxParticles: LITE ? 140 : 420,
    });
    this.burstE.setDepth(depth);
  }

  launch(x: number, y: number, color: number, delay = 0): void {
    const s = this.scene;
    s.time.delayedCall(delay, () => {
      const spark = s.add.image(x + Phaser.Math.Between(-40, 40), GAME_HEIGHT + 20, 'fx-dot').setScale(1.4).setTint(tintToward(color, 0xffffff, 0.5)).setBlendMode(Phaser.BlendModes.ADD).setDepth(this.depth);
      audio.play('whoosh', { volume: 0.12, rate: 1.6, throttleMs: 120 });
      s.tweens.add({
        targets: spark,
        x,
        y,
        duration: 620,
        ease: 'Cubic.Out',
        onComplete: () => {
          spark.destroy();
          this.burst(x, y, color);
        },
      });
    });
  }

  burst(x: number, y: number, color: number): void {
    const s = this.scene;
    if (this.burstE) {
      this.burstE.ops.tint.loadConfig({ tint: [color, color, tintToward(color, 0xffffff, 0.6), 0xffffff] });
      this.burstE.explode(count(46), x, y);
    }
    const glow = s.add.image(x, y, 'fx-dot').setScale(3).setTint(tintToward(color, 0xffffff, 0.4)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9).setDepth(this.depth);
    s.tweens.add({ targets: glow, scale: 14, alpha: 0, duration: 520, ease: 'Cubic.Out', onComplete: () => glow.destroy() });
    audio.play('pop', { rate: 0.5, volume: 0.55, throttleMs: 80 });
  }
}

export interface WinnerBannerOpts {
  title: string;
  /** Ribbon colour (the winner's player colour). */
  color: number;
  /** Portraits pinned on the ribbon's left end (the winner, or tied winners). */
  portraits: { characterId: CharacterId; slot: number }[];
  /** Small chip under the ribbon (the minigame's name, say). */
  subtitle?: string;
  size?: number;
  depth?: number;
}

/**
 * The winner's banner: a ribbon in their colour with their portrait pinned on it and the title in
 * big white letters. Pops in and resolves when it has landed.
 */
export function winnerBanner(scene: Phaser.Scene, x: number, y: number, o: WinnerBannerOpts): Phaser.GameObjects.Container {
  const size = o.size ?? 62;
  const c = scene.add.container(x, y).setDepth(o.depth ?? 50);
  const title = addText(scene, 0, 0, o.title, size, { color: '#ffffff', weight: 700, fixed: true }).setShadow(0, 4, css(shade(o.color, 0.35)), 0, false, true);
  const pr = Math.round(size * 0.78);
  const nP = Math.min(4, o.portraits.length);
  const portraitW = nP > 0 ? pr * 2 + (nP - 1) * pr * 1.1 : 0;
  const h = Math.round(size * 1.45);
  const w = Math.max(520, title.width + portraitW + 120);
  const g = scene.add.graphics();
  drawRibbon(g, 0, 0, w, h, o.color, { tail: Math.round(h * 0.8) });
  // Text sits right of the portraits.
  title.setX(portraitW / 2 + 10);
  c.add([g, title]);
  if (o.subtitle) {
    const sub = addText(scene, 0, h / 2 + 22, o.subtitle, 22, { color: '#1f2940', weight: 700, fixed: true });
    const sw = sub.width + 44;
    const chip = scene.add.graphics();
    chip.fillStyle(0x0a1120, 0.2);
    chip.fillRoundedRect(-sw / 2, h / 2 + 5, sw, 38, 19);
    chip.fillStyle(0xfffaf1, 1);
    chip.fillRoundedRect(-sw / 2, h / 2 + 2, sw, 38, 19);
    c.add([chip, sub]);
  }
  const reduced = settings.get().reducedMotion;
  c.setScale(reduced ? 1 : 0.3).setAlpha(0);
  scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: reduced ? 160 : 380, ease: 'Back.Out' });
  // Portraits pin on once it has landed (their circular masks are placed in world space).
  scene.time.delayedCall(reduced ? 170 : 390, () => {
    if (!c.active) return;
    for (let i = 0; i < nP; i++) {
      const p = o.portraits[i];
      const px = -w / 2 + pr + 18 + i * pr * 1.1;
      const wx = x + px;
      const portrait = addPortrait(scene, p.characterId, p.slot, pr, { worldX: wx, worldY: y, badge: nP === 1 });
      portrait.setPosition(px, 0);
      c.add(portrait);
      if (!reduced) {
        portrait.setScale(0.5);
        scene.tweens.add({ targets: portrait, scale: 1, duration: 260, delay: i * 70, ease: 'Back.Out' });
      }
    }
  });
  return c;
}

/**
 * Foreground dressing for the rendered podium stage: leafy bushes dotted with flowers over the
 * deck's two cut ends and a garland of bunting across each top corner, so the stage reads as part
 * of the festival rather than a slab. Uses the board's rendered tree and bunting where loaded.
 */
export function stageDressing(scene: Phaser.Scene, depth: number): void {
  const tree = 'rendered-suncoil-prop_grove-tree.webp';
  const flags = 'rendered-suncoil-prop_bunting-plaza.webp';
  // Bushes hug the bottom corners, over the deck's cut ends only (clear of the podiums and their
  // score chips), in shadow tones: foreground foliage sits out of the key light.
  const bushes: [number, number, number, boolean, number][] = [
    // x, y (canopy centre), display width, flip, tint
    [18, 790, 230, false, 0xa7bf95],
    [70, 955, 250, true, 0x93ad83],
    [-70, 1010, 300, false, 0x829c74],
    [GAME_WIDTH - 18, 790, 230, true, 0xa7bf95],
    [GAME_WIDTH - 70, 955, 250, false, 0x93ad83],
    [GAME_WIDTH + 70, 1010, 300, true, 0x829c74],
  ];
  if (scene.textures.exists(tree)) {
    const src = scene.textures.get(tree).getSourceImage() as HTMLImageElement;
    // The canopy is the top two thirds of the rendered tree.
    const cropH = src.height * 0.66;
    for (const [x, y, w, flip, tint] of bushes) {
      const img = scene.add.image(x, y, tree).setCrop(0, 0, src.width, cropH).setOrigin(0.5, 0.33).setDepth(depth);
      img.setScale(w / src.width).setFlipX(flip).setTint(tint);
    }
  } else {
    const leaf = scene.add.graphics().setDepth(depth);
    for (const [x, y, w] of bushes) {
      for (const [dx, dy, r, c] of [
        [0, 0.08, 0.5, 0x3f7f3a],
        [-0.25, -0.05, 0.34, 0x4f9a42],
        [0.22, -0.02, 0.32, 0x4f9a42],
        [0, -0.2, 0.3, 0x68b04e],
      ] as const) {
        leaf.fillStyle(c, 1);
        leaf.fillCircle(x + dx * w, y + dy * w, r * w);
      }
    }
  }
  // Flowers dotted over the bushes (drawn after them, so on top).
  const g = scene.add.graphics().setDepth(depth);
  const petals = [0xff8fb1, 0xffd45c, 0xffffff, 0xff6b5e, 0xc49bff];
  const rng = new Phaser.Math.RandomDataGenerator(['stage-flowers']);
  for (const [x, y, w] of bushes) {
    for (let i = 0; i < 6; i++) {
      const fx = x + rng.realInRange(-0.34, 0.34) * w;
      const fy = y + rng.realInRange(-0.28, 0.12) * w;
      if (fx < 8 || fx > GAME_WIDTH - 8) continue;
      const r = rng.realInRange(7, 10);
      const col = petals[rng.between(0, petals.length - 1)];
      g.fillStyle(shade(col, 0.7), 1);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        g.fillCircle(fx + Math.cos(a) * r * 0.75, fy + Math.sin(a) * r * 0.75 + 1.5, r * 0.62);
      }
      g.fillStyle(col, 1);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        g.fillCircle(fx + Math.cos(a) * r * 0.75, fy + Math.sin(a) * r * 0.75, r * 0.58);
      }
      g.fillStyle(0xffc23d, 1);
      g.fillCircle(fx, fy, r * 0.42);
    }
  }
  // Bunting garlands swinging across the top corners.
  if (scene.textures.exists(flags)) {
    const src = scene.textures.get(flags).getSourceImage() as HTMLImageElement;
    // Just the string of flags between the two poles.
    const cx0 = src.width * 0.09;
    const cy0 = src.height * 0.04;
    const cw = src.width * 0.82;
    const ch = src.height * 0.42;
    for (const [x, y, ang, flip] of [
      [250, 26, 12, false],
      [GAME_WIDTH - 250, 26, -12, true],
    ] as const) {
      const img = scene.add.image(x, y, flags).setCrop(cx0, cy0, cw, ch).setOrigin(0.5, 0.2).setDepth(depth);
      img.setScale(620 / cw).setAngle(ang).setFlipX(flip);
      if (!settings.get().reducedMotion) scene.tweens.add({ targets: img, angle: ang + (flip ? -2 : 2), duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }
}

/**
 * A stage spotlight: a beam of light from a fixed source (off the top of the screen) to a target
 * on the stage, with a pool of light where it lands. Sweep it by moving its target.
 */
export class Spotlight {
  readonly beam: Phaser.GameObjects.Image | null;
  readonly pool: Phaser.GameObjects.Image;
  private target = { x: 0, y: 0 };
  private sweep?: Phaser.Tweens.Tween;

  constructor(
    private scene: Phaser.Scene,
    private sx: number,
    private sy: number,
    tint: number,
    depth: number,
    private width = 250,
  ) {
    this.beam = scene.textures.exists('fx-shaft') ? scene.add.image(0, 0, 'fx-shaft').setOrigin(0.5, 0.97).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setAlpha(0) : null;
    this.pool = scene.add.image(0, 0, 'fx-dot').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setAlpha(0).setScale(8, 2.2);
  }

  /** Move the lamp to another layer (behind the figures it lights, say). */
  setDepth(depth: number): this {
    this.beam?.setDepth(depth);
    this.pool.setDepth(depth);
    return this;
  }

  /** Point the beam at (x, y). */
  aim(x: number, y: number): this {
    this.target.x = x;
    this.target.y = y;
    const dx = this.sx - x;
    const dy = y - this.sy;
    const len = Math.hypot(dx, dy);
    if (this.beam) this.beam.setPosition(x, y).setDisplaySize(this.width, len).setRotation(Math.atan2(dx, dy));
    this.pool.setPosition(x, y);
    return this;
  }

  /** Glide the beam to a new target. */
  sweepTo(x: number, y: number, ms: number, ease = 'Sine.InOut'): this {
    this.sweep?.stop();
    if (ms <= 0 || settings.get().reducedMotion) return this.aim(x, y);
    const from = { x: this.target.x, y: this.target.y };
    this.sweep = this.scene.tweens.add({ targets: from, x, y, duration: ms, ease, onUpdate: () => this.aim(from.x, from.y) });
    return this;
  }

  /** Drift gently to and fro around a spot (a lamp swaying on its rig). */
  swayAround(x: number, y: number, dx: number, ms: number): this {
    this.sweep?.stop();
    this.aim(x - dx, y);
    if (settings.get().reducedMotion) return this.aim(x, y);
    const p = { x: x - dx };
    this.sweep = this.scene.tweens.add({ targets: p, x: x + dx, duration: ms, yoyo: true, repeat: -1, ease: 'Sine.InOut', onUpdate: () => this.aim(p.x, y) });
    return this;
  }

  /** Fade the light in or out. */
  light(on: boolean, ms = 250, strength = 1): this {
    const targets = this.beam ? [this.beam, this.pool] : [this.pool];
    this.scene.tweens.killTweensOf(targets);
    if (this.beam) this.scene.tweens.add({ targets: this.beam, alpha: on ? 0.36 * strength : 0, duration: ms });
    this.scene.tweens.add({ targets: this.pool, alpha: on ? 0.5 * strength : 0, duration: ms });
    return this;
  }
}

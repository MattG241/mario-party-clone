import Phaser from 'phaser';
import { DEPTH } from '../constants';
import { settings } from '../save/SettingsManager';
import { textStyle } from '../ui/theme';
import { Pool } from './Pool';

/** Frames of the supplied VFX sheet, grouped into short flipbooks. */
export const VFX_FRAMES = {
  dust: [0, 1, 2],
  impact: [3, 4],
  sparkle: [5],
  starSwirl: [6],
  waterStreak: [7, 8],
  splash: [9, 10, 11],
  smoke: [12, 13, 14],
  electric: [15, 16, 17],
  confetti: [18, 19, 20],
  explosion: [21, 22, 23],
  leafSwirl: [24],
  pinkSwirl: [25],
  portalSwirl: [26],
  tornado: [27],
  goldSwirl: [28],
  rainbowSwirl: [29],
} as const;
export type VfxKind = keyof typeof VFX_FRAMES;

export interface VfxOpts {
  scale?: number;
  duration?: number;
  rotation?: number;
  flipX?: boolean;
  alpha?: number;
  depth?: number;
  tint?: number;
  /** Grow from this fraction of the final scale. */
  from?: number;
  /** Drift while playing. */
  dx?: number;
  dy?: number;
  blend?: 'add' | 'normal';
}

const CONFETTI_COLORS = [0xff6b5e, 0xf4b83b, 0x1fa5a0, 0x8e5cd9, 0x5ce1ff, 0x6cc24a, 0xffffff];

/**
 * Per-scene effects helper. All effect objects are pooled.
 * Motion-heavy effects honour the Screen Shake / Reduced Motion settings.
 */
export class EffectsManager {
  private vfxPool: Pool<Phaser.GameObjects.Sprite>;
  private textPool: Pool<Phaser.GameObjects.Text>;
  private chipPool: Pool<Phaser.GameObjects.Sprite>;
  private confettiEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(
    private scene: Phaser.Scene,
    private baseDepth: number = DEPTH.worldFx,
    private layer?: Phaser.GameObjects.Layer | Phaser.GameObjects.Container,
  ) {
    this.vfxPool = new Pool(
      () => this.adopt(scene.add.sprite(0, 0, 'vfx', 0)),
      (s) => s.setActive(true).setVisible(true),
      (s) => {
        scene.tweens.killTweensOf(s);
        s.setActive(false).setVisible(false);
      },
      96,
    );
    this.textPool = new Pool(
      () => this.adopt(scene.add.text(0, 0, '', textStyle(44, { color: '#ffffff' })).setOrigin(0.5)),
      (t) => t.setActive(true).setVisible(true),
      (t) => {
        scene.tweens.killTweensOf(t);
        t.setActive(false).setVisible(false);
      },
      48,
    );
    this.chipPool = new Pool(
      () => this.adopt(scene.add.sprite(0, 0, 'items', 0)),
      (s) => {
        s.setActive(true).setVisible(true);
        s.play('chip-spin');
      },
      (s) => {
        scene.tweens.killTweensOf(s);
        s.stop();
        s.setActive(false).setVisible(false);
      },
      80,
    );
    if (scene.textures.exists('fx-dot')) {
      this.confettiEmitter = scene.add.particles(0, 0, 'fx-confetti', {
        emitting: false,
        lifespan: { min: 1400, max: 2400 },
        speed: { min: 260, max: 700 },
        angle: { min: 220, max: 320 },
        gravityY: 700,
        rotate: { start: 0, end: 720 },
        scaleX: { start: 1, end: 0.4 },
        scaleY: { start: 1, end: 1 },
        tint: CONFETTI_COLORS,
        alpha: { start: 1, end: 0 },
        maxParticles: 400,
      });
      this.confettiEmitter.setDepth(baseDepth + 20);
      this.adopt(this.confettiEmitter);
      this.sparkEmitter = scene.add.particles(0, 0, 'fx-dot', {
        emitting: false,
        lifespan: { min: 350, max: 700 },
        speed: { min: 80, max: 260 },
        scale: { start: 0.9, end: 0 },
        tint: [0xffffff, 0xffe08a, 0x5ce1ff],
        blendMode: 'ADD',
        maxParticles: 300,
      });
      this.sparkEmitter.setDepth(baseDepth + 21);
      this.adopt(this.sparkEmitter);
    }
  }

  private adopt<T extends Phaser.GameObjects.GameObject>(o: T): T {
    if (this.layer) this.layer.add(o);
    return o;
  }

  get reducedMotion(): boolean {
    return settings.get().reducedMotion;
  }

  /** Play a short VFX flipbook from the supplied effects sheet. */
  vfx(kind: VfxKind, x: number, y: number, o: VfxOpts = {}): void {
    const s = this.vfxPool.get();
    if (!s) return;
    const frames = VFX_FRAMES[kind];
    const dur = o.duration ?? 520;
    const scale = o.scale ?? 0.7;
    s.setPosition(x, y)
      .setFrame(frames[0])
      .setDepth(o.depth ?? this.baseDepth + 10)
      .setRotation(o.rotation ?? 0)
      .setFlipX(!!o.flipX)
      .setAlpha(o.alpha ?? 1)
      .setScale(scale * (o.from ?? 0.55))
      .setBlendMode(o.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (o.tint !== undefined) s.setTint(o.tint);
    else s.clearTint();
    const tl = this.scene.tweens;
    tl.add({ targets: s, scale, duration: dur * 0.35, ease: 'Back.Out' });
    tl.add({ targets: s, alpha: 0, delay: dur * 0.55, duration: dur * 0.45, ease: 'Quad.In', onComplete: () => this.vfxPool.release(s) });
    if (o.dx || o.dy) tl.add({ targets: s, x: x + (o.dx ?? 0), y: y + (o.dy ?? 0), duration: dur, ease: 'Quad.Out' });
    if (frames.length > 1) {
      const stepMs = (dur * 0.8) / frames.length;
      frames.slice(1).forEach((f, i) => {
        this.scene.time.delayedCall(stepMs * (i + 1), () => {
          if (s.active) s.setFrame(f);
        });
      });
    }
  }

  /** Floating "+3" style text that rises and fades. */
  floatText(x: number, y: number, text: string, color = '#ffe08a', o: { size?: number; rise?: number; duration?: number; depth?: number; stroke?: string } = {}): void {
    const t = this.textPool.get();
    if (!t) return;
    t.setStyle(textStyle(o.size ?? 46, { color, stroke: o.stroke ?? '#2b2340', strokeThickness: 7, weight: 700, shadow: true, fixed: true }));
    t.setText(text).setPosition(x, y).setAlpha(1).setScale(0.4).setDepth(o.depth ?? this.baseDepth + 40);
    const dur = o.duration ?? 1100;
    this.scene.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, y: y - (o.rise ?? 90), duration: dur, ease: 'Cubic.Out' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: dur * 0.6, duration: dur * 0.4, onComplete: () => this.textPool.release(t) });
  }

  /** Chips flying along arcs from one point to another (gaining currency). */
  chipsTo(fromX: number, fromY: number, toX: number, toY: number, count: number, o: { scale?: number; spread?: number; onEach?: (i: number) => void; depth?: number } = {}): Promise<void> {
    const n = Math.min(count, 14);
    if (n <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let done = 0;
      for (let i = 0; i < n; i++) {
        const s = this.chipPool.get();
        if (!s) {
          done++;
          continue;
        }
        const spread = o.spread ?? 60;
        const sx = fromX + Phaser.Math.Between(-spread, spread);
        const sy = fromY + Phaser.Math.Between(-spread / 2, spread / 2);
        s.setPosition(sx, sy).setScale(o.scale ?? 0.26).setDepth(o.depth ?? this.baseDepth + 30).setAlpha(1);
        const ctrlX = (sx + toX) / 2 + Phaser.Math.Between(-120, 120);
        const ctrlY = Math.min(sy, toY) - Phaser.Math.Between(80, 200);
        const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(sx, sy), new Phaser.Math.Vector2(ctrlX, ctrlY), new Phaser.Math.Vector2(toX, toY));
        const holder = { t: 0 };
        this.scene.tweens.add({
          targets: holder,
          t: 1,
          delay: i * 55,
          duration: 520,
          ease: 'Quad.In',
          onUpdate: () => {
            const p = curve.getPoint(holder.t);
            s.setPosition(p.x, p.y);
          },
          onComplete: () => {
            this.chipPool.release(s);
            o.onEach?.(i);
            done++;
            if (done >= n) resolve();
          },
        });
      }
      if (done >= n) resolve();
    });
  }

  /** Chips bursting out and tumbling away (losing currency). */
  scatterChips(x: number, y: number, count: number, o: { scale?: number; depth?: number } = {}): void {
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++) {
      const s = this.chipPool.get();
      if (!s) return;
      s.setPosition(x, y).setScale(o.scale ?? 0.24).setDepth(o.depth ?? this.baseDepth + 30).setAlpha(1);
      const ang = Phaser.Math.FloatBetween(-Math.PI * 0.95, -Math.PI * 0.05);
      const dist = Phaser.Math.Between(90, 200);
      const tx = x + Math.cos(ang) * dist;
      const peak = y + Math.sin(ang) * dist * 0.8;
      this.scene.tweens.add({ targets: s, x: tx, duration: 700, ease: 'Linear' });
      this.scene.tweens.add({
        targets: s,
        y: { from: y, to: peak },
        duration: 300,
        ease: 'Quad.Out',
        onComplete: () => {
          this.scene.tweens.add({ targets: s, y: peak + 180, alpha: 0, duration: 420, ease: 'Quad.In', onComplete: () => this.chipPool.release(s) });
        },
      });
    }
  }

  confetti(x: number, y: number, count = 60): void {
    if (!this.confettiEmitter) return;
    const n = this.reducedMotion ? Math.ceil(count / 3) : count;
    this.confettiEmitter.explode(n, x, y);
  }

  sparks(x: number, y: number, count = 16): void {
    this.sparkEmitter?.explode(this.reducedMotion ? Math.ceil(count / 2) : count, x, y);
  }

  /** Camera shake, if enabled in accessibility settings. */
  shake(intensity = 0.006, duration = 220, camera?: Phaser.Cameras.Scene2D.Camera): void {
    const s = settings.get();
    if (!s.screenShake || s.reducedMotion) return;
    (camera ?? this.scene.cameras.main).shake(duration, intensity);
  }

  flash(color = 0xffffff, duration = 180, camera?: Phaser.Cameras.Scene2D.Camera): void {
    if (this.reducedMotion) return;
    const c = Phaser.Display.Color.IntegerToColor(color);
    (camera ?? this.scene.cameras.main).flash(duration, c.red, c.green, c.blue);
  }

  clear(): void {
    this.vfxPool.releaseAll();
    this.textPool.releaseAll();
    this.chipPool.releaseAll();
  }
}

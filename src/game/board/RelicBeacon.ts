// The goal marker: a tall soft pillar of crystal light over the Relic Keeper's gate, the Prism
// Relic floating and turning in it with motes rising, and a glow with ripples on the ground. It
// grows as the camera pulls back so the goal reads from the overview, blooms after dark, and has
// its own departure (the relic shoots into the sky) and arrival (a pillar of light slams down).
import Phaser from 'phaser';
import { COLORS, DEPTH } from '../constants';
import { LITE } from '../perf';
import { GROUND_SQUASH, overviewScale } from './boardStyle';

/** Relic height above the gate's feet at close range (grows with the overview scale). */
const ICON_Y = -150;
const BEAM_FOOT = -60;

interface Mote {
  s: Phaser.GameObjects.Image;
  life: number;
  dur: number;
  x: number;
}

function tweenP(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  return new Promise((resolve) => scene.tweens.add({ ...config, onComplete: () => resolve() }));
}

export class RelicBeacon {
  /** Y-sorted part at the gate: the pillar, bloom, rays, the relic and its motes. */
  readonly root: Phaser.GameObjects.Container;
  /** Flat part on the ground (over the space disc, under the players). */
  private ground: Phaser.GameObjects.Container;
  private beam: Phaser.GameObjects.Image;
  private core: Phaser.GameObjects.Image;
  private bloom: Phaser.GameObjects.Image;
  private rays: Phaser.GameObjects.Image;
  /** A soft pale disc behind the relic: separates it from busy daylit art when zoomed out. */
  private plate: Phaser.GameObjects.Image;
  private icon: Phaser.GameObjects.Image;
  private disc: Phaser.GameObjects.Image;
  private ripples: Phaser.GameObjects.Image[] = [];
  private motes: Mote[] = [];
  private sparks: Phaser.GameObjects.Image[] = [];
  private k = 1;
  private t = 0;
  private glow = 0;
  /** Extra brightness that decays (a flare when the relic is bought or lands). */
  private flare = 0;
  /** While a departure/arrival plays, the idle animation leaves the relic alone. */
  private busy = false;
  /** Beam width multiplier (0 while collapsed between gates). */
  private open = 1;

  constructor(private scene: Phaser.Scene) {
    const s = scene;
    this.ground = s.add.container(0, 0).setDepth(DEPTH.spaces + 1.5);
    this.disc = s.add.image(0, 2, 'fx-dot').setTint(COLORS.crystal).setBlendMode(Phaser.BlendModes.ADD);
    this.ground.add(this.disc);
    for (let i = 0; i < 2; i++) {
      const r = s.add.image(0, 0, 'fx-ring').setTint(COLORS.crystalLight).setBlendMode(Phaser.BlendModes.ADD);
      this.ripples.push(r);
      this.ground.add(r);
    }
    this.root = s.add.container(0, 0);
    this.beam = s.add.image(0, BEAM_FOOT, 'fx-beam').setOrigin(0.5, 1).setTint(COLORS.crystal).setBlendMode(Phaser.BlendModes.ADD);
    this.core = s.add.image(0, BEAM_FOOT, 'fx-beam').setOrigin(0.5, 1).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD);
    this.bloom = s.add.image(0, ICON_Y, 'fx-dot').setTint(COLORS.crystal).setBlendMode(Phaser.BlendModes.ADD);
    this.rays = s.add.image(0, ICON_Y, s.textures.exists('fx-rays') ? 'fx-rays' : 'fx-dot').setTint(COLORS.crystalLight).setBlendMode(Phaser.BlendModes.ADD);
    this.plate = s.add.image(0, ICON_Y, 'fx-dot').setTint(0xeafcff);
    this.icon = s.add.image(0, ICON_Y, 'prism-relic');
    this.root.add([this.beam, this.core, this.bloom, this.rays, this.plate]);
    const n = LITE ? 5 : 10;
    for (let i = 0; i < n; i++) {
      const m = s.add.image(0, 0, 'fx-dot').setTint(i % 2 ? 0xffffff : COLORS.crystalLight).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.motes.push({ s: m, life: Math.random() * 2400, dur: 1800 + Math.random() * 1400, x: 0 });
      this.root.add(m);
    }
    this.root.add(this.icon);
    if (s.textures.exists('amb-glint')) {
      for (let i = 0; i < 2; i++) {
        const g = s.add.image(0, ICON_Y, 'amb-glint').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        this.sparks.push(g);
        this.root.add(g);
      }
    }
  }

  /** Stand at a gate (feet position of the gate's space). */
  place(x: number, y: number): void {
    this.root.setPosition(x, y - 20).setDepth(y - 20);
    this.ground.setPosition(x, y);
  }

  get x(): number {
    return this.root.x;
  }

  get y(): number {
    return this.root.y;
  }

  /** Height of the floating relic above the root at the current camera distance. */
  iconY(): number {
    return ICON_Y - 110 * (this.k - 1);
  }

  setGlow(g: number): void {
    this.glow = g;
  }

  /** A burst of extra light (bought, landed). */
  flash(): void {
    this.flare = 1;
  }

  /** Per frame: bob and turn the relic, lift the motes, pulse the ripples, size for the overview. */
  update(dt: number, zoom: number): void {
    const step = Math.min(dt, 100);
    this.t += step;
    this.k += (overviewScale(zoom) - this.k) * Math.min(1, step * 0.008);
    this.flare = Math.max(0, this.flare - step * 0.0012);
    const k = this.k;
    // By day the pillar needs a little more strength to read over the sunlit art; at night it blooms.
    const night = 1.25 + 0.3 * this.glow;
    const f = this.flare;
    const breathe = 0.85 + Math.sin(this.t * 0.0026) * 0.15;
    const iy = this.iconY();
    const w = this.open;
    this.beam.setDisplaySize(210 * k * w * (1 + f * 0.5), 1750).setAlpha(Math.min(1, (0.36 * breathe * night + f * 0.5) * (w > 0 ? 1 : 0)));
    this.core.setDisplaySize(62 * k * w * (1 + f * 0.8), 1550).setAlpha(Math.min(1, (0.4 * breathe * night + f * 0.6) * (w > 0 ? 1 : 0)));
    this.bloom.setPosition(0, iy).setScale(10 * k * (1 + f * 0.6)).setAlpha(Math.min(1, 0.5 * breathe * night + f * 0.4) * w);
    this.rays.setPosition(0, iy).setScale(0.62 * k * (1 + f * 0.5)).setAlpha((0.28 + f * 0.5) * w).setRotation(this.t * 0.00025);
    const far = Math.min(1, (k - 1) / 0.8);
    this.plate.setPosition(0, iy).setScale(6.5 * k).setAlpha(0.7 * far * (1 - 0.7 * this.glow) * w);
    if (!this.busy) {
      const bob = Math.sin(this.t * 0.0024) * 10;
      // A slow turn: the relic narrows and widens as if spinning on its axis.
      this.icon.setPosition(0, iy + bob).setScale(0.42 * k * (0.86 + 0.14 * Math.abs(Math.cos(this.t * 0.0011))), 0.42 * k);
    }
    for (let i = 0; i < this.sparks.length; i++) {
      const sp = this.sparks[i];
      const ph = (this.t * 0.0009 + i * 0.5) % 1;
      const a = Math.sin(ph * Math.PI);
      sp.setPosition((i ? 1 : -1) * 46 * k, iy - 40 * k + i * 70 * k).setScale((0.5 + a * 0.7) * k).setAlpha(a * w).setRotation(ph * 1.2);
    }
    for (const m of this.motes) {
      m.life += step;
      if (m.life >= m.dur) {
        m.life -= m.dur;
        m.x = (Math.random() - 0.5) * 90;
      }
      const p = m.life / m.dur;
      m.s.setPosition((m.x + Math.sin(p * 6 + m.dur) * 10) * k * w, BEAM_FOOT - 40 - p * 820).setScale((0.45 + (1 - p) * 0.35) * k).setAlpha(Math.sin(p * Math.PI) * 0.8 * w);
    }
    // Ground glow and two ripples spreading out from the gate.
    this.disc.setScale(7.5 * k, 7.5 * k * GROUND_SQUASH * 0.7).setAlpha((0.42 * breathe * night + f * 0.4) * w);
    for (let i = 0; i < this.ripples.length; i++) {
      const p = ((this.t / 1900 + i * 0.5) % 1) * w;
      this.ripples[i].setScale((0.9 + p * 1.5) * k, (0.9 + p * 1.5) * k * GROUND_SQUASH).setAlpha((1 - p) * 0.7 * w);
    }
  }

  /** The relic shoots up into the sky and the pillar collapses behind it. */
  async depart(): Promise<void> {
    const s = this.scene;
    this.busy = true;
    this.flash();
    const iy = this.iconY();
    const base = this.icon.scaleY;
    // Anticipation squash, then launch with a speed stretch.
    await tweenP(s, { targets: this.icon, scaleY: base * 0.72, scaleX: base * 1.2, y: iy + 16, duration: 140, ease: 'Quad.Out' });
    const beamGone = tweenP(s, { targets: this, open: 0, delay: 180, duration: 320, ease: 'Quad.In' });
    await tweenP(s, { targets: this.icon, y: iy - 1300, scaleY: base * 1.5, scaleX: base * 0.62, duration: 520, ease: 'Cubic.In' });
    await beamGone;
    this.icon.setVisible(false);
  }

  /**
   * At the new gate: a pillar of light slams down, the relic drops in and lands with a squash.
   * `onImpact` fires as it touches down (the caller adds sparks, sound and camera shake).
   */
  async arrive(onImpact?: () => void): Promise<void> {
    const s = this.scene;
    this.busy = true;
    this.open = 0;
    const k = this.k;
    const iy = this.iconY();
    const base = 0.42 * k;
    this.icon.setVisible(true).setPosition(0, iy - 1300).setScale(base * 0.62, base * 1.5);
    const pillar = s.add.image(0, BEAM_FOOT + 40, 'fx-beam').setOrigin(0.5, 1).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(80 * k, 1900).setAlpha(0);
    this.root.addAt(pillar, 0);
    await tweenP(s, { targets: pillar, alpha: 1, displayWidth: 320 * k, duration: 110, ease: 'Quad.Out' });
    await tweenP(s, { targets: this.icon, y: iy, duration: 360, ease: 'Quad.In' });
    // Touchdown.
    this.flash();
    onImpact?.();
    const wave = s.add.image(0, 0, 'fx-target').setTint(COLORS.crystalLight).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6 * k, 0.6 * k * GROUND_SQUASH);
    this.ground.add(wave);
    s.tweens.add({ targets: wave, scaleX: 4.6 * k, scaleY: 4.6 * k * GROUND_SQUASH, alpha: 0, duration: 650, ease: 'Quad.Out', onComplete: () => wave.destroy() });
    s.tweens.add({ targets: pillar, alpha: 0, displayWidth: 40 * k, duration: 700, ease: 'Quad.In', onComplete: () => pillar.destroy() });
    s.tweens.add({ targets: this, open: 1, duration: 480, ease: 'Back.Out' });
    await tweenP(s, { targets: this.icon, scaleX: base * 1.25, scaleY: base * 0.72, duration: 90, ease: 'Quad.Out' });
    await tweenP(s, { targets: this.icon, scaleX: base, scaleY: base, duration: 320, ease: 'Back.Out' });
    this.busy = false;
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
    this.ground.setVisible(v);
  }
}

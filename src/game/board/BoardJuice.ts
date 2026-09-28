// Board-side "game feel" pieces the presenter plays on the big beats of a turn: a burst in the
// space's colour when a hero lands, chips that spring out of the ground and tumble with weight, and
// the light pillar of a Prism Relic claim. Everything is pooled (a turn replays these often).
import Phaser from 'phaser';
import { DEPTH } from '../constants';
import { LITE } from '../perf';
import { settings } from '../save/SettingsManager';
import { GROUND_SQUASH } from './boardStyle';
import { lerpColor } from './DayCycle';

interface Mote {
  s: Phaser.GameObjects.Image;
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  floor: number;
  life: number;
  dur: number;
}

interface Chip {
  s: Phaser.GameObjects.Sprite;
  on: boolean;
  vx: number;
  vy: number;
  floor: number;
  bounces: number;
  rest: number;
  /** Fountain chips never land: they are handed to the HUD flyers at the top of their arc. */
  fountain: boolean;
}

const GRAVITY = 2600;

export class BoardJuice {
  private motes: Mote[] = [];
  private chips: Chip[] = [];
  private column: Phaser.GameObjects.Image;
  private wave: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Image;
  private readonly moteCount = LITE ? 8 : 14;

  constructor(private scene: Phaser.Scene) {
    const s = scene;
    this.column = s.add.image(0, 0, 'fx-beam').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.worldFx - 2).setVisible(false);
    this.wave = s.add.image(0, 0, 'fx-target').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.spaces + 2.5).setVisible(false);
    this.ring = s.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.spaces + 2.6).setVisible(false);
    for (let i = 0; i < this.moteCount; i++) {
      const m = s.add.image(0, 0, 'fx-dot').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.worldFx - 1).setVisible(false);
      this.motes.push({ s: m, on: false, x: 0, y: 0, vx: 0, vy: 0, floor: 0, life: 0, dur: 1 });
    }
  }

  private get reduced(): boolean {
    return settings.get().reducedMotion;
  }

  /**
   * A hero lands on a space: a column of light and a ground shockwave in the space's colour, with
   * motes flicked up and out. `big` for event spaces.
   */
  landBurst(x: number, y: number, color: number, big = false): void {
    const s = this.scene;
    const k = big ? 1.25 : 1;
    s.tweens.killTweensOf([this.column, this.wave, this.ring]);
    // The column stands behind the hero (y-sorted just under their feet), never washing them out.
    this.column.setPosition(x, y + 14).setDepth(y - 14).setTint(color).setVisible(true).setAlpha(0.95).setDisplaySize(150 * k, 520 * k);
    s.tweens.add({ targets: this.column, alpha: 0, displayWidth: 30, duration: 460, ease: 'Quad.In', onComplete: () => this.column.setVisible(false) });
    this.wave.setPosition(x, y + 2).setTint(color).setVisible(true).setAlpha(1).setScale(0.6 * k, 0.6 * k * GROUND_SQUASH);
    s.tweens.add({ targets: this.wave, scaleX: 2.9 * k, scaleY: 2.9 * k * GROUND_SQUASH, alpha: 0, duration: 520, ease: 'Quad.Out', onComplete: () => this.wave.setVisible(false) });
    this.ring.setPosition(x, y + 2).setTint(0xffffff).setVisible(true).setAlpha(0.9).setScale(0.8 * k, 0.8 * k * GROUND_SQUASH);
    s.tweens.add({ targets: this.ring, scaleX: 2.2 * k, scaleY: 2.2 * k * GROUND_SQUASH, alpha: 0, duration: 380, ease: 'Cubic.Out', onComplete: () => this.ring.setVisible(false) });
    const n = this.reduced ? Math.ceil(this.moteCount / 2) : this.moteCount;
    for (let i = 0; i < n; i++) {
      const m = this.freeMote();
      if (!m) break;
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (160 + Math.random() * 180) * k;
      m.on = true;
      m.x = x + Math.cos(a) * 30;
      m.y = y + Math.sin(a) * 30 * GROUND_SQUASH;
      m.vx = Math.cos(a) * sp;
      m.vy = -380 - Math.random() * 360 * k;
      m.floor = y + 20 + Math.sin(a) * 40;
      m.life = 0;
      m.dur = 600 + Math.random() * 300;
      m.s.setTint(i % 3 === 0 ? 0xffffff : color).setVisible(true).setAlpha(1).setScale(0.7);
    }
  }

  private freeMote(): Mote | null {
    for (const m of this.motes) if (!m.on) return m;
    return null;
  }

  private freeChip(): Chip {
    for (const c of this.chips) if (!c.on) return c;
    const s = this.scene.add.sprite(0, 0, 'items', '0').setDepth(DEPTH.worldFx + 25).setVisible(false);
    const c: Chip = { s, on: false, vx: 0, vy: 0, floor: 0, bounces: 0, rest: 0, fountain: false };
    this.chips.push(c);
    return c;
  }

  /**
   * Chips spring up out of the ground round (x, y) and hang at the top of their arcs; resolves
   * then, with their positions, so the caller can fly them on to the HUD.
   */
  fountain(x: number, y: number, count: number): Promise<{ x: number; y: number }[]> {
    const n = Math.min(count, 10);
    const out: Chip[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.freeChip();
      c.on = true;
      c.fountain = true;
      const spread = (i / Math.max(1, n - 1) - 0.5) * 2;
      c.vx = spread * 170 + (Math.random() - 0.5) * 60;
      c.vy = -900 - Math.random() * 260;
      c.floor = y;
      c.bounces = 0;
      c.rest = 0;
      c.s.setPosition(x + spread * 20, y - 10).setScale(0.26).setAlpha(1).setVisible(true).play('chip-spin');
      out.push(c);
    }
    return new Promise((resolve) => {
      this.scene.time.delayedCall(340, () => {
        const pts = out.map((c) => ({ x: c.s.x, y: c.s.y }));
        for (const c of out) this.releaseChip(c);
        resolve(pts);
      });
    });
  }

  /** Chips knocked out of a hero: they fly, hit the ground, bounce, rest a moment and fade. */
  spill(x: number, y: number, groundY: number, count: number): void {
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++) {
      const c = this.freeChip();
      c.on = true;
      c.fountain = false;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 380 + Math.random() * 420;
      c.vx = Math.cos(a) * sp * 0.9;
      c.vy = Math.sin(a) * sp - 260;
      c.floor = groundY + (Math.random() - 0.3) * 60;
      c.bounces = 2;
      c.rest = 0;
      c.s.setPosition(x, y).setScale(0.24).setAlpha(1).setVisible(true).play('chip-spin');
    }
  }

  private releaseChip(c: Chip): void {
    c.on = false;
    c.s.stop();
    c.s.setVisible(false);
  }

  /**
   * The Prism Relic claim: a tall pillar of light on the hero with a slow sunburst behind them.
   * Resolves when the pillar has faded.
   */
  pillar(x: number, y: number, color: number): Promise<void> {
    const s = this.scene;
    const beam = s.add.image(x, y + 20, 'fx-beam').setOrigin(0.5, 1).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(y - 1).setDisplaySize(60, 2200).setAlpha(0);
    const core = s.add.image(x, y + 20, 'fx-beam').setOrigin(0.5, 1).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(y - 0.9).setDisplaySize(20, 2000).setAlpha(0);
    const rays = s.add.image(x, y - 150, s.textures.exists('fx-rays') ? 'fx-rays' : 'fx-dot').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(y - 1.1).setScale(0.4).setAlpha(0);
    s.tweens.add({ targets: beam, alpha: 0.85, displayWidth: 300, duration: 160, ease: 'Quad.Out' });
    s.tweens.add({ targets: core, alpha: 0.9, displayWidth: 110, duration: 160, ease: 'Quad.Out' });
    s.tweens.add({ targets: rays, alpha: 0.75, scale: 1.5, angle: 50, duration: 900, ease: 'Sine.Out' });
    return new Promise((resolve) => {
      s.tweens.add({ targets: [beam, core], alpha: 0, displayWidth: 30, delay: 700, duration: 700, ease: 'Quad.In' });
      s.tweens.add({
        targets: rays,
        alpha: 0,
        angle: 90,
        delay: 800,
        duration: 700,
        onComplete: () => {
          beam.destroy();
          core.destroy();
          rays.destroy();
          resolve();
        },
      });
    });
  }

  /** An event space goes off: a sunburst in the event's colour flares behind the hero and fades. */
  eventFlare(x: number, y: number, color: number): void {
    const s = this.scene;
    // Lightened towards white: a pure hue adds too little over the sunlit board to read.
    const light = lerpColor(color, 0xffffff, 0.35);
    const rays = s.add.image(x, y, s.textures.exists('fx-rays') ? 'fx-rays' : 'fx-dot').setTint(light).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.worldFx - 3).setScale(0.3).setAlpha(0);
    s.tweens.add({ targets: rays, scale: 1.5, alpha: 1, angle: 40, duration: 380, ease: 'Cubic.Out' });
    s.tweens.add({ targets: rays, alpha: 0, angle: 80, delay: 650, duration: 700, ease: 'Quad.In', onComplete: () => rays.destroy() });
    const ring = s.add.image(x, y, 'fx-ring').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.worldFx - 3).setScale(0.5).setAlpha(1);
    s.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 600, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
  }

  /** Per frame (scene delta, so slow motion and freezes apply). */
  update(dt: number): void {
    const t = Math.min(dt, 60) * 0.001;
    for (const m of this.motes) {
      if (!m.on) continue;
      m.life += dt;
      m.vy += GRAVITY * 0.55 * t;
      m.x += m.vx * t;
      m.y += m.vy * t;
      const k = m.life / m.dur;
      if (k >= 1 || (m.vy > 0 && m.y > m.floor)) {
        m.on = false;
        m.s.setVisible(false);
        continue;
      }
      m.s.setPosition(m.x, m.y).setAlpha(1 - k * k).setScale(0.75 * (1 - k * 0.6));
    }
    for (const c of this.chips) {
      if (!c.on) continue;
      if (c.rest > 0) {
        // Lying on the ground a moment, then fading out.
        c.rest -= dt;
        c.s.setAlpha(Math.min(1, c.rest / 250));
        if (c.rest <= 0) this.releaseChip(c);
        continue;
      }
      c.vy += GRAVITY * t;
      c.s.x += c.vx * t;
      c.s.y += c.vy * t;
      if (!c.fountain && c.vy > 0 && c.s.y >= c.floor) {
        c.s.y = c.floor;
        if (c.bounces > 0) {
          c.bounces--;
          c.vy = -c.vy * 0.42;
          c.vx *= 0.6;
        } else {
          c.rest = 650;
          c.s.stop();
        }
      }
    }
  }
}

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { lerpColor, mulColor, type Look, type SkyKey } from '../board/DayCycle';
import { applyGrade } from '../effects/GradePipeline';
import { LITE } from '../perf';
import { addStrip } from '../ui/Screen';

const SKY_KEYS: SkyKey[] = ['day', 'clear', 'golden', 'sunset', 'dusk'];

/**
 * Sky and far parallax layers behind the board. Lives in its own scene so the board camera can
 * zoom freely without scaling the sky; parallax follows the board camera's scroll.
 *
 * The sky follows the festival day (see DayCycle): Full graphics cross-fade between the rendered
 * skies (morning, midday, golden hour, sunset, dusk) and tint them deeper as night falls; Lite has
 * only the day sky and tints it to stand in for the rest. At most two sky images draw at once.
 */
export class BoardBgScene extends Phaser.Scene {
  private cloudsFar: Phaser.GameObjects.TileSprite | null = null;
  private islandsFar: Phaser.GameObjects.TileSprite | null = null;
  private cloudsLow: Phaser.GameObjects.TileSprite | null = null;
  private skies = new Map<SkyKey, Phaser.GameObjects.Image>();
  private flat: Phaser.GameObjects.Image | null = null;
  private drift = 0;
  /** Mid-distance floating islets (parallax between the sky and the board). */
  private islets: { img: Phaser.GameObjects.Image; x: number; y: number; depth: number; bob: number; haze: number }[] = [];
  /** Stars that come out after dark (screen space: the sky layer never zooms). */
  private stars: { img: Phaser.GameObjects.Image; phase: number; speed: number }[] = [];
  /** The latest look (kept so a look set before this scene has built still applies). */
  private look = { skyA: 'day' as SkyKey, skyB: 'day' as SkyKey, mix: 0, tint: 0xffffff, lite: 0xffffff, glow: 0 };

  constructor() {
    super('BoardBg');
  }

  create(): void {
    this.skies.clear();
    this.flat = null;
    this.cloudsFar = this.islandsFar = this.cloudsLow = null;
    for (const k of SKY_KEYS) {
      const key = `rendered-sky-${k}`;
      if (!this.textures.exists(key)) continue;
      // Pre-rendered sky: slightly larger than the view so it can drift with parallax.
      const img = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key).setDisplaySize(GAME_WIDTH * 1.12, GAME_HEIGHT * 1.12).setVisible(false);
      this.skies.set(k, img);
    }
    if (this.skies.size === 0) {
      this.flat = this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      this.cloudsFar = addStrip(this, 0, 120, GAME_WIDTH, 420, 'bg-clouds-far').setOrigin(0).setAlpha(0.85);
      this.islandsFar = addStrip(this, 0, 330, GAME_WIDTH, 640, 'bg-islands-far').setOrigin(0).setAlpha(0.75);
      this.cloudsLow = addStrip(this, 0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    }
    this.buildStars();
    this.buildIslets();
    applyGrade(this, { vignette: 0.08, glow: 0 });
    this.applyLook();
  }

  private buildStars(): void {
    this.stars = [];
    const n = LITE ? 14 : 30;
    for (let i = 0; i < n; i++) {
      // Scattered over the upper sky, denser towards the top.
      const y = Math.pow(Math.random(), 1.6) * GAME_HEIGHT * 0.6;
      const img = this.add
        .image(Math.random() * GAME_WIDTH, y, 'fx-dot')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(i % 4 ? 0xffffff : 0xfff2c4)
        .setScale(0.22 + Math.random() * 0.3)
        .setDepth(2)
        .setVisible(false);
      this.stars.push({ img, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 1.4 });
    }
  }

  private buildIslets(): void {
    this.islets = [];
    const spots: [number, number, number, number][] = [
      // key index, x, y, parallax depth
      [0, 150, 760, 0.35],
      [1, 1790, 650, 0.28],
      [2, 1450, 930, 0.4],
      [1, 420, 330, 0.18],
      // two small ones in the gaps inside the board's loop (seen on the overview)
      [2, 690, 560, 0.16],
      [0, 1250, 500, 0.12],
    ];
    for (const [k, x, y, depth] of spots) {
      const key = `rendered-islet-${k}`;
      if (!this.textures.exists(key)) continue;
      // (Above the skies and stars: the cross-fading sky draws at depth 1.)
      const img = this.add.image(x, y, key).setScale(0.45 + depth * 0.9).setAlpha(0.75 + depth * 0.6).setDepth(5);
      // atmospheric haze: further islets are lighter and bluer
      const haze = Phaser.Display.Color.GetColor(210 + depth * 100, 222 + depth * 80, 240);
      img.setTint(haze);
      this.islets.push({ img, x, y, depth, bob: Math.random() * Math.PI * 2, haze });
    }
  }

  /** Follow the time of day (see DayCycle). Safe to call before the scene has built. */
  setLook(l: Look): void {
    const o = this.look;
    o.glow = l.glow;
    if (o.skyA === l.skyA && o.skyB === l.skyB && Math.abs(o.mix - l.skyMix) < 0.002 && o.tint === l.skyTint && o.lite === l.liteSky) return;
    o.skyA = l.skyA;
    o.skyB = l.skyB;
    o.mix = l.skyMix;
    o.tint = l.skyTint;
    o.lite = l.liteSky;
    this.applyLook();
  }

  private applyLook(): void {
    // Not built yet: create() applies the stored look.
    if (this.skies.size === 0 && !this.flat) return;
    const o = this.look;
    let tint = o.tint;
    if (this.skies.size > 0) {
      const a = this.skies.get(o.skyA);
      const b = this.skies.get(o.skyB);
      if (a && (b || o.mix <= 0)) {
        // Cross-fade: the later sky draws over the earlier one.
        for (const img of this.skies.values()) img.setVisible(false);
        a.setVisible(true).setAlpha(1).setDepth(0).setTint(o.tint);
        if (b && b !== a && o.mix > 0.002) b.setVisible(true).setAlpha(o.mix).setDepth(1).setTint(o.tint);
      } else {
        // Only one sky installed (Lite): tint it to stand in for the others.
        const only = this.skies.get('day') ?? [...this.skies.values()][0];
        for (const img of this.skies.values()) img.setVisible(img === only);
        tint = o.lite;
        only.setAlpha(1).setDepth(0).setTint(tint);
      }
    } else {
      tint = o.lite;
      this.flat?.setTint(tint);
      this.cloudsFar?.setTint(tint);
      this.islandsFar?.setTint(tint);
      this.cloudsLow?.setTint(tint);
    }
    // The islets take the sky's light over their haze (a touch of haze stays at night).
    for (const it of this.islets) it.img.setTint(mulColor(it.haze, lerpColor(tint, 0xffffff, 0.15)));
  }

  override update(_t: number, delta: number): void {
    this.drift += delta / 1000;
    const board = this.scene.get('Board');
    const cam = board?.cameras?.main;
    const sx = cam ? cam.scrollX : 0;
    const sy = cam ? cam.scrollY : 0;
    if (this.skies.size > 0) {
      // Gentle parallax, clamped so the edges never show.
      const px = Phaser.Math.Clamp(-(sx - 1000) * 0.03, -GAME_WIDTH * 0.05, GAME_WIDTH * 0.05);
      const py = Phaser.Math.Clamp(-(sy - 700) * 0.025, -GAME_HEIGHT * 0.05, GAME_HEIGHT * 0.05);
      for (const img of this.skies.values()) if (img.visible) img.setPosition(GAME_WIDTH / 2 + px, GAME_HEIGHT / 2 + py);
    } else if (this.cloudsFar && this.islandsFar && this.cloudsLow) {
      this.cloudsFar.tilePositionX = sx * 0.04 + this.drift * 6;
      this.islandsFar.tilePositionX = sx * 0.08 + this.drift * 2;
      this.islandsFar.y = 330 - sy * 0.03;
      this.cloudsLow.tilePositionX = sx * 0.16 + this.drift * 10;
      this.cloudsLow.y = 640 - sy * 0.05;
    }
    for (const it of this.islets) {
      it.img.setPosition(it.x - (sx - 1000) * 0.05 * it.depth, it.y - (sy - 700) * 0.04 * it.depth + Math.sin(this.drift * 0.4 + it.bob) * 8 * it.depth);
    }
    // Stars twinkle in once night has properly fallen.
    const night = Phaser.Math.Clamp((this.look.glow - 0.55) / 0.45, 0, 1);
    for (const st of this.stars) {
      if (night <= 0) {
        if (st.img.visible) st.img.setVisible(false);
        continue;
      }
      st.img.setVisible(true).setAlpha(night * (0.45 + 0.55 * Math.abs(Math.sin(this.drift * st.speed + st.phase))));
    }
  }
}

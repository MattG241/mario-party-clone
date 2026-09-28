import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { applyGrade } from '../effects/GradePipeline';
import { addStrip } from '../ui/Screen';

/**
 * Sky and far parallax layers behind the board. Lives in its own scene so the board camera can
 * zoom freely without scaling the sky; parallax follows the board camera's scroll.
 */
export class BoardBgScene extends Phaser.Scene {
  private cloudsFar!: Phaser.GameObjects.TileSprite;
  private islandsFar!: Phaser.GameObjects.TileSprite;
  private cloudsLow!: Phaser.GameObjects.TileSprite;
  private rendered: Phaser.GameObjects.Image | null = null;
  private dusk: Phaser.GameObjects.Image | null = null;
  private drift = 0;
  /** Mid-distance floating islets (parallax between the sky and the board). */
  private islets: { img: Phaser.GameObjects.Image; x: number; y: number; depth: number; bob: number }[] = [];
  intensity = 0;

  constructor() {
    super('BoardBg');
  }

  create(): void {
    this.rendered = null;
    this.dusk = null;
    if (this.textures.exists('rendered-sky-day')) {
      // Pre-rendered sky: slightly larger than the view so it can drift with parallax.
      this.rendered = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'rendered-sky-day').setDisplaySize(GAME_WIDTH * 1.12, GAME_HEIGHT * 1.12);
      if (this.textures.exists('rendered-sky-dusk')) {
        this.dusk = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'rendered-sky-dusk').setDisplaySize(GAME_WIDTH * 1.12, GAME_HEIGHT * 1.12).setAlpha(0);
      }
    } else {
      this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      this.cloudsFar = addStrip(this, 0, 120, GAME_WIDTH, 420, 'bg-clouds-far').setOrigin(0).setAlpha(0.85);
      this.islandsFar = addStrip(this, 0, 330, GAME_WIDTH, 640, 'bg-islands-far').setOrigin(0).setAlpha(0.75);
      this.cloudsLow = addStrip(this, 0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    }
    this.buildIslets();
    applyGrade(this, { vignette: 0.08, glow: 0 });
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
      const img = this.add.image(x, y, key).setScale(0.45 + depth * 0.9).setAlpha(0.75 + depth * 0.6);
      // atmospheric haze: further islets are lighter and bluer
      img.setTint(Phaser.Display.Color.GetColor(210 + depth * 100, 222 + depth * 80, 240));
      this.islets.push({ img, x, y, depth, bob: Math.random() * Math.PI * 2 });
    }
  }

  /** 0 = normal, 1 = final-round festival lights (the sky turns to dusk). */
  setIntensity(v: number): void {
    this.intensity = v;
    if (this.dusk) this.tweens.add({ targets: this.dusk, alpha: v, duration: 1600, ease: 'Sine.InOut' });
  }

  override update(_t: number, delta: number): void {
    this.drift += delta / 1000;
    const board = this.scene.get('Board');
    const cam = board?.cameras?.main;
    const sx = cam ? cam.scrollX : 0;
    const sy = cam ? cam.scrollY : 0;
    if (this.rendered) {
      // Gentle parallax, clamped so the edges never show.
      const px = Phaser.Math.Clamp(-(sx - 1000) * 0.03, -GAME_WIDTH * 0.05, GAME_WIDTH * 0.05);
      const py = Phaser.Math.Clamp(-(sy - 700) * 0.025, -GAME_HEIGHT * 0.05, GAME_HEIGHT * 0.05);
      this.rendered.setPosition(GAME_WIDTH / 2 + px, GAME_HEIGHT / 2 + py);
      this.dusk?.setPosition(GAME_WIDTH / 2 + px, GAME_HEIGHT / 2 + py);
    } else {
      this.cloudsFar.tilePositionX = sx * 0.04 + this.drift * 6;
      this.islandsFar.tilePositionX = sx * 0.08 + this.drift * 2;
      this.islandsFar.y = 330 - sy * 0.03;
      this.cloudsLow.tilePositionX = sx * 0.16 + this.drift * 10;
      this.cloudsLow.y = 640 - sy * 0.05;
    }
    for (const it of this.islets) {
      it.img.setPosition(it.x - (sx - 1000) * 0.05 * it.depth, it.y - (sy - 700) * 0.04 * it.depth + Math.sin(this.drift * 0.4 + it.bob) * 8 * it.depth);
    }
  }
}

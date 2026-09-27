import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';

/**
 * Sky and far parallax layers behind the board. Lives in its own scene so the board camera can
 * zoom freely without scaling the sky; parallax follows the board camera's scroll.
 */
export class BoardBgScene extends Phaser.Scene {
  private cloudsFar!: Phaser.GameObjects.TileSprite;
  private islandsFar!: Phaser.GameObjects.TileSprite;
  private cloudsLow!: Phaser.GameObjects.TileSprite;
  private glow!: Phaser.GameObjects.Graphics;
  private rendered: Phaser.GameObjects.Image | null = null;
  private dusk: Phaser.GameObjects.Image | null = null;
  private drift = 0;
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
      this.cloudsFar = this.add.tileSprite(0, 120, GAME_WIDTH, 420, 'bg-clouds-far').setOrigin(0).setAlpha(0.85);
      this.islandsFar = this.add.tileSprite(0, 330, GAME_WIDTH, 640, 'bg-islands-far').setOrigin(0).setAlpha(0.75);
      this.cloudsLow = this.add.tileSprite(0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    }
    // Festival lights overlay (intensifies in the final round).
    this.glow = this.add.graphics();
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
    this.glow.clear();
    if (this.intensity > 0) {
      const t = this.drift;
      const colors = [0xff6b5e, 0xf4b83b, 0x5ce1ff, 0xc49bff, 0x6cc24a];
      for (let i = 0; i < 5; i++) {
        const x = ((i * 430 + t * 60) % (GAME_WIDTH + 400)) - 200;
        const a = (0.08 + 0.05 * Math.sin(t * 2 + i)) * this.intensity;
        this.glow.fillStyle(colors[i], a);
        this.glow.fillEllipse(x, 180 + 60 * Math.sin(t + i), 520, 260);
      }
    }
  }
}

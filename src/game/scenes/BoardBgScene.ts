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
  private drift = 0;
  intensity = 0;

  constructor() {
    super('BoardBg');
  }

  create(): void {
    this.add.image(0, 0, 'bg-sky').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.cloudsFar = this.add.tileSprite(0, 120, GAME_WIDTH, 420, 'bg-clouds-far').setOrigin(0).setAlpha(0.85);
    this.islandsFar = this.add.tileSprite(0, 330, GAME_WIDTH, 640, 'bg-islands-far').setOrigin(0).setAlpha(0.75);
    this.cloudsLow = this.add.tileSprite(0, 640, GAME_WIDTH, 560, 'bg-clouds-below').setOrigin(0).setAlpha(0.9);
    // Festival lights overlay (intensifies in the final round).
    this.glow = this.add.graphics();
  }

  /** 0 = normal, 1 = final-round festival lights. */
  setIntensity(v: number): void {
    this.intensity = v;
  }

  override update(_t: number, delta: number): void {
    this.drift += delta / 1000;
    const board = this.scene.get('Board');
    const cam = board?.cameras?.main;
    const sx = cam ? cam.scrollX : 0;
    const sy = cam ? cam.scrollY : 0;
    this.cloudsFar.tilePositionX = sx * 0.04 + this.drift * 6;
    this.islandsFar.tilePositionX = sx * 0.08 + this.drift * 2;
    this.islandsFar.y = 330 - sy * 0.03;
    this.cloudsLow.tilePositionX = sx * 0.16 + this.drift * 10;
    this.cloudsLow.y = 640 - sy * 0.05;
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

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { applyGrade } from '../effects/GradePipeline';

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
  /** Festival sky-lanterns drifting up through the backdrop (depth = parallax factor). */
  private lanterns: { img: Phaser.GameObjects.Container; x: number; y: number; depth: number; speed: number; sway: number }[] = [];
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
    this.buildLanterns();
    // Festival lights overlay (intensifies in the final round).
    this.glow = this.add.graphics();
    applyGrade(this, { vignette: 0.18 });
  }

  private buildLanterns(): void {
    this.lanterns = [];
    if (!this.textures.exists('sky-lantern')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xff9a3a, 1);
      g.fillRoundedRect(4, 6, 24, 30, { tl: 10, tr: 10, bl: 4, br: 4 });
      g.fillStyle(0xffd27a, 1);
      g.fillRoundedRect(8, 10, 16, 20, { tl: 7, tr: 7, bl: 3, br: 3 });
      g.fillStyle(0xfff4dc, 1);
      g.fillRect(12, 30, 8, 4);
      g.fillStyle(0x7a3a12, 1);
      g.fillRect(6, 34, 20, 3);
      g.generateTexture('sky-lantern', 32, 40);
      g.destroy();
    }
    const rnd = new Phaser.Math.RandomDataGenerator(['sky-lanterns']);
    for (let i = 0; i < 14; i++) {
      const depth = rnd.realInRange(0.25, 1);
      const c = this.add.container(0, 0);
      const halo = this.add.image(0, 6, 'fx-dot').setScale(2.2 * depth + 0.6).setTint(0xffb347).setAlpha(0.45).setBlendMode(Phaser.BlendModes.ADD);
      const body = this.add.image(0, 0, 'sky-lantern').setScale(0.35 + depth * 0.55).setAlpha(0.55 + depth * 0.4);
      c.add([halo, body]);
      this.lanterns.push({ img: c, x: rnd.realInRange(0, GAME_WIDTH), y: rnd.realInRange(0, GAME_HEIGHT + 200), depth, speed: rnd.realInRange(10, 22) * (0.5 + depth), sway: rnd.realInRange(0, Math.PI * 2) });
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
    // Sky-lanterns rise and sway; nearer ones move faster and parallax more with the board camera.
    const dt = delta / 1000;
    for (const l of this.lanterns) {
      l.y -= l.speed * dt;
      if (l.y < -80) {
        l.y = GAME_HEIGHT + 80;
        l.x = Math.random() * GAME_WIDTH;
      }
      const px = ((((l.x - sx * 0.06 * l.depth) % (GAME_WIDTH + 100)) + GAME_WIDTH + 100) % (GAME_WIDTH + 100)) - 50;
      l.img.setPosition(px + Math.sin(this.drift * 0.8 + l.sway) * 14 * l.depth, l.y - sy * 0.04 * l.depth);
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

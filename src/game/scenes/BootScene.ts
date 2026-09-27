import Phaser from 'phaser';

/** First scene: starts the always-on system overlay, then the loading screen. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.launch('System');
    this.scene.start('Preload');
  }
}

import Phaser from 'phaser';
import { input } from '../input/InputManager';
import { addText } from '../ui/theme';
import { enterScene, goTo } from '../ui/Transition';

/** TEMPORARY STUB — replaced by the real implementation. */
export class DevLaunchScene extends Phaser.Scene {
  constructor() {
    super('DevLaunch');
  }
  create(): void {
    enterScene(this);
    addText(this, 960, 540, 'DevLaunch (in progress) — press B', 48, { color: '#fff4dc' });
  }
  override update(): void {
    if (input.any.pressed('B')) goTo(this, 'Title');
  }
}

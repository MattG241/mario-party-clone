import Phaser from 'phaser';
import { input } from '../input/InputManager';

const FADE_RGB: [number, number, number] = [13, 59, 71];
const leaving = new WeakSet<Phaser.Scene>();

/** Fade the current scene out and start another. Repeated calls while leaving are ignored. */
export function goTo(scene: Phaser.Scene, key: string, data?: object, ms = 240): void {
  if (leaving.has(scene)) return;
  leaving.add(scene);
  const cam = scene.cameras.main;
  cam.fadeOut(ms, ...FADE_RGB);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    leaving.delete(scene);
    scene.scene.start(key, data);
  });
}

/** Call at the top of create(): fade in and ignore buttons still held from the last screen. */
export function enterScene(scene: Phaser.Scene, ms = 240): void {
  leaving.delete(scene);
  scene.cameras.main.fadeIn(ms, ...FADE_RGB);
  input.lockHeld();
}

export function isLeaving(scene: Phaser.Scene): boolean {
  return leaving.has(scene);
}

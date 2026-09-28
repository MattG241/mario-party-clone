import Phaser from 'phaser';
import { input } from '../input/InputManager';
import { wipeHost } from './Wipe';

const FADE_RGB: [number, number, number] = [13, 59, 71];
const leaving = new WeakSet<Phaser.Scene>();

/** Sweep-in time for a transition that used to fade out over `ms` (the wipe stays under ~0.45 s in all). */
function coverMs(ms: number): number {
  return Phaser.Math.Clamp(Math.round(ms * 0.85), 160, 280);
}

function revealMs(ms: number): number {
  return Phaser.Math.Clamp(Math.round(ms * 0.8), 180, 360);
}

/**
 * Leave the current scene for another behind the festival wipe (a camera fade before the System
 * scene is up). Repeated calls while leaving are ignored.
 */
export function goTo(scene: Phaser.Scene, key: string, data?: object, ms = 240): void {
  if (leaving.has(scene)) return;
  leaving.add(scene);
  coverThen(
    scene,
    () => {
      leaving.delete(scene);
      scene.scene.start(key, data);
    },
    ms,
  );
}

/**
 * Cover the screen (the wipe, or a camera fade to navy) and then run `fn`, for hand-overs that
 * aren't a plain scene start (waking a sleeping scene, say). Whatever comes next reveals the
 * screen with enterScene.
 */
export function coverThen(scene: Phaser.Scene, fn: () => void, ms = 240): void {
  const wipe = wipeHost();
  if (wipe) {
    wipe.cover(coverMs(ms), fn);
    return;
  }
  const cam = scene.cameras.main;
  cam.fadeOut(ms, ...FADE_RGB);
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, fn);
}

/** Call at the top of create(): reveal the scene and ignore buttons still held from the last screen. */
export function enterScene(scene: Phaser.Scene, ms = 240): void {
  leaving.delete(scene);
  const wipe = wipeHost();
  if (wipe) {
    // A camera left faded out (a scene put to sleep behind a fade) would stay dark under the wipe.
    scene.cameras.main.resetFX();
    wipe.reveal(revealMs(ms));
  } else {
    scene.cameras.main.fadeIn(ms, ...FADE_RGB);
  }
  input.lockHeld();
}

export function isLeaving(scene: Phaser.Scene): boolean {
  return leaving.has(scene);
}

/** True while a scene transition is covering or uncovering the screen. */
export function transitionBusy(): boolean {
  return wipeHost()?.busy ?? false;
}

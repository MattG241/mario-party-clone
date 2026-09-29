// Small helpers shared by the Cartoon Coast minigames (Ring Rush, Patty Panic, Donut Dash).
import Phaser from 'phaser';
import { LITE } from '../../perf';
import { inflateTexture } from '../../util/texture';

/**
 * Lite on WebGL loads the half-size copy of a sprite atlas (public/assets/lite/mg) with the full-size
 * JSON, then stretches it back over the full-size frame coordinates (inflateTexture), as the game
 * does for its character sheets. The canvas renderer reads frames straight from the image, so it
 * keeps the full-size sheet.
 */
function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Atlases loaded at half size and already stretched back (so a reused texture isn't stretched twice). */
const inflated = new Set<string>();

/** Queue a world sprite atlas (call from preload): mg/<file>.webp + mg/<file>.json. */
export function queueAtlas(scene: Phaser.Scene, key: string, file: string): void {
  if (scene.textures.exists(key)) return;
  const dir = halfSize(scene) ? 'assets/lite' : 'assets/rendered';
  scene.load.atlas(key, `${dir}/mg/${file}.webp`, `assets/rendered/mg/${file}.json`);
}

/**
 * After loading (call from create): stretch Lite's half-size atlas back to full size, and release it
 * when the scene shuts down (a minigame's sprites are only needed while it runs).
 */
export function finishAtlas(scene: Phaser.Scene, key: string): boolean {
  if (!scene.textures.exists(key)) return false;
  if (halfSize(scene) && !inflated.has(key)) {
    inflateTexture(scene.textures.get(key), 2);
    inflated.add(key);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    inflated.delete(key);
  });
  return true;
}

/** Whether an atlas is loaded and has this frame. */
export function hasFrame(scene: Phaser.Scene, key: string, frame: string): boolean {
  return scene.textures.exists(key) && scene.textures.get(key).has(frame);
}

/** Linear blend of two 0xRRGGBB colours. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

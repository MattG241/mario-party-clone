// Sprite loading for Slapshot Showdown's rendered pieces (with Lite's half-size copies), kept inside
// the rink module so it stands on its own.
import Phaser from 'phaser';
import { LITE } from '../../perf';
import { inflateTexture } from '../../util/texture';

/** Texture key of a world minigame sprite (public/assets/rendered/mg/<file>.webp). */
export function spriteKey(file: string): string {
  return `wmg-${file}`;
}

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Queue sprites on the scene's loader (call from preload): Lite on WebGL loads the half-size copies. */
export function queueSprites(scene: Phaser.Scene, files: readonly string[]): void {
  const dir = halfSize(scene) ? 'assets/lite/mg' : 'assets/rendered/mg';
  for (const f of files) {
    const key = spriteKey(f);
    if (!scene.textures.exists(key)) scene.load.image(key, `${dir}/${f}.webp`);
  }
}

/** Textures already at full size (stretched back, or painted as fallbacks). */
const fullSize = new Set<string>();

/** After loading (call from create): stretch Lite's half-size sprites back over full-size coordinates. */
export function finishSprites(scene: Phaser.Scene, files: readonly string[]): void {
  if (!halfSize(scene)) return;
  for (const f of files) {
    const key = spriteKey(f);
    if (scene.textures.exists(key) && !fullSize.has(key)) {
      inflateTexture(scene.textures.get(key), 2);
      fullSize.add(key);
    }
  }
}

/** Paint a canvas texture once (fallback art when a rendered sprite is missing); never stretched. */
export function paintTexture(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  paint(tex.getContext());
  tex.refresh();
  fullSize.add(key);
}

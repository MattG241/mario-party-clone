// Rendered arenas for the minigames (scripts/art/scenes.py, mg_arenas.py, orbit_arms.py). They are
// the largest images in the game, so instead of loading them all at start each minigame's set is
// loaded while its intro card comes up, and the previous set is released. Lite (on WebGL) loads the
// half-size copies from public/assets/lite and stretches them back to full size (inflateTexture).
import Phaser from 'phaser';
import { LITE } from '../perf';
import { inflateTexture } from '../util/texture';
import { WORLD_MINIGAME_RENDERS } from '../worlds/infos';

export interface RenderSet {
  /** Full-screen images: texture `rendered-scene-<name>` from scene_<name>.webp. */
  images: string[];
  /** The Orbit Dodge arm frames (an atlas). */
  arms?: boolean;
  /** Arena geometry for the 3D Gleam Grab stage (JSON cache `rendered-gleam3d`). */
  gleamMeta?: boolean;
}

export const MINIGAME_RENDERS: Record<string, RenderSet> = {
  'gleam-grab': { images: ['gleam3d', 'gleam3d_wall', 'gleam3d_blur'], gleamMeta: true },
  'orbit-dodge': { images: ['orbit', 'orbit_blur'], arms: true },
  'crate-craze': { images: ['crate', 'crate_wall'] },
  'totem-tug': { images: ['totem'] },
  'spiral-splash': { images: ['pond'] },
  'relic-relay': { images: ['relay'] },
  // The guests' worlds (src/game/worlds/<id>/info.ts).
  ...(WORLD_MINIGAME_RENDERS as Record<string, RenderSet>),
};

const ARMS = 'rendered-orbit-arms';
const sceneKey = (name: string) => `rendered-scene-${name}`;

function textureKeys(set: RenderSet): string[] {
  return [...set.images.map(sceneKey), ...(set.arms ? [ARMS] : [])];
}

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Textures loaded at half size and already stretched back (so a reused texture isn't stretched twice). */
const inflated = new Set<string>();

/**
 * Queue a minigame's arena art on the scene's loader (call from preload) and release every other
 * minigame's, so only one arena set is ever held in memory.
 */
export function queueMinigameRenders(scene: Phaser.Scene, id: string): void {
  const set = MINIGAME_RENDERS[id];
  const keep = new Set(set ? textureKeys(set) : []);
  for (const other of Object.values(MINIGAME_RENDERS)) {
    for (const key of textureKeys(other)) {
      if (!keep.has(key) && scene.textures.exists(key)) {
        scene.textures.remove(key);
        inflated.delete(key);
      }
    }
  }
  if (!set) return;
  const dir = halfSize(scene) ? 'assets/lite' : 'assets/rendered';
  for (const name of set.images) {
    if (!scene.textures.exists(sceneKey(name))) scene.load.image(sceneKey(name), `${dir}/scene_${name}.webp`);
  }
  if (set.arms && !scene.textures.exists(ARMS)) scene.load.atlas(ARMS, `${dir}/orbit_arms.webp`, 'assets/rendered/orbit_arms.json');
  if (set.gleamMeta && !scene.cache.json.exists('rendered-gleam3d')) scene.load.json('rendered-gleam3d', 'assets/rendered/scene_gleam3d.json');
}

/** After loading (call from create): stretch Lite's half-size textures back to full size. */
export function finishMinigameRenders(scene: Phaser.Scene, id: string): void {
  const set = MINIGAME_RENDERS[id];
  if (!set || !halfSize(scene)) return;
  for (const key of textureKeys(set)) {
    if (scene.textures.exists(key) && !inflated.has(key)) {
      inflateTexture(scene.textures.get(key), 2);
      inflated.add(key);
    }
  }
}

/** Keys of the small arena thumbnails the Minigame Mode menu shows (the Lite copies, never stretched). */
export function arenaThumbKey(arena: string): string {
  return `thumb-${arena}`;
}

/** Queue every minigame's arena thumbnail (the Minigame Mode menu's cards). */
export function queueArenaThumbs(scene: Phaser.Scene): void {
  for (const set of Object.values(MINIGAME_RENDERS)) {
    const name = set.images[0];
    const key = arenaThumbKey(sceneKey(name));
    if (!scene.textures.exists(key)) scene.load.image(key, `assets/lite/scene_${name}.webp`);
  }
}

/** Release the thumbnails when the menu closes. */
export function releaseArenaThumbs(scene: Phaser.Scene): void {
  for (const set of Object.values(MINIGAME_RENDERS)) {
    const key = arenaThumbKey(sceneKey(set.images[0]));
    if (scene.textures.exists(key)) scene.textures.remove(key);
  }
}

// Dojo Summit's gameplay sprites (scripts/art/worlds/dojo/mg_sprites.py): public/assets/rendered/mg/
// dojo_<name>.webp, half-size copies in public/assets/lite/mg for Lite. A minigame queues the ones it
// needs in preload() and finishes them in create(): Lite (on WebGL) stretches the half-size images back
// to full size, and anything that failed to load is replaced by a simple drawn stand-in, so a game
// never shows a missing texture.
import Phaser from 'phaser';
import { LITE } from '../../perf';
import { inflateTexture } from '../../util/texture';

/** Texture keys and full-size image sizes (as rendered). */
export const DOJO_SPRITES = {
  cloud: { key: 'dojo-cloud', w: 320, h: 180 },
  ring: { key: 'dojo-ring', w: 128, h: 176 },
  orb: { key: 'dojo-orb', w: 128, h: 128 },
  storm: { key: 'dojo-storm', w: 400, h: 256 },
  puff: { key: 'dojo-puff', w: 256, h: 224 },
} as const;

export type DojoSprite = keyof typeof DOJO_SPRITES;

/** Keys already stretched back to full size (a texture is stretched once, however often a game runs). */
const inflated = new Set<string>();

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

export function queueDojoSprites(scene: Phaser.Scene, names: readonly DojoSprite[]): void {
  const dir = halfSize(scene) ? 'assets/lite/mg' : 'assets/rendered/mg';
  for (const n of names) {
    const { key } = DOJO_SPRITES[n];
    if (scene.textures.exists(key)) continue;
    inflated.delete(key);
    scene.load.image(key, `${dir}/dojo_${n}.webp`);
  }
}

export function finishDojoSprites(scene: Phaser.Scene, names: readonly DojoSprite[]): void {
  for (const n of names) {
    const { key, w, h } = DOJO_SPRITES[n];
    if (!scene.textures.exists(key)) {
      drawStandIn(scene, n, key, w, h);
      inflated.add(key);
      continue;
    }
    if (halfSize(scene) && !inflated.has(key)) {
      const tex = scene.textures.get(key);
      // only a genuinely half-size image is stretched (a stand-in or a full-size file is left alone)
      if (tex.source[0] && tex.source[0].width < w * 0.75) inflateTexture(tex, 2);
      inflated.add(key);
    }
  }
}

/** A plain drawn version of a sprite (only when its image is missing). */
function drawStandIn(scene: Phaser.Scene, n: DojoSprite, key: string, w: number, h: number): void {
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const puffs = (fill: string, shade: string, list: [number, number, number][]) => {
    for (const [x, y, r] of list) {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(x * w, y * h + r * 0.12 * h, r * h, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, y, r] of list) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x * w, y * h, r * h, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const blob: [number, number, number][] = [
    [0.3, 0.55, 0.22],
    [0.5, 0.45, 0.3],
    [0.7, 0.55, 0.24],
    [0.18, 0.62, 0.14],
    [0.84, 0.62, 0.14],
  ];
  if (n === 'cloud') puffs('#ffd24f', '#e8952c', blob);
  else if (n === 'storm') puffs('#6d6f94', '#35334f', blob);
  else if (n === 'puff') puffs('#ffffff', '#c9cfdd', [[0.5, 0.5, 0.3], [0.3, 0.55, 0.2], [0.7, 0.55, 0.2], [0.5, 0.3, 0.18]]);
  else if (n === 'ring') {
    ctx.strokeStyle = '#ffc93d';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.3, h * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.4);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#8ae9ff');
    g.addColorStop(1, 'rgba(90,210,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  tex.refresh();
}

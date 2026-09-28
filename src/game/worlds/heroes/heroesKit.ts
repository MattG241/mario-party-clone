// Small pieces shared by the three Hero Heights minigames: their rendered sprites (loaded with the
// scene, half size on Lite and stretched back like the arenas), soft generated textures, a night
// sky fallback for when a render is missing, and pinning a scrolling game's UI to the screen.
import Phaser from 'phaser';
import { animBaseline, type Character } from '../../characters/Character';
import { GAME_WIDTH } from '../../constants';
import { LITE } from '../../perf';
import { inflateTexture } from '../../util/texture';

/** Texture key of a rendered Hero Heights sprite (public/assets/rendered/mg/heroes_<name>.webp). */
export function heroTex(name: string): string {
  return `rendered-heroes-${name}`;
}

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Textures loaded at half size and already stretched back (so a reused one isn't stretched twice). */
const inflated = new Set<string>();

/** Queue a game's rendered sprites (call from preload). Missing files are fine: every game draws its own fallback. */
export function queueHeroSprites(scene: Phaser.Scene, names: readonly string[]): void {
  const dir = halfSize(scene) ? 'assets/lite/mg' : 'assets/rendered/mg';
  for (const n of names) {
    const key = heroTex(n);
    if (!scene.textures.exists(key)) scene.load.image(key, `${dir}/heroes_${n}.webp`);
  }
}

/**
 * After loading (call first thing in createArena): stretch Lite's half-size sprites back to full
 * size, and release them all when the scene closes (only one minigame's art is ever held).
 */
export function finishHeroSprites(scene: Phaser.Scene, names: readonly string[]): void {
  const half = halfSize(scene);
  for (const n of names) {
    const key = heroTex(n);
    if (half && scene.textures.exists(key) && !inflated.has(key)) {
      inflateTexture(scene.textures.get(key), 2);
      inflated.add(key);
    }
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    for (const n of names) {
      const key = heroTex(n);
      if (scene.textures.exists(key)) scene.textures.remove(key);
      inflated.delete(key);
    }
  });
}

/** Paint a canvas texture once (kept for the rest of the session: they are all small). */
export function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return key;
  paint(tex.getContext(), w, h);
  tex.refresh();
  return key;
}

/** A soft round glow, bright in the middle (white: tint it). */
export function glowTex(scene: Phaser.Scene): string {
  return canvasTex(scene, 'hh-glow', 96, 96, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** A thin streak fading at both ends (speed lines, rising air). */
export function streakTex(scene: Phaser.Scene): string {
  return canvasTex(scene, 'hh-streak', 8, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Night sky fallback (no render loaded): a deep blue gradient, a few stars and a big soft moon.
 * `warm` gives a dusk sky instead (orange at the horizon).
 */
export function fallbackSky(scene: Phaser.Scene, depth: number, warm = false, scrollFactor = 0): void {
  const g = scene.add.graphics().setDepth(depth).setScrollFactor(scrollFactor);
  const top = warm ? 0x3b3a78 : 0x0c1636;
  const mid = warm ? 0xc86a7a : 0x1d2d63;
  const low = warm ? 0xffb072 : 0x3a4f8e;
  g.fillGradientStyle(top, top, mid, mid, 1);
  g.fillRect(0, 0, GAME_WIDTH, 620);
  g.fillGradientStyle(mid, mid, low, low, 1);
  g.fillRect(0, 620, GAME_WIDTH, 460);
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    g.fillStyle(0xffffff, 0.25 + rnd() * 0.6);
    g.fillCircle(rnd() * GAME_WIDTH, rnd() * 560, 1 + rnd() * 1.8);
  }
  const mx = warm ? 1500 : 1560;
  const my = warm ? 330 : 250;
  for (let r = 150; r > 60; r -= 10) {
    g.fillStyle(warm ? 0xffd9a0 : 0xdfe8ff, 0.03);
    g.fillCircle(mx, my, r);
  }
  g.fillStyle(warm ? 0xffe2b0 : 0xf4f6ff, 1);
  g.fillCircle(mx, my, 62);
  if (!warm) {
    g.fillStyle(0xd6dcef, 1);
    g.fillCircle(mx - 18, my - 10, 12);
    g.fillCircle(mx + 20, my + 16, 8);
  }
}

/**
 * A scrolling game's own screen-space UI: pin everything in the UI depth band (8000 and up) to the
 * screen, masks included (BaseMinigame pins its HUD; banners pin themselves; this catches the rest).
 */
export function pinUiBand(scene: Phaser.Scene): void {
  for (const o of scene.children.list) {
    const go = o as unknown as { depth?: number; scrollFactorX?: number };
    if ((go.depth ?? 0) >= 8000 && go.scrollFactorX !== 0) pinTree(o);
  }
}

function pinTree(o: Phaser.GameObjects.GameObject): void {
  const sf = o as unknown as { setScrollFactor?: (x: number, y?: number) => unknown };
  sf.setScrollFactor?.(0, 0);
  const masked = o as unknown as { mask?: { geometryMask?: Phaser.GameObjects.Graphics } | null };
  masked.mask?.geometryMask?.setScrollFactor(0, 0);
  if (o instanceof Phaser.GameObjects.Container) for (const child of o.list) pinTree(child);
}

/** Trace a player shape (circle, triangle, diamond, hexagon) as a canvas path, ready to fill or stroke. */
export function canvasShape(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    return;
  }
  const pts: [number, number][] =
    shape === 'triangle'
      ? [
          [0, -1.12],
          [1.05, 0.72],
          [-1.05, 0.72],
        ]
      : shape === 'diamond'
        ? [
            [0, -1.15],
            [0.95, 0],
            [0, 1.15],
            [-0.95, 0],
          ]
        : [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * 1.05, Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * 1.05] as [number, number]);
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px * r, y + py * r) : ctx.lineTo(x + px * r, y + py * r)));
  ctx.closePath();
}

/**
 * Register a character's sprite on its body centre instead of its feet (the container then sits at
 * the body centre, the feet `bodyPx` screen px below it), so tilts and flips turn about the middle.
 * Call after every play()/hold(), which put the origin back on the feet.
 */
export function centreOnBody(c: Character, bodyPx: number, scale: number): void {
  const h = c.sprite.frame.realHeight || 389;
  c.sprite.setOrigin(0.5, animBaseline(c.charId, c.current) - bodyPx / scale / h);
}

/** Keep the player badge `offsetPx` screen px above the body centre and upright, whatever the tilt. */
export function uprightBadge(c: Character, offsetPx: number, rot: number, scale: number): void {
  const m = offsetPx / scale;
  c.marker?.setPosition(m * Math.sin(rot), m * Math.cos(rot)).setRotation(-rot);
}

/** Back to standing on the feet at (x, y) (for the finish poses, which play from the feet). */
export function standOnFeet(c: Character, x: number, y: number): void {
  c.setRotation(0).setPosition(x, y);
  c.play('idle', { force: true });
  c.sprite.setOrigin(0.5, animBaseline(c.charId, 'idle'));
  c.marker?.setPosition(0, c.headY - 46).setRotation(0);
}

/** The Character's player ring (the ellipse at its feet): hidden while it flies. */
export function playerRing(c: Phaser.GameObjects.Container): Phaser.GameObjects.Ellipse | undefined {
  return c.list.find((o) => o instanceof Phaser.GameObjects.Ellipse) as Phaser.GameObjects.Ellipse | undefined;
}

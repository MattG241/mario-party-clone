// Small helpers shared by the Showtime Strip minigames: their rendered sprites (loaded with the
// scene, half size on Lite and stretched back, released when it closes), a direction reader that
// turns stick flicks and D-pad presses into single "moves", and a few baked textures.
import Phaser from 'phaser';
import type { Controls } from '../../input/Controls';
import { LITE } from '../../perf';
import { inflateTexture } from '../../util/texture';

export type SpriteFile = readonly [key: string, file: string];

function halfSize(scene: Phaser.Scene): boolean {
  return LITE && scene.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Queue a minigame's own sprites (public/assets/rendered/mg/<file>.webp; Lite: the half-size copies). Call from preload. */
export function queueSprites(scene: Phaser.Scene, files: readonly SpriteFile[]): void {
  const dir = halfSize(scene) ? 'assets/lite/mg' : 'assets/rendered/mg';
  for (const [key, file] of files) if (!scene.textures.exists(key)) scene.load.image(key, `${dir}/${file}.webp`);
}

/** After loading (call from create): stretch Lite's half-size sprites back over full-size coordinates. */
export function finishSprites(scene: Phaser.Scene, files: readonly SpriteFile[]): void {
  if (!halfSize(scene)) return;
  for (const [key] of files) {
    if (!scene.textures.exists(key)) continue;
    const tex = scene.textures.get(key);
    const data = tex.customData as { stInflated?: boolean };
    if (data.stInflated) continue;
    inflateTexture(tex, 2);
    data.stInflated = true;
  }
}

/** Release them when the scene closes (only one minigame's art is held at a time). */
export function releaseOnShutdown(scene: Phaser.Scene, files: readonly SpriteFile[]): void {
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    for (const [key] of files) if (scene.textures.exists(key)) scene.textures.remove(key);
  });
}

export type Dir = 'L' | 'R' | 'U' | 'D';

/**
 * Turns a player's stick and D-pad into discrete direction presses: a D-pad press (or arrow key),
 * or the stick pushed out past ENGAGE after resting under RELEASE. A stick springing back past the
 * centre can't fire the opposite way straight away.
 */
export class DirReader {
  static readonly ENGAGE = 0.62;
  static readonly RELEASE = 0.38;
  static readonly REBOUND_MS = 90;
  private stick: Dir | null = null;
  private lastDir: Dir | null = null;
  private lastAt = -1e9;

  read(c: Controls, now: number): Dir | null {
    let pad: Dir | null = null;
    if (c.pressed('LEFT')) pad = 'L';
    else if (c.pressed('RIGHT')) pad = 'R';
    else if (c.pressed('UP')) pad = 'U';
    else if (c.pressed('DOWN')) pad = 'D';
    const x = c.moveX;
    const y = c.moveY;
    const m = Math.hypot(x, y);
    let s = this.stick;
    if (m < DirReader.RELEASE) s = null;
    else if (m > DirReader.ENGAGE) s = Math.abs(x) >= Math.abs(y) ? (x < 0 ? 'L' : 'R') : y < 0 ? 'U' : 'D';
    if (pad) {
      // The D-pad and arrow keys also drive the stick axes: take the press once.
      this.stick = s ?? pad;
      return this.fire(pad, now);
    }
    const prev = this.stick;
    this.stick = s;
    if (!s || s === prev) return null;
    if (this.lastDir && opposite(s, this.lastDir) && now - this.lastAt < DirReader.REBOUND_MS) return null;
    return this.fire(s, now);
  }

  /** Forget the held direction (e.g. after a pause), so the next push fires. */
  reset(): void {
    this.stick = null;
  }

  private fire(d: Dir, now: number): Dir {
    this.lastDir = d;
    this.lastAt = now;
    return d;
  }
}

function opposite(a: Dir, b: Dir): boolean {
  return (a === 'L' && b === 'R') || (a === 'R' && b === 'L') || (a === 'U' && b === 'D') || (a === 'D' && b === 'U');
}

/** Screen x of each of n performers spread evenly round the centre; `gaps` = the spacing for 2, 3 and 4 of them. */
export function spread(n: number, gaps: readonly [number, number, number]): number[] {
  if (n <= 1) return [960];
  const g = gaps[Math.min(4, n) - 2];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(960 + (i - (n - 1) / 2) * g);
  return out;
}

/**
 * A soft vertical light cone (white, for tinting): bright at the top, widening and fading towards
 * the bottom, with feathered sides. Baked once.
 */
export function beamTexture(scene: Phaser.Scene, key = 'showtime-beam'): string {
  if (scene.textures.exists(key)) return key;
  const W = 128;
  const H = 256;
  const tex = scene.textures.createCanvas(key, W, H);
  if (!tex) return key;
  const ctx = tex.getContext();
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const half = (0.18 + 0.82 * v) * (W / 2);
    const a = 0.85 * (1 - v * 0.55);
    const grd = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.3, `rgba(255,255,255,${a * 0.55})`);
    grd.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.7, `rgba(255,255,255,${a * 0.55})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(W / 2 - half, y, half * 2, 1);
  }
  tex.refresh();
  return key;
}

/** A soft round glow (white, for tinting), for light pools and bulb flares. Baked once. */
export function glowTexture(scene: Phaser.Scene, key = 'showtime-glow'): string {
  if (scene.textures.exists(key)) return key;
  const S = 128;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.refresh();
  return key;
}

/** A small heart (white, for tinting): swoons, happy customers. Baked once. */
export function heartTexture(scene: Phaser.Scene, key = 'showtime-heart'): string {
  if (scene.textures.exists(key)) return key;
  const S = 64;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return key;
  const ctx = tex.getContext();
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(32, 56);
    ctx.bezierCurveTo(6, 40, 2, 22, 12, 13);
    ctx.bezierCurveTo(21, 5, 30, 10, 32, 18);
    ctx.bezierCurveTo(34, 10, 43, 5, 52, 13);
    ctx.bezierCurveTo(62, 22, 58, 40, 32, 56);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  path();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(40,20,50,0.55)';
  ctx.stroke();
  path();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(22, 20, 6, 4, -0.6, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
  return key;
}

/** A four-pointed sparkle (white, for tinting). Baked once. */
export function sparkleTexture(scene: Phaser.Scene, key = 'showtime-sparkle'): string {
  if (scene.textures.exists(key)) return key;
  const S = 64;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 31 : 7;
    const x = 32 + Math.cos(a) * r;
    const y = 32 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  tex.refresh();
  return key;
}

// Fairway Frenzy: its rendered sprites' framing, the words it pops, the spectators' spots, the small
// UI pieces it paints, and the fallback art drawn when a render is missing (apart from Fairway.ts).
import type Phaser from 'phaser';
import { PLAYER_SHAPES } from '../../../constants';
import { drawPlayerShape } from '../../../ui/PlayerBadge';
import { canvasTexture, spriteKey, type GallerySpot } from '../sportsKit';
import * as R from './fairwayRules';

const { COSB } = R;

/** The golf ball render is 32 px across (drawn 2 * BALL_R across). */
export const BALL_ART = 32;
/**
 * The flagstick render (with its long shadow falling back-right): 180x180, the foot of the pole (in
 * the cup) at its pixel (22, 172), the pole 160 px tall (see mg_green.py).
 */
export const FLAG_ART = { w: 180, h: 180, ax: 22, ay: 172 };
/** A rounded dark pill for the bottom chips. */
export function chip(g: Phaser.GameObjects.Graphics, w: number, color: number): void {
  g.fillStyle(0x0a1120, 0.3);
  g.fillRoundedRect(-w / 2 + 3, -26 + 4, w, 52, 26);
  g.fillStyle(0x10202c, 0.88);
  g.fillRoundedRect(-w / 2, -26, w, 52, 26);
  g.lineStyle(3, color, 1);
  g.strokeRoundedRect(-w / 2, -26, w, 52, 26);
}

/** A tee mat in a player's colour with their shape on it. */
export function drawTee(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, shape: (typeof PLAYER_SHAPES)[number]): void {
  g.fillStyle(0x0a1120, 0.22);
  g.fillEllipse(x, y + 4, 92, 92 * COSB * 0.62);
  g.fillStyle(color, 0.5);
  g.fillEllipse(x, y, 84, 84 * COSB * 0.6);
  g.lineStyle(3, 0xffffff, 0.75);
  g.strokeEllipse(x, y, 84, 84 * COSB * 0.6);
  drawPlayerShape(g, shape, x + 30, y - 2, 9, color, 0xffffff, 2);
}

export const WORD_STYLES: [string, string, readonly [string, string]][] = [
  ['cap-fw-chipin', 'CHIP-IN!', ['#fff7c2', '#ffc93a']],
  ['cap-fw-putt', 'NICE PUTT!', ['#eaffe0', '#7ed957']],
  ['cap-fw-in', 'IN THE HOLE!', ['#ffffff', '#bde8ff']],
  ['cap-fw-lip', 'LIPPED OUT', ['#ffffff', '#c9d2dc']],
  ['cap-fw-sand', 'SAND!', ['#fff6dd', '#e8c173']],
  ['cap-fw-tee', 'BACK TO THE TEE', ['#ffffff', '#c9d2dc']],
  ['cap-fw-closest', 'CLOSEST TO THE PIN!', ['#fff7c2', '#ffb020']],
  ['cap-fw-knock', 'KNOCK!', ['#ffffff', '#ffd0a8']],
];

/** Spectators along the edges of the lawn (clear spots in the render). */
export const GALLERY: GallerySpot[] = [
  { x: 118, y: 560, id: 'pipper', pose: 'happy' },
  { x: 150, y: 700, id: 'ora', pose: 'cheer' },
  { x: 240, y: 930, id: 'mimi', pose: 'laugh' },
  { x: 1802, y: 560, id: 'packsprout', pose: 'cheer', flip: true },
  { x: 1770, y: 700, id: 'wrench', pose: 'laugh', flip: true },
  { x: 1680, y: 930, id: 'ora', pose: 'wave', flip: true },
];

// --- Fallback art (when the rendered sprites or the green render are missing) ----------------------
export function makeFallbackSprites(scene: Phaser.Scene): void {
  canvasTexture(scene, spriteKey('capitol_golfball'), BALL_ART, BALL_ART, (ctx) => {
    const g = ctx.createRadialGradient(12, 11, 2, 16, 16, 15);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#eef1f5');
    g.addColorStop(1, '#b9c0cc');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, spriteKey('capitol_flag'), FLAG_ART.w, FLAG_ART.h, (ctx) => {
    ctx.fillStyle = 'rgba(10,17,32,0.3)';
    ctx.beginPath();
    ctx.ellipse(FLAG_ART.ax + 6, FLAG_ART.ay, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f6fa';
    ctx.fillRect(FLAG_ART.ax - 3, 10, 6, FLAG_ART.ay - 10);
    ctx.fillStyle = '#c9ced8';
    ctx.fillRect(FLAG_ART.ax + 1, 10, 2, FLAG_ART.ay - 10);
  });
}

export function drawFallbackGreen(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(-50);
  g.fillStyle(0x4f9a3c, 1);
  g.fillEllipse(R.BOUNDS.cx, R.BOUNDS.cy, R.BOUNDS.rx * 2 + 60, R.BOUNDS.ry * 2 + 60);
  g.fillStyle(0x62b04a, 1);
  g.fillEllipse(R.GREEN.cx, R.GREEN.cy, R.GREEN.rx * 2 * R.FRINGE_K, R.GREEN.ry * 2 * R.FRINGE_K);
  g.fillStyle(0x7cc95a, 1);
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const r = R.outlineK(a);
    pts.push({ x: R.GREEN.cx + Math.cos(a) * R.GREEN.rx * r, y: R.GREEN.cy + Math.sin(a) * R.GREEN.ry * r });
  }
  g.fillPoints(pts, true);
  g.fillStyle(0xe6cf8e, 1);
  for (const b of R.BUNKERS) g.fillEllipse(b.cx, b.cy, b.rx * 2, b.ry * 2);
}

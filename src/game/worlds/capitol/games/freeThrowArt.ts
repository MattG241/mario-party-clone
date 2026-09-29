// Free Throw Frenzy: its rendered sprites' framing, the words it pops, the spectators' spots, and the
// fallback art drawn when a render is missing (kept apart from the gameplay in FreeThrow.ts).
import type Phaser from 'phaser';
import { GAME_WIDTH } from '../../../constants';
import { canvasTexture, spriteKey, type GallerySpot } from '../sportsKit';
import * as R from './freeThrowRules';

const { COSB, SINB, HOOP, BOARD } = R;
const RIM_RY = HOOP.rimR * COSB;

/**
 * The hoop sprite (backboard, pole, wheeled base, back of the rim, and its shadow) is a 460x440 render
 * of the screen region x 780..1240, y 150..590: the ground point under the rim's centre is its pixel
 * (180, 410). The rim's front half is a 100x60 render centred on the rim (its pixel (50, 27)).
 */
export const HOOP_ART = { w: 540, h: 440, ax: 180, ay: 410 };
export const RIM_ART = { ax: 50, ay: 27 };
/** Rendered ball images are 64 px across; they are drawn 2 * BALL_R across. */
export const BALL_ART = 64;
export const WORD_STYLES: [string, string, readonly [string, string]][] = [
  ['cap-ft-swish', 'SWISH!', ['#fff7c2', '#ffc93a']],
  ['cap-ft-bank', 'OFF THE GLASS!', ['#e8fbff', '#7fdcff']],
  ['cap-ft-rim', 'RIMMED OUT', ['#ffffff', '#c9d2dc']],
  ['cap-ft-board', 'OFF THE BOARD', ['#ffffff', '#c9d2dc']],
  ['cap-ft-short', 'SHORT!', ['#ffffff', '#c9d2dc']],
  ['cap-ft-wide', 'WIDE!', ['#ffffff', '#c9d2dc']],
  ['cap-ft-golden', 'GOLDEN BALL!', ['#fff7c2', '#ffb020']],
  ['cap-ft-streak', 'HOT HAND!', ['#fff1e0', '#ff8a5c']],
];

/** Spectators on the lawn either side of the court (clear spots in the render). */
export const GALLERY: GallerySpot[] = [
  { x: 150, y: 520, id: 'ora', pose: 'cheer' },
  { x: 232, y: 640, id: 'pipper', pose: 'happy' },
  { x: 128, y: 760, id: 'packsprout', pose: 'cheer' },
  { x: 214, y: 880, id: 'mimi', pose: 'laugh' },
  { x: 1770, y: 520, id: 'wrench', pose: 'laugh', flip: true },
  { x: 1688, y: 640, id: 'mimi', pose: 'happy', flip: true },
  { x: 1792, y: 760, id: 'ora', pose: 'wave', flip: true },
  { x: 1706, y: 880, id: 'packsprout', pose: 'star', flip: true },
];

// --- Fallback art (when the rendered sprites or the court render are missing) ----------------------
export function makeFallbackSprites(scene: Phaser.Scene): void {
  const ball = (gold: boolean) => (ctx: CanvasRenderingContext2D) => {
    const g = ctx.createRadialGradient(24, 22, 4, 32, 32, 31);
    g.addColorStop(0, gold ? '#fff3b0' : '#ffb56b');
    g.addColorStop(0.6, gold ? '#f4b83b' : '#e8772e');
    g.addColorStop(1, gold ? '#b87400' : '#9c4312');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = gold ? '#7a4d00' : '#3a1a0a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(2, 32);
    ctx.lineTo(62, 32);
    ctx.moveTo(32, 2);
    ctx.lineTo(32, 62);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(8, 32, 22, -1.1, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(56, 32, 22, Math.PI - 1.1, Math.PI + 1.1);
    ctx.stroke();
  };
  canvasTexture(scene, spriteKey('capitol_ball'), BALL_ART, BALL_ART, ball(false));
  canvasTexture(scene, spriteKey('capitol_ball_gold'), BALL_ART, BALL_ART, ball(true));
  canvasTexture(scene, spriteKey('capitol_rim'), 100, 60, (ctx) => {
    ctx.strokeStyle = '#e8641e';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(50, 27, 40, RIM_RY, 0, 0, Math.PI);
    ctx.stroke();
  });
  canvasTexture(scene, spriteKey('capitol_hoop'), HOOP_ART.w, HOOP_ART.h, (ctx) => {
    // Coordinates relative to the ground point under the rim.
    const ox = HOOP_ART.ax;
    const oy = HOOP_ART.ay;
    const Y = (gyOff: number, z: number) => oy + gyOff - z * SINB;
    ctx.fillStyle = 'rgba(10,17,32,0.25)';
    ctx.beginPath();
    ctx.ellipse(ox, Y(-60, 0) + 6, 80, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d4450';
    ctx.fillRect(ox - 70, Y(-62, 0) - 16, 140, 24);
    ctx.fillStyle = '#6b7380';
    ctx.fillRect(ox - 9, Y(-62, 340), 18, 340 * SINB);
    const bTop = Y(-BOARD.back * COSB, BOARD.z1);
    const bBot = Y(-BOARD.back * COSB, BOARD.z0);
    ctx.fillStyle = '#f7f9fc';
    ctx.strokeStyle = '#2a3140';
    ctx.lineWidth = 6;
    ctx.fillRect(ox - BOARD.w / 2, bTop, BOARD.w, bBot - bTop);
    ctx.strokeRect(ox - BOARD.w / 2, bTop, BOARD.w, bBot - bTop);
    ctx.strokeStyle = '#e8641e';
    ctx.lineWidth = 5;
    ctx.strokeRect(ox - 34, bBot - 58, 68, 46);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(ox, Y(0, HOOP.rimZ), 40, RIM_RY, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  });
}

export function drawFallbackCourt(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(-50);
  g.fillStyle(0x5aa845, 1);
  g.fillRect(0, 110, GAME_WIDTH, 970);
  g.fillStyle(0x2f6b35, 1);
  g.fillRect(0, 110, GAME_WIDTH, 230);
  for (let x = 40; x < GAME_WIDTH; x += 150) g.fillCircle(x, 250, 70);
  const base = HOOP.gy - 160 * COSB;
  g.fillStyle(0xd9b98a, 1);
  g.fillRect(300, base, 1320, 1080 - base);
  g.lineStyle(6, 0xffffff, 0.9);
  g.strokeRect(300, base, 1320, 1080 - base);
  const ftY = base + 580 * COSB;
  g.strokeRect(HOOP.x - 245, base, 490, ftY - base);
  g.strokeEllipse(HOOP.x, ftY, 360, 360 * COSB);
  g.strokeEllipse(HOOP.x, HOOP.gy, 1350, 1350 * COSB);
  g.fillStyle(0x8a8f99, 1);
  g.fillRect(HOOP.x - R.SLIDE_AMP - 90, HOOP.gy - 118 * COSB - 6, 2 * R.SLIDE_AMP + 180, 12);
}

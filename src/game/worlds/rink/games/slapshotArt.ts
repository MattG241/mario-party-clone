// Slapshot Showdown: its rendered sprites' framing, the words it pops, the crowd's spots on the stands,
// and the fallback art drawn when a render is missing (kept apart from the gameplay in Slapshot.ts).
import type Phaser from 'phaser';
import { GAME_WIDTH } from '../../../constants';
import { paintTexture, spriteKey } from '../rinkKit';
import * as R from './slapshotRules';

const { COSB, SINB, RINK, GOAL } = R;

/** Goal sprites: the render region's size and the mouth centre's pixel in it, per side (see mg_rink.py). */
export const GOAL_ART: Record<R.Side, { key: string; w: number; h: number; ax: number; ay: number }> = {
  0: { key: 'rink_goal_l', w: 130, h: 280, ax: 80, ay: 168 },
  1: { key: 'rink_goal_r', w: 130, h: 280, ax: 50, ay: 168 },
  2: { key: 'rink_goal_t', w: 220, h: 140, ax: 110, ay: 114 },
  3: { key: 'rink_goal_b', w: 220, h: 150, ax: 110, ay: 72 },
};
/** The puck render is 40 px across (drawn 2 * PUCK_R across). */
export const PUCK_ART = 40;
export const WORD_STYLES: [string, string, readonly [string, string]][] = [
  ['rink-slap', 'SLAPSHOT!', ['#fff7c2', '#ffb020']],
  ['rink-check', 'CHECK!', ['#ffffff', '#ffb3d9']],
  ['rink-block', 'BLOCKED!', ['#e8fbff', '#7fdcff']],
  ['rink-post', 'POST!', ['#ffffff', '#c9d2dc']],
];

/** Spectators in the stands (screen x, feet y, scale): clear spots on the render's bleachers. */
export const CROWD_SPOTS: [number, number, number][] = [
  [150, 360, 0.3],
  [250, 390, 0.3],
  [350, 420, 0.3],
  [120, 560, 0.34],
  [230, 600, 0.34],
  [330, 640, 0.34],
  [150, 800, 0.36],
  [270, 840, 0.36],
  [1770, 360, 0.3],
  [1670, 390, 0.3],
  [1570, 420, 0.3],
  [1800, 560, 0.34],
  [1690, 600, 0.34],
  [1590, 640, 0.34],
  [1770, 800, 0.36],
  [1650, 840, 0.36],
];

// --- Fallback art (when the rendered sprites or the rink render are missing) -----------------------
export function makeFallbackSprites(scene: Phaser.Scene): void {
  paintTexture(scene, spriteKey('rink_puck'), PUCK_ART, PUCK_ART, (ctx) => {
    ctx.fillStyle = '#0c0d12';
    ctx.beginPath();
    ctx.ellipse(20, 22, 18, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2e38';
    ctx.beginPath();
    ctx.ellipse(20, 18, 18, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(20, 18, 12, 8, 0, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
  });
  for (const side of [0, 1, 2, 3] as R.Side[]) {
    const art = GOAL_ART[side];
    const g = R.goalGeom(side);
    paintTexture(scene, spriteKey(art.key), art.w, art.h, (ctx) => {
      // Screen coordinates relative to the mouth centre, which sits at (ax, ay).
      const P = (wx: number, wy: number, z: number) => ({ x: art.ax + (wx - g.mx), y: art.ay + (wy - g.my) * COSB - z * SINB });
      const [p1, p2] = g.posts;
      const b1 = { x: p1.x + g.nx * GOAL.d, y: p1.y + g.ny * GOAL.d };
      const b2 = { x: p2.x + g.nx * GOAL.d, y: p2.y + g.ny * GOAL.d };
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      for (const q of [P(p1.x, p1.y, 0), P(b1.x, b1.y, 0), P(b2.x, b2.y, 0), P(p2.x, p2.y, 0), P(p2.x, p2.y, 110), P(b2.x, b2.y, 80), P(b1.x, b1.y, 80), P(p1.x, p1.y, 110)]) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e8434a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (const q of [P(p1.x, p1.y, 0), P(p1.x, p1.y, 110), P(p2.x, p2.y, 110), P(p2.x, p2.y, 0)]) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    });
  }
}

export function drawFallbackRink(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(-50);
  g.fillGradientStyle(0x1a1440, 0x1a1440, 0x2a1d52, 0x2a1d52, 1);
  g.fillRect(0, 0, GAME_WIDTH, 1080);
  const top = (RINK.cy - RINK.half) * COSB;
  const w = RINK.half * 2;
  const h = RINK.half * 2 * COSB;
  g.fillStyle(0xf2f7ff, 1);
  g.fillRoundedRect(RINK.cx - RINK.half, top, w, h, RINK.corner * 0.9);
  g.lineStyle(10, 0xffffff, 1);
  g.strokeRoundedRect(RINK.cx - RINK.half, top, w, h, RINK.corner * 0.9);
  g.lineStyle(4, 0x9ec9f0, 1);
  g.strokeEllipse(RINK.cx, RINK.cy * COSB, 180, 180 * COSB);
  g.lineStyle(4, 0xe86aa8, 0.8);
  g.lineBetween(RINK.cx - RINK.half, RINK.cy * COSB, RINK.cx + RINK.half, RINK.cy * COSB);
  g.lineBetween(RINK.cx, top, RINK.cx, top + h);
}
